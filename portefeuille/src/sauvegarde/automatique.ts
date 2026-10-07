/**
 * Sauvegarde automatique : une archive chiffrée par semaine, sans y penser.
 *
 * Elle part à l'ouverture de l'application quand la dernière a plus de sept
 * jours, et seules les huit plus récentes sont gardées : deux mois de recul,
 * sans remplir le disque. Les sauvegardes faites à la main ne sont jamais
 * supprimées.
 */

import type { SauvegardeSurDisque } from './fichiers';

export const SUFFIXE_AUTO = 'auto';
export const INTERVALLE_AUTO_JOURS = 7;
export const SAUVEGARDES_AUTO_GARDEES = 8;

function jours(debut: string, fin: string): number {
  return Math.floor((Date.parse(`${fin.slice(0, 10)}T00:00:00Z`) - Date.parse(`${debut.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

/** Une sauvegarde est-elle due aujourd'hui ? */
export function sauvegardeDue(
  derniere: string | undefined,
  aujourdhui: string,
  intervalle = INTERVALLE_AUTO_JOURS,
): boolean {
  return !derniere || jours(derniere, aujourdhui) >= intervalle;
}

/** Jours avant la prochaine sauvegarde automatique. */
export function joursAvantProchaine(derniere: string | undefined, aujourdhui: string): number {
  return derniere ? Math.max(0, INTERVALLE_AUTO_JOURS - jours(derniere, aujourdhui)) : 0;
}

export function estAutomatique(sauvegarde: Pick<SauvegardeSurDisque, 'nom'>): boolean {
  return sauvegarde.nom.includes(`-${SUFFIXE_AUTO}.`);
}

/** Sauvegardes automatiques en trop, les plus anciennes. */
export function aElaguer(
  sauvegardes: readonly SauvegardeSurDisque[],
  garder = SAUVEGARDES_AUTO_GARDEES,
): SauvegardeSurDisque[] {
  return sauvegardes
    .filter(estAutomatique)
    .sort((a, b) => b.nom.localeCompare(a.nom))
    .slice(garder);
}
