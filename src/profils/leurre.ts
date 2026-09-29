/**
 * Coffre leurre : ce qu'ouvre l'écran de connexion quand le prénom saisi ne
 * correspond à aucun compte.
 *
 * Sans lui, « aucun compte à ce nom » dirait à qui tâtonne quels prénoms
 * existent. Avec lui, un prénom inconnu mène au même écran de
 * déverrouillage qu'un vrai compte, et échoue avec le même message, après
 * la même dérivation Argon2id (mêmes paramètres, même nombre
 * d'enveloppes). Le coffre est fabriqué sans dérivation — des octets
 * aléatoires de la bonne forme — : sa création ne trahit rien non plus.
 * Aucune clé ne l'ouvre.
 */

import { bytesToHex } from '@noble/hashes/utils.js';
import { aleatoireParDefaut, type SourceAleatoire } from '../securite/aleatoire';
import { NOMBRE_CODES_DEFAUT, VERSION_COFFRE, type Coffre, type Enveloppe } from '../securite/coffre';
import { PARAMETRES_KDF_DEFAUT, type ParametresKdf } from '../securite/kdf';

export function coffreLeurre(alea: SourceAleatoire = aleatoireParDefaut, kdf: ParametresKdf = PARAMETRES_KDF_DEFAUT): Coffre {
  const enveloppe = (usage: Enveloppe['usage']): Enveloppe => ({
    usage,
    sel: bytesToHex(alea(16)),
    nonce: bytesToHex(alea(24)),
    charge: bytesToHex(alea(48)),
    kdf,
  });
  return {
    version: VERSION_COFFRE,
    enveloppes: [enveloppe('motdepasse'), ...Array.from({ length: NOMBRE_CODES_DEFAUT }, () => enveloppe('recuperation'))],
    totp: { nonce: bytesToHex(alea(24)), charge: bytesToHex(alea(36)) },
  };
}
