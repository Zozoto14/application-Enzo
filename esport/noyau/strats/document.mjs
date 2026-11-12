/**
 * Document d'une strat (éditeur façon valoplant.gg) : validation et migration
 * côté serveur. Fonctions PURES (aucune base, aucun réseau).
 *
 * Le document est un JSON VERSIONNÉ (`version`) ; l'app a le même modèle en
 * TypeScript (src/esport/strats/document.ts). Le serveur ne fait jamais
 * confiance à ce que l'app envoie : tout document est migré vers la version
 * courante, puis reconstruit champ par champ (les champs inconnus sont
 * jetés), avec des bornes (taille totale, étapes, objets, textes, nombres).
 *
 * Repère : un carré de 1000 × 1000 (la minimap est carrée), indépendant de la
 * taille d'affichage. Version 1 (première ébauche) : une seule « frame »
 * (`objets` à plat) ; version 2 : étapes successives, calques, joueurs ;
 * version 3 : modèle de strat du jeu (valorant, thefinals, generique), zones
 * des capacités EN MÈTRES (dessinées avec l'échelle de la map), phases et
 * durées des étapes, économie du round, ordre et minutage des utilitaires,
 * trajets minutés des joueurs, cônes de vision, marqueurs (objectifs,
 * ennemis, destruction…), étages.
 */

import { echec, texteLong, texteNettoye } from '../outils.mjs';
import { ECHELLE_DEFAUT, ECHELLE_MAX, ECHELLE_MIN, MODELES, MODELES_STRAT, modeleDuJeu } from './modeles.mjs';

export const FORMAT_STRAT = 'esport-strat';
export const VERSION_DOCUMENT = 3;
/** Taille max du document sérialisé (octets UTF-8). */
export const TAILLE_MAX_DOCUMENT = 384 * 1024;
export const ETAPES_MAX = 30;
export const OBJETS_MAX = 250;
export const POINTS_MAX = 64;
export const JOUEURS_MAX = 10;
export const SIDES = ['attaque', 'defense'];
export const TYPES_STRAT = ['default', 'execute', 'eco', 'pistol', 'retake', 'other'];
export const CALQUES = ['fond', 'callouts', 'utilitaires', 'vision', 'marqueurs', 'dessins', 'texte'];
export const TYPES_OBJETS = ['agent', 'capacite', 'fleche', 'ligne', 'forme', 'texte', 'marqueur', 'vision'];
export const FORMES_ZONE = ['cercle', 'mur', 'cone', 'trajet', 'ligne', 'rect'];
export const GENRES_MARQUEUR = ['objectif', 'ennemi', 'danger', 'destruction-mur', 'destruction-sol', 'spawn', 'plant', 'defuse', 'info', 'rotation', 'tiers', 'cashout', 'coffre'];
/** Couleurs par défaut des joueurs (lisibles sur la minimap, en clair comme en sombre). */
export const COULEURS_JOUEURS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#06b6d4', '#ec4899', '#84cc16', '#f43f5e'];
export const DUREE_ETAPE_DEFAUT = 5;

const MOTIF_ID = /^[A-Za-z0-9_-]{1,24}$/;
const MOTIF_CLE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MOTIF_SLOT = /^[A-Za-z0-9_-]{1,40}$/;
const MOTIF_COULEUR = /^#[0-9a-fA-F]{6}$/;
const MOTIF_COMPTE = /^(principal|[a-z0-9]{6,16})$/;
/**
 * Images autorisées dans un document : le CDN public de valorant-api.com
 * (cartes, agents, capacités), ou un fichier du dossier d'assets remplaçable
 * livré avec le site (`esport-assets/…`). Rien d'autre (ni http, ni data:).
 * Les images DÉPOSÉES dans un profil de jeu ne sont jamais copiées dans un
 * document : l'éditeur les lit dans le profil (lien signé).
 */
const MOTIF_IMAGE = /^(https:\/\/media\.valorant-api\.com\/[A-Za-z0-9/_.-]{1,200}|esport-assets\/[a-z0-9/_.-]{1,160})$/;
const MIN = -500;
const MAX = 1500;

const invalide = message => echec(400, 'strat-invalide', `Strat invalide : ${message}`);

/** Calque d'un objet (déduit de son type : jamais stocké). */
export function calqueDe(objet) {
  if (objet.type === 'agent' || objet.type === 'capacite') return 'utilitaires';
  if (objet.type === 'texte') return 'texte';
  if (objet.type === 'vision') return 'vision';
  if (objet.type === 'marqueur') return 'marqueurs';
  return 'dessins';
}

