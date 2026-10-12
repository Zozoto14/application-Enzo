/**
 * Claude Office, onglet « Bureau » : logique pure de la scène « open space »
 * en ZONES THÉMATIQUES (sans React ni DOM, testée dans scene.test.tsx).
 *
 * - Plan (repère au sol : x vers la droite-bas, y vers la gauche-bas, en
 *   dalles) : dix zones (Atelier code, Salle des machines, Bibliothèque, Café
 *   web, Salle de réunion, Coin réflexion, Accueil, Détente, « Attend ta
 *   réponse », Salle d'attente) avec leurs places, reliées par des couloirs.
 * - Chaque agent occupe une place de la zone de son activité (zones.ts) ; il
 *   change de zone en marchant, avec une HYSTÉRÉSIS (séjour minimal, sauf vers
 *   les zones qui demandent ton attention) et une place libre (sinon il reste
 *   où il est, compté « en attente de place »).
 * - Trajets par les couloirs, sur deux voies selon le sens de marche, et
 *   planification sans collision : un trajet ne part que s'il reste à
 *   `SEUIL_COLLISION` de tout autre marcheur.
 * - Phases d'un personnage : arrive (porte), marche, installé, fête (fin de
 *   tâche), repart (avec son carton), parti.
 * - Apparence dérivée de l'identifiant de session (peau, coiffure,
 *   accessoire) et du projet (couleur du haut). Mode « démo » scénarisé.
 */

import { couleurAgent, type Agent, type EtatAgent } from './logiqueBureau';
import type { EntreeHistorique } from './logiqueHistorique';
import { ZONES_PRIORITAIRES, zoneOutil, type Zone } from './zones';

export interface Point {
  x: number;
  y: number;
}

// ------------------------------------------------------------------ plan

/** Dimensions de la pièce (dalles). */
export const LARGEUR_PIECE = 20;
export const PROFONDEUR_PIECE = 14;
export const HAUTEUR_MURS = 3;

export const PORTE = { x0: 13.65, x1: 15.15 } as const;
/** Seuil de la porte, hors de la pièce (y). */
export const DEHORS = -0.6;

/** Emprise au sol de chaque zone (x0, y0, x1, y1). */
export const RECTS_ZONES: Record<Zone, { x0: number; y0: number; x1: number; y1: number }> = {
  reunion: { x0: 0, y0: 0, x1: 4.2, y1: 4.4 },
  bibliotheque: { x0: 4.8, y0: 0, x1: 12.8, y1: 4.3 },
  accueil: { x0: 12.8, y0: 0, x1: 16.3, y1: 4.3 },
  cafe: { x0: 16.3, y0: 0, x1: 20, y1: 4.3 },
  reflexion: { x0: 0, y0: 5.7, x1: 4.15, y1: 9.8 },
  atelier: { x0: 5.25, y0: 5.7, x1: 13.6, y1: 9.8 },
  machines: { x0: 15.2, y0: 5.7, x1: 20, y1: 9.8 },
  salle: { x0: 0, y0: 11.0, x1: 5.8, y1: 14 },
  guichet: { x0: 6.3, y0: 11.0, x1: 13.0, y1: 14 },
  detente: { x0: 13.6, y0: 11.0, x1: 20, y1: 14 },
};

/** Couloirs (axes) : deux horizontaux (fond, devant), deux verticaux (porte, gauche). */
export type Couloir = 'H1' | 'H2' | 'V1' | 'V2';
export const COULOIRS = { H1: 5.0, H2: 10.4, V1: 14.4, V2: 4.7 } as const;
/** Décalage de chaque voie par rapport à l'axe (on circule « à droite » selon le sens de marche). */
export const DEMI_VOIE = 0.3;

export interface Acces {
  c: Couloir;
  /** Abscisse le long d'un couloir horizontal, ordonnée le long d'un vertical. */
  v: number;
}

export type GenrePlace = 'bureau' | 'chaise' | 'fauteuil' | 'pouf' | 'tabouret' | 'canape' | 'debout';

export interface Place {
  index: number;
  zone: Zone;
  /** Où se tient le personnage. */
  pos: Point;
  /** Direction du regard au sol (vue de face ou de dos, miroir). */
  regard: Point;
  genre: GenrePlace;
  acces: Acces;
  /** Points de passage depuis l'accès au couloir jusqu'à la place (la place en dernier). */
  entree: Point[];
}

type Def = [Zone, number, number, number, number, GenrePlace, Acces, Array<[number, number]>?];
const H = (c: 'H1' | 'H2', v: number): Acces => ({ c, v });
const V = (c: 'V1' | 'V2', v: number): Acces => ({ c, v });

/** Atelier : deux îlots de quatre bureaux (rangée du fond face à nous, rangée de devant de dos). */
export const ILOTS_ATELIER = [5.6, 9.6] as const;
export const LARGEUR_BUREAU = 1.8;
export const Y_SIEGE_FOND = 6.15;
export const Y_SIEGE_DEVANT = 9.35;
export const Y_BUREAU_FOND = 6.75;

