/**
 * Scellement d'un contenu binaire par la clé maîtresse.
 *
 * Le coffre scelle déjà des secrets, mais ses fonctions lui sont privées et
 * travaillent sur de petites charges encodées en base64. Il faut ici sceller
 * **un fichier entier** — la base du bureau, que sql.js ne sait pas chiffrer
 * lui-même — et le résultat doit rester du binaire compact.
 *
 * ## Deux garde-fous qui n'en ont pas l'air
 *
 * **Une donnée associée distincte.** Le chiffrement authentifié lie chaque
 * scellé à une étiquette de domaine. Un scellé de base ne peut donc pas être
 * présenté à la place d'une enveloppe de coffre, ni l'inverse : la
 * vérification échoue avant tout déchiffrement.
 *
 * **Un en-tête en clair.** Quatre octets de signature et un numéro de version
 * permettent de dire « ce fichier n'est pas une base scellée » ou « il vient
 * d'une version plus récente » au lieu de rendre un échec d'authentification
 * indistinct d'un mauvais mot de passe.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { aleatoireParDefaut, type SourceAleatoire } from './aleatoire';

/** « ABDB » : AppDashboard, base de données. */
export const SIGNATURE = Uint8Array.from([0x41, 0x42, 0x44, 0x42]);

export const VERSION_SCELLE = 1;

/** Longueur du nonce de XChaCha20-Poly1305. */
export const LONGUEUR_NONCE = 24;

const ENTETE = SIGNATURE.length + 1;

/**
 * Étiquette de domaine, liée cryptographiquement à chaque scellé.
 * `utf8ToBytes` plutôt que `TextEncoder` : ce dernier n'est pas garanti dans
 * le moteur JavaScript embarqué de React Native.
 */
const DONNEE_ASSOCIEE = utf8ToBytes('applibourse:base:v1');

export class ErreurScelle extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurScelle';
  }
}

/** Scelle un contenu binaire. Le résultat est autonome et autodescriptif. */
export function scellerOctets(
  cleMaitresse: Uint8Array,
  contenu: Uint8Array,
  alea: SourceAleatoire = aleatoireParDefaut,
): Uint8Array {
  const nonce = alea(LONGUEUR_NONCE);
  const charge = xchacha20poly1305(cleMaitresse, nonce, DONNEE_ASSOCIEE).encrypt(contenu);

  const sortie = new Uint8Array(ENTETE + LONGUEUR_NONCE + charge.length);
  sortie.set(SIGNATURE, 0);
  sortie[SIGNATURE.length] = VERSION_SCELLE;
  sortie.set(nonce, ENTETE);
  sortie.set(charge, ENTETE + LONGUEUR_NONCE);
  return sortie;
}

/**
 * Descelle un contenu.
 *
 * Distingue trois échecs, parce qu'ils appellent trois réactions différentes :
 * ce n'est pas une base scellée, elle vient d'une version plus récente, ou la
 * clé est mauvaise.
 */
export function descellerOctets(cleMaitresse: Uint8Array, scelle: Uint8Array): Uint8Array {
  if (scelle.length < ENTETE + LONGUEUR_NONCE) {
    throw new ErreurScelle('Fichier trop court pour être une base scellée.');
  }
  for (let index = 0; index < SIGNATURE.length; index++) {
    if (scelle[index] !== SIGNATURE[index]) {
      throw new ErreurScelle(
        'Ce fichier n’est pas une base scellée par l’application.',
      );
    }
  }

  const version = scelle[SIGNATURE.length];
  if (version !== VERSION_SCELLE) {
    throw new ErreurScelle(
      `Base scellée en version ${version}, alors que cette application lit la version ${VERSION_SCELLE}. Mettez l’application à jour plutôt que d’écraser vos données.`,
    );
  }

  const nonce = scelle.subarray(ENTETE, ENTETE + LONGUEUR_NONCE);
  const charge = scelle.subarray(ENTETE + LONGUEUR_NONCE);

  try {
    return xchacha20poly1305(cleMaitresse, nonce, DONNEE_ASSOCIEE).decrypt(charge);
  } catch {
    // L'authentification ne dit pas ce qui cloche, et c'est voulu : distinguer
    // « mauvaise cle » de « contenu altere » renseignerait un attaquant.
    throw new ErreurScelle(
      'Le déchiffrement a échoué : mauvaise clé, ou fichier altéré.',
    );
  }
}

/** Vrai si ces octets ressemblent à une base scellée, sans tenter de l'ouvrir. */
export function estScelle(octets: Uint8Array): boolean {
  if (octets.length < ENTETE) {
    return false;
  }
  return SIGNATURE.every((octet, index) => octets[index] === octet);
}
