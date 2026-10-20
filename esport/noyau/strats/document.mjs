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
 * (`objets` à plat) ; version 2 : étapes successives, calques, joueurs.
 */

import { echec, texteLong, texteNettoye } from '../outils.mjs';

export const FORMAT_STRAT = 'esport-strat';
export const VERSION_DOCUMENT = 2;
/** Taille max du document sérialisé (octets UTF-8). */
export const TAILLE_MAX_DOCUMENT = 256 * 1024;
export const ETAPES_MAX = 20;
export const OBJETS_MAX = 250;
export const POINTS_MAX = 64;
export const JOUEURS_MAX = 10;
export const SIDES = ['attaque', 'defense'];
export const TYPES_STRAT = ['default', 'execute', 'eco', 'pistol', 'retake', 'other'];
export const CALQUES = ['fond', 'utilitaires', 'dessins', 'texte'];
export const TYPES_OBJETS = ['agent', 'capacite', 'fleche', 'ligne', 'forme', 'texte'];
export const FORMES_ZONE = ['cercle', 'mur', 'cone'];
export const JEUX_STRAT = ['valorant', 'autre'];
/** Couleurs par défaut des cinq joueurs (lisibles sur la minimap, en clair comme en sombre). */
export const COULEURS_JOUEURS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7'];

const MOTIF_ID = /^[A-Za-z0-9_-]{1,24}$/;
const MOTIF_CLE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MOTIF_SLOT = /^[A-Za-z0-9_-]{1,20}$/;
const MOTIF_COULEUR = /^#[0-9a-fA-F]{6}$/;
/**
 * Images autorisées dans un document : le CDN public de valorant-api.com
 * (cartes, agents, capacités), ou un fichier du dossier d'assets remplaçable
 * livré avec le site (`esport-assets/…`). Rien d'autre (ni http, ni data:).
 */
const MOTIF_IMAGE = /^(https:\/\/media\.valorant-api\.com\/[A-Za-z0-9/_.-]{1,200}|esport-assets\/[a-z0-9/_.-]{1,160})$/;
const MIN = -500;
const MAX = 1500;

const invalide = message => echec(400, 'strat-invalide', `Strat invalide : ${message}`);

/** Calque d'un objet (déduit de son type : jamais stocké). */
export function calqueDe(objet) {
  if (objet.type === 'agent' || objet.type === 'capacite') return 'utilitaires';
  if (objet.type === 'texte') return 'texte';
  return 'dessins';
}

const objet = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function nombre(v, quoi, min = MIN, max = MAX) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw invalide(`${quoi} hors limites`);
  return Math.round(v * 10) / 10;
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

function zone(v) {
  if (v === undefined || v === null) return null;
  if (!objet(v) || !FORMES_ZONE.includes(v.forme)) throw invalide('zone de capacité');
  if (v.forme === 'cercle') return { forme: 'cercle', rayon: nombre(v.rayon, 'rayon', 2, 400) };
  if (v.forme === 'mur') return { forme: 'mur', dx: nombre(v.dx, 'mur', -1000, 1000), dy: nombre(v.dy, 'mur', -1000, 1000), epaisseur: nombre(v.epaisseur ?? 8, 'épaisseur', 1, 40) };
  return { forme: 'cone', rayon: nombre(v.rayon, 'rayon', 5, 600), angle: nombre(v.angle ?? 0, 'angle', -360, 360), ouverture: nombre(v.ouverture ?? 60, 'ouverture', 5, 180) };
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
      };
    case 'fleche':
    case 'ligne':
      return { ...commun, points: points(v.points), couleur: couleur(v.couleur), epaisseur: nombre(v.epaisseur ?? 4, 'épaisseur', 1, 20), tirets: v.tirets === true };
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
      };
    default: {
      const texte = texteLong(v.texte, 200);
      if (!texte) throw invalide('texte vide');
      return { ...commun, x: nombre(v.x, 'x'), y: nombre(v.y, 'y'), texte, couleur: couleur(v.couleur), taille: nombre(v.taille ?? 24, 'taille', 8, 96) };
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
    joueurs: COULEURS_JOUEURS.map((c, i) => ({ nom: `Joueur ${i + 1}`, couleur: c, agent: null })),
    calques: undefined,
    etapes: [{ id: 'e1', titre: 'Étape 1', note: typeof v.notes === 'string' ? v.notes : '', objets: Array.isArray(v.objets) ? v.objets : [] }],
  };
}

