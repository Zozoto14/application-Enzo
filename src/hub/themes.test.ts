/**
 * Contrastes des 8 thèmes : l'accent (liens, onglet actif, « ‹ Accueil ») et le texte atténué
 * s'écrivent en texte courant sur le fond et sur les cartes ; ils doivent rester lisibles
 * (WCAG AA : 4,5:1), et le texte posé sur un bouton plein aussi.
 */

import { THEMES_HUB } from './themes';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe.each(THEMES_HUB.map(t => [t.id, t] as const))('thème %s', (_id, theme) => {
  it('accent lisible en texte sur le fond et sur les cartes', () => {
    expect(contraste(theme.accent, theme.fond)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(theme.accent, theme.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('texte atténué lisible sur le fond et sur les cartes', () => {
    expect(contraste(theme.attenue, theme.fond)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(theme.attenue, theme.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('texte d’un bouton plein lisible', () => {
    expect(contraste(theme.surAccent, theme.accent)).toBeGreaterThanOrEqual(4.5);
  });
});
