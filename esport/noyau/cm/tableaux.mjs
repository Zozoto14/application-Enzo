/**
 * Section CM : tableaux façon Trello (tableaux, listes, cartes, étiquettes, membres, checklists,
 * commentaires, pièces jointes, couverture, archivage, activité), cartes de contenu (« posts ») et circuit
 * de validation, recherche, calendrier éditorial, file « À valider », état pour le rafraîchissement.
 *
 * Droits (portée du tableau : club ou team, voir commun.mjs) :
 *  - voir un tableau, ses cartes, le calendrier : cm.voir ;
 *  - commenter : cm.voir avec cm.deposer ou cm.editer ;
 *  - cartes, listes, étiquettes, checklists, pièces jointes, posts (préparer, soumettre, publier) : cm.editer ;
 *    l'auteur d'un DÉPÔT (cm.deposer) modifie le titre, la description et les pièces de sa carte ;
 *  - valider ou refuser un post : cm.valider ;
 *  - créer, archiver, supprimer un tableau : cm.gerer.
 *
 * Rafraîchissement sans websocket (o2switch) : chaque écriture augmente la `version` du tableau ; l'app
 * relit `GET /cm/etat` (quelques octets) toutes les quelques secondes quand la page est visible, et ne
 * recharge le tableau que si sa version a changé.
 */

import { evenement } from '../evenements.mjs';
import { echec, iso, jsonOu, nouvelId, texteLong, texteNettoye } from '../outils.mjs';
import { lignesParIds, pseudosDe } from '../requetes.mjs';
import { NOTE_MAX, lienSur, nettoyerNote } from '../review/markdown.mjs';
import { cheminSigne } from '../fichiers.mjs';
import { effacerFichierCmSiOrphelin } from './utilisations.mjs';
import { instantMural, lireDate, lireHeure, fuseauValide } from '../planning/temps.mjs';
import { resumeAnnonce, resumeResultat, resumeTournoi } from '../competition/resume.mjs';
import {
  MOTIF_COMPTE,
  MOTIF_COULEUR,
  MOTIF_UUID,
  PORTEE_CLUB,
  activite,
  contexteCm,
  exiger,
  exigerUuid,
  lirePortee,
  peut,
  permissionsSur,
  porteesDe,
  positionEntre,
  teamDePortee,
  versionTableau,
} from './commun.mjs';
import { ACCES_TABLEAU, GENRES_ACCES, MAX_REGLES_ACCES, NIVEAUX_ACCES, estRestreint, lecteurTableaux, niveauTableau, niveauxTableau, permissionsAuNiveau } from './acces.mjs';
import { LISTE_DU_STATUT, empreinteContenu, lireLiens, lirePublications, lireReseaux, lireTextes, lireTitre, problemesPost } from './posts.mjs';
import { mentions as mentionsDe } from './reseaux.mjs';

export const LISTES_DEFAUT = Object.freeze(['idees', 'preparation', 'a_valider', 'valide', 'publie']);
export const CLE_TABLEAU_DEFAUT = 'contenus';
export const FUSEAU_CLUB = 'Europe/Paris';
export const DUREE_LIEN_CM_MS = 2 * 3600 * 1000;
/** Clé « premier passage » de `cm_commentaires_vus` (migration 0045). */
const CLE_VU_TOUT = '*';
const MAX_TABLEAUX = 200;
const MAX_LISTES = 100;
const MAX_CARTES_TABLEAU = 10_000;
const MAX_ETIQUETTES = 60;
const MAX_CHECKLISTS = 20;
const MAX_ELEMENTS = 200;
const MAX_PIECES = 50;
const MAX_MEMBRES = 20;
const COMMENTAIRE_MAX = 4000;
const ECART_MIN = 1e-6;

/**
 * Fonds de tableau prédéfinis (migration 0042) : la clé seule est enregistrée, l'app a les mêmes teintes
 * (src/esport/cm/fonds.ts). Une image (importée ou prise dans le Drive) est un fichier CM de la portée.
 */
export const FONDS_COULEURS = Object.freeze(['bleu', 'vert', 'orange', 'rouge', 'violet', 'rose', 'ciel', 'gris']);
export const FONDS_DEGRADES = Object.freeze(['aurore', 'ocean', 'foret', 'crepuscule', 'neon', 'nuit']);
const CLE_PREFERENCE = /^(tableau\.[0-9a-f-]{36}\.reduites|calendrier\.teams)$/;
const PREFERENCE_MAX = 4000;

// ------------------------------------------------------------------ Outils purs

/** Instant saisi (ISO avec fuseau, ou « AAAA-MM-JJ HH:MM » mural dans `fuseau`) → ISO UTC ; null si vide. */
export function lireInstantCm(v, fuseau, code = 'date') {
  if (v === undefined || v === null || v === '') return null;
  const t = String(v).trim();
  const mural = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/.exec(t);
  let ms;
  if (mural) {
    const d = lireDate(mural[1]);
    const h = lireHeure(mural[2] ?? '12:00');
    if (!d || h === undefined || h >= 1440 || !fuseauValide(fuseau)) throw echec(400, code, 'Date ou heure invalide.');
    ms = instantMural(fuseau, d, h);
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(t)) ms = Date.parse(t);
  else throw echec(400, code, 'Date ou heure invalide.');
  if (!Number.isFinite(ms) || ms < Date.UTC(2000, 0, 1) || ms > Date.UTC(2100, 0, 1)) throw echec(400, code, 'Date ou heure invalide.');
  return iso(ms);
}

const lireCouleur = (v, repli = '#5b8cff') => {
  if (v === undefined || v === null || v === '') return repli;
  if (typeof v !== 'string' || !MOTIF_COULEUR.test(v)) throw echec(400, 'couleur', 'Couleur : #RRGGBB.');
  return v.toLowerCase();
};

const nomListe = v => {
  const nom = texteNettoye(v, 80);
  if (nom.length < 1) throw echec(400, 'nom', 'Nom obligatoire.');
  return nom;
};

const echapperLike = q => q.replace(/[\\%_]/g, c => `\\${c}`);

// ------------------------------------------------------------------ Tableau par défaut

/**
 * Tableau « Contenus » d'une portée (créé s'il n'existe pas : listes Idées → En préparation → À valider →
 * Validé / Programmé → Publié). Idempotent, sûr en concurrence (index uniques). Rend sa ligne.
 */
export async function assurerTableauDefaut(base, portee, t) {
  const existant = await base.premier('SELECT * FROM cm_tableaux WHERE portee = ? AND cle_defaut = ?', [portee, CLE_TABLEAU_DEFAUT]);
  let tableau = existant;
  if (!tableau) {
    const id = nouvelId();
    await base.executer(
      `INSERT INTO cm_tableaux (id, portee, team_id, nom, description, couleur, cle_defaut, position, version, cree_le, maj_le)
       VALUES (?, ?, ?, NULL, '', '#db2777', ?, 0, 1, ?, ?) ON CONFLICT DO NOTHING`,
      [id, portee, teamDePortee(portee), CLE_TABLEAU_DEFAUT, iso(t), iso(t)],
    );
    tableau = await base.premier('SELECT * FROM cm_tableaux WHERE portee = ? AND cle_defaut = ?', [portee, CLE_TABLEAU_DEFAUT]);
  }
  if (tableau.supprime_le) await base.executer('UPDATE cm_tableaux SET supprime_le = NULL, archive_le = NULL WHERE id = ?', [tableau.id]);
  const n = await base.premier('SELECT COUNT(*) AS n FROM cm_listes WHERE tableau_id = ? AND cle IS NOT NULL', [tableau.id]);
  if (Number(n?.n ?? 0) < LISTES_DEFAUT.length) {
    await base.lot(
      LISTES_DEFAUT.map((cle, i) => ({
        sql: 'INSERT INTO cm_listes (id, tableau_id, nom, cle, position, cree_le, maj_le) VALUES (?, ?, NULL, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
        params: [nouvelId(), tableau.id, cle, (i + 1) * 1024, iso(t), iso(t)],
      })),
    );
  }
  return base.premier('SELECT * FROM cm_tableaux WHERE id = ?', [tableau.id]);
}

/** Liste de rôle `cle` d'un tableau (non archivée), ou null. */
export async function listeDeCle(base, tableauId, cle) {
  return base.premier('SELECT * FROM cm_listes WHERE tableau_id = ? AND cle = ? AND archive_le IS NULL', [tableauId, cle]);
}

/** Position en fin de liste. */
export async function positionFin(base, listeId) {
  const l = await base.premier('SELECT MAX(position) AS p FROM cm_cartes WHERE liste_id = ? AND supprime_le IS NULL', [listeId]);
  return l?.p === null || l?.p === undefined ? 1024 : Number(l.p) + 1024;
}

/**
 * Instructions d'insertion d'une carte (sans contrôle de droits : l'appelant décide). Rend
 * `{ id, instructions }`. `post` : carte de contenu (statut brouillon).
 */