const DEFS: Def[] = [
  ...ILOTS_ATELIER.flatMap(x0 => [0, 1].flatMap(col => {
    const x = x0 + LARGEUR_BUREAU * col + LARGEUR_BUREAU / 2;
    return [
      ['atelier', x, Y_SIEGE_FOND, 0, 1, 'bureau', H('H1', x)] as Def,
      ['atelier', x, Y_SIEGE_DEVANT, 0, -1, 'bureau', H('H2', x)] as Def,
    ];
  })),
  ['machines', 16.2, 7.0, 0, -1, 'debout', V('V1', 7.0)],
  ['machines', 18.4, 7.0, 0, -1, 'debout', V('V1', 7.55), [[18.4, 7.55]]],
  ['machines', 16.4, 9.35, 0, -1, 'bureau', H('H2', 16.4)],
  ['machines', 18.4, 9.35, 0, -1, 'bureau', H('H2', 18.4)],
  ['bibliotheque', 6.2, 3.3, 0, -1, 'chaise', H('H1', 6.2)],
  ['bibliotheque', 7.3, 3.3, 0, -1, 'chaise', H('H1', 7.3)],
  ['bibliotheque', 10.2, 3.3, 0, -1, 'chaise', H('H1', 10.2)],
  ['bibliotheque', 11.3, 3.3, 0, -1, 'chaise', H('H1', 11.3)],
  ['bibliotheque', 8.75, 2.0, 0, 1, 'fauteuil', H('H1', 8.75)],
  ['cafe', 17.0, 1.4, 0, -1, 'tabouret', H('H1', 17.0)],
  ['cafe', 17.9, 1.4, 0, -1, 'tabouret', H('H1', 17.9)],
  ['cafe', 18.7, 2.95, 1, 0, 'tabouret', H('H1', 18.7)],
  ['cafe', 17.3, 3.25, -1, 0, 'debout', H('H1', 17.3)],
  ['reunion', 1.6, 1.05, 0, 1, 'chaise', H('H1', 3.85), [[3.85, 0.55], [1.6, 0.55]]],
  ['reunion', 2.9, 1.05, 0, 1, 'chaise', H('H1', 3.85), [[3.85, 0.55], [2.9, 0.55]]],
  ['reunion', 1.6, 3.4, 0, -1, 'chaise', H('H1', 3.85), [[3.85, 3.95], [1.6, 3.95]]],
  ['reunion', 2.9, 3.4, 0, -1, 'chaise', H('H1', 3.85), [[3.85, 3.95], [2.9, 3.95]]],
  ['reflexion', 1.2, 6.3, 1, 0, 'pouf', V('V2', 6.3)],
  ['reflexion', 2.6, 7.35, 1, 0, 'pouf', V('V2', 7.35)],
  ['reflexion', 1.2, 8.35, 1, 0, 'pouf', V('V2', 8.35)],
  ['reflexion', 2.75, 9.3, 1, 0, 'pouf', V('V2', 9.3)],
  ['accueil', 13.0, 1.4, 1, 0, 'chaise', V('V1', 1.4)],
  ['accueil', 13.0, 2.6, 1, 0, 'chaise', V('V1', 2.6)],
  ['accueil', 15.45, 2.0, 1, 0, 'debout', V('V1', 2.0)],
  ['salle', 0.95, 11.7, 1, 0, 'canape', H('H2', 1.8), [[1.8, 11.7]]],
  ['salle', 0.95, 12.5, 1, 0, 'canape', H('H2', 1.8), [[1.8, 12.5]]],
  ['salle', 0.95, 13.3, 1, 0, 'canape', H('H2', 1.8), [[1.8, 13.3]]],
  ['salle', 3.5, 12.1, -1, 0, 'canape', H('H2', 2.7), [[2.7, 12.1]]],
  ['salle', 3.5, 13.0, -1, 0, 'canape', H('H2', 2.7), [[2.7, 13.0]]],
  ['guichet', 7.6, 12.3, 0, 1, 'debout', H('H2', 7.6)],
  ['guichet', 9.0, 12.3, 0, 1, 'debout', H('H2', 9.0)],
  ['guichet', 10.4, 12.3, 0, 1, 'debout', H('H2', 10.4)],
  ['guichet', 11.8, 12.3, 0, 1, 'debout', H('H2', 11.8)],
  ['detente', 15.0, 12.2, 1, 0, 'fauteuil', H('H2', 15.0)],
  ['detente', 16.7, 12.2, -1, 0, 'fauteuil', H('H2', 16.7)],
  ['detente', 17.7, 12.2, 1, 0, 'fauteuil', H('H2', 17.7)],
  ['detente', 18.7, 12.0, 1, 0, 'debout', H('H2', 18.7)],
];

export const PLACES: readonly Place[] = DEFS.map(([zone, x, y, rx, ry, genre, acces, points], index) => ({
  index, zone, pos: { x, y }, regard: { x: rx, y: ry }, genre, acces,
  entree: [...(points ?? []).map(([px, py]) => ({ x: px, y: py })), { x, y }],
}));
export const NB_PLACES = PLACES.length;
export const placesDe = (zone: Zone): Place[] => PLACES.filter(p => p.zone === zone);

// ------------------------------------------------------------------ itinéraires

const estH = (c: Couloir) => c === 'H1' || c === 'H2';
export const pointAcces = (a: Acces): Point => (estH(a.c) ? { x: a.v, y: COULOIRS[a.c] } : { x: COULOIRS[a.c], y: a.v });
const PORTE_ACCES: Acces = { c: 'V1', v: DEHORS };

/** Itinéraire par les AXES des couloirs, de l'accès `a` à l'accès `b` (coins compris). */
export function itineraire(a: Acces, b: Acces): Point[] {
  const pa = pointAcces(a);
  const pb = pointAcces(b);
  if (a.c === b.c) return [pa, pb];
  if (estH(a.c) && estH(b.c)) {
    const v = (['V1', 'V2'] as const).reduce((m, c) => (Math.abs(pa.x - COULOIRS[c]) + Math.abs(pb.x - COULOIRS[c]) < Math.abs(pa.x - COULOIRS[m]) + Math.abs(pb.x - COULOIRS[m]) ? c : m));
    return [pa, { x: COULOIRS[v], y: pa.y }, { x: COULOIRS[v], y: pb.y }, pb];
  }
  if (estH(a.c)) return [pa, { x: pb.x, y: pa.y }, pb];
  if (estH(b.c)) return [pa, { x: pa.x, y: pb.y }, pb];
  const h = (['H1', 'H2'] as const).reduce((m, c) => (Math.abs(pa.y - COULOIRS[c]) + Math.abs(pb.y - COULOIRS[c]) < Math.abs(pa.y - COULOIRS[m]) + Math.abs(pb.y - COULOIRS[m]) ? c : m));
  return [pa, { x: pa.x, y: COULOIRS[h] }, { x: pb.x, y: COULOIRS[h] }, pb];
}

