/**
 * Drive de la section CM (migration 0027, docs/esport/drive.md) : dossiers et fichiers du club ou d'une team,
 * versions, corbeille (30 jours), étiquettes, favoris, recherche, ZIP d'un dossier, quota, intégrations
 * (pièce jointe d'une carte, image de l'éditeur de visuels, pièce d'un sponsor, rangement automatique des
 * visuels générés et des clips retenus).
 *
 * Droits, sur la portée (club ou team, commun.mjs ; jamais par un rôle de team) :
 *  - cm.drive.voir : parcourir, rechercher, prévisualiser, télécharger, favoris ;
 *  - cm.drive.envoyer : déposer, créer des dossiers, renommer / déplacer / mettre à la corbeille SES fichiers
 *    et dossiers, ajouter une version à ses fichiers ;
 *  - cm.drive.gerer : tout, sur tout ; dossiers restreints ; corbeille (restaurer, supprimer définitivement,
 *    vider) ; versions ; réglages (club).
 *  gérer implique envoyer, qui implique voir. Un membre d'une team qui propose des clips ou dépose des infos
 *  (cm.clips.proposer, cm.deposer) SANS droit sur le Drive n'en voit que le dossier « Dépôt joueurs », et
 *  seulement ses propres fichiers : il y dépose, renomme et retire les siens.
 *
 * Un dossier RESTREINT (et tout ce qu'il contient) n'existe que pour ceux qui gèrent le Drive : 404 pour les
 * autres. Un fichier n'est lisible que par lien signé (2 h) et chaque lecture revérifie l'accès.
 *
 * Sécurité des fichiers : type reconnu par les OCTETS (medias/formats.mjs, usage « drive » : jamais de HTML
 * ni d'exécutable), nom assaini et extension cohérente avec le type (regles.mjs), servi avec nosniff et
 * Content-Disposition, SVG et texte avec une politique « sandbox » (medias/lecture.mjs).
 */

import { lecteurTableaux } from '../acces.mjs';
import { evenement } from '../../evenements.mjs';
import { cheminSigne, verifierLien } from '../../fichiers.mjs';
import { FORMATS, FORMATS_PERMIS, analysePublique } from '../../medias/formats.mjs';
import { ENTETES_LIEN, reponseFichierStocke } from '../../medias/lecture.mjs';
import { disposition } from '../../entetes.mjs';
import { echec, iso, jsonOu, nouvelId } from '../../outils.mjs';
import { lignesParIds, pseudosDe } from '../../requetes.mjs';
import { MOTIF_COMPTE, PORTEE_CLUB, comptesClubAvec, comptesTeamAvec, contexteCm, exigerUuid, lirePortee, porteesDe, teamDePortee } from '../commun.mjs';
import { effacerFichierCmSiOrphelin, utiliseHorsDrive } from '../utilisations.mjs';
import { lireDebut } from '../visuels/service.mjs';
import { OCTETS_ENTETE, dimensionsImage } from '../visuels/images.mjs';
import {
  CLES_DOSSIERS,
  DOSSIERS_DEFAUT,
  DOSSIERS_MAX,
  DUREE_CORBEILLE_MS,
  DUREE_LIEN_DRIVE_MS,
  EXTENSIONS,
  FICHIERS_LISTE_MAX,
  GENRES,
  NOMS_DOSSIERS_DEFAUT,
  PROFONDEUR_MAX,
  SEUIL_ALERTE,
  DELAI_ALERTE_MS,
  VERSIONS_MAX,
  VIGNETTE_TAILLE_MAX,
  ZIP_ENTREES_MAX,
  assainirNom,
  cleRecherche,
  configDrive,
  dimensionsPsd,
  dimensionsSvg,
  extensionDe,
  genreDe,
  lireTags,
  nomPourFormat,
  nomUnique,
} from './regles.mjs';
import { fluxZip, tailleZip } from './zip.mjs';

/** Formats qu'un navigateur affiche dans une balise <img> (vignettes, aperçu). */
const FORMATS_VIGNETTE = ['png', 'jpeg', 'gif', 'webp', 'svg', 'avif'];
const LOT_MAX = 200;
const CLE_RACINE = 'racine';
const CLE_TOUT = '*';
const MOTIF_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const REGLAGES_DEFAUT = Object.freeze({ rangementVisuels: true, rangementClips: true });

// ------------------------------------------------------------------ Hors service (cron, alertes)

/** Espace utilisé par le Drive : octets des versions (corbeille comprise), et des envois pas encore rangés. */
export async function espaceDrive(base) {
  const f = await base.premier('SELECT COALESCE(SUM(taille), 0) AS n FROM cm_fichiers WHERE supprime_le IS NULL AND id IN (SELECT fichier_id FROM cm_drive_versions)', []);
  const e = await base.premier("SELECT COALESCE(SUM(taille), 0) AS n FROM envois WHERE usage = 'drive' AND fichier_id IS NULL", []);
  return { fichiers: Number(f?.n ?? 0), envois: Number(e?.n ?? 0) };
}

export async function lireReglagesDrive(base) {
  const l = await base.premier("SELECT valeur FROM cm_reglages WHERE cle = 'drive'", []);
  const v = jsonOu(l?.valeur, {});
  return {
    rangementVisuels: typeof v.rangementVisuels === 'boolean' ? v.rangementVisuels : REGLAGES_DEFAUT.rangementVisuels,
    rangementClips: typeof v.rangementClips === 'boolean' ? v.rangementClips : REGLAGES_DEFAUT.rangementClips,
    alerteLe: typeof v.alerteLe === 'string' ? v.alerteLe : null,
  };
}

const ecrireReglages = (valeur, compte, t) => ({
  sql: "INSERT INTO cm_reglages (cle, valeur, maj_par, maj_le) VALUES ('drive', ?, ?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur, maj_par = excluded.maj_par, maj_le = excluded.maj_le",
  params: [JSON.stringify(valeur), compte ?? null, iso(t)],
});

/**
 * Alerte d'espace : à partir de 80 % du quota, une notification aux gestionnaires du Drive (au plus une par
 * semaine). Rend vrai si une alerte part.
 */
export async function verifierAlerteDrive(base, { quota, maintenant = Date.now() } = {}) {
  if (!quota) return false;
  const u = await espaceDrive(base);
  const part = u.fichiers / quota;
  if (part < SEUIL_ALERTE) return false;
  const r = await lireReglagesDrive(base);
  if (r.alerteLe && maintenant - Date.parse(r.alerteLe) < DELAI_ALERTE_MS) return false;
  await base.lot([
    ecrireReglages({ rangementVisuels: r.rangementVisuels, rangementClips: r.rangementClips, alerteLe: iso(maintenant) }, null, maintenant),
    evenement('cm.drive_quota', { entiteType: 'cm_drive', entiteId: 'quota', charge: { utilise: u.fichiers, limite: quota, pourcent: Math.round(part * 100) }, maintenant }),
  ]);
  return true;
}

/** Efface définitivement un lot de la corbeille (lignes, puis octets qui ne servent plus). Rend le nombre de fichiers. */
async function purgerLot(base, stockage, lot, t) {
  const elements = (await base.tous('SELECT id FROM cm_drive_fichiers WHERE corbeille = ?', [lot])).map(l => l.id);
  const fichiers = new Set();
  for (const v of await lignesParIds(base, 'SELECT fichier_id FROM cm_drive_versions WHERE element_id', elements)) fichiers.add(v.fichier_id);
  const dossiers = (await base.tous('SELECT id FROM cm_drive_dossiers WHERE corbeille = ?', [lot])).map(l => l.id);
  const instr = [];
  for (const ids of [elements, dossiers]) {
    for (let i = 0; i < ids.length; i += 80) {
      const p = ids.slice(i, i + 80);
      instr.push({ sql: `DELETE FROM cm_drive_favoris WHERE element_id IN (${p.map(() => '?').join(', ')})`, params: p });
    }
  }
  for (let i = 0; i < elements.length; i += 80) {
    const p = elements.slice(i, i + 80);
    instr.push({ sql: `DELETE FROM cm_drive_tags WHERE element_id IN (${p.map(() => '?').join(', ')})`, params: p }, { sql: `DELETE FROM cm_drive_versions WHERE element_id IN (${p.map(() => '?').join(', ')})`, params: p });
  }
  // Liens de l'onglet DATA › Ressources liés à ces dossiers (migration 0044) : les liaisons disparaissent avec eux.
  for (let i = 0; i < dossiers.length; i += 80) {
    const p = dossiers.slice(i, i + 80);
    instr.push({ sql: `DELETE FROM cm_lien_liaisons WHERE genre = 'dossier' AND cible_id IN (${p.map(() => '?').join(', ')})`, params: p });
  }
  instr.push({ sql: 'DELETE FROM cm_drive_fichiers WHERE corbeille = ?', params: [lot] }, { sql: 'DELETE FROM cm_drive_dossiers WHERE corbeille = ?', params: [lot] });
  await base.lot(instr);
  for (const f of fichiers) await effacerFichierCmSiOrphelin(base, stockage, f, t);
  return elements.length;
}

/** Cron : vide ce qui est dans la corbeille depuis plus de 30 jours. Rend le nombre de lots effacés. */
export async function purgerCorbeilleDrive(base, stockage, { maintenant = Date.now(), duree = DUREE_CORBEILLE_MS, limite = 200 } = {}) {
  const avant = iso(maintenant - duree);
  const lots = new Set();
  for (const table of ['cm_drive_fichiers', 'cm_drive_dossiers']) {
    for (const l of await base.tous(`SELECT corbeille FROM ${table} WHERE corbeille_racine = 1 AND supprime_le IS NOT NULL AND supprime_le < ? ORDER BY supprime_le LIMIT ?`, [avant, limite])) if (l.corbeille) lots.add(l.corbeille);
  }
  for (const lot of lots) await purgerLot(base, stockage, lot, maintenant);
  return lots.size;
}

// ------------------------------------------------------------------ Service

