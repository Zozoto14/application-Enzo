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
  | { type: 'trait'; points: number[]; epaisseur: number; courbe: boolean; tirets: boolean; double?: number }
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
      // Mur double (Fast Lane) : deux lignes fines écartées de la largeur.
      const double = z.double ? { double: Math.max(4, z.largeur * k), epaisseur: Math.max(2, 0.4 * k) } : {};
      if (z.trace && z.trace.length >= 2) {
        const pts = [x, y];
        for (let i = 0; i + 1 < z.trace.length; i += 2) pts.push(arrondi(x + z.trace[i] * k), arrondi(y + z.trace[i + 1] * k));
        return { type: 'trait', points: pts, epaisseur: Math.max(2, z.largeur * k), courbe: pts.length > 4, tirets: false, ...double };
      }
      const x2 = x + l * Math.cos(rad(z.angle));
      const y2 = y + l * Math.sin(rad(z.angle));
      if (!z.courbure) return { type: 'trait', points: [x, y, x2, y2], epaisseur: Math.max(2, z.largeur * k), courbe: false, tirets: false, ...double };
      // Mur courbable : point milieu décalé perpendiculairement (courbure × demi-longueur), tracé lissé.
      const mx = (x + x2) / 2 - (l / 2) * z.courbure * Math.sin(rad(z.angle));
      const my = (y + y2) / 2 + (l / 2) * z.courbure * Math.cos(rad(z.angle));
      return { type: 'trait', points: [x, y, mx, my, x2, y2], epaisseur: Math.max(2, z.largeur * k), courbe: true, tirets: false, ...double };
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
/**
 * Poignée d'édition d'une zone : `fin` (extrémité : direction et longueur), `debut` (première extrémité d'un
 * mur : le point de pose bouge, l'autre extrémité reste), `courbe` (milieu d'un mur courbable), `bord` (rayon),
 * `p<n>` (point n d'un mur tracé).
 */
export type CleePoignee = 'fin' | 'courbe' | 'bord' | 'debut' | `p${number}`;

export function poignees(x: number, y: number, z: Zone, echelle?: number | null): Array<{ cle: CleePoignee; x: number; y: number }> {
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
      const debut = { cle: 'debut' as const, x, y };
      if (z.trace && z.trace.length >= 2) return [debut, ...Array.from({ length: (n - 2) / 2 }, (_, i) => ({ cle: `p${i}` as CleePoignee, x: pts[2 + i * 2], y: pts[3 + i * 2] }))];
      const fin = { cle: 'fin' as const, x: pts[n - 2], y: pts[n - 1] };
      if (z.courbure === 0 && n === 4) return [debut, fin, { cle: 'courbe', x: (pts[0] + pts[2]) / 2, y: (pts[1] + pts[3]) / 2 }];
      return [debut, fin, { cle: 'courbe', x: pts[2], y: pts[3] }];
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
export function tirerPoignee(
  x: number,
  y: number,
  z: Zone,
  poignee: CleePoignee,
  px: number,
  py: number,
  echelle?: number | null,
  { fixe = false, courbable = false, max, aimant = false }: { fixe?: boolean; courbable?: boolean; max?: number; aimant?: boolean } = {},
): Zone {
  const k = echelleEffective(echelle);
  const angle = aimant ? angleAimante(deg(Math.atan2(py - y, px - x))) : deg(Math.atan2(py - y, px - x));
  const dist = Math.min(Math.hypot(px - x, py - y) / k, max ?? Infinity);
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
      if (poignee !== 'fin') return z;
      return { ...z, angle, longueur: fixe ? z.longueur : Math.max(0.5, Math.min(200, arrondi(dist))) };
    }
  }
}

/** Angle aimanté à 15° (Maj enfoncée pendant le geste). */
export const angleAimante = (a: number, pas = 15): number => Math.round(a / pas) * pas;

/**
 * Longueur MAXIMALE réelle d'une capacité (mètres), d'après ses caractéristiques : longueur d'un mur, d'une
 * ligne ou d'un rectangle, portée d'un cône, rayon d'un cercle ; undefined si elle n'est pas connue.
 */
export function longueurMax(c: CapaciteJeu | undefined): number | undefined {
  if (!c) return undefined;
  if (c.forme === 'cercle') return c.rayon;
  if (c.forme === 'cone') return c.portee ?? c.longueur;
  if (c.forme === 'mur' || c.forme === 'ligne' || c.forme === 'rect') return c.longueur;
  return undefined;
}

/** Longueur d'un tracé (unités de ses coordonnées). */
export function longueurTrace(points: readonly number[]): number {
  let l = 0;
  for (let i = 2; i + 1 < points.length; i += 2) l += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
  return l;
}