const proche = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
function nettoyer(points: Point[]): Point[] {
  const res: Point[] = [];
  for (const p of points) if (!res.length || !proche(res[res.length - 1], p)) res.push(p);
  // Points alignés sur un même axe, dans le même sens : un seul segment.
  return res.filter((p, i) => {
    if (i === 0 || i === res.length - 1) return true;
    const a = res[i - 1];
    const b = res[i + 1];
    const memeX = Math.abs(a.x - p.x) < 1e-6 && Math.abs(p.x - b.x) < 1e-6 && (p.y - a.y) * (b.y - p.y) > 0;
    const memeY = Math.abs(a.y - p.y) < 1e-6 && Math.abs(p.y - b.y) < 1e-6 && (p.x - a.x) * (b.x - p.x) > 0;
    return !(memeX || memeY);
  });
}

/** Itinéraire sur les VOIES : chaque segment décalé à droite de son sens de marche. */
export function surLesVoies(axes: Point[]): Point[] {
  const pts = nettoyer(axes);
  if (pts.length < 2) return pts;
  const decalage = (a: Point, b: Point): Point => {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (-(b.y - a.y) / l) * DEMI_VOIE, y: ((b.x - a.x) / l) * DEMI_VOIE };
  };
  const res: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    const avant = i > 0 ? decalage(pts[i - 1], pts[i]) : undefined;
    const apres = i < pts.length - 1 ? decalage(pts[i], pts[i + 1]) : undefined;
    // Coin entre deux segments d'axes différents : on prend le décalage de chacun sur son axe.
    const d = avant && apres ? { x: avant.x + apres.x, y: avant.y + apres.y } : (avant ?? apres)!;
    res.push({ x: pts[i].x + d.x, y: pts[i].y + d.y });
  }
  return res;
}

/** Chemin complet d'une place (ou de la porte) à une autre (ou à la porte). */
export function chemin(de: Place | 'porte', vers: Place | 'porte'): Point[] {
  const aDe = de === 'porte' ? PORTE_ACCES : de.acces;
  const aVers = vers === 'porte' ? PORTE_ACCES : vers.acces;
  const sortie = de === 'porte' ? [] : [...de.entree].reverse();
  const entree = vers === 'porte' ? [] : vers.entree;
  return nettoyer([...sortie, ...surLesVoies(itineraire(aDe, aVers)), ...entree]);
}
export const cheminArrivee = (p: Place): Point[] => chemin('porte', p);
export const cheminDepart = (p: Place): Point[] => chemin(p, 'porte');

// ------------------------------------------------------------------ hachage et apparence

