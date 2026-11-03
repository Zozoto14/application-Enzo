/**
 * Fonds de tableau prédéfinis de la section CM (migration 0042) : mêmes clés que le serveur
 * (esport/noyau/cm/tableaux.mjs, FONDS_COULEURS et FONDS_DEGRADES). Seule la clé est enregistrée.
 *
 * Lisibilité : quel que soit le fond (et le thème clair ou sombre), un voile sombre le recouvre et les colonnes
 * gardent une surface presque opaque (voir `Tableau.tsx`).
 */

import { Platform } from 'react-native';
import type { FondTableau } from './api';

export const FONDS_COULEURS = { bleu: '#0c66e4', vert: '#1f845a', orange: '#c25100', rouge: '#c9372c', violet: '#6e5dc6', rose: '#ae4787', ciel: '#227d9b', gris: '#626f86' } as const;
export const FONDS_DEGRADES = {
  aurore: ['#0c66e4', '#c9372c'],
  ocean: ['#0b3d91', '#22a6b3'],
  foret: ['#14532d', '#65a30d'],
  crepuscule: ['#4c1d95', '#f97316'],
  neon: ['#be185d', '#7c3aed'],
  nuit: ['#0f172a', '#334155'],
} as const;
export type CleCouleurFond = keyof typeof FONDS_COULEURS;
export type CleDegradeFond = keyof typeof FONDS_DEGRADES;

/** Couleur dominante d'un fond prédéfini (repli quand le dégradé n'est pas dessinable). */
export function couleurFond(fond: FondTableau | null | undefined): string | null {
  if (!fond) return null;
  if (fond.genre === 'couleur') return FONDS_COULEURS[fond.cle as CleCouleurFond] ?? null;
  if (fond.genre === 'degrade') return FONDS_DEGRADES[fond.cle as CleDegradeFond]?.[0] ?? null;
  return '#1d2125';
}

/** Dégradé CSS d'un fond prédéfini, ou null. */
export function degradeCss(fond: FondTableau | null | undefined): string | null {
  if (fond?.genre !== 'degrade') return null;
  const d = FONDS_DEGRADES[fond.cle as CleDegradeFond];
  return d ? `linear-gradient(135deg, ${d[0]} 0%, ${d[1]} 100%)` : null;
}

/** Style d'arrière-plan d'un fond prédéfini : couleur, et dégradé (web : CSS ; iOS / Android : `experimental_backgroundImage`). */
export function styleFond(fond: FondTableau | null | undefined): Record<string, unknown> {
  const couleur = couleurFond(fond);
  if (!couleur) return {};
  const degrade = degradeCss(fond);
  if (!degrade) return { backgroundColor: couleur };
  return Platform.OS === 'web' ? { backgroundColor: couleur, backgroundImage: degrade } : { backgroundColor: couleur, experimental_backgroundImage: degrade };
}
