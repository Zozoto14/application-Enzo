/**
 * Visuels CM : dimensions d'une image (PNG, JPEG, GIF, WebP) lues dans ses premiers octets, sans la décoder.
 * Pur, testé sous Node. Sert à refuser une image trop grande à importer (le canevas du navigateur a ses
 * limites) et à vérifier qu'un rendu envoyé a EXACTEMENT la taille du format (1080×1350…).
 */

export const COTE_MAX_IMAGE = 8192;
export const PIXELS_MAX_IMAGE = 40_000_000;
export const TAILLE_MAX_IMAGE = 15 * 1024 * 1024;
export const TAILLE_MAX_RENDU = 25 * 1024 * 1024;
/** Octets lus au début du fichier pour trouver ses dimensions (un JPEG peut avoir de longues métadonnées). */
export const OCTETS_ENTETE = 256 * 1024;

const u16be = (o, i) => (o[i] << 8) | o[i + 1];
const u16le = (o, i) => o[i] | (o[i + 1] << 8);
const u24le = (o, i) => o[i] | (o[i + 1] << 8) | (o[i + 2] << 16);
const u32be = (o, i) => ((o[i] << 24) >>> 0) + ((o[i + 1] << 16) | (o[i + 2] << 8) | o[i + 3]);
const ascii = (o, i, n) => String.fromCharCode(...o.subarray(i, i + n));

/** `{ format, largeur, hauteur }` ou null (format inconnu, en-tête tronqué). */
export function dimensionsImage(octets) {
  const o = octets instanceof Uint8Array ? octets : new Uint8Array(octets ?? []);
  if (o.length >= 24 && o[0] === 0x89 && ascii(o, 1, 3) === 'PNG' && ascii(o, 12, 4) === 'IHDR') return { format: 'png', largeur: u32be(o, 16), hauteur: u32be(o, 20) };
  if (o.length >= 10 && ascii(o, 0, 3) === 'GIF') return { format: 'gif', largeur: u16le(o, 6), hauteur: u16le(o, 8) };
  if (o.length >= 30 && ascii(o, 0, 4) === 'RIFF' && ascii(o, 8, 4) === 'WEBP') {
    const morceau = ascii(o, 12, 4);
    if (morceau === 'VP8X') return { format: 'webp', largeur: u24le(o, 24) + 1, hauteur: u24le(o, 27) + 1 };
    if (morceau === 'VP8L' && o.length >= 25) {
      const b = o.subarray(21, 25);
      return { format: 'webp', largeur: 1 + (((b[1] & 0x3f) << 8) | b[0]), hauteur: 1 + (((b[3] & 0xf) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) };
    }
    if (morceau === 'VP8 ' && o.length >= 30) return { format: 'webp', largeur: u16le(o, 26) & 0x3fff, hauteur: u16le(o, 28) & 0x3fff };
    return null;
  }
  if (o.length >= 4 && o[0] === 0xff && o[1] === 0xd8) {
    let i = 2;
    while (i + 9 < o.length) {
      if (o[i] !== 0xff) {
        i++;
        continue;
      }
      const marque = o[i + 1];
      if (marque === 0xd8 || marque === 0x01 || (marque >= 0xd0 && marque <= 0xd7)) {
        i += 2;
        continue;
      }
      if (marque === 0xff) {
        i++;
        continue;
      }
      const longueur = u16be(o, i + 2);
      // SOF0 à SOF15 (sauf DHT, JPG, DAC) : hauteur puis largeur.
      if (marque >= 0xc0 && marque <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marque)) return { format: 'jpeg', largeur: u16be(o, i + 7), hauteur: u16be(o, i + 5) };
      if (longueur < 2) return null;
      i += 2 + longueur;
    }
    return null;
  }
  return null;
}

/** L'image est-elle utilisable dans le canevas (côtés et nombre de pixels bornés) ? */
export const dimensionsAcceptables = d => Boolean(d && d.largeur > 0 && d.hauteur > 0 && d.largeur <= COTE_MAX_IMAGE && d.hauteur <= COTE_MAX_IMAGE && d.largeur * d.hauteur <= PIXELS_MAX_IMAGE);
