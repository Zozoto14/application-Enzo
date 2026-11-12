/**
 * Modèles de strat (« plans ») choisis par le profil de jeu de la team (Administration › Jeux) : miroir de
 * esport/noyau/strats/modeles.mjs, plus ce dont l'éditeur a besoin (outils, phases, marqueurs, économie).
 *
 *  - `valorant`  : 5v5 attaque / défense, sites, agents et capacités à l'échelle, économie du round ;
 *  - `thefinals` : 3v3v3v3, cashout et coffres, classes Light / Medium / Heavy, gadgets, destruction,
 *                  étages, équipes adverses ;
 *  - `generique` : tout autre jeu.
 *
 * Échelle : le repère d'une strat est un carré de 1000 unités ; une map calibrée donne ses unités par mètre
 * (`pxParMetre`), sinon `ECHELLE_DEFAUT` (1000 unités = 125 m).
 */

export type ModeleStrat = 'valorant' | 'thefinals' | 'generique';
export const MODELES_STRAT: readonly ModeleStrat[] = ['valorant', 'thefinals', 'generique'];
export const ECHELLE_DEFAUT = 8;
export const ECHELLE_MIN = 0.5;
export const ECHELLE_MAX = 100;

export type Economie = 'pistol' | 'eco' | 'force' | 'bonus' | 'full';
export type GenreMarqueur =
  | 'objectif'
  | 'ennemi'
  | 'danger'
  | 'destruction-mur'
  | 'destruction-sol'
  | 'spawn'
  | 'plant'
  | 'defuse'
  | 'info'
  | 'rotation'
  | 'tiers'
  | 'cashout'
  | 'coffre';

export interface DefinitionModele {
  joueurs: number;
  joueursMax: number;
  phases: readonly string[];
  /** Attaque / défense (Valorant, générique). */
  sides: boolean;
  economie: readonly Economie[];
  /** Marqueurs proposés dans la palette, dans l'ordre. */
  marqueurs: readonly GenreMarqueur[];
  /** Équipes adverses numérotées (3v3v3v3 : trois équipes en face). */
  equipesAdverses: number;
  /** Étages (tags de niveau) proposés. */
  etages: boolean;
  /** Types de strat proposés (pistol et éco n'ont pas de sens hors Valorant). */
  types: readonly ('default' | 'execute' | 'eco' | 'pistol' | 'retake' | 'other')[];
}

export const MODELES: Record<ModeleStrat, DefinitionModele> = {
  valorant: {
    joueurs: 5,
    joueursMax: 5,
    phases: ['setup', 'execute', 'post-plant', 'retake', 'mid-round'],
    sides: true,
    economie: ['pistol', 'eco', 'force', 'bonus', 'full'],
    marqueurs: ['plant', 'defuse', 'ennemi', 'danger', 'info', 'rotation', 'spawn'],
    equipesAdverses: 1,
    etages: false,
    types: ['default', 'execute', 'eco', 'pistol', 'retake', 'other'],
  },
  thefinals: {
    joueurs: 3,
    joueursMax: 3,
    phases: ['approche', 'prise', 'tenue', 'vol', 'troisieme', 'fin'],
    sides: false,
    economie: [],
    marqueurs: ['cashout', 'coffre', 'ennemi', 'destruction-mur', 'destruction-sol', 'tiers', 'danger', 'rotation', 'spawn', 'info'],
    equipesAdverses: 3,
    etages: true,
    types: ['default', 'execute', 'retake', 'other'],
  },
  generique: {
    joueurs: 5,
    joueursMax: 10,
    phases: ['debut', 'milieu', 'fin'],
    sides: true,
    economie: [],
    marqueurs: ['objectif', 'ennemi', 'danger', 'spawn', 'rotation', 'info'],
    equipesAdverses: 1,
    etages: false,
    types: ['default', 'execute', 'eco', 'pistol', 'retake', 'other'],
  },
};

/** Couleurs des équipes adverses (The Finals : trois équipes en face). */
export const COULEURS_EQUIPES = ['#f43f5e', '#f59e0b', '#14b8a6', '#8b5cf6', '#64748b'];

export function modeleDuJeu(modeleStrat: string | null | undefined, cleJeu?: string | null): ModeleStrat {
  if (modeleStrat && (MODELES_STRAT as readonly string[]).includes(modeleStrat)) return modeleStrat as ModeleStrat;
  return cleJeu === 'valorant' ? 'valorant' : 'generique';
}

export function echelleEffective(e: number | null | undefined): number {
  return typeof e === 'number' && Number.isFinite(e) && e >= ECHELLE_MIN && e <= ECHELLE_MAX ? e : ECHELLE_DEFAUT;
}

export const metresVersUnites = (m: number, echelle?: number | null): number => m * echelleEffective(echelle);
export const unitesVersMetres = (u: number, echelle?: number | null): number => u / echelleEffective(echelle);

/** Deux points du repère et la distance réelle (m) → unités par mètre (au millième) ; null si absurde. */
export function calibrer(points: readonly number[], distance: number): number | null {
  if (points.length !== 4 || points.some(n => !Number.isFinite(n)) || !Number.isFinite(distance) || distance <= 0) return null;
  const d = Math.hypot(points[2] - points[0], points[3] - points[1]);
  const e = Math.round((d / distance) * 1000) / 1000;
  return d < 5 || e < ECHELLE_MIN || e > ECHELLE_MAX ? null : e;
}
