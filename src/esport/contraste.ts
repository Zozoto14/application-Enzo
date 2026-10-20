/**
 * Contrastes (WCAG 2.1) : luminance relative, rapport de contraste, et encre
 * lisible (noire ou blanche) sur une couleur de fond arbitraire (couleur de
 * rôle, de catégorie de repère…). Pur, testé dans les 8 thèmes.
 */

/** Luminance relative d'une couleur #RRGGBB. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste entre deux couleurs (1 à 21). */
export function contraste(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Encre (noire ou blanche) la plus lisible sur `fond`. */
export function encreSur(fond: string): '#000000' | '#ffffff' {
  return contraste('#000000', fond) >= contraste('#ffffff', fond) ? '#000000' : '#ffffff';
}
