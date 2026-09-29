/**
 * Chiffrement des dépôts sur le relais.
 *
 * Tous les appareils doivent pouvoir ouvrir ce que les autres déposent : ils
 * dérivent donc **la même clé** du mot de passe de synchronisation, avec un
 * sel tiré du jeton du relais (commun à tous, propre à ce relais). La
 * dérivation Argon2id coûte une seconde ou deux : elle est faite une fois, à
 * la saisie du mot de passe, et seule la clé est gardée — dans la base
 * chiffrée de l'appareil. Le mot de passe, lui, n'est enregistré nulle part.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { aleatoireParDefaut, type SourceAleatoire } from '../../securite/aleatoire';
import { PARAMETRES_KDF_DEFAUT, deriverCle, type ParametresKdf } from '../../securite/kdf';
import { texteDepuisOctets } from '../../sauvegarde/archive';

export const VERSION_ENVELOPPE = 1;

export interface Enveloppe {
  format: 'applibourse-relais';
  version: number;
  appareil: string;
  date: string;
  nonce: string;
  /** Contenu chiffré, en base 64. */
  charge: string;
}

export function deriverCleSynchro(
  motDePasse: string,
  jeton: string,
  parametres: ParametresKdf = PARAMETRES_KDF_DEFAUT,
): string {
  const sel = sha256(utf8ToBytes(`applibourse-relais-v1|${jeton}`)).slice(0, 16);
  return bytesToHex(deriverCle(motDePasse, sel, parametres));
}

// ------------------------------------------------------------- Base 64

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function versBase64(octets: Uint8Array): string {
  let sortie = '';
  for (let i = 0; i < octets.length; i += 3) {
    const a = octets[i];
    const b = octets[i + 1];
    const c = octets[i + 2];
    sortie += ALPHABET[a >> 2] + ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    sortie += b === undefined ? '=' : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    sortie += c === undefined ? '=' : ALPHABET[c & 63];
  }
  return sortie;
}

export function depuisBase64(texte: string): Uint8Array {
  const propre = texte.replace(/[^A-Za-z0-9+/]/g, '');
  const octets = new Uint8Array(Math.floor((propre.length * 3) / 4));
  let tampon = 0;
  let bits = 0;
  let n = 0;
  for (const caractere of propre) {
    tampon = (tampon << 6) | ALPHABET.indexOf(caractere);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      octets[n++] = (tampon >> bits) & 0xff;
    }
  }
  return octets.slice(0, n);
}

// ---------------------------------------------------------- Enveloppes

export function sceller(
  cleHex: string,
  contenu: unknown,
  appareil: string,
  date: string,
  alea: SourceAleatoire = aleatoireParDefaut,
): Enveloppe {
  const nonce = alea(24);
  // L'appareil et la date sont liés au chiffré : les échanger le trahirait.
  const associe = utf8ToBytes(`${appareil}|${date}`);
  const chiffre = xchacha20poly1305(hexToBytes(cleHex), nonce, associe).encrypt(
    utf8ToBytes(JSON.stringify(contenu)),
  );
  return {
    format: 'applibourse-relais',
    version: VERSION_ENVELOPPE,
    appareil,
    date,
    nonce: bytesToHex(nonce),
    charge: versBase64(chiffre),
  };
}

export class ErreurEnveloppe extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurEnveloppe';
  }
}

export function ouvrirEnveloppe<T>(cleHex: string, enveloppe: Enveloppe): T {
  if (enveloppe.format !== 'applibourse-relais') {
    throw new ErreurEnveloppe('Ce dépôt n’est pas une enveloppe AppliBourse.');
  }
  if (enveloppe.version > VERSION_ENVELOPPE) {
    throw new ErreurEnveloppe('Un appareil utilise une version plus récente d’AppliBourse : mettez celui-ci à jour.');
  }
  let clair: Uint8Array;
  try {
    clair = xchacha20poly1305(
      hexToBytes(cleHex),
      hexToBytes(enveloppe.nonce),
      utf8ToBytes(`${enveloppe.appareil}|${enveloppe.date}`),
    ).decrypt(depuisBase64(enveloppe.charge));
  } catch {
    throw new ErreurEnveloppe(
      'Impossible d’ouvrir le dépôt d’un autre appareil : le mot de passe de synchronisation n’est pas le même partout.',
    );
  }
  return JSON.parse(texteDepuisOctets(clair)) as T;
}