/** Hachage FNV-1a 32 bits (stable, sans dépendance). */
export function hacher(texte: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const PEAUX = ['#F6D3B8', '#EBB894', '#D39A6E', '#A9714B', '#7A4B31'] as const;
export const CHEVEUX = ['#2B1E16', '#5A3825', '#9A5B2E', '#D8A54A', '#C9CBD3', '#8E3B2E', '#34436F'] as const;
export const PANTALONS = ['#2F3A52', '#4A4F5C', '#5B4636', '#33504A'] as const;
export const COUPES = ['courte', 'chignon', 'longue', 'boucles', 'meche'] as const;
export const ACCESSOIRES = ['aucun', 'lunettes', 'casque', 'bonnet', 'noeud', 'echarpe'] as const;

export interface Apparence {
  peau: string;
  cheveux: string;
  coupe: (typeof COUPES)[number];
  accessoire: (typeof ACCESSOIRES)[number];
  /** Couleur du haut : celle du projet (comme la pastille de la liste). */
  haut: string;
  pantalon: string;
  /** Couleur de l'accessoire. */
  touche: string;
}

const TOUCHES = ['#F2C14E', '#E76F51', '#4CC9F0', '#9B5DE5', '#2EC4B6', '#F15BB5'] as const;

/** Apparence stable d'un agent : visage et accessoire selon la session, haut selon le projet. */
export function apparence(a: Pick<Agent, 'cle' | 'session' | 'projet'>): Apparence {
  const h = hacher(a.session || a.cle);
  const g = hacher(`${a.cle}#`);
  return {
    peau: PEAUX[h % PEAUX.length],
    cheveux: CHEVEUX[(h >>> 4) % CHEVEUX.length],
    coupe: COUPES[(h >>> 8) % COUPES.length],
    accessoire: ACCESSOIRES[(h >>> 12) % ACCESSOIRES.length],
    haut: couleurAgent(a.projet ?? a.cle),
    pantalon: PANTALONS[(g >>> 3) % PANTALONS.length],
    touche: TOUCHES[(g >>> 7) % TOUCHES.length],
  };
}

// ------------------------------------------------------------------ activité visible

export type Activite = 'attend' | 'code' | 'terminal' | 'recherche' | 'lecture' | 'web' | 'agent' | 'outil' | 'pense' | 'pause' | 'fini';

export const LIBELLES_ACTIVITE: Record<Activite, string> = {
  attend: 'Attend ta réponse',
  code: 'Écrit du code',
  terminal: 'Terminal',
  recherche: 'Recherche dans le code',
  lecture: 'Lit un fichier',
  web: 'Consulte le web',
  agent: 'Lance un sous-agent',
  outil: 'Utilise un outil',
  pense: 'Réfléchit',
  pause: 'Pause café',
  fini: 'Terminé',
};

/** Couleurs de l'activité (anneau des badges, lumière des écrans). */
export const TEINTES_ACTIVITE: Record<Activite, string> = {
  attend: '#E5484D', code: '#7C6CF2', terminal: '#2FBF71', recherche: '#E8A23A', lecture: '#3BA3D9', web: '#2E8FE0', agent: '#C05BD8', outil: '#E07A3A', pense: '#8F96A8', pause: '#B98552', fini: '#2FA36B',
};

export const ICONES_ACTIVITE: Record<Activite, string> = {
  attend: '!', code: '</>', terminal: '>_', recherche: '⌕', lecture: '¶', web: '◍', agent: '✦', outil: '⚙', pense: '…', pause: '☕', fini: '✓',
};

/** Le gadget montré selon l'outil (le hook note la fin des outils, et leur durée). */
export function genreOutil(nom: string | undefined): Activite {
  const n = (nom ?? '').trim();
  if (!n) return 'outil';
  if (/^(write|write_file|edit|multiedit|replace|notebookedit|str_replace_editor|apply_patch)$/i.test(n)) return 'code';
  if (/grep|glob|search|find|^ls$|list/i.test(n) && !/web/i.test(n)) return 'recherche';
  switch (zoneOutil(n)) {
    case 'cafe': return 'web';
    case 'reunion': return 'agent';
    case 'machines': return 'terminal';
    case 'bibliotheque': return /read|view|cat|open/i.test(n) ? 'lecture' : 'recherche';
    default: return 'outil';
  }
}

export function activiteAgent(a: Pick<Agent, 'etat' | 'outil'> & { salle?: boolean }): Activite {
  if (a.salle) return 'fini';
  switch (a.etat) {
    case 'attend':
      return 'attend';
    case 'ecrit':
      return 'code';
    case 'outil': {
      const g = genreOutil(a.outil);
      return g === 'code' ? 'outil' : g;
    }
    case 'reflechit':
      return 'pense';
    case 'inactif':
      return 'pause';
    default:
      return 'fini';
  }
}

// ------------------------------------------------------------------ affectation des places

/**
 * Place d'un agent dans une zone : celle que désigne son identifiant, sinon la
 * suivante libre de la zone. Rien si la zone est pleine.
 */
export function choisirPlace(cle: string, zone: Zone, prises: ReadonlySet<number>): number | undefined {
  const zonePlaces = placesDe(zone);
  const depart = hacher(cle) % zonePlaces.length;
  for (let i = 0; i < zonePlaces.length; i++) {
    const p = zonePlaces[(depart + i) % zonePlaces.length];
    if (!prises.has(p.index)) return p.index;
  }
  return undefined;
}

/** Zones de repli pour un nouvel agent dont la zone est pleine. */
const REPLI: readonly Zone[] = ['atelier', 'reflexion', 'detente', 'bibliotheque', 'machines', 'cafe', 'reunion', 'accueil', 'salle', 'guichet'];

// ------------------------------------------------------------------ trajets

export function longueur(points: readonly Point[]): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return l;
}

/** Point situé à `d` dalles du début du chemin, et direction du segment. */
export function pointSur(points: readonly Point[], d: number): { p: Point; dir: Point } {
  let reste = Math.max(0, d);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const dir = l ? { x: (b.x - a.x) / l, y: (b.y - a.y) / l } : { x: 0, y: 1 };
    if (reste <= l || i === points.length - 1) {
      const k = l ? Math.min(1, reste / l) : 1;
      return { p: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, dir };
    }
    reste -= l;
  }
  return { p: { ...points[0] }, dir: { x: 0, y: 1 } };
}

/** Vitesse de marche (dalles par seconde). */
export const VITESSE = 2.4;
/** Distance minimale entre deux marcheurs visibles (dalles). */
export const SEUIL_COLLISION = 0.55;
/** Attente au plus avant de partir quand même (s). */
export const ATTENTE_MAX = 60;

export interface Trajet {
  id: string;
  points: Point[];
  /** Départ (secondes de l'horloge de la scène). */
  debut: number;
  duree: number;
}

export function positionTrajet(tr: Trajet, t: number): { p: Point; dir: Point } {
  return pointSur(tr.points, Math.min(tr.duree, Math.max(0, t - tr.debut)) * VITESSE);
}

/** Un marcheur est visible une fois la porte franchie. */
export const estDansLaPiece = (p: Point): boolean => p.y > -0.15;

function conflit(existants: readonly Trajet[], candidat: Trajet, seuil: number): boolean {
  for (const e of existants) {
    const de = Math.max(candidat.debut, e.debut);
    const a = Math.min(candidat.debut + candidat.duree, e.debut + e.duree);
    if (a < de) continue;
    for (let t = de; t <= a + 1e-9; t += 0.05) {
      const p = positionTrajet(candidat, t).p;
      const q = positionTrajet(e, t).p;
      if (!estDansLaPiece(p) && !estDansLaPiece(q)) continue;
      if (Math.hypot(p.x - q.x, p.y - q.y) < seuil) return true;
    }
  }
  return false;
}

/** Le premier départ (par pas de 0,25 s) qui ne croise aucun trajet existant à moins du seuil. */
export function planifier(existants: readonly Trajet[], id: string, points: Point[], demande: number, seuil = SEUIL_COLLISION): Trajet {
  const duree = longueur(points) / VITESSE;
  for (let k = 0; k <= ATTENTE_MAX / 0.25; k++) {
    const candidat = { id, points, debut: demande + k * 0.25, duree };
    if (!conflit(existants, candidat, seuil)) return candidat;
  }
  return { id, points, debut: demande + ATTENTE_MAX, duree };
}

