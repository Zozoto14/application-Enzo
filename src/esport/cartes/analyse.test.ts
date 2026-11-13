/**
 * Nature d'une image de map : silhouette (minimap à fond transparent, redessinée en plateau) ou image pleine
 * (vue de dessus de type photo, gardée et au besoin atténuée) ; alpha raffermi ; pixel atténué.
 */

import { SEUIL_SILHOUETTE, alphaNet, attenuer, estSilhouette, partTransparente } from './analyse';

/** Échantillon RGBA de `n` pixels dont `vides` transparents. */
function echantillon(n: number, vides: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) px.set([200, 200, 200, i < vides ? 0 : 255], i * 4);
  return px;
}

describe('silhouette ou image pleine', () => {
  it('part de pixels transparents', () => {
    expect(partTransparente(echantillon(100, 0))).toBe(0);
    expect(partTransparente(echantillon(100, 40))).toBeCloseTo(0.4, 5);
    expect(partTransparente(new Uint8ClampedArray(0))).toBe(0);
    // Presque transparent (alpha < 24) compte comme vide ; au-delà non.
    expect(partTransparente([0, 0, 0, 23, 0, 0, 0, 24])).toBe(0.5);
  });

  it('minimap à fond transparent : silhouette ; vue de dessus opaque : image pleine', () => {
    expect(estSilhouette(echantillon(100, 45))).toBe(true);
    expect(estSilhouette(echantillon(100, 0))).toBe(false);
    // Coins arrondis ou léger détourage d'une photo : toujours une image pleine.
    expect(estSilhouette(echantillon(1000, Math.floor(1000 * SEUIL_SILHOUETTE) - 1))).toBe(false);
    expect(estSilhouette(echantillon(1000, Math.ceil(1000 * SEUIL_SILHOUETTE)))).toBe(true);
  });
});

describe('pixels', () => {
  it('alpha raffermi : les bords flous d’un masque agrandi redeviennent nets', () => {
    expect(alphaNet(128)).toBe(128);
    expect(alphaNet(0)).toBe(0);
    expect(alphaNet(255)).toBe(255);
    expect(alphaNet(200)).toBe(255);
    expect(alphaNet(60)).toBe(0);
    expect(alphaNet(140)).toBeGreaterThan(140);
    expect(alphaNet(116)).toBeLessThan(116);
  });

  it('atténuer : désaturer puis assombrir (ou éclaircir)', () => {
    expect(attenuer(255, 0, 0, 0, 0)).toEqual([255, 0, 0]);
    const gris = attenuer(255, 0, 0, 1, 0);
    expect(gris[0]).toBe(gris[1]);
    expect(gris[1]).toBe(gris[2]);
    const sombre = attenuer(200, 100, 50, 0.5, 0.5);
    expect(sombre[0]).toBeLessThan(200);
    expect(sombre[0]).toBeGreaterThan(sombre[2]);
    expect(attenuer(10, 20, 30, 0, 1)).toEqual([0, 0, 0]);
    expect(attenuer(10, 20, 30, 0, 1, 255)).toEqual([255, 255, 255]);
  });
});