const objet = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function nombre(v, quoi, min = MIN, max = MAX) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw invalide(`${quoi} hors limites`);
  return Math.round(v * 10) / 10;
}

/** Nombre facultatif (absent ou null : null). */
function facultatif(v, quoi, min, max) {
  return v === undefined || v === null ? null : nombre(v, quoi, min, max);
}

function entierFacultatif(v, quoi, min, max) {
  if (v === undefined || v === null) return null;
  if (!Number.isInteger(v) || v < min || v > max) throw invalide(`${quoi} hors limites`);
  return v;
}

function couleur(v, repli = '#ffffff') {
  if (v === undefined || v === null) return repli;
  if (typeof v !== 'string' || !MOTIF_COULEUR.test(v)) throw invalide('couleur (#rrggbb attendu)');
  return v.toLowerCase();
}

function image(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !MOTIF_IMAGE.test(v) || v.includes('..')) throw invalide('image non autorisée');
  return v;
}

function cle(v, quoi) {
  if (typeof v !== 'string' || !MOTIF_CLE.test(v)) throw invalide(quoi);
  return v;
}

function joueur(v, nbJoueurs) {
  if (v === undefined || v === null) return null;
  if (!Number.isInteger(v) || v < 0 || v >= nbJoueurs) throw invalide('joueur inconnu');
  return v;
}

function points(v) {
  if (!Array.isArray(v) || v.length < 4 || v.length > POINTS_MAX || v.length % 2 !== 0) throw invalide('tracé (4 à 64 coordonnées)');
  return v.map((n, i) => nombre(n, `point ${i}`));
}

const niveau = v => entierFacultatif(v, 'étage', -5, 20);
const angle = (v, repli = 0) => nombre(v ?? repli, 'angle', -360, 360);

/** Zone d'une capacité (dimensions en MÈTRES ; `trajet` : origine du lancer en unités du repère). */
function zone(v) {
  if (v === undefined || v === null) return null;
  if (!objet(v) || !FORMES_ZONE.includes(v.forme)) throw invalide('zone de capacité');
  switch (v.forme) {
    case 'cercle':
      return { forme: 'cercle', rayon: nombre(v.rayon, 'rayon', 0.2, 100) };
    case 'mur':
      return { forme: 'mur', angle: angle(v.angle), longueur: nombre(v.longueur, 'longueur', 0.5, 200), largeur: nombre(v.largeur ?? 1, 'largeur', 0.1, 30), courbure: nombre(v.courbure ?? 0, 'courbure', -1, 1) };
    case 'cone':
      return { forme: 'cone', angle: angle(v.angle), ouverture: nombre(v.ouverture ?? 60, 'ouverture', 5, 360), portee: nombre(v.portee, 'portée', 0.5, 200) };
    case 'trajet':
      return { forme: 'trajet', dx: nombre(v.dx ?? 0, 'trajet', -1500, 1500), dy: nombre(v.dy ?? 0, 'trajet', -1500, 1500), rayon: nombre(v.rayon ?? 0, 'rayon', 0, 100) };
    case 'ligne':
      return { forme: 'ligne', angle: angle(v.angle), longueur: nombre(v.longueur, 'longueur', 0.5, 200) };
    default:
      return { forme: 'rect', angle: angle(v.angle), longueur: nombre(v.longueur, 'longueur', 0.5, 200), largeur: nombre(v.largeur ?? 1, 'largeur', 0.1, 100) };
  }
}

