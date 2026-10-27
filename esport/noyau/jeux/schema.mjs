/**
 * Profils de jeu : modèle de données et validation (fonctions PURES, sans base ni réseau).
 *
 * Un profil = un en-tête (clé, nom, couleur, icône) + des données JSON VALIDÉES PAR SCHÉMA :
 *
 *   formats      [{ cle, nom, equipes, joueursParEquipe, bo: [1, 3, 5], notes }]   (3v3v3v3 = 4 équipes de 3)
 *   score        { type: rounds|points|placement|manches, roundsGagnants, roundsParMiTemps,
 *                  prolongations: { active, regle }, pointsCible, bareme: [{ place, points }],
 *                  manchesGagnantes, notes }
 *   modes        [{ cle, nom, description, formats: [cle de format], actif }]
 *   cartes       [{ cle, nom, image, actif (dans le pool), modes: [cle de mode] }]
 *   classes      [{ cle, nom }]                       rôles des personnages (Duelliste, Light…)
 *   personnages  [{ cle, nom, classe, image, actif }] agents, champions, classes jouables
 *   roster       { titulaires, remplacants }
 *   rolesJoueurs [{ cle, nom }]                       postes des joueurs (IGL, Entry…)
 *   champs       [{ cle, nom, type: texte|nombre|booleen|liste, valeur }]   champs libres
 *   libelles     { personnages, classes, cartes }     mots du jeu (« Agents », « Champions »…)
 *   sources      [{ url, titre }]                     pages de référence (mises à jour par l'IA)
 *
 * Deux modes :
 *  - strict (saisie du Fondateur) : la première erreur lève 400 `profil-invalide` (détails : chemin, raison) ;
 *  - tolérant (réponse d'une IA, donnée NON FIABLE) : un élément invalide est retiré et signalé dans
 *    `avertissements`. Rien n'échappe au schéma : champs inconnus jetés, textes nettoyés et bornés,
 *    images en https vers un hôte public seulement.
 * Dans les deux modes, une référence vers un élément absent (mode d'une carte, classe d'un personnage)
 * est retirée sans erreur.
 */

import { echec, texteLong, texteNettoye } from '../outils.mjs';
import { adresseAutorisee } from '../ressources/apercu.mjs';

export const TYPES_SCORE = ['rounds', 'points', 'placement', 'manches'];
export const BO_PERMIS = [1, 2, 3, 5, 7];
export const TYPES_CHAMPS = ['texte', 'nombre', 'booleen', 'liste'];
/** Sections en liste (éléments identifiés par `cle`), dans l'ordre d'affichage. */
export const SECTIONS_LISTES = ['formats', 'modes', 'cartes', 'classes', 'personnages', 'rolesJoueurs', 'champs'];
/** Sections objet (un seul bloc). */
export const SECTIONS_OBJETS = ['score', 'roster'];
export const MAX_ELEMENTS = { formats: 20, modes: 40, cartes: 80, classes: 20, personnages: 200, rolesJoueurs: 30, champs: 40, sources: 20 };
/** Taille max d'un profil sérialisé (octets UTF-8). */
export const TAILLE_MAX_PROFIL = 256 * 1024;

export const MOTIF_CLE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MOTIF_CLE_JEU = /^[a-z0-9][a-z0-9-]{1,39}$/;
/** Clés réservées par les routes (/jeux/ia, /jeux/propositions). */
export const CLES_RESERVEES = ['ia', 'propositions'];
const MOTIF_COULEUR = /^#[0-9a-fA-F]{6}$/;

/** Clé stable d'un nom (« KAY/O » → « kay-o », « Skyway Stadium » → « skyway-stadium »). */
export function cleDe(nom) {
  return (
    String(nom ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || ''
  );
}

/** Erreur de validation : chemin (« cartes.3.nom ») et raison (code stable, traduit par l'app). */
class Invalide extends Error {
  constructor(chemin, raison) {
    super(`${chemin} : ${raison}`);
    this.chemin = chemin;
    this.raison = raison;
  }
}

function erreurProfil(e) {
  const err = echec(400, 'profil-invalide', 'Profil de jeu invalide.');
  err.details = { chemin: e.chemin, raison: e.raison };
  return err;
}

const estObjet = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function texte(v, chemin, { min = 1, max = 60 } = {}) {
  const t = texteNettoye(v, max);
  if (t.length < min) throw new Invalide(chemin, min > 1 ? 'texte-court' : 'texte-requis');
  return t;
}

function entier(v, chemin, min, max, { facultatif = false } = {}) {
  if (facultatif && (v === undefined || v === null || v === '')) return null;
  const n = typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw new Invalide(chemin, 'nombre-hors-limites');
  return n;
}

const booleen = (v, repli = true) => (typeof v === 'boolean' ? v : v === 1 || v === '1' ? true : v === 0 || v === '0' ? false : repli);

/** Image : adresse https vers un hôte public (jamais http, data:, IP privée…), ou null. */
export function imageSure(v, chemin) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > 500 || !/^https:\/\//i.test(v.trim()) || !adresseAutorisee(v.trim()) || /["'<>\s\\]/.test(v.trim())) throw new Invalide(chemin, 'image');
  return v.trim();
}

