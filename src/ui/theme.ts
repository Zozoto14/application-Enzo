/**
 * Jetons de style.
 *
 * Regroupés ici pour que les couleurs et les espacements ne soient pas
 * réinventés écran par écran. Deux palettes, choisies par le thème du système :
 * une application de patrimoine se consulte aussi le soir.
 *
 * Le vert et le rouge ne portent jamais seuls l'information : chaque montant
 * signé affiche aussi son signe. Environ un homme sur douze distingue mal ces
 * deux couleurs.
 */

import { StyleSheet } from 'react-native';

export interface Palette {
  fond: string;
  surface: string;
  bordure: string;
  texte: string;
  texteSecondaire: string;
  accent: string;
  hausse: string;
  baisse: string;
  danger: string;
  surAccent: string;
}

export const PALETTE_CLAIRE: Palette = {
  fond: '#f5f6f8',
  surface: '#ffffff',
  bordure: '#e2e5ea',
  texte: '#14181f',
  texteSecondaire: '#616b7a',
  accent: '#2f5bd8',
  hausse: '#0f7b44',
  baisse: '#c0392b',
  danger: '#c0392b',
  surAccent: '#ffffff',
};

export const PALETTE_SOMBRE: Palette = {
  fond: '#101319',
  surface: '#1a1f28',
  bordure: '#2a313d',
  texte: '#eef1f6',
  texteSecondaire: '#9aa5b4',
  accent: '#6f9bff',
  hausse: '#4ac585',
  baisse: '#ff7a6b',
  danger: '#ff7a6b',
  surAccent: '#101319',
};

export const ESPACEMENT = {
  xs: 4,
  s: 8,
  m: 16,
  l: 24,
  xl: 32,
} as const;

export const RAYON = { s: 8, m: 12, l: 20 } as const;

export function palettePour(sombre: boolean): Palette {
  return sombre ? PALETTE_SOMBRE : PALETTE_CLAIRE;
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
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