/** Un objet de l'étape, reconstruit (champs connus seulement). */
function objetValide(v, nbJoueurs) {
  if (!objet(v) || !TYPES_OBJETS.includes(v.type)) throw invalide('type d’objet inconnu');
  if (typeof v.id !== 'string' || !MOTIF_ID.test(v.id)) throw invalide('identifiant d’objet');
  const commun = { id: v.id, type: v.type };
  switch (v.type) {
    case 'agent':
      return {
        ...commun,
        x: nombre(v.x, 'x'),
        y: nombre(v.y, 'y'),
        agent: cle(v.agent, 'agent'),
        nom: texteNettoye(v.nom, 40) || v.agent,
        icone: image(v.icone),
        joueur: joueur(v.joueur, nbJoueurs),
        couleur: couleur(v.couleur),
        angle: facultatif(v.angle, 'angle', -360, 360),
        niveau: niveau(v.niveau),
      };
    case 'capacite':
      return {
        ...commun,
        x: nombre(v.x, 'x'),
        y: nombre(v.y, 'y'),
        agent: cle(v.agent, 'agent'),
        capacite: typeof v.capacite === 'string' && MOTIF_SLOT.test(v.capacite) ? v.capacite : (() => { throw invalide('capacité'); })(),
        nom: texteNettoye(v.nom, 40) || v.capacite,
        icone: image(v.icone),
        joueur: joueur(v.joueur, nbJoueurs),
        couleur: couleur(v.couleur),
        zone: zone(v.zone),
        ordre: entierFacultatif(v.ordre, 'ordre', 1, 99),
        t: facultatif(v.t, 'minutage', 0, 600),
        niveau: niveau(v.niveau),
      };
    case 'fleche':
    case 'ligne':
      return {
        ...commun,
        points: points(v.points),
        couleur: couleur(v.couleur),
        epaisseur: nombre(v.epaisseur ?? 4, 'épaisseur', 1, 20),
        tirets: v.tirets === true,
        joueur: joueur(v.joueur, nbJoueurs),
        t0: facultatif(v.t0, 'minutage', 0, 600),
        t1: facultatif(v.t1, 'minutage', 0, 600),
        niveau: niveau(v.niveau),
      };
    case 'forme':
      if (!['rect', 'ellipse'].includes(v.forme)) throw invalide('forme');
      return {
        ...commun,
        forme: v.forme,
        x: nombre(v.x, 'x'),
        y: nombre(v.y, 'y'),
        l: nombre(v.l, 'largeur', 1, 1500),
        h: nombre(v.h, 'hauteur', 1, 1500),
        couleur: couleur(v.couleur),
        remplie: v.remplie === true,
        niveau: niveau(v.niveau),
      };
    case 'marqueur':
      if (!GENRES_MARQUEUR.includes(v.genre)) throw invalide('genre de marqueur');
      return {
        ...commun,
        x: nombre(v.x, 'x'),
        y: nombre(v.y, 'y'),
        genre: v.genre,
        etiquette: texteNettoye(v.etiquette, 40),
        couleur: couleur(v.couleur),
        equipe: entierFacultatif(v.equipe, 'équipe', 0, 9),
        niveau: niveau(v.niveau),
      };
    case 'vision':
      return {
        ...commun,
        x: nombre(v.x, 'x'),
        y: nombre(v.y, 'y'),
        angle: angle(v.angle),
        ouverture: nombre(v.ouverture ?? 90, 'ouverture', 5, 360),
        portee: nombre(v.portee ?? 30, 'portée', 1, 200),
        joueur: joueur(v.joueur, nbJoueurs),
        couleur: couleur(v.couleur),
        niveau: niveau(v.niveau),
      };
    default: {
      const texte = texteLong(v.texte, 200);
      if (!texte) throw invalide('texte vide');
      return { ...commun, x: nombre(v.x, 'x'), y: nombre(v.y, 'y'), texte, couleur: couleur(v.couleur), taille: nombre(v.taille ?? 24, 'taille', 8, 96), niveau: niveau(v.niveau) };
    }
  }
}

/** Version 1 → 2 : la frame unique devient la première étape, calques par défaut. */
function migrerV1(v) {
  return {
    format: FORMAT_STRAT,
    version: 2,
    jeu: v.jeu ?? 'valorant',
    carte: typeof v.carte === 'string' ? { cle: v.carte, nom: v.carte, image: null } : v.carte,
    side: v.side,
    joueurs: COULEURS_JOUEURS.slice(0, 5).map((c, i) => ({ nom: `Joueur ${i + 1}`, couleur: c, agent: null })),
    calques: undefined,
    etapes: [{ id: 'e1', titre: 'Étape 1', note: typeof v.notes === 'string' ? v.notes : '', objets: Array.isArray(v.objets) ? v.objets : [] }],
  };
}

const deg = r => Math.round(((r * 180) / Math.PI) * 10) / 10;
const enMetres = n => Math.round((n / ECHELLE_DEFAUT) * 10) / 10;

