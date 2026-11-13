/**
 * Module « Lineups » (migration 0082, docs/esport/lineups.md) : lineups et placements de la team, pour tous les
 * modèles de jeu (Valorant, The Finals : « Lineups et placements », générique).
 *
 *  - Un lineup : map, personnage (agent ou classe) et capacité ou gadget (clés du profil de jeu de la team, nom
 *    recopié), side (attaque, défense, ou mode du jeu), zone visée (callout de la map ou texte libre), titre,
 *    consignes (posture, visée, timing, texte), difficulté (1 à 3), tags, deux points sur la minimap (où l'on se
 *    place, où ça tombe ; repère carré de 1000 unités des strats), statut proposé / validé, favori par compte.
 *  - Médias : 4 images au plus (rôle : position, visée, résultat, autre) et une vidéo courte au plus, envoyées par
 *    morceaux (medias/service.mjs, usage « lineup » : type vérifié par les octets), rangées dans le stockage du
 *    serveur (`fichiers`) et lues par un lien signé ; ou un lien vidéo https.
 *  - Liens strat <-> lineup (plusieurs à plusieurs, numéro d'étape facultatif) ; `lineupsDeStrat` : lecture pour
 *    l'éditeur de strats (GET /teams/:t/strats/:id/lineups).
 *  - Corbeille de 30 jours (suppression douce), comme les strats.
 *
 * Droits : `lineups.voir` (tout le monde), `lineups.proposer` (créer ; corriger et supprimer SES propositions tant
 * qu'elles ne sont pas validées), `lineups.gerer` (valider, corriger et supprimer tout). Contrôles, dans l'ordre :
 * appartenance (contexteTeam) → module `lineups` activé (sinon 404) → permission (sinon 403).
 *
 * Contenu TACTIQUE : jamais envoyé à une IA externe (ia/confidentialite.mjs), jamais posté sur Discord (aucun type de
 * message Discord ne s'abonne aux événements `lineup.*`).
 */

import { evenement } from '../evenements.mjs';
import { cheminSigne } from '../fichiers.mjs';
import { FORMATS } from '../medias/formats.mjs';
import { autorise } from '../permissions.mjs';
import { echec, iso, jsonOu, nouvelId, texteLong, texteNettoye } from '../outils.mjs';
import { pseudosDe } from '../requetes.mjs';
import { lienSur } from '../review/markdown.mjs';
import { modeleDuJeu } from '../strats/modeles.mjs';
import { normaliser, tagsPropres } from '../strats/service.mjs';

export const MODULE_LINEUPS = 'lineups';
export const POSTURES = ['debout', 'saut', 'course', 'accroupi'];
export const ROLES_IMAGE = ['position', 'visee', 'resultat', 'autre'];
export const STATUTS_LINEUP = ['propose', 'valide'];
export const IMAGES_MAX = 4;
const Mio = 1024 * 1024;
/** Une image de lineup : 12 Mo au plus (comme une image de map d'un profil de jeu). */
export const TAILLE_MAX_IMAGE_LINEUP = 12 * Mio;
/** Une vidéo de lineup est courte : 200 Mo au plus (et jamais plus que le plafond des vidéos du serveur). */
export const TAILLE_MAX_VIDEO_LINEUP = 200 * Mio;
export const DUREE_CORBEILLE_LINEUPS_MS = 30 * 86_400_000;
/** Lien signé d'un média de lineup : 2 heures (l'app relit la liste s'il expire). */
export const DUREE_LIEN_MEDIA_LINEUP_MS = 2 * 3600 * 1000;
/** Côté du repère des points (le même que celui des strats). */
export const REPERE = 1000;
const LINEUPS_MAX = 1000;
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MOTIF_CLE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/** Clé d'un élément du profil de jeu (map, personnage, callout : minuscules ; capacité : emplacement « Ability1 », « Grenade »…). */
const MOTIF_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

const exigerUuid = (valeur, quoi) => {
  if (typeof valeur !== 'string' || !MOTIF_UUID.test(valeur)) throw echec(404, `${quoi}-introuvable`, 'Introuvable.');
  return valeur;
};

/** Référence à un élément du profil de jeu : `{ cle, nom }` (clé stable, nom recopié), ou null. */
function lireReference(valeur, quoi, { obligatoire = false, cleLibre = false } = {}) {
  if (valeur === null || valeur === undefined || valeur === '') {
    if (obligatoire) throw echec(400, quoi, 'Choix requis.');
    return null;
  }
  if (typeof valeur !== 'object' || Array.isArray(valeur)) throw echec(400, quoi, 'Choix illisible.');
  const nom = texteNettoye(valeur.nom, 60);
  const cle = typeof valeur.cle === 'string' && MOTIF_REFERENCE.test(valeur.cle) ? valeur.cle : null;
  if (!cle && !cleLibre) throw echec(400, quoi, 'Choix illisible.');
  if (!cle && !nom) {
    if (obligatoire) throw echec(400, quoi, 'Choix requis.');
    return null;
  }
  return { cle, nom: nom || cle };
}