/** Clé d'un élément : celle donnée si elle est valide, sinon dérivée du nom. */
function cleElement(v, nom, chemin) {
  const cle = typeof v === 'string' && MOTIF_CLE.test(v) ? v : cleDe(typeof v === 'string' && v ? v : nom);
  if (!MOTIF_CLE.test(cle)) throw new Invalide(chemin, 'cle');
  return cle;
}

// ------------------------------------------------------------------ Éléments

const ELEMENTS = {
  formats(v, c) {
    const nom = texte(v.nom, `${c}.nom`, { max: 40 });
    const bo = [...new Set((Array.isArray(v.bo) ? v.bo : [1]).map(Number))].filter(b => BO_PERMIS.includes(b)).sort((a, b) => a - b);
    if (bo.length === 0) throw new Invalide(`${c}.bo`, 'bo');
    return {
      cle: cleElement(v.cle, nom, `${c}.cle`),
      nom,
      equipes: entier(v.equipes, `${c}.equipes`, 1, 64),
      joueursParEquipe: entier(v.joueursParEquipe, `${c}.joueursParEquipe`, 1, 12),
      bo,
      notes: texteNettoye(v.notes, 200),
    };
  },
  modes(v, c) {
    const nom = texte(v.nom, `${c}.nom`, { max: 60 });
    return {
      cle: cleElement(v.cle, nom, `${c}.cle`),
      nom,
      description: texteLong(v.description, 300),
      formats: listeCles(v.formats),
      actif: booleen(v.actif),
    };
  },
  cartes(v, c, ctx) {
    const nom = texte(v.nom, `${c}.nom`, { max: 40 });
    return { cle: cleElement(v.cle, nom, `${c}.cle`), nom, image: imageCtx(v.image, `${c}.image`, ctx), actif: booleen(v.actif), modes: listeCles(v.modes) };
  },
  classes(v, c) {
    const nom = texte(v.nom, `${c}.nom`, { max: 40 });
    return { cle: cleElement(v.cle, nom, `${c}.cle`), nom };
  },
  personnages(v, c, ctx) {
    const nom = texte(v.nom, `${c}.nom`, { max: 40 });
    const classe = typeof v.classe === 'string' && v.classe ? (MOTIF_CLE.test(v.classe) ? v.classe : cleDe(v.classe)) : null;
    return { cle: cleElement(v.cle, nom, `${c}.cle`), nom, classe: classe || null, image: imageCtx(v.image, `${c}.image`, ctx), actif: booleen(v.actif) };
  },
  rolesJoueurs(v, c) {
    const nom = texte(v.nom, `${c}.nom`, { max: 40 });
    return { cle: cleElement(v.cle, nom, `${c}.cle`), nom };
  },
  champs(v, c) {
    const nom = texte(v.nom, `${c}.nom`, { max: 60 });
    const type = TYPES_CHAMPS.includes(v.type) ? v.type : 'texte';
    let valeur;
    if (type === 'nombre') {
      const n = typeof v.valeur === 'string' && v.valeur.trim() !== '' ? Number(v.valeur) : v.valeur;
      if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e9) throw new Invalide(`${c}.valeur`, 'nombre-hors-limites');
      valeur = n;
    } else if (type === 'booleen') valeur = booleen(v.valeur, false);
    else if (type === 'liste') {
      if (!Array.isArray(v.valeur) || v.valeur.length > 30) throw new Invalide(`${c}.valeur`, 'liste');
      valeur = v.valeur.map(x => texteNettoye(x, 60)).filter(Boolean);
    } else valeur = texteLong(v.valeur, 500);
    return { cle: cleElement(v.cle, nom, `${c}.cle`), nom, type, valeur };
  },
};