/** Tracé coupé à la longueur `max` (le dernier segment est raccourci). */
export function limiterTrace(points: readonly number[], max: number): number[] {
  const sortie = points.slice(0, 2);
  let l = 0;
  for (let i = 2; i + 1 < points.length; i += 2) {
    const d = Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
    if (l + d <= max) {
      sortie.push(points[i], points[i + 1]);
      l += d;
      continue;
    }
    const f = d > 0 ? (max - l) / d : 0;
    if (f > 0.001) sortie.push(arrondi(points[i - 2] + (points[i] - points[i - 2]) * f), arrondi(points[i - 1] + (points[i + 1] - points[i - 1]) * f));
    break;
  }
  return sortie;
}

/** Simplification d'un tracé (Ramer-Douglas-Peucker) : garde les points qui s'écartent de plus de `tolerance`. */
export function simplifierTrace(points: readonly number[], tolerance: number): number[] {
  const n = points.length / 2;
  if (n <= 2) return [...points];
  const garder = new Array<boolean>(n).fill(false);
  garder[0] = garder[n - 1] = true;
  const pile: Array<[number, number]> = [[0, n - 1]];
  while (pile.length) {
    const [a, b] = pile.pop() as [number, number];
    const [ax, ay, bx, by] = [points[a * 2], points[a * 2 + 1], points[b * 2], points[b * 2 + 1]];
    const l = Math.hypot(bx - ax, by - ay) || 1e-9;
    let pire = -1;
    let distance = 0;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - points[i * 2 + 1]) - (ax - points[i * 2]) * (by - ay)) / l;
      if (d > distance) [distance, pire] = [d, i];
    }
    if (pire > 0 && distance > tolerance) {
      garder[pire] = true;
      pile.push([a, pire], [pire, b]);
    }
  }
  return points.filter((_, i) => garder[Math.floor(i / 2)]);
}

/** Tracé décalé perpendiculairement de `d` (mur double) : normales moyennes aux sommets. */
export function decalerTrace(points: readonly number[], d: number): number[] {
  const n = points.length / 2;
  const sortie: number[] = [];
  for (let i = 0; i < n; i++) {
    const [px, py] = i > 0 ? [points[i * 2 - 2], points[i * 2 - 1]] : [points[0], points[1]];
    const [sx, sy] = i < n - 1 ? [points[i * 2 + 2], points[i * 2 + 3]] : [points[i * 2], points[i * 2 + 1]];
    const [dx, dy] = i === 0 ? [sx - points[0], sy - points[1]] : i === n - 1 ? [points[i * 2] - px, points[i * 2 + 1] - py] : [sx - px, sy - py];
    const l = Math.hypot(dx, dy) || 1;
    sortie.push(points[i * 2] - (dy / l) * d, points[i * 2 + 1] + (dx / l) * d);
  }
  return sortie;
}

/** Points maximum d'un mur tracé (High Tide). */
export const POINTS_TRACE_MAX = 16;

/**
 * Pose « cliquer-glisser » d'une capacité : appui = origine, relâché = visée. Rend le point de pose et la zone :
 *  - cône, ligne, rectangle, mur : posés à l'origine, orientés vers le pointeur, longueur = distance bornée à
 *    la longueur réelle (`max`, mètres) ; un mur COURBABLE suit le chemin parcouru s'il n'est pas droit
 *    (tracé simplifié, coupé à `max`) ;
 *  - trajet (recon, drone, dard) : lancé depuis l'origine, posé là où l'on relâche ;
 *  - cercle ou icône seule : posé là où l'on relâche.
 * `aimant` (Maj) : angle aimanté à 15°.
 */
export function zoneVisee(
  z: Zone | null,
  origine: { x: number; y: number },
  pointeur: { x: number; y: number },
  echelle?: number | null,
  { max, aimant = false, chemin, courbable = false }: { max?: number; aimant?: boolean; chemin?: readonly number[]; courbable?: boolean } = {},
): { x: number; y: number; zone: Zone | null } {
  const k = echelleEffective(echelle);
  const brut = deg(Math.atan2(pointeur.y - origine.y, pointeur.x - origine.x));
  const angle = aimant ? angleAimante(brut) : brut;
  const dist = Math.max(0.5, Math.min(Math.hypot(pointeur.x - origine.x, pointeur.y - origine.y) / k, max ?? 200, 200));
  if (!z) return { x: pointeur.x, y: pointeur.y, zone: null };
  switch (z.forme) {
    case 'cercle':
      return { x: pointeur.x, y: pointeur.y, zone: z };
    case 'trajet':
      return { x: pointeur.x, y: pointeur.y, zone: { ...z, dx: arrondi(origine.x - pointeur.x), dy: arrondi(origine.y - pointeur.y) } };
    case 'cone':
      return { x: origine.x, y: origine.y, zone: { ...z, angle, portee: arrondi(dist) } };
    case 'ligne':
    case 'rect':
      return { x: origine.x, y: origine.y, zone: { ...z, angle, longueur: arrondi(dist) } };
    case 'mur': {
      const droit: Zone = { forme: 'mur', angle: z.angle, longueur: z.longueur, largeur: z.largeur, courbure: z.courbure, ...(z.double ? { double: true } : {}) };
      if (courbable && chemin && chemin.length >= 6) {
        // Chemin en mètres relatifs à l'origine, simplifié ; droit à 5 % près : mur droit.
        const enMetres = chemin.map((v, i) => (v - (i % 2 === 0 ? origine.x : origine.y)) / k);
        const total = longueurTrace(enMetres);
        const simple = simplifierTrace(enMetres, Math.max(0.3, total * 0.04));
        if (simple.length > 4) {
          let pts = max ? limiterTrace(simple, max) : simple;
          if (pts.length / 2 > POINTS_TRACE_MAX) pts = simplifierTrace(pts, Math.max(0.6, total * 0.08)).slice(0, POINTS_TRACE_MAX * 2);
          const trace = pts.slice(2).map(arrondi);
          if (trace.length >= 4) {
            const n = trace.length;
            return { x: origine.x, y: origine.y, zone: { ...droit, angle: deg(Math.atan2(trace[n - 1], trace[n - 2])), longueur: arrondi(longueurTrace(pts)), courbure: 0, trace } };
          }
        }
      }
      return { x: origine.x, y: origine.y, zone: { ...droit, angle, longueur: arrondi(dist), courbure: 0 } };
    }
  }
}

