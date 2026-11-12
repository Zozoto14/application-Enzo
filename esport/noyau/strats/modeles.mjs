/**
 * Modèles de strat (« plans ») : chaque profil de jeu choisit le modèle de son éditeur de strats
 * (`jeux.modele_strat`, migration 0075). Fonctions PURES, miroir de src/esport/strats/modeles.ts.
 *
 *  - `valorant`  : 5v5 attaque / défense, sites, agents et capacités à l'échelle, économie du round ;
 *  - `thefinals` : 3v3v3v3, cashout et coffres, classes Light / Medium / Heavy, gadgets, destruction,
 *                  étages, équipes adverses ;
 *  - `generique` : tout autre jeu (pions, flèches, zones, textes ; nombre de joueurs du format du profil).
 *
 * Échelle : le repère d'une strat est un carré de 1000 unités. Une map calibrée dans Administration › Jeux
 * donne ses unités par mètre (`pxParMetre`) ; sans calibrage, `ECHELLE_DEFAUT` (1000 unités = 125 m).
 */

export const MODELES_STRAT = ['valorant', 'thefinals', 'generique'];
export const ECHELLE_DEFAUT = 8;
export const ECHELLE_MIN = 0.5;
export const ECHELLE_MAX = 100;

export const MODELES = {
  valorant: { joueurs: 5, joueursMax: 5, phases: ['setup', 'execute', 'post-plant', 'retake', 'mid-round'], sides: true, economie: ['pistol', 'eco', 'force', 'bonus', 'full'], modes: [] },
  // The Finals : Cashout (3v3v3v3, stations et coffres) ou Final Round (3v3 en manches, élimination).
  thefinals: { joueurs: 3, joueursMax: 3, phases: ['approche', 'prise', 'tenue', 'vol', 'troisieme', 'engagement', 'elimination', 'fin'], sides: false, economie: [], modes: ['cashout', 'final-round'] },
  generique: { joueurs: 5, joueursMax: 10, phases: ['debut', 'milieu', 'fin'], sides: true, economie: [], modes: [] },
};

/** Modèle d'un profil de jeu (colonne `modele_strat`), avec repli sur la clé historique du jeu. */
export function modeleDuJeu(modeleStrat, cleJeu) {
  if (MODELES_STRAT.includes(modeleStrat)) return modeleStrat;
  return cleJeu === 'valorant' ? 'valorant' : 'generique';
}

/** Nombre de joueurs d'une nouvelle strat : celui du modèle, ou (générique) celui du premier format du profil. */
export function joueursDuModele(modele, formats = []) {
  const m = MODELES[modele] ?? MODELES.generique;
  if (modele !== 'generique') return m.joueurs;
  const n = Number(formats?.[0]?.joueursParEquipe);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, m.joueursMax) : m.joueurs;
}

/** Échelle valide (unités du repère par mètre), sinon l'échelle par défaut. */
export function echelleEffective(e) {
  return typeof e === 'number' && Number.isFinite(e) && e >= ECHELLE_MIN && e <= ECHELLE_MAX ? e : ECHELLE_DEFAUT;
}

/** Mètres → unités du repère. */
export const metresVersUnites = (m, echelle) => m * echelleEffective(echelle);
/** Unités du repère → mètres. */
export const unitesVersMetres = (u, echelle) => u / echelleEffective(echelle);

/**
 * Calibrage : deux points du repère (x1, y1, x2, y2) et la distance réelle qui les sépare (mètres) →
 * unités par mètre, arrondies au millième ; null si les points sont confondus ou la distance absurde.
 */
export function calibrer(points, distance) {
  if (!Array.isArray(points) || points.length !== 4 || points.some(n => typeof n !== 'number' || !Number.isFinite(n))) return null;
  if (typeof distance !== 'number' || !Number.isFinite(distance) || distance <= 0) return null;
  const d = Math.hypot(points[2] - points[0], points[3] - points[1]);
  const e = Math.round((d / distance) * 1000) / 1000;
  if (d < 5 || e < ECHELLE_MIN || e > ECHELLE_MAX) return null;
  return e;
}