/** Migre un document d'une version antérieure vers la version courante (sans valider). */
export function migrerDocument(v) {
  if (!objet(v)) throw invalide('document illisible');
  const version = v.version ?? 1;
  if (!Number.isInteger(version) || version < 1) throw invalide('version');
  if (version > VERSION_DOCUMENT) throw echec(400, 'strat-version', 'Cette strat vient d’une version plus récente de l’app : mettez l’app à jour.');
  let d = v;
  if (version === 1) d = migrerV1(d);
  return d;
}

export function tailleOctets(texte) {
  return new TextEncoder().encode(texte).length;
}

/**
 * Valide un document (toute version connue) et rend sa forme canonique, à la
 * version courante. Lève 400 (`strat-invalide`) ou 413 (`strat-trop-grosse`).
 */
export function validerDocument(brut) {
  if (tailleOctets(JSON.stringify(brut ?? null)) > TAILLE_MAX_DOCUMENT) throw echec(413, 'strat-trop-grosse', 'Strat trop volumineuse (256 Ko au plus) : retirez des étapes ou des dessins.');
  const v = migrerDocument(brut);
  if (v.format !== undefined && v.format !== FORMAT_STRAT) throw invalide('format');
  const jeu = JEUX_STRAT.includes(v.jeu) ? v.jeu : 'valorant';
  if (!objet(v.carte)) throw invalide('carte');
  const carte = { cle: cle(v.carte.cle, 'carte'), nom: texteNettoye(v.carte.nom, 40) || v.carte.cle, image: image(v.carte.image) };
  if (!SIDES.includes(v.side)) throw invalide('side (attaque ou défense)');
  const joueursBruts = Array.isArray(v.joueurs) ? v.joueurs : [];
  if (joueursBruts.length > JOUEURS_MAX) throw invalide('trop de joueurs');
  const joueurs = joueursBruts.map((j, i) => ({
    nom: texteNettoye(objet(j) ? j.nom : '', 24) || `Joueur ${i + 1}`,
    couleur: couleur(objet(j) ? j.couleur : undefined, COULEURS_JOUEURS[i % COULEURS_JOUEURS.length]),
    agent: objet(j) && j.agent ? cle(j.agent, 'agent du joueur') : null,
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
    const ids = new Set();
    return {
      id: e.id,
      titre: texteNettoye(e.titre, 60) || `Étape ${i + 1}`,
      note: texteLong(e.note, 2000),
      objets: objets.map(o => {
        const propre = objetValide(o, joueurs.length);
        if (ids.has(propre.id)) throw invalide('identifiants d’objets en double');
        ids.add(propre.id);
        return propre;
      }),
    };
  });
  return { format: FORMAT_STRAT, version: VERSION_DOCUMENT, jeu, carte, side: v.side, joueurs, calques, etapes };
}

/** Document vide d'une nouvelle strat. */
export function documentVide({ carte, side = 'attaque', jeu = 'valorant' }) {
  return validerDocument({
    format: FORMAT_STRAT,
    version: VERSION_DOCUMENT,
    jeu,
    carte,
    side,
    joueurs: COULEURS_JOUEURS.map((c, i) => ({ nom: `Joueur ${i + 1}`, couleur: c, agent: null })),
    etapes: [{ id: 'e1', titre: 'Étape 1', note: '', objets: [] }],
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
