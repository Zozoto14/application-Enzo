/**
 * Géométrie de l'éditeur de strats (pure, testée) : formes des capacités À L'ÉCHELLE de la map (mètres →
 * unités du repère carré de 1000), poignées d'édition (orienter un mur, ouvrir un cône, allonger un
 * trajet), zone initiale d'une capacité d'après ses caractéristiques (profil de jeu), cadrage d'une image
 * déposée dans le repère, aimantation, lecture animée des étapes.
 */

import type { CapaciteJeu } from '../jeux/api';
import type { Etape, ObjetStrat, Zone } from './document';
import { echelleEffective } from './modeles';

const rad = (a: number) => (a * Math.PI) / 180;
const deg = (r: number) => Math.round(((r * 180) / Math.PI) * 10) / 10;
const arrondi = (n: number) => Math.round(n * 10) / 10;

/** Primitive de dessin d'une zone (unités du repère). */
export type Primitive =
  | { type: 'cercle'; x: number; y: number; r: number }
  | { type: 'secteur'; x: number; y: number; r: number; angle: number; ouverture: number }
  | { type: 'trait'; points: number[]; epaisseur: number; courbe: boolean; tirets: boolean }
  | { type: 'rect'; x: number; y: number; longueur: number; largeur: number; angle: number }
  | { type: 'trajet'; points: number[]; r: number };

/** Forme d'une zone posée en (x, y), dimensions converties avec l'échelle de la map (unités par mètre). */
export function primitiveZone(x: number, y: number, z: Zone, echelle?: number | null): Primitive {
  const k = echelleEffective(echelle);
  switch (z.forme) {
    case 'cercle':
      return { type: 'cercle', x, y, r: z.rayon * k };
    case 'cone':
      return { type: 'secteur', x, y, r: z.portee * k, angle: z.angle, ouverture: z.ouverture };
    case 'mur': {
      const l = z.longueur * k;
      const x2 = x + l * Math.cos(rad(z.angle));
      const y2 = y + l * Math.sin(rad(z.angle));
      if (!z.courbure) return { type: 'trait', points: [x, y, x2, y2], epaisseur: Math.max(2, z.largeur * k), courbe: false, tirets: false };
      // Mur courbable : point milieu décalé perpendiculairement (courbure × demi-longueur), tracé lissé.
      const mx = (x + x2) / 2 - (l / 2) * z.courbure * Math.sin(rad(z.angle));
      const my = (y + y2) / 2 + (l / 2) * z.courbure * Math.cos(rad(z.angle));
      return { type: 'trait', points: [x, y, mx, my, x2, y2], epaisseur: Math.max(2, z.largeur * k), courbe: true, tirets: false };
    }
    case 'ligne': {
      const l = z.longueur * k;
      return { type: 'trait', points: [x, y, x + l * Math.cos(rad(z.angle)), y + l * Math.sin(rad(z.angle))], epaisseur: 3, courbe: false, tirets: true };
    }
    case 'rect':
      return { type: 'rect', x, y, longueur: z.longueur * k, largeur: z.largeur * k, angle: z.angle };
    case 'trajet':
      return { type: 'trajet', points: [x + z.dx, y + z.dy, x, y], r: z.rayon * k };
  }
}

/** Poignées d'une zone (unités du repère, absolues) : extrémité du mur, direction du cône, origine du trajet… */
export function poignees(x: number, y: number, z: Zone, echelle?: number | null): Array<{ cle: 'fin' | 'courbe' | 'bord'; x: number; y: number }> {
  const p = primitiveZone(x, y, z, echelle);
  switch (z.forme) {
    case 'cercle':
      return [{ cle: 'bord', x: x + (p as { r: number }).r, y }];
    case 'cone':
    case 'ligne':
    case 'rect': {
      const l = z.forme === 'cone' ? z.portee : z.longueur;
      const k = echelleEffective(echelle);
      return [{ cle: 'fin', x: x + l * k * Math.cos(rad(z.angle)), y: y + l * k * Math.sin(rad(z.angle)) }];
    }
    case 'mur': {
      const pts = (p as { points: number[] }).points;
      const n = pts.length;
      const fin = { cle: 'fin' as const, x: pts[n - 2], y: pts[n - 1] };
      if (z.courbure === 0 && n === 4) return [fin, { cle: 'courbe', x: (pts[0] + pts[2]) / 2, y: (pts[1] + pts[3]) / 2 }];
      return [fin, { cle: 'courbe', x: pts[2], y: pts[3] }];
    }
    case 'trajet':
      return [{ cle: 'fin', x: x + z.dx, y: y + z.dy }];
  }
}

