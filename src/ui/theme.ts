/**
 * Jetons de style.
 *
 * Regroupés ici pour que les couleurs et les espacements ne soient pas
 * réinventés écran par écran.
 *
 * L'application est sombre, quel que soit le thème du système : fond noir,
 * cartes à peine plus claires, bleu pour l'action — la présentation des
 * outils de suivi que l'utilisateur a pris pour modèle. La palette claire
 * reste définie pour les tests et un éventuel retour en arrière.
 *
 * Le vert et le rouge ne portent jamais seuls l'information : chaque montant
 * signé affiche aussi son signe. Environ un homme sur douze distingue mal ces
 * deux couleurs.
 */

import { StyleSheet } from 'react-native';

export interface Palette {
  fond: string;
  surface: string;
  /** Surface d'un élément posé sur une carte : champ, ligne survolée. */
  surfaceHaute: string;
  bordure: string;
  texte: string;
  texteSecondaire: string;
  /** Bleu des liens, onglets et courbes : lisible sur le fond. */
  accent: string;
  /** Bleu des boutons pleins : porte un texte blanc lisible. */
  accentPlein: string;
  /** Fond teinté d'une pastille bleue. */
  accentFond: string;
  hausse: string;
  baisse: string;
  /** Fonds teintés des pastilles de variation. */
  hausseFond: string;
  baisseFond: string;
  danger: string;
  surAccent: string;
  /** Seconde série d'un graphique : l'indice de référence. */
  reference: string;
  /** Couleurs des séries et des parts, dans l'ordre d'attribution. */
  series: readonly string[];
}

/**
 * Couleurs de séries, distinctes aussi en luminosité : bleu, jaune, orange,
 * vert, violet, rose, turquoise, gris. Le bleu et l'orange ouvrent la liste,
 * le couple le mieux distingué par tous les yeux.
 */
const SERIES = [
  '#4d8cf5',
  '#f5c542',
  '#f08a3c',
  '#3fbf7f',
  '#a78bfa',
  '#f472b6',
  '#2dd4bf',
  '#9ca3af',
] as const;

export const PALETTE_CLAIRE: Palette = {
  fond: '#f5f6f8',
  surface: '#ffffff',
  surfaceHaute: '#f0f2f5',
  bordure: '#e2e5ea',
  texte: '#14181f',
  texteSecondaire: '#616b7a',
  accent: '#2f5bd8',
  accentPlein: '#2f5bd8',
  accentFond: 'rgba(47, 91, 216, 0.12)',
  hausse: '#0f7b44',
  baisse: '#c0392b',
  hausseFond: 'rgba(15, 123, 68, 0.12)',
  baisseFond: 'rgba(192, 57, 43, 0.12)',
  danger: '#c0392b',
  surAccent: '#ffffff',
  reference: '#b7791f',
  series: SERIES,
};

export const PALETTE_SOMBRE: Palette = {
  fond: '#000000',
  surface: '#0f0f10',
  surfaceHaute: '#1a1a1c',
  bordure: '#252528',
  texte: '#f4f4f5',
  texteSecondaire: '#a1a1aa',
  accent: '#4d8cf5',
  accentPlein: '#2563eb',
  accentFond: 'rgba(77, 140, 245, 0.16)',
  hausse: '#34c77b',
  baisse: '#f05252',
  hausseFond: 'rgba(52, 199, 123, 0.14)',
  baisseFond: 'rgba(240, 82, 82, 0.14)',
  danger: '#f05252',
  surAccent: '#ffffff',
  reference: '#f5c542',
  series: SERIES,
};

export const ESPACEMENT = {
  xs: 4,
  s: 8,
  m: 16,
  l: 24,
  xl: 32,
} as const;

export const RAYON = { s: 8, m: 12, l: 20 } as const;

/**
 * Palette de l'application.
 *
 * Le paramètre est conservé pour les appelants existants, mais ignoré : le
 * thème est sombre partout, y compris quand le système est en clair.
 */
export function palettePour(_sombre?: boolean): Palette {
  return PALETTE_SOMBRE;
}

/** Couleur d'une variation, choisie à partir de sa tendance. */
export function couleurTendance(
  palette: Palette,
  tendance: 'hausse' | 'baisse' | 'neutre',
): string {
  if (tendance === 'hausse') return palette.hausse;
  if (tendance === 'baisse') return palette.baisse;
  return palette.texteSecondaire;
}

export const stylesPartages = StyleSheet.create({
  ecran: {
    flex: 1,
  },
  contenu: {
    padding: ESPACEMENT.m,
    gap: ESPACEMENT.m,
  },
  /** Écrans d'accueil (déverrouillage, premier lancement) : étroits et centrés. */
  accueil: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    flexGrow: 1,
    justifyContent: 'center',
  },
  /** Colonne d'un formulaire : lisible sur grand écran, pleine largeur sur téléphone. */
  formulaire: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