export function servicesDriveCm({ base, maintenant = () => Date.now(), medias, cleSession, stockage, config = configDrive() }) {
  // ---------------------------------------------------------------- Contextes et arbre

  /** Droits Drive d'un ensemble de permissions CM (gérer ⇒ envoyer ⇒ voir) ; `membre` : membre actif de la team. */
  const droitsDe = (permissions, portee, membre) => {
    const gerer = permissions.has('cm.drive.gerer');
    const envoyer = gerer || permissions.has('cm.drive.envoyer');
    const voir = envoyer || permissions.has('cm.drive.voir');
    const depot = !voir && portee !== PORTEE_CLUB && Boolean(membre) && (permissions.has('cm.clips.proposer') || permissions.has('cm.deposer'));
    return { voir, envoyer, gerer, depot };
  };

  /** Contexte Drive : 404 (portée invisible, commun.mjs), 403 sans aucun droit sur le Drive de la portée. */
  async function ctxDrive(acteur, portee) {
    const ctx = await contexteCm(base, acteur, lirePortee(portee ?? PORTEE_CLUB));
    const drive = droitsDe(ctx.permissions, ctx.portee, ctx.membre);
    if (!drive.voir && !drive.depot) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    return { ...ctx, drive };
  }

  const exigerEnvoi = dc => {
    if (!dc.drive.envoyer && !dc.drive.depot) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
  };
  const exigerGerer = dc => {
    if (!dc.drive.gerer) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
  };

  /** Dossiers par défaut de la portée, créés au premier passage (sans doublon : index unique portée + clé). */
  async function assurerDossiers(portee) {
    const cles = DOSSIERS_DEFAUT[portee === PORTEE_CLUB ? 'club' : 'team'];
    const existants = new Set((await base.tous('SELECT cle FROM cm_drive_dossiers WHERE portee = ? AND cle IS NOT NULL', [portee])).map(l => l.cle));
    const manquants = cles.filter(c => !existants.has(c));
    if (!manquants.length) return;
    const t = iso(maintenant());
    await base.lot(
      manquants.map(cle => ({
        sql: 'INSERT INTO cm_drive_dossiers (id, portee, team_id, parent_id, nom, cle, restreint, cree_le, maj_le) VALUES (?, ?, ?, NULL, NULL, ?, 0, ?, ?) ON CONFLICT DO NOTHING',
        params: [nouvelId(), portee, teamDePortee(portee), cle, t, t],
      })),
    );
  }

  /** Arbre des dossiers de la portée : `Map(id → ligne)` (hors corbeille, sauf `avecCorbeille`). */
  async function arbre(portee, { avecCorbeille = false } = {}) {
    const lignes = await base.tous(`SELECT * FROM cm_drive_dossiers WHERE portee = ? ${avecCorbeille ? '' : 'AND supprime_le IS NULL'} ORDER BY cree_le, id LIMIT ?`, [portee, DOSSIERS_MAX * 2]);
    return new Map(lignes.map(d => [d.id, d]));
  }

  /** Chaîne des ancêtres (racine d'abord, le dossier compris), ou null si un parent manque (corbeille). */
  function chaine(map, d) {
    const sortie = [];
    let x = d;
    for (let n = 0; x && n <= PROFONDEUR_MAX + 2; n++) {
      sortie.unshift(x);
      if (!x.parent_id) return sortie;
      x = map.get(x.parent_id);
    }
    return null;
  }

  const depotDe = map => [...map.values()].find(d => d.cle === 'depot') ?? null;

  /** Le dossier est-il accessible (chaîne complète, aucun ancêtre restreint pour qui ne gère pas, dépôt) ? */
  function dossierAccessible(dc, map, d) {
    if (!d) return false;
    const c = chaine(map, d);
    if (!c) return false;
    if (!dc.drive.gerer && c.some(x => Number(x.restreint) === 1)) return false;
    if (dc.drive.depot) return d.cle === 'depot' && !d.parent_id;
    return true;
  }

  function fichierAccessible(dc, map, f) {
    if (f.dossier_id) {
      if (!dossierAccessible(dc, map, map.get(f.dossier_id))) return false;
    } else if (dc.drive.depot) return false;
    if (dc.drive.depot) return f.cree_par === dc.acteur.compte;
    return true;
  }

  const peutModifierFichier = (dc, f) => dc.drive.gerer || ((dc.drive.envoyer || dc.drive.depot) && f.cree_par === dc.acteur.compte);
  const peutModifierDossier = (dc, d) => dc.drive.gerer || (dc.drive.envoyer && d.cree_par === dc.acteur.compte && !d.cle);

  /** Fichier visible de l'acteur (404 sinon) : `{ f, dc, map }`. `corbeille` : accepte un fichier à la corbeille (gestionnaires). */
  async function fichierVisible(acteur, id, { corbeille = false } = {}) {
    exigerUuid(id, 'fichier');
    const f = await base.premier('SELECT * FROM cm_drive_fichiers WHERE id = ?', [id]);
    if (!f) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    let dc;
    try {
      dc = await ctxDrive(acteur, f.portee);
    } catch {
      throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    }
    if (f.supprime_le) {
      if (!corbeille || !dc.drive.gerer) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
      return { f, dc, map: await arbre(f.portee, { avecCorbeille: true }) };
    }
    const map = await arbre(f.portee);
    if (!fichierAccessible(dc, map, f)) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    return { f, dc, map };
  }

  async function dossierVisible(acteur, id) {
    exigerUuid(id, 'dossier');
    const d = await base.premier('SELECT * FROM cm_drive_dossiers WHERE id = ? AND supprime_le IS NULL', [id]);
    if (!d) throw echec(404, 'dossier-introuvable', 'Dossier introuvable.');
    let dc;
    try {
      dc = await ctxDrive(acteur, d.portee);
    } catch {
      throw echec(404, 'dossier-introuvable', 'Dossier introuvable.');
    }
    const map = await arbre(d.portee);
    if (!dossierAccessible(dc, map, d)) throw echec(404, 'dossier-introuvable', 'Dossier introuvable.');
    return { d, dc, map };
  }

  /** Dossier cible d'un dépôt / déplacement (null : racine), accessible et de la même portée. */
  function dossierCible(dc, map, id) {
    if (id === null || id === undefined || id === '') {
      if (dc.drive.depot) {
        const depot = depotDe(map);
        if (!depot) throw echec(404, 'dossier-introuvable', 'Dossier introuvable.');
        return depot;
      }
      return null;
    }
    exigerUuid(id, 'dossier');
    const d = map.get(id);
    if (!d || !dossierAccessible(dc, map, d)) throw echec(404, 'dossier-introuvable', 'Dossier introuvable.');
    return d;
  }

  /**
   * Dossiers que l'acteur peut voir parmi `ids` (liens de DATA › Ressources, migration 0044) : `Map(id → { id, nom, portee,
   * chemin, modifier })`. Un dossier supprimé, à la corbeille, restreint (pour qui ne gère pas) ou d'une portée fermée
   * au compte est absent ; `modifier` : peut y ranger (envoyer ou gérer).
   */
  async function dossiersAccessibles(acteur, ids) {
    const sortie = new Map();
    const lignes = await lignesParIds(base, 'SELECT id, portee FROM cm_drive_dossiers WHERE supprime_le IS NULL AND id', ids);
    for (const portee of new Set(lignes.map(l => l.portee))) {
      const dc = await ctxDrive(acteur, portee).catch(() => null);
      if (!dc?.drive.voir) continue;
      const map = await arbre(portee);
      for (const l of lignes) {
        const d = l.portee === portee ? map.get(l.id) : null;
        if (!d || !dossierAccessible(dc, map, d)) continue;
        sortie.set(d.id, { id: d.id, nom: nomAffiche(d), portee, chemin: chaine(map, d).map(nomAffiche), modifier: dc.drive.envoyer });
      }
    }
    return sortie;
  }

  /** Descendants d'un dossier (lui compris), dans l'arbre donné. */
  function descendants(map, id) {
    const enfants = new Map();
    for (const d of map.values()) {
      const p = d.parent_id ?? null;
      if (!enfants.has(p)) enfants.set(p, []);
      enfants.get(p).push(d.id);
    }
    const sortie = [];
    const pile = [id];
    while (pile.length && sortie.length <= DOSSIERS_MAX * 2) {
      const x = pile.pop();
      sortie.push(x);
      pile.push(...(enfants.get(x) ?? []));
    }
    return sortie;
  }

  const contexteEnvoi = dc => ({ acteur: dc.acteur, team: { id: teamDePortee(dc.portee) }, portee: dc.portee });

  // Envois par morceaux du Drive (usage « drive ») : déposer dans la portée, plafond par fichier, quota.
  medias?.brancherContexte('drive', async (acteur, portee) => {
    const dc = await ctxDrive(acteur, portee);
    exigerEnvoi(dc);
    return {
      ...contexteEnvoi(dc),
      plafond: config.fichierMax,
      avantEnvoi: async taille => {
        const u = await espaceDrive(base);
        if (u.fichiers + u.envois + taille > config.quota) {
          const e = echec(413, 'quota-drive', 'L’espace du Drive est plein : videz la corbeille ou supprimez des fichiers.');
          e.details = { utilise: u.fichiers, enCours: u.envois, limite: config.quota };
          throw e;
        }
      },
    };
  });

  // ---------------------------------------------------------------- Présentation

  async function quota() {
    const u = await espaceDrive(base);
    const part = config.quota ? u.fichiers / config.quota : 0;
    return { utilise: u.fichiers, enCours: u.envois, limite: config.quota, pourcent: Math.round(part * 1000) / 10, alerte: part >= SEUIL_ALERTE, fichierMax: config.fichierMax, zipMax: config.zipMax };
  }

  async function lienVersion(compte, elementId, version, { telecharger = false } = {}) {
    const { chemin, expire } = await cheminSigne(cleSession, { fichierId: `${elementId}.${version}`, compte, maintenant: maintenant(), duree: DUREE_LIEN_DRIVE_MS, telecharger, genre: 'drive' });
    return { chemin, expire };
  }

  const metaPublique = f => {
    const m = jsonOu(f.meta, {});
    return {
      format: m.format ?? null,
      nomFormat: FORMATS[m.format]?.nom ?? null,
      largeur: Number.isFinite(m.largeur) ? m.largeur : null,
      hauteur: Number.isFinite(m.hauteur) ? m.hauteur : null,
      duree: Number.isFinite(m.duree) ? m.duree : null,
      codecVideo: m.codecVideo ?? null,
      codecAudio: m.codecAudio ?? null,
    };
  };

  async function fichiersPublics(dc, lignes, { origine = '' } = {}) {
    const ids = lignes.map(f => f.id);
    const tags = new Map();
    for (const l of await lignesParIds(base, 'SELECT element_id, tag FROM cm_drive_tags WHERE element_id', ids)) {
      if (!tags.has(l.element_id)) tags.set(l.element_id, []);
      tags.get(l.element_id).push(l.tag);
    }
    const favoris = new Set((await lignesParIds(base, 'SELECT element_id FROM cm_drive_favoris WHERE compte_id = ? AND element_id', ids, { paramsAvant: [dc.acteur.compte] })).map(l => l.element_id));
    const sortie = [];
    for (const f of lignes) {
      const meta = metaPublique(f);
      let vignette = null;
      if (!f.supprime_le && FORMATS_VIGNETTE.includes(meta.format) && Number(f.taille) <= VIGNETTE_TAILLE_MAX) {
        vignette = `${origine}${(await lienVersion(dc.acteur.compte, f.id, Number(f.version))).chemin}`;
      }
      sortie.push({
        id: f.id,
        portee: f.portee,
        dossierId: f.dossier_id ?? null,
        nom: f.nom,
        genre: f.genre,
        type: f.type_mime,
        taille: Number(f.taille),
        version: Number(f.version),
        meta,
        tags: (tags.get(f.id) ?? []).sort(),
        favori: favoris.has(f.id),
        origine: f.origine,
        creePar: f.cree_par ?? null,
        creeLe: f.cree_le,
        majPar: f.maj_par ?? null,
        majLe: f.maj_le,
        vignette,
        modifiable: peutModifierFichier(dc, f),
        ...(f.supprime_le ? { supprimeLe: f.supprime_le, supprimePar: f.supprime_par ?? null } : {}),
      });
    }
    return sortie;
  }

  async function dossiersPublics(dc, lignes) {
    const ids = lignes.map(d => d.id);
    const favoris = new Set((await lignesParIds(base, 'SELECT element_id FROM cm_drive_favoris WHERE compte_id = ? AND element_id', ids, { paramsAvant: [dc.acteur.compte] })).map(l => l.element_id));
    const n = new Map();
    for (const l of await lignesParIds(base, 'SELECT dossier_id, COUNT(*) AS n FROM cm_drive_fichiers WHERE supprime_le IS NULL AND dossier_id', ids, { apres: 'GROUP BY dossier_id' })) n.set(l.dossier_id, Number(l.n));
    return lignes.map(d => ({
      id: d.id,
      portee: d.portee,
      parentId: d.parent_id ?? null,
      nom: d.nom ?? null,
      cle: d.cle ?? null,
      restreint: Number(d.restreint) === 1,
      fichiers: n.get(d.id) ?? 0,
      favori: favoris.has(d.id),
      creePar: d.cree_par ?? null,
      creeLe: d.cree_le,
      majLe: d.maj_le,
      modifiable: peutModifierDossier(dc, d),
      systeme: Boolean(d.cle),
      ...(d.supprime_le ? { supprimeLe: d.supprime_le, supprimePar: d.supprime_par ?? null } : {}),
    }));
  }

  const nomAffiche = d => d.nom ?? NOMS_DOSSIERS_DEFAUT[d.cle] ?? 'Dossier';

  // ---------------------------------------------------------------- Lectures

  /** `GET /cm/drive/portees` : portées où l'acteur a un Drive (ou le dépôt des joueurs), quota. */
  async function portees(acteur) {
    const p = await porteesDe(base, acteur);
    const membres = acteur.compte ? new Set((await base.tous("SELECT team_id FROM membres WHERE compte_id = ? AND statut = 'actif'", [acteur.compte])).map(l => l.team_id)) : new Set();
    const sortie = [];
    const club = droitsDe(p.club, PORTEE_CLUB, null);
    if (club.voir) sortie.push({ portee: PORTEE_CLUB, team: null, droits: club });
    for (const [id, s] of p.teams) {
      const d = droitsDe(s, id, membres.has(id));
      if (d.voir || d.depot) sortie.push({ portee: id, team: p.noms.get(id) ?? { id, nom: null }, droits: d });
    }
    if (!sortie.length) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const gerer = sortie.some(x => x.droits.gerer);
    return { portees: sortie, quota: gerer ? await quota() : null, reglages: club.gerer ? await reglagesPublics() : null };
  }

  /**
   * `GET /cm/drive?portee&dossier` : contenu d'un dossier (racine sans `dossier`), fil d'Ariane, droits, quota.
   * Dépôt des joueurs : directement leur dossier, avec leurs seuls fichiers.
   */
  async function lister(acteur, { portee, dossier, origine = '', vu = false } = {}) {
    const dc = await ctxDrive(acteur, portee);
    await assurerDossiers(dc.portee);
    const map = await arbre(dc.portee);
    let courant = null;
    if (dossier) {
      exigerUuid(dossier, 'dossier');
      courant = map.get(dossier) ?? null;
      if (!courant || !dossierAccessible(dc, map, courant)) throw echec(404, 'dossier-introuvable', 'Dossier introuvable.');
    } else if (dc.drive.depot) courant = depotDe(map);
    const sousDossiers = dc.drive.depot ? [] : [...map.values()].filter(d => (d.parent_id ?? null) === (courant?.id ?? null) && dossierAccessible(dc, map, d));
    const conditions = ['portee = ?', 'supprime_le IS NULL', courant ? 'dossier_id = ?' : 'dossier_id IS NULL'];
    const params = [dc.portee, ...(courant ? [courant.id] : [])];
    if (dc.drive.depot) {
      conditions.push('cree_par = ?');
      params.push(acteur.compte);
    }
    const lignes = await base.tous(`SELECT * FROM cm_drive_fichiers WHERE ${conditions.join(' AND ')} ORDER BY nom_cle, id LIMIT ?`, [...params, FICHIERS_LISTE_MAX]);
    const fichiers = await fichiersPublics(dc, lignes, { origine });
    const dossiers = await dossiersPublics(dc, sousDossiers);
    const noms = await pseudosDe(base, [...fichiers.flatMap(f => [f.creePar, f.majPar]), ...dossiers.map(d => d.creePar)].filter(Boolean));
    const c = courant ? (chaine(map, courant) ?? []) : [];
    // Ouverture par l'écran du Drive (`vu`) : le dossier est marqué vu, puis les compteurs de nouveautés suivent.
    let nouveautes = null;
    if (vu && acteur.compte) {
      await marquer(acteur.compte, dc.portee, courant?.id ?? CLE_RACINE);
      nouveautes = publierNouveautes(await calculerNouveautes(dc, map));
    }
    return {
      portee: dc.portee,
      nouveautes,
      team: dc.team ? { id: dc.team.id, nom: dc.team.nom } : null,
      droits: dc.drive,
      dossier: courant ? (await dossiersPublics(dc, [courant]))[0] : null,
      chemin: c.map(d => ({ id: d.id, nom: d.nom ?? null, cle: d.cle ?? null })),
      dossiers,
      fichiers,
      noms,
      tronque: lignes.length >= FICHIERS_LISTE_MAX,
      quota: await quota(),
    };
  }

  /** `GET /cm/drive/arbre?portee` : tous les dossiers accessibles (choix d'une destination). */
  async function arborescence(acteur, { portee } = {}) {
    const dc = await ctxDrive(acteur, portee);
    await assurerDossiers(dc.portee);
    const map = await arbre(dc.portee);
    const visibles = [...map.values()].filter(d => dossierAccessible(dc, map, d));
    return { portee: dc.portee, dossiers: visibles.map(d => ({ id: d.id, parentId: d.parent_id ?? null, nom: d.nom ?? null, cle: d.cle ?? null, restreint: Number(d.restreint) === 1 })) };
  }

  /** `GET /cm/drive/filtres?portee` : étiquettes et auteurs des fichiers visibles (filtres de la recherche). */
  async function filtres(acteur, { portee } = {}) {
    const dc = await ctxDrive(acteur, portee);
    const map = await arbre(dc.portee);
    const lignes = (await base.tous('SELECT id, dossier_id, cree_par FROM cm_drive_fichiers WHERE portee = ? AND supprime_le IS NULL LIMIT 20000', [dc.portee])).filter(f => fichierAccessible(dc, map, f));
    const ids = new Set(lignes.map(f => f.id));
    const compte = new Map();
    for (const l of await base.tous('SELECT t.element_id, t.tag FROM cm_drive_tags t JOIN cm_drive_fichiers f ON f.id = t.element_id WHERE f.portee = ? AND f.supprime_le IS NULL', [dc.portee])) {
      if (ids.has(l.element_id)) compte.set(l.tag, (compte.get(l.tag) ?? 0) + 1);
    }
    const auteurs = [...new Set(lignes.map(f => f.cree_par).filter(Boolean))];
    const noms = await pseudosDe(base, auteurs);
    return {
      tags: [...compte].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag)),
      auteurs: auteurs.map(c => ({ compte: c, pseudo: noms[c] ?? null })).sort((a, b) => String(a.pseudo).localeCompare(String(b.pseudo))),
      genres: GENRES,
    };
  }

  /**
   * `GET /cm/drive/recherche?portee&q&genre&tag&auteur&du&au&favoris&dossier` : fichiers (et dossiers dont le
   * nom correspond) visibles de la portée, `dossier` : dans ce dossier et ses sous-dossiers.
   */
  async function rechercher(acteur, q = {}) {
    const dc = await ctxDrive(acteur, q.portee);
    const map = await arbre(dc.portee);
    const conditions = ['portee = ?', 'supprime_le IS NULL'];
    const params = [dc.portee];
    const mots = cleRecherche(q.q).split(' ').filter(Boolean).slice(0, 6);
    for (const m of mots) {
      conditions.push('nom_cle LIKE ?');
      params.push(`%${m}%`);
    }
    if (q.genre) {
      if (!GENRES.includes(q.genre)) throw echec(400, 'genre', 'Type inconnu.');
      conditions.push('genre = ?');
      params.push(q.genre);
    }
    if (q.tag) {
      const t = lireTags([q.tag]);
      if (!t?.length) throw echec(400, 'tag', 'Étiquette illisible.');
      conditions.push('id IN (SELECT element_id FROM cm_drive_tags WHERE tag = ?)');
      params.push(t[0]);
    }
    if (q.auteur) {
      if (!MOTIF_COMPTE.test(q.auteur)) throw echec(400, 'auteur', 'Auteur inconnu.');
      conditions.push('cree_par = ?');
      params.push(q.auteur);
    }
    if (q.du) {
      if (!MOTIF_JOUR.test(q.du)) throw echec(400, 'date', 'Date : AAAA-MM-JJ.');
      conditions.push('cree_le >= ?');
      params.push(`${q.du}T00:00:00.000Z`);
    }
    if (q.au) {
      if (!MOTIF_JOUR.test(q.au)) throw echec(400, 'date', 'Date : AAAA-MM-JJ.');
      conditions.push('cree_le <= ?');
      params.push(`${q.au}T23:59:59.999Z`);
    }
    if (q.favoris) {
      conditions.push('id IN (SELECT element_id FROM cm_drive_favoris WHERE compte_id = ?)');
      params.push(acteur.compte);
    }
    let dans = null;
    if (q.dossier) {
      exigerUuid(q.dossier, 'dossier');
      const d = map.get(q.dossier);
      if (!d || !dossierAccessible(dc, map, d)) throw echec(404, 'dossier-introuvable', 'Dossier introuvable.');
      dans = new Set(descendants(map, d.id));
    }
    const lignes = (await base.tous(`SELECT * FROM cm_drive_fichiers WHERE ${conditions.join(' AND ')} ORDER BY maj_le DESC, id LIMIT 2000`, params))
      .filter(f => fichierAccessible(dc, map, f) && (!dans || dans.has(f.dossier_id)))
      .slice(0, 500);
    const filtreDossiers = !q.genre && !q.tag && !q.auteur && !q.du && !q.au && !dc.drive.depot;
    const favorisDossiers = q.favoris ? new Set((await base.tous("SELECT element_id FROM cm_drive_favoris WHERE compte_id = ? AND genre = 'dossier'", [acteur.compte])).map(l => l.element_id)) : null;
    const dossiers = filtreDossiers && (mots.length || favorisDossiers)
      ? [...map.values()].filter(d => dossierAccessible(dc, map, d) && (!dans || (dans.has(d.id) && d.id !== q.dossier)) && (!favorisDossiers || favorisDossiers.has(d.id)) && mots.every(m => cleRecherche(`${nomAffiche(d)} ${d.cle ?? ''}`).includes(m))).slice(0, 100)
      : [];
    const fichiers = await fichiersPublics(dc, lignes, { origine: q.origine ?? '' });
    const noms = await pseudosDe(base, fichiers.flatMap(f => [f.creePar, f.majPar]).filter(Boolean));
    const chemins = {};
    for (const id of new Set([...fichiers.map(f => f.dossierId), ...dossiers.map(d => d.parent_id)].filter(Boolean))) {
      chemins[id] = (chaine(map, map.get(id)) ?? []).map(d => ({ id: d.id, nom: d.nom ?? null, cle: d.cle ?? null }));
    }
    return { portee: dc.portee, droits: dc.drive, fichiers, dossiers: await dossiersPublics(dc, dossiers), noms, chemins };
  }

  /** `GET /cm/drive/fichiers/:id` : infos, versions, utilisations (cartes, visuels, sponsors), chemin. */
  async function detail(acteur, id, { origine = '' } = {}) {
    const { f, dc, map } = await fichierVisible(acteur, id, { corbeille: true });
    const [fichier] = await fichiersPublics(dc, [f], { origine });
    const versions = await base.tous('SELECT * FROM cm_drive_versions WHERE element_id = ? ORDER BY version DESC', [f.id]);
    const ids = [f.fichier_id];
    const pieces = await lignesParIds(base, 'SELECT p.id, c.id AS carte_id, c.titre, c.tableau_id FROM cm_pieces p JOIN cm_cartes c ON c.id = p.carte_id WHERE p.supprime_le IS NULL AND c.supprime_le IS NULL AND p.fichier_id', ids);
    const interdits = new Set(await lecteurTableaux(base, acteur).interdits());
    const visuels = await lignesParIds(base, 'SELECT id FROM cm_visuels WHERE supprime_le IS NULL AND fichier_id', ids);
    const sponsors = await lignesParIds(base, 'SELECT id FROM sp_pieces WHERE supprime_le IS NULL AND fichier_id', ids);
    const noms = await pseudosDe(base, [f.cree_par, f.maj_par, ...versions.map(v => v.cree_par)].filter(Boolean));
    return {
      fichier,
      chemin: f.dossier_id ? (chaine(map, map.get(f.dossier_id)) ?? []).map(d => ({ id: d.id, nom: d.nom ?? null, cle: d.cle ?? null })) : [],
      versions: versions.map(v => ({ version: Number(v.version), nom: v.nom, type: v.type_mime, taille: Number(v.taille), creePar: v.cree_par ?? null, creeLe: v.cree_le, actuelle: Number(v.version) === Number(f.version), meta: metaPublique(v) })),
      // Cartes d'un tableau restreint dont l'acteur n'est pas (migration 0046) : comptées, sans titre ni lien.
      utilisations: { cartes: pieces.filter(p => !interdits.has(p.tableau_id)).map(p => ({ id: p.carte_id, titre: p.titre, tableauId: p.tableau_id })), cartesMasquees: pieces.filter(p => interdits.has(p.tableau_id)).length, visuels: visuels.length, sponsors: sponsors.length },
      droits: { ...dc.drive, modifier: peutModifierFichier(dc, f) },
      noms,
    };
  }

  /** `GET /cm/drive/elements/:id` : où se trouve un élément (lien interne « drive:<id> ») ; 404 s'il n'est pas visible. */
  async function element(acteur, id) {
    exigerUuid(id, 'element');
    const f = await base.premier('SELECT id FROM cm_drive_fichiers WHERE id = ? AND supprime_le IS NULL', [id]);
    if (f) {
      const v = await fichierVisible(acteur, id);
      return { genre: 'fichier', id, portee: v.f.portee, dossierId: v.f.dossier_id ?? null };
    }
    const { d } = await dossierVisible(acteur, id).catch(() => {
      throw echec(404, 'element-introuvable', 'Élément introuvable (supprimé, ou vous n’y avez pas accès).');
    });
    return { genre: 'dossier', id, portee: d.portee, dossierId: d.id };
  }

  // ---------------------------------------------------------------- Infos d'un fichier

  async function metaDe(cle, format, analyse) {
    const m = { format };
    const pub = analysePublique(analyse);
    if (pub?.duree !== null && pub?.duree !== undefined) m.duree = pub.duree;
    if (pub?.codecVideo) m.codecVideo = pub.codecVideo;
    if (pub?.codecAudio) m.codecAudio = pub.codecAudio;
    try {
      if (['png', 'jpeg', 'gif', 'webp'].includes(format)) {
        const dim = dimensionsImage(await lireDebut(stockage, cle, OCTETS_ENTETE));
        if (dim) Object.assign(m, { largeur: dim.largeur, hauteur: dim.hauteur });
      } else if (format === 'psd') {
        const dim = dimensionsPsd(await lireDebut(stockage, cle, 64));
        if (dim) Object.assign(m, dim);
      } else if (format === 'svg') {
        const dim = dimensionsSvg(new TextDecoder().decode(await lireDebut(stockage, cle, 64 * 1024)));
        if (dim) Object.assign(m, dim);
      }
    } catch {
      // Infos facultatives : un en-tête illisible ne bloque pas le dépôt.
    }
    return m;
  }

  /** Nom d'une nouvelle version : l'extension de l'ancien format laisse la place à celle du nouveau. */
  function nomVersion(nomActuel, ancienFormat, nouveauFormat) {
    const ext = extensionDe(nomActuel);
    const radical = ext && (EXTENSIONS[ancienFormat] ?? []).includes(ext) && !(EXTENSIONS[nouveauFormat] ?? []).includes(ext) ? nomActuel.slice(0, -(ext.length + 1)) : nomActuel;
    return nomPourFormat(radical, nouveauFormat);
  }

  /**
   * Événement de bus `drive.ajout` (migration 0041) : signal pour le centre de notifications (format simple,
   * documenté dans docs/esport/drive.md). `acteur` null : rangement automatique sans auteur.
   */
  const evAjout = ({ portee, acteur, element, id, dossierId, genre, nom, version = 1, t }) =>
    evenement('drive.ajout', { teamId: teamDePortee(portee), acteur: acteur ?? null, entiteType: element === 'dossier' ? 'cm_drive_dossier' : 'cm_drive', entiteId: id, charge: { portee, dossierId: dossierId ?? null, element, type: genre === 'version' ? 'version' : element, genre, nom, version, auteur: acteur ?? null }, maintenant: t });

  const tagsInstr = (elementId, tags) => [{ sql: 'DELETE FROM cm_drive_tags WHERE element_id = ?', params: [elementId] }, ...tags.map(tag => ({ sql: 'INSERT INTO cm_drive_tags (element_id, tag) VALUES (?, ?)', params: [elementId, tag] }))];

  // ---------------------------------------------------------------- Fichiers

  /**
   * `POST /cm/drive/fichiers { portee, dossierId?, envoi, nom?, tags? }` : range un envoi terminé (usage « drive »)
   * dans un dossier. Rend le fichier.
   */
  async function ajouter(acteur, corps, { origine = '' } = {}) {
    const dc = await ctxDrive(acteur, corps?.portee);
    exigerEnvoi(dc);
    if (!medias) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché sur le serveur Esport.');
    await assurerDossiers(dc.portee);
    const map = await arbre(dc.portee);
    const dossier = dossierCible(dc, map, corps?.dossierId);
    const tags = lireTags(corps?.tags);
    if (tags === null) throw echec(400, 'tags', 'Étiquettes : 12 au plus, texte court.');
    const id = nouvelId();
    const r = await medias.preparerRattachement(contexteEnvoi(dc), corps?.envoi, 'drive', { entiteType: 'cm_drive', entiteId: id });
    const format = r.analyse?.format;
    if (!FORMATS_PERMIS.drive.includes(format)) throw echec(415, 'format-fichier', 'Type de fichier refusé.');
    const nom = nomPourFormat(typeof corps?.nom === 'string' && corps.nom.trim() ? corps.nom : r.envoi.nom_original, format);
    const meta = JSON.stringify(await metaDe(r.envoi.cle_stockage, format, r.analyse));
    const mime = FORMATS[format].mime;
    const t = maintenant();
    await base.lot([
      ...r.instructions,
      {
        sql: `INSERT INTO cm_drive_fichiers (id, portee, team_id, dossier_id, nom, nom_cle, fichier_id, version, type_mime, genre, taille, meta, origine, cree_par, cree_le, maj_par, maj_le)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'envoi', ?, ?, ?, ?)`,
        params: [id, dc.portee, teamDePortee(dc.portee), dossier?.id ?? null, nom, cleRecherche(nom), r.fichierId, mime, genreDe(format), Number(r.envoi.taille), meta, acteur.compte, iso(t), acteur.compte, iso(t)],
      },
      { sql: 'INSERT INTO cm_drive_versions (id, element_id, version, fichier_id, nom, type_mime, taille, meta, cree_par, cree_le) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)', params: [nouvelId(), id, r.fichierId, nom, mime, Number(r.envoi.taille), meta, acteur.compte, iso(t)] },
      ...tagsInstr(id, tags),
      evenement('cm.drive_fichier_ajoute', { teamId: teamDePortee(dc.portee), acteur: acteur.compte, entiteType: 'cm_drive', entiteId: id, charge: { nom, portee: dc.portee, taille: Number(r.envoi.taille), dossier: dossier ? nomAffiche(dossier) : null }, maintenant: t }),
      evAjout({ portee: dc.portee, acteur: acteur.compte, element: 'fichier', id, dossierId: dossier?.id, genre: 'ajout', nom, t }),
    ]);
    await verifierAlerteDrive(base, { quota: config.quota, maintenant: t }).catch(() => false);
    const f = await base.premier('SELECT * FROM cm_drive_fichiers WHERE id = ?', [id]);
    return { fichier: (await fichiersPublics(dc, [f], { origine }))[0] };
  }

  // ---------------------------------------------------------------- Étiquettes (tags) de la portée

  const lireUnTag = (v, code) => {
    const t = typeof v === 'string' ? lireTags([v]) : null;
    if (!t?.length) throw echec(400, code, 'Étiquette illisible.');
    return t[0];
  };
  const nbFichiersTag = async (portee, tag) => Number((await base.premier('SELECT COUNT(*) AS n FROM cm_drive_tags WHERE tag = ? AND element_id IN (SELECT id FROM cm_drive_fichiers WHERE portee = ?)', [tag, portee]))?.n ?? 0);

  /**
   * `PATCH /cm/drive/tags { portee, tag, nom }` (cm.drive.gerer) : renomme l'étiquette sur tous les fichiers de la
   * portée (corbeille comprise). Si `nom` existe déjà, les deux étiquettes sont fusionnées.
   */
  async function renommerTag(acteur, corps) {
    const dc = await ctxDrive(acteur, corps?.portee);
    exigerGerer(dc);
    const tag = lireUnTag(corps?.tag, 'tag');
    const nom = lireUnTag(corps?.nom, 'nom');
    const fichiers = await nbFichiersTag(dc.portee, tag);
    if (!fichiers) throw echec(404, 'tag-introuvable', 'Étiquette introuvable.');
    if (nom === tag) return { ok: true, fichiers };
    const t = maintenant();
    await base.lot([
      { sql: 'DELETE FROM cm_drive_tags WHERE tag = ? AND element_id IN (SELECT id FROM cm_drive_fichiers WHERE portee = ?) AND element_id IN (SELECT element_id FROM cm_drive_tags WHERE tag = ?)', params: [tag, dc.portee, nom] },
      { sql: 'UPDATE cm_drive_tags SET tag = ? WHERE tag = ? AND element_id IN (SELECT id FROM cm_drive_fichiers WHERE portee = ?)', params: [nom, tag, dc.portee] },
      evenement('cm.drive_tag_renomme', { teamId: teamDePortee(dc.portee), acteur: acteur.compte, entiteType: 'cm_drive', entiteId: dc.portee, charge: { tag, nom, fichiers, portee: dc.portee }, maintenant: t }),
    ]);
    return { ok: true, fichiers };
  }

  /** `DELETE /cm/drive/tags?portee&tag` (cm.drive.gerer) : retire l'étiquette de tous les fichiers de la portée (définitif). */
  async function supprimerTag(acteur, { portee, tag } = {}) {
    const dc = await ctxDrive(acteur, portee);
    exigerGerer(dc);
    const nom = lireUnTag(tag, 'tag');
    const fichiers = await nbFichiersTag(dc.portee, nom);
    if (!fichiers) throw echec(404, 'tag-introuvable', 'Étiquette introuvable.');
    await base.lot([
      { sql: 'DELETE FROM cm_drive_tags WHERE tag = ? AND element_id IN (SELECT id FROM cm_drive_fichiers WHERE portee = ?)', params: [nom, dc.portee] },
      evenement('cm.drive_tag_supprime', { teamId: teamDePortee(dc.portee), acteur: acteur.compte, entiteType: 'cm_drive', entiteId: dc.portee, charge: { tag: nom, fichiers, portee: dc.portee }, maintenant: maintenant() }),
    ]);
    return { ok: true, fichiers };
  }

  /** `PATCH /cm/drive/fichiers/:id { nom?, dossierId?, tags? }` : renommer, déplacer (même portée), étiqueter. */
  async function modifierFichier(acteur, id, corps) {
    const { f, dc, map } = await fichierVisible(acteur, id);
    if (!peutModifierFichier(dc, f)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const champs = {};
    if (corps?.nom !== undefined) {
      if (typeof corps.nom !== 'string' || !corps.nom.trim()) throw echec(400, 'nom', 'Nom du fichier : obligatoire.');
      const nom = nomPourFormat(corps.nom, jsonOu(f.meta, {}).format);
      champs.nom = nom;
      champs.nom_cle = cleRecherche(nom);
    }
    if (corps?.dossierId !== undefined) {
      if (dc.drive.depot) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
      champs.dossier_id = dossierCible(dc, map, corps.dossierId)?.id ?? null;
    }
    const lot = [];
    if (corps?.tags !== undefined) {
      const tags = lireTags(corps.tags);
      if (tags === null) throw echec(400, 'tags', 'Étiquettes : 12 au plus, texte court.');
      lot.push(...tagsInstr(f.id, tags));
    }
    const t = maintenant();
    const cles = Object.keys(champs);
    lot.unshift({ sql: `UPDATE cm_drive_fichiers SET ${[...cles.map(k => `${k} = ?`), 'maj_par = ?', 'maj_le = ?'].join(', ')} WHERE id = ?`, params: [...cles.map(k => champs[k]), acteur.compte, iso(t), f.id] });
    if (champs.nom !== undefined || champs.dossier_id !== undefined) {
      lot.push(evenement('cm.drive_fichier_modifie', { teamId: teamDePortee(f.portee), acteur: acteur.compte, entiteType: 'cm_drive', entiteId: f.id, charge: { nom: champs.nom ?? f.nom, ancien: champs.nom ? f.nom : null, deplace: champs.dossier_id !== undefined }, maintenant: t }));
    }
    await base.lot(lot);
    if (champs.dossier_id) await resserrerNotifications(map, null, f.id);
    return detail(acteur, f.id);
  }

  /** Copie (même octets, nouvel élément) dans un dossier de la même portée ou d'une autre où l'on peut déposer. */
  async function copierFichier(acteur, id, corps) {
    const { f } = await fichierVisible(acteur, id);
    const dest = await ctxDrive(acteur, corps?.portee ?? f.portee);
    if (!dest.drive.envoyer) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    await assurerDossiers(dest.portee);
    const map = await arbre(dest.portee);
    const dossier = dossierCible(dest, map, corps?.dossierId ?? null);
    const pris = new Set((await base.tous(`SELECT nom FROM cm_drive_fichiers WHERE portee = ? AND supprime_le IS NULL AND ${dossier ? 'dossier_id = ?' : 'dossier_id IS NULL'}`, [dest.portee, ...(dossier ? [dossier.id] : [])])).map(l => l.nom.toLowerCase()));
    const nom = nomUnique(f.nom, pris);
    const nouveau = nouvelId();
    const t = maintenant();
    const tags = (await base.tous('SELECT tag FROM cm_drive_tags WHERE element_id = ?', [f.id])).map(l => l.tag);
    await base.lot([
      {
        sql: `INSERT INTO cm_drive_fichiers (id, portee, team_id, dossier_id, nom, nom_cle, fichier_id, version, type_mime, genre, taille, meta, origine, origine_id, cree_par, cree_le, maj_par, maj_le)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'copie', ?, ?, ?, ?, ?)`,
        params: [nouveau, dest.portee, teamDePortee(dest.portee), dossier?.id ?? null, nom, cleRecherche(nom), f.fichier_id, f.type_mime, f.genre, Number(f.taille), f.meta, f.id, acteur.compte, iso(t), acteur.compte, iso(t)],
      },
      { sql: 'INSERT INTO cm_drive_versions (id, element_id, version, fichier_id, nom, type_mime, taille, meta, cree_par, cree_le) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)', params: [nouvelId(), nouveau, f.fichier_id, nom, f.type_mime, Number(f.taille), f.meta, acteur.compte, iso(t)] },
      ...tagsInstr(nouveau, tags),
      evenement('cm.drive_fichier_ajoute', { teamId: teamDePortee(dest.portee), acteur: acteur.compte, entiteType: 'cm_drive', entiteId: nouveau, charge: { nom, portee: dest.portee, copie: true }, maintenant: t }),
      evAjout({ portee: dest.portee, acteur: acteur.compte, element: 'fichier', id: nouveau, dossierId: dossier?.id, genre: 'copie', nom, t }),
    ]);
    return { id: nouveau };
  }

  /** `POST /cm/drive/fichiers/:id/versions { envoi }` : remplace le fichier, l'ancienne version reste dans l'historique. */
  async function nouvelleVersion(acteur, id, corps) {
    const { f, dc } = await fichierVisible(acteur, id);
    if (!peutModifierFichier(dc, f)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    if (!medias) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché sur le serveur Esport.');
    if (corps?.version !== undefined && Number(corps.version) !== Number(f.version)) throw echec(409, 'conflit', 'Ce fichier a changé entre-temps : rechargez-le.');
    const r = await medias.preparerRattachement(contexteEnvoi(dc), corps?.envoi, 'drive', { entiteType: 'cm_drive', entiteId: f.id });
    const format = r.analyse?.format;
    if (!FORMATS_PERMIS.drive.includes(format)) throw echec(415, 'format-fichier', 'Type de fichier refusé.');
    const nom = nomVersion(f.nom, jsonOu(f.meta, {}).format, format);
    const meta = JSON.stringify(await metaDe(r.envoi.cle_stockage, format, r.analyse));
    await enregistrerVersion(acteur, f, { fichierId: r.fichierId, nom, mime: FORMATS[format].mime, genre: genreDe(format), taille: Number(r.envoi.taille), meta, instructions: r.instructions });
    await verifierAlerteDrive(base, { quota: config.quota, maintenant: maintenant() }).catch(() => false);
    return detail(acteur, f.id);
  }

  /** Nouvelle version d'un élément (instructions du rattachement comprises), puis élagage de l'historique. */
  async function enregistrerVersion(acteur, f, { fichierId, nom, mime, genre, taille, meta, instructions = [], restauree = null }) {
    const v = Number(f.version) + 1;
    const t = maintenant();
    const res = await base.lot([
      ...instructions,
      { sql: 'INSERT INTO cm_drive_versions (id, element_id, version, fichier_id, nom, type_mime, taille, meta, cree_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', params: [nouvelId(), f.id, v, fichierId, nom, mime, taille, meta, acteur?.compte ?? null, iso(t)] },
      {
        sql: 'UPDATE cm_drive_fichiers SET fichier_id = ?, version = ?, nom = ?, nom_cle = ?, type_mime = ?, genre = ?, taille = ?, meta = ?, maj_par = ?, maj_le = ? WHERE id = ? AND version = ?',
        params: [fichierId, v, nom, cleRecherche(nom), mime, genre, taille, meta, acteur?.compte ?? null, iso(t), f.id, Number(f.version)],
      },
      evenement('cm.drive_version_ajoutee', { teamId: teamDePortee(f.portee), acteur: acteur?.compte ?? null, entiteType: 'cm_drive', entiteId: f.id, charge: { nom, version: v, restauree }, maintenant: t }),
      evAjout({ portee: f.portee, acteur: acteur?.compte, element: 'fichier', id: f.id, dossierId: f.dossier_id, genre: 'version', nom, version: v, t }),
    ]);
    if (res[instructions.length + 1]?.changements !== 1) throw echec(409, 'conflit', 'Ce fichier a changé entre-temps : rechargez-le.');
    // Historique borné : les plus anciennes versions partent (leurs octets aussi s'ils ne servent plus).
    const vieilles = await base.tous('SELECT id, fichier_id FROM cm_drive_versions WHERE element_id = ? AND version < ? ORDER BY version DESC', [f.id, v]);
    for (const x of vieilles.slice(VERSIONS_MAX - 1)) {
      await base.executer('DELETE FROM cm_drive_versions WHERE id = ?', [x.id]);
      await effacerFichierCmSiOrphelin(base, stockage, x.fichier_id, t);
    }
    return v;
  }

  /** `POST /cm/drive/fichiers/:id/versions/:v/restaurer` : l'ancienne version redevient la version actuelle (une nouvelle). */
  async function restaurerVersion(acteur, id, version) {
    const { f, dc } = await fichierVisible(acteur, id);
    if (!peutModifierFichier(dc, f)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const n = Number(version);
    const v = Number.isSafeInteger(n) ? await base.premier('SELECT * FROM cm_drive_versions WHERE element_id = ? AND version = ?', [f.id, n]) : null;
    if (!v) throw echec(404, 'version-introuvable', 'Version introuvable.');
    if (n === Number(f.version)) return detail(acteur, f.id);
    const cm = await base.premier('SELECT id FROM cm_fichiers WHERE id = ? AND supprime_le IS NULL', [v.fichier_id]);
    if (!cm) throw echec(410, 'version-effacee', 'Les octets de cette version ont été effacés.');
    const format = jsonOu(v.meta, {}).format;
    const nom = nomVersion(f.nom, jsonOu(f.meta, {}).format, format);
    await enregistrerVersion(acteur, f, { fichierId: v.fichier_id, nom, mime: v.type_mime, genre: genreDe(format), taille: Number(v.taille), meta: v.meta, restauree: n });
    return detail(acteur, f.id);
  }

  /** `DELETE /cm/drive/fichiers/:id/versions/:v` (gérer) : efface une ANCIENNE version. */
  async function supprimerVersion(acteur, id, version) {
    const { f, dc } = await fichierVisible(acteur, id);
    exigerGerer(dc);
    const n = Number(version);
    const v = Number.isSafeInteger(n) ? await base.premier('SELECT * FROM cm_drive_versions WHERE element_id = ? AND version = ?', [f.id, n]) : null;
    if (!v) throw echec(404, 'version-introuvable', 'Version introuvable.');
    if (n === Number(f.version)) throw echec(409, 'version-actuelle', 'La version actuelle ne se supprime pas : mettez le fichier à la corbeille.');
    await base.executer('DELETE FROM cm_drive_versions WHERE id = ?', [v.id]);
    await effacerFichierCmSiOrphelin(base, stockage, v.fichier_id, maintenant());
    return detail(acteur, f.id);
  }

  /** `POST /cm/drive/fichiers/:id/lien { telecharger, version? }` : lien signé (2 h). */
  async function lien(acteur, id, corps) {
    const { f } = await fichierVisible(acteur, id, { corbeille: true });
    const version = corps?.version === undefined || corps?.version === null ? Number(f.version) : Number(corps.version);
    if (!Number.isSafeInteger(version) || !(await base.premier('SELECT id FROM cm_drive_versions WHERE element_id = ? AND version = ?', [f.id, version]))) throw echec(404, 'version-introuvable', 'Version introuvable.');
    return lienVersion(acteur.compte, f.id, version, { telecharger: corps?.telecharger === true });
  }

  // ---------------------------------------------------------------- Dossiers

  async function creerDossier(acteur, corps) {
    const dc = await ctxDrive(acteur, corps?.portee);
    if (!dc.drive.envoyer) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    await assurerDossiers(dc.portee);
    const map = await arbre(dc.portee);
    const parent = dossierCible(dc, map, corps?.parentId ?? null);
    if (map.size >= DOSSIERS_MAX) throw echec(409, 'trop-de-dossiers', `${DOSSIERS_MAX} dossiers au plus.`);
    if (parent && (chaine(map, parent)?.length ?? 0) >= PROFONDEUR_MAX) throw echec(409, 'trop-profond', `${PROFONDEUR_MAX} niveaux de dossiers au plus.`);
    if (typeof corps?.nom !== 'string' || !corps.nom.trim()) throw echec(400, 'nom', 'Nom du dossier : obligatoire.');
    const nom = assainirNom(corps.nom, 'Dossier');
    const restreint = corps?.restreint === true;
    if (restreint) exigerGerer(dc);
    const id = nouvelId();
    const t = maintenant();
    await base.lot([
      { sql: 'INSERT INTO cm_drive_dossiers (id, portee, team_id, parent_id, nom, cle, restreint, cree_par, cree_le, maj_par, maj_le) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)', params: [id, dc.portee, teamDePortee(dc.portee), parent?.id ?? null, nom, restreint ? 1 : 0, acteur.compte, iso(t), acteur.compte, iso(t)] },
      evenement('cm.drive_dossier_cree', { teamId: teamDePortee(dc.portee), acteur: acteur.compte, entiteType: 'cm_drive_dossier', entiteId: id, charge: { nom, portee: dc.portee }, maintenant: t }),
      evAjout({ portee: dc.portee, acteur: acteur.compte, element: 'dossier', id, dossierId: parent?.id, genre: 'ajout', nom, t }),
    ]);
    return { id };
  }

  /**
   * `PATCH /cm/drive/dossiers/:id { nom?, parentId?, restreint? }` : renommer (nom null : nom par défaut d'un dossier
   * par défaut), déplacer (pas dans lui-même ni dans un descendant ; un dossier par défaut reste à la racine),
   * restreindre (gérer).
   */
  async function modifierDossier(acteur, id, corps) {
    const { d, dc, map } = await dossierVisible(acteur, id);
    if (!peutModifierDossier(dc, d)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const champs = {};
    if (corps?.nom !== undefined) {
      if (corps.nom === null && d.cle) champs.nom = null;
      else {
        if (typeof corps.nom !== 'string' || !corps.nom.trim()) throw echec(400, 'nom', 'Nom du dossier : obligatoire.');
        champs.nom = assainirNom(corps.nom, 'Dossier');
      }
    }
    if (corps?.parentId !== undefined) {
      if (d.cle) throw echec(409, 'dossier-systeme', 'Un dossier par défaut reste à la racine du Drive.');
      const parent = dossierCible(dc, map, corps.parentId);
      if (parent) {
        const sous = new Set(descendants(map, d.id));
        if (sous.has(parent.id)) throw echec(409, 'deplacement-boucle', 'Un dossier ne se range pas dans lui-même.');
        const hauteur = Math.max(...[...sous].map(x => (chaine(map, map.get(x))?.length ?? 1) - (chaine(map, d)?.length ?? 1)));
        if ((chaine(map, parent)?.length ?? 0) + 1 + hauteur > PROFONDEUR_MAX) throw echec(409, 'trop-profond', `${PROFONDEUR_MAX} niveaux de dossiers au plus.`);
      }
      champs.parent_id = parent?.id ?? null;
    }
    if (corps?.restreint !== undefined) {
      exigerGerer(dc);
      champs.restreint = corps.restreint === true ? 1 : 0;
    }
    const cles = Object.keys(champs);
    if (!cles.length) return { ok: true };
    const t = maintenant();
    await base.lot([
      { sql: `UPDATE cm_drive_dossiers SET ${[...cles.map(k => `${k} = ?`), 'maj_par = ?', 'maj_le = ?'].join(', ')} WHERE id = ?`, params: [...cles.map(k => champs[k]), acteur.compte, iso(t), d.id] },
      evenement('cm.drive_dossier_modifie', { teamId: teamDePortee(d.portee), acteur: acteur.compte, entiteType: 'cm_drive_dossier', entiteId: d.id, charge: { nom: champs.nom === undefined ? nomAffiche(d) : (champs.nom ?? nomAffiche({ cle: d.cle })), restreint: champs.restreint === undefined ? undefined : champs.restreint === 1, deplace: champs.parent_id !== undefined }, maintenant: t }),
    ]);
    // Restreint (ou rangé dans un dossier restreint) : ses notifications déjà affichées se resserrent aussi.
    if (champs.restreint === 1 || champs.parent_id !== undefined) await resserrerNotifications(await arbre(d.portee), d.id, null);
    return { ok: true };
  }

  /**
   * Centre de notifications (migration 0038) : les notifications des éléments d'un dossier devenu restreint (ou
   * déplacés dessous) ne restent visibles que de ceux qui gèrent le Drive. Ne fait rien hors d'un dossier
   * restreint ; ne desserre jamais. Sans le centre (table absente), rien.
   */
  async function resserrerNotifications(map, dossierId, fichierId) {
    const d = dossierId ? map.get(dossierId) : null;
    const restreint = x => (chaine(map, x) ?? []).some(y => Number(y.restreint) === 1);
    try {
      let ids;
      if (fichierId) {
        const f = await base.premier('SELECT dossier_id FROM cm_drive_fichiers WHERE id = ?', [fichierId]);
        if (!f?.dossier_id || !map.get(f.dossier_id) || !restreint(map.get(f.dossier_id))) return;
        ids = [fichierId];
      } else {
        if (!d || !restreint(d)) return;
        const sous = descendants(map, d.id);
        ids = [...sous, ...(await lignesParIds(base, 'SELECT id FROM cm_drive_fichiers WHERE dossier_id', sous)).map(l => l.id)];
      }
      for (let i = 0; i < ids.length; i += 80) {
        const p = ids.slice(i, i + 80);
        await base.executer(
          `UPDATE notifs_centre SET acces = 'cm:cm.drive.gerer', portee_cle = 'cm:cm.drive.gerer@' || COALESCE(team_id, '') WHERE entite_type IN ('cm_drive', 'cm_drive_dossier') AND entite_id IN (${p.map(() => '?').join(', ')})`,
          p,
        );
      }
    } catch (e) {
      if (!/notifs_centre/.test(String(e?.message ?? e))) throw e;
    }
  }

  // ---------------------------------------------------------------- Corbeille

  async function mettreFichierALaCorbeille(acteur, id) {
    const { f, dc } = await fichierVisible(acteur, id);
    if (!peutModifierFichier(dc, f)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const t = maintenant();
    const lot = nouvelId();
    await base.lot([
      { sql: 'UPDATE cm_drive_fichiers SET supprime_le = ?, supprime_par = ?, corbeille = ?, corbeille_racine = 1 WHERE id = ? AND supprime_le IS NULL', params: [iso(t), acteur.compte, lot, f.id] },
      evenement('cm.drive_corbeille', { teamId: teamDePortee(f.portee), acteur: acteur.compte, entiteType: 'cm_drive', entiteId: f.id, charge: { nom: f.nom, genre: 'fichier' }, maintenant: t }),
    ]);
    return { ok: true, corbeille: lot };
  }

  /** Un dossier part à la corbeille avec tout ce qu'il contient (même lot : ils reviennent ensemble). */
  async function mettreDossierALaCorbeille(acteur, id) {
    const { d, dc, map } = await dossierVisible(acteur, id);
    if (!peutModifierDossier(dc, d)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    if (d.cle) throw echec(409, 'dossier-systeme', 'Un dossier par défaut ne se supprime pas (renommez-le si besoin).');
    const sous = descendants(map, d.id);
    // Qui ne gère pas ne supprime pas un dossier qui contient des fichiers des autres.
    if (!dc.drive.gerer) {
      const autres = await lignesParIds(base, 'SELECT id FROM cm_drive_fichiers WHERE supprime_le IS NULL AND (cree_par IS NULL OR cree_par <> ?) AND dossier_id', sous, { paramsAvant: [acteur.compte] });
      if (autres.length || sous.some(x => x !== d.id && map.get(x)?.cree_par !== acteur.compte)) throw echec(403, 'permission', 'Ce dossier contient des éléments d’autres personnes : seul un gestionnaire du Drive peut le supprimer.');
    }
    const t = maintenant();
    const lot = nouvelId();
    const instr = [];
    for (let i = 0; i < sous.length; i += 80) {
      const p = sous.slice(i, i + 80);
      instr.push(
        { sql: `UPDATE cm_drive_dossiers SET supprime_le = ?, supprime_par = ?, corbeille = ?, corbeille_racine = 0 WHERE supprime_le IS NULL AND id IN (${p.map(() => '?').join(', ')})`, params: [iso(t), acteur.compte, lot, ...p] },
        { sql: `UPDATE cm_drive_fichiers SET supprime_le = ?, supprime_par = ?, corbeille = ?, corbeille_racine = 0 WHERE supprime_le IS NULL AND dossier_id IN (${p.map(() => '?').join(', ')})`, params: [iso(t), acteur.compte, lot, ...p] },
      );
    }
    instr.push(
      { sql: 'UPDATE cm_drive_dossiers SET corbeille_racine = 1 WHERE id = ?', params: [d.id] },
      evenement('cm.drive_corbeille', { teamId: teamDePortee(d.portee), acteur: acteur.compte, entiteType: 'cm_drive_dossier', entiteId: d.id, charge: { nom: nomAffiche(d), genre: 'dossier' }, maintenant: t }),
    );
    await base.lot(instr);
    return { ok: true, corbeille: lot };
  }

  /** Élément de la corbeille (racine d'un lot) : `{ ligne, genre }`. */
  async function racineCorbeille(id) {
    exigerUuid(id, 'element');
    const f = await base.premier('SELECT * FROM cm_drive_fichiers WHERE id = ? AND corbeille_racine = 1 AND supprime_le IS NOT NULL', [id]);
    if (f) return { ligne: f, genre: 'fichier' };
    const d = await base.premier('SELECT * FROM cm_drive_dossiers WHERE id = ? AND corbeille_racine = 1 AND supprime_le IS NOT NULL', [id]);
    if (d) return { ligne: d, genre: 'dossier' };
    throw echec(404, 'element-introuvable', 'Élément introuvable dans la corbeille.');
  }

  /** La racine de corbeille est-elle visible (pas sous un dossier restreint pour qui ne gère pas) ? */
  function racineVisible(dc, mapTout, r) {
    if (dc.drive.gerer) return true;
    if (dc.drive.depot) return false;
    const depart = r.genre === 'dossier' ? r.ligne : r.ligne.dossier_id ? mapTout.get(r.ligne.dossier_id) : null;
    let x = depart;
    for (let n = 0; x && n <= PROFONDEUR_MAX + 2; n++) {
      if (Number(x.restreint) === 1) return false;
      x = x.parent_id ? mapTout.get(x.parent_id) : null;
    }
    return true;
  }

  /** `GET /cm/drive/corbeille?portee` : éléments mis à la corbeille (ce que chacun contient), date d'effacement. */
  async function corbeille(acteur, { portee } = {}) {
    const dc = await ctxDrive(acteur, portee);
    if (!dc.drive.voir) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const mapTout = await arbre(dc.portee, { avecCorbeille: true });
    const fichiers = await base.tous('SELECT * FROM cm_drive_fichiers WHERE portee = ? AND corbeille_racine = 1 AND supprime_le IS NOT NULL ORDER BY supprime_le DESC LIMIT 1000', [dc.portee]);
    const dossiers = [...mapTout.values()].filter(d => Number(d.corbeille_racine) === 1 && d.supprime_le);
    const visiblesF = fichiers.filter(f => racineVisible(dc, mapTout, { genre: 'fichier', ligne: f }));
    const visiblesD = dossiers.filter(d => racineVisible(dc, mapTout, { genre: 'dossier', ligne: d }));
    const contenu = new Map();
    for (const l of await lignesParIds(base, 'SELECT corbeille, COUNT(*) AS n, COALESCE(SUM(taille), 0) AS o FROM cm_drive_fichiers WHERE corbeille', visiblesD.map(d => d.corbeille), { apres: 'GROUP BY corbeille' })) contenu.set(l.corbeille, { n: Number(l.n), octets: Number(l.o) });
    const expire = x => iso(Date.parse(x.supprime_le) + DUREE_CORBEILLE_MS);
    const peutRestaurer = x => dc.drive.gerer || (dc.drive.envoyer && x.supprime_par === acteur.compte);
    const elements = [
      // `element` : fichier ou dossier (`genre` est, pour un fichier, son type : image, vidéo…).
      ...(await fichiersPublics(dc, visiblesF)).map((f, i) => ({ ...f, element: 'fichier', expireLe: expire(visiblesF[i]), restaurable: peutRestaurer(visiblesF[i]) })),
      ...(await dossiersPublics(dc, visiblesD)).map((d, i) => ({ ...d, element: 'dossier', contenu: contenu.get(visiblesD[i].corbeille) ?? { n: 0, octets: 0 }, expireLe: expire(visiblesD[i]), restaurable: peutRestaurer(visiblesD[i]) })),
    ].sort((a, b) => String(b.supprimeLe).localeCompare(String(a.supprimeLe)));
    const noms = await pseudosDe(base, elements.map(e => e.supprimePar).filter(Boolean));
    return { portee: dc.portee, droits: dc.drive, elements, noms, dureeJours: DUREE_CORBEILLE_MS / 86_400_000 };
  }

  /** `POST /cm/drive/corbeille/:id/restaurer` : revient à sa place (à la racine si son dossier n'existe plus). */
  async function restaurer(acteur, id) {
    const r = await racineCorbeille(id);
    let dc;
    try {
      dc = await ctxDrive(acteur, r.ligne.portee);
    } catch {
      throw echec(404, 'element-introuvable', 'Élément introuvable dans la corbeille.');
    }
    const mapTout = await arbre(r.ligne.portee, { avecCorbeille: true });
    if (!racineVisible(dc, mapTout, r)) throw echec(404, 'element-introuvable', 'Élément introuvable dans la corbeille.');
    if (!(dc.drive.gerer || (dc.drive.envoyer && r.ligne.supprime_par === acteur.compte))) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const parentId = r.genre === 'fichier' ? r.ligne.dossier_id : r.ligne.parent_id;
    const parent = parentId ? mapTout.get(parentId) : null;
    // Le dossier d'origine est-il encore là (hors corbeille, chaîne complète) ? Sinon : racine.
    const map = await arbre(r.ligne.portee);
    const garde = parent && !parent.supprime_le && chaine(map, map.get(parent.id)) ? parent.id : null;
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE cm_drive_fichiers SET supprime_le = NULL, supprime_par = NULL, corbeille = NULL, corbeille_racine = 0 WHERE corbeille = ?', params: [r.ligne.corbeille] },
      { sql: 'UPDATE cm_drive_dossiers SET supprime_le = NULL, supprime_par = NULL, corbeille = NULL, corbeille_racine = 0 WHERE corbeille = ?', params: [r.ligne.corbeille] },
      r.genre === 'fichier'
        ? { sql: 'UPDATE cm_drive_fichiers SET dossier_id = ?, maj_le = ? WHERE id = ?', params: [garde, iso(t), r.ligne.id] }
        : { sql: 'UPDATE cm_drive_dossiers SET parent_id = ?, maj_le = ? WHERE id = ?', params: [garde, iso(t), r.ligne.id] },
      evenement('cm.drive_restaure', { teamId: teamDePortee(r.ligne.portee), acteur: acteur.compte, entiteType: r.genre === 'fichier' ? 'cm_drive' : 'cm_drive_dossier', entiteId: r.ligne.id, charge: { nom: r.genre === 'fichier' ? r.ligne.nom : nomAffiche(r.ligne), genre: r.genre }, maintenant: t }),
    ]);
    return { ok: true, genre: r.genre, dossierId: garde };
  }

  /** `DELETE /cm/drive/corbeille/:id` (gérer) : suppression définitive (les octets partent s'ils ne servent plus). */
  async function supprimerDefinitivement(acteur, id) {
    const r = await racineCorbeille(id);
    let dc;
    try {
      dc = await ctxDrive(acteur, r.ligne.portee);
    } catch {
      throw echec(404, 'element-introuvable', 'Élément introuvable dans la corbeille.');
    }
    exigerGerer(dc);
    const t = maintenant();
    await purgerLot(base, stockage, r.ligne.corbeille, t);
    await base.lot([evenement('cm.drive_supprime', { teamId: teamDePortee(r.ligne.portee), acteur: acteur.compte, entiteType: r.genre === 'fichier' ? 'cm_drive' : 'cm_drive_dossier', entiteId: r.ligne.id, charge: { nom: r.genre === 'fichier' ? r.ligne.nom : nomAffiche(r.ligne), genre: r.genre }, maintenant: t })]);
    return { ok: true };
  }

  /** `POST /cm/drive/corbeille/vider { portee }` (gérer). */
  async function viderCorbeille(acteur, corps) {
    const dc = await ctxDrive(acteur, corps?.portee);
    exigerGerer(dc);
    const lots = new Set();
    for (const table of ['cm_drive_fichiers', 'cm_drive_dossiers']) for (const l of await base.tous(`SELECT corbeille FROM ${table} WHERE portee = ? AND corbeille_racine = 1 AND supprime_le IS NOT NULL`, [dc.portee])) if (l.corbeille) lots.add(l.corbeille);
    const t = maintenant();
    let n = 0;
    for (const lot of lots) n += await purgerLot(base, stockage, lot, t);
    if (lots.size) await base.lot([evenement('cm.drive_corbeille_videe', { teamId: teamDePortee(dc.portee), acteur: acteur.compte, entiteType: 'cm_drive', entiteId: dc.portee, charge: { elements: lots.size, fichiers: n }, maintenant: t })]);
    return { ok: true, elements: lots.size };
  }

  // ---------------------------------------------------------------- Nouveautés (migration 0041)

  /**
   * État « vu » du Drive, par compte et par dossier (`cm_drive_vus`) : un élément est NOUVEAU pour un compte s'il
   * a été ajouté (fichier, dossier, copie, rangement automatique) ou a reçu une nouvelle version, par quelqu'un
   * d'autre, après la dernière visite de son dossier parent par ce compte (et après « Tout marquer comme vu »).
   * Seuls les éléments visibles du compte comptent (dossiers restreints, dépôt des joueurs). Le compteur d'un
   * dossier additionne ses nouveautés et celles de ses sous-dossiers.
   */
  const marquer = (compte, portee, dossier, t = maintenant()) =>
    base.executer('INSERT INTO cm_drive_vus (compte_id, portee, dossier, vu_le) VALUES (?, ?, ?, ?) ON CONFLICT (compte_id, portee, dossier) DO UPDATE SET vu_le = excluded.vu_le', [compte, portee, dossier, iso(t)]);

  async function calculerNouveautes(dc, map) {
    const compte = dc.acteur.compte;
    const vus = new Map((await base.tous('SELECT dossier, vu_le FROM cm_drive_vus WHERE compte_id = ? AND portee = ?', [compte, dc.portee])).map(l => [l.dossier, l.vu_le]));
    const parDossier = new Map();
    let base0 = vus.get(CLE_TOUT);
    if (!base0) {
      // Premier passage : rien n'est « nouveau » (ce qui existait avant n'encombre pas les pastilles).
      base0 = iso(maintenant());
      await base.executer('INSERT INTO cm_drive_vus (compte_id, portee, dossier, vu_le) VALUES (?, ?, ?, ?) ON CONFLICT (compte_id, portee, dossier) DO NOTHING', [compte, dc.portee, CLE_TOUT, base0]);
      return { total: 0, parDossier, racine: 0 };
    }
    const seuil = parent => {
      const v = vus.get(parent ?? CLE_RACINE);
      return v && v > base0 ? v : base0;
    };
    const nouveaux = new Map();
    for (const f of await base.tous('SELECT id, dossier_id, cree_par, cree_le FROM cm_drive_fichiers WHERE portee = ? AND supprime_le IS NULL AND cree_le > ? AND (cree_par IS NULL OR cree_par <> ?) LIMIT 5000', [dc.portee, base0, compte])) {
      if (f.cree_le > seuil(f.dossier_id)) nouveaux.set(f.id, f);
    }
    const versions = await base.tous(
      'SELECT v.element_id, v.cree_le, f.id, f.dossier_id, f.cree_par FROM cm_drive_versions v JOIN cm_drive_fichiers f ON f.id = v.element_id WHERE f.portee = ? AND f.supprime_le IS NULL AND v.version > 1 AND v.cree_le > ? AND (v.cree_par IS NULL OR v.cree_par <> ?) LIMIT 5000',
      [dc.portee, base0, compte],
    );
    for (const v of versions) if (v.cree_le > seuil(v.dossier_id) && !nouveaux.has(v.id)) nouveaux.set(v.id, v);
    const elements = [...nouveaux.values()].filter(f => fichierAccessible(dc, map, f)).map(f => f.dossier_id ?? null);
    if (!dc.drive.depot) {
      for (const d of map.values()) {
        if (!d.cle && d.cree_par !== compte && d.cree_le > seuil(d.parent_id) && dossierAccessible(dc, map, d)) elements.push(d.parent_id ?? null);
      }
    }
    let racine = 0;
    for (const parent of elements) {
      if (!parent) {
        racine++;
        continue;
      }
      for (const x of chaine(map, map.get(parent)) ?? []) parDossier.set(x.id, (parDossier.get(x.id) ?? 0) + 1);
    }
    return { total: elements.length, parDossier, racine };
  }

  const publierNouveautes = n => ({ total: n.total, racine: n.racine, dossiers: Object.fromEntries(n.parDossier) });

  /**
   * `GET /cm/drive/nouveautes?portee` : compteurs de nouveautés de l'acteur. Avec `portee` : total et compteur
   * par dossier ; sans : total de chaque Drive visible (pastilles de la tuile « CM du club » et des onglets).
   */
  async function nouveautes(acteur, { portee } = {}) {
    if (portee) {
      const dc = await ctxDrive(acteur, portee);
      await assurerDossiers(dc.portee);
      return { portee: dc.portee, ...publierNouveautes(await calculerNouveautes(dc, await arbre(dc.portee))) };
    }
    const liste = await portees(acteur).catch(() => ({ portees: [] }));
    const sortie = [];
    for (const p of liste.portees) {
      const dc = await ctxDrive(acteur, p.portee);
      sortie.push({ portee: p.portee, total: (await calculerNouveautes(dc, await arbre(dc.portee))).total });
    }
    return { total: sortie.reduce((s, x) => s + x.total, 0), portees: sortie };
  }

  /** `POST /cm/drive/vu { portee, dossierId }` : le dossier (null : la racine) est vu maintenant. */
  async function vu(acteur, corps) {
    const dc = await ctxDrive(acteur, corps?.portee);
    const map = await arbre(dc.portee);
    const d = corps?.dossierId ? dossierCible(dc, map, corps.dossierId) : null;
    await marquer(acteur.compte, dc.portee, d?.id ?? CLE_RACINE);
    return { portee: dc.portee, ...publierNouveautes(await calculerNouveautes(dc, map)) };
  }

  /** `POST /cm/drive/tout-vu { portee? }` : tout est vu, dans le Drive de la portée (sans portée : tous les Drive visibles). */
  async function toutVu(acteur, corps) {
    const cibles = corps?.portee ? [(await ctxDrive(acteur, corps.portee)).portee] : (await portees(acteur)).portees.map(p => p.portee);
    const t = maintenant();
    const lot = [];
    for (const p of cibles) {
      lot.push(
        { sql: 'DELETE FROM cm_drive_vus WHERE compte_id = ? AND portee = ? AND dossier <> ?', params: [acteur.compte, p, CLE_TOUT] },
        { sql: 'INSERT INTO cm_drive_vus (compte_id, portee, dossier, vu_le) VALUES (?, ?, ?, ?) ON CONFLICT (compte_id, portee, dossier) DO UPDATE SET vu_le = excluded.vu_le', params: [acteur.compte, p, CLE_TOUT, iso(t)] },
      );
    }
    if (lot.length) await base.lot(lot);
    return { ok: true, portees: cibles };
  }

  /** Le compte voit-il cet élément du Drive (hors corbeille) ? Pour les abonnés de `drive.ajout`. */
  async function elementVisiblePour(compte, element, id) {
    try {
      if (element === 'dossier') await dossierVisible(acteurDuLien(compte), id);
      else await fichierVisible(acteurDuLien(compte), id);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Destinataires d'un événement `drive.ajout` (centre de notifications) : comptes qui ont un droit sur le Drive de
   * la portée et VOIENT l'élément, sauf son auteur.
   */
  async function destinatairesAjout(ev) {
    const charge = jsonOu(ev?.charge, {});
    if (ev?.type !== 'drive.ajout' || typeof charge.portee !== 'string') return [];
    const candidats = new Set();
    for (const p of ['cm.drive.voir', 'cm.drive.envoyer', 'cm.drive.gerer']) {
      for (const c of charge.portee === PORTEE_CLUB ? await comptesClubAvec(base, p) : await comptesTeamAvec(base, charge.portee, p)) candidats.add(c);
    }
    candidats.delete(ev.acteur_id);
    const sortie = [];
    for (const c of candidats) if (await elementVisiblePour(c, charge.element, ev.entite_id)) sortie.push(c);
    return sortie.sort();
  }

  // ---------------------------------------------------------------- Lot, favoris

  /** `POST /cm/drive/lot { action: deplacer | copier | corbeille, elements: [{ genre, id }], dossierId?, portee? }`. */
  async function enLot(acteur, corps) {
    const action = corps?.action;
    if (!['deplacer', 'copier', 'corbeille'].includes(action)) throw echec(400, 'action', 'Action inconnue.');
    const elements = corps?.elements;
    if (!Array.isArray(elements) || !elements.length || elements.length > LOT_MAX) throw echec(400, 'elements', `De 1 à ${LOT_MAX} éléments.`);
    const faits = [];
    const erreurs = [];
    // Déplacement : emplacement d'avant de chaque élément déplacé (l'app s'en sert pour « Annuler »).
    const avant = {};
    for (const e of elements) {
      const genre = e?.genre === 'dossier' ? 'dossier' : 'fichier';
      try {
        if (action === 'deplacer' && typeof e?.id === 'string') {
          const l = genre === 'dossier' ? await base.premier('SELECT parent_id AS p FROM cm_drive_dossiers WHERE id = ?', [e.id]) : await base.premier('SELECT dossier_id AS p FROM cm_drive_fichiers WHERE id = ?', [e.id]);
          if (l) avant[e.id] = l.p ?? null;
        }
        if (action === 'corbeille') await (genre === 'dossier' ? mettreDossierALaCorbeille(acteur, e?.id) : mettreFichierALaCorbeille(acteur, e?.id));
        else if (action === 'deplacer') await (genre === 'dossier' ? modifierDossier(acteur, e?.id, { parentId: corps?.dossierId ?? null }) : modifierFichier(acteur, e?.id, { dossierId: corps?.dossierId ?? null }));
        else {
          if (genre === 'dossier') throw echec(400, 'copie-dossier', 'Seuls les fichiers se copient.');
          await copierFichier(acteur, e?.id, { dossierId: corps?.dossierId ?? null, portee: corps?.portee });
        }
        faits.push(e.id);
      } catch (err) {
        erreurs.push({ id: typeof e?.id === 'string' ? e.id : null, code: err?.code ?? 'erreur', erreur: err?.message ?? String(err) });
        delete avant[e?.id];
      }
    }
    return action === 'deplacer' ? { faits, erreurs, avant } : { faits, erreurs };
  }

  /** `POST /cm/drive/favoris { genre, id, favori }` : favori personnel (fichier ou dossier visible). */
  async function favori(acteur, corps) {
    const genre = corps?.genre === 'dossier' ? 'dossier' : 'fichier';
    if (genre === 'dossier') await dossierVisible(acteur, corps?.id);
    else await fichierVisible(acteur, corps?.id);
    if (corps?.favori === false) await base.executer('DELETE FROM cm_drive_favoris WHERE compte_id = ? AND element_id = ?', [acteur.compte, corps.id]);
    else await base.executer('INSERT INTO cm_drive_favoris (compte_id, element_id, genre, cree_le) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', [acteur.compte, corps.id, genre, iso(maintenant())]);
    return { ok: true };
  }

  // ---------------------------------------------------------------- ZIP

  /** Fichiers d'un dossier et de ses sous-dossiers visibles, chemins relatifs uniques. */
  async function contenuZip(dc, map, d) {
    const ids = descendants(map, d.id).filter(x => dossierAccessible(dc, map, map.get(x)));
    const visibles = new Set(ids);
    const chemins = new Map();
    const pris = new Map();
    const cheminDossier = x => {
      if (chemins.has(x)) return chemins.get(x);
      const dx = map.get(x);
      let c;
      if (x === d.id) c = '';
      else {
        const parent = cheminDossier(dx.parent_id);
        if (!pris.has(dx.parent_id)) pris.set(dx.parent_id, new Set());
        c = `${parent}${nomUnique(nomAffiche(dx), pris.get(dx.parent_id))}/`;
      }
      chemins.set(x, c);
      return c;
    };
    const lignes = (await lignesParIds(base, 'SELECT f.*, c.cle_stockage FROM cm_drive_fichiers f JOIN cm_fichiers c ON c.id = f.fichier_id AND c.supprime_le IS NULL WHERE f.supprime_le IS NULL AND f.dossier_id', ids)).filter(f => visibles.has(f.dossier_id) && fichierAccessible(dc, map, f));
    lignes.sort((a, b) => a.nom_cle.localeCompare(b.nom_cle));
    const entrees = [];
    for (const f of lignes) {
      const dossier = cheminDossier(f.dossier_id);
      if (!pris.has(f.dossier_id)) pris.set(f.dossier_id, new Set());
      entrees.push({ chemin: `${dossier}${nomUnique(f.nom, pris.get(f.dossier_id))}`, taille: Number(f.taille), date: Date.parse(f.maj_le), cle: f.cle_stockage });
    }
    return entrees;
  }

  function verifierZip(entrees) {
    if (!entrees.length) throw echec(409, 'dossier-vide', 'Ce dossier ne contient aucun fichier.');
    if (entrees.length > ZIP_ENTREES_MAX) throw echec(413, 'zip-trop-gros', `Trop de fichiers pour un ZIP (${ZIP_ENTREES_MAX} au plus) : téléchargez les sous-dossiers.`);
    const taille = tailleZip(entrees);
    if (taille > config.zipMax) {
      const e = echec(413, 'zip-trop-gros', `Dossier trop lourd pour un ZIP (${Math.floor(config.zipMax / 1048576)} Mo au plus) : téléchargez les sous-dossiers.`);
      e.details = { taille, limite: config.zipMax };
      throw e;
    }
    return taille;
  }

  /** `POST /cm/drive/dossiers/:id/zip` : lien signé (2 h) vers le ZIP du dossier. */
  async function lienZip(acteur, id) {
    const { d, dc, map } = await dossierVisible(acteur, id);
    if (!dc.drive.voir) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const taille = verifierZip(await contenuZip(dc, map, d));
    const { chemin, expire } = await cheminSigne(cleSession, { fichierId: d.id, compte: acteur.compte, maintenant: maintenant(), duree: DUREE_LIEN_DRIVE_MS, telecharger: true, genre: 'drive-zip' });
    return { chemin, expire, taille };
  }

  const acteurDuLien = compte => ({ compte, superAdmin: compte === 'principal' });

  /** `GET /cm/drive/zip/:id?c&exp&sig` (sans session) : le ZIP, en flux ; l'accès est revérifié. */
  async function servirZip(id, params, requete) {
    exigerUuid(id, 'dossier');
    const { compte } = await verifierLien(cleSession, id, params, maintenant(), { genre: 'drive-zip' });
    let v;
    try {
      v = await dossierVisible(acteurDuLien(compte), id);
    } catch {
      throw echec(403, 'lien-invalide', 'Lien de fichier invalide.');
    }
    if (!v.dc.drive.voir) throw echec(403, 'lien-invalide', 'Lien de fichier invalide.');
    if (!stockage) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché.');
    const entrees = await contenuZip(v.dc, v.map, v.d);
    const taille = verifierZip(entrees);
    const entetes = { ...ENTETES_LIEN, 'Content-Type': 'application/zip', 'Content-Disposition': disposition(`${assainirNom(nomAffiche(v.d), 'dossier')}.zip`, false), 'Content-Length': String(taille) };
    if (requete.method === 'HEAD') return new Response(null, { status: 200, headers: entetes });
    const flux = fluxZip(
      entrees.map(e => ({
        ...e,
        lire: async () => {
          if (typeof stockage.lireTranche === 'function') {
            const r = await stockage.lireTranche(e.cle, 0, e.taille - 1);
            return r ? (r.flux ?? new Uint8Array(r.octets)) : null;
          }
          const o = await stockage.lire(e.cle);
          return o ? new Uint8Array(o.octets) : null;
        },
      })),
    );
    return new Response(flux, { status: 200, headers: entetes });
  }

  /** `GET /cm/drive/contenu/<élément>.<version>?c&exp&sig` (sans session) : le fichier ; l'accès est revérifié. */
  async function servirContenu(cle, params, requete) {
    const m = /^([0-9a-f-]{36})\.(\d{1,6})$/.exec(String(cle));
    if (!m) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    const { compte, telecharger } = await verifierLien(cleSession, cle, params, maintenant(), { genre: 'drive' });
    let v;
    try {
      v = await fichierVisible(acteurDuLien(compte), m[1], { corbeille: true });
    } catch {
      throw echec(403, 'lien-invalide', 'Lien de fichier invalide.');
    }
    const version = await base.premier('SELECT * FROM cm_drive_versions WHERE element_id = ? AND version = ?', [m[1], Number(m[2])]);
    const f = version ? await base.premier('SELECT * FROM cm_fichiers WHERE id = ? AND supprime_le IS NULL', [version.fichier_id]) : null;
    if (!f) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    if (!stockage) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché.');
    const nom = Number(version.version) === Number(v.f.version) ? v.f.nom : version.nom;
    const reponse = await reponseFichierStocke({ stockage, f, requete, telecharger, nom });
    if (!reponse) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    return reponse;
  }

  // ---------------------------------------------------------------- Intégrations

  /**
   * Fichier du Drive choisi ailleurs (pièce jointe d'une carte, image de l'éditeur, pièce d'un sponsor) : visible
   * de l'acteur, hors corbeille, d'une des `portees` admises. Rend `{ fichierId, nom, type, taille, format, portee }`
   * (la ligne de `cm_fichiers` de la version actuelle : rien n'est copié).
   */
  async function fichierPourIntegration(acteur, id, { portees: admises = null } = {}) {
    const { f, dc } = await fichierVisible(acteur, id).catch(() => {
      throw echec(404, 'fichier-introuvable', 'Fichier du Drive introuvable.');
    });
    if (!dc.drive.voir) throw echec(404, 'fichier-introuvable', 'Fichier du Drive introuvable.');
    // `portees` : Drives admis ; sans (null), tout Drive que l'acteur voit (choix du Drive, docs/esport/drive.md).
    if (admises && !admises.includes(f.portee)) throw echec(400, 'portee', 'Ce fichier est dans le Drive d’une autre team.');
    const cm = await base.premier('SELECT id FROM cm_fichiers WHERE id = ? AND supprime_le IS NULL', [f.fichier_id]);
    if (!cm) throw echec(404, 'fichier-introuvable', 'Fichier du Drive introuvable.');
    return { fichierId: f.fichier_id, nom: f.nom, type: f.type_mime, taille: Number(f.taille), format: jsonOu(f.meta, {}).format ?? null, meta: jsonOu(f.meta, {}), portee: f.portee, elementId: f.id };
  }

  /**
   * Rangement automatique (visuel généré, clip retenu) : un élément par origine ; un nouveau rendu devient une
   * nouvelle version. Rien si le rangement est désactivé, si l'élément a été mis à la corbeille (choix de
   * l'utilisateur) ou s'il est déjà à jour. Ne lève jamais : le rangement ne bloque pas l'action principale.
   */
  async function ranger({ origine, origineId, portee, cleDossier, fichierId, nom, acteur }) {
    try {
      const reglages = await lireReglagesDrive(base);
      if ((origine === 'visuel' && !reglages.rangementVisuels) || (origine === 'clip' && !reglages.rangementClips)) return null;
      const cm = await base.premier('SELECT * FROM cm_fichiers WHERE id = ? AND supprime_le IS NULL', [fichierId]);
      if (!cm) return null;
      const existant = await base.premier('SELECT * FROM cm_drive_fichiers WHERE origine = ? AND origine_id = ? ORDER BY cree_le DESC LIMIT 1', [origine, origineId]);
      const format = jsonOu(cm.meta, {})?.format ?? Object.keys(FORMATS).find(k => FORMATS[k].mime === cm.type_mime);
      if (!format || !FORMATS[format]) return null;
      const meta = JSON.stringify(await metaDe(cm.cle_stockage, format, jsonOu(cm.meta, null)));
      if (existant) {
        if (existant.supprime_le || existant.fichier_id === fichierId) return existant.id;
        await enregistrerVersion(acteur ?? null, existant, { fichierId, nom: nomVersion(existant.nom, jsonOu(existant.meta, {}).format, format), mime: FORMATS[format].mime, genre: genreDe(format), taille: Number(cm.taille), meta });
        return existant.id;
      }
      await assurerDossiers(portee);
      const dossier = await base.premier('SELECT id FROM cm_drive_dossiers WHERE portee = ? AND cle = ? AND supprime_le IS NULL', [portee, cleDossier]);
      const id = nouvelId();
      const t = maintenant();
      const n = nomPourFormat(nom, format);
      await base.lot([
        {
          sql: `INSERT INTO cm_drive_fichiers (id, portee, team_id, dossier_id, nom, nom_cle, fichier_id, version, type_mime, genre, taille, meta, origine, origine_id, cree_par, cree_le, maj_par, maj_le)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [id, portee, teamDePortee(portee), dossier?.id ?? null, n, cleRecherche(n), fichierId, FORMATS[format].mime, genreDe(format), Number(cm.taille), meta, origine, origineId, acteur?.compte ?? null, iso(t), acteur?.compte ?? null, iso(t)],
        },
        { sql: 'INSERT INTO cm_drive_versions (id, element_id, version, fichier_id, nom, type_mime, taille, meta, cree_par, cree_le) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)', params: [nouvelId(), id, fichierId, n, FORMATS[format].mime, Number(cm.taille), meta, acteur?.compte ?? null, iso(t)] },
        ...tagsInstr(id, [origine]),
        evAjout({ portee, acteur: acteur?.compte, element: 'fichier', id, dossierId: dossier?.id, genre: 'rangement', nom: n, t }),
      ]);
      return id;
    } catch (e) {
      console.error('[esport] Drive : rangement automatique impossible', e?.message ?? e);
      return null;
    }
  }

  // ---------------------------------------------------------------- Réglages, accès des liens CM

  async function reglagesPublics() {
    const r = await lireReglagesDrive(base);
    return { rangementVisuels: r.rangementVisuels, rangementClips: r.rangementClips };
  }

  /** `PUT /cm/drive/reglages { rangementVisuels?, rangementClips? }` (gérer le Drive du club). */
  async function changerReglages(acteur, corps) {
    const dc = await ctxDrive(acteur, PORTEE_CLUB);
    exigerGerer(dc);
    const r = await lireReglagesDrive(base);
    const valeur = {
      rangementVisuels: typeof corps?.rangementVisuels === 'boolean' ? corps.rangementVisuels : r.rangementVisuels,
      rangementClips: typeof corps?.rangementClips === 'boolean' ? corps.rangementClips : r.rangementClips,
      alerteLe: r.alerteLe,
    };
    await base.lot([ecrireReglages(valeur, acteur.compte, maintenant())]);
    return reglagesPublics();
  }

  /**
   * Lien CM signé (`/cm/fichiers/:id`) vers un fichier qui est AUSSI dans le Drive : le compte voit-il un
   * élément du Drive (hors corbeille) qui pointe vers ces octets ?
   */
  async function peutLireFichierCm(compte, fichierId) {
    const elements = await base.tous('SELECT DISTINCT v.element_id FROM cm_drive_versions v JOIN cm_drive_fichiers f ON f.id = v.element_id WHERE v.fichier_id = ? AND f.supprime_le IS NULL LIMIT 50', [fichierId]);
    for (const { element_id: id } of elements) {
      try {
        await fichierVisible(acteurDuLien(compte), id);
        return true;
      } catch {
        // Élément suivant.
      }
    }
    return false;
  }

  /**
   * Le compte voit-il ce fichier CM dans (au moins) un de ses Drives ? Sert aux pièces « croisées » (fichier d'un autre
   * Drive) : l'acteur peut être le compte principal (superAdmin).
   */
  const peutLireFichierCmActeur = (acteur, fichierId) => (acteur?.superAdmin || acteur?.compte === 'principal' ? Promise.resolve(true) : peutLireFichierCm(acteur?.compte, fichierId));

  return {
    config,
    portees,
    lister,
    arborescence,
    filtres,
    renommerTag,
    supprimerTag,
    rechercher,
    detail,
    element,
    ajouter,
    modifierFichier,
    copierFichier,
    nouvelleVersion,
    restaurerVersion,
    supprimerVersion,
    lien,
    creerDossier,
    modifierDossier,
    mettreFichierALaCorbeille,
    mettreDossierALaCorbeille,
    corbeille,
    restaurer,
    supprimerDefinitivement,
    viderCorbeille,
    enLot,
    favori,
    nouveautes,
    vu,
    toutVu,
    elementVisiblePour,
    destinatairesAjout,
    lienZip,
    servirZip,
    servirContenu,
    fichierPourIntegration,
    ranger,
    changerReglages,
    reglages: async acteur => {
      exigerGerer(await ctxDrive(acteur, PORTEE_CLUB));
      return reglagesPublics();
    },
    quota,
    peutLireFichierCm,
    peutLireFichierCmActeur,
    dossiersAccessibles,
    utiliseHorsDrive: id => utiliseHorsDrive(base, id),
    CLES_DOSSIERS,
  };
}