// ------------------------------------------------------------------ simulation

export type Phase = 'attente' | 'marche' | 'assis' | 'fete' | 'depart' | 'parti';

/** Durée de la petite fête de fin de tâche (s). */
export const DUREE_FETE = 2.6;
/** Séjour minimal dans une zone avant d'en changer (s) : pas d'aller-retour frénétique. */
export const SEJOUR_MIN = 12;

/** Ce que la scène doit savoir d'un agent. */
export type AgentScene = Pick<Agent, 'cle' | 'etat' | 'zone' | 'salle'>;

export interface Occupant {
  cle: string;
  /** Place occupée (ou visée pendant la marche). */
  place: number;
  phase: Phase;
  trajet?: Trajet;
  /** Début de la phase (s). */
  depuis: number;
  /** Arrivée dans la zone de sa place (s) : base de l'hystérésis. */
  depuisZone: number;
  /** Zone où il devrait être. */
  voulue: Zone;
  /** L'agent a quitté la liste : il disparaît une fois sorti. */
  sortie: boolean;
  /** Session terminée et vue (ou délai écoulé) : il repart avec son carton. */
  partir: boolean;
  /** Petite fête déjà faite pour cette fin de tâche. */
  feteFaite: boolean;
  /** Changement de place sans marche (animations réduites) : instant (s), pour un fondu. */
  teleporte?: number;
}

export interface EtatScene {
  occupants: Map<string, Occupant>;
  trajets: Trajet[];
  pret: boolean;
}

export const creerScene = (): EtatScene => ({ occupants: new Map(), trajets: [], pret: false });

const zoneDe = (o: Occupant): Zone => PLACES[o.place].zone;
const placesPrises = (s: EtatScene) => new Set([...s.occupants.values()].filter(o => o.phase !== 'parti').map(o => o.place));

/**
 * Changer de zone maintenant ? Vers ou depuis une zone prioritaire (guichet, salle d'attente : tu as répondu,
 * ou tu as vu ce qu'il a fini), toujours ; sinon après le séjour minimal.
 */
export const changementDu = (o: Pick<Occupant, 'voulue' | 'depuisZone'>, t: number, actuelle?: Zone): boolean =>
  ZONES_PRIORITAIRES.has(o.voulue) || (actuelle !== undefined && ZONES_PRIORITAIRES.has(actuelle)) || t - o.depuisZone >= SEJOUR_MIN;

function marcher(s: EtatScene, o: Occupant, de: Place | 'porte', place: number, t: number, anime: boolean): void {
  o.place = place;
  if (!anime) {
    Object.assign(o, { phase: 'assis', trajet: undefined, depuis: t, depuisZone: t, teleporte: t });
    return;
  }
  const tr = planifier(s.trajets, `${o.cle}>${place}@${t.toFixed(2)}`, chemin(de, PLACES[place]), t);
  s.trajets.push(tr);
  Object.assign(o, { phase: de === 'porte' && t < tr.debut ? 'attente' : 'marche', trajet: tr, depuis: t, depuisZone: tr.debut + tr.duree });
}

function partirVersPorte(s: EtatScene, o: Occupant, t: number, anime: boolean): void {
  if (!anime) {
    if (o.sortie) s.occupants.delete(o.cle);
    else Object.assign(o, { phase: 'parti', trajet: undefined, depuis: t });
    return;
  }
  const tr = planifier(s.trajets, `${o.cle}>porte@${t.toFixed(2)}`, cheminDepart(PLACES[o.place]), t);
  s.trajets.push(tr);
  Object.assign(o, { phase: 'depart', trajet: tr, depuis: t });
}

/** Un agent installé : partir, fêter, ou changer de zone si c'est dû et qu'une place est libre. */
function decider(s: EtatScene, o: Occupant, t: number, anime: boolean): boolean {
  if (o.phase !== 'assis') return false;
  if (o.sortie || o.partir) {
    if (anime && o.partir && !o.feteFaite && zoneDe(o) !== 'salle') {
      Object.assign(o, { phase: 'fete', depuis: t, feteFaite: true });
    } else partirVersPorte(s, o, t, anime);
    return true;
  }
  if (o.voulue === zoneDe(o) || !changementDu(o, t, zoneDe(o))) return false;
  const libre = choisirPlace(o.cle, o.voulue, placesPrises(s));
  if (libre === undefined) return false; // zone pleine : il reste où il est, compté « en attente de place »
  if (o.voulue === 'salle' && anime && !o.feteFaite) {
    Object.assign(o, { phase: 'fete', depuis: t, feteFaite: true });
    return true;
  }
  if (o.voulue !== 'salle') o.feteFaite = false;
  marcher(s, o, PLACES[o.place], libre, t, anime);
  return true;
}

/** Fait avancer les phases jusqu'à l'instant `t` ; vrai si quelque chose a changé. */
export function avancer(s: EtatScene, t: number, anime = true): boolean {
  let change = false;
  for (const o of [...s.occupants.values()]) {
    if (o.phase === 'attente' && o.trajet && t >= o.trajet.debut) {
      o.phase = 'marche';
      change = true;
    }
    if (o.phase === 'marche' && o.trajet && t >= o.trajet.debut + o.trajet.duree) {
      const fin = o.trajet.debut + o.trajet.duree;
      Object.assign(o, { phase: 'assis', trajet: undefined, depuis: fin, depuisZone: fin });
      change = true;
    }
    if (o.phase === 'fete' && t >= o.depuis + DUREE_FETE) {
      Object.assign(o, { phase: 'assis', depuis: o.depuis + DUREE_FETE });
      change = true;
    }
    if (o.phase === 'depart' && o.trajet && t >= o.trajet.debut + o.trajet.duree) {
      if (o.sortie) s.occupants.delete(o.cle);
      else Object.assign(o, { phase: 'parti', depuis: o.trajet.debut + o.trajet.duree, trajet: undefined });
      change = true;
      continue;
    }
    if (decider(s, o, t, anime)) change = true;
  }
  const avant = s.trajets.length;
  s.trajets = s.trajets.filter(tr => tr.debut + tr.duree > t - 1);
  return change || avant !== s.trajets.length;
}

