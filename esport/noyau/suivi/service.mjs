/**
 * Suivi des joueurs (module `player_notes`) : notes du staff sur chaque joueur.
 *
 * Même contrat que les autres services : SQL standard (SQLite et
 * PostgreSQL), aucune dépendance au runtime, contrôles dans l'ordre
 * authentification (api.mjs) → appartenance (`contexteTeam`) → module activé
 * → permission (`exiger`). Toute écriture ajoute son événement de domaine à
 * l'outbox dans le même lot (journal) ; la charge ne contient JAMAIS le
 * contenu d'une note : seulement le joueur concerné (« note ajoutée sur X »).
 * Aucun message Discord.
 *
 * Confidentialité (docs/esport/suivi-joueurs.md) :
 *  - fiches et notes : `player_notes.view` (écrire : `player_notes.write`,
 *    supprimer : `player_notes.delete` ou l'auteur) — le staff ;
 *  - le joueur concerné ne voit JAMAIS sa fiche, même s'il a ces permissions
 *    (403) ; il ne voit que les notes PARTAGÉES avec lui (`/suivi/moi`), en
 *    lecture, sans l'auteur si celui-ci l'a masqué ;
 *  - les autres joueurs ne voient rien (pas de permission).
 */

import { evenement } from '../evenements.mjs';
import { dateDuJour } from '../objectifs.mjs';
import { autorise, CLE_PROPRIETAIRE } from '../permissions.mjs';
import { echec, iso, jsonOu, nouvelId, texteLong, texteNettoye } from '../outils.mjs';
import { pseudosDe } from '../requetes.mjs';
import { lireDate, texteDate } from '../planning/temps.mjs';

export const MODULE_SUIVI = 'player_notes';
export const CATEGORIES_NOTE = ['performance', 'mental', 'communication', 'comportement', 'objectif', 'autre'];
export const TONS_NOTE = ['positif', 'a_travailler', 'neutre'];
export const LIENS_NOTE = ['evenement', 'review', 'repere'];
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MOTIF_COMPTE = /^(principal|[a-z0-9]{6,16})$/;
const CONTENU_MAX = 8000;
const TAGS_MAX = 10;
const TAG_MAX = 24;
const NOTES_MAX_PAR_FICHE = 1000;

/** Étiquettes saisies : 10 au plus, 24 caractères chacune, sans doublon (casse ignorée). */
export function lireTags(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > TAGS_MAX) throw echec(400, 'tags', 'Étiquettes : 10 au plus.');
  const vus = new Set();
  const sortie = [];
  for (const brut of v) {
    const t = texteNettoye(brut, TAG_MAX).replace(/^#/, '');
    if (!t || vus.has(t.toLocaleLowerCase('fr'))) continue;
    vus.add(t.toLocaleLowerCase('fr'));
    sortie.push(t);
  }
  return sortie;
}

const booleen = v => (v === true || v === 1 ? 1 : 0);

