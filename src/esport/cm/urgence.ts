/**
 * Drapeau d'urgence des cartes CM (migration 0047) : niveaux, couleurs lisibles en thème clair comme sombre, tri,
 * filtre. Aucun drapeau (null) < faible < moyen < urgent < critique. La couleur ne porte jamais seule l'information :
 * chaque niveau a un libellé (lecteurs d'écran, infobulle, fiche).
 */

import type { CarteResume, Urgence } from './api';
import type { CleCm } from '../i18n/cm';

/** Du plus bas au plus haut (ordre des sélecteurs). */
export const NIVEAUX_URGENCE: readonly Urgence[] = ['faible', 'moyen', 'urgent', 'critique'];

export const rangUrgence = (n: Urgence | null | undefined): number => (n ? NIVEAUX_URGENCE.indexOf(n) + 1 : 0);

export const cleLibelleUrgence = (n: Urgence): CleCm => `urgence.${n}` as CleCm;

/** Couleurs du trait du drapeau (contraste AA sur les surfaces claire et sombre des thèmes). */
const COULEURS_CLAIR: Record<Urgence, string> = { faible: '#1D5FBF', moyen: '#8A5A00', urgent: '#B54708', critique: '#B3261E' };
const COULEURS_SOMBRE: Record<Urgence, string> = { faible: '#7DB1FF', moyen: '#E8B654', urgent: '#FF9A4D', critique: '#FF8A80' };

export const couleurUrgence = (n: Urgence, sombre: boolean): string => (sombre ? COULEURS_SOMBRE : COULEURS_CLAIR)[n];

/** Niveaux qui comptent dans les compteurs d'en-tête de colonne et l'Accueil CM. */
export const estAlerte = (n: Urgence | null | undefined): boolean => n === 'urgent' || n === 'critique';

/** Compteurs d'une liste de cartes (archivées exclues) : { critique, urgent }. */
export function compterUrgences(cartes: Array<Pick<CarteResume, 'urgence' | 'archive'>>): { critique: number; urgent: number } {
  const r = { critique: 0, urgent: 0 };
  for (const c of cartes) if (!c.archive && estAlerte(c.urgence)) r[c.urgence as 'critique' | 'urgent']++;
  return r;
}

/** Tri d'une colonne par urgence décroissante ; à urgence égale, l'ordre de la colonne (position) est conservé. */
export function trierParUrgence<T extends { urgence?: Urgence | null; position: number }>(cartes: T[]): T[] {
  return [...cartes].sort((a, b) => rangUrgence(b.urgence) - rangUrgence(a.urgence) || a.position - b.position);
}