/**
 * Met la scène en accord avec la liste des agents à l'instant `t` (secondes).
 * Sans animation (`anime` faux) : changements de place instantanés (fondu).
 * Première fois : chacun est d'emblée à sa place.
 */
export function reconcilier(s: EtatScene, agents: readonly AgentScene[], t: number, o: { anime: boolean }): void {
  const direct = !o.anime || !s.pret;
  const presents = new Map(agents.map(a => [a.cle, a] as const));
  if (!o.anime) {
    // Animations coupées : personne ne marche.
    for (const occ of [...s.occupants.values()]) {
      if (occ.phase === 'attente' || occ.phase === 'marche' || occ.phase === 'fete') Object.assign(occ, { phase: 'assis', trajet: undefined });
      if (occ.phase === 'depart') {
        if (occ.sortie) s.occupants.delete(occ.cle);
        else Object.assign(occ, { phase: 'parti', trajet: undefined });
      }
    }
    s.trajets = [];
  } else avancer(s, t, true);

  // Partis de la liste.
  for (const occ of [...s.occupants.values()]) {
    if (presents.has(occ.cle)) continue;
    if (direct || occ.phase === 'parti' || occ.phase === 'attente') s.occupants.delete(occ.cle);
    else occ.sortie = true;
  }

  // Présents : zone voulue, départ.
  for (const [cle, a] of presents) {
    const occ = s.occupants.get(cle);
    if (!occ) continue;
    const partir = a.etat === 'termine' && !a.salle;
    Object.assign(occ, { sortie: false, partir, voulue: a.zone });
    if (!a.salle && a.etat !== 'termine') occ.feteFaite = false;
    if (occ.phase === 'parti' && !partir) {
      // Session reprise : il revient.
      const libre = choisirPlace(cle, a.zone, placesPrises(s)) ?? choisirPlace(cle, 'detente', placesPrises(s));
      if (libre !== undefined) marcher(s, occ, 'porte', libre, t, !direct);
    }
  }

  // Nouveaux venus (ordre des clés : placement déterministe).
  for (const cle of [...presents.keys()].sort()) {
    if (s.occupants.has(cle)) continue;
    const a = presents.get(cle)!;
    if (a.etat === 'termine' && !a.salle) continue;
    const prises = placesPrises(s);
    let place = choisirPlace(cle, a.zone, prises);
    for (const z of REPLI) if (place === undefined) place = choisirPlace(cle, z, prises);
    if (place === undefined) continue;
    const occ: Occupant = { cle, place, phase: 'assis', depuis: t, depuisZone: t, voulue: a.zone, sortie: false, partir: false, feteFaite: a.salle };
    s.occupants.set(cle, occ);
    if (!direct) marcher(s, occ, 'porte', place, t, true);
  }
  if (direct) {
    // Première fois (ou sans animation) : chacun droit à sa zone, sans attendre.
    for (const occ of s.occupants.values()) {
      if (occ.phase === 'assis' && occ.voulue !== zoneDe(occ) && !occ.partir && !occ.sortie) {
        const libre = choisirPlace(occ.cle, occ.voulue, placesPrises(s));
        if (libre !== undefined && (s.pret ? changementDu(occ, t, zoneDe(occ)) : true)) marcher(s, occ, PLACES[occ.place], libre, t, false);
      }
      if (occ.partir && occ.phase === 'assis' && !s.pret) Object.assign(occ, { phase: 'parti' });
    }
    if (s.pret) avancer(s, t, false);
  } else avancer(s, t, true);
  s.pret = true;
}

/** Prochain instant (s) où la scène doit être réexaminée sans nouvel événement (séjour minimal, fête). */
export function prochaineEcheance(s: EtatScene): number | undefined {
  let min: number | undefined;
  const garder = (v: number) => { min = min === undefined ? v : Math.min(min, v); };
  for (const o of s.occupants.values()) {
    if (o.phase === 'fete') garder(o.depuis + DUREE_FETE);
    if (o.phase === 'assis' && (o.voulue !== zoneDe(o) || o.partir || o.sortie)) garder(o.partir || o.sortie || changementDu(o, -Infinity, zoneDe(o)) ? o.depuis : o.depuisZone + SEJOUR_MIN);
  }
  return min;
}

export type ModePose = 'assis' | 'debout' | 'marche' | 'range' | 'fete';

export interface Pose {
  cle: string;
  place: number;
  zone: Zone;
  mode: ModePose;
  x: number;
  y: number;
  /** « face » : on voit le visage ; « dos » : on voit le dos. */
  vue: 'face' | 'dos';
  /** Retourné horizontalement (le dessin de base regarde vers la droite). */
  miroir: boolean;
  opacite: number;
}

/** Vue selon la direction au sol. */
export function vueDepuis(dir: Point): { vue: 'face' | 'dos'; miroir: boolean } {
  if (Math.abs(dir.x) >= Math.abs(dir.y)) return dir.x >= 0 ? { vue: 'face', miroir: false } : { vue: 'dos', miroir: true };
  return dir.y >= 0 ? { vue: 'face', miroir: true } : { vue: 'dos', miroir: false };
}