/**
 * Tirer une poignée d'un objet zone (rend aussi le point de pose, que `debut` déplace) :
 *  - `debut` d'un mur : la première extrémité suit le pointeur, l'autre reste en place (longueur bornée) ;
 *  - `p<n>` d'un mur tracé : le point n suit le pointeur, tracé recoupé à `max` ;
 *  - le reste : `tirerPoignee`.
 */
export function tirerPoigneeObjet(
  x: number,
  y: number,
  z: Zone,
  poignee: CleePoignee,
  px: number,
  py: number,
  echelle?: number | null,
  options: { fixe?: boolean; courbable?: boolean; max?: number; aimant?: boolean } = {},
): { x: number; y: number; zone: Zone } {
  const k = echelleEffective(echelle);
  if (z.forme === 'mur' && poignee === 'debut') {
    if (z.trace && z.trace.length >= 2) {
      // Tracé : l'origine bouge, les autres points restent en place (coordonnées absolues conservées).
      const abs = z.trace.map((v, i) => (i % 2 === 0 ? x : y) + v * k);
      const pts = [px, py, ...abs].map((v, i) => (v - (i % 2 === 0 ? px : py)) / k);
      const coupe = options.max ? limiterTrace(pts, options.max) : pts;
      const trace = coupe.slice(2).map(arrondi);
      if (trace.length < 2) return { x, y, zone: z };
      return { x: arrondi(px), y: arrondi(py), zone: { ...z, trace, longueur: arrondi(longueurTrace(coupe)) } };
    }
    const fx = x + z.longueur * k * Math.cos(rad(z.angle));
    const fy = y + z.longueur * k * Math.sin(rad(z.angle));
    let nx = px;
    let ny = py;
    let angle = deg(Math.atan2(fy - ny, fx - nx));
    if (options.aimant) angle = angleAimante(angle);
    let l = Math.hypot(fx - nx, fy - ny) / k;
    if (options.fixe) l = z.longueur;
    else l = Math.max(0.5, Math.min(l, options.max ?? 200, 200));
    nx = fx - l * k * Math.cos(rad(angle));
    ny = fy - l * k * Math.sin(rad(angle));
    return { x: arrondi(nx), y: arrondi(ny), zone: { ...z, angle, longueur: arrondi(l) } };
  }
  if (z.forme === 'mur' && /^p\d+$/.test(poignee) && z.trace) {
    const i = Number(poignee.slice(1));
    if (i * 2 + 1 >= z.trace.length) return { x, y, zone: z };
    const trace = z.trace.slice();
    trace[i * 2] = (px - x) / k;
    trace[i * 2 + 1] = (py - y) / k;
    const coupe = options.max ? limiterTrace([0, 0, ...trace], options.max) : [0, 0, ...trace];
    // Un point qui dépasserait la longueur réelle est ramené sur le tracé (jamais retiré : la poignée reste).
    while (coupe.length < trace.length + 2) coupe.push(coupe[coupe.length - 2], coupe[coupe.length - 1]);
    const t = coupe.slice(2).map(arrondi);
    return { x, y, zone: { ...z, trace: t, longueur: arrondi(longueurTrace(coupe)) } };
  }
  return { x, y, zone: tirerPoignee(x, y, z, poignee, px, py, echelle, options) };
}

/** Zone initiale d'une capacité d'après ses caractéristiques (profil ou données pré-remplies) ; null : icône seule. */
export function zoneDepuisCapacite(c: CapaciteJeu | undefined): Zone | null {
  if (!c) return null;
  switch (c.forme) {
    case 'cercle':
      return { forme: 'cercle', rayon: c.rayon ?? 4 };
    case 'mur':
      return { forme: 'mur', angle: 0, longueur: c.longueur ?? 10, largeur: c.largeur ?? 1, courbure: 0, ...(c.double ? { double: true } : {}) };
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
