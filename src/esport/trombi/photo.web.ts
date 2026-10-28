/**
 * Photo du trombinoscope sur le site et l'app PC : choix d'une image (JPEG, PNG, WebP), RECADRAGE CARRÉ (centré,
 * ou calé en haut pour un portrait), réduction à 512 px et miniature de 128 px, en JPEG, dans le navigateur. Le
 * serveur revérifie tout (format reconnu aux octets, carré, côté et poids) : rien d'autre qu'une image carrée
 * bornée ne peut être enregistré, jamais une adresse externe.
 */

import { choisirFichier } from '../medias/choixFichier';
import type { PhotoEnvoyee } from './api';

export const photoDisponible = true;
export type Cadrage = 'centre' | 'haut';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const POIDS_SOURCE_MAX = 20 * 1024 * 1024;
const COTE = 512;
const COTE_MINI = 128;
/** Plafonds du serveur (esport/noyau/trombi/regles.mjs : PHOTO), avec de la marge. */
const POIDS_MAX = 380 * 1024;
const POIDS_MINI_MAX = 44 * 1024;

export class ErreurPhoto extends Error {
  constructor(public code: 'format' | 'poids' | 'lecture') {
    super(code);
  }
}

async function decoder(f: File): Promise<{ source: CanvasImageSource; largeur: number; hauteur: number; liberer(): void }> {
  if (typeof createImageBitmap === 'function') {
    const b = await createImageBitmap(f);
    return { source: b, largeur: b.width, hauteur: b.height, liberer: () => b.close() };
  }
  const url = URL.createObjectURL(f);
  const img = new Image();
  await new Promise<void>((ok, ko) => {
    img.onload = () => ok();
    img.onerror = () => ko(new ErreurPhoto('lecture'));
    img.src = url;
  });
  return { source: img, largeur: img.naturalWidth, hauteur: img.naturalHeight, liberer: () => URL.revokeObjectURL(url) };
}

function dessiner(src: { source: CanvasImageSource; largeur: number; hauteur: number }, cote: number, cadrage: Cadrage, poidsMax: number): string {
  const c = document.createElement('canvas');
  c.width = cote;
  c.height = cote;
  const ctx = c.getContext('2d');
  if (!ctx) throw new ErreurPhoto('lecture');
  const carre = Math.min(src.largeur, src.hauteur);
  const sx = (src.largeur - carre) / 2;
  const sy = cadrage === 'haut' ? 0 : (src.hauteur - carre) / 2;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cote, cote);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src.source, sx, sy, carre, carre, 0, 0, cote, cote);
  for (const q of [0.88, 0.8, 0.7, 0.6, 0.5]) {
    const url = c.toDataURL('image/jpeg', q);
    if ((url.length - 23) * 0.75 <= poidsMax) return url;
  }
  throw new ErreurPhoto('poids');
}

/** Choisit, recadre et réduit une photo ; `undefined` si l'utilisateur annule. */
export async function choisirPhoto(cadrage: Cadrage): Promise<{ envoi: PhotoEnvoyee; apercu: string } | undefined> {
  const f = await choisirFichier(TYPES.join(','), 'esport-trombi-photo-champ');
  if (!f) return undefined;
  if (!TYPES.includes(f.type)) throw new ErreurPhoto('format');
  if (f.taille > POIDS_SOURCE_MAX) throw new ErreurPhoto('poids');
  const src = await decoder(f.fichier).catch(() => {
    throw new ErreurPhoto('lecture');
  });
  try {
    if (src.largeur < 64 || src.hauteur < 64) throw new ErreurPhoto('format');
    const grande = dessiner(src, COTE, cadrage, POIDS_MAX);
    const mini = dessiner(src, COTE_MINI, cadrage, POIDS_MINI_MAX);
    const b64 = (u: string) => u.slice(u.indexOf(',') + 1);
    return { envoi: { type: 'image/jpeg', donnees: b64(grande), miniature: b64(mini) }, apercu: grande };
  } finally {
    src.liberer();
  }
}

/** Télécharge la photo (adresse « data: » de la fiche) sous le nom donné. */
export function telechargerPhoto(url: string, nom: string): boolean {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return false;
  const a = doc.createElement('a');
  a.href = url;
  a.download = nom;
  a.rel = 'noopener';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}