/** Point de la minimap : `{ x, y }` entiers dans le repère [0, 1000], ou null. */
function lirePoint(valeur, quoi) {
  if (valeur === null || valeur === undefined) return null;
  const x = Number(valeur?.x);
  const y = Number(valeur?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > REPERE || y > REPERE) throw echec(400, quoi, 'Point hors de la map.');
  return { x: Math.round(x), y: Math.round(y) };
}

/** Lien vidéo : https seulement (jamais http, ni data:, ni javascript:), 500 caractères au plus ; null si vide. */
export function lireLienVideo(valeur) {
  const t = String(valeur ?? '').trim();
  if (!t) return null;
  if (t.length > 500 || !/^https:\/\//i.test(t) || !lienSur(t)) throw echec(400, 'video-url', 'Lien vidéo invalide : https://… sans espace (500 caractères au plus).');
  return t;
}

/**
 * Filtres combinés (purs, testés ; miroir de src/esport/lineups/logique.ts) : map, personnage, capacité, side, zone
 * (clé d'un callout, ou texte libre comparé sans accents), tag, statut, favoris, recherche (titre, consignes, noms,
 * tags ; sans accents ni casse).
 */
export function filtrerLineups(lineups, f = {}) {
  const q = normaliser(f.q ?? '');
  const tag = normaliser(f.tag ?? '');
  const zone = normaliser(f.zone ?? '');
  return lineups.filter(l => {
    if (f.carte && l.carte.cle !== f.carte) return false;
    if (f.personnage && l.personnage?.cle !== f.personnage) return false;
    if (f.capacite && l.capacite?.cle !== f.capacite) return false;
    if (f.side && l.side !== f.side) return false;
    if (zone && l.zone?.cle !== f.zone && normaliser(l.zone?.nom ?? '') !== zone) return false;
    if (f.statut && l.statut !== f.statut) return false;
    if (f.favoris && !l.favori) return false;
    if (tag && !l.tags.some(t => normaliser(t) === tag)) return false;
    if (q && !normaliser([l.titre, l.carte.nom, l.personnage?.nom, l.capacite?.nom, l.zone?.nom, l.instructions, l.visee, l.timing, l.tags.join(' ')].filter(Boolean).join(' ')).includes(q)) return false;
    return true;
  });
}

/** Ordre de la grille : favoris d'abord, puis validés, puis proposés ; dans chaque groupe, les plus récents. */
export function trierLineups(lineups) {
  const rang = { valide: 0, propose: 1 };
  return [...lineups].sort((a, b) => Number(b.favori) - Number(a.favori) || rang[a.statut] - rang[b.statut] || (a.majLe < b.majLe ? 1 : a.majLe > b.majLe ? -1 : 0));
}

export function servicesLineups({ base, stockage, cleSession, maintenant = () => Date.now(), socle, medias, strats }) {
  const { contexteTeam } = socle;
  const peut = (ctx, p) => autorise(ctx.permissions, ctx.modules, p);

  function exiger(ctx, permission) {
    if (!ctx.modules.has(MODULE_LINEUPS)) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
    if (permission && !peut(ctx, permission)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
  }
  const refus = () => echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');

  /** Corriger un lineup : lineups.gerer, ou son auteur (lineups.proposer) tant qu'il n'est pas validé. */
  const peutModifier = (ctx, l) => peut(ctx, 'lineups.gerer') || (l.statut === 'propose' && l.cree_par === ctx.acteur.compte && peut(ctx, 'lineups.proposer'));
  /** Lier un lineup à une strat : gérer les lineups, ou modifier les strats. */
  const peutLier = ctx => peut(ctx, 'lineups.gerer') || peut(ctx, 'strats.update');

  async function lineupDeTeam(ctx, id) {
    exigerUuid(id, 'lineup');
    const l = await base.premier('SELECT * FROM lineups WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [id, ctx.team.id]);
    if (!l) throw echec(404, 'lineup-introuvable', 'Lineup introuvable.');
    return l;
  }

  /** Lien signé (2 h) vers un média, à préfixer par l'adresse du serveur. */
  async function lienMedia(fichierId, compte, origine = '') {
    if (!stockage || !cleSession) return null;
    const { chemin, expire } = await cheminSigne(cleSession, { fichierId, compte, maintenant: maintenant(), duree: DUREE_LIEN_MEDIA_LINEUP_MS });
    return { url: `${origine}${chemin}`, expire: iso(expire) };
  }

  /** Strats liées, par lineup : seulement celles que l'acteur peut voir (module Strats actif, strats.view, visibilité). */
  async function stratsLiees(ctx, lineupIds) {
    const sortie = new Map(lineupIds.map(id => [id, []]));
    if (lineupIds.length === 0) return sortie;
    const lignes = await base.tous(
      `SELECT sl.lineup_id, sl.etape, s.id, s.titre, s.carte_nom, s.visibilite, s.cree_par
         FROM strat_lineups sl JOIN strats s ON s.id = sl.strat_id
        WHERE sl.team_id = ? AND s.supprime_le IS NULL ORDER BY s.titre, s.id`,
      [ctx.team.id],
    );
    const voitStrats = Boolean(strats) && ctx.modules.has('strat_editor') && peut(ctx, 'strats.view');
    for (const s of lignes) {
      const liste = sortie.get(s.lineup_id);
      if (!liste) continue;
      const visible = voitStrats && strats.visible(ctx, s);
      // Une strat privée (ou le module Strats fermé au rôle) : comptée, jamais nommée.
      liste.push(visible ? { id: s.id, titre: s.titre, carte: s.carte_nom, etape: s.etape === null || s.etape === undefined ? null : Number(s.etape), ouvrable: true } : { id: null, titre: null, carte: null, etape: null, ouvrable: false });
    }
    return sortie;
  }

  async function lineupsPublics(ctx, lignes, origine) {
    const ids = lignes.map(l => l.id);
    const parLineup = new Map(ids.map(id => [id, []]));
    const favoris = new Set();
    if (ids.length > 0) {
      const mediasLignes = await base.tous(
        `SELECT m.id, m.lineup_id, m.role, m.position, f.id AS fichier_id, f.type_mime, f.taille, f.nom_original, f.supprime_le
           FROM lineup_medias m JOIN fichiers f ON f.id = m.fichier_id
          WHERE m.team_id = ? ORDER BY m.position, m.cree_le, m.id`,
        [ctx.team.id],
      );
      for (const m of mediasLignes) if (!m.supprime_le) parLineup.get(m.lineup_id)?.push(m);
      for (const f of await base.tous('SELECT lineup_id FROM lineup_favoris WHERE team_id = ? AND compte_id = ?', [ctx.team.id, ctx.acteur.compte])) favoris.add(f.lineup_id);
    }
    const liees = await stratsLiees(ctx, ids);
    const noms = await pseudosDe(base, lignes.flatMap(l => [l.cree_par, l.valide_par]).filter(Boolean));
    const point = (x, y) => (x === null || x === undefined || y === null || y === undefined ? null : { x: Number(x), y: Number(y) });
    return Promise.all(
      lignes.map(async l => ({
        id: l.id,
        jeu: l.jeu,
        modele: l.modele ?? modeleDuJeu(null, l.jeu),
        titre: l.titre,
        carte: { cle: l.carte, nom: l.carte_nom },
        personnage: l.personnage || l.personnage_nom ? { cle: l.personnage ?? null, nom: l.personnage_nom || l.personnage } : null,
        capacite: l.capacite || l.capacite_nom ? { cle: l.capacite ?? null, nom: l.capacite_nom || l.capacite } : null,
        side: l.side ?? '',
        zone: l.zone || l.zone_nom ? { cle: l.zone ?? null, nom: l.zone_nom || l.zone } : null,
        posture: l.posture,
        visee: l.visee,
        timing: l.timing,
        instructions: l.instructions,
        difficulte: Number(l.difficulte),
        tags: jsonOu(l.tags, []),
        depart: point(l.depart_x, l.depart_y),
        arrivee: point(l.arrivee_x, l.arrivee_y),
        videoUrl: l.video_url ?? null,
        medias: await Promise.all(
          (parLineup.get(l.id) ?? []).map(async m => ({
            id: m.id,
            role: m.role,
            genre: m.role === 'video' ? 'video' : 'image',
            type: m.type_mime,
            taille: Number(m.taille),
            nom: m.nom_original,
            lien: await lienMedia(m.fichier_id, ctx.acteur.compte, origine),
          })),
        ),
        statut: l.statut,
        validePar: l.valide_par ? { compte: l.valide_par, pseudo: noms[l.valide_par] ?? null } : null,
        valideLe: l.valide_le ?? null,
        favori: favoris.has(l.id),
        strats: liees.get(l.id) ?? [],
        creePar: { compte: l.cree_par ?? null, pseudo: l.cree_par ? (noms[l.cree_par] ?? null) : null },
        creeLe: l.cree_le,
        majLe: l.maj_le,
        moi: { modifier: peutModifier(ctx, l), supprimer: peutModifier(ctx, l), valider: peut(ctx, 'lineups.gerer'), lier: peutLier(ctx) && ctx.modules.has('strat_editor') && peut(ctx, 'strats.view') },
      })),
    );
  }

  const droitsDe = ctx => ({ proposer: peut(ctx, 'lineups.proposer') || peut(ctx, 'lineups.gerer'), gerer: peut(ctx, 'lineups.gerer'), lier: peutLier(ctx) && ctx.modules.has('strat_editor') && peut(ctx, 'strats.view') });

  // -------------------------------------------------------------- Lecture

  async function liste(acteur, teamId, filtres = {}, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'lineups.voir');
    if (filtres.statut && !STATUTS_LINEUP.includes(filtres.statut)) throw echec(400, 'statut', 'Filtre statut inconnu.');
    const lignes = await base.tous('SELECT * FROM lineups WHERE team_id = ? AND supprime_le IS NULL ORDER BY maj_le DESC LIMIT ?', [teamId, LINEUPS_MAX]);
    const tous = await lineupsPublics(ctx, lignes, origine);
    return { lineups: trierLineups(filtrerLineups(tous, filtres)), total: tous.length, droits: droitsDe(ctx), limites: { images: IMAGES_MAX, tailleImage: TAILLE_MAX_IMAGE_LINEUP, tailleVideo: TAILLE_MAX_VIDEO_LINEUP } };
  }

  async function detail(acteur, teamId, id, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'lineups.voir');
    return (await lineupsPublics(ctx, [await lineupDeTeam(ctx, id)], origine))[0];
  }

  // -------------------------------------------------------------- Écriture

  function lire(corps, partiel) {
    const s = {};
    const champ = k => !partiel || corps?.[k] !== undefined;
    if (champ('titre')) {
      s.titre = texteNettoye(corps?.titre, 80);
      if (s.titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    }
    if (champ('carte')) {
      const c = lireReference(corps?.carte, 'carte', { obligatoire: true });
      s.carte = c.cle;
      s.carte_nom = c.nom.slice(0, 40);
    }
    if (champ('personnage')) {
      // Personnage et capacité : clé du profil de jeu, ou texte libre (profil sans personnages, gadget pas encore saisi).
      const p = lireReference(corps?.personnage, 'personnage', { cleLibre: true });
      s.personnage = p?.cle ?? null;
      s.personnage_nom = p?.nom ?? '';
    }
    if (champ('capacite')) {
      const c = lireReference(corps?.capacite, 'capacite', { cleLibre: true });
      s.capacite = c?.cle ?? null;
      s.capacite_nom = c?.nom ?? '';
    }
    if (champ('side')) {
      const side = corps?.side ?? '';
      if (side !== '' && (typeof side !== 'string' || !MOTIF_CLE.test(side))) throw echec(400, 'side', 'Side : attaque, défense, ou un mode du jeu.');
      s.side = side;
    }
    if (champ('zone')) {
      // Callout de la map (clé) ou texte libre (sans clé).
      const z = lireReference(corps?.zone, 'zone', { cleLibre: true });
      s.zone = z?.cle ?? null;
      s.zone_nom = z?.nom ?? '';
    }
    if (champ('posture')) {
      const p = corps?.posture ?? 'debout';
      if (!POSTURES.includes(p)) throw echec(400, 'posture', 'Posture : debout, saut, course ou accroupi.');
      s.posture = p;
    }
    if (champ('visee')) s.visee = texteLong(corps?.visee, 500);
    if (champ('timing')) s.timing = texteNettoye(corps?.timing, 120);
    if (champ('instructions')) s.instructions = texteLong(corps?.instructions, 4000);
    if (champ('difficulte')) {
      const d = corps?.difficulte ?? 1;
      if (!Number.isInteger(d) || d < 1 || d > 3) throw echec(400, 'difficulte', 'Difficulté : 1, 2 ou 3.');
      s.difficulte = d;
    }
    if (champ('tags')) s.tags = JSON.stringify(tagsPropres(corps?.tags));
    if (champ('depart')) {
      const p = lirePoint(corps?.depart, 'depart');
      s.depart_x = p?.x ?? null;
      s.depart_y = p?.y ?? null;
    }
    if (champ('arrivee')) {
      const p = lirePoint(corps?.arrivee, 'arrivee');
      s.arrivee_x = p?.x ?? null;
      s.arrivee_y = p?.y ?? null;
    }
    if (champ('videoUrl')) s.video_url = lireLienVideo(corps?.videoUrl);
    if (corps?.statut !== undefined) {
      if (!STATUTS_LINEUP.includes(corps.statut)) throw echec(400, 'statut', 'Statut : propose ou valide.');
      s.statut = corps.statut;
    }
    return s;
  }

  /** Jeu et modèle de strat de la team (profil de son jeu). */
  async function modeleDeTeam(team) {
    const j = await base.premier('SELECT modele_strat FROM jeux WHERE cle = ?', [team.jeu]);
    return { jeu: team.jeu, modele: modeleDuJeu(j?.modele_strat, team.jeu) };
  }

  async function creer(acteur, teamId, corps, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx);
    const gere = peut(ctx, 'lineups.gerer');
    if (!gere && !peut(ctx, 'lineups.proposer')) throw refus();
    const s = lire(corps, false);
    // Un joueur PROPOSE ; le staff qui gère crée directement un lineup validé (sauf s'il demande « proposé »).
    const statut = gere ? (s.statut ?? 'valide') : 'propose';
    const { jeu, modele } = await modeleDeTeam(ctx.team);
    const t = maintenant();
    const id = nouvelId();
    const colonnes = ['titre', 'carte', 'carte_nom', 'personnage', 'personnage_nom', 'capacite', 'capacite_nom', 'side', 'zone', 'zone_nom', 'posture', 'visee', 'timing', 'instructions', 'difficulte', 'tags', 'depart_x', 'depart_y', 'arrivee_x', 'arrivee_y', 'video_url'];
    await base.lot([
      {
        sql: `INSERT INTO lineups (id, team_id, jeu, modele, ${colonnes.join(', ')}, statut, valide_par, valide_le, cree_par, cree_le, maj_par, maj_le)
              VALUES (?, ?, ?, ?, ${colonnes.map(() => '?').join(', ')}, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, teamId, jeu, modele, ...colonnes.map(c => s[c] ?? null), statut, statut === 'valide' ? acteur.compte : null, statut === 'valide' ? iso(t) : null, acteur.compte, iso(t), acteur.compte, iso(t)],
      },
      evenement('lineup.created', { teamId, acteur: acteur.compte, entiteType: 'lineup', entiteId: id, charge: { titre: s.titre, carte: s.carte_nom, statut }, maintenant: t }),
    ]);
    return detail(acteur, teamId, id, { origine });
  }

  async function modifier(acteur, teamId, id, corps, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'lineups.voir');
    const l = await lineupDeTeam(ctx, id);
    const s = lire(corps, true);
    const gere = peut(ctx, 'lineups.gerer');
    // Le statut (valider, repasser en proposé) n'appartient qu'à ceux qui gèrent.
    if (s.statut !== undefined && s.statut !== l.statut && !gere) throw refus();
    const contenu = Object.keys(s).filter(c => c !== 'statut');
    if (contenu.length > 0 && !peutModifier(ctx, l)) throw refus();
    const cols = Object.keys(s);
    if (cols.length === 0) return detail(acteur, teamId, id, { origine });
    const t = maintenant();
    const valide = s.statut === 'valide' && l.statut !== 'valide';
    if (valide) {
      s.valide_par = acteur.compte;
      s.valide_le = iso(t);
    }
    if (s.statut === 'propose' && l.statut !== 'propose') {
      s.valide_par = null;
      s.valide_le = null;
    }
    const toutes = Object.keys(s);
    const titre = s.titre ?? l.titre;
    await base.lot([
      { sql: `UPDATE lineups SET ${toutes.map(c => `${c} = ?`).join(', ')}, maj_par = ?, maj_le = ? WHERE id = ?`, params: [...toutes.map(c => s[c]), acteur.compte, iso(t), id] },
      valide
        ? evenement('lineup.validated', { teamId, acteur: acteur.compte, entiteType: 'lineup', entiteId: id, charge: { titre, carte: s.carte_nom ?? l.carte_nom, auteur: l.cree_par ?? null }, maintenant: t })
        : evenement('lineup.updated', { teamId, acteur: acteur.compte, entiteType: 'lineup', entiteId: id, charge: { titre, champs: cols }, maintenant: t }),
    ]);
    return detail(acteur, teamId, id, { origine });
  }

  // -------------------------------------------------------------- Médias

  /** Rattache un envoi terminé (à soi) au lineup : type et taille vérifiés, nombre borné. */
  async function rattacherMedia(ctx, l, corps) {
    if (!medias) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché sur le serveur Esport.');
    const role = corps?.role ?? 'autre';
    if (role !== 'video' && !ROLES_IMAGE.includes(role)) throw echec(400, 'role', 'Rôle du média : position, visee, resultat, autre ou video.');
    const r = await medias.preparerRattachement(ctx, corps?.envoi, 'lineup', { entiteType: 'lineup_media', entiteId: l.id });
    const genre = FORMATS[r.analyse?.format]?.genre;
    const taille = Number(r.envoi.taille);
    const existants = await base.tous('SELECT m.id, m.role FROM lineup_medias m JOIN fichiers f ON f.id = m.fichier_id WHERE m.lineup_id = ? AND f.supprime_le IS NULL', [l.id]);
    let erreur;
    if (role === 'video') {
      if (genre !== 'video') erreur = echec(415, 'format-video', 'Ce fichier n’est pas une vidéo reconnue (MP4, MOV ou WebM).');
      else if (taille > TAILLE_MAX_VIDEO_LINEUP) erreur = echec(413, 'fichier-trop-gros', 'Vidéo trop volumineuse : 200 Mo au plus (un lineup se montre en quelques secondes).');
      else if (existants.some(m => m.role === 'video')) erreur = echec(409, 'video-deja-la', 'Ce lineup a déjà une vidéo : retirez-la d’abord.');
    } else if (genre !== 'image') erreur = echec(415, 'format-image', 'Ce fichier n’est pas une image reconnue (PNG, JPEG, WebP ou GIF).');
    else if (taille > TAILLE_MAX_IMAGE_LINEUP) erreur = echec(413, 'fichier-trop-gros', 'Image trop volumineuse : 12 Mo au plus.');
    else if (existants.filter(m => m.role !== 'video').length >= IMAGES_MAX) erreur = echec(409, 'trop-d-images', `${IMAGES_MAX} images au plus par lineup.`);
    if (erreur) {
      // L'envoi refusé ne reste pas sur le disque.
      await medias.annulerEnvoi(ctx.acteur, ctx.team.id, 'lineup', corps.envoi).catch(() => undefined);
      throw erreur;
    }
    const t = maintenant();
    const id = nouvelId();
    await base.lot([
      ...r.instructions,
      { sql: 'INSERT INTO lineup_medias (id, lineup_id, team_id, fichier_id, role, position, cree_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', params: [id, l.id, ctx.team.id, r.fichierId, role, existants.length, ctx.acteur.compte, iso(t)] },
      { sql: 'UPDATE lineups SET maj_par = ?, maj_le = ? WHERE id = ?', params: [ctx.acteur.compte, iso(t), l.id] },
    ]);
    return id;
  }

  async function ajouterMedia(acteur, teamId, id, corps, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'lineups.voir');
    const l = await lineupDeTeam(ctx, id);
    if (!peutModifier(ctx, l)) throw refus();
    await rattacherMedia(ctx, l, corps);
    return detail(acteur, teamId, id, { origine });
  }

  async function mediaDeLineup(l, mediaId) {
    exigerUuid(mediaId, 'media');
    const m = await base.premier('SELECT * FROM lineup_medias WHERE id = ? AND lineup_id = ?', [mediaId, l.id]);
    if (!m) throw echec(404, 'media-introuvable', 'Média introuvable.');
    return m;
  }

  /** Rôle d'une image (position, visée, résultat, autre) et ordre d'affichage. */
  async function modifierMedia(acteur, teamId, id, mediaId, corps, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'lineups.voir');
    const l = await lineupDeTeam(ctx, id);
    if (!peutModifier(ctx, l)) throw refus();
    const m = await mediaDeLineup(l, mediaId);
    const s = {};
    if (corps?.role !== undefined) {
      if (m.role === 'video' || !ROLES_IMAGE.includes(corps.role)) throw echec(400, 'role', 'Rôle d’une image : position, visee, resultat ou autre.');
      s.role = corps.role;
    }
    if (corps?.position !== undefined) {
      if (!Number.isInteger(corps.position) || corps.position < 0 || corps.position > 20) throw echec(400, 'position', 'Position illisible.');
      s.position = corps.position;
    }
    const cols = Object.keys(s);
    if (cols.length > 0) {
      const t = maintenant();
      await base.lot([
        { sql: `UPDATE lineup_medias SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, params: [...cols.map(c => s[c]), m.id] },
        { sql: 'UPDATE lineups SET maj_par = ?, maj_le = ? WHERE id = ?', params: [acteur.compte, iso(t), l.id] },
      ]);
    }
    return detail(acteur, teamId, id, { origine });
  }

  async function retirerMedia(acteur, teamId, id, mediaId, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'lineups.voir');
    const l = await lineupDeTeam(ctx, id);
    if (!peutModifier(ctx, l)) throw refus();
    const m = await mediaDeLineup(l, mediaId);
    const t = maintenant();
    await base.lot([
      { sql: 'DELETE FROM lineup_medias WHERE id = ?', params: [m.id] },
      { sql: 'UPDATE lineups SET maj_par = ?, maj_le = ? WHERE id = ?', params: [acteur.compte, iso(t), l.id] },
    ]);
    // Les octets disparaissent, la ligne de `fichiers` reste (marquée supprimée).
    if (medias) await medias.effacerOctets(m.fichier_id);
    return detail(acteur, teamId, id, { origine });
  }

  // -------------------------------------------------------------- Favoris

  async function favori(acteur, teamId, id, actif) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'lineups.voir');
    const l = await lineupDeTeam(ctx, id);
    if (actif) {
      await base.executer('INSERT INTO lineup_favoris (lineup_id, compte_id, team_id, cree_le) VALUES (?, ?, ?, ?) ON CONFLICT (lineup_id, compte_id) DO NOTHING', [l.id, acteur.compte, teamId, iso(maintenant())]);
    } else await base.executer('DELETE FROM lineup_favoris WHERE lineup_id = ? AND compte_id = ?', [l.id, acteur.compte]);
    return { ok: true, favori: Boolean(actif) };
  }

  // -------------------------------------------------------------- Liens avec les strats

  /** Strat de la team que l'acteur peut voir (module Strats actif, strats.view, visibilité), sinon 404. */
  async function stratVisible(ctx, stratId) {
    exigerUuid(stratId, 'strat');
    if (!strats || !ctx.modules.has('strat_editor') || !peut(ctx, 'strats.view')) throw echec(404, 'strat-introuvable', 'Strat introuvable.');
    const s = await base.premier('SELECT * FROM strats WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [stratId, ctx.team.id]);
    if (!s || !strats.visible(ctx, s)) throw echec(404, 'strat-introuvable', 'Strat introuvable.');
    return s;
  }

  function lireEtape(valeur) {
    if (valeur === undefined || valeur === null || valeur === '') return null;
    if (!Number.isInteger(valeur) || valeur < 1 || valeur > 20) throw echec(400, 'etape', 'Étape : de 1 à 20, ou vide.');
    return valeur;
  }

  async function lierStrat(acteur, teamId, id, stratId, corps, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'lineups.voir');
    const l = await lineupDeTeam(ctx, id);
    const s = await stratVisible(ctx, stratId);
    if (!peutLier(ctx)) throw refus();
    const etape = lireEtape(corps?.etape);
    const t = maintenant();
    const existe = await base.premier('SELECT etape FROM strat_lineups WHERE strat_id = ? AND lineup_id = ?', [s.id, l.id]);
    await base.lot([
      {
        sql: `INSERT INTO strat_lineups (strat_id, lineup_id, team_id, etape, cree_par, cree_le) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (strat_id, lineup_id) DO UPDATE SET etape = excluded.etape`,
        params: [s.id, l.id, teamId, etape, acteur.compte, iso(t)],
      },
      ...(existe ? [] : [evenement('lineup.linked', { teamId, acteur: acteur.compte, entiteType: 'lineup', entiteId: l.id, charge: { titre: l.titre, strat: s.id, stratTitre: s.titre, etape }, maintenant: t })]),
    ]);
    return detail(acteur, teamId, id, { origine });
  }

  async function delierStrat(acteur, teamId, id, stratId, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'lineups.voir');
    const l = await lineupDeTeam(ctx, id);
    const s = await stratVisible(ctx, stratId);
    if (!peutLier(ctx)) throw refus();
    const t = maintenant();
    const existe = await base.premier('SELECT etape FROM strat_lineups WHERE strat_id = ? AND lineup_id = ?', [s.id, l.id]);
    if (existe) {
      await base.lot([
        { sql: 'DELETE FROM strat_lineups WHERE strat_id = ? AND lineup_id = ?', params: [s.id, l.id] },
        evenement('lineup.unlinked', { teamId, acteur: acteur.compte, entiteType: 'lineup', entiteId: l.id, charge: { titre: l.titre, strat: s.id, stratTitre: s.titre }, maintenant: t }),
      ]);
    }
    return detail(acteur, teamId, id, { origine });
  }

  /**
   * Lineups d'une strat (lecture pour l'éditeur de strats et le bloc « Lineups liés ») : la strat doit être visible
   * de l'acteur ; chaque lineup porte son étape (`etape`, ou null). Triés par étape, puis par titre.
   */
  async function lineupsDeStrat(acteur, teamId, stratId, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'lineups.voir');
    const s = await stratVisible(ctx, stratId);
    const liens = await base.tous('SELECT lineup_id, etape FROM strat_lineups WHERE strat_id = ? AND team_id = ?', [s.id, teamId]);
    const etapes = new Map(liens.map(x => [x.lineup_id, x.etape === null || x.etape === undefined ? null : Number(x.etape)]));
    const lignes = liens.length ? (await base.tous('SELECT * FROM lineups WHERE team_id = ? AND supprime_le IS NULL ORDER BY titre, id LIMIT ?', [teamId, LINEUPS_MAX])).filter(l => etapes.has(l.id)) : [];
    const publics = (await lineupsPublics(ctx, lignes, origine)).map(l => ({ ...l, etape: etapes.get(l.id) ?? null }));
    publics.sort((a, b) => (a.etape ?? 99) - (b.etape ?? 99) || a.titre.localeCompare(b.titre, 'fr'));
    return { strat: { id: s.id, titre: s.titre }, lineups: publics, droits: droitsDe(ctx) };
  }

  // -------------------------------------------------------------- Corbeille (30 jours)

  async function supprimer(acteur, teamId, id) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'lineups.voir');
    const l = await lineupDeTeam(ctx, id);
    if (!peutModifier(ctx, l)) throw refus();
    const t = maintenant();
    // Les liens avec les strats sont gardés : ils reviennent avec le lineup s'il est restauré.
    await base.lot([
      { sql: 'UPDATE lineups SET supprime_le = ?, supprime_par = ?, maj_le = ? WHERE id = ?', params: [iso(t), acteur.compte, iso(t), id] },
      evenement('lineup.deleted', { teamId, acteur: acteur.compte, entiteType: 'lineup', entiteId: id, charge: { titre: l.titre }, maintenant: t }),
    ]);
    return { ok: true };
  }

  const peutRestaurer = (ctx, l) => peut(ctx, 'lineups.gerer') || (l.cree_par === ctx.acteur.compte && peut(ctx, 'lineups.proposer'));

  async function corbeille(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'lineups.voir');
    const limite = iso(maintenant() - DUREE_CORBEILLE_LINEUPS_MS);
    const lignes = await base.tous('SELECT id, titre, carte, carte_nom, statut, cree_par, supprime_le, supprime_par FROM lineups WHERE team_id = ? AND supprime_le IS NOT NULL AND supprime_le >= ? ORDER BY supprime_le DESC LIMIT 200', [teamId, limite]);
    const retenus = lignes.filter(l => peutRestaurer(ctx, l));
    const noms = await pseudosDe(base, retenus.map(l => l.supprime_par).filter(Boolean));
    return retenus.map(l => ({
      id: l.id,
      titre: l.titre,
      carte: { cle: l.carte, nom: l.carte_nom },
      statut: l.statut,
      supprimeLe: l.supprime_le,
      supprimePar: l.supprime_par ? { compte: l.supprime_par, pseudo: noms[l.supprime_par] ?? null } : null,
      expireLe: iso(Date.parse(l.supprime_le) + DUREE_CORBEILLE_LINEUPS_MS),
    }));
  }

  async function restaurer(acteur, teamId, id, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'lineups.voir');
    exigerUuid(id, 'lineup');
    const l = await base.premier('SELECT * FROM lineups WHERE id = ? AND team_id = ? AND supprime_le IS NOT NULL', [id, teamId]);
    if (!l || l.supprime_le < iso(maintenant() - DUREE_CORBEILLE_LINEUPS_MS)) throw echec(404, 'lineup-introuvable', 'Lineup introuvable dans la corbeille.');
    if (!peutRestaurer(ctx, l)) throw refus();
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE lineups SET supprime_le = NULL, supprime_par = NULL, maj_le = ? WHERE id = ?', params: [iso(t), id] },
      evenement('lineup.restored', { teamId, acteur: acteur.compte, entiteType: 'lineup', entiteId: id, charge: { titre: l.titre }, maintenant: t }),
    ]);
    return detail(acteur, teamId, id, { origine });
  }

  return { liste, detail, creer, modifier, supprimer, corbeille, restaurer, ajouterMedia, modifierMedia, retirerMedia, favori, lierStrat, delierStrat, lineupsDeStrat };
}

