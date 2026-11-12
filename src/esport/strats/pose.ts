/**
 * Gestes de l'éditeur de strats (fonctions PURES, testées) : pose « cliquer-glisser » (appui = origine,
 * glisser = direction et longueur) et poignées d'édition des objets orientables (capacités, cônes de vision,
 * regard des pions), bornées à la longueur RÉELLE de la capacité (caractéristiques du profil de jeu).
 *
 * Le canevas (src/esport/ui/strats/CanevasStrat.web.tsx) ne fait que relayer les positions du pointeur
 * (souris, doigt ou stylet) dans le repère du document ; Maj enfoncée aimante l'angle à 15°.
 */

import type { CapaciteJeu } from '../jeux/api';
import type { ChampsObjet, ObjetStrat, Zone } from './document';
import { angleAimante, longueurMax, poignees, tirerPoigneeObjet, zoneVisee, type CleePoignee } from './geometrie';
import { echelleEffective } from './modeles';

export type Point = { x: number; y: number };

/** Geste de pose en cours : origine (appui), pointeur courant, chemin parcouru (murs courbables). */
export interface Visee {
  origine: Point;
  pointeur: Point;
  chemin: number[];
}

const arrondi = (n: number) => Math.round(n * 10) / 10;
const deg = (r: number) => Math.round(((r * 180) / Math.PI) * 10) / 10;

export const debuterVisee = (pt: Point): Visee => ({ origine: pt, pointeur: pt, chemin: [pt.x, pt.y] });

/** Le pointeur bouge : le chemin garde un point tous les `pas` (200 points au plus). */
export function suivreVisee(v: Visee, pt: Point, pas = 6): Visee {
  const n = v.chemin.length;
  const loin = Math.hypot(pt.x - v.chemin[n - 2], pt.y - v.chemin[n - 1]) >= pas;
  return { ...v, pointeur: pt, chemin: loin && n < 400 ? [...v.chemin, pt.x, pt.y] : v.chemin };
}

/** Le geste est-il un glisser (au-delà de `seuil` unités), et non un simple appui ? */
export const estGlisse = (v: Visee, seuil: number): boolean => Math.hypot(v.pointeur.x - v.origine.x, v.pointeur.y - v.origine.y) > seuil;

/** Angle (degrés) de l'origine vers le pointeur, aimanté à 15° si demandé. */
export function angleVisee(v: Visee, aimant = false): number {
  const a = deg(Math.atan2(v.pointeur.y - v.origine.y, v.pointeur.x - v.origine.x));
  return aimant ? angleAimante(a) : a;
}

/** Capacité posée par un glisser : point de pose et zone (voir `zoneVisee`), longueur bornée à la longueur réelle. */
export function poseCapacite(v: Visee, zone: Zone | null, echelle: number | null | undefined, donnees: CapaciteJeu | undefined, aimant = false) {
  const chemin = [...v.chemin];
  const n = chemin.length;
  if (chemin[n - 2] !== v.pointeur.x || chemin[n - 1] !== v.pointeur.y) chemin.push(v.pointeur.x, v.pointeur.y);
  return zoneVisee(zone, v.origine, v.pointeur, echelle, { max: longueurMax(donnees), aimant, chemin, courbable: Boolean(donnees?.courbable) });
}

/** Cône de vision posé par un glisser : origine, angle, portée (mètres, 1 à 200). */
export function poseVision(v: Visee, echelle: number | null | undefined, aimant = false): { x: number; y: number; angle: number; portee: number } {
  const portee = Math.max(1, Math.min(200, arrondi(Math.hypot(v.pointeur.x - v.origine.x, v.pointeur.y - v.origine.y) / echelleEffective(echelle))));
  return { x: v.origine.x, y: v.origine.y, angle: angleVisee(v, aimant), portee };
}

/** Pion posé par un glisser : à l'origine, regard vers le pointeur. */
export const posePion = (v: Visee, aimant = false): { x: number; y: number; angle: number } => ({ x: v.origine.x, y: v.origine.y, angle: angleVisee(v, aimant) });

// ------------------------------------------------------------------ Poignées des objets

/** Distance (unités) de la poignée de regard d'un pion. */
export const DISTANCE_REGARD = 48;

export interface PoigneeObjet {
  cle: CleePoignee | 'regard';
  x: number;
  y: number;
}

/** Poignées d'un objet orientable (capacité à zone, cône de vision, pion) ; [] sinon. */
export function poigneesObjet(o: ObjetStrat, echelle: number | null | undefined): PoigneeObjet[] {
  const rad = (a: number) => (a * Math.PI) / 180;
  if (o.type === 'capacite' && o.zone) return poignees(o.x, o.y, o.zone, echelle);
  if (o.type === 'vision') {
    const r = o.portee * echelleEffective(echelle);
    return [{ cle: 'fin', x: o.x + r * Math.cos(rad(o.angle)), y: o.y + r * Math.sin(rad(o.angle)) }];
  }
  if (o.type === 'agent') {
    const a = o.angle ?? -90;
    return [{ cle: 'regard', x: o.x + DISTANCE_REGARD * Math.cos(rad(a)), y: o.y + DISTANCE_REGARD * Math.sin(rad(a)) }];
  }
  return [];
}

/**
 * Une poignée tirée jusqu'en `pt` : champs à modifier sur l'objet (zone, position, angle, portée), bornés à
 * la longueur réelle de la capacité (`donnees`) ; undefined si la poignée ne s'applique pas.
 */
export function tirerPoigneeDe(o: ObjetStrat, cle: PoigneeObjet['cle'], pt: Point, echelle: number | null | undefined, donnees?: CapaciteJeu, aimant = false): ChampsObjet | undefined {
  if (o.type === 'capacite' && o.zone && cle !== 'regard') {
    const r = tirerPoigneeObjet(o.x, o.y, o.zone, cle, pt.x, pt.y, echelle, { max: longueurMax(donnees), aimant, courbable: Boolean(donnees?.courbable) || !donnees });
    return r.x !== o.x || r.y !== o.y ? { x: r.x, y: r.y, zone: r.zone } : { zone: r.zone };
  }
  if (o.type === 'vision') {
    const v = poseVision({ origine: { x: o.x, y: o.y }, pointeur: pt, chemin: [] }, echelle, aimant);
    return { angle: v.angle, portee: v.portee };
  }
  if (o.type === 'agent') return { angle: Math.round(angleVisee({ origine: { x: o.x, y: o.y }, pointeur: pt, chemin: [] }, aimant)) };
  return undefined;
}

/** Objet avec des champs appliqués (aperçu pendant le geste, avant l'action). */
export const avecChamps = <T extends ObjetStrat>(o: T, champs: ChampsObjet | undefined): T => (champs ? ({ ...o, ...champs } as T) : o);