export function servicesSuivi({ base, maintenant = () => Date.now(), socle, planning }) {
  const { contexteTeam, exiger } = socle;
  const peut = (ctx, p) => autorise(ctx.permissions, ctx.modules, p);

  /** Membres de la team (fiches possibles) : rôle et groupe (joueurs / staff), sans les Propriétaires. */
  async function membresTeam(teamId) {
    const lignes = await base.tous(
      `SELECT m.compte_id, m.statut, m.poste_jeu, r.nom AS role_nom, r.couleur AS role_couleur, r.cle_systeme, rp.permission, c.pseudo
         FROM membres m
         JOIN roles r ON r.id = m.role_id
         LEFT JOIN comptes c ON c.id = m.compte_id
         LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission IN ('attendance.rsvp_own', 'attendance.mark', 'planning.create', 'player_notes.view')
        WHERE m.team_id = ?`,
      [teamId],
    );
    const parCompte = new Map();
    for (const l of lignes) {
      if (!parCompte.has(l.compte_id)) {
        parCompte.set(l.compte_id, { compte: l.compte_id, pseudo: l.pseudo ?? null, statut: l.statut, poste: l.poste_jeu ?? null, role: { nom: l.role_nom, couleur: l.role_couleur, cle: l.cle_systeme ?? null }, perms: new Set() });
      }
      if (l.permission) parCompte.get(l.compte_id).perms.add(l.permission);
    }
    return [...parCompte.values()].map(m => {
      const cle = m.role.cle;
      const staff = ['manager', 'coach', 'analyste'].includes(cle) || (!cle && (m.perms.has('attendance.mark') || m.perms.has('planning.create') || m.perms.has('player_notes.view')));
      return { ...m, proprietaire: cle === CLE_PROPRIETAIRE, groupe: staff ? 'staff' : 'joueurs', perms: undefined };
    });
  }

  /** Contexte d'une fiche : module, permission, et jamais la sienne. */
  async function contexteFiche(acteur, teamId, compte, permission = 'player_notes.view') {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, permission);
    if (typeof compte !== 'string' || !MOTIF_COMPTE.test(compte)) throw echec(404, 'fiche-introuvable', 'Fiche introuvable.');
    // Le joueur concerné ne voit jamais les notes du staff sur lui (même avec les permissions du module).
    if (compte === acteur.compte) throw echec(403, 'propre-fiche', 'Les notes du staff sur vous ne vous sont pas accessibles (sauf celles partagées avec vous).');
    const membre = (await membresTeam(teamId)).find(m => m.compte === compte);
    if (!membre) {
      const ancienne = await base.premier('SELECT id FROM notes_joueurs WHERE team_id = ? AND joueur_id = ? LIMIT 1', [teamId, compte]);
      if (!ancienne) throw echec(404, 'fiche-introuvable', 'Fiche introuvable.');
    }
    return { ctx, membre: membre ?? null };
  }

  /** Titre lisible d'un lien (si l'acteur voit le module visé), sinon null. */
  async function titreLien(ctx, n) {
    if (!n.lien_type || !n.lien_id) return null;
    if (n.lien_type === 'evenement' && peut(ctx, 'planning.view')) return (await base.premier('SELECT titre FROM planning_evenements WHERE id = ? AND team_id = ?', [n.lien_id, n.team_id]))?.titre ?? null;
    if (n.lien_type === 'review' && peut(ctx, 'video_review.view')) return (await base.premier('SELECT titre FROM reviews WHERE id = ? AND team_id = ?', [n.lien_id, n.team_id]))?.titre ?? null;
    if (n.lien_type === 'repere' && peut(ctx, 'video_review.view')) {
      const r = await base.premier('SELECT r.titre, v.titre AS review FROM review_reperes r JOIN reviews v ON v.id = r.review_id WHERE r.id = ? AND r.team_id = ?', [n.lien_id, n.team_id]);
      return r ? `${r.review} · ${r.titre}` : null;
    }
    return null;
  }

  async function notePublique(ctx, n, noms) {
    const auteur = n.auteur_id ? { compte: n.auteur_id, pseudo: noms[n.auteur_id] ?? null } : null;
    const estAuteur = Boolean(n.auteur_id) && n.auteur_id === ctx.acteur.compte;
    const gerer = peut(ctx, 'player_notes.delete');
    return {
      id: n.id,
      joueur: n.joueur_id,
      auteur,
      categorie: n.categorie,
      ton: n.ton,
      contenu: n.contenu,
      tags: jsonOu(n.tags, []),
      lien: n.lien_type ? { type: n.lien_type, id: n.lien_id, occurrence: n.lien_occurrence ?? null, titre: await titreLien(ctx, n) } : null,
      date: n.date_note,
      epinglee: Number(n.epinglee) === 1,
      partagee: Number(n.partagee) === 1,
      auteurMasque: Number(n.auteur_masque) === 1,
      creeLe: n.cree_le,
      majLe: n.maj_le,
      peutModifier: peut(ctx, 'player_notes.write') && (estAuteur || gerer),
      peutSupprimer: gerer || (estAuteur && peut(ctx, 'player_notes.write')),
    };
  }

  const trier = notes => notes.sort((a, b) => Number(b.epinglee) - Number(a.epinglee) || b.date_note.localeCompare(a.date_note) || b.cree_le.localeCompare(a.cree_le));

  // -------------------------------------------------------------- Lecture

  /** Liste des fiches : les membres de la team (sauf soi et les Propriétaires), avec le nombre de notes. */
  async function liste(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'player_notes.view');
    const membres = (await membresTeam(teamId)).filter(m => m.compte !== acteur.compte && !m.proprietaire);
    const compteurs = await base.tous(
      'SELECT joueur_id, COUNT(*) AS n, MAX(date_note) AS derniere, SUM(epinglee) AS epinglees, SUM(partagee) AS partagees FROM notes_joueurs WHERE team_id = ? GROUP BY joueur_id',
      [teamId],
    );
    const de = c => compteurs.find(x => x.joueur_id === c);
    return {
      joueurs: membres
        .map(m => ({ compte: m.compte, pseudo: m.pseudo, poste: m.poste, role: m.role, groupe: m.groupe, statut: m.statut, notes: Number(de(m.compte)?.n ?? 0), derniere: de(m.compte)?.derniere ?? null, partagees: Number(de(m.compte)?.partagees ?? 0) }))
        .sort((a, b) => (a.groupe === b.groupe ? 0 : a.groupe === 'joueurs' ? -1 : 1) || String(a.pseudo ?? '').localeCompare(String(b.pseudo ?? ''), 'fr')),
      droits: { ecrire: peut(ctx, 'player_notes.write'), supprimer: peut(ctx, 'player_notes.delete') },
    };
  }

  /** Résumé en haut de la fiche : présence (90 jours), tâches, objectifs individuels. Chaque bloc selon les droits de l'acteur. */
  async function resume(ctx, teamId, compte) {
    let presence = null;
    if (planning && peut(ctx, 'attendance.view_all')) {
      const f = await planning.fichePresence(ctx.acteur, teamId, compte, { periode: '90' });
      presence = { taux: f.taux, ponctualite: f.ponctualite, marques: f.marques, nonMarques: f.nonMarques, present: f.present, retard: f.retard, absent: f.absent, excuse: f.excuse, serie: f.serie, retardMoyen: f.retardMoyen };
    }
    let taches = null;
    let objectifs = null;
    if (peut(ctx, 'goals_tasks.view')) {
      const jour = dateDuJour(maintenant(), ctx.team.fuseau);
      const t = await base.premier(
        `SELECT SUM(CASE WHEN statut <> 'fait' THEN 1 ELSE 0 END) AS ouvertes,
                SUM(CASE WHEN statut <> 'fait' AND echeance IS NOT NULL AND echeance < ? THEN 1 ELSE 0 END) AS en_retard,
                SUM(CASE WHEN statut = 'fait' THEN 1 ELSE 0 END) AS faites
           FROM taches WHERE team_id = ? AND assigne_id = ? AND supprime_le IS NULL`,
        [jour, teamId, compte],
      );
      taches = { ouvertes: Number(t?.ouvertes ?? 0), enRetard: Number(t?.en_retard ?? 0), faites: Number(t?.faites ?? 0) };
      objectifs = (await base.tous("SELECT id, titre, statut, date_cible FROM objectifs WHERE team_id = ? AND proprietaire_id = ? AND supprime_le IS NULL ORDER BY CASE WHEN statut = 'actif' THEN 0 ELSE 1 END, cree_le DESC LIMIT 5", [teamId, compte])).map(
        o => ({ id: o.id, titre: o.titre, statut: o.statut, dateCible: o.date_cible ?? null }),
      );
    }
    return { presence, taches, objectifs };
  }

  /**
   * Fiche d'un joueur : ses notes (épinglées d'abord, puis de la plus récente),
   * filtrables (`categorie`, `ton`, `tag`, `q` : recherche dans le texte et les
   * étiquettes), le résumé et les étiquettes déjà utilisées.
   */
  async function fiche(acteur, teamId, compte, params = {}) {
    const { ctx, membre } = await contexteFiche(acteur, teamId, compte);
    const toutes = trier(await base.tous('SELECT * FROM notes_joueurs WHERE team_id = ? AND joueur_id = ? LIMIT ?', [teamId, compte, NOTES_MAX_PAR_FICHE]));
    const q = texteNettoye(params.q, 80).toLocaleLowerCase('fr');
    const garde = toutes.filter(n => {
      if (params.categorie && n.categorie !== params.categorie) return false;
      if (params.ton && n.ton !== params.ton) return false;
      const tags = jsonOu(n.tags, []);
      if (params.tag && !tags.some(t => t.toLocaleLowerCase('fr') === String(params.tag).toLocaleLowerCase('fr'))) return false;
      if (q && !`${n.contenu} ${tags.join(' ')}`.toLocaleLowerCase('fr').includes(q)) return false;
      return true;
    });
    const noms = await pseudosDe(base, [compte, ...toutes.map(n => n.auteur_id).filter(Boolean)]);
    const etiquettes = [...new Set(toutes.flatMap(n => jsonOu(n.tags, [])))].sort((a, b) => a.localeCompare(b, 'fr'));
    const recentes = toutes.slice().sort((a, b) => b.date_note.localeCompare(a.date_note) || b.cree_le.localeCompare(a.cree_le)).slice(0, 3);
    return {
      joueur: membre ? { compte, pseudo: membre.pseudo, poste: membre.poste, role: membre.role, statut: membre.statut, ancien: false } : { compte, pseudo: noms[compte] ?? null, poste: null, role: null, statut: null, ancien: true },
      resume: { ...(await resume(ctx, teamId, compte)), total: toutes.length, partagees: toutes.filter(n => Number(n.partagee) === 1).length, dernieres: await Promise.all(recentes.map(n => notePublique(ctx, n, noms))) },
      notes: await Promise.all(garde.map(n => notePublique(ctx, n, noms))),
      etiquettes,
      droits: { ecrire: peut(ctx, 'player_notes.write'), supprimer: peut(ctx, 'player_notes.delete') },
    };
  }

  /**
   * Notes PARTAGÉES avec moi (le joueur), en lecture : sans l'auteur s'il l'a
   * masqué, sans lien interne. Aucune permission du module n'est requise (ce
   * sont ses données), mais le module doit être activé.
   */
  async function mesNotes(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    if (!ctx.modules.has(MODULE_SUIVI)) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
    const lignes = await base.tous('SELECT * FROM notes_joueurs WHERE team_id = ? AND joueur_id = ? AND partagee = 1 ORDER BY date_note DESC, cree_le DESC LIMIT 200', [teamId, acteur.compte]);
    const noms = await pseudosDe(base, lignes.filter(n => Number(n.auteur_masque) !== 1).map(n => n.auteur_id).filter(Boolean));
    return {
      notes: lignes.map(n => ({
        id: n.id,
        categorie: n.categorie,
        ton: n.ton,
        contenu: n.contenu,
        tags: jsonOu(n.tags, []),
        date: n.date_note,
        auteur: Number(n.auteur_masque) === 1 || !n.auteur_id ? null : (noms[n.auteur_id] ?? null),
        partageeLe: n.partagee_le ?? null,
      })),
    };
  }

  // -------------------------------------------------------------- Écriture

  async function lireLien(ctx, corps, existant) {
    if (corps?.lien === undefined) return existant ? { type: existant.lien_type, id: existant.lien_id, occurrence: existant.lien_occurrence } : { type: null, id: null, occurrence: null };
    const l = corps.lien;
    if (l === null) return { type: null, id: null, occurrence: null };
    if (typeof l !== 'object' || !LIENS_NOTE.includes(l.type) || typeof l.id !== 'string' || !MOTIF_UUID.test(l.id)) throw echec(400, 'lien', 'Lien inconnu (événement, review ou repère).');
    const teamId = ctx.team.id;
    let ok = false;
    let occurrence = null;
    if (l.type === 'evenement') {
      ok = peut(ctx, 'planning.view') && Boolean(await base.premier('SELECT id FROM planning_evenements WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [l.id, teamId]));
      if (l.occurrence !== undefined && l.occurrence !== null) {
        const t = Date.parse(l.occurrence);
        if (Number.isNaN(t)) throw echec(400, 'lien', 'Lien inconnu (événement, review ou repère).');
        occurrence = new Date(t).toISOString();
      }
    } else if (l.type === 'review') {
      ok = peut(ctx, 'video_review.view') && Boolean(await base.premier('SELECT id FROM reviews WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [l.id, teamId]));
    } else {
      ok = peut(ctx, 'video_review.view') && Boolean(await base.premier('SELECT id FROM review_reperes WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [l.id, teamId]));
    }
    if (!ok) throw echec(400, 'lien', 'Lien inconnu (événement, review ou repère).');
    return { type: l.type, id: l.id, occurrence };
  }

  function lireChamps(corps, existant, fuseau) {
    const s = {};
    if (!existant || corps?.contenu !== undefined) {
      s.contenu = texteLong(corps?.contenu, CONTENU_MAX);
      if (!s.contenu) throw echec(400, 'contenu', 'La note est vide.');
    }
    if (!existant || corps?.categorie !== undefined) {
      s.categorie = corps?.categorie ?? 'autre';
      if (!CATEGORIES_NOTE.includes(s.categorie)) throw echec(400, 'categorie', 'Catégorie inconnue.');
    }
    if (!existant || corps?.ton !== undefined) {
      s.ton = corps?.ton ?? 'neutre';
      if (!TONS_NOTE.includes(s.ton)) throw echec(400, 'ton', 'Ton : positif, à travailler ou neutre.');
    }
    if (!existant || corps?.tags !== undefined) s.tags = JSON.stringify(lireTags(corps?.tags));
    if (!existant || corps?.date !== undefined) {
      const d = corps?.date ? lireDate(corps.date) : null;
      if (corps?.date && !d) throw echec(400, 'date', 'Date invalide (AAAA-MM-JJ).');
      s.date_note = d ? texteDate(d) : dateDuJour(maintenant(), fuseau);
    }
    for (const [champ, cle] of [
      ['epinglee', 'epinglee'],
      ['partagee', 'partagee'],
      ['auteurMasque', 'auteur_masque'],
    ]) {
      if (!existant || corps?.[champ] !== undefined) s[cle] = booleen(corps?.[champ]);
    }
    return s;
  }

  async function creer(acteur, teamId, compte, corps) {
    const { ctx, membre } = await contexteFiche(acteur, teamId, compte, 'player_notes.write');
    if (!membre) throw echec(404, 'fiche-introuvable', 'Fiche introuvable.');
    const s = lireChamps(corps, null, ctx.team.fuseau);
    const lien = await lireLien(ctx, corps, null);
    const t = maintenant();
    const id = nouvelId();
    const lot = [
      {
        sql: `INSERT INTO notes_joueurs (id, team_id, joueur_id, auteur_id, categorie, ton, contenu, tags, lien_type, lien_id, lien_occurrence, date_note, epinglee, partagee, auteur_masque, partagee_le, cree_le, maj_le)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, teamId, compte, acteur.compte, s.categorie, s.ton, s.contenu, s.tags, lien.type, lien.id, lien.occurrence, s.date_note, s.epinglee, s.partagee, s.auteur_masque, s.partagee ? iso(t) : null, iso(t), iso(t)],
      },
      // Journal : « note ajoutée sur X », jamais le contenu.
      evenement('player_note.created', { teamId, acteur: acteur.compte, entiteType: 'note_joueur', entiteId: id, charge: { compte }, maintenant: t }),
    ];
    if (s.partagee) lot.push(evenement('player_note.shared', { teamId, acteur: acteur.compte, entiteType: 'note_joueur', entiteId: id, charge: { compte, partagee: true }, maintenant: t }));
    await base.lot(lot);
    return noteDe(ctx, teamId, compte, id);
  }

  async function noteDe(ctx, teamId, compte, id) {
    const n = await base.premier('SELECT * FROM notes_joueurs WHERE id = ? AND team_id = ? AND joueur_id = ?', [id, teamId, compte]);
    if (!n) throw echec(404, 'note-introuvable', 'Note introuvable.');
    return notePublique(ctx, n, await pseudosDe(base, [n.auteur_id].filter(Boolean)));
  }

  async function noteExistante(teamId, compte, id) {
    if (typeof id !== 'string' || !MOTIF_UUID.test(id)) throw echec(404, 'note-introuvable', 'Note introuvable.');
    const n = await base.premier('SELECT * FROM notes_joueurs WHERE id = ? AND team_id = ? AND joueur_id = ?', [id, teamId, compte]);
    if (!n) throw echec(404, 'note-introuvable', 'Note introuvable.');
    return n;
  }

  /**
   * Modifie une note. Épingler / désépingler : tout le staff qui écrit (c'est
   * l'ordre de la fiche). Le reste (texte, catégorie, ton, étiquettes, lien,
   * date, partage, auteur masqué) : l'auteur, ou qui peut supprimer les notes.
   */
  async function modifier(acteur, teamId, compte, id, corps) {
    const { ctx } = await contexteFiche(acteur, teamId, compte, 'player_notes.write');
    const n = await noteExistante(teamId, compte, id);
    const s = lireChamps(corps, n, ctx.team.fuseau);
    const lien = await lireLien(ctx, corps, n);
    const champs = Object.keys(s).filter(c => s[c] !== n[c] && !(typeof n[c] === 'number' && Number(s[c]) === n[c]));
    if (lien.type !== n.lien_type || lien.id !== n.lien_id || lien.occurrence !== n.lien_occurrence) champs.push('lien');
    const auteurOuGestion = n.auteur_id === acteur.compte || peut(ctx, 'player_notes.delete');
    if (champs.some(c => c !== 'epinglee') && !auteurOuGestion) throw echec(403, 'permission', 'Seul l’auteur (ou qui peut supprimer les notes) modifie cette note.');
    if (champs.length === 0) return noteDe(ctx, teamId, compte, id);
    const t = maintenant();
    const valeurs = { ...s, lien_type: lien.type, lien_id: lien.id, lien_occurrence: lien.occurrence };
    const colonnes = [...champs.filter(c => c !== 'lien'), ...(champs.includes('lien') ? ['lien_type', 'lien_id', 'lien_occurrence'] : [])];
    const partage = champs.includes('partagee');
    if (partage) colonnes.push('partagee_le');
    valeurs.partagee_le = s.partagee ? iso(t) : null;
    const lot = [
      { sql: `UPDATE notes_joueurs SET ${colonnes.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ?`, params: [...colonnes.map(c => valeurs[c]), iso(t), id] },
      evenement(partage ? 'player_note.shared' : 'player_note.updated', { teamId, acteur: acteur.compte, entiteType: 'note_joueur', entiteId: id, charge: partage ? { compte, partagee: Boolean(s.partagee) } : { compte }, maintenant: t }),
    ];
    await base.lot(lot);
    return noteDe(ctx, teamId, compte, id);
  }

  /** Supprime une note (définitif) : `player_notes.delete`, ou son auteur. */
  async function supprimer(acteur, teamId, compte, id) {
    const { ctx } = await contexteFiche(acteur, teamId, compte, 'player_notes.view');
    const n = await noteExistante(teamId, compte, id);
    const auteur = n.auteur_id === acteur.compte && peut(ctx, 'player_notes.write');
    if (!auteur) exiger(ctx, 'player_notes.delete');
    const t = maintenant();
    await base.lot([
      { sql: 'DELETE FROM notes_joueurs WHERE id = ? AND team_id = ?', params: [id, teamId] },
      evenement('player_note.deleted', { teamId, acteur: acteur.compte, entiteType: 'note_joueur', entiteId: id, charge: { compte }, maintenant: t }),
    ]);
    return { ok: true };
  }

  return { liste, fiche, mesNotes, creer, modifier, supprimer, membresTeam };
}

/**
 * Routes HTTP du suivi (session déjà vérifiée) ; `undefined` si l'adresse ne
 * les concerne pas.
 *
 *   GET          /teams/:t/suivi                       fiches (player_notes.view)
 *   GET          /teams/:t/suivi/moi                   notes partagées avec moi (joueur)
 *   GET          /teams/:t/suivi/:compte               fiche (?q&categorie&ton&tag)
 *   POST         /teams/:t/suivi/:compte/notes         nouvelle note (player_notes.write)
 *   PATCH|DELETE /teams/:t/suivi/:compte/notes/:id     modifier (auteur, ou delete) / supprimer
 */
export async function routesSuivi({ suivi, acteur, chemin, methode, url, lireCorps }) {
  const m = /^\/teams\/([^/]+)\/suivi(\/.*)?$/.exec(chemin);
  if (!m) return undefined;
  const [, teamId, reste = ''] = m;
  const morceaux = reste.split('/').filter(Boolean).map(s => {
    try {
      return decodeURIComponent(s);
    } catch {
      return '';
    }
  });
  const [a, b, c] = morceaux;
  const n = morceaux.length;
  if (n === 0 && methode === 'GET') return suivi.liste(acteur, teamId);
  if (n === 1 && a === 'moi' && methode === 'GET') return suivi.mesNotes(acteur, teamId);
  if (n === 1 && methode === 'GET') return suivi.fiche(acteur, teamId, a, Object.fromEntries(url.searchParams.entries()));
  if (n === 2 && b === 'notes' && methode === 'POST') return suivi.creer(acteur, teamId, a, await lireCorps());
  if (n === 3 && b === 'notes' && methode === 'PATCH') return suivi.modifier(acteur, teamId, a, c, await lireCorps());
  if (n === 3 && b === 'notes' && methode === 'DELETE') return suivi.supprimer(acteur, teamId, a, c);
  return undefined;
}
