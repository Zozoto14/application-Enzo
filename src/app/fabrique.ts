/**
 * Construction de la session réelle, sur appareil.
 *
 * Deux bases coexistent, et la distinction est structurelle :
 *
 *  - `portefeuille.sqlite`, **chiffrée** par SQLCipher avec la clé maîtresse ;
 *  - `coffre.sqlite`, **en clair**, qui ne contient que le coffre de clés.
 *
 * Le coffre ne peut pas vivre dans la base chiffrée : il faut le lire pour
 * obtenir la clé qui ouvre celle-ci. Il n'est pas secret pour autant — ses
 * enveloppes sont inexploitables sans le mot de passe ni un code de
 * récupération.
 *
 * Ce fichier est le seul à connaître op-sqlite. Il n'est importé que depuis le
 * point d'entrée de l'application, jamais depuis les tests, qui injectent
 * leurs propres pilotes.
 */

import { ouvrirBaseChiffree, ouvrirBaseCoffre } from '../db/pilotes/op-sqlite';
import { Session } from '../session/session';
import { stockageSqlite } from '../session/stockage-sqlite';

export const NOM_BASE_PORTEFEUILLE = 'portefeuille.sqlite';
export const NOM_BASE_COFFRE = 'coffre.sqlite';

export class ErreurConfiguration extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ErreurConfiguration';
  }
}

/**
 * Assemble la session à partir des briques natives.
 *
 * Une erreur ici signifie presque toujours que le module natif n'est pas
 * compilé dans le binaire : le message le dit plutôt que de laisser remonter
 * une exception obscure.
 */
export function creerSessionAppareil(): Session {
  let coffre;
  try {
    coffre = ouvrirBaseCoffre(NOM_BASE_COFFRE);
  } catch (erreur) {
    throw new ErreurConfiguration(
      "Impossible d'ouvrir le coffre de clés. Le module natif op-sqlite n'est " +
        'probablement pas compilé dans cette version de l’application.',
      erreur,
    );
  }

  return new Session({
    stockage: stockageSqlite(coffre),
    ouvrirBase: cleHexadecimale =>
      ouvrirBaseChiffree({ nom: NOM_BASE_PORTEFEUILLE, cleHexadecimale }),
  });
}