/** Image d'un élément : en mode tolérant, une image refusée est retirée (avertissement), l'élément reste. */
function imageCtx(v, chemin, ctx) {
  try {
    return imageSure(v, chemin);
  } catch (e) {
    if (!ctx?.avertir || !(e instanceof Invalide)) throw e;
    ctx.avertir(e);
    return null;
  }
}

function listeCles(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.slice(0, 50).filter(x => typeof x === 'string').map(x => (MOTIF_CLE.test(x) ? x : cleDe(x))).filter(x => MOTIF_CLE.test(x)))];
}

// ------------------------------------------------------------------ Objets

function lireScore(v, c = 'score') {
  if (!estObjet(v)) throw new Invalide(c, 'objet');
  const type = TYPES_SCORE.includes(v.type) ? v.type : null;
  if (!type) throw new Invalide(`${c}.type`, 'type-score');
  const sortie = { type };
  const facultatif = (cle, min, max) => {
    const n = entier(v[cle], `${c}.${cle}`, min, max, { facultatif: true });
    if (n !== null) sortie[cle] = n;
  };
  facultatif('roundsGagnants', 1, 100);
  facultatif('roundsParMiTemps', 1, 100);
  facultatif('pointsCible', 1, 1_000_000);
  facultatif('manchesGagnantes', 1, 20);
  if (estObjet(v.prolongations)) sortie.prolongations = { active: booleen(v.prolongations.active, false), regle: texteNettoye(v.prolongations.regle, 200) };
  if (Array.isArray(v.bareme)) {
    if (v.bareme.length > 64) throw new Invalide(`${c}.bareme`, 'trop-elements');
    const places = new Set();
    sortie.bareme = v.bareme
      .map((b, i) => ({ place: entier(b?.place, `${c}.bareme.${i}.place`, 1, 100), points: entier(b?.points, `${c}.bareme.${i}.points`, -1000, 100_000) }))
      .filter(b => (places.has(b.place) ? false : (places.add(b.place), true)))
      .sort((a, b) => a.place - b.place);
  }
  sortie.notes = texteLong(v.notes, 500);
  if (type === 'rounds' && !sortie.roundsGagnants) throw new Invalide(`${c}.roundsGagnants`, 'requis');
  return sortie;
}

function lireRoster(v, c = 'roster') {
  if (!estObjet(v)) throw new Invalide(c, 'objet');
  return { titulaires: entier(v.titulaires, `${c}.titulaires`, 1, 50), remplacants: entier(v.remplacants ?? 0, `${c}.remplacants`, 0, 50) };
}

function lireLibelles(v) {
  const sortie = {};
  if (!estObjet(v)) return sortie;
  for (const cle of ['personnages', 'classes', 'cartes']) {
    const t = texteNettoye(v[cle], 30);
    if (t) sortie[cle] = t;
  }
  return sortie;
}