/** Zone v2 (unités du repère) → zone v3 (mètres, à l'échelle par défaut : le dessin ne bouge pas sans calibrage). */
function zoneV2(z) {
  if (!objet(z)) return null;
  if (z.forme === 'cercle') return { forme: 'cercle', rayon: Math.max(0.2, enMetres(Number(z.rayon) || 0)) };
  if (z.forme === 'mur') {
    const dx = Number(z.dx) || 0;
    const dy = Number(z.dy) || 0;
    return { forme: 'mur', angle: deg(Math.atan2(dy, dx)), longueur: Math.min(200, Math.max(0.5, enMetres(Math.hypot(dx, dy)))), largeur: Math.max(0.1, enMetres(Number(z.epaisseur) || 8)), courbure: 0 };
  }
  if (z.forme === 'cone') return { forme: 'cone', angle: Number(z.angle) || 0, ouverture: Number(z.ouverture) || 60, portee: Math.max(0.5, enMetres(Number(z.rayon) || 0)) };
  return z;
}

/**
 * Version 2 → 3 : modèle de strat (celui du jeu de la team, sinon déduit de `jeu`), zones en mètres,
 * phases et durées des étapes. Une strat The Finals garde ses trois premiers joueurs.
 */
function migrerV2(v, { modele } = {}) {
  const m = MODELES_STRAT.includes(modele) ? modele : modeleDuJeu(null, v.jeu);
  const joueursMax = MODELES[m].joueursMax;
  const joueurs = Array.isArray(v.joueurs) ? v.joueurs.slice(0, joueursMax) : undefined;
  const nb = joueurs?.length ?? 0;
  return {
    ...v,
    version: 3,
    modele: m,
    economie: null,
    joueurs,
    calques: objet(v.calques) ? v.calques : {},
    etapes: Array.isArray(v.etapes)
      ? v.etapes.map(e =>
          objet(e)
            ? {
                ...e,
                phase: null,
                duree: DUREE_ETAPE_DEFAUT,
                objets: Array.isArray(e.objets)
                  ? e.objets.map(o => {
                      if (!objet(o)) return o;
                      const sortie = { ...o };
                      if (Number.isInteger(o.joueur) && o.joueur >= nb) sortie.joueur = null;
                      if (o.type === 'capacite') sortie.zone = zoneV2(o.zone);
                      return sortie;
                    })
                  : e.objets,
              }
            : e,
        )
      : v.etapes,
  };
}

/** Migre un document d'une version antérieure vers la version courante (sans valider). `modele` : celui de la strat. */
export function migrerDocument(v, options = {}) {
  if (!objet(v)) throw invalide('document illisible');
  const version = v.version ?? 1;
  if (!Number.isInteger(version) || version < 1) throw invalide('version');
  if (version > VERSION_DOCUMENT) throw echec(400, 'strat-version', 'Cette strat vient d’une version plus récente de l’app : mettez l’app à jour.');
  let d = v;
  if (version === 1) d = migrerV1(d);
  if ((d.version ?? 1) <= 2) d = migrerV2(d, options);
  return d;
}

export function tailleOctets(texte) {
  return new TextEncoder().encode(texte).length;
}

const jeuValide = v => (typeof v === 'string' && /^[a-z0-9][a-z0-9-]{1,39}$/.test(v) ? v : 'autre');

/**
 * Valide un document (toute version connue) et rend sa forme canonique, à la
 * version courante. Lève 400 (`strat-invalide`) ou 413 (`strat-trop-grosse`).
 * `options.modele` : modèle de la strat (migration d'une ancienne version).
 */
