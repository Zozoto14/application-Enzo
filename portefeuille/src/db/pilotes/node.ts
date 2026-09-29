/**
 * Pilote adossé au SQLite intégré à Node (module `node:sqlite`, Node 22+).
 *
 * Réservé aux tests et aux scripts exécutés sur le PC. Il n'est volontairement
 * pas exporté par l'index de `src/db` : l'application ne doit jamais tenter de
 * l'embarquer, `node:sqlite` n'existant pas dans le moteur JavaScript de
 * l'appareil.
 *
 * Son intérêt est qu'il exécute du vrai SQLite : le schéma, les contraintes et
 * les requêtes validés par les tests sont exactement ceux qui tourneront sur
 * l'iPhone, à la couche de chiffrement près.
 */

import type { PiloteSqlite, ValeurSql } from '../pilote';

interface RequeteNode {
  run(...parametres: ValeurSql[]): unknown;
  all(...parametres: ValeurSql[]): unknown[];
}

interface BaseNode {
  exec(sql: string): void;
  prepare(sql: string): RequeteNode;
  close(): void;
}

const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (chemin: string) => BaseNode;
};

export function ouvrirBaseNode(chemin = ':memory:'): PiloteSqlite {
  const base = new DatabaseSync(chemin);

  // SQLite n'autorise pas de BEGIN imbriqué. Plutôt que d'interdire à un dépôt
  // d'ouvrir une transaction depuis une autre, on ne compte que la plus
  // externe : c'est elle qui valide ou annule l'ensemble.
  let profondeur = 0;

  return {
    executer(sql: string, parametres: readonly ValeurSql[] = []): void {
      if (parametres.length === 0) {
        base.exec(sql);
        return;
      }
      base.prepare(sql).run(...parametres);
    },

    lire<T>(sql: string, parametres: readonly ValeurSql[] = []): T[] {
      return base.prepare(sql).all(...parametres) as T[];
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
      base.exec('BEGIN');
      try {
        const resultat = action();
        base.exec('COMMIT');
        return resultat;
      } catch (erreur) {
        base.exec('ROLLBACK');
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
