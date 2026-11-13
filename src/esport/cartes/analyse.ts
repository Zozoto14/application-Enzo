/**
 * Nature d'une image de map (pure, testée) : une « silhouette » (minimap de Valorant : formes claires sur fond
 * TRANSPARENT) se rend comme un plateau dessiné (sol teinté, liseré, ombre intérieure) ; une image pleine (vue
 * de dessus de type photo, The Finals) se garde telle quelle, au besoin atténuée.
 */

/** Part de pixels transparents au-delà de laquelle une image est une silhouette. */
export const SEUIL_SILHOUETTE = 0.12;

/** Part (0 à 1) des pixels transparents d'un échantillon RGBA (alpha < 24). */
export function partTransparente(rgba: ArrayLike<number>): number {
  const n = Math.floor(rgba.length / 4);
  if (n === 0) return 0;
  let vides = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 24) vides++;
  return vides / n;
}

export const estSilhouette = (rgba: ArrayLike<number>): boolean => partTransparente(rgba) >= SEUIL_SILHOUETTE;

/** Alpha « raffermi » d'un masque agrandi : les bords redeviennent nets (contraste autour de 50 %). */
export const alphaNet = (a: number, force = 2.4): number => Math.max(0, Math.min(255, Math.round((a - 128) * force + 128)));

/** Pixel atténué : désaturé (`gris`, 0 à 1) puis rapproché de `vers` (0 = noir, 255 = blanc) de `part`. */
export function attenuer(r: number, g: number, b: number, gris: number, part: number, vers = 0): [number, number, number] {
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  const m = (v: number) => {
    const d = v + (l - v) * gris;
    return Math.round(d + (vers - d) * part);
  };
  return [m(r), m(g), m(b)];
}
