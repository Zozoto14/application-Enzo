/**
 * Rafraîchissement des cours.
 *
 * Trois règles qui tiennent l'ensemble :
 *
 *  - **Seuls les titres détenus sont interrogés.** Une watchlist de cent
 *    lignes épuiserait le quota gratuit sans rien apporter au portefeuille.
 *  - **Un cours obtenu est écrit, même si d'autres ont échoué.** L'opération
 *    n'est pas atomique, et c'est voulu : mieux vaut trois cours sur cinq
 *    que rien du tout.
 *  - **Un échec n'écrase jamais un cours existant.** Une API muette laisse la
 *    dernière valorisation connue en place, et le rapport dit lesquels
 *    n'ont pas été mis à jour.
 */

import { rejouer } from '../core/portfolio/engine';
import { DepotComptes, DepotCours, DepotTitres, DepotTransactions } from '../db/depots';
import type { PiloteSqlite } from '../db/pilote';
import type { EchecCours, FournisseurCours } from './fournisseur';

export interface OptionsRafraichissement {
  fournisseur: FournisseurCours;
  cle?: string;
  aujourdhui?: string;
  /** Implémentation de `fetch`, injectable pour les tests. */
  recuperer?: typeof fetch;
}

export interface RapportRafraichissement {
  /** Nombre de titres dont le cours a été mis à jour. */
  misAJour: number;
  echecs: EchecCours[];
  /** Titres détenus mais sans symbole exploitable. */
  sansSymbole: string[];
  /** Vrai si aucun titre n'était à rafraîchir. */
  rienAFaire: boolean;
}

export async function rafraichirCours(
  pilote: PiloteSqlite,
  options: OptionsRafraichissement,
): Promise<RapportRafraichissement> {
  const comptes = new DepotComptes(pilote).tous();
  const transactions = new DepotTransactions(pilote).toutes();
  const titres = new Map(new DepotTitres(pilote).tous().map(titre => [titre.id, titre]));

  const detenus = rejouer(comptes, transactions).positions.map(
    position => position.titreId,
  );
  const uniques = [...new Set(detenus)];

  const demandes = [];
  const sansSymbole: string[] = [];
  for (const titreId of uniques) {
    const titre = titres.get(titreId);
    const symbole = titre?.ticker?.trim();
    if (!titre || !symbole) {
      sansSymbole.push(titre?.nom ?? titreId);
      continue;
    }
    demandes.push({ titreId, symbole });
  }

  if (demandes.length === 0) {
    return {
      misAJour: 0,
      echecs: [],
      sansSymbole,
      rienAFaire: uniques.length === 0,
    };
  }

  const resultat = await options.fournisseur.recuperer(demandes, {
    cle: options.cle,
    aujourdhui: options.aujourdhui,
    recuperer: options.recuperer,
  });

  const depotCours = new DepotCours(pilote);
  for (const cote of resultat.cours) {
    depotCours.enregistrer(cote.titreId, cote.date, cote.cours);
  }

  return {
    misAJour: resultat.cours.length,
    echecs: resultat.echecs,
    sansSymbole,
    rienAFaire: false,
  };
}

/** Résumé en clair du rapport, affichable tel quel. */
export function resumeRafraichissement(rapport: RapportRafraichissement): string {
  if (rapport.rienAFaire) {
    return 'Aucune position à valoriser.';
  }

  const morceaux = [`${rapport.misAJour} cours mis à jour`];
  if (rapport.echecs.length > 0) {
    morceaux.push(`${rapport.echecs.length} en échec`);
  }
  if (rapport.sansSymbole.length > 0) {
    morceaux.push(`${rapport.sansSymbole.length} sans symbole`);
  }
  return `${morceaux.join(', ')}.`;
}
