/**
 * Séquestre et annuaire chiffré : les briques cryptographiques.
 *
 * Schéma complet et justification : `docs/hub/sequestre.md`. En bref :
 *
 *  - l'administrateur possède une **paire X25519 de séquestre**. La clé
 *    publique est lisible par tous (annuaire) ; la clé privée n'existe sur le
 *    disque que scellée par une clé tirée de SA clé maîtresse ;
 *  - n'importe quel profil peut **déposer** un secret pour l'administrateur
 *    (`scellerPourAdmin`, ECIES : X25519 éphémère + HKDF-SHA256 +
 *    XChaCha20-Poly1305) ; seul l'administrateur peut le rouvrir. Un ami ne
 *    remonte donc jamais vers l'administrateur : il n'a que du public ;
 *  - le **code d'accès administrateur** d'un compte ami entre dans la
 *    dérivation de la clé qui enveloppe la clé maîtresse de l'ami : sans la
 *    clé privée de séquestre ET le code, l'enveloppe ne s'ouvre pas.
 *
 * Chaque scellé est lié à un **contexte** (donnée associée) qui nomme son
 * usage et le compte concerné : une enveloppe d'un compte présentée pour un
 * autre échoue à l'authentification.
 *
 * Tout est pur : l'aléa est injectable, rien n'est stocké ici.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { aleatoireParDefaut, type SourceAleatoire } from './aleatoire';

export const VERSION_SEQUESTRE = 1;
const NONCE = 24;

export class ErreurSequestre extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurSequestre';
  }
}

function contexte(usage: string): Uint8Array {
  return utf8ToBytes(`applibourse/${usage}/v${VERSION_SEQUESTRE}`);
}

/** UTF-8 → texte sans `TextDecoder` (absent de certains moteurs embarqués). */
export function utf8DepuisOctets(octets: Uint8Array): string {
  return decodeURIComponent(Array.from(octets, octet => `%${octet.toString(16).padStart(2, '0')}`).join(''));
}

// --- Scellé symétrique lié à un contexte -------------------------------------------

/** XChaCha20-Poly1305, nonce aléatoire, contexte en donnée associée. Rend de l'hexadécimal. */
export function scellerAvecContexte(cle: Uint8Array, contenu: Uint8Array, usage: string, alea: SourceAleatoire = aleatoireParDefaut): string {
  if (cle.length !== 32) {
    throw new ErreurSequestre('Clé de scellement invalide.');
  }
  const nonce = alea(NONCE);
  const chiffre = xchacha20poly1305(cle, nonce, contexte(usage)).encrypt(contenu);
  return bytesToHex(concatBytes(nonce, chiffre));
}

export function descellerAvecContexte(cle: Uint8Array, scelle: string, usage: string): Uint8Array {
  let octets: Uint8Array;
  try {
    octets = hexToBytes(scelle);
  } catch {
    throw new ErreurSequestre('Scellé illisible.');
  }
  if (cle.length !== 32 || octets.length < NONCE + 16) {
    throw new ErreurSequestre('Scellé illisible.');
  }
  try {
    return xchacha20poly1305(cle, octets.subarray(0, NONCE), contexte(usage)).decrypt(octets.subarray(NONCE));
  } catch {
    throw new ErreurSequestre('Scellé invalide pour cette clé ou ce compte.');
  }
}

export function scellerTexte(cle: Uint8Array, texte: string, usage: string, alea?: SourceAleatoire): string {
  return scellerAvecContexte(cle, utf8ToBytes(texte), usage, alea);
}

export function descellerTexte(cle: Uint8Array, scelle: string, usage: string): string {
  return utf8DepuisOctets(descellerAvecContexte(cle, scelle, usage));
}

// --- Paire de séquestre et dépôt pour l'administrateur ------------------------------

export interface PaireSequestre {
  publique: Uint8Array;
  privee: Uint8Array;
}

export function genererPaireSequestre(alea: SourceAleatoire = aleatoireParDefaut): PaireSequestre {
  const privee = alea(32);
  return { privee, publique: x25519.getPublicKey(privee) };
}

export function publiqueDepuisPrivee(privee: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privee);
}

function cleEcies(partage: Uint8Array, ephemere: Uint8Array, publique: Uint8Array, usage: string): Uint8Array {
  return hkdf(sha256, partage, concatBytes(ephemere, publique), contexte(`ecies/${usage}`), 32);
}

