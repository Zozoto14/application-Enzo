/**
 * SHA-256 INCRÉMENTAL, en JavaScript pur (Workers, Node, navigateur), dont l'état se sérialise.
 *
 * Pourquoi pas WebCrypto : `crypto.subtle.digest` veut tout le fichier d'un coup, et une vidéo de
 * plusieurs gigaoctets arrive en morceaux, dans des requêtes séparées (voire des processus différents
 * chez Passenger). On garde donc l'état du calcul en base entre deux morceaux : 8 mots de 32 bits, le
 * reste (moins de 64 octets) et la longueur. Chaque morceau est en plus vérifié par WebCrypto.
 *
 * Miroir côté app : src/esport/medias/sha256.ts (même algorithme, mêmes tests de référence).
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const DEPART = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const W = new Uint32Array(64);

/** Compresse les blocs complets de 64 octets de `o` à partir de `debut` ; rend l'indice du premier octet non traité. */
function blocs(h, o, debut, fin) {
  let [a0, b0, c0, d0, e0, f0, g0, h0] = h;
  let i = debut;
  for (; i + 64 <= fin; i += 64) {
    for (let t = 0; t < 16; t++) {
      const j = i + t * 4;
      W[t] = ((o[j] << 24) | (o[j + 1] << 16) | (o[j + 2] << 8) | o[j + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t++) {
      const x = W[t - 15];
      const y = W[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    let e = e0;
    let f = f0;
    let g = g0;
    let hh = h0;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[t] + W[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
    e0 = (e0 + e) | 0;
    f0 = (f0 + f) | 0;
    g0 = (g0 + g) | 0;
    h0 = (h0 + hh) | 0;
  }
  h[0] = a0 >>> 0;
  h[1] = b0 >>> 0;
  h[2] = c0 >>> 0;
  h[3] = d0 >>> 0;
  h[4] = e0 >>> 0;
  h[5] = f0 >>> 0;
  h[6] = g0 >>> 0;
  h[7] = h0 >>> 0;
  return i;
}

/** État neuf : `{ h, reste, longueur }`. */
export function nouvelEtat() {
  return { h: [...DEPART], reste: new Uint8Array(0), longueur: 0 };
}

/** Ajoute des octets au calcul (modifie et rend l'état). */
export function ajouter(etat, octets) {
  const o = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
  etat.longueur += o.length;
  let i = 0;
  if (etat.reste.length) {
    const manque = 64 - etat.reste.length;
    if (o.length < manque) {
      const r = new Uint8Array(etat.reste.length + o.length);
      r.set(etat.reste);
      r.set(o, etat.reste.length);
      etat.reste = r;
      return etat;
    }
    const bloc = new Uint8Array(64);
    bloc.set(etat.reste);
    bloc.set(o.subarray(0, manque), etat.reste.length);
    blocs(etat.h, bloc, 0, 64);
    i = manque;
  }
  const j = blocs(etat.h, o, i, o.length);
  etat.reste = o.slice(j);
  return etat;
}

/** Empreinte finale (hexadécimal), sans modifier l'état. */
export function terminer(etat) {
  const h = [...etat.h];
  const bits = etat.longueur * 8;
  const n = etat.reste.length;
  const total = n + 9 <= 64 ? 64 : 128;
  const fin = new Uint8Array(total);
  fin.set(etat.reste);
  fin[n] = 0x80;
  const haut = Math.floor(bits / 0x100000000);
  const bas = bits >>> 0;
  fin[total - 8] = (haut >>> 24) & 0xff;
  fin[total - 7] = (haut >>> 16) & 0xff;
  fin[total - 6] = (haut >>> 8) & 0xff;
  fin[total - 5] = haut & 0xff;
  fin[total - 4] = (bas >>> 24) & 0xff;
  fin[total - 3] = (bas >>> 16) & 0xff;
  fin[total - 2] = (bas >>> 8) & 0xff;
  fin[total - 1] = bas & 0xff;
  blocs(h, fin, 0, total);
  return h.map(x => x.toString(16).padStart(8, '0')).join('');
}

const hex = o => [...o].map(x => x.toString(16).padStart(2, '0')).join('');

/** État → texte (gardé en base entre deux morceaux). */
export function exporterEtat(etat) {
  return JSON.stringify({ h: etat.h.map(x => x.toString(16).padStart(8, '0')).join(''), r: hex(etat.reste), l: etat.longueur });
}

/** Texte → état ; lève si le texte est abîmé. */
export function importerEtat(texte) {
  const o = JSON.parse(texte);
  if (typeof o?.h !== 'string' || !/^[0-9a-f]{64}$/.test(o.h) || typeof o.r !== 'string' || !/^([0-9a-f]{2}){0,63}$/.test(o.r) || !Number.isSafeInteger(o.l) || o.l < 0) {
    throw new Error('État SHA-256 illisible.');
  }
  const h = [];
  for (let i = 0; i < 8; i++) h.push(parseInt(o.h.slice(i * 8, i * 8 + 8), 16) >>> 0);
  const reste = new Uint8Array(o.r.length / 2);
  for (let i = 0; i < reste.length; i++) reste[i] = parseInt(o.r.slice(i * 2, i * 2 + 2), 16);
  return { h, reste, longueur: o.l };
}

/** Empreinte d'un tableau d'octets en une fois (pratique pour les tests). */
export function sha256Hex(octets) {
  return terminer(ajouter(nouvelEtat(), octets));
}
