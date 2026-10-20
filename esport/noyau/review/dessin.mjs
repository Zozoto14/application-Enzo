/**
 * Dessin posé sur la vidéo d'une review (calque transparent par-dessus le
 * lecteur YouTube), rattaché à un repère. Fonction PURE : validation et
 * normalisation côté serveur (miroir : src/esport/review/dessin.ts).
 *
 * Format (JSON, coordonnées RELATIVES de 0 à 1 : le dessin s'adapte à la
 * taille du lecteur) :
 *   { v: 1, objets: [
 *       { t: 'fleche' | 'cercle' | 'rect', c: '#rrggbb', e: 1..20, p: [x1, y1, x2, y2] },
 *       { t: 'trait', c, e, p: [x1, y1, x2, y2, …] }          (2 à 200 points)
 *       { t: 'texte', c, e, p: [x, y], x: 'texte' }          (120 caractères au plus)
 *   ] }
 * `e` : épaisseur du trait (ou taille du texte), en pixels pour un lecteur de
 * 640 px de large. Au plus 100 objets et 32 Ko une fois sérialisé.
 */

import { echec } from '../outils.mjs';

export const TYPES_DESSIN = ['fleche', 'cercle', 'rect', 'trait', 'texte'];
export const OBJETS_DESSIN_MAX = 100;
export const POINTS_TRAIT_MAX = 200;
export const TEXTE_DESSIN_MAX = 120;
export const TAILLE_DESSIN_MAX = 32 * 1024;

const COULEUR = /^#[0-9a-f]{6}$/i;
// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u001f\u007f‪-‮⁦-⁩​-‏﻿<>]/g;

const refus = message => echec(400, 'dessin', message);

function coordonnees(p, min, max) {
  if (!Array.isArray(p) || p.length < min * 2 || p.length > max * 2 || p.length % 2 !== 0) throw refus('Dessin : points invalides.');
  return p.map(v => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) throw refus('Dessin : coordonnées hors du cadre (0 à 1).');
    return Math.round(v * 10000) / 10000;
  });
}

/**
 * Dessin propre (objet normalisé) ou `null` (aucun dessin). Lève une erreur
 * 400 (`dessin`) si la forme est invalide ou trop grande.
 */
export function validerDessin(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  let d = valeur;
  if (typeof d === 'string') {
    if (d.length > TAILLE_DESSIN_MAX) throw refus('Dessin trop volumineux.');
    try {
      d = JSON.parse(d);
    } catch {
      throw refus('Dessin illisible (JSON attendu).');
    }
  }
  if (typeof d !== 'object' || Array.isArray(d) || d === null) throw refus('Dessin illisible.');
  if (d.v !== 1) throw refus('Dessin : version inconnue.');
  if (!Array.isArray(d.objets)) throw refus('Dessin : liste d’objets attendue.');
  if (d.objets.length > OBJETS_DESSIN_MAX) throw refus(`Dessin : ${OBJETS_DESSIN_MAX} formes au plus.`);
  const objets = d.objets.map(o => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw refus('Dessin : forme illisible.');
    if (!TYPES_DESSIN.includes(o.t)) throw refus('Dessin : forme inconnue.');
    if (typeof o.c !== 'string' || !COULEUR.test(o.c)) throw refus('Dessin : couleur invalide.');
    if (!Number.isInteger(o.e) || o.e < 1 || o.e > 20) throw refus('Dessin : épaisseur invalide (1 à 20).');
    const propre = { t: o.t, c: o.c.toLowerCase(), e: o.e };
    if (o.t === 'trait') propre.p = coordonnees(o.p, 2, POINTS_TRAIT_MAX);
    else if (o.t === 'texte') {
      propre.p = coordonnees(o.p, 1, 1);
      const x = String(o.x ?? '').normalize('NFC').replace(CONTROLES, '').replace(/\s+/g, ' ').trim();
      if (!x) throw refus('Dessin : texte vide.');
      if (x.length > TEXTE_DESSIN_MAX) throw refus(`Dessin : texte de ${TEXTE_DESSIN_MAX} caractères au plus.`);
      propre.x = x;
    } else propre.p = coordonnees(o.p, 2, 2);
    return propre;
  });
  const propre = { v: 1, objets };
  if (JSON.stringify(propre).length > TAILLE_DESSIN_MAX) throw refus('Dessin trop volumineux.');
  return objets.length ? propre : null;
}

/** Lecture d'un dessin stocké (JSON) : objet, ou null s'il est absent ou abîmé. */
export function lireDessin(texte) {
  if (!texte) return null;
  try {
    return validerDessin(texte);
  } catch {
    return null;
  }
}

/** Résumé lisible : « 3 formes (flèche, cercle, texte) ». */
export function resumeDessin(d) {
  if (!d?.objets?.length) return '';
  const noms = { fleche: 'flèche', cercle: 'cercle', rect: 'rectangle', trait: 'trait', texte: 'texte' };
  const types = [...new Set(d.objets.map(o => noms[o.t] ?? o.t))];
  return `${d.objets.length} forme${d.objets.length > 1 ? 's' : ''} (${types.join(', ')})`;
}
