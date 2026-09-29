/**
 * Couche de persistance.
 *
 * Le pilote Node (`pilotes/node.ts`) n'est délibérément pas réexporté ici :
 * il est réservé aux tests et aux scripts, et ne doit jamais entrer dans le
 * bundle de l'application.
 */

export type { PiloteSqlite, ValeurSql } from './pilote';

export { MIGRATIONS, VERSION_SCHEMA, migrer, type Migration } from './schema';

export {
  DepotComptes,
  DepotCours,
  DepotTitres,
  DepotTransactions,
  ErreurPersistance,
  chargerEtat,
  versTransaction,
  type ContenuBase,
} from './depots';