/** Sources : adresses https publiques seulement (jamais d'IP privée, de port exotique ni d'identifiants). */
export function lireSources(v, { max = MAX_ELEMENTS.sources } = {}) {
  if (!Array.isArray(v)) return [];
  const vues = new Set();
  const sortie = [];
  for (const s of v.slice(0, 100)) {
    const url = typeof s === 'string' ? s : s?.url;
    if (typeof url !== 'string' || url.length > 500 || !/^https:\/\//i.test(url.trim()) || !adresseAutorisee(url.trim()) || /["'<>\s\\]/.test(url.trim())) continue;
    const propre = url.trim();
    if (vues.has(propre)) continue;
    vues.add(propre);
    sortie.push({ url: propre, titre: texteNettoye(typeof s === 'object' ? s?.titre : '', 120) });
    if (sortie.length >= max) break;
  }
  return sortie;
}

// ------------------------------------------------------------------ Profil

/** Élément d'une section liste (pour les différences proposées par l'IA). Lève `Invalide`. */
export function lireElement(section, v, chemin = section, ctx) {
  if (!ELEMENTS[section]) throw new Invalide(chemin, 'section');
  if (!estObjet(v)) throw new Invalide(chemin, 'objet');
  return ELEMENTS[section](v, chemin, ctx);
}

/** Bloc d'une section objet. Lève `Invalide`. */
export function lireObjet(nomSection, v) {
  if (nomSection === 'score') return lireScore(v);
  if (nomSection === 'roster') return lireRoster(v);
  throw new Invalide(nomSection, 'section');
}

function retirerReferences(p) {
  const formats = new Set(p.formats.map(f => f.cle));
  const modes = new Set(p.modes.map(m => m.cle));
  const classes = new Set(p.classes.map(x => x.cle));
  for (const m of p.modes) m.formats = m.formats.filter(f => formats.has(f));
  for (const c of p.cartes) c.modes = c.modes.filter(m => modes.has(m));
  for (const x of p.personnages) if (x.classe && !classes.has(x.classe)) x.classe = null;
  return p;
}

/**
 * Données d'un profil → données propres. `tolerant` : les éléments invalides sont retirés (avertissements)
 * au lieu de lever. Rend `{ donnees, avertissements }`.
 */
export function validerDonnees(brut, { tolerant = false } = {}) {
  const avertissements = [];
  const garder = (e, repli) => {
    if (!(e instanceof Invalide)) throw e;
    if (!tolerant) throw erreurProfil(e);
    avertissements.push({ chemin: e.chemin, raison: e.raison });
    return repli;
  };
  const ctx = tolerant ? { avertir: e => avertissements.push({ chemin: e.chemin, raison: e.raison }) } : undefined;
  if (!estObjet(brut)) {
    if (!tolerant) throw erreurProfil(new Invalide('donnees', 'objet'));
    brut = {};
  }
  const p = {};
  for (const section of SECTIONS_LISTES) {
    const liste = brut[section] === undefined || brut[section] === null ? [] : brut[section];
    if (!Array.isArray(liste)) {
      garder(new Invalide(section, 'liste'));
      p[section] = [];
      continue;
    }
    if (liste.length > MAX_ELEMENTS[section]) garder(new Invalide(section, 'trop-elements'));
    const vues = new Set();
    p[section] = [];
    liste.slice(0, MAX_ELEMENTS[section]).forEach((v, i) => {
      try {
        const e = lireElement(section, v, `${section}.${i}`, ctx);
        if (vues.has(e.cle)) throw new Invalide(`${section}.${i}.cle`, 'doublon');
        vues.add(e.cle);
        p[section].push(e);
      } catch (e) {
        garder(e);
      }
    });
  }
  try {
    p.score = brut.score === undefined || brut.score === null ? null : lireScore(brut.score);
  } catch (e) {
    p.score = garder(e, null);
  }
  try {
    p.roster = brut.roster === undefined || brut.roster === null ? null : lireRoster(brut.roster);
  } catch (e) {
    p.roster = garder(e, null);
  }
  p.libelles = lireLibelles(brut.libelles);
  p.sources = lireSources(brut.sources);
  retirerReferences(p);
  const taille = new TextEncoder().encode(JSON.stringify(p)).length;
  if (taille > TAILLE_MAX_PROFIL) {
    const e = echec(413, 'profil-trop-gros', 'Profil de jeu trop volumineux.');
    throw e;
  }
  return { donnees: p, avertissements };
}

/** En-tête d'un profil (nom, couleur, icône ; clé à la création). Strict. */
export function validerEntete(brut, { partiel = false, avecCle = false } = {}) {
  const sortie = {};
  try {
    if (avecCle) {
      const cle = typeof brut?.cle === 'string' && brut.cle ? brut.cle : cleDe(brut?.nom);
      if (!MOTIF_CLE_JEU.test(cle) || CLES_RESERVEES.includes(cle)) throw new Invalide('cle', 'cle');
      sortie.cle = cle;
    }
    if (!partiel || brut?.nom !== undefined) sortie.nom = texte(brut?.nom, 'nom', { min: 2, max: 40 });
    if (!partiel || brut?.couleur !== undefined) {
      const couleur = brut?.couleur ?? '#8b8b9a';
      if (typeof couleur !== 'string' || !MOTIF_COULEUR.test(couleur)) throw new Invalide('couleur', 'couleur');
      sortie.couleur = couleur.toLowerCase();
    }
    if (!partiel || brut?.icone !== undefined) sortie.icone = imageSure(brut?.icone, 'icone');
  } catch (e) {
    if (e instanceof Invalide) throw erreurProfil(e);
    throw e;
  }
  return sortie;
}

export { Invalide };

/** Libellé d'un format : « 5v5 », « 3v3v3v3 », « Solo (60) ». */
export function libelleFormat(f) {
  if (!f) return '';
  if (f.equipes > 4) return `${f.equipes} × ${f.joueursParEquipe}`;
  return Array.from({ length: f.equipes }, () => f.joueursParEquipe).join('v');
}

/** Profil vide (création à la main). */
export const donneesVides = () => validerDonnees({}).donnees;
