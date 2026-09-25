/**
 * Pilote de l'application, adossé à op-sqlite et SQLCipher.
 *
 * Écrit contre les types réels d'op-sqlite, pas contre une API supposée :
 * `executeSync` est bien synchrone, `open` accepte bien une `encryptionKey`,
 * et `QueryResult.rows` est bien un tableau d'objets. Le compilateur le
 * vérifie à chaque build.
 *
 * Ce qui reste non vérifié tant qu'un build appareil n'a pas eu lieu : le
 * comportement à l'exécution, et surtout la présence effective de SQLCipher
 * dans le binaire. D'où `verifierChiffrement()`, appelé à l'ouverture.
 */

import { isSQLCipher, open, type DB } from '@op-engineering/op-sqlite';
import type { PiloteSqlite, ValeurSql } from '../pilote';

export class ErreurChiffrement extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurChiffrement';
  }
}

export interface OptionsOuverture {
  /** Nom du fichier de base. */
  nom: string;
  /** Clé de chiffrement au format hexadécimal, produite par `cleHexadecimale()`. */
  cleHexadecimale?: string;
  /** Dossier de stockage ; le dossier par défaut d'op-sqlite sinon. */
  emplacement?: string;
}

/**
 * Vérifie que le binaire embarque bien SQLCipher.
 *
 * op-sqlite se compile avec ou sans. Sans cette vérification, une base
 * prétendument chiffrée s'ouvrirait en clair sans que rien ne le signale —
 * c'est exactement le genre de panne silencieuse qu'il faut refuser.
 */
export function verifierChiffrement(): void {
  if (!isSQLCipher()) {
    throw new ErreurChiffrement(
      "op-sqlite est compilé sans SQLCipher : la base ne serait pas chiffrée. " +
        'Activez SQLCipher dans la configuration du module avant de continuer.',
    );
  }
}

function enveloppe(base: DB): PiloteSqlite {
  // SQLite n'autorise pas de BEGIN imbriqué : seule la transaction la plus
  // externe valide ou annule, comme dans le pilote de test.
  let profondeur = 0;

  return {
    executer(sql: string, parametres: readonly ValeurSql[] = []): void {
      base.executeSync(sql, [...parametres]);
    },

    lire<T>(sql: string, parametres: readonly ValeurSql[] = []): T[] {
      return base.executeSync(sql, [...parametres]).rows as T[];
    },

    transaction<T>(action: () => T): T {
      if (profondeur > 0) {
        profondeur++;
        try {
          return action();
        } finally {
          profondeur--;
        }
      }

      profondeur = 1;
      base.executeSync('BEGIN');
      try {
        const resultat = action();
        base.executeSync('COMMIT');
        return resultat;
      } catch (erreur) {
        base.executeSync('ROLLBACK');
        throw erreur;
      } finally {
        profondeur = 0;
      }
    },

    fermer(): void {
      base.close();
    },
  };
}

/**
 * Ouvre la base chiffrée du portefeuille.
 * La clé n'est jamais conservée ici : op-sqlite la consomme à l'ouverture.
 */
export function ouvrirBaseChiffree(options: OptionsOuverture): PiloteSqlite {
  if (!options.cleHexadecimale) {
    throw new ErreurChiffrement('Clé de chiffrement manquante');
  }
  verifierChiffrement();

  return enveloppe(
    open({
      name: options.nom,
      location: options.emplacement,
      encryptionKey: options.cleHexadecimale,
    }),
  );
}

/**
 * Ouvre une base **non chiffrée**, réservée au coffre de clés.
 *
 * Le coffre doit être lisible avant tout déverrouillage : il ne peut donc pas
 * vivre dans la base chiffrée. Il n'est pas secret pour autant — ses
 * enveloppes sont inexploitables sans mot de passe ni code de récupération.
 */
export function ouvrirBaseCoffre(
  nom = 'coffre.sqlite',
  emplacement?: string,
): PiloteSqlite {
  return enveloppe(open({ name: nom, location: emplacement }));
}
