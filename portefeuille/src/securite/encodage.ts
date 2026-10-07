/* eslint-disable no-bitwise -- base32 se definit en groupes de 5 bits, la manipulation binaire est le sujet. */
/**
 * Encodages utilisés par la couche de sécurité.
 *
 * Deux alphabets base32 cohabitent, et ils ne sont pas interchangeables :
 *  - RFC 4648 pour les secrets TOTP, parce que c'est celui qu'attendent Google
 *    Authenticator et tous les autres clients ;
 *  - Crockford pour les codes de récupération, parce qu'il retire I, L, O et U
 *    de l'alphabet et tolère les confusions de lecture. Ces codes-là sont
 *    recopiés à la main depuis une feuille de papier, souvent des mois plus
 *    tard : un « 0 » lu « O » ne doit pas condamner l'accès aux données.
 */

export const ALPHABET_RFC4648 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const ALPHABET_CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export class ErreurEncodage extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurEncodage';
  }
}

function encoderBase32(octets: Uint8Array, alphabet: string): string {
  let bits = 0;
  let accumulateur = 0;
  let sortie = '';

  for (const octet of octets) {
    accumulateur = (accumulateur << 8) | octet;
    bits += 8;
    while (bits >= 5) {
      sortie += alphabet[(accumulateur >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    sortie += alphabet[(accumulateur << (5 - bits)) & 31];
  }
  return sortie;
}

function decoderBase32(texte: string, alphabet: string): Uint8Array {
  let bits = 0;
  let accumulateur = 0;
  const sortie: number[] = [];

  for (const caractere of texte) {
    const valeur = alphabet.indexOf(caractere);
    if (valeur === -1) {
      throw new ErreurEncodage(`Caractère invalide : "${caractere}"`);
    }
    accumulateur = (accumulateur << 5) | valeur;
    bits += 5;
    if (bits >= 8) {
      sortie.push((accumulateur >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(sortie);
}

/** Encode un secret TOTP tel que l'attendent les applications d'authentification. */
export function versBase32(octets: Uint8Array): string {
  return encoderBase32(octets, ALPHABET_RFC4648);
}

/** Lit un secret TOTP, en tolérant minuscules, espaces et remplissage « = ». */
export function depuisBase32(texte: string): Uint8Array {
  const nettoye = texte.toUpperCase().replace(/[\s=-]/g, '');
  return decoderBase32(nettoye, ALPHABET_RFC4648);
}

export function versCrockford(octets: Uint8Array): string {
  return encoderBase32(octets, ALPHABET_CROCKFORD);
}

/**
 * Normalise un code recopié à la main : casse, séparateurs et confusions
 * usuelles de lecture (I et L valent 1, O vaut 0, U vaut V).
 */
export function normaliserCrockford(texte: string): string {
  return texte
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
}

export function depuisCrockford(texte: string): Uint8Array {
  return decoderBase32(normaliserCrockford(texte), ALPHABET_CROCKFORD);
}

/**
 * Comparaison à temps constant.
 * Une comparaison ordinaire s'arrête au premier caractère différent, ce qui
 * laisse fuir, par le temps de réponse, le nombre de caractères corrects.
 */
export function egaliteConstante(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}
