/**
 * Import d'un tableau Trello (export JSON) dans la section CM : aperçu, correspondance des membres Trello
 * avec les comptes de l'app, import IDEMPOTENT (identifiants Trello gardés : relancer l'import met à jour
 * le même tableau, sans rien dupliquer). Aucune requête réseau vers Trello (voir trello.mjs).
 *
 * Relancer l'import :
 *  - listes, étiquettes : nom, position, archivage repris de Trello ;
 *  - cartes : titre, description, liste, position, échéance, archivage repris de Trello, SAUF pour une carte
 *    devenue un post dans l'app (son contenu suit le circuit de validation : elle n'est plus touchée) ;
 *  - étiquettes et membres des cartes, éléments de checklist, commentaires, pièces jointes : ajoutés s'ils sont
 *    nouveaux (rien de ce qui a été ajouté dans l'app n'est retiré) ;
 *  - couvertures : couleurs reprises ; une image de couverture reste une pièce jointe Trello.
 *  - étiquettes nommées Critique / Urgent / Moyen / Faible (ou Critical / Urgent / Medium / Low) : l'aperçu les signale ;
 *    avec `convertirUrgences`, elles deviennent le DRAPEAU D'URGENCE des cartes (le plus haut niveau si plusieurs ; une
 *    carte qui a déjà un drapeau le garde) et ne sont pas importées comme étiquettes.
 *  - listes archivées ou nommées Fini / Terminé / Fait / Done / Publié : l'aperçu les propose comme COLONNES DE FIN ; avec
 *    `listesFin` (identifiants Trello des listes retenues), elles sont marquées colonnes de fin (jamais décochées par un
 *    nouvel import) et les cartes qui s'y trouvent deviennent terminées (une carte sortie d'une colonne de fin est rouverte).
 * Permission : cm.gerer sur la portée choisie (club ou team).
 */

import { evenement } from '../evenements.mjs';
import { echec, iso, nouvelId } from '../outils.mjs';
import { PORTEE_CLUB, contexteCm, exiger, lirePortee, porteesDe, teamDePortee, versionTableau } from './commun.mjs';
import { niveauTableau } from './acces.mjs';
import { urgenceDepuisNom, rangUrgence } from './urgence.mjs';
import { nomColonneDeFin } from './colonneFin.mjs';
import { TrelloInvalide, bilanTrello, lireExportTrello } from './trello.mjs';

const PAQUET = 40;

/** Insertions de plusieurs lignes par requête (`suffixe` : ON CONFLICT …). */
function insertions(table, colonnes, lignes, suffixe) {
  const sortie = [];
  for (let i = 0; i < lignes.length; i += PAQUET) {
    const paquet = lignes.slice(i, i + PAQUET);
    sortie.push({
      sql: `INSERT INTO ${table} (${colonnes.join(', ')}) VALUES ${paquet.map(() => `(${colonnes.map(() => '?').join(', ')})`).join(', ')} ${suffixe}`,
      params: paquet.flat(),
    });
  }
  return sortie;
}

/** Garde la première occurrence de chaque identifiant (un fichier modifié à la main peut en répéter). */
const uniques = (liste, cle = x => x.trelloId) => {
  const vus = new Set();
  return liste.filter(x => (vus.has(cle(x)) ? false : (vus.add(cle(x)), true)));
};

function lire(corps) {
  if (!corps?.trello || typeof corps.trello !== 'object' || Array.isArray(corps.trello)) throw echec(400, 'trello-invalide', 'Fichier illisible : choisissez l’export JSON d’un tableau Trello.');
  try {
    return lireExportTrello(corps.trello, { avecArchivees: corps?.avecArchivees === true });
  } catch (e) {
    if (e instanceof TrelloInvalide) {
      const err = echec(400, 'trello-invalide', 'Ce fichier n’est pas un export de tableau Trello lisible.');
      err.details = { chemin: e.chemin, raison: e.raison };
      throw err;
    }
    throw e;
  }
}

/** Étiquettes Trello qui désignent un niveau d'urgence, avec le nombre de cartes concernées. */
function urgencesDetectees(m) {
  return m.etiquettes
    .map(e => ({ trelloId: e.trelloId, nom: e.nom, niveau: urgenceDepuisNom(e.nom) }))
    .filter(e => e.niveau)
    .map(e => ({ ...e, cartes: m.cartes.filter(c => c.etiquettes.includes(e.trelloId)).length }));
}

