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

/**
 * Jetons de couleur des niveaux d'urgence (`URGENCE` du design system, `urgence.critique|urgent|moyen|faible`), réutilisés
 * par la carte, l'en-tête de colonne, la fiche, l'Accueil CM et le calendrier. `trait` : bande, drapeau et texte coloré
 * (AA sur les surfaces) ; `fond` / `encre` : pastille pleine (texte AA sur son fond) ; `teinte` : part de `trait` mélangée
 * au fond de la carte (Critique et Urgent seulement ; mélange opaque, la carte reste lisible sur une image de fond).
 */
export interface JetonUrgence {
  trait: string;
  fond: string;
  encre: string;
  teinte: number;
}
export const JETONS_URGENCE: Record<Urgence, { clair: JetonUrgence; sombre: JetonUrgence }> = {
  faible: { clair: { trait: '#1D5FBF', fond: '#1D5FBF', encre: '#FFFFFF', teinte: 0 }, sombre: { trait: '#7DB1FF', fond: '#7DB1FF', encre: '#0B1220', teinte: 0 } },
  moyen: { clair: { trait: '#8A5A00', fond: '#8A5A00', encre: '#FFFFFF', teinte: 0 }, sombre: { trait: '#E8B654', fond: '#E8B654', encre: '#1A1200', teinte: 0 } },
  urgent: { clair: { trait: '#B54708', fond: '#B54708', encre: '#FFFFFF', teinte: 0.06 }, sombre: { trait: '#FF9A4D', fond: '#FF9A4D', encre: '#1F0F00', teinte: 0.07 } },
  critique: { clair: { trait: '#B3261E', fond: '#B3261E', encre: '#FFFFFF', teinte: 0.09 }, sombre: { trait: '#FF8A80', fond: '#FF8A80', encre: '#240402', teinte: 0.12 } },
};

export const jetonUrgence = (n: Urgence, sombre: boolean): JetonUrgence => JETONS_URGENCE[n][sombre ? 'sombre' : 'clair'];

/** Couleur du trait du niveau (bande, drapeau, texte). */
export const couleurUrgence = (n: Urgence, sombre: boolean): string => jetonUrgence(n, sombre).trait;

/** Nombre de barres du niveau (1 à 4) : la forme double la couleur pour le daltonisme. */
export const barresUrgence = (n: Urgence): number => NIVEAUX_URGENCE.indexOf(n) + 1;

/** Mélange opaque de `couleur` (part `t`) sur `base` (#RRGGBB) ; `base` inattendue : renvoyée telle quelle. */
export function melanger(base: string, couleur: string, t: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(base) || !/^#[0-9a-f]{6}$/i.test(couleur)) return base;
  const v = (h: string, i: number) => Number.parseInt(h.slice(i, i + 2), 16);
  const c = (i: number) => Math.round(v(base, i) * (1 - t) + v(couleur, i) * t).toString(16).padStart(2, '0');
  return `#${c(1)}${c(3)}${c(5)}`;
}

/** Fond de la carte : teinté pour Critique et Urgent, sinon la surface du thème. */
export const fondCarteUrgence = (n: Urgence | null | undefined, surface: string, sombre: boolean): string => {
  if (!n) return surface;
  const j = jetonUrgence(n, sombre);
  return j.teinte ? melanger(surface, j.trait, j.teinte) : surface;
};

/** Niveaux qui comptent dans les compteurs d'en-tête de colonne et l'Accueil CM. */
export const estAlerte = (n: Urgence | null | undefined): boolean => n === 'urgent' || n === 'critique';

/** Compteurs d'une liste de cartes (archivées et terminées exclues) : { critique, urgent }. */
export function compterUrgences(cartes: Array<Pick<CarteResume, 'urgence' | 'archive' | 'terminee'>>): { critique: number; urgent: number } {
  const r = { critique: 0, urgent: 0 };
  for (const c of cartes) if (!c.archive && !c.terminee && estAlerte(c.urgence)) r[c.urgence as 'critique' | 'urgent']++;
  return r;
}
