/**
 * Jetons du mode téléphone. Les couleurs, rayons et polices viennent du thème unique du hub
 * (`ThemeHub`, 8 thèmes) : ces jetons ne fixent que les mesures.
 *
 *  - espacements : multiples de 4 ;
 *  - texte : 15 px au minimum partout, 17 px pour le corps et les champs (au-dessous de 16 px,
 *    Safari agrandit la page quand un champ prend le focus) ;
 *  - contrôles : 48 px de haut, zone tactile jamais sous 44 × 44 px.
 */

import { themeHub, type ThemeHub } from '../../hub/themes';
import { themeCourant } from '../theme';

export const ESPACE = { xxs: 4, xs: 8, s: 12, m: 16, l: 20, xl: 24, xxl: 32 } as const;

/** Marge latérale des écrans. */
export const GOUTTIERE = 16;

export const TEXTE = {
  /** Légendes, aides, valeurs secondaires. Jamais moins. */
  legende: 15,
  /** Texte courant, cellules, boutons. */
  corps: 17,
  /** Champs de saisie (≥ 16 px : pas de zoom iOS). */
  champ: 17,
  /** Titre d'en-tête compact. */
  entete: 17,
  /** Titre de section dans une page. */
  section: 20,
  /** Grand titre d'écran (formulaires d'entrée). */
  titre: 28,
} as const;

/** Taille minimale de texte en mode téléphone. */
export const TEXTE_MIN = TEXTE.legende;

/** Ramène une taille de texte à 15 px au minimum en mode téléphone. */
export function tailleTexte(taille: number, mobile: boolean): number {
  return mobile ? Math.max(taille, TEXTE_MIN) : taille;
}

export const CONTROLE = {
  /** Hauteur des boutons, champs, cellules. */
  hauteur: 48,
  /** Zone tactile minimale (Apple : 44 pt). */
  cible: 44,
  /** Hauteur de l'en-tête compact (hors zone de sécurité). */
  entete: 52,
  /** Hauteur de la barre d'onglets basse (hors zone de sécurité). */
  barreBasse: 58,
} as const;

/** Rayon d'un contrôle d'après le thème (Terminal : 0 ; Sauge : pilule). */
export function rayonControle(theme: ThemeHub): number {
  return theme.id === 'sauge' ? 999 : Math.min(theme.rayonMoyen, 12);
}

/** Rayon d'une carte / feuille d'après le thème. */
export function rayonCarte(theme: ThemeHub): number {
  return Math.min(theme.rayonGrand, 20);
}

/** Thème unique courant (Paramètres › Général), pour les composants appelés sans thème. */
export function themeActif(theme?: ThemeHub): ThemeHub {
  return theme ?? themeHub(themeCourant());
}

/** Durées des transitions (ramenées à 0 si l'utilisateur réduit les animations). */
export const DUREE = { courte: 160, moyenne: 240 } as const;

/**
 * À poser (`{...EXEMPTE_TEXTE}`) sur un élément dont le texte peut rester sous 15 px : pastilles de
 * compteur uniquement. Le test de bout en bout mobile l'ignore ; l'utiliser ailleurs est une faute.
 */
export const EXEMPTE_TEXTE = { dataSet: { texteExempte: 'oui' } } as unknown as Record<string, never>;