/** Personnages à dessiner à l'instant `t` (ceux qui attendent dehors ou sont partis n'en font pas partie). */
export function poses(s: EtatScene, t: number): Pose[] {
  const res: Pose[] = [];
  for (const o of s.occupants.values()) {
    const place = PLACES[o.place];
    if (o.phase === 'attente' || o.phase === 'parti') continue;
    const enRoute = (o.phase === 'marche' || o.phase === 'depart') && o.trajet && t >= o.trajet.debut;
    if (enRoute && o.trajet) {
      const { p, dir } = positionTrajet(o.trajet, t);
      if (!estDansLaPiece(p)) continue;
      res.push({ cle: o.cle, place: o.place, zone: place.zone, mode: 'marche', x: p.x, y: p.y, ...vueDepuis(dir), opacite: Math.min(1, (p.y + 0.15) / 0.8) });
      continue;
    }
    // En attendant son tour de marcher : à son point de départ.
    const ici = o.phase === 'marche' && o.trajet ? o.trajet.points[0] : place.pos;
    const debout = place.genre === 'debout';
    res.push({
      cle: o.cle,
      place: o.place,
      zone: place.zone,
      mode: o.phase === 'fete' ? 'fete' : o.phase === 'depart' ? 'range' : o.phase === 'marche' ? 'debout' : debout ? 'debout' : 'assis',
      x: ici.x,
      y: ici.y,
      ...vueDepuis(place.regard),
      opacite: 1,
    });
  }
  return res;
}

/** Agents présents par zone (installés ou en route vers elle) et agents qui attendent une place. */
export function comptesZones(s: EtatScene): { presents: Record<Zone, number>; sansPlace: Record<Zone, number> } {
  const vide = () => ({ accueil: 0, atelier: 0, machines: 0, bibliotheque: 0, cafe: 0, reunion: 0, reflexion: 0, guichet: 0, salle: 0, detente: 0 });
  const presents: Record<Zone, number> = vide();
  const sansPlace: Record<Zone, number> = vide();
  const prises = placesPrises(s);
  for (const o of s.occupants.values()) {
    if (o.phase === 'attente' || o.phase === 'parti' || o.phase === 'depart') continue;
    presents[zoneDe(o)]++;
    if (o.phase === 'assis' && o.voulue !== zoneDe(o) && !o.partir && !o.sortie && choisirPlace(o.cle, o.voulue, prises) === undefined) sansPlace[o.voulue]++;
  }
  return { presents, sansPlace };
}

/** Nombre d'arrivées qui patientent à l'entrée. */
export const enAttente = (s: EtatScene): number => [...s.occupants.values()].filter(o => o.phase === 'attente').length;

/** Plus petite distance entre deux marcheurs visibles, échantillonnée (tests, diagnostic). */
export function distanceMinimale(trajets: readonly Trajet[], pas = 0.02): number {
  let min = Infinity;
  for (let i = 0; i < trajets.length; i++) {
    for (let j = i + 1; j < trajets.length; j++) {
      const a = trajets[i];
      const b = trajets[j];
      const de = Math.max(a.debut, b.debut);
      const fin = Math.min(a.debut + a.duree, b.debut + b.duree);
      for (let t = de; t <= fin; t += pas) {
        const p = positionTrajet(a, t).p;
        const q = positionTrajet(b, t).p;
        if (!estDansLaPiece(p) && !estDansLaPiece(q)) continue;
        min = Math.min(min, Math.hypot(p.x - q.x, p.y - q.y));
      }
    }
  }
  return min;
}

// ------------------------------------------------------------------ projection isométrique

/** Demi-largeur et demi-hauteur d'une dalle, hauteur d'une unité verticale (px logiques). */
export const ISO = { dx: 32, dy: 16, dz: 32, ox: 14 * 32 + 40, oy: 128 } as const;
export const LARGEUR_SCENE = (LARGEUR_PIECE + PROFONDEUR_PIECE) * ISO.dx + 80;
export const HAUTEUR_SCENE = (LARGEUR_PIECE + PROFONDEUR_PIECE) * ISO.dy + ISO.oy + 46;

/** Point du monde (x, y au sol, z en hauteur) → point de l'écran. */
export function iso(x: number, y: number, z = 0): Point {
  return { x: (x - y) * ISO.dx + ISO.ox, y: (x + y) * ISO.dy - z * ISO.dz + ISO.oy };
}

/** Profondeur pour l'ordre de dessin (plus grand = plus devant). */
export const profondeur = (x: number, y: number): number => x + y;

// ------------------------------------------------------------------ démo

const DEMANDES_DEMO = [
  'Ajoute un export CSV des dépenses du mois',
  'Pourquoi ce test échoue-t-il seulement le lundi ?',
  'Rends le formulaire d’inscription accessible au clavier',
  'Cherche où sont lus les réglages de la météo',
  'Écris la documentation du nouveau module',
  'Optimise le chargement des images de la galerie',
  'Corrige l’arrondi des totaux dans le panier',
  'Ajoute un mode sombre à la page d’accueil',
  'Explique-moi ce que fait ce script de migration',
  'Prépare une version mobile du tableau de bord',
] as const;
const PROJETS_DEMO = ['boutique', 'api-meteo', 'carnet', 'jardin', 'atelier'] as const;
const VISITEURS_DEMO = ['site-vitrine', 'quiz', 'agenda'] as const;
/**
 * Script d'une session « résidente » : [seconde du cycle, type, outil, résumé, durée (ms)].
 * Elle passe par toutes les zones : réflexion, bibliothèque, atelier, machines, café web,
 * réunion, guichet (une session sur deux), salle d'attente.
 */