/**
 * Cron : efface définitivement les lineups à la corbeille depuis plus de 30 jours, avec leurs médias (lignes, puis
 * octets), leurs favoris et leurs liens avec les strats. Rend le nombre de lineups effacés.
 */
export async function purgerCorbeilleLineups(base, stockage, { maintenant = Date.now(), duree = DUREE_CORBEILLE_LINEUPS_MS, limite = 200 } = {}) {
  const avant = iso(maintenant - duree);
  const lignes = await base.tous('SELECT id FROM lineups WHERE supprime_le IS NOT NULL AND supprime_le < ? ORDER BY supprime_le LIMIT ?', [avant, limite]);
  for (const { id } of lignes) {
    const fichiers = await base.tous("SELECT id, cle_stockage FROM fichiers WHERE entite_type = 'lineup_media' AND entite_id = ?", [id]);
    await base.lot([
      { sql: 'DELETE FROM strat_lineups WHERE lineup_id = ?', params: [id] },
      { sql: 'DELETE FROM lineup_favoris WHERE lineup_id = ?', params: [id] },
      { sql: 'DELETE FROM lineup_medias WHERE lineup_id = ?', params: [id] },
      { sql: 'DELETE FROM lineups WHERE id = ?', params: [id] },
      // La trace de l'envoi d'origine part avec le fichier.
      { sql: "DELETE FROM envois WHERE usage = 'lineup' AND fichier_id IN (SELECT id FROM fichiers WHERE entite_type = 'lineup_media' AND entite_id = ?)", params: [id] },
      { sql: "DELETE FROM fichiers WHERE entite_type = 'lineup_media' AND entite_id = ?", params: [id] },
    ]);
    if (stockage) for (const f of fichiers) await stockage.supprimer(f.cle_stockage).catch(() => undefined);
  }
  return lignes.length;
}
