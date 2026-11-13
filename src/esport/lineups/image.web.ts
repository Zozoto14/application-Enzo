/**
 * Allègement d'une capture d'écran avant l'envoi (site et app PC) : une image de plus de 1,2 Mo ou de plus de
 * 1920 px de large est réduite (1920 px au plus) et réencodée en JPEG : la grille des lineups reste rapide, même sur
 * téléphone. Un GIF (animé) et une petite image partent tels quels ; en cas d'échec, l'original part.
 */

import { depuisFile, type FichierNavigateur } from '../medias/choixFichier';

const LARGEUR_MAX = 1920;
const SEUIL_OCTETS = 1.2 * 1024 * 1024;

export async function allegerImage(f: FichierNavigateur): Promise<FichierNavigateur> {
  const fichier = f.fichier as File;
  if (!/^image\/(png|jpeg|webp)$/.test(fichier.type)) return f;
  try {
    const image = await createImageBitmap(fichier);
    if (fichier.size <= SEUIL_OCTETS && image.width <= LARGEUR_MAX) {
      image.close();
      return f;
    }
    const k = Math.min(1, LARGEUR_MAX / image.width);
    const toile = document.createElement('canvas');
    toile.width = Math.round(image.width * k);
    toile.height = Math.round(image.height * k);
    const ctx = toile.getContext('2d');
    if (!ctx) return f;
    ctx.drawImage(image, 0, 0, toile.width, toile.height);
    image.close();
    const blob = await new Promise<Blob | null>(ok => toile.toBlob(ok, 'image/jpeg', 0.86));
    if (!blob || blob.size >= fichier.size) return f;
    return depuisFile(new File([blob], fichier.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', { type: 'image/jpeg', lastModified: fichier.lastModified }));
  } catch {
    return f;
  }
}
