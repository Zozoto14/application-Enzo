/**
 * Logique pure des lineups (testée sans écran) : filtres rapides et facettes (miroir de
 * esport/noyau/lineups/service.mjs), regroupement des pins de la vue par map, tracé de la trajectoire, couleur d'un
 * personnage, sides proposés selon le modèle du jeu.
 */

import type { AgentAsset, Assets, CapaciteAsset, CarteAsset } from '../strats/assets';
import { MODELES, type ModeleStrat } from '../strats/modeles';
import type { FiltresLineups, Lineup, MediaLineup, PointCarte, Reference } from './api';

/** Côté du repère des points (celui des strats). */
export const REPERE = 1000;

/** Texte comparable (minuscules, sans accents). */
export const normaliser = (texte: string | null | undefined): string =>
  String(texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Filtres combinés : map, personnage, capacité, side, zone (clé ou texte libre), tag, statut, favoris, recherche. */
export function filtrerLineups(lineups: readonly Lineup[], f: FiltresLineups = {}): Lineup[] {
  const q = normaliser(f.q);
  const tag = normaliser(f.tag);
  const zone = normaliser(f.zone);
  return lineups.filter(l => {
    if (f.carte && l.carte.cle !== f.carte) return false;
    if (f.personnage && l.personnage?.cle !== f.personnage) return false;
    if (f.capacite && l.capacite?.cle !== f.capacite) return false;
    if (f.side && l.side !== f.side) return false;
    if (zone && l.zone?.cle !== f.zone && normaliser(l.zone?.nom) !== zone) return false;
    if (f.statut && l.statut !== f.statut) return false;
    if (f.favoris && !l.favori) return false;
    if (tag && !l.tags.some(t => normaliser(t) === tag)) return false;
    if (q && !normaliser([l.titre, l.carte.nom, l.personnage?.nom, l.capacite?.nom, l.zone?.nom, l.instructions, l.visee, l.timing, l.tags.join(' ')].filter(Boolean).join(' ')).includes(q)) return false;
    return true;
  });
}

/** Ordre de la grille : favoris, puis validés, puis proposés ; les plus récents d'abord. */
export function trierLineups(lineups: readonly Lineup[]): Lineup[] {
  const rang = { valide: 0, propose: 1 } as const;
  return [...lineups].sort((a, b) => Number(b.favori) - Number(a.favori) || rang[a.statut] - rang[b.statut] || (a.majLe < b.majLe ? 1 : a.majLe > b.majLe ? -1 : 0));
}

export interface OptionFacette {
  id: string;
  nom: string;
  n: number;
}
export interface Facettes {
  cartes: OptionFacette[];
  personnages: OptionFacette[];
  capacites: OptionFacette[];
  zones: OptionFacette[];
  tags: OptionFacette[];
  sides: OptionFacette[];
}

function compter(valeurs: ReadonlyArray<{ id: string; nom: string }>): OptionFacette[] {
  const m = new Map<string, OptionFacette>();
  for (const v of valeurs) {
    const o = m.get(v.id);
    if (o) o.n++;
    else m.set(v.id, { id: v.id, nom: v.nom, n: 1 });
  }
  return [...m.values()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

/** Identifiant de filtre d'une zone : sa clé (callout), sinon son nom normalisé (texte libre). */
export const idZone = (z: Reference | null): string => (z ? (z.cle ?? normaliser(z.nom)) : '');

/**
 * Valeurs présentes dans les lineups (avec leur nombre), pour les filtres : seules les valeurs qui servent sont
 * proposées. Les capacités et les zones sont celles des lineups déjà filtrés par map et par personnage (`f`).
 */
export function facettes(lineups: readonly Lineup[], f: FiltresLineups = {}): Facettes {
  const ref = (r: Reference | null): Array<{ id: string; nom: string }> => (r?.cle ? [{ id: r.cle, nom: r.nom }] : []);
  const surCarte = f.carte ? lineups.filter(l => l.carte.cle === f.carte) : lineups;
  const duPersonnage = f.personnage ? surCarte.filter(l => l.personnage?.cle === f.personnage) : surCarte;
  // Une même clé de capacité peut désigner des capacités différentes d'un personnage à l'autre (Valorant : « Ability2 »
  // est la fumée d'Omen et le mur de Viper) : ces clés ne sont proposées qu'une fois le personnage choisi.
  const noms = new Map<string, Set<string>>();
  for (const l of duPersonnage) {
    if (!l.capacite?.cle) continue;
    noms.set(l.capacite.cle, (noms.get(l.capacite.cle) ?? new Set<string>()).add(normaliser(l.capacite.nom)));
  }
  const ambigues = new Set([...noms].filter(([, n]) => n.size > 1).map(([cle]) => cle));
  return {
    cartes: compter(lineups.map(l => ({ id: l.carte.cle, nom: l.carte.nom }))),
    personnages: compter(surCarte.flatMap(l => ref(l.personnage))),
    capacites: compter(duPersonnage.flatMap(l => (l.capacite?.cle && !ambigues.has(l.capacite.cle) ? ref(l.capacite) : []))),
    zones: compter(surCarte.flatMap(l => (l.zone ? [{ id: idZone(l.zone), nom: l.zone.nom }] : []))),
    tags: compter(lineups.flatMap(l => l.tags.map(t => ({ id: normaliser(t), nom: t })))),
    sides: compter(lineups.filter(l => l.side).map(l => ({ id: l.side, nom: l.side }))),
  };
}

/** Nombre de filtres actifs (hors recherche). */
export const filtresActifs = (f: FiltresLineups): number => (['carte', 'personnage', 'capacite', 'side', 'zone', 'tag', 'statut'] as const).filter(k => Boolean(f[k])).length + (f.favoris ? 1 : 0);

// ------------------------------------------------------------------ Sides et modes

/** Sides proposés par le modèle du jeu : attaque / défense, ou les modes du jeu (The Finals : cashout, final-round). */
export function sidesDuModele(modele: ModeleStrat): string[] {
  const d = MODELES[modele] ?? MODELES.generique;
  return d.sides ? ['attaque', 'defense'] : [...d.modes];
}

// ------------------------------------------------------------------ Personnages, capacités, cartes

export const agentDe = (assets: Assets | undefined, r: Reference | null): AgentAsset | undefined => (r?.cle ? assets?.agents.find(a => a.cle === r.cle) : undefined);
export const capaciteDe = (agent: AgentAsset | undefined, r: Reference | null): CapaciteAsset | undefined => (r?.cle ? agent?.capacites.find(c => c.cle === r.cle) : undefined);
export const carteDe = (assets: Assets | undefined, cle: string | null | undefined): CarteAsset | undefined => (cle ? assets?.cartes.find(c => c.cle === cle) : undefined);

/** Teintes par rôle (Valorant) et par classe (The Finals) ; sinon une teinte stable tirée du nom. */
const TEINTES_ROLES: Record<string, string> = {
  duelliste: '#F2545B',
  duelist: '#F2545B',
  initiateur: '#3CCB7F',
  initiator: '#3CCB7F',
  controleur: '#9B7BF7',
  controller: '#9B7BF7',
  sentinelle: '#2EC4D6',
  sentinel: '#2EC4D6',
  light: '#F4C542',
  medium: '#4DA3FF',
  heavy: '#F2545B',
};
const PALETTE = ['#4DA3FF', '#F2545B', '#3CCB7F', '#F4C542', '#9B7BF7', '#2EC4D6', '#F28C38', '#E86FB0'];

/** Couleur d'accent d'un personnage (anneau du pin, pastille) : celle de son rôle, sinon stable par son nom. */
export function couleurPersonnage(agent: Pick<AgentAsset, 'cle' | 'roleCle' | 'role'> | undefined, repli?: string | null): string {
  const role = normaliser(agent?.roleCle ?? agent?.role);
  if (role && TEINTES_ROLES[role]) return TEINTES_ROLES[role];
  const cle = agent?.cle ?? repli ?? '';
  if (!cle) return '#8FA3BF';
  let h = 0;
  for (let i = 0; i < cle.length; i++) h = (h * 31 + cle.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Initiales d'un nom (« Dark Cover » → « DC », « Omen » → « OM »). */
export function initiales(nom: string | null | undefined): string {
  const mots = String(nom ?? '').trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return '?';
  return (mots.length === 1 ? mots[0].slice(0, 2) : mots[0][0] + mots[1][0]).toUpperCase();
}

// ------------------------------------------------------------------ Médias

const ORDRE_ROLES = ['position', 'visee', 'resultat', 'autre'];
/** Images d'un lineup, dans l'ordre de lecture (position, visée, résultat, autre), puis l'ordre de dépôt. */
export const imagesDe = (l: Pick<Lineup, 'medias'>): MediaLineup[] => l.medias.filter(m => m.genre === 'image').sort((a, b) => ORDRE_ROLES.indexOf(a.role) - ORDRE_ROLES.indexOf(b.role));
export const videoDe = (l: Pick<Lineup, 'medias'>): MediaLineup | undefined => l.medias.find(m => m.genre === 'video');

// ------------------------------------------------------------------ Vue par map : pins et regroupement

export interface GroupePins {
  /** Clé stable du groupe (identifiants triés). */
  cle: string;
  x: number;
  y: number;
  lineups: Lineup[];
}

/**
 * Regroupe les lineups dont le point d'arrivée est proche (distance ≤ `rayon`, en unités du repère) : un seul pin
 * avec leur nombre. Glouton et stable (ordre des identifiants) : le même jeu de lineups donne les mêmes groupes.
 */
export function grouperPins(lineups: readonly Lineup[], rayon: number): GroupePins[] {
  const poses = lineups.filter(l => l.arrivee).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const groupes: Array<{ x: number; y: number; lineups: Lineup[] }> = [];
  for (const l of poses) {
    const p = l.arrivee as PointCarte;
    const g = groupes.find(x => Math.hypot(x.x - p.x, x.y - p.y) <= rayon);
    if (g) {
      // Centre du groupe : moyenne de ses points.
      g.x = (g.x * g.lineups.length + p.x) / (g.lineups.length + 1);
      g.y = (g.y * g.lineups.length + p.y) / (g.lineups.length + 1);
      g.lineups.push(l);
    } else groupes.push({ x: p.x, y: p.y, lineups: [l] });
  }
  return groupes.map(g => ({ cle: g.lineups.map(l => l.id).join('+'), x: Math.round(g.x), y: Math.round(g.y), lineups: g.lineups }));
}

/** Rayon de regroupement (unités du repère) pour un pin de `taillePin` pixels sur une carte de `largeur` pixels. */
export const rayonRegroupement = (largeur: number, taillePin = 36): number => (largeur > 0 ? Math.round((taillePin * 0.85 * REPERE) / largeur) : 60);

// ------------------------------------------------------------------ Trajectoire

/**
 * Point de contrôle de l'arc entre le départ et l'arrivée (courbe de Bézier quadratique) : au milieu, décalé
 * perpendiculairement d'une fraction de la distance (toujours du même côté : le haut de la carte, pour deux points à
 * la même hauteur).
 */
export function controleArc(a: PointCarte, b: PointCarte, courbure = 0.22): PointCarte {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Normale tournée vers le haut (y décroissant) ; verticale pure : vers la droite.
  let nx = dy;
  let ny = -dx;
  if (ny > 0 || (ny === 0 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  return { x: mx + nx * courbure, y: my + ny * courbure };
}

/** Points régulièrement espacés le long de l'arc (repli sans SVG : une suite de points). */
export function pointsArc(a: PointCarte, b: PointCarte, n = 14, courbure = 0.22): PointCarte[] {
  const c = controleArc(a, b, courbure);
  const sortie: PointCarte[] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const u = 1 - t;
    sortie.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y });
  }
  return sortie;
}

/** Chemin SVG de l'arc, dans le repère de 1000. */
export function cheminArc(a: PointCarte, b: PointCarte, courbure = 0.22): string {
  const c = controleArc(a, b, courbure);
  const r = (n: number) => Math.round(n * 10) / 10;
  return `M ${r(a.x)} ${r(a.y)} Q ${r(c.x)} ${r(c.y)} ${r(b.x)} ${r(b.y)}`;
}

/** Point d'un toucher sur la carte : position dans la boîte (pixels) → repère de 1000, borné. */
export function pointDepuisToucher(x: number, y: number, largeur: number, hauteur: number): PointCarte | null {
  if (!(largeur > 0) || !(hauteur > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const borne = (n: number) => Math.max(0, Math.min(REPERE, Math.round(n)));
  return { x: borne((x / largeur) * REPERE), y: borne((y / hauteur) * REPERE) };
}

/** Centre d'un callout (polygone à plat : x1, y1, x2, y2…). */
export function centreZone(points: readonly number[]): PointCarte | null {
  const n = Math.floor(points.length / 2);
  if (n === 0) return null;
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    x += points[i * 2];
    y += points[i * 2 + 1];
  }
  return { x: x / n, y: y / n };
}