/**
 * Nouvelle zone quand on tire une poignée jusqu'en (px, py). `fixe` : la longueur ou la portée est celle
 * des caractéristiques de la capacité (on n'oriente que la direction) — sinon elle suit le pointeur.
 * `courbable` : le mur se courbe (High Tide, Blaze).
 */
export function tirerPoignee(x: number, y: number, z: Zone, poignee: 'fin' | 'courbe' | 'bord', px: number, py: number, echelle?: number | null, { fixe = false, courbable = false } = {}): Zone {
  const k = echelleEffective(echelle);
  const angle = deg(Math.atan2(py - y, px - x));
  const dist = Math.hypot(px - x, py - y) / k;
  switch (z.forme) {
    case 'cercle':
      return fixe ? z : { ...z, rayon: Math.max(0.2, Math.min(100, arrondi(dist))) };
    case 'cone':
      return { ...z, angle, portee: fixe ? z.portee : Math.max(0.5, Math.min(200, arrondi(dist))) };
    case 'ligne':
    case 'rect':
      return { ...z, angle, longueur: fixe ? z.longueur : Math.max(0.5, Math.min(200, arrondi(dist))) };
    case 'trajet':
      return { ...z, dx: arrondi(px - x), dy: arrondi(py - y) };
    case 'mur': {
      if (poignee === 'courbe') {
        if (!courbable) return z;
        // Décalage perpendiculaire du milieu, rapporté à la demi-longueur : -1 à 1.
        const l = z.longueur * k;
        const mx = x + (l / 2) * Math.cos(rad(z.angle));
        const my = y + (l / 2) * Math.sin(rad(z.angle));
        const perp = -(px - mx) * Math.sin(rad(z.angle)) + (py - my) * Math.cos(rad(z.angle));
        return { ...z, courbure: Math.max(-1, Math.min(1, Math.round((perp / (l / 2)) * 100) / 100)) };
      }
      return { ...z, angle, longueur: fixe ? z.longueur : Math.max(0.5, Math.min(200, arrondi(dist))) };
    }
  }
}

/** Zone initiale d'une capacité d'après ses caractéristiques (profil ou données pré-remplies) ; null : icône seule. */
export function zoneDepuisCapacite(c: CapaciteJeu | undefined): Zone | null {
  if (!c) return null;
  switch (c.forme) {
    case 'cercle':
      return { forme: 'cercle', rayon: c.rayon ?? 4 };
    case 'mur':
      return { forme: 'mur', angle: 0, longueur: c.longueur ?? 10, largeur: c.largeur ?? 1, courbure: 0 };
    case 'cone':
      return { forme: 'cone', angle: -90, ouverture: c.ouverture ?? 60, portee: c.portee ?? c.longueur ?? 15 };
    case 'trajet':
      return { forme: 'trajet', dx: -120, dy: 120, rayon: c.rayon ?? 0 };
    case 'ligne':
      return { forme: 'ligne', angle: 0, longueur: c.longueur ?? 8 };
    case 'rect':
      return { forme: 'rect', angle: 0, longueur: c.longueur ?? 10, largeur: c.largeur ?? 4 };
    default:
      return null;
  }
}

/** La longueur (ou portée, ou rayon) d'une capacité est-elle fixée par ses caractéristiques ? */
export function dimensionFixe(c: CapaciteJeu | undefined): boolean {
  if (!c) return false;
  if (c.forme === 'cercle') return c.rayon !== undefined;
  if (c.forme === 'cone') return c.portee !== undefined || c.longueur !== undefined;
  if (c.forme === 'mur' || c.forme === 'ligne' || c.forme === 'rect') return c.longueur !== undefined;
  return false;
}

/** Cadre d'une image (largeur × hauteur) dans le repère carré de 1000, centrée sans déformation. */
export function cadreImage(largeur?: number, hauteur?: number): { x: number; y: number; l: number; h: number } {
  if (!largeur || !hauteur || largeur <= 0 || hauteur <= 0) return { x: 0, y: 0, l: 1000, h: 1000 };
  if (largeur >= hauteur) {
    const h = (1000 * hauteur) / largeur;
    return { x: 0, y: (1000 - h) / 2, l: 1000, h };
  }
  const l = (1000 * largeur) / hauteur;
  return { x: (1000 - l) / 2, y: 0, l, h: 1000 };
}

/** Aimantation sur une grille (`pas` unités ; 0 : aucune). */
export const aimanter = (v: number, pas: number): number => (pas > 0 ? Math.round(v / pas) * pas : v);

