/**
 * Interface minimale d'accès à SQLite.
 *
 * Le reste de la couche de persistance ne connaît que ce contrat, jamais une
 * bibliothèque concrète. Deux implémentations coexistent donc sans que le
 * schéma ni les dépôts ne changent :
 *  - en test et en script, le SQLite intégré à Node, qui tourne sur le PC ;
 *  - dans l'application, op-sqlite adossé à SQLCipher, sur l'appareil.
 *
 * C'est ce qui rend le SQL réellement testable hors appareil : les requêtes
 * vérifiées ici sont exactement celles qui tourneront sur l'iPhone.
 *
 * Le chiffrement n'apparaît pas dans ce contrat : la clé est fournie à
 * l'ouverture de la base par l'implémentation, et rien au-dessus n'a besoin
 * d'en connaître l'existence.
 */

export type ValeurSql = string | number | null;

export interface PiloteSqlite {
  /** Exécute une requête sans résultat attendu. */
  executer(sql: string, parametres?: readonly ValeurSql[]): void;

  /** Exécute une requête et renvoie ses lignes. */
  lire<T = Record<string, ValeurSql>>(
    sql: string,
    parametres?: readonly ValeurSql[],
  ): T[];

  /**
   * Exécute `action` dans une transaction SQL, annulée si elle lève.
   * Indispensable à l'import CSV : plusieurs centaines d'insertions doivent
   * aboutir ensemble ou pas du tout.
   */
  transaction<T>(action: () => T): T;

  fermer(): void;
}
