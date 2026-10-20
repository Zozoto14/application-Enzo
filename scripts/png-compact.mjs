/**
 * Compression des captures PNG, sans dépendance : décode un PNG 8 bits
 * (RVB ou RVBA, non entrelacé, ce que rend Chromium), réduit à une palette de
 * 256 couleurs (popularité sur 15 bits, puis couleur la plus proche) et
 * réécrit un PNG indexé. Les captures d'interface (aplats, texte) y perdent
 * peu et pèsent 3 à 5 fois moins.
 *
 *   import { compacterPng } from './png-compact.mjs';
 *   writeFileSync('x.png', compacterPng(await page.screenshot()));
 */

import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(octets) {
  let c = 0xffffffff;
  for (const o of octets) c = TABLE_CRC[(c ^ o) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function morceau(type, donnees) {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(donnees.length);
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), donnees]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corps));
  return Buffer.concat([longueur, corps, crc]);
}

/** Décode un PNG 8 bits RVB/RVBA non entrelacé : { largeur, hauteur, rvba }. */
export function decoderPng(png) {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error('pas un PNG');
  let i = 8;
  let largeur = 0;
  let hauteur = 0;
  let typeCouleur = 0;
  const idat = [];
  while (i < png.length) {
    const longueur = png.readUInt32BE(i);
    const type = png.toString('ascii', i + 4, i + 8);
    const donnees = png.subarray(i + 8, i + 8 + longueur);
    if (type === 'IHDR') {
      largeur = donnees.readUInt32BE(0);
      hauteur = donnees.readUInt32BE(4);
      if (donnees[8] !== 8 || donnees[12] !== 0) throw new Error('PNG non pris en charge');
      typeCouleur = donnees[9];
    } else if (type === 'IDAT') idat.push(donnees);
    else if (type === 'IEND') break;
    i += 12 + longueur;
  }
  const canaux = typeCouleur === 6 ? 4 : typeCouleur === 2 ? 3 : 0;
  if (!canaux) throw new Error('PNG non pris en charge (couleur)');
  const brut = inflateSync(Buffer.concat(idat));
  const pas = largeur * canaux;
  const lignes = Buffer.alloc(pas * hauteur);
  for (let y = 0; y < hauteur; y++) {
    const filtre = brut[y * (pas + 1)];
    const src = brut.subarray(y * (pas + 1) + 1, (y + 1) * (pas + 1));
    const dst = lignes.subarray(y * pas, (y + 1) * pas);
    const prec = y > 0 ? lignes.subarray((y - 1) * pas, y * pas) : null;
    for (let x = 0; x < pas; x++) {
      const a = x >= canaux ? dst[x - canaux] : 0;
      const b = prec ? prec[x] : 0;
      const c = prec && x >= canaux ? prec[x - canaux] : 0;
      let v = src[x];
      if (filtre === 1) v += a;
      else if (filtre === 2) v += b;
      else if (filtre === 3) v += (a + b) >> 1;
      else if (filtre === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      dst[x] = v & 255;
    }
  }
  const rvba = Buffer.alloc(largeur * hauteur * 4);
  for (let p = 0; p < largeur * hauteur; p++) {
    rvba[p * 4] = lignes[p * canaux];
    rvba[p * 4 + 1] = lignes[p * canaux + 1];
    rvba[p * 4 + 2] = lignes[p * canaux + 2];
    rvba[p * 4 + 3] = canaux === 4 ? lignes[p * canaux + 3] : 255;
  }
  return { largeur, hauteur, rvba };
}

/** PNG indexé (≤ 256 couleurs, opaque) depuis des pixels RVBA. */
export function encoderPngIndexe({ largeur, hauteur, rvba }) {
  const n = largeur * hauteur;
  const cle = p => ((rvba[p * 4] >> 3) << 10) | ((rvba[p * 4 + 1] >> 3) << 5) | (rvba[p * 4 + 2] >> 3);
  const comptes = new Uint32Array(32768);
  const sommes = new Float64Array(32768 * 3);
  for (let p = 0; p < n; p++) {
    const k = cle(p);
    comptes[k]++;
    sommes[k * 3] += rvba[p * 4];
    sommes[k * 3 + 1] += rvba[p * 4 + 1];
    sommes[k * 3 + 2] += rvba[p * 4 + 2];
  }
  const presentes = [];
  for (let k = 0; k < 32768; k++) if (comptes[k]) presentes.push(k);
  presentes.sort((a, b) => comptes[b] - comptes[a]);
  const choisies = presentes.slice(0, 256);
  const palette = choisies.map(k => [0, 1, 2].map(c => Math.round(sommes[k * 3 + c] / comptes[k])));
  const index = new Int16Array(32768).fill(-1);
  choisies.forEach((k, i) => (index[k] = i));
  const plusProche = k => {
    if (index[k] >= 0) return index[k];
    const r = sommes[k * 3] / comptes[k];
    const g = sommes[k * 3 + 1] / comptes[k];
    const b = sommes[k * 3 + 2] / comptes[k];
    let meilleur = 0;
    let distance = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const [pr, pg, pb] = palette[i];
      const d = (pr - r) ** 2 * 0.3 + (pg - g) ** 2 * 0.59 + (pb - b) ** 2 * 0.11;
      if (d < distance) {
        distance = d;
        meilleur = i;
      }
    }
    index[k] = meilleur;
    return meilleur;
  };
  const lignes = Buffer.alloc((largeur + 1) * hauteur);
  for (let y = 0; y < hauteur; y++) {
    lignes[y * (largeur + 1)] = 0;
    for (let x = 0; x < largeur; x++) lignes[y * (largeur + 1) + 1 + x] = plusProche(cle(y * largeur + x));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0);
  ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  const plte = Buffer.from(palette.flat());
  return Buffer.concat([SIGNATURE, morceau('IHDR', ihdr), morceau('PLTE', plte), morceau('IDAT', deflateSync(lignes, { level: 9 })), morceau('IEND', Buffer.alloc(0))]);
}

export const compacterPng = png => encoderPngIndexe(decoderPng(png));
