/**
 * Rendu THÉMÉ d'une image de map dans un canevas 2D (site et app PC) : le même partout où une map s'affiche
 * (éditeur de strats, export PNG, miniatures, composant `CarteJeu`).
 *
 * Silhouette (minimap à fond transparent) → plateau dessiné : l'ALPHA de l'image sert de masque ; sol teinté en
 * dégradé, reliefs d'origine en filigrane, ombre intérieure, liseré clair net, halo sombre autour. Image
 * pleine (photo) → gardée, au besoin atténuée (assombrie, désaturée, légèrement floutée).
 *
 * Uniquement des opérations du canevas 2D présentes à l'identique dans Chromium et Safari (compositions,
 * ombres, lecture des pixels) : pas de `ctx.filter` (absent de Safari). L'image doit venir d'une URL `blob:`
 * locale (cache des images) pour que la lecture des pixels soit permise.
 */

import { cadreImage } from '../strats/geometrie';
import { alpha, themeCarte, type Attenuation, type IdThemeCarte } from '../strats/plateau';
import { alphaNet, attenuer, estSilhouette } from './analyse';

export interface OptionsRenduCarte {
  theme: IdThemeCarte;
  attenuation?: Attenuation;
  /** Côté du canevas rendu (px) ; défaut : 2048 (1536 sur un écran tactile). */
  cote?: number;
  /** Dimensions de l'image déposée (profil de jeu) quand elles diffèrent de celles du fichier. */
  largeurImage?: number;
  hauteurImage?: number;
}
export interface RenduCarte {
  /** Canevas carré : le repère (1000 × 1000) de la map, fond transparent hors de la map. */
  canevas: HTMLCanvasElement;
  silhouette: boolean;
}

type Source = HTMLImageElement | HTMLCanvasElement;
const cache = new WeakMap<Source, Map<string, RenduCarte>>();
const natures = new WeakMap<Source, boolean>();

function toile(cote: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = cote;
  c.height = cote;
  const ctx = c.getContext('2d', { willReadFrequently: false }) as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return [c, ctx];
}

const dims = (s: Source) => ('naturalWidth' in s ? { l: s.naturalWidth, h: s.naturalHeight } : { l: s.width, h: s.height });

/** L'image est-elle une silhouette (fond transparent) ? Lu une fois sur un échantillon de 64 × 64. */
export function natureImage(img: Source): boolean {
  const connue = natures.get(img);
  if (connue !== undefined) return connue;
  let silhouette = false;
  try {
    const [, ctx] = toile(64);
    ctx.drawImage(img, 0, 0, 64, 64);
    silhouette = estSilhouette(ctx.getImageData(0, 0, 64, 64).data);
  } catch {
    silhouette = false; // Image « contaminée » (hors cache local) : traitée comme une photo, sans lecture des pixels.
  }
  natures.set(img, silhouette);
  return silhouette;
}

export const coteParDefaut = (): number => {
  const tactile = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return tactile ? 1536 : 2048;
};

/** Rendu thémé (mis en cache par image, thème, atténuation et taille). */
export function rendreCarte(img: Source, options: OptionsRenduCarte): RenduCarte {
  const cote = options.cote ?? coteParDefaut();
  const att = options.attenuation ?? 0;
  const cle = `${options.theme}|${att}|${cote}|${options.largeurImage ?? 0}x${options.hauteurImage ?? 0}`;
  let parImage = cache.get(img);
  if (!parImage) cache.set(img, (parImage = new Map()));
  const deja = parImage.get(cle);
  if (deja) return deja;
  const rendu = dessiner(img, options.theme, att, cote, options.largeurImage, options.hauteurImage);
  parImage.set(cle, rendu);
  return rendu;
}

