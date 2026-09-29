/**
 * Application d'une fusion à la base.
 *
 * Distincte de la restauration, et volontairement : restaurer **remplace**,
 * fusionner **ajoute**. Rien n'est supprimé ici, rien n'est écrasé.
 *
 * Trois choses ne sont pas reprises de l'archive, et la raison est la même
 * pour les trois — elles appartiennent à l'appareil, pas au portefeuille :
 *
 * - **les réglages** : vous ne voulez pas forcément les mêmes briefings sur
 *   l'iPad que sur l'iPhone, ni la même clé d'API ;
 * - **l'identifiant d'appareil**, qui perdrait tout son sens s'il voyageait ;
 * - **l'historique des cours**, qui se reconstruit seul au premier
 *   rafraîchissement et alourdirait chaque échange pour rien.
 */

import type { ContenuArchive } from '../sauvegarde/archive';
import {
  DepotComptes,
  DepotTitres,
  DepotTransactions,
} from '../db/depots';
import type { PiloteSqlite } from '../db/pilote';
import { fusionner, transactionsOrphelines, type Fusion, type Instantane } from './fusion';

/** Lit l'état fusionnable de la base : ce qui se partage entre appareils. */
export function instantaneDeLaBase(pilote: PiloteSqlite): Instantane {
  return {
    comptes: new DepotComptes(pilote).tous(),
    titres: new DepotTitres(pilote).tous(),
    transactions: new DepotTransactions(pilote).toutes(),
  };
}

export class ErreurFusion extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurFusion';
  }
}

/**
 * Fusionne une archive ouverte dans la base, sans rien détruire.
 *
 * Écrit dans une transaction : une fusion à moitié appliquée serait pire que
 * pas de fusion du tout, puisqu'on ne saurait plus où on en est.
 */
export function fusionnerDansBase(
  pilote: PiloteSqlite,
  contenu: ContenuArchive,
): Fusion {
  const local = instantaneDeLaBase(pilote);
  const distant: Instantane = {
    comptes: contenu.comptes,
    titres: contenu.titres,
    transactions: contenu.transactions,
  };

  const fusion = fusionner(local, distant);

  // Une archive complete porte ses dependances. Si ce n'est pas le cas, on
  // refuse avant d'ecrire : l'insertion echouerait plus loin sur un message
  // de contrainte incomprehensible.
  const orphelines = transactionsOrphelines(fusion.resultat);
  if (orphelines.length > 0) {
    throw new ErreurFusion(
      `${orphelines.length} opération(s) de l’archive renvoient à un compte ou une valeur absents. L’archive est incomplète : rien n’a été fusionné.`,
    );
  }

  return pilote.transaction(() => {
    const comptes = new DepotComptes(pilote);
    const connus = new Set(local.comptes.map(compte => compte.id));
    for (const compte of fusion.resultat.comptes) {
      if (!connus.has(compte.id)) {
        comptes.enregistrer(compte);
      }
    }

    const titres = new DepotTitres(pilote);
    const titresConnus = new Set(local.titres.map(titre => titre.id));
    for (const titre of fusion.resultat.titres) {
      if (!titresConnus.has(titre.id)) {
        titres.enregistrer(titre);
      }
    }

    // Les entites locales ne sont jamais reecrites : `enregistrer` ferait un
    // ON CONFLICT DO UPDATE, ce qui ecraserait justement la version qu'on a
    // choisi de garder.
    const transactions = new DepotTransactions(pilote);
    const operationsConnues = new Set(local.transactions.map(t => t.id));
    for (const transaction of fusion.resultat.transactions) {
      if (!operationsConnues.has(transaction.id)) {
        transactions.enregistrer(transaction);
      }
    }

    return fusion;
  });
}