export function instructionsCarte({ tableauId, listeId, teamId = null, titre, description = '', position, post = false, reseaux = [], textes = {}, liens = {}, datePublication = null, origine = 'manuel', origineCle = null, auto = false, depotGenre = null, acteur = null, t }) {
  const id = nouvelId();
  return {
    id,
    instructions: [
      {
        sql: `INSERT INTO cm_cartes (id, tableau_id, liste_id, team_id, titre, description, position, date_publication, post, statut, reseaux, textes, liens, origine, origine_cle, auto, depot_genre, cree_par, cree_le, maj_par, maj_le)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, tableauId, listeId, teamId, titre, description, position, datePublication, post ? 1 : 0, post ? 'brouillon' : null, JSON.stringify(reseaux), JSON.stringify(textes), JSON.stringify(liens), origine, origineCle, auto ? 1 : 0, depotGenre, acteur, iso(t), acteur, iso(t)],
      },
      activite(id, tableauId, acteur, 'creee', { origine }, t),
      versionTableau(tableauId, t),
    ],
  };
}

// ------------------------------------------------------------------ Service

/**
 * `medias` : envois par morceaux (pièces jointes déposées) ; `cleSession` : signature des liens de fichiers ;
 * `stockage` : effacement des octets d'une pièce retirée ; `drive` : pièce jointe choisie dans le Drive.
 */
export function servicesTableauxCm({ base, maintenant = () => Date.now(), medias, cleSession, stockage, drive }) {
  // ---------------------------------------------------------------- Lectures internes

  async function tableauLigne(id) {
    exigerUuid(id, 'tableau');
    const t = await base.premier('SELECT * FROM cm_tableaux WHERE id = ? AND supprime_le IS NULL', [id]);
    if (!t) throw echec(404, 'tableau-introuvable', 'Tableau introuvable.');
    return t;
  }

  /**
   * Tableau et contexte CM de l'acteur sur sa portée ; cm.voir exigé (404 sinon : on ne dit pas qu'il existe).
   * Tableau RESTREINT (migration 0046, acces.mjs) : 404 pour qui n'en est pas ; au niveau « voir », le contexte ne
   * garde que cm.voir (toute écriture est refusée, 403). `ctx.niveau` : 'voir' ou 'modifier'.
   */
  async function tableauVisible(acteur, id) {
    const tableau = await tableauLigne(id);
    let ctx;
    try {
      ctx = await contexteCm(base, acteur, tableau.portee);
    } catch {
      throw echec(404, 'tableau-introuvable', 'Tableau introuvable.');
    }
    if (!peut(ctx, 'cm.voir')) throw echec(404, 'tableau-introuvable', 'Tableau introuvable.');
    const niveau = await niveauTableau(base, acteur, tableau);
    if (!niveau) throw echec(404, 'tableau-introuvable', 'Tableau introuvable.');
    return { tableau, ctx: { ...ctx, permissions: permissionsAuNiveau(ctx.permissions, niveau), niveau } };
  }

  /** Régler l'accès au tableau : cm.gerer de la portée ou créateur du tableau, avec le niveau « modifier » (Fondateur : toujours). */
  const peutGererAcces = (ctx, tb) => Boolean(ctx.acteur?.superAdmin) || (ctx.niveau === 'modifier' && (peut(ctx, 'cm.gerer') || (Boolean(tb.cree_par) && tb.cree_par === ctx.acteur?.compte)));

  async function carteVisible(acteur, id) {
    exigerUuid(id, 'carte');
    const carte = await base.premier('SELECT * FROM cm_cartes WHERE id = ? AND supprime_le IS NULL', [id]);
    if (!carte) throw echec(404, 'carte-introuvable', 'Carte introuvable.');
    const { tableau, ctx } = await tableauVisible(acteur, carte.tableau_id).catch(() => {
      throw echec(404, 'carte-introuvable', 'Carte introuvable.');
    });
    return { carte, tableau, ctx };
  }

  async function listeDuTableau(tableauId, listeId) {
    exigerUuid(listeId, 'liste');
    const l = await base.premier('SELECT * FROM cm_listes WHERE id = ? AND tableau_id = ?', [listeId, tableauId]);
    if (!l) throw echec(404, 'liste-introuvable', 'Liste introuvable.');
    return l;
  }

  const droitsDe = ctx => ({
    voir: peut(ctx, 'cm.voir'),
    deposer: peut(ctx, 'cm.deposer'),
    editer: peut(ctx, 'cm.editer'),
    valider: peut(ctx, 'cm.valider'),
    gerer: peut(ctx, 'cm.gerer'),
    commenter: peut(ctx, 'cm.voir') && (peut(ctx, 'cm.deposer') || peut(ctx, 'cm.editer')),
  });

  /** L'acteur peut-il modifier le contenu de cette carte (éditeur, ou auteur d'un dépôt) ? */
  const peutModifierCarte = (ctx, carte) => peut(ctx, 'cm.editer') || (peut(ctx, 'cm.deposer') && carte.origine === 'depot' && carte.cree_par === ctx.acteur.compte && !Number(carte.post));

  /**
   * Personnes d'un tableau (assignables, mentionnables) : le Fondateur, les comptes affectés au club, et
   * pour un tableau de team ses membres actifs qui voient la partie CM (rôle ou affectation de la team).
   */
  async function personnesTableau(tableau, { portee = false } = {}) {
    const comptes = new Set();
    if (await base.premier("SELECT id FROM comptes WHERE id = 'principal'", [])) comptes.add('principal');
    for (const l of await base.tous("SELECT DISTINCT compte_id FROM cm_affectations WHERE portee = 'club'", [])) comptes.add(l.compte_id);
    // Rôles du club (migration 0033 : Second CEO, rôle « CM » du club…) qui ouvrent la section CM.
    for (const l of await base.tous("SELECT DISTINCT compte_id FROM permissions_club WHERE permission = 'cm.voir'", [])) comptes.add(l.compte_id);
    if (tableau.team_id) {
      for (const l of await base.tous(
        "SELECT DISTINCT a.compte_id FROM cm_affectations a JOIN membres m ON m.team_id = a.portee AND m.compte_id = a.compte_id AND m.statut = 'actif' WHERE a.portee = ?",
        [tableau.team_id],
      )) comptes.add(l.compte_id);
      for (const l of await base.tous(
        `SELECT DISTINCT m.compte_id FROM membres m JOIN roles r ON r.id = m.role_id LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission IN ('cm.voir', 'cm.deposer')
          WHERE m.team_id = ? AND m.statut = 'actif' AND (r.cle_systeme = 'proprietaire' OR rp.permission IS NOT NULL)`,
        [tableau.team_id],
      )) comptes.add(l.compte_id);
    }
    // Tableau restreint : seulement ceux qui le voient (le Fondateur toujours).
    if (!portee && estRestreint(tableau)) {
      const niveaux = await niveauxTableau(base, tableau);
      for (const c of [...comptes]) if (c !== 'principal' && !niveaux.has(c)) comptes.delete(c);
    }
    const noms = await pseudosDe(base, [...comptes]);
    return [...comptes].filter(c => noms[c]).map(c => ({ compte: c, pseudo: noms[c] })).sort((a, b) => a.pseudo.localeCompare(b.pseudo));
  }

  // ---------------------------------------------------------------- Commentaires non lus (migration 0045)

  /**
   * État « vu » des commentaires du compte (`cm_commentaires_vus`) : un commentaire est NON LU pour lui s'il a été
   * écrit par quelqu'un d'autre après la plus récente de : sa dernière ouverture de la carte, son « Tout marquer comme
   * lu » sur le tableau, et son premier passage (rien n'est « non lu » au premier passage).
   */
  async function lireVus(compte) {
    const vus = new Map((await base.tous('SELECT cle, vu_le FROM cm_commentaires_vus WHERE compte_id = ?', [compte])).map(l => [l.cle, l.vu_le]));
    if (!vus.has(CLE_VU_TOUT)) {
      const t0 = iso(maintenant());
      await base.executer('INSERT INTO cm_commentaires_vus (compte_id, cle, vu_le) VALUES (?, ?, ?) ON CONFLICT (compte_id, cle) DO NOTHING', [compte, CLE_VU_TOUT, t0]);
      vus.set(CLE_VU_TOUT, t0);
    }
    return vus;
  }

  const seuilVu = (vus, tableauId, carteId) => [vus.get(CLE_VU_TOUT), vus.get(`t:${tableauId}`), vus.get(carteId)].filter(Boolean).sort().pop();

  const marquerVu = (compte, cle, t = maintenant()) =>
    base.executer('INSERT INTO cm_commentaires_vus (compte_id, cle, vu_le) VALUES (?, ?, ?) ON CONFLICT (compte_id, cle) DO UPDATE SET vu_le = excluded.vu_le', [compte, cle, iso(t)]);

  /**
   * Commentaires non lus de l'acteur sur des tableaux QU'IL VOIT (à l'appelant de ne donner que ceux-là) : par carte,
   * par tableau et au total. Les cartes archivées, supprimées et les commentaires importés de Trello ne comptent pas.
   */
  async function nonLus(acteur, tableauIds) {
    const parCarte = new Map();
    const parTableau = new Map();
    let total = 0;
    if (!acteur.compte || !tableauIds.length) return { parCarte, parTableau, total };
    const vus = await lireVus(acteur.compte);
    const lignes = await lignesParIds(
      base,
      "SELECT x.carte_id, x.cree_le, c.tableau_id FROM cm_commentaires x JOIN cm_cartes c ON c.id = x.carte_id WHERE x.supprime_le IS NULL AND x.trello_id IS NULL AND x.cree_le > ? AND COALESCE(x.auteur_id, '') <> ? AND c.supprime_le IS NULL AND c.archive_le IS NULL AND c.tableau_id",
      tableauIds,
      { paramsAvant: [vus.get(CLE_VU_TOUT), acteur.compte] },
    );
    for (const l of lignes) {
      if (l.cree_le <= seuilVu(vus, l.tableau_id, l.carte_id)) continue;
      parCarte.set(l.carte_id, (parCarte.get(l.carte_id) ?? 0) + 1);
      parTableau.set(l.tableau_id, (parTableau.get(l.tableau_id) ?? 0) + 1);
      total++;
    }
    return { parCarte, parTableau, total };
  }

  /** `POST /cm/tableaux/:id/tout-vu` : « Tout marquer comme lu » sur un tableau visible. */
  async function toutVu(acteur, id) {
    const { tableau: tb } = await tableauVisible(acteur, id);
    if (!acteur.compte) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    await lireVus(acteur.compte);
    await base.lot([
      { sql: 'DELETE FROM cm_commentaires_vus WHERE compte_id = ? AND cle IN (SELECT id FROM cm_cartes WHERE tableau_id = ?)', params: [acteur.compte, tb.id] },
      { sql: 'INSERT INTO cm_commentaires_vus (compte_id, cle, vu_le) VALUES (?, ?, ?) ON CONFLICT (compte_id, cle) DO UPDATE SET vu_le = excluded.vu_le', params: [acteur.compte, `t:${tb.id}`, iso(maintenant())] },
    ]);
    return { ok: true };
  }

  /** `POST /cm/cartes/:id/suivre { suivre }` : suivre (ou ne plus suivre) une carte visible : prévenu de ses commentaires. */
  async function suivre(acteur, carteId, corps) {
    const { carte: c } = await carteVisible(acteur, carteId);
    if (!acteur.compte) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    if (corps?.suivre === false) await base.executer('DELETE FROM cm_carte_suivis WHERE carte_id = ? AND compte_id = ?', [c.id, acteur.compte]);
    else await base.executer('INSERT INTO cm_carte_suivis (carte_id, compte_id, cree_le) VALUES (?, ?, ?) ON CONFLICT (carte_id, compte_id) DO NOTHING', [c.id, acteur.compte, iso(maintenant())]);
    return { ok: true, suivie: corps?.suivre !== false };
  }

  async function piecesIds(carteId) {
    return (await base.tous('SELECT id FROM cm_pieces WHERE carte_id = ? AND supprime_le IS NULL', [carteId])).map(l => l.id);
  }

  async function contenuDe(carte, changements = {}) {
    return {
      titre: changements.titre ?? carte.titre,
      reseaux: changements.reseaux ?? jsonOu(carte.reseaux, []),
      textes: changements.textes ?? jsonOu(carte.textes, {}),
      datePublication: changements.datePublication !== undefined ? changements.datePublication : (carte.date_publication ?? null),
      liens: changements.liens ?? jsonOu(carte.liens, {}),
      pieces: changements.pieces ?? (await piecesIds(carte.id)),
    };
  }

  /**
   * Après une modification du contenu d'un post validé : s'il a changé, le post repasse « à valider »
   * (instructions à ajouter au lot, événement compris). Un post publié ne se modifie plus (409).
   */
  async function invalidationSiBesoin(carte, tableau, contenuApres, acteur, t) {
    if (!Number(carte.post)) return [];
    if (carte.statut === 'publie') throw echec(409, 'post-publie', 'Ce post est publié : son contenu ne se modifie plus (dépubliez-le d’abord).');
    if (carte.statut !== 'valide') return [];
    if ((await empreinteContenu(contenuApres)) === carte.empreinte_validee) return [];
    const lot = [
      { sql: "UPDATE cm_cartes SET statut = 'a_valider', valide_par = NULL, valide_le = NULL, empreinte_validee = NULL WHERE id = ? AND statut = 'valide'", params: [carte.id] },
      activite(carte.id, tableau.id, acteur, 'invalidee', {}, t),
      evenement('cm.post_invalide', { teamId: tableau.team_id, acteur, entiteType: 'cm_carte', entiteId: carte.id, charge: { titre: contenuApres.titre, tableau: tableau.id, portee: tableau.portee }, maintenant: t }),
    ];
    const liste = await listeDeCle(base, tableau.id, 'a_valider');
    if (liste && liste.id !== carte.liste_id) lot.push({ sql: 'UPDATE cm_cartes SET liste_id = ?, position = ? WHERE id = ?', params: [liste.id, await positionFin(base, liste.id), carte.id] });
    return lot;
  }

  // ---------------------------------------------------------------- Tableaux

  function tableauPublic(t, noms, extra = {}) {
    return {
      id: t.id,
      nom: t.nom ?? null,
      cleDefaut: t.cle_defaut ?? null,
      portee: t.portee,
      team: t.team_id ? (noms?.get(t.team_id) ?? { id: t.team_id, nom: null }) : null,
      couleur: t.couleur,
      description: t.description,
      version: Number(t.version),
      archive: Boolean(t.archive_le),
      trello: Boolean(t.trello_id),
      // Accès (migration 0046) : 'tous' ou 'restreint' (cadenas dans la liste) ; jamais la liste des personnes ici.
      acces: t.acces === 'restreint' ? 'restreint' : 'tous',
      majLe: t.maj_le,
      fond: fondPublic(t),
      ...extra,
    };
  }

  /** Fond enregistré (JSON) tel que l'app le lit ; l'adresse d'une image est ajoutée par `tableau()`. */
  function fondPublic(t, image) {
    const f = jsonOu(t.fond, null);
    if (f?.genre === 'couleur' && FONDS_COULEURS.includes(f.cle)) return { genre: 'couleur', cle: f.cle };
    if (f?.genre === 'degrade' && FONDS_DEGRADES.includes(f.cle)) return { genre: 'degrade', cle: f.cle };
    if (f?.genre === 'image' && t.fond_fichier_id) return { genre: 'image', ...(image ? { image } : {}) };
    return null;
  }

  /** Lien signé (2 h) vers l'image de fond d'un tableau, si elle existe encore. */
  async function imageFond(t, acteur, origine) {
    if (!t.fond_fichier_id) return undefined;
    const f = await base.premier('SELECT id, type_mime FROM cm_fichiers WHERE id = ? AND supprime_le IS NULL', [t.fond_fichier_id]);
    if (!f || !String(f.type_mime).startsWith('image/')) return undefined;
    const { chemin } = await cheminSigne(cleSession, { fichierId: f.id, compte: acteur.compte, maintenant: maintenant(), duree: DUREE_LIEN_CM_MS, genre: 'cm' });
    return `${origine}${chemin}`;
  }

  /**
   * Fond saisi : `null` (thème), `{ genre: 'couleur' | 'degrade', cle }`, ou une image : `{ genre: 'image', drive }`
   * (fichier du Drive de la portée ou du club, aucun octet copié) ou `{ genre: 'image', envoi }` (image envoyée par
   * morceaux dans la portée). Rend `{ fond, fichierId, instructions }`. Jamais de SVG (formats d'image reconnus).
   */
  async function lireFond(acteur, ctx, tb, v) {
    if (v === null) return { fond: null, fichierId: null, instructions: [] };
    if (typeof v !== 'object' || Array.isArray(v)) throw echec(400, 'fond', 'Fond illisible.');
    if (v.genre === 'couleur' || v.genre === 'degrade') {
      if (!(v.genre === 'couleur' ? FONDS_COULEURS : FONDS_DEGRADES).includes(v.cle)) throw echec(400, 'fond', 'Fond inconnu.');
      return { fond: { genre: v.genre, cle: v.cle }, fichierId: null, instructions: [] };
    }
    if (v.genre !== 'image') throw echec(400, 'fond', 'Fond illisible.');
    if (v.drive !== undefined) {
      if (!drive) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché sur le serveur Esport.');
      const f = await drive.fichierPourIntegration(acteur, v.drive, { portees: [tb.portee, PORTEE_CLUB] });
      if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(String(f.type))) throw echec(400, 'fond-image', 'Le fond doit être une image (PNG, JPEG, WebP, GIF).');
      return { fond: { genre: 'image' }, fichierId: f.fichierId, instructions: [] };
    }
    if (v.envoi !== undefined) {
      if (!medias) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché sur le serveur Esport.');
      const r = await medias.preparerRattachement({ acteur: ctx.acteur, team: { id: teamDePortee(tb.portee) }, portee: tb.portee }, v.envoi, 'cm', { entiteType: 'cm_tableau', entiteId: tb.id });
      const mime = String(r.instructions[0]?.params?.[4] ?? '');
      if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(mime)) throw echec(400, 'fond-image', 'Le fond doit être une image (PNG, JPEG, WebP, GIF).');
      return { fond: { genre: 'image' }, fichierId: r.fichierId, instructions: r.instructions };
    }
    throw echec(400, 'fond', 'Fond illisible.');
  }

  /** `GET /cm/tableaux` : tableaux visibles (le tableau « Contenus » du club est créé au premier passage). */
  async function tableaux(acteur, { archives = false } = {}) {
    const portees = await porteesDe(base, acteur);
    const visibles = [...(portees.club.has('cm.voir') ? [PORTEE_CLUB] : []), ...[...portees.teams].filter(([, s]) => s.has('cm.voir')).map(([id]) => id)];
    if (portees.club.has('cm.voir')) await assurerTableauDefaut(base, PORTEE_CLUB, maintenant());
    // Tableaux restreints : seulement ceux dont l'acteur est (migration 0046).
    const lignes = await lecteurTableaux(base, acteur).filtrer((await lignesParIds(base, 'SELECT * FROM cm_tableaux WHERE supprime_le IS NULL AND portee', visibles)).filter(t => archives || !t.archive_le));
    const comptes = new Map(
      (await lignesParIds(base, 'SELECT tableau_id, COUNT(*) AS n FROM cm_cartes WHERE supprime_le IS NULL AND archive_le IS NULL AND tableau_id', lignes.map(t => t.id), { apres: 'GROUP BY tableau_id' })).map(l => [l.tableau_id, Number(l.n)]),
    );
    const aValider = new Map(
      (await lignesParIds(base, "SELECT tableau_id, COUNT(*) AS n FROM cm_cartes WHERE supprime_le IS NULL AND statut = 'a_valider' AND tableau_id", lignes.map(t => t.id), { apres: 'GROUP BY tableau_id' })).map(l => [l.tableau_id, Number(l.n)]),
    );
    const non = await nonLus(acteur, lignes.filter(t => !t.archive_le).map(t => t.id));
    lignes.sort((a, b) => (a.portee === PORTEE_CLUB ? 0 : 1) - (b.portee === PORTEE_CLUB ? 0 : 1) || (a.cle_defaut ? 0 : 1) - (b.cle_defaut ? 0 : 1) || Number(a.position) - Number(b.position) || String(a.cree_le).localeCompare(String(b.cree_le)));
    return {
      tableaux: lignes.map(t => tableauPublic(t, portees.noms, { cartes: comptes.get(t.id) ?? 0, aValider: aValider.get(t.id) ?? 0, nonLus: non.parTableau.get(t.id) ?? 0, droits: droitsDe({ permissions: permissionsAuNiveau(permissionsSur(portees, t.portee), t.niveau) }) })),
      nonLus: non.total,
      portees: [
        ...(portees.club.size ? [{ portee: PORTEE_CLUB, team: null, permissions: [...portees.club].sort() }] : []),
        ...[...portees.teams].map(([id, s]) => ({ portee: id, team: portees.noms.get(id), permissions: [...s].sort() })),
      ],
    };
  }

  async function creerTableau(acteur, corps) {
    const portee = lirePortee(corps?.portee ?? PORTEE_CLUB);
    const ctx = await contexteCm(base, acteur, portee);
    exiger(ctx, 'cm.gerer');
    const nom = nomListe(corps?.nom);
    const n = await base.premier('SELECT COUNT(*) AS n FROM cm_tableaux WHERE supprime_le IS NULL', []);
    if (Number(n?.n ?? 0) >= MAX_TABLEAUX) throw echec(409, 'trop-de-tableaux', `${MAX_TABLEAUX} tableaux au plus.`);
    const t = maintenant();
    const id = nouvelId();
    const lot = [
      {
        sql: 'INSERT INTO cm_tableaux (id, portee, team_id, nom, description, couleur, position, version, cree_par, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
        params: [id, portee, teamDePortee(portee), nom, texteLong(corps?.description, 1000), lireCouleur(corps?.couleur), t, acteur.compte, iso(t), iso(t)],
      },
      evenement('cm.tableau_cree', { teamId: teamDePortee(portee), acteur: acteur.compte, entiteType: 'cm_tableau', entiteId: id, charge: { nom, portee }, maintenant: t }),
    ];
    if (corps?.modele === 'contenus') {
      LISTES_DEFAUT.forEach((cle, i) => lot.push({ sql: 'INSERT INTO cm_listes (id, tableau_id, nom, cle, position, cree_le, maj_le) VALUES (?, ?, NULL, ?, ?, ?, ?)', params: [nouvelId(), id, cle, (i + 1) * 1024, iso(t), iso(t)] }));
    }
    await base.lot(lot);
    return tableau(acteur, id);
  }

  async function modifierTableau(acteur, id, corps, { origine = '' } = {}) {
    const { tableau: tb, ctx } = await tableauVisible(acteur, id);
    // Le fond seul se change avec cm.editer (comme sur Trello, qui prépare le tableau le décore) ; le reste : cm.gerer.
    const seulFond = corps && typeof corps === 'object' && Object.keys(corps).every(k => k === 'fond');
    exiger(ctx, seulFond ? 'cm.editer' : 'cm.gerer');
    const champs = [];
    const valeurs = [];
    const avant = [];
    let ancienFichier = null;
    if (corps?.fond !== undefined) {
      const f = await lireFond(acteur, ctx, tb, corps.fond);
      champs.push('fond', 'fond_fichier_id');
      valeurs.push(f.fond ? JSON.stringify(f.fond) : null, f.fichierId);
      avant.push(...f.instructions);
      if (tb.fond_fichier_id && tb.fond_fichier_id !== f.fichierId) ancienFichier = tb.fond_fichier_id;
    }
    if (corps?.nom !== undefined) {
      champs.push('nom');
      valeurs.push(corps.nom === null && tb.cle_defaut ? null : nomListe(corps.nom));
    }
    if (corps?.description !== undefined) {
      champs.push('description');
      valeurs.push(texteLong(corps.description, 1000));
    }
    if (corps?.couleur !== undefined) {
      champs.push('couleur');
      valeurs.push(lireCouleur(corps.couleur));
    }
    if (corps?.archive !== undefined) {
      if (tb.cle_defaut && corps.archive) throw echec(409, 'tableau-defaut', 'Le tableau par défaut ne s’archive pas.');
      champs.push('archive_le');
      valeurs.push(corps.archive ? iso(maintenant()) : null);
    }
    if (champs.length) {
      const t = maintenant();
      await base.lot([
        ...avant,
        { sql: `UPDATE cm_tableaux SET ${champs.map(c => `${c} = ?`).join(', ')}, version = version + 1, maj_le = ? WHERE id = ?`, params: [...valeurs, iso(t), id] },
        evenement('cm.tableau_modifie', { teamId: tb.team_id, acteur: acteur.compte, entiteType: 'cm_tableau', entiteId: id, charge: { champs: champs.filter(c => c !== 'fond_fichier_id') }, maintenant: t }),
      ]);
      // Ancienne image de fond : ses octets partent s'il ne sert plus à rien (Drive, pièce jointe…).
      if (ancienFichier) await effacerFichierSiOrphelin(ancienFichier, t);
    }
    return tableau(acteur, id, { origine });
  }

  async function supprimerTableau(acteur, id) {
    const { tableau: tb, ctx } = await tableauVisible(acteur, id);
    exiger(ctx, 'cm.gerer');
    if (tb.cle_defaut) throw echec(409, 'tableau-defaut', 'Le tableau par défaut ne se supprime pas.');
    const t = maintenant();
    await base.lot([
      { sql: "DELETE FROM cm_lien_liaisons WHERE genre = 'carte' AND cible_id IN (SELECT id FROM cm_cartes WHERE tableau_id = ?)", params: [id] },
      { sql: 'UPDATE cm_tableaux SET supprime_le = ?, version = version + 1, maj_le = ? WHERE id = ?', params: [iso(t), iso(t), id] },
      evenement('cm.tableau_supprime', { teamId: tb.team_id, acteur: acteur.compte, entiteType: 'cm_tableau', entiteId: id, charge: { nom: tb.nom ?? null }, maintenant: t }),
    ]);
    return { ok: true };
  }

  /**
   * `GET /cm/tableaux/:id` : le tableau, ses listes, étiquettes et cartes (résumées : compteurs, sans
   * description ni commentaires). Sept requêtes quelle que soit la taille du tableau.
   */
  async function tableau(acteur, id, { archives = false, origine = '' } = {}) {
    const { tableau: tb, ctx } = await tableauVisible(acteur, id);
    const noms = tb.team_id ? new Map([[tb.team_id, { id: tb.team_id, nom: ctx.team?.nom ?? null, slug: ctx.team?.slug ?? null, logoUrl: ctx.team?.logo_url ?? null }]]) : new Map();
    const listes = await base.tous(`SELECT * FROM cm_listes WHERE tableau_id = ? ${archives ? '' : 'AND archive_le IS NULL'} ORDER BY position, cree_le`, [id]);
    const etiquettes = await base.tous('SELECT * FROM cm_etiquettes WHERE tableau_id = ? ORDER BY position, nom, id', [id]);
    const cartes = await base.tous(
      `SELECT id, liste_id, team_id, titre, CASE WHEN description = '' THEN 0 ELSE 1 END AS a_desc, position, couverture, echeance, echeance_faite, date_publication, post, statut, reseaux, origine, depot_genre, archive_le, version, cree_par, maj_le
         FROM cm_cartes WHERE tableau_id = ? AND supprime_le IS NULL ${archives ? '' : 'AND archive_le IS NULL'} ORDER BY position, cree_le LIMIT ?`,
      [id, MAX_CARTES_TABLEAU],
    );
    const joint = sql => base.tous(sql, [id]);
    const parCarte = (lignes, f) => {
      const m = new Map();
      for (const l of lignes) {
        if (!m.has(l.carte_id)) m.set(l.carte_id, []);
        m.get(l.carte_id).push(f(l));
      }
      return m;
    };
    const etiq = parCarte(await joint('SELECT ce.carte_id, ce.etiquette_id FROM cm_carte_etiquettes ce JOIN cm_cartes c ON c.id = ce.carte_id JOIN cm_etiquettes e ON e.id = ce.etiquette_id WHERE c.tableau_id = ? AND c.supprime_le IS NULL ORDER BY e.position, e.nom, e.id'), l => l.etiquette_id);
    // Cartes (archivées comprises) portant chaque étiquette : annoncé avant une suppression définitive.
    const nbParEtiquette = new Map();
    for (const liste of etiq.values()) for (const eid of liste) nbParEtiquette.set(eid, (nbParEtiquette.get(eid) ?? 0) + 1);
    const memb = parCarte(await joint('SELECT cm.carte_id, cm.compte_id FROM cm_carte_membres cm JOIN cm_cartes c ON c.id = cm.carte_id WHERE c.tableau_id = ? AND c.supprime_le IS NULL'), l => l.compte_id);
    const com = new Map((await joint('SELECT co.carte_id, COUNT(*) AS n FROM cm_commentaires co JOIN cm_cartes c ON c.id = co.carte_id WHERE c.tableau_id = ? AND co.supprime_le IS NULL GROUP BY co.carte_id')).map(l => [l.carte_id, Number(l.n)]));
    const chk = new Map((await joint('SELECT e.carte_id, COUNT(*) AS total, SUM(e.fait) AS faits FROM cm_checklist_elements e JOIN cm_cartes c ON c.id = e.carte_id WHERE c.tableau_id = ? GROUP BY e.carte_id')).map(l => [l.carte_id, { total: Number(l.total), faits: Number(l.faits ?? 0) }]));
    const pieces = await joint('SELECT p.id, p.carte_id, p.genre, p.fichier_id FROM cm_pieces p JOIN cm_cartes c ON c.id = p.carte_id WHERE c.tableau_id = ? AND p.supprime_le IS NULL');
    const nbPieces = new Map();
    for (const p of pieces) nbPieces.set(p.carte_id, (nbPieces.get(p.carte_id) ?? 0) + 1);
    // Couvertures images : lien signé (2 h) vers le fichier de la pièce choisie.
    const couvertures = new Map();
    const fichiersCouv = new Map();
    for (const c of cartes) {
      const couv = jsonOu(c.couverture, null);
      if (couv?.pieceId) {
        const p = pieces.find(x => x.id === couv.pieceId && x.carte_id === c.id && x.genre === 'fichier');
        if (p?.fichier_id) fichiersCouv.set(c.id, p.fichier_id);
      }
    }
    const fichiers = new Map((await lignesParIds(base, 'SELECT id, type_mime, supprime_le FROM cm_fichiers WHERE id', [...fichiersCouv.values()])).map(f => [f.id, f]));
    for (const [carteId, fid] of fichiersCouv) {
      const f = fichiers.get(fid);
      if (!f || f.supprime_le || !String(f.type_mime).startsWith('image/')) continue;
      const { chemin } = await cheminSigne(cleSession, { fichierId: fid, compte: acteur.compte, maintenant: maintenant(), duree: DUREE_LIEN_CM_MS, genre: 'cm' });
      couvertures.set(carteId, `${origine}${chemin}`);
    }
    const pseudos = await pseudosDe(base, [...new Set(cartes.flatMap(c => memb.get(c.id) ?? []))]);
    const non = await nonLus(acteur, [tb.id]);
    return {
      nonLus: non.total,
      tableau: tableauPublic(tb, noms, { fond: fondPublic(tb, await imageFond(tb, acteur, origine)) }),
      droits: { ...droitsDe(ctx), acces: peutGererAcces(ctx, tb) },
      moi: acteur.compte,
      listes: listes.map(l => ({ id: l.id, nom: l.nom ?? null, cle: l.cle ?? null, position: Number(l.position), archive: Boolean(l.archive_le) })),
      etiquettes: etiquettes.map(e => ({ id: e.id, nom: e.nom, couleur: e.couleur, cartes: nbParEtiquette.get(e.id) ?? 0 })),
      cartes: cartes.map(c => {
        const couv = jsonOu(c.couverture, null);
        return {
          id: c.id,
          listeId: c.liste_id,
          teamId: c.team_id ?? null,
          titre: c.titre,
          description: Number(c.a_desc) === 1,
          position: Number(c.position),
          couverture: couv?.couleur ? { couleur: couv.couleur } : couvertures.has(c.id) ? { image: couvertures.get(c.id) } : null,
          echeance: c.echeance ?? null,
          echeanceFaite: Number(c.echeance_faite) === 1,
          datePublication: c.date_publication ?? null,
          post: Number(c.post) === 1,
          statut: c.statut ?? null,
          reseaux: jsonOu(c.reseaux, []),
          origine: c.origine,
          depotGenre: c.depot_genre ?? null,
          etiquettes: etiq.get(c.id) ?? [],
          membres: memb.get(c.id) ?? [],
          commentaires: com.get(c.id) ?? 0,
          nonLus: non.parCarte.get(c.id) ?? 0,
          checklist: chk.get(c.id) ?? { total: 0, faits: 0 },
          pieces: nbPieces.get(c.id) ?? 0,
          archive: Boolean(c.archive_le),
          version: Number(c.version),
          modifiable: peutModifierCarte(ctx, c),
        };
      }),
      noms: pseudos,
      personnes: await personnesTableau(tb),
    };
  }

  // ---------------------------------------------------------------- Accès au tableau (migration 0046)

  /** Rôles proposés : rôles CM, rôles du club, rôles de la team du tableau (tableau du club : des teams au module CM). */
  async function rolesProposes(tb) {
    const rolesCm = await base.tous('SELECT id, nom, couleur FROM cm_roles ORDER BY position, nom, id', []);
    const rolesClub = await base.tous('SELECT id, nom, couleur FROM roles_globaux ORDER BY position, nom, id', []);
    const condition = tb.team_id ? 'AND r.team_id = ?' : 'AND EXISTS (SELECT 1 FROM team_modules m WHERE m.team_id = t.id AND m.module = ? AND m.active = 1)';
    const rolesTeam = await base.tous(
      `SELECT r.id, r.nom, r.couleur, r.team_id, t.nom AS team_nom FROM roles r JOIN teams t ON t.id = r.team_id
        WHERE t.supprimee_le IS NULL ${condition}
        ORDER BY t.nom, r.position, r.nom, r.id`,
      [tb.team_id ?? 'cm'],
    );
    return {
      rolesCm: rolesCm.map(r => ({ id: r.id, nom: r.nom, couleur: r.couleur })),
      rolesClub: rolesClub.map(r => ({ id: r.id, nom: r.nom, couleur: r.couleur })),
      rolesTeam: rolesTeam.map(r => ({ id: r.id, nom: r.nom, couleur: r.couleur, team: { id: r.team_id, nom: r.team_nom } })),
    };
  }

  /** Comptes qui peuvent régler l'accès (hors Fondateur) parmi `niveaux` : niveau « modifier », et cm.gerer ou créateur. */
  async function gestionnairesParmi(tb, niveaux, personnes) {
    const sortie = [];
    for (const [compte, niveau] of niveaux) {
      if (niveau !== 'modifier' || !personnes.has(compte)) continue;
      if (tb.cree_par && compte === tb.cree_par) {
        sortie.push(compte);
        continue;
      }
      try {
        if ((await contexteCm(base, { compte, superAdmin: false }, tb.portee)).permissions.has('cm.gerer')) sortie.push(compte);
      } catch {
        // Plus d'accès à la portée.
      }
    }
    return sortie;
  }

  /** `GET /cm/tableaux/:id/acces` : réglage d'accès (cm.gerer ou créateur du tableau ; 403 sinon). */
  async function accesTableau(acteur, id) {
    const { tableau: tb, ctx } = await tableauVisible(acteur, id);
    if (!peutGererAcces(ctx, tb)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const regles = await base.tous('SELECT genre, cible, niveau FROM cm_tableau_acces WHERE tableau_id = ? ORDER BY genre, cible', [tb.id]);
    const personnes = await personnesTableau(tb, { portee: true });
    const options = await rolesProposes(tb);
    const niveaux = estRestreint(tb) ? await niveauxTableau(base, tb) : null;
    const pseudos = new Map(personnes.map(p => [p.compte, p.pseudo]));
    const noms = new Map([...options.rolesCm.map(r => [`role_cm|${r.id}`, r.nom]), ...options.rolesClub.map(r => [`role_club|${r.id}`, r.nom]), ...options.rolesTeam.map(r => [`role_team|${r.id}`, r.team?.nom ? `${r.nom} (${r.team.nom})` : r.nom])]);
    return {
      tableau: { id: tb.id, nom: tb.nom ?? null, cleDefaut: tb.cle_defaut ?? null, portee: tb.portee, creePar: tb.cree_par ?? null },
      acces: estRestreint(tb) ? 'restreint' : 'tous',
      // Règles dont la cible existe encore (personne qui a toujours accès au CM de la portée, rôle non supprimé).
      regles: regles.filter(r => (r.genre === 'compte' ? pseudos.has(r.cible) : noms.has(`${r.genre}|${r.cible}`))).map(r => ({ genre: r.genre, cible: r.cible, niveau: r.niveau, nom: r.genre === 'compte' ? (pseudos.get(r.cible) ?? null) : (noms.get(`${r.genre}|${r.cible}`) ?? null) })),
      // Qui voit le tableau aujourd'hui (restreint) : personnes de la portée retenues par les règles, et le Fondateur.
      effectifs: niveaux ? personnes.filter(p => p.compte === 'principal' || niveaux.has(p.compte)).map(p => ({ ...p, niveau: p.compte === 'principal' ? 'modifier' : niveaux.get(p.compte) })) : null,
      options: { personnes, ...options },
      moi: acteur.compte,
    };
  }

  /**
   * `PUT /cm/tableaux/:id/acces { acces: 'tous' | 'restreint', regles: [{ genre, cible, niveau }] }`. Garde-fous : le
   * tableau par défaut reste ouvert ; un tableau restreint garde au moins une personne (hors Fondateur) qui peut le
   * gérer (niveau « modifier » avec cm.gerer, ou son créateur) ; hors Fondateur, on ne se retire pas soi-même.
   */
  async function changerAcces(acteur, id, corps) {
    const { tableau: tb, ctx } = await tableauVisible(acteur, id);
    if (!peutGererAcces(ctx, tb)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const acces = corps?.acces;
    if (!ACCES_TABLEAU.includes(acces)) throw echec(400, 'acces', 'Accès : tous ou restreint.');
    if (acces === 'restreint' && tb.cle_defaut) throw echec(409, 'tableau-defaut', 'Le tableau par défaut reste ouvert à tous ceux qui ont accès au CM.');
    const brutes = corps?.regles ?? [];
    if (!Array.isArray(brutes) || brutes.length > MAX_REGLES_ACCES) throw echec(400, 'regles', `${MAX_REGLES_ACCES} personnes ou rôles au plus.`);
    const vues = new Map();
    for (const r of brutes) {
      if (!r || typeof r !== 'object' || !GENRES_ACCES.includes(r.genre) || typeof r.cible !== 'string' || !r.cible || r.cible.length > 64 || !NIVEAUX_ACCES.includes(r.niveau ?? 'voir')) throw echec(400, 'regles', 'Personnes ou rôles illisibles.');
      vues.set(`${r.genre}|${r.cible}`, { genre: r.genre, cible: r.cible, niveau: r.niveau ?? 'voir' });
    }
    const regles = [...vues.values()];
    const personnes = await personnesTableau(tb, { portee: true });
    const comptes = new Set(personnes.map(p => p.compte));
    const options = await rolesProposes(tb);
    const ids = { role_cm: new Set(options.rolesCm.map(r => r.id)), role_club: new Set(options.rolesClub.map(r => r.id)), role_team: new Set(options.rolesTeam.map(r => r.id)) };
    for (const r of regles) {
      if (r.genre === 'compte' ? !comptes.has(r.cible) : !ids[r.genre].has(r.cible)) throw echec(400, 'regle-inconnue', r.genre === 'compte' ? 'Cette personne n’a pas accès au CM de ce tableau.' : 'Rôle inconnu.');
    }
    if (acces === 'restreint') {
      const niveaux = await niveauxTableau(base, tb, regles);
      if (!(await gestionnairesParmi(tb, niveaux, comptes)).length) throw echec(409, 'acces-sans-gestionnaire', 'Gardez au moins une personne qui peut gérer ce tableau (niveau « peut modifier » avec la gestion du CM, ou son créateur).');
      if (!acteur.superAdmin && niveaux.get(acteur.compte) !== 'modifier') throw echec(409, 'acces-soi-meme', 'Vous ne pouvez pas vous retirer l’accès « peut modifier » à ce tableau.');
    }
    const t = maintenant();
    await base.lot([
      { sql: 'DELETE FROM cm_tableau_acces WHERE tableau_id = ?', params: [tb.id] },
      ...regles.map(r => ({ sql: 'INSERT INTO cm_tableau_acces (tableau_id, genre, cible, niveau, ajoute_par, ajoute_le) VALUES (?, ?, ?, ?, ?, ?)', params: [tb.id, r.genre, r.cible, r.niveau, acteur.compte, iso(t)] })),
      { sql: 'UPDATE cm_tableaux SET acces = ?, version = version + 1, maj_le = ? WHERE id = ?', params: [acces, iso(t), tb.id] },
      evenement('cm.tableau_acces', { teamId: tb.team_id, acteur: acteur.compte, entiteType: 'cm_tableau', entiteId: tb.id, charge: { acces, regles: regles.length, tableau: tb.id }, maintenant: t }),
    ]);
    // Le Fondateur peut s'être retiré des règles : il voit toujours tout, la relecture passe.
    return accesTableau(acteur, id);
  }

  // ---------------------------------------------------------------- Préférences d'affichage (par compte)

  /** `GET /cm/preferences` : choix d'affichage du compte (colonnes réduites, calendriers des teams). */
  async function preferences(acteur) {
    const lignes = await base.tous('SELECT cle, valeur FROM cm_preferences WHERE compte_id = ?', [acteur.compte]);
    return { preferences: Object.fromEntries(lignes.map(l => [l.cle, jsonOu(l.valeur, null)])) };
  }

  /** `PUT /cm/preferences/:cle { valeur }` : un choix d'affichage (JSON de 4 000 caractères au plus ; null l'efface). */
  async function changerPreference(acteur, cle, corps) {
    if (!acteur.compte || !CLE_PREFERENCE.test(String(cle))) throw echec(400, 'preference', 'Préférence inconnue.');
    const portees = await porteesDe(base, acteur);
    if (!portees.club.has('cm.voir') && ![...portees.teams.values()].some(x => x.has('cm.voir'))) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const valeur = corps?.valeur;
    if (valeur === null || valeur === undefined) {
      await base.executer('DELETE FROM cm_preferences WHERE compte_id = ? AND cle = ?', [acteur.compte, cle]);
      return { ok: true };
    }
    const texte = JSON.stringify(valeur);
    if (texte.length > PREFERENCE_MAX) throw echec(400, 'preference', 'Préférence trop longue.');
    if (cle.endsWith('.reduites') && !(Array.isArray(valeur) && valeur.length <= 100 && valeur.every(x => typeof x === 'string' && MOTIF_UUID.test(x)))) throw echec(400, 'preference', 'Préférence illisible.');
    if (cle === 'calendrier.teams' && !(valeur && typeof valeur === 'object' && !Array.isArray(valeur) && Object.entries(valeur).every(([k, v]) => MOTIF_UUID.test(k) && typeof v === 'boolean'))) throw echec(400, 'preference', 'Préférence illisible.');
    const t = iso(maintenant());
    await base.executer('INSERT INTO cm_preferences (compte_id, cle, valeur, maj_le) VALUES (?, ?, ?, ?) ON CONFLICT (compte_id, cle) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le', [acteur.compte, cle, texte, t]);
    return { ok: true };
  }

  // ---------------------------------------------------------------- Listes

  async function creerListe(acteur, tableauId, corps) {
    const { tableau: tb, ctx } = await tableauVisible(acteur, tableauId);
    exiger(ctx, 'cm.editer');
    const n = await base.premier('SELECT COUNT(*) AS n, MAX(position) AS p FROM cm_listes WHERE tableau_id = ?', [tb.id]);
    if (Number(n?.n ?? 0) >= MAX_LISTES) throw echec(409, 'trop-de-listes', `${MAX_LISTES} listes au plus.`);
    const t = maintenant();
    const id = nouvelId();
    await base.lot([
      { sql: 'INSERT INTO cm_listes (id, tableau_id, nom, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?)', params: [id, tb.id, nomListe(corps?.nom), n?.p === null || n?.p === undefined ? 1024 : Number(n.p) + 1024, iso(t), iso(t)] },
      versionTableau(tb.id, t),
    ]);
    return { id };
  }

  async function listeVisible(acteur, listeId) {
    exigerUuid(listeId, 'liste');
    const l = await base.premier('SELECT * FROM cm_listes WHERE id = ?', [listeId]);
    if (!l) throw echec(404, 'liste-introuvable', 'Liste introuvable.');
    const { tableau: tb, ctx } = await tableauVisible(acteur, l.tableau_id);
    return { liste: l, tableau: tb, ctx };
  }

  async function modifierListe(acteur, listeId, corps) {
    const { liste, tableau: tb, ctx } = await listeVisible(acteur, listeId);
    exiger(ctx, 'cm.editer');
    const champs = [];
    const valeurs = [];
    if (corps?.nom !== undefined) {
      champs.push('nom');
      valeurs.push(corps.nom === null && liste.cle ? null : nomListe(corps.nom));
    }
    if (corps?.archive !== undefined) {
      champs.push('archive_le');
      valeurs.push(corps.archive ? iso(maintenant()) : null);
    }
    if (!champs.length) return { ok: true };
    const t = maintenant();
    await base.lot([{ sql: `UPDATE cm_listes SET ${champs.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ?`, params: [...valeurs, iso(t), liste.id] }, versionTableau(tb.id, t)]);
    return { ok: true };
  }

  async function deplacerListe(acteur, listeId, corps) {
    const { liste, tableau: tb, ctx } = await listeVisible(acteur, listeId);
    exiger(ctx, 'cm.editer');
    const autres = (await base.tous('SELECT id, position FROM cm_listes WHERE tableau_id = ? AND archive_le IS NULL AND id <> ? ORDER BY position, cree_le', [tb.id, liste.id])).map(l => ({ id: l.id, position: Number(l.position) }));
    const index = Math.max(0, Math.min(autres.length, Number.isInteger(corps?.index) ? corps.index : autres.length));
    const t = maintenant();
    await base.lot([...instructionsPosition('cm_listes', liste.id, autres, index, t), versionTableau(tb.id, t)]);
    return { ok: true };
  }

  /**
   * Position d'un élément inséré à `index` parmi `autres` (triés) ; renumérote si l'écart est trop petit.
   * `valeurs` : autres colonnes de l'élément déplacé (noms fixés par le code : liste_id, tableau_id, team_id).
   */
  function instructionsPosition(table, id, autres, index, t, valeurs = {}) {
    const avant = index > 0 ? autres[index - 1].position : null;
    const apres = index < autres.length ? autres[index].position : null;
    const colonnes = Object.keys(valeurs);
    const extra = colonnes.map(c => `, ${c} = ?`).join('');
    const deplace = position => ({ sql: `UPDATE ${table} SET position = ?${extra}, maj_le = ? WHERE id = ?`, params: [position, ...colonnes.map(c => valeurs[c]), iso(t), id] });
    if (avant !== null && apres !== null && apres - avant < ECART_MIN) {
      const ordre = [...autres.slice(0, index).map(a => a.id), id, ...autres.slice(index).map(a => a.id)];
      return ordre.map((x, i) => (x === id ? deplace((i + 1) * 1024) : { sql: `UPDATE ${table} SET position = ?, maj_le = ? WHERE id = ?`, params: [(i + 1) * 1024, iso(t), x] }));
    }
    return [deplace(positionEntre(avant, apres))];
  }

  // ---------------------------------------------------------------- Étiquettes

  async function creerEtiquette(acteur, tableauId, corps) {
    const { tableau: tb, ctx } = await tableauVisible(acteur, tableauId);
    exiger(ctx, 'cm.editer');
    const n = await base.premier('SELECT COUNT(*) AS n FROM cm_etiquettes WHERE tableau_id = ?', [tb.id]);
    if (Number(n?.n ?? 0) >= MAX_ETIQUETTES) throw echec(409, 'trop-d-etiquettes', `${MAX_ETIQUETTES} étiquettes au plus.`);
    const t = maintenant();
    const id = nouvelId();
    await base.lot([
      { sql: 'INSERT INTO cm_etiquettes (id, tableau_id, nom, couleur, position) VALUES (?, ?, ?, ?, ?)', params: [id, tb.id, texteNettoye(corps?.nom, 40), lireCouleur(corps?.couleur, '#579dff'), Number(n?.n ?? 0)] },
      versionTableau(tb.id, t),
    ]);
    return { id };
  }

  /** Étiquette et tableau visibles ; `permission` : `cm.editer` (modifier) ou `cm.gerer` (supprimer, fusionner). */
  async function etiquetteVisible(acteur, id, permission = 'cm.editer') {
    exigerUuid(id, 'etiquette');
    const e = await base.premier('SELECT * FROM cm_etiquettes WHERE id = ?', [id]);
    if (!e) throw echec(404, 'etiquette-introuvable', 'Étiquette introuvable.');
    const { tableau: tb, ctx } = await tableauVisible(acteur, e.tableau_id);
    exiger(ctx, permission);
    return { e, tb };
  }

  const nbCartesEtiquette = async id => Number((await base.premier('SELECT COUNT(*) AS n FROM cm_carte_etiquettes ce JOIN cm_cartes c ON c.id = ce.carte_id WHERE ce.etiquette_id = ? AND c.supprime_le IS NULL', [id]))?.n ?? 0);

  const retirerTrello = (tableauId, e) => (e.trello_id ? [{ sql: 'INSERT INTO cm_etiquettes_retirees (tableau_id, trello_id) VALUES (?, ?) ON CONFLICT DO NOTHING', params: [tableauId, e.trello_id] }] : []);

  /** Renomme et/ou recolore (cm.editer) : visible partout (tableau, filtres, fiches) car les cartes ne portent que l'identifiant. */
  async function modifierEtiquette(acteur, id, corps) {
    const { e, tb } = await etiquetteVisible(acteur, id);
    const t = maintenant();
    const nom = corps?.nom !== undefined ? texteNettoye(corps.nom, 40) : e.nom;
    const couleur = corps?.couleur !== undefined ? lireCouleur(corps.couleur) : e.couleur;
    if (nom === e.nom && couleur === e.couleur) return { ok: true };
    await base.lot([
      { sql: 'UPDATE cm_etiquettes SET nom = ?, couleur = ?, modifie_le = ? WHERE id = ?', params: [nom, couleur, iso(t), e.id] },
      evenement('cm.etiquette_modifiee', { teamId: tb.team_id, acteur: acteur.compte, entiteType: 'cm_tableau', entiteId: tb.id, charge: { nom: nom || e.nom, ancien: nom !== e.nom ? e.nom : null, couleur: couleur !== e.couleur, tableau: tb.id }, maintenant: t }),
      versionTableau(tb.id, t),
    ]);
    return { ok: true };
  }

  /** `PUT /cm/tableaux/:id/etiquettes/ordre { ids }` (cm.editer) : nouvel ordre ; les étiquettes non citées suivent. */
  async function ordonnerEtiquettes(acteur, tableauId, corps) {
    const { tableau: tb, ctx } = await tableauVisible(acteur, tableauId);
    exiger(ctx, 'cm.editer');
    if (!Array.isArray(corps?.ids) || corps.ids.length > MAX_ETIQUETTES || corps.ids.some(x => typeof x !== 'string' || !MOTIF_UUID.test(x))) throw echec(400, 'etiquettes', 'Étiquettes illisibles.');
    const existantes = (await base.tous('SELECT id FROM cm_etiquettes WHERE tableau_id = ? ORDER BY position, nom, id', [tb.id])).map(l => l.id);
    const connues = new Set(existantes);
    const choisies = [...new Set(corps.ids)].filter(x => connues.has(x));
    const ordre = [...choisies, ...existantes.filter(x => !choisies.includes(x))];
    await base.lot([...ordre.map((x, i) => ({ sql: 'UPDATE cm_etiquettes SET position = ? WHERE id = ?', params: [i, x] })), versionTableau(tb.id, maintenant())]);
    return { ok: true };
  }

  /**
   * Suppression DÉFINITIVE (cm.gerer, pas de corbeille) : l'étiquette est retirée de toutes les cartes du
   * tableau, archivées comprises. Rend le nombre de cartes concernées.
   */
  async function supprimerEtiquette(acteur, id) {
    const { e, tb } = await etiquetteVisible(acteur, id, 'cm.gerer');
    const t = maintenant();
    const cartes = await nbCartesEtiquette(e.id);
    await base.lot([
      { sql: 'DELETE FROM cm_carte_etiquettes WHERE etiquette_id = ?', params: [e.id] },
      { sql: 'DELETE FROM cm_etiquettes WHERE id = ?', params: [e.id] },
      ...retirerTrello(tb.id, e),
      evenement('cm.etiquette_supprimee', { teamId: tb.team_id, acteur: acteur.compte, entiteType: 'cm_tableau', entiteId: tb.id, charge: { nom: e.nom, cartes, tableau: tb.id }, maintenant: t }),
      versionTableau(tb.id, t),
    ]);
    return { ok: true, cartes };
  }

  /** `POST /cm/etiquettes/:id/fusionner { vers }` (cm.gerer) : les cartes de l'étiquette passent à `vers`, puis elle est supprimée. */
  async function fusionnerEtiquettes(acteur, id, corps) {
    const { e, tb } = await etiquetteVisible(acteur, id, 'cm.gerer');
    exigerUuid(corps?.vers, 'etiquette');
    const cible = await base.premier('SELECT * FROM cm_etiquettes WHERE id = ? AND tableau_id = ?', [corps.vers, tb.id]);
    if (!cible) throw echec(404, 'etiquette-introuvable', 'Étiquette introuvable.');
    if (cible.id === e.id) throw echec(400, 'fusion', 'Choisissez une autre étiquette.');
    const t = maintenant();
    const cartes = await nbCartesEtiquette(e.id);
    await base.lot([
      { sql: 'INSERT INTO cm_carte_etiquettes (carte_id, etiquette_id) SELECT carte_id, ? FROM cm_carte_etiquettes WHERE etiquette_id = ? AND carte_id NOT IN (SELECT carte_id FROM cm_carte_etiquettes WHERE etiquette_id = ?)', params: [cible.id, e.id, cible.id] },
      { sql: 'DELETE FROM cm_carte_etiquettes WHERE etiquette_id = ?', params: [e.id] },
      { sql: 'DELETE FROM cm_etiquettes WHERE id = ?', params: [e.id] },
      ...retirerTrello(tb.id, e),
      evenement('cm.etiquette_fusionnee', { teamId: tb.team_id, acteur: acteur.compte, entiteType: 'cm_tableau', entiteId: tb.id, charge: { nom: e.nom, vers: cible.nom, cartes, tableau: tb.id }, maintenant: t }),
      versionTableau(tb.id, t),
    ]);
    return { ok: true, cartes };
  }

  // ---------------------------------------------------------------- Cartes

  async function creerCarte(acteur, tableauId, corps) {
    const { tableau: tb, ctx } = await tableauVisible(acteur, tableauId);
    exiger(ctx, 'cm.editer');
    const liste = await listeDuTableau(tb.id, corps?.listeId);
    const n = await base.premier('SELECT COUNT(*) AS n FROM cm_cartes WHERE tableau_id = ? AND supprime_le IS NULL', [tb.id]);
    if (Number(n?.n ?? 0) >= MAX_CARTES_TABLEAU) throw echec(409, 'trop-de-cartes', `${MAX_CARTES_TABLEAU} cartes au plus par tableau.`);
    const t = maintenant();
    const post = corps?.post === true;
    const { id, instructions } = instructionsCarte({
      tableauId: tb.id,
      listeId: liste.id,
      teamId: tb.team_id ?? (await teamLiee(corps?.teamId)),
      titre: lireTitre(corps?.titre),
      description: nettoyerNote(corps?.description ?? '', NOTE_MAX),
      position: corps?.enHaut ? (await premierePosition(liste.id)) - 1024 : await positionFin(base, liste.id),
      post,
      reseaux: post ? lireReseaux(corps?.reseaux ?? ['x', 'instagram', 'tiktok']) : [],
      textes: post ? lireTextes(corps?.textes) : {},
      liens: await liensVerifies(corps?.liens),
      datePublication: lireInstantCm(corps?.datePublication, ctx.team?.fuseau ?? FUSEAU_CLUB),
      acteur: acteur.compte,
      t,
    });
    await base.lot([...instructions, evenement('cm.carte_creee', { teamId: tb.team_id, acteur: acteur.compte, entiteType: 'cm_carte', entiteId: id, charge: { titre: lireTitre(corps?.titre), tableau: tb.id, post }, maintenant: t })]);
    return carte(acteur, id);
  }

  /**
   * Liens saisis ; un partenaire NOUVELLEMENT mentionné (« mention sponsor ») doit exister (rubrique Sponsors).
   * Celui que la carte mentionnait déjà reste accepté même s'il a été supprimé depuis (la carte se modifie encore).
   */
  async function liensVerifies(v, avant = []) {
    const liens = lireLiens(v);
    if (liens.sponsors) {
      const connus = new Set((await lignesParIds(base, 'SELECT id FROM sp_partenaires WHERE supprime_le IS NULL AND id', liens.sponsors)).map(l => l.id));
      if (liens.sponsors.some(id => !connus.has(id) && !avant.includes(id))) throw echec(400, 'sponsor-inconnu', 'Partenaire inconnu.');
    }
    return liens;
  }

  async function premierePosition(listeId) {
    const l = await base.premier('SELECT MIN(position) AS p FROM cm_cartes WHERE liste_id = ? AND supprime_le IS NULL', [listeId]);
    return l?.p === null || l?.p === undefined ? 1024 : Number(l.p);
  }

  async function teamLiee(v) {
    if (v === undefined || v === null || v === '') return null;
    exigerUuid(v, 'team');
    const t = await base.premier('SELECT id FROM teams WHERE id = ? AND supprimee_le IS NULL', [v]);
    if (!t) throw echec(400, 'team', 'Team inconnue.');
    return t.id;
  }

  const nouveauPour = (x, compte, vuAvant) => Boolean(vuAvant) && !x.trello_id && (x.auteur_id ?? '') !== compte && x.cree_le > vuAvant;

  /** `GET /cm/cartes/:id` : la carte complète (checklists, commentaires, pièces, activité, liens résolus). */
  async function carte(acteur, id, { origine = '', langue = 'fr', vu = false } = {}) {
    const { carte: c, tableau: tb, ctx } = await carteVisible(acteur, id);
    // Commentaires non lus de cette carte AVANT la lecture ; `vu` (ouverture de la fiche) la marque lue pour ce compte.
    const vuAvant = acteur.compte ? seuilVu(await lireVus(acteur.compte), tb.id, c.id) : null;
    if (vu && acteur.compte) await marquerVu(acteur.compte, c.id);
    const suivie = acteur.compte ? Boolean(await base.premier('SELECT carte_id FROM cm_carte_suivis WHERE carte_id = ? AND compte_id = ?', [c.id, acteur.compte])) : false;
    const etiquettes = (await base.tous('SELECT ce.etiquette_id FROM cm_carte_etiquettes ce JOIN cm_etiquettes e ON e.id = ce.etiquette_id WHERE ce.carte_id = ? ORDER BY e.position, e.nom, e.id', [c.id])).map(l => l.etiquette_id);
    const membres = (await base.tous('SELECT compte_id FROM cm_carte_membres WHERE carte_id = ?', [c.id])).map(l => l.compte_id);
    const checklists = await base.tous('SELECT * FROM cm_checklists WHERE carte_id = ? ORDER BY position', [c.id]);
    const elements = await base.tous('SELECT * FROM cm_checklist_elements WHERE carte_id = ? ORDER BY position', [c.id]);
    const commentaires = await base.tous('SELECT * FROM cm_commentaires WHERE carte_id = ? AND supprime_le IS NULL ORDER BY cree_le, id', [c.id]);
    const pieces = await base.tous('SELECT * FROM cm_pieces WHERE carte_id = ? AND supprime_le IS NULL ORDER BY cree_le, id', [c.id]);
    const fichiers = new Map((await lignesParIds(base, 'SELECT * FROM cm_fichiers WHERE id', pieces.map(p => p.fichier_id))).map(f => [f.id, f]));
    const journal = await base.tous('SELECT * FROM cm_activite WHERE carte_id = ? ORDER BY cree_le DESC, id LIMIT 100', [c.id]);
    const liens = jsonOu(c.liens, {});
    const clips = await lignesParIds(base, 'SELECT id, titre, statut, team_id, genre FROM cm_clips WHERE supprime_le IS NULL AND id', liens.clips ?? []);
    const noms = await pseudosDe(base, [c.cree_par, c.soumis_par, c.valide_par, c.refuse_par, c.publie_par, ...membres, ...commentaires.map(x => x.auteur_id), ...journal.map(x => x.acteur_id), ...(liens.membres ?? [])].filter(Boolean));
    const couv = jsonOu(c.couverture, null);
    return {
      carte: {
        id: c.id,
        tableauId: tb.id,
        listeId: c.liste_id,
        teamId: c.team_id ?? null,
        titre: c.titre,
        description: c.description,
        position: Number(c.position),
        couverture: couv,
        echeance: c.echeance ?? null,
        echeanceFaite: Number(c.echeance_faite) === 1,
        datePublication: c.date_publication ?? null,
        post: Number(c.post) === 1,
        statut: c.statut ?? null,
        reseaux: jsonOu(c.reseaux, []),
        textes: jsonOu(c.textes, {}),
        liens,
        publications: jsonOu(c.publications, {}),
        soumisPar: c.soumis_par ?? null,
        soumisLe: c.soumis_le ?? null,
        validePar: c.valide_par ?? null,
        valideLe: c.valide_le ?? null,
        refusMotif: c.refus_motif ?? null,
        refusePar: c.refuse_par ?? null,
        publiePar: c.publie_par ?? null,
        publieLe: c.publie_le ?? null,
        origine: c.origine,
        depotGenre: c.depot_genre ?? null,
        trello: Boolean(c.trello_id),
        archive: Boolean(c.archive_le),
        creePar: c.cree_par ?? null,
        creeLe: c.cree_le,
        majLe: c.maj_le,
        version: Number(c.version),
        etiquettes,
        membres,
        checklists: checklists.map(k => ({
          id: k.id,
          nom: k.nom,
          elements: elements.filter(e => e.checklist_id === k.id).map(e => ({ id: e.id, texte: e.texte, fait: Number(e.fait) === 1 })),
        })),
        commentaires: commentaires.map(x => ({ id: x.id, auteur: x.auteur_id ?? null, auteurNom: x.auteur_nom ?? null, texte: x.texte, creeLe: x.cree_le, majLe: x.maj_le, trello: Boolean(x.trello_id), moi: x.auteur_id === acteur.compte, nouveau: nouveauPour(x, acteur.compte, vuAvant) })),
        vuAvant,
        nonLus: commentaires.filter(x => nouveauPour(x, acteur.compte, vuAvant)).length,
        suivie,
        pieces: pieces.map(p => {
          const f = p.fichier_id ? fichiers.get(p.fichier_id) : null;
          return { id: p.id, genre: p.genre, nom: p.nom, url: p.genre === 'lien' ? p.url : null, trello: Number(p.trello) === 1, fichier: f && !f.supprime_le ? { id: f.id, type: f.type_mime, taille: Number(f.taille) } : null, creeLe: p.cree_le };
        }),
        activite: journal.map(a => ({ id: a.id, acteur: a.acteur_id ?? null, action: a.action, meta: jsonOu(a.meta, {}), date: a.cree_le })),
        clips: clips.map(x => ({ id: x.id, titre: x.titre, statut: x.statut, genre: x.genre })),
        // Partenaires mentionnés (nom seulement : rien de la rubrique Sponsors).
        sponsors: (await lignesParIds(base, 'SELECT id, nom FROM sp_partenaires WHERE supprime_le IS NULL AND id', liens.sponsors ?? [])).map(x => ({ id: x.id, nom: x.nom })),
        resumes: await resumesLies(c.team_id ?? liens.teamId ?? null, liens, langue),
      },
      droits: { ...droitsDe(ctx), modifier: peutModifierCarte(ctx, c) },
      noms,
      problemes: Number(c.post) === 1 ? problemesPost({ reseaux: jsonOu(c.reseaux, []), textes: jsonOu(c.textes, {}) }) : [],
      origine,
    };
  }

  /** Titres lisibles des match, tournoi et résultat liés (seulement s'ils sont publiables). */
  async function resumesLies(teamId, liens, langue) {
    if (!teamId) return {};
    const sortie = {};
    if (liens.resultatId) {
      const r = await resumeResultat(base, teamId, liens.resultatId, { langue });
      sortie.resultat = r?.publiable ? { titre: r.titre, phrase: r.phrase } : { masque: true };
    }
    if (liens.matchId) {
      const r = await resumeAnnonce(base, teamId, liens.matchId, { langue });
      sortie.match = r?.publiable ? { titre: r.titre, phrase: r.phrase } : { masque: true };
    }
    if (liens.tournoiId) {
      const r = await resumeTournoi(base, teamId, liens.tournoiId, { langue });
      sortie.tournoi = r?.publiable ? { titre: r.titre, phrase: r.texteClassement ? r.phraseFinal : r.phraseInscription } : { masque: true };
    }
    return sortie;
  }

  /**
   * Membres saisis : seuls les NOUVEAUX doivent avoir accès au tableau. Un membre déjà assigné qui l'a perdu depuis
   * (affectation retirée, membre importé de Trello, rôle changé) reste tant qu'on ne le retire pas : sinon plus
   * aucune modification des membres de la carte ne passait (400 à chaque clic).
   */
  async function verifierMembres(tb, comptes, avant = new Set()) {
    if (!Array.isArray(comptes) || comptes.length > MAX_MEMBRES || comptes.some(c => typeof c !== 'string' || !MOTIF_COMPTE.test(c))) throw echec(400, 'membres', 'Membres illisibles.');
    const nouveaux = comptes.filter(c => !avant.has(c));
    if (nouveaux.length) {
      const permis = new Set((await personnesTableau(tb)).map(p => p.compte));
      for (const c of nouveaux) if (!permis.has(c)) throw echec(400, 'membre', 'Ce compte n’a pas accès à ce tableau.');
    }
    return [...new Set(comptes)];
  }

  /**
   * `PATCH /cm/cartes/:id` : titre, description, échéance, date de publication, couverture, team liée,
   * étiquettes, membres, archivage ; pour un post : réseaux, textes, liens. `versionAttendue` (facultatif) :
   * 409 si la carte a changé entre-temps.
   */
  async function modifierCarte(acteur, id, corps) {
    const { carte: c, tableau: tb, ctx } = await carteVisible(acteur, id);
    if (!peutModifierCarte(ctx, c)) exiger(ctx, 'cm.editer');
    const editeur = peut(ctx, 'cm.editer');
    if (corps?.versionAttendue !== undefined && Number(corps.versionAttendue) !== Number(c.version)) throw echec(409, 'modifiee-entre-temps', 'Cette carte a été modifiée entre-temps : rechargez-la.');
    const t = maintenant();
    const fuseau = ctx.team?.fuseau ?? FUSEAU_CLUB;
    const champs = {};
    const contenu = {};
    const lot = [];
    const modifies = [];
    if (corps?.titre !== undefined) contenu.titre = champs.titre = lireTitre(corps.titre);
    if (corps?.description !== undefined) champs.description = nettoyerNote(corps.description ?? '', NOTE_MAX);
    // Le reste : éditeurs seulement (un correspondant ne change que le titre, la description et les pièces de son dépôt).
    const reserve = ['echeance', 'echeanceFaite', 'datePublication', 'couverture', 'teamId', 'etiquettes', 'membres', 'archive', 'post', 'reseaux', 'textes', 'liens'];
    if (!editeur && reserve.some(k => corps?.[k] !== undefined)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    if (corps?.echeance !== undefined) champs.echeance = lireInstantCm(corps.echeance, fuseau, 'echeance');
    if (corps?.echeanceFaite !== undefined) champs.echeance_faite = corps.echeanceFaite ? 1 : 0;
    if (corps?.datePublication !== undefined) contenu.datePublication = champs.date_publication = lireInstantCm(corps.datePublication, fuseau, 'date-publication');
    if (corps?.couverture !== undefined) champs.couverture = await lireCouverture(c.id, corps.couverture);
    if (corps?.teamId !== undefined && !tb.team_id) champs.team_id = await teamLiee(corps.teamId);
    if (corps?.archive !== undefined) {
      champs.archive_le = corps.archive ? iso(t) : null;
      modifies.push(corps.archive ? 'archivee' : 'restauree');
    }
    let post = Number(c.post) === 1;
    if (corps?.post !== undefined) {
      if (corps.post && !post) {
        champs.post = 1;
        champs.statut = 'brouillon';
        post = true;
        if (corps.reseaux === undefined && !jsonOu(c.reseaux, []).length) contenu.reseaux = champs.reseaux = ['x', 'instagram', 'tiktok'];
      } else if (!corps.post && post) {
        if (!['brouillon', 'refuse'].includes(c.statut)) throw echec(409, 'post-en-cours', 'Ce post est soumis, validé ou publié : il reste un post.');
        champs.post = 0;
        champs.statut = null;
        post = false;
      }
    }
    if (corps?.reseaux !== undefined) contenu.reseaux = champs.reseaux = lireReseaux(corps.reseaux);
    if (corps?.textes !== undefined) contenu.textes = champs.textes = lireTextes(corps.textes);
    if (corps?.liens !== undefined) contenu.liens = champs.liens = await liensVerifies(corps.liens, jsonOu(c.liens, {}).sponsors ?? []);
    if (corps?.etiquettes !== undefined) {
      if (!Array.isArray(corps.etiquettes) || corps.etiquettes.length > MAX_ETIQUETTES || corps.etiquettes.some(e => typeof e !== 'string' || !MOTIF_UUID.test(e))) throw echec(400, 'etiquettes', 'Étiquettes illisibles.');
      const connues = new Set((await base.tous('SELECT id FROM cm_etiquettes WHERE tableau_id = ?', [tb.id])).map(l => l.id));
      const liste = [...new Set(corps.etiquettes)].filter(e => connues.has(e));
      lot.push({ sql: 'DELETE FROM cm_carte_etiquettes WHERE carte_id = ?', params: [c.id] }, ...liste.map(e => ({ sql: 'INSERT INTO cm_carte_etiquettes (carte_id, etiquette_id) VALUES (?, ?)', params: [c.id, e] })));
      modifies.push('etiquettes');
    }
    let nouveaux = [];
    if (corps?.membres !== undefined) {
      const avant = new Set((await base.tous('SELECT compte_id FROM cm_carte_membres WHERE carte_id = ?', [c.id])).map(l => l.compte_id));
      const liste = await verifierMembres(tb, corps.membres, avant);
      nouveaux = liste.filter(m => !avant.has(m));
      lot.push({ sql: 'DELETE FROM cm_carte_membres WHERE carte_id = ?', params: [c.id] }, ...liste.map(m => ({ sql: 'INSERT INTO cm_carte_membres (carte_id, compte_id) VALUES (?, ?)', params: [c.id, m] })));
      modifies.push('membres');
    }
    const colonnes = Object.keys(champs);
    if (!colonnes.length && !lot.length) return carte(acteur, id);
    // Contenu d'un post validé modifié : il repasse « à valider » ; un post publié ne se modifie plus.
    if (post && Object.keys(contenu).length) lot.push(...(await invalidationSiBesoin(c, tb, await contenuDe(c, contenu), acteur.compte, t)));
    const json = k => (['reseaux', 'textes', 'liens', 'couverture'].includes(k) && champs[k] !== null ? JSON.stringify(champs[k]) : champs[k]);
    // Colonnes : noms fixés par le code ci-dessus (jamais tirés de la requête).
    const extra = colonnes.map(k => `, ${k} = ?`).join('');
    lot.unshift({ sql: `UPDATE cm_cartes SET auto = 0, maj_par = ?, maj_le = ?, version = version + 1${extra} WHERE id = ?`, params: [acteur.compte, iso(t), ...colonnes.map(json), c.id] });
    const changes = colonnes.filter(k => !['archive_le'].includes(k));
    if (changes.length) lot.push(activite(c.id, tb.id, acteur.compte, 'modifiee', { champs: changes }, t));
    for (const m of modifies) if (m === 'archivee' || m === 'restauree') lot.push(activite(c.id, tb.id, acteur.compte, m, {}, t));
    if (modifies.includes('membres')) lot.push(activite(c.id, tb.id, acteur.compte, 'membres', { ajoutes: nouveaux }, t));
    if (nouveaux.length) lot.push(evenement('cm.carte_assignee', { teamId: tb.team_id, acteur: acteur.compte, entiteType: 'cm_carte', entiteId: c.id, charge: { comptes: nouveaux, titre: champs.titre ?? c.titre, tableau: tb.id }, maintenant: t }));
    lot.push(versionTableau(tb.id, t));
    await base.lot(lot);
    return carte(acteur, id);
  }

  async function lireCouverture(carteId, v) {
    if (v === null) return null;
    if (typeof v !== 'object' || Array.isArray(v)) throw echec(400, 'couverture', 'Couverture illisible.');
    if (v.couleur !== undefined) return { couleur: lireCouleur(v.couleur) };
    if (v.pieceId !== undefined) {
      exigerUuid(v.pieceId, 'piece');
      const p = await base.premier('SELECT p.id, f.type_mime FROM cm_pieces p JOIN cm_fichiers f ON f.id = p.fichier_id WHERE p.id = ? AND p.carte_id = ? AND p.supprime_le IS NULL', [v.pieceId, carteId]);
      if (!p || !String(p.type_mime).startsWith('image/')) throw echec(400, 'couverture', 'La couverture doit être une image jointe à la carte.');
      return { pieceId: p.id };
    }
    throw echec(400, 'couverture', 'Couverture illisible.');
  }

  /** `POST /cm/cartes/:id/deplacer` `{ listeId, index, tableauId? }` : glisser-déposer (ou clavier). */
  async function deplacerCarte(acteur, id, corps) {
    const { carte: c, tableau: tb, ctx } = await carteVisible(acteur, id);
    exiger(ctx, 'cm.editer');
    let cible = tb;
    if (corps?.tableauId && corps.tableauId !== tb.id) {
      const autre = await tableauVisible(acteur, corps.tableauId);
      exiger(autre.ctx, 'cm.editer');
      cible = autre.tableau;
    }
    const liste = await listeDuTableau(cible.id, corps?.listeId);
    const autres = (await base.tous('SELECT id, position FROM cm_cartes WHERE liste_id = ? AND supprime_le IS NULL AND archive_le IS NULL AND id <> ? ORDER BY position, cree_le', [liste.id, c.id])).map(l => ({ id: l.id, position: Number(l.position) }));
    const index = Math.max(0, Math.min(autres.length, Number.isInteger(corps?.index) ? corps.index : autres.length));
    const t = maintenant();
    const extra = { liste_id: liste.id, ...(cible.id !== tb.id ? { tableau_id: cible.id, team_id: cible.team_id ?? c.team_id } : {}) };
    const lot = instructionsPosition('cm_cartes', c.id, autres, index, t, extra);
    lot.push({ sql: 'UPDATE cm_cartes SET version = version + 1, maj_par = ? WHERE id = ?', params: [acteur.compte, c.id] });
    if (cible.id !== tb.id) {
      // Les étiquettes appartiennent au tableau : elles ne suivent pas la carte.
      lot.push({ sql: 'DELETE FROM cm_carte_etiquettes WHERE carte_id = ?', params: [c.id] }, versionTableau(cible.id, t), { sql: 'UPDATE cm_activite SET tableau_id = ? WHERE carte_id = ?', params: [cible.id, c.id] });
    }
    if (liste.id !== c.liste_id) lot.push(activite(c.id, cible.id, acteur.compte, 'deplacee', { de: c.liste_id, vers: liste.id }, t));
    lot.push(versionTableau(tb.id, t));
    await base.lot(lot);
    return { ok: true };
  }

  async function supprimerCarte(acteur, id) {
    const { carte: c, tableau: tb, ctx } = await carteVisible(acteur, id);
    exiger(ctx, 'cm.editer');
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE cm_cartes SET supprime_le = ?, maj_le = ? WHERE id = ?', params: [iso(t), iso(t), c.id] },
      { sql: "UPDATE cm_clips SET carte_id = NULL, statut = CASE WHEN statut = 'utilise' THEN 'retenu' ELSE statut END, maj_le = ? WHERE carte_id = ?", params: [iso(t), c.id] },
      // Liens de DATA › Ressources liés à la carte (migration 0044).
      { sql: "DELETE FROM cm_lien_liaisons WHERE genre = 'carte' AND cible_id = ?", params: [c.id] },
      evenement('cm.carte_supprimee', { teamId: tb.team_id, acteur: acteur.compte, entiteType: 'cm_carte', entiteId: c.id, charge: { titre: c.titre, tableau: tb.id }, maintenant: t }),
      versionTableau(tb.id, t),
    ]);
    return { ok: true };
  }

  // ---------------------------------------------------------------- Checklists

  async function creerChecklist(acteur, carteId, corps) {
    const { carte: c, tableau: tb, ctx } = await carteVisible(acteur, carteId);
    exiger(ctx, 'cm.editer');
    const n = await base.premier('SELECT COUNT(*) AS n FROM cm_checklists WHERE carte_id = ?', [c.id]);
    if (Number(n?.n ?? 0) >= MAX_CHECKLISTS) throw echec(409, 'trop-de-checklists', `${MAX_CHECKLISTS} checklists au plus.`);
    const t = maintenant();
    const id = nouvelId();
    await base.lot([
      { sql: 'INSERT INTO cm_checklists (id, carte_id, nom, position) VALUES (?, ?, ?, ?)', params: [id, c.id, nomListe(corps?.nom), (Number(n?.n ?? 0) + 1) * 1024] },
      { sql: 'UPDATE cm_cartes SET version = version + 1, maj_le = ? WHERE id = ?', params: [iso(t), c.id] },
      versionTableau(tb.id, t),
    ]);
    return carte(acteur, carteId);
  }

  async function checklistVisible(acteur, id) {
    exigerUuid(id, 'checklist');
    const k = await base.premier('SELECT * FROM cm_checklists WHERE id = ?', [id]);
    if (!k) throw echec(404, 'checklist-introuvable', 'Checklist introuvable.');
    const v = await carteVisible(acteur, k.carte_id);
    exiger(v.ctx, 'cm.editer');
    return { k, ...v };
  }

  async function modifierChecklist(acteur, id, corps) {
    const { k, carte: c, tableau: tb } = await checklistVisible(acteur, id);
    const t = maintenant();
    await base.lot([{ sql: 'UPDATE cm_checklists SET nom = ? WHERE id = ?', params: [nomListe(corps?.nom), k.id] }, { sql: 'UPDATE cm_cartes SET version = version + 1 WHERE id = ?', params: [c.id] }, versionTableau(tb.id, t)]);
    return carte(acteur, c.id);
  }

  async function supprimerChecklist(acteur, id) {
    const { k, carte: c, tableau: tb } = await checklistVisible(acteur, id);
    const t = maintenant();
    await base.lot([{ sql: 'DELETE FROM cm_checklist_elements WHERE checklist_id = ?', params: [k.id] }, { sql: 'DELETE FROM cm_checklists WHERE id = ?', params: [k.id] }, { sql: 'UPDATE cm_cartes SET version = version + 1 WHERE id = ?', params: [c.id] }, versionTableau(tb.id, t)]);
    return carte(acteur, c.id);
  }

  async function ajouterElement(acteur, checklistId, corps) {
    const { k, carte: c, tableau: tb } = await checklistVisible(acteur, checklistId);
    const n = await base.premier('SELECT COUNT(*) AS n FROM cm_checklist_elements WHERE checklist_id = ?', [k.id]);
    if (Number(n?.n ?? 0) >= MAX_ELEMENTS) throw echec(409, 'trop-d-elements', `${MAX_ELEMENTS} éléments au plus.`);
    const texte = texteNettoye(corps?.texte, 300);
    if (!texte) throw echec(400, 'texte', 'Texte obligatoire.');
    const t = maintenant();
    await base.lot([
      { sql: 'INSERT INTO cm_checklist_elements (id, checklist_id, carte_id, texte, fait, position) VALUES (?, ?, ?, ?, 0, ?)', params: [nouvelId(), k.id, c.id, texte, (Number(n?.n ?? 0) + 1) * 1024] },
      { sql: 'UPDATE cm_cartes SET version = version + 1 WHERE id = ?', params: [c.id] },
      versionTableau(tb.id, t),
    ]);
    return carte(acteur, c.id);
  }

  async function elementVisible(acteur, id) {
    exigerUuid(id, 'element');
    const e = await base.premier('SELECT * FROM cm_checklist_elements WHERE id = ?', [id]);
    if (!e) throw echec(404, 'element-introuvable', 'Élément introuvable.');
    const v = await carteVisible(acteur, e.carte_id);
    exiger(v.ctx, 'cm.editer');
    return { e, ...v };
  }

  async function modifierElement(acteur, id, corps) {
    const { e, carte: c, tableau: tb } = await elementVisible(acteur, id);
    const texte = corps?.texte !== undefined ? texteNettoye(corps.texte, 300) : e.texte;
    if (!texte) throw echec(400, 'texte', 'Texte obligatoire.');
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE cm_checklist_elements SET texte = ?, fait = ? WHERE id = ?', params: [texte, corps?.fait !== undefined ? (corps.fait ? 1 : 0) : Number(e.fait), e.id] },
      { sql: 'UPDATE cm_cartes SET version = version + 1 WHERE id = ?', params: [c.id] },
      versionTableau(tb.id, t),
    ]);
    return carte(acteur, c.id);
  }

  async function supprimerElement(acteur, id) {
    const { e, carte: c, tableau: tb } = await elementVisible(acteur, id);
    const t = maintenant();
    await base.lot([{ sql: 'DELETE FROM cm_checklist_elements WHERE id = ?', params: [e.id] }, { sql: 'UPDATE cm_cartes SET version = version + 1 WHERE id = ?', params: [c.id] }, versionTableau(tb.id, t)]);
    return carte(acteur, c.id);
  }

  // ---------------------------------------------------------------- Commentaires

  async function commenter(acteur, carteId, corps) {
    const { carte: c, tableau: tb, ctx } = await carteVisible(acteur, carteId);
    exiger(ctx, 'cm.editer', 'cm.deposer');
    const texte = nettoyerNote(corps?.texte ?? '', COMMENTAIRE_MAX);
    if (!texte.trim()) throw echec(400, 'texte', 'Commentaire vide.');
    const t = maintenant();
    const id = nouvelId();
    // @mentions : seulement les personnes qui ont accès au tableau (jamais un compte extérieur).
    const personnes = await personnesTableau(tb);
    const cites = new Set(mentionsDe(texte).map(m => m.toLowerCase()));
    const mentionnes = personnes.filter(p => cites.has(p.pseudo.toLowerCase()) && p.compte !== acteur.compte).map(p => p.compte);
    // Notification « nouveau commentaire » : membres assignés, auteur de la carte, personnes qui la suivent (jamais
    // l'auteur du commentaire ni les personnes @mentionnées, qui ont leur propre notification), et seulement celles
    // qui ont accès au tableau.
    const suiveurs = (await base.tous('SELECT compte_id FROM cm_carte_suivis WHERE carte_id = ?', [c.id])).map(l => l.compte_id);
    const assignes = (await base.tous('SELECT compte_id FROM cm_carte_membres WHERE carte_id = ?', [c.id])).map(l => l.compte_id);
    const accessibles = new Set(personnes.map(p => p.compte));
    const concernes = [...new Set([...assignes, c.cree_par, ...suiveurs])].filter(x => x && x !== acteur.compte && accessibles.has(x) && !mentionnes.includes(x));
    await base.lot([
      { sql: 'INSERT INTO cm_commentaires (id, carte_id, auteur_id, texte, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?)', params: [id, c.id, acteur.compte, texte, iso(t), iso(t)] },
      activite(c.id, tb.id, acteur.compte, 'commentaire', {}, t),
      { sql: 'UPDATE cm_cartes SET version = version + 1 WHERE id = ?', params: [c.id] },
      versionTableau(tb.id, t),
      evenement('cm.commentaire_ajoute', { teamId: tb.team_id, acteur: acteur.compte, entiteType: 'cm_carte', entiteId: c.id, charge: { titre: c.titre, tableau: tb.id, mentions: mentionnes, concernes }, maintenant: t }),
    ]);
    return carte(acteur, c.id);
  }

  async function commentaireVisible(acteur, id) {
    exigerUuid(id, 'commentaire');
    const x = await base.premier('SELECT * FROM cm_commentaires WHERE id = ? AND supprime_le IS NULL', [id]);
    if (!x) throw echec(404, 'commentaire-introuvable', 'Commentaire introuvable.');
    return { x, ...(await carteVisible(acteur, x.carte_id)) };
  }

  async function modifierCommentaire(acteur, id, corps) {
    const { x, carte: c, tableau: tb } = await commentaireVisible(acteur, id);
    if (x.auteur_id !== acteur.compte) throw echec(403, 'permission', 'Seul l’auteur modifie son commentaire.');
    const texte = nettoyerNote(corps?.texte ?? '', COMMENTAIRE_MAX);
    if (!texte.trim()) throw echec(400, 'texte', 'Commentaire vide.');
    const t = maintenant();
    await base.lot([{ sql: 'UPDATE cm_commentaires SET texte = ?, maj_le = ? WHERE id = ?', params: [texte, iso(t), x.id] }, versionTableau(tb.id, t)]);
    return carte(acteur, c.id);
  }

  async function supprimerCommentaire(acteur, id) {
    const { x, carte: c, tableau: tb, ctx } = await commentaireVisible(acteur, id);
    if (x.auteur_id !== acteur.compte) exiger(ctx, 'cm.gerer');
    const t = maintenant();
    await base.lot([{ sql: 'UPDATE cm_commentaires SET supprime_le = ? WHERE id = ?', params: [iso(t), x.id] }, { sql: 'UPDATE cm_cartes SET version = version + 1 WHERE id = ?', params: [c.id] }, versionTableau(tb.id, t)]);
    return carte(acteur, c.id);
  }

  // ---------------------------------------------------------------- Pièces jointes

  /** Contexte d'envoi d'un fichier CM (pièces, clips) : la portée du tableau ou de la team. */
  const contexteEnvoi = (ctx, portee) => ({ acteur: ctx.acteur, team: { id: teamDePortee(portee) }, portee });

  async function ajouterPiece(acteur, carteId, corps) {
    const { carte: c, tableau: tb, ctx } = await carteVisible(acteur, carteId);
    if (!peutModifierCarte(ctx, c)) exiger(ctx, 'cm.editer');
    const n = await base.premier('SELECT COUNT(*) AS n FROM cm_pieces WHERE carte_id = ? AND supprime_le IS NULL', [c.id]);
    if (Number(n?.n ?? 0) >= MAX_PIECES) throw echec(409, 'trop-de-pieces', `${MAX_PIECES} pièces jointes au plus.`);
    const t = maintenant();
    const id = nouvelId();
    const lot = [];
    if (corps?.genre === 'lien') {
      const url = String(corps?.url ?? '').trim();
      if (url.length > 2000 || !/^https:\/\//i.test(url) || !lienSur(url)) throw echec(400, 'lien', 'Adresse invalide : https://… sans espace.');
      lot.push({ sql: "INSERT INTO cm_pieces (id, carte_id, genre, nom, url, cree_par, cree_le) VALUES (?, ?, 'lien', ?, ?, ?, ?)", params: [id, c.id, texteNettoye(corps?.nom, 140) || url.slice(0, 140), url, acteur.compte, iso(t)] });
    } else if (corps?.genre === 'fichier') {
      if (!medias) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché sur le serveur Esport.');
      const r = await medias.preparerRattachement(contexteEnvoi(ctx, tb.portee), corps?.envoi, 'cm', { entiteType: 'cm_piece', entiteId: id });
      lot.push(...r.instructions, { sql: "INSERT INTO cm_pieces (id, carte_id, genre, nom, fichier_id, cree_par, cree_le) VALUES (?, ?, 'fichier', ?, ?, ?, ?)", params: [id, c.id, r.envoi.nom_original, r.fichierId, acteur.compte, iso(t)] });
    } else if (corps?.genre === 'drive') {
      // Fichier du Drive (migration 0027) : même portée que le tableau, ou Drive du club ; aucun octet copié.
      if (!drive) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché sur le serveur Esport.');
      const f = await drive.fichierPourIntegration(acteur, corps?.fichierId, { portees: [tb.portee, PORTEE_CLUB] });
      lot.push({ sql: "INSERT INTO cm_pieces (id, carte_id, genre, nom, fichier_id, cree_par, cree_le) VALUES (?, ?, 'fichier', ?, ?, ?, ?)", params: [id, c.id, f.nom, f.fichierId, acteur.compte, iso(t)] });
    } else throw echec(400, 'genre', 'Pièce jointe : lien ou fichier.');
    if (Number(c.post)) lot.push(...(await invalidationSiBesoin(c, tb, await contenuDe(c, { pieces: [...(await piecesIds(c.id)), id] }), acteur.compte, t)));
    lot.push(activite(c.id, tb.id, acteur.compte, 'piece_ajoutee', { nom: corps?.genre === 'lien' ? texteNettoye(corps?.nom, 140) : null, ...(corps?.genre === 'drive' ? { drive: true } : {}) }, t), { sql: 'UPDATE cm_cartes SET version = version + 1, maj_le = ? WHERE id = ?', params: [iso(t), c.id] }, versionTableau(tb.id, t));
    await base.lot(lot);
    return carte(acteur, c.id);
  }

  /**
   * Joint un fichier CM DÉJÀ enregistré (visuel généré : `cm_fichiers` de la portée du tableau) à une carte,
   * en remplaçant au besoin une pièce précédente (`remplacer`). Usage interne (service des visuels) : jamais
   * branché sur une route, l'identifiant du fichier ne vient pas de la requête. Rend l'identifiant de la pièce.
   */
  async function attacherFichier(acteur, carteId, { fichierId, nom, remplacer = null }) {
    const { carte: c, tableau: tb, ctx } = await carteVisible(acteur, carteId);
    exiger(ctx, 'cm.editer');
    const f = await base.premier('SELECT id, portee FROM cm_fichiers WHERE id = ? AND supprime_le IS NULL', [fichierId]);
    if (!f || f.portee !== tb.portee) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    const ancienne = remplacer ? await base.premier('SELECT * FROM cm_pieces WHERE id = ? AND carte_id = ? AND supprime_le IS NULL', [remplacer, c.id]) : null;
    const actuelles = await piecesIds(c.id);
    if (!ancienne && actuelles.length >= MAX_PIECES) throw echec(409, 'trop-de-pieces', `${MAX_PIECES} pièces jointes au plus.`);
    const t = maintenant();
    const id = nouvelId();
    const lot = [{ sql: "INSERT INTO cm_pieces (id, carte_id, genre, nom, fichier_id, cree_par, cree_le) VALUES (?, ?, 'fichier', ?, ?, ?, ?)", params: [id, c.id, texteNettoye(nom, 140) || 'visuel.png', f.id, acteur.compte, iso(t)] }];
    if (ancienne) {
      lot.push({ sql: 'UPDATE cm_pieces SET supprime_le = ? WHERE id = ?', params: [iso(t), ancienne.id] });
      const couv = jsonOu(c.couverture, null);
      if (couv?.pieceId === ancienne.id) lot.push({ sql: 'UPDATE cm_cartes SET couverture = ? WHERE id = ?', params: [JSON.stringify({ pieceId: id }), c.id] });
    }
    if (Number(c.post)) lot.push(...(await invalidationSiBesoin(c, tb, await contenuDe(c, { pieces: [...actuelles.filter(x => x !== ancienne?.id), id] }), acteur.compte, t)));
    lot.push(activite(c.id, tb.id, acteur.compte, 'visuel_joint', { nom: texteNettoye(nom, 140) }, t), { sql: 'UPDATE cm_cartes SET version = version + 1, maj_le = ? WHERE id = ?', params: [iso(t), c.id] }, versionTableau(tb.id, t));
    await base.lot(lot);
    if (ancienne?.fichier_id && ancienne.fichier_id !== f.id) await effacerFichierSiOrphelin(ancienne.fichier_id, t);
    return { pieceId: id, tableau: tb, carte: c };
  }

  async function pieceVisible(acteur, id) {
    exigerUuid(id, 'piece');
    const p = await base.premier('SELECT * FROM cm_pieces WHERE id = ? AND supprime_le IS NULL', [id]);
    if (!p) throw echec(404, 'piece-introuvable', 'Pièce jointe introuvable.');
    return { p, ...(await carteVisible(acteur, p.carte_id)) };
  }

  /**
   * Efface les octets d'un fichier CM s'il n'est plus utilisé par aucune pièce, aucun clip, aucun visuel, aucune
   * image importée, aucun sponsor ni aucune version du Drive (utilisations.mjs).
   */
  async function effacerFichierSiOrphelin(fichierId, t) {
    await effacerFichierCmSiOrphelin(base, stockage, fichierId, t);
  }

  async function supprimerPiece(acteur, id) {
    const { p, carte: c, tableau: tb, ctx } = await pieceVisible(acteur, id);
    if (!peutModifierCarte(ctx, c)) exiger(ctx, 'cm.editer');
    const t = maintenant();
    const lot = [{ sql: 'UPDATE cm_pieces SET supprime_le = ? WHERE id = ?', params: [iso(t), p.id] }];
    const couv = jsonOu(c.couverture, null);
    if (couv?.pieceId === p.id) lot.push({ sql: 'UPDATE cm_cartes SET couverture = NULL WHERE id = ?', params: [c.id] });
    if (Number(c.post)) lot.push(...(await invalidationSiBesoin(c, tb, await contenuDe(c, { pieces: (await piecesIds(c.id)).filter(x => x !== p.id) }), acteur.compte, t)));
    lot.push(activite(c.id, tb.id, acteur.compte, 'piece_retiree', { nom: p.nom }, t), { sql: 'UPDATE cm_cartes SET version = version + 1, maj_le = ? WHERE id = ?', params: [iso(t), c.id] }, versionTableau(tb.id, t));
    await base.lot(lot);
    await effacerFichierSiOrphelin(p.fichier_id, t);
    return carte(acteur, c.id);
  }

  /** Lien signé (2 h) vers le fichier d'une pièce jointe (téléchargement des médias). */
  async function lienPiece(acteur, id, corps) {
    const { p } = await pieceVisible(acteur, id);
    if (p.genre !== 'fichier' || !p.fichier_id) throw echec(400, 'piece-lien', 'Cette pièce jointe est un lien.');
    const f = await base.premier('SELECT id FROM cm_fichiers WHERE id = ? AND supprime_le IS NULL', [p.fichier_id]);
    if (!f) throw echec(404, 'fichier-introuvable', 'Fichier introuvable (supprimé ?).');
    return cheminSigne(cleSession, { fichierId: f.id, compte: acteur.compte, maintenant: maintenant(), duree: DUREE_LIEN_CM_MS, telecharger: corps?.telecharger === true, genre: 'cm' });
  }

  // ---------------------------------------------------------------- Circuit de validation

  async function rangerDansListe(tb, carteId, cleListe, carteListeId) {
    const liste = await listeDeCle(base, tb.id, cleListe);
    if (!liste || liste.id === carteListeId) return [];
    return [{ sql: 'UPDATE cm_cartes SET liste_id = ?, position = ? WHERE id = ?', params: [liste.id, await positionFin(base, liste.id), carteId] }];
  }

  async function postVisible(acteur, id) {
    const v = await carteVisible(acteur, id);
    if (!Number(v.carte.post)) throw echec(409, 'pas-un-post', 'Cette carte n’est pas un post.');
    return v;
  }

  async function soumettre(acteur, id) {
    const { carte: c, tableau: tb, ctx } = await postVisible(acteur, id);
    exiger(ctx, 'cm.editer');
    if (c.statut === 'a_valider') return carte(acteur, id);
    if (!['brouillon', 'refuse'].includes(c.statut)) throw echec(409, 'statut', 'Ce post est déjà validé ou publié.');
    const problemes = problemesPost({ reseaux: jsonOu(c.reseaux, []), textes: jsonOu(c.textes, {}) });
    if (problemes.length) {
      const e = echec(400, 'post-incomplet', 'Le post n’est pas prêt : un texte manque ou dépasse la limite d’un réseau.');
      e.details = { problemes };
      throw e;
    }
    const t = maintenant();
    await base.lot([
      { sql: "UPDATE cm_cartes SET statut = 'a_valider', soumis_par = ?, soumis_le = ?, refus_motif = NULL, refuse_par = NULL, auto = 0, version = version + 1, maj_le = ? WHERE id = ?", params: [acteur.compte, iso(t), iso(t), c.id] },
      ...(await rangerDansListe(tb, c.id, 'a_valider', c.liste_id)),
      activite(c.id, tb.id, acteur.compte, 'soumise', {}, t),
      evenement('cm.post_soumis', { teamId: tb.team_id, acteur: acteur.compte, entiteType: 'cm_carte', entiteId: c.id, charge: { titre: c.titre, tableau: tb.id, portee: tb.portee }, maintenant: t }),
      versionTableau(tb.id, t),
    ]);
    return carte(acteur, id);
  }

  async function valider(acteur, id, corps) {
    const { carte: c, tableau: tb, ctx } = await postVisible(acteur, id);
    exiger(ctx, 'cm.valider');
    if (c.statut !== 'a_valider') throw echec(409, 'statut', 'Ce post n’est pas à valider.');
    if (corps?.versionAttendue !== undefined && Number(corps.versionAttendue) !== Number(c.version)) throw echec(409, 'modifiee-entre-temps', 'Ce post a été modifié entre-temps : relisez-le avant de le valider.');
    const problemes = problemesPost({ reseaux: jsonOu(c.reseaux, []), textes: jsonOu(c.textes, {}) });
    if (problemes.length) {
      const e = echec(400, 'post-incomplet', 'Le post n’est pas prêt : un texte manque ou dépasse la limite d’un réseau.');
      e.details = { problemes };
      throw e;
    }
    const t = maintenant();
    const empreinte = await empreinteContenu(await contenuDe(c));
    const commentaire = nettoyerNote(corps?.commentaire ?? '', COMMENTAIRE_MAX);
    const r = await base.lot([
      { sql: "UPDATE cm_cartes SET statut = 'valide', valide_par = ?, valide_le = ?, empreinte_validee = ?, version = version + 1, maj_le = ? WHERE id = ? AND statut = 'a_valider' AND version = ?", params: [acteur.compte, iso(t), empreinte, iso(t), c.id, Number(c.version)] },
    ]);
    if (r[0].changements !== 1) throw echec(409, 'modifiee-entre-temps', 'Ce post a été modifié entre-temps : relisez-le avant de le valider.');
    await base.lot([
      ...(await rangerDansListe(tb, c.id, 'valide', c.liste_id)),
      ...(commentaire.trim() ? [{ sql: 'INSERT INTO cm_commentaires (id, carte_id, auteur_id, texte, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?)', params: [nouvelId(), c.id, acteur.compte, commentaire, iso(t), iso(t)] }] : []),
      activite(c.id, tb.id, acteur.compte, 'validee', {}, t),
      evenement('cm.post_valide', { teamId: tb.team_id, acteur: acteur.compte, entiteType: 'cm_carte', entiteId: c.id, charge: { titre: c.titre, tableau: tb.id, soumisPar: c.soumis_par ?? null }, maintenant: t }),
      versionTableau(tb.id, t),
    ]);
    return carte(acteur, id);
  }

  async function refuser(acteur, id, corps) {
    const { carte: c, tableau: tb, ctx } = await postVisible(acteur, id);
    exiger(ctx, 'cm.valider');
    if (!['a_valider', 'valide'].includes(c.statut)) throw echec(409, 'statut', 'Ce post n’est pas à valider.');
    const motif = texteLong(corps?.motif, 1000);
    if (motif.length < 2) throw echec(400, 'motif', 'Dites pourquoi (motif du refus).');
    const t = maintenant();
    await base.lot([
      { sql: "UPDATE cm_cartes SET statut = 'refuse', refus_motif = ?, refuse_par = ?, valide_par = NULL, valide_le = NULL, empreinte_validee = NULL, version = version + 1, maj_le = ? WHERE id = ?", params: [motif, acteur.compte, iso(t), c.id] },
      ...(await rangerDansListe(tb, c.id, LISTE_DU_STATUT.refuse, c.liste_id)),
      { sql: 'INSERT INTO cm_commentaires (id, carte_id, auteur_id, texte, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?)', params: [nouvelId(), c.id, acteur.compte, nettoyerNote(motif, COMMENTAIRE_MAX), iso(t), iso(t)] },
      activite(c.id, tb.id, acteur.compte, 'refusee', { motif }, t),
      evenement('cm.post_refuse', { teamId: tb.team_id, acteur: acteur.compte, entiteType: 'cm_carte', entiteId: c.id, charge: { titre: c.titre, tableau: tb.id, soumisPar: c.soumis_par ?? null, motif }, maintenant: t }),
      versionTableau(tb.id, t),
    ]);
    return carte(acteur, id);
  }

  /**
   * `POST /cm/cartes/:id/publier` `{ publications: { x: url } }` : un post VALIDÉ passe « publié » (copié à la
   * main sur les réseaux), avec l'adresse du post par réseau. Relancé sur un post publié : met à jour les
   * adresses. Événement `cm.post_publie` (première fois) ou `cm.post_adresses` (adresse ajoutée ou changée) :
   * la page Réseaux s'y abonne (annonce Discord, idempotente ; publications suivies pour les statistiques).
   */
  async function publier(acteur, id, corps) {
    const { carte: c, tableau: tb, ctx } = await postVisible(acteur, id);
    exiger(ctx, 'cm.editer');
    if (!['valide', 'publie'].includes(c.statut)) throw echec(409, 'validation-requise', 'Un post doit être validé avant d’être publié.');
    // Garde-fou : le contenu publié est bien celui qui a été validé.
    if (c.statut === 'valide' && (await empreinteContenu(await contenuDe(c))) !== c.empreinte_validee) throw echec(409, 'validation-requise', 'Le contenu a changé depuis la validation : faites-le valider de nouveau.');
    const reseaux = jsonOu(c.reseaux, []);
    const avant = jsonOu(c.publications, {});
    const publications = { ...avant, ...lirePublications(corps?.publications, reseaux) };
    const t = maintenant();
    const premiere = c.statut !== 'publie';
    const changees = Object.keys(publications).filter(r => publications[r] !== avant[r]);
    await base.lot([
      { sql: "UPDATE cm_cartes SET statut = 'publie', publications = ?, publie_par = COALESCE(publie_par, ?), publie_le = COALESCE(publie_le, ?), version = version + 1, maj_le = ? WHERE id = ?", params: [JSON.stringify(publications), acteur.compte, iso(t), iso(t), c.id] },
      ...(premiere ? await rangerDansListe(tb, c.id, 'publie', c.liste_id) : []),
      activite(c.id, tb.id, acteur.compte, premiere ? 'publiee' : 'adresses', { reseaux: Object.keys(publications) }, t),
      ...(premiere
        ? [evenement('cm.post_publie', { teamId: tb.team_id, acteur: acteur.compte, entiteType: 'cm_carte', entiteId: c.id, charge: { titre: c.titre, tableau: tb.id, portee: tb.portee, team: c.team_id ?? null, reseaux, publications, liens: jsonOu(c.liens, {}), datePublication: c.date_publication ?? null }, maintenant: t })]
        : changees.length
          ? [evenement('cm.post_adresses', { teamId: tb.team_id, acteur: acteur.compte, entiteType: 'cm_carte', entiteId: c.id, charge: { titre: c.titre, tableau: tb.id, portee: tb.portee, reseaux: changees, publications }, maintenant: t })]
          : []),
      versionTableau(tb.id, t),
    ]);
    return carte(acteur, id);
  }

  async function depublier(acteur, id) {
    const { carte: c, tableau: tb, ctx } = await postVisible(acteur, id);
    exiger(ctx, 'cm.editer');
    if (c.statut !== 'publie') throw echec(409, 'statut', 'Ce post n’est pas publié.');
    const t = maintenant();
    await base.lot([
      { sql: "UPDATE cm_cartes SET statut = 'valide', publie_le = NULL, publie_par = NULL, version = version + 1, maj_le = ? WHERE id = ?", params: [iso(t), c.id] },
      ...(await rangerDansListe(tb, c.id, 'valide', c.liste_id)),
      activite(c.id, tb.id, acteur.compte, 'depubliee', {}, t),
      versionTableau(tb.id, t),
    ]);
    return carte(acteur, id);
  }

  // ---------------------------------------------------------------- Vues transversales

  async function porteesAvec(acteur, permission) {
    const portees = await porteesDe(base, acteur);
    return { portees, liste: [...(portees.club.has(permission) ? [PORTEE_CLUB] : []), ...[...portees.teams].filter(([, s]) => s.has(permission)).map(([id]) => id)] };
  }

  const resumeCarte = (c, tableaux, portees) => {
    const tb = tableaux.get(c.tableau_id);
    return {
      id: c.id,
      titre: c.titre,
      tableauId: c.tableau_id,
      tableau: tb ? { id: tb.id, nom: tb.nom ?? null, cleDefaut: tb.cle_defaut ?? null, portee: tb.portee, team: tb.team_id ? (portees.noms.get(tb.team_id) ?? null) : null } : null,
      listeId: c.liste_id,
      teamId: c.team_id ?? null,
      team: c.team_id ? (portees.noms.get(c.team_id) ?? null) : null,
      statut: c.statut ?? null,
      post: Number(c.post) === 1,
      reseaux: jsonOu(c.reseaux, []),
      datePublication: c.date_publication ?? null,
      soumisPar: c.soumis_par ?? null,
      soumisLe: c.soumis_le ?? null,
      origine: c.origine,
      version: Number(c.version),
      droits: { valider: permissionsAuNiveau(permissionsSur(portees, tb?.portee), tb?.niveau).has('cm.valider'), editer: permissionsAuNiveau(permissionsSur(portees, tb?.portee), tb?.niveau).has('cm.editer') },
    };
  };

  /** Tableaux visibles des portées (restreints : seulement ceux dont l'acteur est), avec leur `niveau`. */
  async function tableauxDe(acteur, portees) {
    const lignes = await lecteurTableaux(base, acteur).filtrer(await lignesParIds(base, 'SELECT * FROM cm_tableaux WHERE supprime_le IS NULL AND portee', portees));
    return new Map(lignes.map(t => [t.id, t]));
  }

  /** `GET /cm/a-valider` : les posts à valider des tableaux visibles. */
  async function aValider(acteur) {
    const { portees, liste } = await porteesAvec(acteur, 'cm.voir');
    const tableauxVus = await tableauxDe(acteur, liste);
    const cartes = (await lignesParIds(base, "SELECT * FROM cm_cartes WHERE supprime_le IS NULL AND archive_le IS NULL AND statut = 'a_valider' AND tableau_id", [...tableauxVus.keys()])).sort((a, b) => String(a.soumis_le ?? '').localeCompare(String(b.soumis_le ?? '')));
    const noms = await pseudosDe(base, cartes.map(c => c.soumis_par).filter(Boolean));
    return { cartes: cartes.map(c => ({ ...resumeCarte(c, tableauxVus, portees), textes: jsonOu(c.textes, {}) })), noms };
  }

  /** `GET /cm/calendrier?du&au&reseau` : posts prévus (date de publication) dans la période. */
  async function calendrier(acteur, { du, au, reseau } = {}) {
    const debut = lireDate(du ?? '');
    const fin = lireDate(au ?? '');
    if (!debut || !fin) throw echec(400, 'periode', 'Période invalide (du, au : AAAA-MM-JJ).');
    const a = Date.parse(`${du}T00:00:00Z`) - 86_400_000;
    const b = Date.parse(`${au}T00:00:00Z`) + 2 * 86_400_000;
    if (!(b > a) || b - a > 120 * 86_400_000) throw echec(400, 'periode', 'Période de 4 mois au plus.');
    if (reseau !== undefined && reseau !== '' && !lireReseaux([reseau]).length) throw echec(400, 'reseaux', 'Réseau inconnu.');
    const { portees, liste } = await porteesAvec(acteur, 'cm.voir');
    const tableauxVus = await tableauxDe(acteur, liste);
    const cartes = (await lignesParIds(base, 'SELECT * FROM cm_cartes WHERE supprime_le IS NULL AND archive_le IS NULL AND post = 1 AND date_publication >= ? AND date_publication < ? AND tableau_id', [...tableauxVus.keys()], { paramsAvant: [iso(a), iso(b)] }))
      .filter(c => !reseau || jsonOu(c.reseaux, []).includes(reseau))
      .sort((x, y) => String(x.date_publication).localeCompare(String(y.date_publication)));
    return { cartes: cartes.map(c => resumeCarte(c, tableauxVus, portees)) };
  }

  /** `GET /cm/recherche?q` : cartes des tableaux visibles dont le titre ou la description contient `q`. */
  async function recherche(acteur, { q } = {}) {
    const texte = texteNettoye(q, 80);
    if (texte.length < 2) return { cartes: [] };
    const { portees, liste } = await porteesAvec(acteur, 'cm.voir');
    const tableauxVus = await tableauxDe(acteur, liste);
    const motif = `%${echapperLike(texte)}%`;
    const cartes = (await lignesParIds(base, "SELECT * FROM cm_cartes WHERE supprime_le IS NULL AND (titre LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') AND tableau_id", [...tableauxVus.keys()], { paramsAvant: [motif, motif] }))
      .sort((x, y) => String(y.maj_le).localeCompare(String(x.maj_le)))
      .slice(0, 50);
    return { cartes: cartes.map(c => ({ ...resumeCarte(c, tableauxVus, portees), archive: Boolean(c.archive_le) })) };
  }

  /** `GET /cm/etat` : versions des tableaux visibles et nombre de posts à valider (rafraîchissement léger). */
  async function etat(acteur) {
    const { portees, liste } = await porteesAvec(acteur, 'cm.voir');
    const lignes = await lecteurTableaux(base, acteur).filtrer(await lignesParIds(base, 'SELECT id, version, portee, team_id, acces FROM cm_tableaux WHERE supprime_le IS NULL AND portee', liste));
    const validables = lignes.filter(t => permissionsAuNiveau(permissionsSur(portees, t.portee), t.niveau).has('cm.valider')).map(t => t.id);
    const n = (await lignesParIds(base, "SELECT COUNT(*) AS n FROM cm_cartes WHERE supprime_le IS NULL AND archive_le IS NULL AND statut = 'a_valider' AND tableau_id", validables)).reduce((s, l) => s + Number(l.n), 0);
    const non = await nonLus(acteur, lignes.map(t => t.id));
    return { versions: Object.fromEntries(lignes.map(t => [t.id, Number(t.version)])), aValider: n, nonLus: { total: non.total, tableaux: Object.fromEntries(non.parTableau) } };
  }

  return {
    tableaux,
    creerTableau,
    modifierTableau,
    supprimerTableau,
    tableau,
    accesTableau,
    changerAcces,
    creerListe,
    modifierListe,
    deplacerListe,
    creerEtiquette,
    modifierEtiquette,
    supprimerEtiquette,
    ordonnerEtiquettes,
    fusionnerEtiquettes,
    creerCarte,
    carte,
    modifierCarte,
    deplacerCarte,
    supprimerCarte,
    creerChecklist,
    modifierChecklist,
    supprimerChecklist,
    ajouterElement,
    modifierElement,
    supprimerElement,
    commenter,
    toutVu,
    suivre,
    modifierCommentaire,
    supprimerCommentaire,
    ajouterPiece,
    supprimerPiece,
    lienPiece,
    soumettre,
    valider,
    refuser,
    publier,
    depublier,
    aValider,
    calendrier,
    recherche,
    etat,
    preferences,
    changerPreference,
    // Pour les autres services de la section (dépôts, clips, import) :
    tableauVisible,
    carteVisible,
    personnesTableau,
    effacerFichierSiOrphelin,
    contexteEnvoi,
    attacherFichier,
  };
}