function dessiner(img: Source, idTheme: IdThemeCarte, att: Attenuation, cote: number, largeurImage?: number, hauteurImage?: number): RenduCarte {
  const theme = themeCarte(idTheme);
  const d = dims(img);
  const cadre = cadreImage(largeurImage ?? d.l, hauteurImage ?? d.h);
  const k = cote / 1000;
  const place = [cadre.x * k, cadre.y * k, cadre.l * k, cadre.h * k] as const;
  const silhouette = natureImage(img);
  const [sortie, c] = toile(cote);

  if (!silhouette || idTheme === 'origine') {
    c.drawImage(img, ...place);
    if (att > 0 && !silhouette) attenuerToile(sortie, c, att, idTheme === 'clair' ? 255 : 0);
    return { canevas: sortie, silhouette };
  }

  // 1. Image d'origine à la taille du rendu, et son masque (blanc, alpha raffermi : bords nets même agrandi).
  const [origine, co] = toile(cote);
  co.drawImage(img, ...place);
  const [masque, cm] = toile(cote);
  try {
    const pixels = co.getImageData(0, 0, cote, cote);
    const p = pixels.data;
    for (let i = 0; i < p.length; i += 4) {
      p[i] = p[i + 1] = p[i + 2] = 255;
      p[i + 3] = alphaNet(p[i + 3]);
    }
    cm.putImageData(pixels, 0, 0);
  } catch {
    cm.drawImage(origine, 0, 0);
  }

  // 2. Sol : dégradé teinté, découpé par le masque ; reliefs de l'image d'origine en filigrane.
  const [sol, cs] = toile(cote);
  const degrade = cs.createLinearGradient(0, 0, cote * 0.35, cote);
  degrade.addColorStop(0, theme.solHaut);
  degrade.addColorStop(1, theme.sol);
  cs.fillStyle = degrade;
  cs.fillRect(0, 0, cote, cote);
  if (theme.detail > 0) {
    cs.globalAlpha = theme.detail;
    cs.globalCompositeOperation = idTheme === 'clair' ? 'multiply' : 'screen';
    cs.drawImage(origine, 0, 0);
    cs.globalAlpha = 1;
  }
  cs.globalCompositeOperation = 'destination-in';
  cs.drawImage(masque, 0, 0);
  cs.globalCompositeOperation = 'source-over';

  // 3. Halo sombre autour de la map, puis le sol.
  c.save();
  c.shadowColor = alpha(theme.ombre, idTheme === 'clair' ? 0.35 : 0.85);
  c.shadowBlur = cote * 0.02;
  c.shadowOffsetY = cote * 0.004;
  c.drawImage(sol, 0, 0);
  c.restore();
  c.drawImage(sol, 0, 0);

  // 4. Ombre intérieure : l'extérieur du masque projette une ombre floue, gardée seulement à l'intérieur.
  const [inverse, ci] = toile(cote);
  ci.fillStyle = '#000000';
  ci.fillRect(0, 0, cote, cote);
  ci.globalCompositeOperation = 'destination-out';
  ci.drawImage(masque, 0, 0);
  const [dedans, cd] = toile(cote);
  cd.shadowColor = alpha(theme.ombre, idTheme === 'clair' ? 0.3 : 0.6);
  cd.shadowBlur = cote * 0.016;
  cd.drawImage(inverse, 0, 0);
  cd.shadowColor = 'transparent';
  cd.shadowBlur = 0;
  cd.globalCompositeOperation = 'destination-in';
  cd.drawImage(masque, 0, 0);
  c.drawImage(dedans, 0, 0);

  // 5. Liseré net : masque dilaté (décalé en couronne) moins le masque, teinté.
  const r = Math.max(1.25, cote * (idTheme === 'contraste' ? 0.0026 : 0.0016));
  const [bord, cb] = toile(cote);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    cb.drawImage(masque, Math.cos(a) * r, Math.sin(a) * r);
  }
  cb.globalCompositeOperation = 'destination-out';
  cb.drawImage(masque, 0, 0);
  cb.globalCompositeOperation = 'source-in';
  cb.fillStyle = theme.contour;
  cb.fillRect(0, 0, cote, cote);
  c.globalAlpha = idTheme === 'contraste' ? 1 : 0.9;
  c.drawImage(bord, 0, 0);
  c.globalAlpha = 1;
  return { canevas: sortie, silhouette };
}

/** Photo atténuée : désaturée et rapprochée du fond ; niveau 2 : mêlée à une copie floue (réduite puis agrandie). */
function attenuerToile(canevas: HTMLCanvasElement, c: CanvasRenderingContext2D, att: Attenuation, vers: number): void {
  const cote = canevas.width;
  if (att >= 2) {
    const petit = Math.max(64, Math.round(cote / 6));
    const [reduit, cr] = toile(petit);
    cr.drawImage(canevas, 0, 0, petit, petit);
    c.globalAlpha = 0.72;
    c.drawImage(reduit, 0, 0, cote, cote);
    c.globalAlpha = 1;
  }
  try {
    const pixels = c.getImageData(0, 0, cote, cote);
    const p = pixels.data;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] === 0) continue;
      const [r, g, b] = attenuer(p[i], p[i + 1], p[i + 2], att >= 2 ? 0.7 : 0.55, att >= 2 ? 0.5 : 0.38, vers);
      p[i] = r;
      p[i + 1] = g;
      p[i + 2] = b;
    }
    c.putImageData(pixels, 0, 0);
  } catch {
    // Lecture des pixels refusée : un voile uni fait l'essentiel.
    c.fillStyle = vers ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.42)';
    c.fillRect(0, 0, cote, cote);
  }
}
