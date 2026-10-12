/**
 * Claude Office, onglet « Bureau » (v4) : logique pure de la CAMÉRA de la
 * scène (zoom, panoramique, inertie, suivi d'un agent, cadrage d'une zone) et
 * du placement des cartes de survol. Sans React ni DOM, testée dans
 * scene.test.tsx.
 *
 * Repère : la scène SVG fait LARGEUR_SCENE × HAUTEUR_SCENE unités ; la caméra
 * est un centre (cx, cy) dans ce repère et une échelle `s` (pixels d'écran par
 * unité). Le cadre est la taille du plateau en pixels.
 */

import { HAUTEUR_SCENE, iso, LARGEUR_SCENE, RECTS_ZONES, type Point } from './logiqueScene';
import type { Zone } from './zones';

export interface Camera {
  /** Pixels d'écran par unité de scène. */
  s: number;
  cx: number;
  cy: number;
}

export interface Taille {
  l: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  l: number;
  h: number;
}

/** Zoom maximal par rapport à la vue d'ensemble (et au moins cette échelle absolue). */
export const ZOOM_MAX_RELATIF = 5;
export const ECHELLE_MAX_MIN = 2.6;
/** Marge (unités de scène) autorisée au-delà des bords quand on est zoomé. */
export const MARGE_BORD = 30;
/** Échelle sous laquelle les personnages deviennent difficiles à lire sur un téléphone. */
export const ECHELLE_LISIBLE_TELEPHONE = 0.78;
export const ECHELLE_LISIBLE = 0.6;

const SCENE: Taille = { l: LARGEUR_SCENE, h: HAUTEUR_SCENE };

export const contenir = (c: Taille, scene: Taille = SCENE): number => Math.min(c.l / scene.l, c.h / scene.h);
export const couvrir = (c: Taille, scene: Taille = SCENE): number => Math.max(c.l / scene.l, c.h / scene.h);

/** Bornes de l'échelle : de la vue d'ensemble (tout l'open space) à un zoom serré. */
export function bornesEchelle(c: Taille): { min: number; max: number } {
  const min = contenir(c);
  return { min, max: Math.max(min * ZOOM_MAX_RELATIF, ECHELLE_MAX_MIN) };
}

const borne = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** La caméra ramenée dans ses limites : échelle bornée, vue jamais perdue hors de l'open space. */
export function borner(cam: Camera, c: Taille): Camera {
  const { min, max } = bornesEchelle(c);
  const s = borne(Number.isFinite(cam.s) ? cam.s : min, min, max);
  const axe = (centre: number, vue: number, total: number) => {
    if (vue >= total) return total / 2; // tout est visible : centré
    const m = Math.min(MARGE_BORD, (total - vue) / 2);
    return borne(Number.isFinite(centre) ? centre : total / 2, vue / 2 - m, total - vue / 2 + m);
  };
  return { s, cx: axe(cam.cx, c.l / s, SCENE.l), cy: axe(cam.cy, c.h / s, SCENE.h) };
}

/** Le rectangle de scène visible (viewBox du SVG), exactement aux proportions du cadre. */
export function vueVisible(cam: Camera, c: Taille): Rect {
  const l = c.l / cam.s;
  const h = c.h / cam.s;
  return { x: cam.cx - l / 2, y: cam.cy - h / 2, l, h };
}

export const versEcran = (cam: Camera, c: Taille, p: Point): Point => ({ x: (p.x - cam.cx) * cam.s + c.l / 2, y: (p.y - cam.cy) * cam.s + c.h / 2 });
export const versScene = (cam: Camera, c: Taille, p: Point): Point => ({ x: (p.x - c.l / 2) / cam.s + cam.cx, y: (p.y - c.h / 2) / cam.s + cam.cy });

/** Zoom d'un facteur autour d'un point de l'écran (le point de la scène sous le doigt ou la souris reste en place). */
export function zoomerEn(cam: Camera, facteur: number, ecran: Point, c: Taille): Camera {
  const { min, max } = bornesEchelle(c);
  const s = borne(cam.s * facteur, min, max);
  const p = versScene(cam, c, ecran);
  return borner({ s, cx: p.x - (ecran.x - c.l / 2) / s, cy: p.y - (ecran.y - c.h / 2) / s }, c);
}

/** Panoramique : déplacer la vue de (dx, dy) pixels d'écran (glisser vers la droite montre la gauche). */
export const deplacer = (cam: Camera, dx: number, dy: number, c: Taille): Camera => borner({ s: cam.s, cx: cam.cx - dx / cam.s, cy: cam.cy - dy / cam.s }, c);

/** Facteur de zoom d'un cran de molette (pavé tactile compris), borné pour rester fluide. */
export function facteurMolette(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-borne(px, -240, 240) * 0.0018);
}

/** Taille du plateau : pleine largeur, hauteur disponible, sans boîte démesurée ni vide inutile. */
export function hauteurPlateau(largeur: number, dispo: number): number {
  const telephone = largeur < 600;
  const cible = Math.max(largeur / SCENE.l, telephone ? ECHELLE_LISIBLE_TELEPHONE : ECHELLE_LISIBLE);
  const portraitTablette = !telephone && dispo > largeur * 0.9;
  const ideal = SCENE.h * cible * (portraitTablette ? 1.3 : 1);
  return Math.round(Math.max(280, Math.min(dispo, ideal)));
}

/**
 * Vue de départ : tout l'open space quand il tient lisiblement (PC, iPad
 * paysage), sinon une vue rapprochée qui remplit le cadre (iPhone, iPad
 * portrait), centrée sur `centre` (là où sont les agents).
 */