type LigneDemo = readonly [number, string, string?, string?, number?];
const SCRIPT_DEMO: readonly LigneDemo[] = [
  [0, 'demande'],
  [6, 'outil', 'Read', 'src/index.ts', 420],
  [10, 'outil', 'Grep', '« réglages » dans src', 900],
  [14, 'outil', 'Glob', '**/*.test.ts', 300],
  [24, 'outil', 'Edit', 'src/module.ts', 1_200],
  [29, 'outil', 'Write', 'src/nouveau.ts', 800],
  [34, 'outil', 'Edit', 'src/module.ts', 950],
  [44, 'outil', 'Bash', 'Lance les tests — npm test', 7_400],
  [50, 'outil', 'Bash', 'npm run build', 12_800],
  [60, 'outil', 'WebFetch', 'https://developer.mozilla.org', 2_100],
  [65, 'outil', 'WebSearch', 'accessibilité formulaire', 3_300],
  [74, 'outil', 'Task', 'Vérifier les cas limites', 21_000],
  [79, 'outil', 'TodoWrite', '3 tâche(s)', 40],
  [86, 'attente', 'Bash', 'Autoriser Bash (git push) ?'],
  [98, 'outil', 'Bash', 'git push', 2_600],
  [104, 'fin-reponse'],
];
export const CYCLE_DEMO = 128;
const PERIODE_VISITEUR = 75;

/**
 * Entrées fictives du mode « démo » à l'instant `maintenant` (ms), la démo
 * ayant commencé à `debut` (ms). Cinq sessions résidentes font le tour des
 * zones, une sur deux attend une autorisation au guichet ; des visiteurs
 * passent, travaillent, terminent et restent en salle d'attente (deux y sont
 * dès le début).
 */
export function entreesDemo(debut: number, maintenant: number): EntreeHistorique[] {
  const res: EntreeHistorique[] = [];
  const ecoule = (maintenant - debut) / 1000;
  const ev = (session: string, projet: string, s: number, type: string, extra: Partial<EntreeHistorique> = {}) => {
    if (s > ecoule) return;
    res.push({
      v: 1, id: `demo-${session}-${s.toFixed(2)}-${type}`, ts: new Date(debut + s * 1000).toISOString(), type,
      appareil: 'PC de démo', appareilId: 'demo00000000', session, projet, dossier: `/demo/${projet}`, ...extra,
    });
  };
  PROJETS_DEMO.forEach((projet, r) => {
    const session = `demo-${projet}`;
    const arrivee = 1 + r * 2.2;
    ev(session, projet, arrivee - 40, 'debut-session');
    const decalage = arrivee - r * 26 + 8;
    const cycleCourant = Math.max(0, Math.floor((ecoule - decalage) / CYCLE_DEMO));
    for (let c = Math.max(0, cycleCourant - 1); c <= cycleCourant; c++) {
      for (const [s, type, outil, resume, duree] of SCRIPT_DEMO) {
        if (type === 'attente' && r % 2) continue;
        const quand = decalage + c * CYCLE_DEMO + s;
        ev(session, projet, quand, type, type === 'demande'
          ? { texte: DEMANDES_DEMO[(r * 3 + c) % DEMANDES_DEMO.length] }
          : type === 'attente' ? { outil, resume, motif: 'permission' }
            : type === 'fin-reponse' ? { sortie: `C’est fait : ${DEMANDES_DEMO[(r * 3 + c) % DEMANDES_DEMO.length].toLowerCase()}. Tests au vert.` }
              : outil ? { outil, resume, ...(duree ? { duree } : {}) } : {});
      }
    }
  });
  // Une session au repos depuis un moment (fin de réponse vue il y a longtemps) : en détente.
  ev('demo-notes', 'notes', -900, 'debut-session');
  ev('demo-notes', 'notes', -880, 'demande', { texte: 'Résume les notes de la réunion de lundi' });
  ev('demo-notes', 'notes', -860, 'outil', { outil: 'Read', resume: 'notes/lundi.md', duree: 250 });
  ev('demo-notes', 'notes', -800, 'fin-reponse');
  // Visiteurs : arrivent, travaillent, terminent la session, puis attendent en salle d'attente.
  const dernier = Math.floor((ecoule - 20) / PERIODE_VISITEUR);
  for (let k = Math.max(-2, dernier - 4); k <= dernier; k++) {
    const a = 20 + k * PERIODE_VISITEUR;
    const projet = VISITEURS_DEMO[((k % 3) + 3) % 3];
    const session = `demo-visiteur-${k}`;
    ev(session, projet, a, 'debut-session', { resume: 'startup' });
    ev(session, projet, a + 6, 'demande', { texte: DEMANDES_DEMO[(((k * 7 + 5) % 10) + 10) % 10] });
    ev(session, projet, a + 9, 'outil', { outil: 'Glob', resume: '**/*.css', duree: 200 });
    ev(session, projet, a + 12, 'outil', { outil: 'Read', resume: 'styles.css', duree: 300 });
    ev(session, projet, a + 24, 'outil', { outil: 'Edit', resume: 'styles.css', duree: 700 });
    ev(session, projet, a + 28, 'outil', { outil: 'Edit', resume: 'index.html', duree: 650 });
    ev(session, projet, a + 40, 'outil', { outil: 'Bash', resume: 'npm run build', duree: 9_000 });
    ev(session, projet, a + 52, 'fin-session', { resume: 'prompt_input_exit' });
  }
  return res;
}

/** Les agents réduits à ce que la scène doit savoir (pour comparer deux rendus). */
export const signatureAgents = (agents: readonly AgentScene[]): string => agents.map(a => `${a.cle}:${a.etat}:${a.zone}:${a.salle ? 1 : 0}`).join('|');

export type { EtatAgent };