/** Pose le drapeau par paquets de cartes d'un même niveau (une carte qui en a déjà un le garde). */
function instructionsUrgence(parCarte) {
  const sortie = [];
  for (const niveau of new Set(parCarte.values())) {
    const ids = [...parCarte].filter(([, n]) => n === niveau).map(([id]) => id);
    for (let i = 0; i < ids.length; i += 200) {
      const paquet = ids.slice(i, i + 200);
      sortie.push({ sql: `UPDATE cm_cartes SET urgence = ? WHERE urgence IS NULL AND id IN (${paquet.map(() => '?').join(', ')})`, params: [niveau, ...paquet] });
    }
  }
  return sortie;
}

export function servicesImportTrello({ base, maintenant = () => Date.now(), tableaux }) {
  async function personnesDe(portee) {
    return tableaux.personnesTableau({ team_id: teamDePortee(portee) });
  }

  /** Correspondance proposée : même identifiant ou même nom (sans casse). */
  function proposer(membres, personnes) {
    const parPseudo = new Map(personnes.map(p => [p.pseudo.toLowerCase(), p.compte]));
    return Object.fromEntries(membres.map(m => [m.id, parPseudo.get(m.identifiant.toLowerCase()) ?? parPseudo.get(m.nom.toLowerCase()) ?? null]));
  }

  /** `POST /cm/import/trello/apercu` `{ trello, portee, avecArchivees }` : ce qui sera importé, sans rien écrire. */
  async function apercu(acteur, corps) {
    const portee = lirePortee(corps?.portee ?? PORTEE_CLUB);
    const ctx = await contexteCm(base, acteur, portee);
    exiger(ctx, 'cm.gerer');
    const m = lire(corps);
    const existant = await base.premier('SELECT id, nom, portee, team_id, acces, supprime_le FROM cm_tableaux WHERE trello_id = ?', [m.tableau.trelloId]);
    // Tableau déjà importé mais RESTREINT et fermé à l'acteur (migration 0046) : ni son nom ni ses personnes.
    const ferme = existant && !existant.supprime_le && !(await tableaux.tableauVisible(acteur, existant.id).then(() => true, () => false));
    const personnes = existant && !existant.supprime_le && !ferme ? await tableaux.personnesTableau(existant) : await personnesDe(existant?.portee ?? portee);
    return {
      tableau: { nom: m.tableau.nom, trelloId: m.tableau.trelloId },
      bilan: bilanTrello(m),
      archivees: m.archivees,
      urgences: urgencesDetectees(m).map(({ nom, niveau, cartes }) => ({ nom, niveau, cartes })),
      piecesIgnorees: m.piecesIgnorees,
      avertissements: m.avertissements,
      membresTrello: m.membres.map(x => ({ id: x.id, nom: x.nom, identifiant: x.identifiant })),
      correspondances: proposer(m.membres, personnes),
      personnes,
      dejaImporte: existant && !existant.supprime_le ? (ferme ? { restreint: true } : { id: existant.id, nom: existant.nom, portee: existant.portee }) : null,
      listes: m.listes.slice(0, 50).map(l => ({ trelloId: l.trelloId, nom: l.nom, archivee: l.archivee, cartes: m.cartes.filter(c => c.listeTrelloId === l.trelloId).length, proposeFin: l.archivee || nomColonneDeFin(l.nom) })),
    };
  }

  /** `POST /cm/import/trello` `{ trello, portee, avecArchivees, correspondances }` : import (ou mise à jour). */
  async function importer(acteur, corps) {
    let portee = lirePortee(corps?.portee ?? PORTEE_CLUB);
    const ctx = await contexteCm(base, acteur, portee);
    exiger(ctx, 'cm.gerer');
    const m = lire(corps);
    const t = maintenant();
    const quand = iso(t);
    let tb = await base.premier('SELECT * FROM cm_tableaux WHERE trello_id = ?', [m.tableau.trelloId]);
    let porteeConservee = false;
    if (tb && tb.portee !== portee) {
      // Déjà importé ailleurs : on met à jour CE tableau (il faut aussi le droit de le gérer).
      const ctx2 = await contexteCm(base, acteur, tb.portee).catch(() => null);
      if (!ctx2?.permissions.has('cm.gerer')) throw echec(409, 'deja-importe', 'Ce tableau Trello est déjà importé dans une autre partie CM.');
      portee = tb.portee;
      porteeConservee = true;
    }
    // Mise à jour d'un tableau existant : il faut le voir au niveau « modifier » (tableau restreint, migration 0046).
    if (tb && (await niveauTableau(base, acteur, tb)) !== 'modifier') throw echec(409, 'deja-importe', 'Ce tableau Trello est déjà importé dans un tableau auquel vous n’avez pas accès.');
    const nouveauTableau = !tb;
    if (!tb) {
      const id = nouvelId();
      await base.executer(
        'INSERT INTO cm_tableaux (id, portee, team_id, nom, description, couleur, position, version, trello_id, cree_par, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)',
        [id, portee, teamDePortee(portee), m.tableau.nom, m.tableau.description, '#0c66e4', t, m.tableau.trelloId, acteur.compte, quand, quand],
      );
      tb = await base.premier('SELECT * FROM cm_tableaux WHERE id = ?', [id]);
    } else {
      await base.executer('UPDATE cm_tableaux SET nom = ?, description = ?, supprime_le = NULL, maj_le = ? WHERE id = ?', [m.tableau.nom, m.tableau.description, quand, tb.id]);
    }

    // Correspondance des membres Trello → comptes qui ont accès au tableau (les autres sont ignorés).
    const personnes = new Set((await tableaux.personnesTableau(tb)).map(p => p.compte));
    const corr = new Map();
    const demandees = corps?.correspondances && typeof corps.correspondances === 'object' && !Array.isArray(corps.correspondances) ? corps.correspondances : {};
    for (const mb of m.membres) {
      const c = demandees[mb.id];
      if (typeof c === 'string' && personnes.has(c)) corr.set(mb.id, c);
    }

    // 1. Listes et étiquettes (upsert par identifiant Trello).
    const listesAvant = new Set((await base.tous('SELECT trello_id FROM cm_listes WHERE tableau_id = ? AND trello_id IS NOT NULL', [tb.id])).map(l => l.trello_id));
    const cartesAvant = new Map((await base.tous('SELECT trello_id, post FROM cm_cartes WHERE tableau_id = ? AND trello_id IS NOT NULL', [tb.id])).map(l => [l.trello_id, Number(l.post)]));
    const listes = uniques(m.listes);
    // Étiquettes supprimées ou fusionnées dans l'app (migration 0029) : jamais recréées.
    const retirees = new Set((await base.tous('SELECT trello_id FROM cm_etiquettes_retirees WHERE tableau_id = ?', [tb.id])).map(l => l.trello_id));
    // Étiquettes d'urgence converties en drapeau : ni créées, ni posées sur les cartes.
    const niveauParEtiquette = new Map(corps?.convertirUrgences === true ? urgencesDetectees(m).map(e => [e.trelloId, e.niveau]) : []);
    const etiquettes = uniques(m.etiquettes).filter(e => !retirees.has(e.trelloId) && !niveauParEtiquette.has(e.trelloId));
    await base.lot([
      ...insertions('cm_listes', ['id', 'tableau_id', 'nom', 'position', 'trello_id', 'archive_le', 'cree_le', 'maj_le'], listes.map(l => [nouvelId(), tb.id, l.nom, l.position, l.trelloId, l.archivee ? quand : null, quand, quand]),
        'ON CONFLICT (tableau_id, trello_id) DO UPDATE SET nom = excluded.nom, position = excluded.position, archive_le = excluded.archive_le, maj_le = excluded.maj_le'),
      ...insertions('cm_etiquettes', ['id', 'tableau_id', 'nom', 'couleur', 'position', 'trello_id'], etiquettes.map((e, i) => [nouvelId(), tb.id, e.nom, e.couleur, i, e.trelloId]),
        'ON CONFLICT (tableau_id, trello_id) DO UPDATE SET nom = excluded.nom, couleur = excluded.couleur WHERE cm_etiquettes.modifie_le IS NULL'),
    ]);
    const idListe = new Map((await base.tous('SELECT id, trello_id FROM cm_listes WHERE tableau_id = ? AND trello_id IS NOT NULL', [tb.id])).map(l => [l.trello_id, l.id]));
    const idEtiquette = new Map((await base.tous('SELECT id, trello_id FROM cm_etiquettes WHERE tableau_id = ? AND trello_id IS NOT NULL', [tb.id])).map(l => [l.trello_id, l.id]));
    // Colonnes de fin choisies (migration 0050) : listes de l'export seulement.
    const demandeesFin = Array.isArray(corps?.listesFin) ? new Set(corps.listesFin.filter(x => typeof x === 'string')) : new Set();
    const idsFin = listes.filter(l => demandeesFin.has(l.trelloId) && idListe.has(l.trelloId)).map(l => idListe.get(l.trelloId));
    if (idsFin.length) await base.executer(`UPDATE cm_listes SET fin = 1 WHERE tableau_id = ? AND id IN (${idsFin.map(() => '?').join(', ')})`, [tb.id, ...idsFin]);

    // 2. Cartes. Une carte devenue post dans l'app n'est plus mise à jour (son contenu suit la validation).
    const cartes = uniques(m.cartes).filter(c => idListe.has(c.listeTrelloId));
    await base.lot(
      insertions(
        'cm_cartes',
        ['id', 'tableau_id', 'liste_id', 'team_id', 'titre', 'description', 'position', 'couverture', 'echeance', 'echeance_faite', 'origine', 'trello_id', 'archive_le', 'cree_par', 'cree_le', 'maj_par', 'maj_le'],
        cartes.map(c => [nouvelId(), tb.id, idListe.get(c.listeTrelloId), tb.team_id ?? null, c.titre, c.description, c.position, c.couverture?.couleur ? JSON.stringify({ couleur: c.couverture.couleur }) : null, c.echeance, c.echeanceFaite ? 1 : 0, 'trello', c.trelloId, c.archivee ? quand : null, acteur.compte, quand, acteur.compte, quand]),
        `ON CONFLICT (tableau_id, trello_id) DO UPDATE SET liste_id = excluded.liste_id, titre = excluded.titre, description = excluded.description, position = excluded.position,
           couverture = COALESCE(excluded.couverture, cm_cartes.couverture), echeance = excluded.echeance, echeance_faite = excluded.echeance_faite, archive_le = excluded.archive_le,
           maj_par = excluded.maj_par, maj_le = excluded.maj_le, version = cm_cartes.version + 1 WHERE cm_cartes.post = 0 AND cm_cartes.supprime_le IS NULL`,
      ),
    );
    // Invariant de la migration 0050 : terminée si et seulement si la colonne est une colonne de fin.
    await base.lot([
      { sql: 'UPDATE cm_cartes SET terminee_le = ?, terminee_par = ? WHERE tableau_id = ? AND terminee_le IS NULL AND supprime_le IS NULL AND liste_id IN (SELECT id FROM cm_listes WHERE tableau_id = ? AND fin = 1)', params: [quand, acteur.compte, tb.id, tb.id] },
      { sql: 'UPDATE cm_cartes SET terminee_le = NULL, terminee_par = NULL WHERE tableau_id = ? AND terminee_le IS NOT NULL AND liste_id IN (SELECT id FROM cm_listes WHERE tableau_id = ? AND fin = 0)', params: [tb.id, tb.id] },
    ]);
    const idCarte = new Map((await base.tous('SELECT id, trello_id FROM cm_cartes WHERE tableau_id = ? AND trello_id IS NOT NULL', [tb.id])).map(l => [l.trello_id, l.id]));

    // 3. Étiquettes et membres des cartes, checklists, commentaires, pièces jointes (ajouts seulement).
    const liensEtiquettes = [];
    const liensMembres = [];
    const urgenceParCarte = new Map();
    const pieces = [];
    for (const c of cartes) {
      const cid = idCarte.get(c.trelloId);
      if (!cid) continue;
      for (const e of new Set(c.etiquettes)) {
        if (niveauParEtiquette.has(e)) {
          if (rangUrgence(niveauParEtiquette.get(e)) > rangUrgence(urgenceParCarte.get(cid))) urgenceParCarte.set(cid, niveauParEtiquette.get(e));
        } else if (idEtiquette.has(e)) liensEtiquettes.push([cid, idEtiquette.get(e)]);
      }
      for (const mb of new Set(c.membres)) if (corr.has(mb)) liensMembres.push([cid, corr.get(mb)]);
      for (const p of uniques(c.pieces)) pieces.push([nouvelId(), cid, 'lien', p.nom, p.url, p.depose ? 1 : 0, p.trelloId, acteur.compte, quand]);
    }
    const checklists = uniques(m.checklists).filter(k => idCarte.has(k.carteTrelloId));
    await base.lot([
      ...insertions('cm_carte_etiquettes', ['carte_id', 'etiquette_id'], uniques(liensEtiquettes, x => x.join()), 'ON CONFLICT DO NOTHING'),
      // Drapeaux d'urgence (une carte qui en a déjà un le garde).
      ...instructionsUrgence(urgenceParCarte),
      ...insertions('cm_carte_membres', ['carte_id', 'compte_id'], uniques(liensMembres, x => x.join()), 'ON CONFLICT DO NOTHING'),
      ...insertions('cm_pieces', ['id', 'carte_id', 'genre', 'nom', 'url', 'trello', 'trello_id', 'cree_par', 'cree_le'], pieces, 'ON CONFLICT DO NOTHING'),
      ...insertions('cm_checklists', ['id', 'carte_id', 'nom', 'position', 'trello_id'], checklists.map(k => [nouvelId(), idCarte.get(k.carteTrelloId), k.nom, k.position, k.trelloId]),
        'ON CONFLICT (carte_id, trello_id) DO UPDATE SET nom = excluded.nom, position = excluded.position'),
    ]);
    const idChecklist = new Map((await base.tous('SELECT k.id, k.trello_id, k.carte_id FROM cm_checklists k JOIN cm_cartes c ON c.id = k.carte_id WHERE c.tableau_id = ? AND k.trello_id IS NOT NULL', [tb.id])).map(l => [`${l.carte_id}:${l.trello_id}`, l.id]));
    const elements = [];
    for (const k of checklists) {
      const cid = idCarte.get(k.carteTrelloId);
      const kid = idChecklist.get(`${cid}:${k.trelloId}`);
      if (!kid) continue;
      for (const e of uniques(k.elements)) elements.push([nouvelId(), kid, cid, e.texte, e.fait ? 1 : 0, e.position, e.trelloId]);
    }
    const commentaires = uniques(m.commentaires)
      .filter(x => idCarte.has(x.carteTrelloId))
      .map(x => [nouvelId(), idCarte.get(x.carteTrelloId), corr.get(x.auteurTrelloId) ?? null, corr.has(x.auteurTrelloId) ? null : x.auteurNom, x.texte, x.trelloId, x.date ?? quand, x.date ?? quand]);
    const nouvellesCartes = cartes.filter(c => !cartesAvant.has(c.trelloId) && idCarte.has(c.trelloId));
    await base.lot([
      ...insertions('cm_checklist_elements', ['id', 'checklist_id', 'carte_id', 'texte', 'fait', 'position', 'trello_id'], elements,
        'ON CONFLICT (checklist_id, trello_id) DO UPDATE SET texte = excluded.texte, fait = excluded.fait, position = excluded.position'),
      ...insertions('cm_commentaires', ['id', 'carte_id', 'auteur_id', 'auteur_nom', 'texte', 'trello_id', 'cree_le', 'maj_le'], commentaires, 'ON CONFLICT DO NOTHING'),
      ...insertions('cm_activite', ['id', 'carte_id', 'tableau_id', 'acteur_id', 'action', 'meta', 'cree_le'], nouvellesCartes.map(c => [nouvelId(), idCarte.get(c.trelloId), tb.id, acteur.compte, 'importee', '{}', quand]), ''),
      versionTableau(tb.id, t),
    ]);

    const bilan = {
      ...bilanTrello({ ...m, listes, etiquettes, cartes, checklists }),
      listesCreees: listes.filter(l => !listesAvant.has(l.trelloId)).length,
      cartesCreees: nouvellesCartes.length,
      cartesMisesAJour: cartes.filter(c => cartesAvant.get(c.trelloId) === 0).length,
      cartesPostsInchangees: cartes.filter(c => cartesAvant.get(c.trelloId) === 1).length,
      membresAssocies: corr.size,
      piecesIgnorees: m.piecesIgnorees,
      urgencesConverties: urgenceParCarte.size,
      colonnesFin: listes.filter(l => idsFin.includes(idListe.get(l.trelloId))).length,
      couverturesImages: m.cartes.filter(c => c.couverture?.pieceTrelloId).length,
    };
    await base.lot([
      { sql: 'INSERT INTO cm_imports (id, tableau_id, trello_id, bilan, importe_par, cree_le) VALUES (?, ?, ?, ?, ?, ?)', params: [nouvelId(), tb.id, m.tableau.trelloId, JSON.stringify(bilan), acteur.compte, quand] },
      evenement('cm.import_trello', { teamId: tb.team_id ?? null, acteur: acteur.compte, entiteType: 'cm_tableau', entiteId: tb.id, charge: { nom: m.tableau.nom, nouveau: nouveauTableau, cartes: bilan.cartes, cartesCreees: bilan.cartesCreees }, maintenant: t }),
    ]);
    return { tableauId: tb.id, nouveau: nouveauTableau, porteeConservee, bilan };
  }

  /** Portées où l'acteur peut importer (cm.gerer). */
  async function portees(acteur) {
    const p = await porteesDe(base, acteur);
    return {
      portees: [...(p.club.has('cm.gerer') ? [{ portee: PORTEE_CLUB, team: null }] : []), ...[...p.teams].filter(([, s]) => s.has('cm.gerer')).map(([id]) => ({ portee: id, team: p.noms.get(id) }))],
    };
  }

  return { apercu, importer, portees };
}