export function vueInitiale(c: Taille, centre?: Point): Camera {
  const min = contenir(c);
  const max = couvrir(c);
  const lisible = c.l < 600 ? ECHELLE_LISIBLE_TELEPHONE : ECHELLE_LISIBLE;
  const videVertical = SCENE.h * min < c.h * 0.85;
  // Téléphone : jamais sous l'échelle lisible, quitte à faire glisser aussi de haut en bas.
  const s = Math.max(Math.min(max, Math.max(min, lisible, videVertical ? min * 1.3 : 0)), c.l < 600 ? lisible : 0);
  return borner({ s, cx: centre?.x ?? SCENE.l / 2, cy: centre?.y ?? SCENE.h / 2 }, c);
}

/** Cadrer un rectangle de la scène (zone double-tapée) avec une marge, sans dépasser les limites. */
export function cadrer(r: Rect, c: Taille, marge = 0.12): Camera {
  const s = Math.min(c.l / (r.l * (1 + marge * 2)), c.h / (r.h * (1 + marge * 2)));
  return borner({ s, cx: r.x + r.l / 2, cy: r.y + r.h / 2 }, c);
}

/** Emprise à l'écran (repère de la scène) d'une zone : son sol et la hauteur d'un personnage. */
export function rectZone(z: Zone): Rect {
  const r = RECTS_ZONES[z];
  const coins = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].flatMap(([x, y]) => [iso(x, y, 0), iso(x, y, 1.6)]);
  const xs = coins.map(p => p.x);
  const ys = coins.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), l: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** Interpolation (animation de caméra) : l'échelle en logarithme, pour un zoom régulier. */
export function interpoler(a: Camera, b: Camera, k: number): Camera {
  const t = borne(k, 0, 1);
  return { s: Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * t), cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t };
}

/** Courbe douce (début et fin lents) pour les animations de caméra. */
export const douceur = (k: number): number => {
  const t = borne(k, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};

/** Inertie légère après un glisser : vitesse (px/ms) amortie ; arrêt sous un seuil. */
export const FROTTEMENT = 0.0045;
export function inertie(v: Point, dt: number): { v: Point; d: Point; fini: boolean } {
  const k = Math.exp(-FROTTEMENT * dt);
  const nv = { x: v.x * k, y: v.y * k };
  // Distance parcourue pendant dt (intégrale de la vitesse amortie).
  const f = (1 - k) / FROTTEMENT;
  return { v: nv, d: { x: v.x * f, y: v.y * f }, fini: Math.hypot(nv.x, nv.y) < 0.02 };
}

/** Vitesse de lâcher bornée (px/ms), pour éviter les lancers démesurés. */
export function vitesseLacher(v: Point): Point {
  const n = Math.hypot(v.x, v.y);
  const max = 2.2;
  return n > max ? { x: (v.x / n) * max, y: (v.y / n) * max } : v;
}

/** Suivi caméra : le centre se rapproche doucement de la cible (indépendant de la cadence d'images). */
export function suivre(cam: Camera, cible: Point, dt: number, c: Taille, instantane = false): Camera {
  const k = instantane ? 1 : 1 - Math.exp(-dt / 280);
  return borner({ s: cam.s, cx: cam.cx + (cible.x - cam.cx) * k, cy: cam.cy + (cible.y - cam.cy) * k }, c);
}

/** Échelle confortable pour suivre un agent (on se rapproche s'il le faut). */
export const echelleSuivi = (cam: Camera, c: Taille): number => Math.max(cam.s, Math.min(bornesEchelle(c).max, contenir(c) * 2.2));

// ------------------------------------------------------------------ cartes de survol

export type Cote = 'haut' | 'bas' | 'droite' | 'gauche';

/**
 * Position d'une carte flottante près d'un élément (`ancre`, pixels du
 * plateau), sans jamais sortir du cadre : au-dessus de préférence, sinon
 * en dessous, à droite, à gauche ; à défaut, collée au bord le plus proche.
 */
export function placerCarte(ancre: Rect, carte: Taille, cadre: Taille, marge = 8, ecart = 10): { x: number; y: number; cote: Cote } {
  const cx = ancre.x + ancre.l / 2;
  const cy = ancre.y + ancre.h / 2;
  const xMax = Math.max(marge, cadre.l - carte.l - marge);
  const yMax = Math.max(marge, cadre.h - carte.h - marge);
  const horizontal = borne(cx - carte.l / 2, marge, xMax);
  const vertical = borne(cy - carte.h / 2, marge, yMax);
  const essais: Array<{ cote: Cote; x: number; y: number; ok: boolean }> = [
    { cote: 'haut', x: horizontal, y: ancre.y - ecart - carte.h, ok: ancre.y - ecart - carte.h >= marge },
    { cote: 'bas', x: horizontal, y: ancre.y + ancre.h + ecart, ok: ancre.y + ancre.h + ecart + carte.h <= cadre.h - marge },
    { cote: 'droite', x: ancre.x + ancre.l + ecart, y: vertical, ok: ancre.x + ancre.l + ecart + carte.l <= cadre.l - marge },
    { cote: 'gauche', x: ancre.x - ecart - carte.l, y: vertical, ok: ancre.x - ecart - carte.l >= marge },
  ];
  const choix = essais.find(e => e.ok) ?? { cote: (cy < cadre.h / 2 ? 'bas' : 'haut') as Cote, x: horizontal, y: cy < cadre.h / 2 ? cadre.h - carte.h - marge : marge };
  return { cote: choix.cote, x: Math.round(borne(choix.x, marge, xMax)), y: Math.round(borne(choix.y, marge, yMax)) };
}