/** Centre d'un polygone (moyenne des sommets) : place de l'étiquette d'un callout. */
export function centre(points: readonly number[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  const n = points.length / 2;
  for (let i = 0; i < points.length; i += 2) {
    x += points[i];
    y += points[i + 1];
  }
  return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
}

/** Le point (x, y) est-il dans le polygone (callout survolé) ? */
export function dansPolygone(x: number, y: number, points: readonly number[]): boolean {
  let dedans = false;
  for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [points[i], points[i + 1], points[j], points[j + 1]];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) dedans = !dedans;
  }
  return dedans;
}

// ------------------------------------------------------------------ Lecture animée

/** Longueurs cumulées d'un tracé. */
function cumul(points: readonly number[]): number[] {
  const c = [0];
  for (let i = 2; i < points.length; i += 2) c.push(c[c.length - 1] + Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]));
  return c;
}

/** Point à la fraction `f` (0 à 1) de la longueur d'un tracé. */
export function pointSurTrace(points: readonly number[], f: number): { x: number; y: number } {
  if (points.length < 2) return { x: 0, y: 0 };
  const c = cumul(points);
  const total = c[c.length - 1];
  if (total === 0 || f <= 0) return { x: points[0], y: points[1] };
  if (f >= 1) return { x: points[points.length - 2], y: points[points.length - 1] };
  const cible = f * total;
  let i = 1;
  while (i < c.length - 1 && c[i] < cible) i++;
  const t = (cible - c[i - 1]) / (c[i] - c[i - 1] || 1);
  return { x: points[(i - 1) * 2] + (points[i * 2] - points[(i - 1) * 2]) * t, y: points[(i - 1) * 2 + 1] + (points[i * 2 + 1] - points[(i - 1) * 2 + 1]) * t };
}

/** Moment (s) d'apparition d'un objet dans une étape lue : utilitaires par minutage ou par ordre, le reste d'emblée. */
export function momentObjet(o: ObjetStrat, e: Etape): number {
  const duree = e.duree ?? 5;
  if (o.type === 'capacite') {
    if (typeof o.t === 'number') return Math.min(o.t, duree);
    if (typeof o.ordre === 'number') {
      const n = Math.max(1, ...e.objets.map(x => (x.type === 'capacite' ? (x.ordre ?? 0) : 0)));
      return Math.round(((o.ordre - 1) / n) * duree * 0.8 * 10) / 10;
    }
  }
  if ((o.type === 'fleche' || o.type === 'ligne') && typeof o.t0 === 'number') return Math.min(o.t0, duree);
  return 0;
}

export interface EtatLecture {
  /** Objets visibles au temps t. */
  visibles: Set<string>;
  /** Progression (0 à 1) des trajets en cours. */
  progression: Map<string, number>;
  /** Position des joueurs qui suivent un trajet minuté (pion déplacé le long de la flèche). */
  positions: Map<number, { x: number; y: number }>;
}

/** État d'une étape à l'instant `t` (secondes) de la lecture animée. */
export function etatLecture(e: Etape, t: number): EtatLecture {
  const duree = e.duree ?? 5;
  const visibles = new Set<string>();
  const progression = new Map<string, number>();
  const positions = new Map<number, { x: number; y: number }>();
  for (const o of e.objets) {
    const debut = momentObjet(o, e);
    if (t < debut) continue;
    visibles.add(o.id);
    if (o.type === 'fleche' || o.type === 'ligne') {
      const t0 = o.t0 ?? 0;
      const t1 = Math.max(t0 + 0.1, o.t1 ?? duree);
      const f = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
      progression.set(o.id, f);
      if (typeof o.joueur === 'number') positions.set(o.joueur, pointSurTrace(o.points, f));
    }
  }
  return { visibles, progression, positions };
}

/** Portion d'un tracé parcourue (pour dessiner une flèche qui s'allonge). */
export function tracePartiel(points: readonly number[], f: number): number[] {
  if (f >= 1) return [...points];
  const c = cumul(points);
  const cible = f * c[c.length - 1];
  const sortie: number[] = [points[0], points[1]];
  for (let i = 1; i < c.length; i++) {
    if (c[i] <= cible) sortie.push(points[i * 2], points[i * 2 + 1]);
    else {
      const p = pointSurTrace(points, f);
      sortie.push(p.x, p.y);
      break;
    }
  }
  if (sortie.length < 4) sortie.push(points[0], points[1]);
  return sortie;
}