export function validerDocument(brut, options = {}) {
  if (tailleOctets(JSON.stringify(brut ?? null)) > TAILLE_MAX_DOCUMENT) throw echec(413, 'strat-trop-grosse', 'Strat trop volumineuse (384 Ko au plus) : retirez des étapes ou des dessins.');
  const v = migrerDocument(brut, options);
  if (v.format !== undefined && v.format !== FORMAT_STRAT) throw invalide('format');
  const modele = MODELES_STRAT.includes(v.modele) ? v.modele : modeleDuJeu(null, v.jeu);
  const def = MODELES[modele];
  const jeu = jeuValide(v.jeu);
  if (!objet(v.carte)) throw invalide('carte');
  const carte = {
    cle: cle(v.carte.cle, 'carte'),
    nom: texteNettoye(v.carte.nom, 40) || v.carte.cle,
    image: image(v.carte.image),
    echelle: facultatif(v.carte.echelle, 'échelle', ECHELLE_MIN, ECHELLE_MAX),
  };
  if (!SIDES.includes(v.side)) throw invalide('side (attaque ou défense)');
  let economie = null;
  if (v.economie !== undefined && v.economie !== null && v.economie !== '') {
    if (!def.economie.includes(v.economie)) throw invalide('économie du round');
    economie = v.economie;
  }
  // Mode de jeu de la strat (The Finals : cashout par défaut, ou final-round).
  let mode = null;
  if (def.modes.length) {
    if (v.mode === undefined || v.mode === null || v.mode === '') mode = def.modes[0];
    else if (def.modes.includes(v.mode)) mode = v.mode;
    else throw invalide('mode de jeu');
  }
  const joueursBruts = Array.isArray(v.joueurs) ? v.joueurs : [];
  if (joueursBruts.length > Math.min(JOUEURS_MAX, def.joueursMax)) throw invalide('trop de joueurs');
  const joueurs = joueursBruts.map((j, i) => ({
    nom: texteNettoye(objet(j) ? j.nom : '', 24) || `Joueur ${i + 1}`,
    couleur: couleur(objet(j) ? j.couleur : undefined, COULEURS_JOUEURS[i % COULEURS_JOUEURS.length]),
    agent: objet(j) && j.agent ? cle(j.agent, 'agent du joueur') : null,
    role: (objet(j) ? texteNettoye(j.role, 24) : '') || null,
    compte: objet(j) && typeof j.compte === 'string' && MOTIF_COMPTE.test(j.compte) ? j.compte : null,
  }));
  const calques = {};
  for (const c of CALQUES) {
    const brutCalque = objet(v.calques) && objet(v.calques[c]) ? v.calques[c] : {};
    calques[c] = { visible: brutCalque.visible !== false, verrou: brutCalque.verrou === true };
  }
  if (!Array.isArray(v.etapes) || v.etapes.length === 0) throw invalide('au moins une étape');
  if (v.etapes.length > ETAPES_MAX) throw invalide(`${ETAPES_MAX} étapes au plus`);
  const idsEtapes = new Set();
  const etapes = v.etapes.map((e, i) => {
    if (!objet(e) || typeof e.id !== 'string' || !MOTIF_ID.test(e.id) || idsEtapes.has(e.id)) throw invalide('identifiant d’étape');
    idsEtapes.add(e.id);
    const objets = Array.isArray(e.objets) ? e.objets : [];
    if (objets.length > OBJETS_MAX) throw invalide(`${OBJETS_MAX} objets au plus par étape`);
    let phase = null;
    if (e.phase !== undefined && e.phase !== null && e.phase !== '') {
      if (!def.phases.includes(e.phase)) throw invalide('phase');
      phase = e.phase;
    }
    const ids = new Set();
    return {
      id: e.id,
      titre: texteNettoye(e.titre, 60) || `Étape ${i + 1}`,
      note: texteLong(e.note, 2000),
      phase,
      duree: nombre(e.duree ?? DUREE_ETAPE_DEFAUT, 'durée', 1, 120),
      objets: objets.map(o => {
        const propre = objetValide(o, joueurs.length);
        if (ids.has(propre.id)) throw invalide('identifiants d’objets en double');
        ids.add(propre.id);
        return propre;
      }),
    };
  });
  return { format: FORMAT_STRAT, version: VERSION_DOCUMENT, jeu, modele, ...(mode ? { mode } : {}), carte, side: v.side, economie, joueurs, calques, etapes };
}

/** Document vide d'une nouvelle strat (`joueurs` : nombre de joueurs, celui du modèle par défaut). */
export function documentVide({ carte, side = 'attaque', jeu = 'valorant', modele, joueurs }) {
  const m = MODELES_STRAT.includes(modele) ? modele : modeleDuJeu(null, jeu);
  const n = Math.max(1, Math.min(MODELES[m].joueursMax, Number.isInteger(joueurs) ? joueurs : MODELES[m].joueurs));
  return validerDocument({
    format: FORMAT_STRAT,
    version: VERSION_DOCUMENT,
    jeu,
    modele: m,
    carte,
    side,
    economie: null,
    joueurs: COULEURS_JOUEURS.slice(0, n).map((c, i) => ({ nom: `Joueur ${i + 1}`, couleur: c, agent: null })),
    etapes: [{ id: 'e1', titre: 'Étape 1', note: '', phase: null, duree: DUREE_ETAPE_DEFAUT, objets: [] }],
  });
}

/** Résumé d'un document pour les listes (sans les objets). */
export function resumeDocument(doc) {
  return {
    etapes: doc.etapes.length,
    objets: doc.etapes.reduce((n, e) => n + e.objets.length, 0),
    agents: [...new Set(doc.etapes.flatMap(e => e.objets.filter(o => o.type === 'agent').map(o => o.agent)))].slice(0, 10),
  };
}
