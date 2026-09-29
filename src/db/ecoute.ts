/**
 * Écoute des écritures sur les données synchronisées.
 *
 * Enveloppe un pilote SQLite : chaque écriture qui touche une donnée que la
 * synchro partage (comptes, valeurs, opérations, watchlist, quelques
 * paramètres) prévient les écouteurs. C'est ce qui déclenche « un tour de
 * synchro quelques secondes après une modification locale ».
 *
 * Ne déclenchent rien : les cours (rechargés en continu, non partagés) et
 * l'état interne de la synchro elle-même (`sync.*`), sans quoi chaque tour
 * en relancerait un autre.
 */

import { PARAMETRES_A_SYNCHRONISER } from '../sync/relais/entites';
import type { PiloteSqlite, ValeurSql } from './pilote';

const TABLES_PARTAGEES = /\b(comptes|titres|transactions|watchlist)\b/i;

export function ecritureSynchronisee(sql: string, parametres?: readonly ValeurSql[]): boolean {
  if (/\bparametres\b/i.test(sql)) {
    return typeof parametres?.[0] === 'string' && PARAMETRES_A_SYNCHRONISER.includes(parametres[0]);
  }
  return TABLES_PARTAGEES.test(sql);
}

export function ecouterEcritures(pilote: PiloteSqlite, rappels: ReadonlySet<() => void>): PiloteSqlite {
  return {
    executer: (sql, parametres) => {
      pilote.executer(sql, parametres);
      if (rappels.size > 0 && ecritureSynchronisee(sql, parametres)) {
        for (const rappel of [...rappels]) {
          rappel();
        }
      }
    },
    lire: (sql, parametres) => pilote.lire(sql, parametres),
    // Les écritures de la transaction passent par ce pilote-ci (les dépôts s'y adressent).
    transaction: action => pilote.transaction(action),
    fermer: () => pilote.fermer(),
  };
}
