/**
 * Identité visuelle de Tsuzuku : le thème UNIQUE du hub (fond, surfaces, textes),
 * décliné par l'accent et la forme selon le mode.
 *
 *  - Animés : vif. L'accent est la teinte « anime » du thème du hub, angles arrondis.
 *  - Films : cinéma sobre. Accent doré discret, angles nets, titres à empattement.
 */

import { teinteTransparente, type ThemeHub } from '../../hub/themes';

export type Mode = 'anime' | 'movie';

export const LIBELLE_MODE: Record<Mode, string> = { anime: 'Animés', movie: 'Films' };

/** Luminance relative WCAG d'une couleur « #RRGGBB ». */
export function luminance(hexa: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hexa);
  if (!m) {
    return 0;
  }
  const canal = (i: number) => {
    const v = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
}

export function contraste(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Texte lisible posé sur `fond` : le plus contrasté du noir et du blanc. */
export function texteSur(fond: string): string {
  return contraste(fond, '#0B0F17') >= contraste(fond, '#FFFFFF') ? '#0B0F17' : '#FFFFFF';
}

export function themeDuMode(theme: ThemeHub, mode: Mode): ThemeHub {
  if (mode === 'anime') {
    const accent = theme.teintes.anime;
    return { ...theme, accent, surAccent: texteSur(accent) };
  }
  const accent = theme.sombre ? '#C9AA6B' : '#7A5A1E';
  return {
    ...theme,
    accent,
    surAccent: texteSur(accent),
    rayonMoyen: 3,
    rayonGrand: 6,
    poidsTitre: '500',
    policeTitre: 'Fraunces, Georgia, "Times New Roman", serif',
    majuscules: false,
  };
}

export const voile = teinteTransparente;