/**
 * Dépose `contenu` pour le détenteur de `publique` (hexadécimal). Rend
 * « éphémère.nonce+chiffré » en hexadécimal. L'expéditeur ne peut pas le relire.
 */
export function scellerPourAdmin(publiqueHexa: string, contenu: Uint8Array, usage: string, alea: SourceAleatoire = aleatoireParDefaut): string {
  let publique: Uint8Array;
  try {
    publique = hexToBytes(publiqueHexa);
  } catch {
    throw new ErreurSequestre('Clé publique de séquestre invalide.');
  }
  if (publique.length !== 32) {
    throw new ErreurSequestre('Clé publique de séquestre invalide.');
  }
  const eph = alea(32);
  const ephPub = x25519.getPublicKey(eph);
  const partage = x25519.getSharedSecret(eph, publique);
  eph.fill(0);
  const cle = cleEcies(partage, ephPub, publique, usage);
  partage.fill(0);
  const scelle = scellerAvecContexte(cle, contenu, `ecies/${usage}`, alea);
  cle.fill(0);
  return `${bytesToHex(ephPub)}.${scelle}`;
}

export function ouvrirDepot(privee: Uint8Array, depot: string, usage: string): Uint8Array {
  const [ephB64, scelle] = depot.split('.');
  if (!ephB64 || !scelle) {
    throw new ErreurSequestre('Dépôt illisible.');
  }
  let ephPub: Uint8Array;
  try {
    ephPub = hexToBytes(ephB64);
  } catch {
    throw new ErreurSequestre('Dépôt illisible.');
  }
  if (ephPub.length !== 32) {
    throw new ErreurSequestre('Dépôt illisible.');
  }
  const publique = x25519.getPublicKey(privee);
  const partage = x25519.getSharedSecret(privee, ephPub);
  const cle = cleEcies(partage, ephPub, publique, usage);
  partage.fill(0);
  try {
    return descellerAvecContexte(cle, scelle, `ecies/${usage}`);
  } finally {
    cle.fill(0);
  }
}

// --- Code d'accès administrateur ------------------------------------------------------

/** Sans caractères ambigus ; 4 groupes de 4 parmi 32, soit 80 bits. */
const ALPHABET_CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function genererCodeAcces(alea: SourceAleatoire = aleatoireParDefaut): string {
  const octets = alea(16);
  const caracteres = Array.from(octets, octet => ALPHABET_CODE[octet % ALPHABET_CODE.length]);
  return [0, 4, 8, 12].map(i => caracteres.slice(i, i + 4).join('')).join('-');
}

/** Forme canonique d'un code saisi (majuscules, tirets, sans espaces). */
export function normaliserCode(code: string): string {
  const brut = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return brut.length === 16 ? [0, 4, 8, 12].map(i => brut.slice(i, i + 4)).join('-') : brut;
}

/**
 * Clé qui enveloppe la clé maîtresse d'un ami : HKDF(clé privée de
 * séquestre, info = compte + code). Ni la clé privée seule, ni le code seul
 * ne suffisent ; un autre compte donne une autre clé.
 */
export function cleEnveloppeAcces(privee: Uint8Array, idCompte: string, code: string): Uint8Array {
  return hkdf(sha256, privee, utf8ToBytes(idCompte), contexte(`acces-admin|${idCompte}|${normaliserCode(code)}`), 32);
}

// --- Annuaire : noms retrouvables sans être listés ------------------------------------

/** Nom tel qu'on le compare : sans accents, casse ni espaces superflus. */
export function normaliserNom(nom: string): string {
  return nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Empreinte salée d'un nom : on retrouve un compte par son nom, sans pouvoir lister les noms. */
export function empreinteNom(selHexa: string, nom: string): string {
  return bytesToHex(sha256(concatBytes(contexte('annuaire/empreinte'), hexToBytes(selHexa), utf8ToBytes(normaliserNom(nom)))));
}

/** Clé tirée du nom : seul qui connaît le nom relit son affichage exact. */
export function cleDuNom(selHexa: string, nom: string): Uint8Array {
  return hkdf(sha256, utf8ToBytes(normaliserNom(nom)), hexToBytes(selHexa), contexte('annuaire/nom'), 32);
}

export { bytesToHex, hexToBytes };
