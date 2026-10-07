/**
 * Reconstruction de l'historique de valorisation.
 *
 * Le journal dit ce qui a été acheté et quand ; la table des cours dit ce que
 * cela valait à telle date. Croiser les deux redonne la valeur du portefeuille
 * jour après jour, d'où se déduisent TWR, drawdown et volatilité.
 *
 * Limite structurelle, et il faut la dire : **la série ne peut pas remonter
 * plus loin que les cours enregistrés**. Un portefeuille importé aujourd'hui
 * n'a qu'un seul point, et aucune mesure de performance n'est calculable
 * avant plusieurs relevés. C'est une limite de données, pas de calcul, et
 * l'interface doit l'exposer plutôt que d'inventer un historique.
 */

import { Decimal } from '../money/decimal';
import type { Compte, Transaction } from '../domain/types';
import { rejouer } from '../portfolio/engine';
import type { PointValorisation } from './rendements';

export interface CoursDate {
  date: string;
  cloture: Decimal;
}

export type HistoriqueCours = ReadonlyMap<string, readonly CoursDate[]>;

/** Dernier cours connu à une date donnée, sans jamais regarder vers l'avenir. */
export function coursALaDate(
  historique: readonly CoursDate[],
  date: string,
): Decimal | undefined {
  let retenu: Decimal | undefined;
  for (const point of historique) {
    if (point.date <= date) {
      retenu = point.cloture;
    }
  }
  return retenu;
}

export interface OptionsSerie {
  comptes: readonly Compte[];
  transactions: readonly Transaction[];
  cours: HistoriqueCours;
}

/** Types de transaction qui font entrer ou sortir de l'argent du portefeuille. */
const FLUX_EXTERNES = new Set(['VERSEMENT', 'RETRAIT']);

function fluxExterneDuJour(
  transactions: readonly Transaction[],
  date: string,
): Decimal {
  return transactions
    .filter(t => t.date === date && FLUX_EXTERNES.has(t.type))
    .reduce((total, t) => {
      if (t.type === 'VERSEMENT') {
        return total.add(t.montant);
      }
      if (t.type === 'RETRAIT') {
        return total.sub(t.montant);
      }
      return total;
    }, Decimal.ZERO);
}

/**
 * Dates auxquelles le portefeuille peut être valorisé.
 *
 * Union des dates de cours et des dates de transaction : une opération change
 * la composition, un cours change la valeur, et les deux méritent un point.
 */
export function datesDeValorisation(options: OptionsSerie): string[] {
  const dates = new Set<string>();
  for (const transaction of options.transactions) {
    dates.add(transaction.date);
  }
  for (const historique of options.cours.values()) {
    for (const point of historique) {
      dates.add(point.date);
    }
  }
  return [...dates].sort();
}

/**
 * Série de valorisation du portefeuille.
 *
 * Une date est écartée si l'un des titres détenus n'a aucun cours connu à
 * cette date : mieux vaut une série plus courte qu'un point sous-évalué, qui
 * créerait une fausse chute dans le graphique de performance.
 */
export function serieValorisation(options: OptionsSerie): PointValorisation[] {
  const dates = datesDeValorisation(options);
  const points: PointValorisation[] = [];

  for (const date of dates) {
    const jusqua = options.transactions.filter(t => t.date <= date);
    const etat = rejouer(options.comptes, jusqua);

    let valeurTitres = Decimal.ZERO;
    let complet = true;

    for (const position of etat.positions) {
      const historique = options.cours.get(position.titreId) ?? [];
      const cours = coursALaDate(historique, date);
      if (!cours) {
        complet = false;
        break;
      }
      valeurTitres = valeurTitres.add(position.quantite.mul(cours));
    }

    if (!complet) {
      continue;
    }

    const cash = [...etat.comptes.values()].reduce(
      (total, compte) => total.add(compte.cash),
      Decimal.ZERO,
    );

    points.push({
      date,
      valeurTotale: valeurTitres.add(cash),
      fluxExterne: fluxExterneDuJour(options.transactions, date),
    });
  }

  return points;
}

export interface FluxExterne {
  date: string;
  montant: Decimal;
}

/**
 * Flux de trésorerie pour le calcul du TRI.
 *
 * Convention du taux de rentabilité interne : un versement est une sortie de
 * votre poche, donc négatif ; un retrait est une rentrée, donc positif. La
 * valeur finale du portefeuille compte comme une rentrée fictive, puisque
 * c'est ce que vous récupéreriez en vendant tout.
 */
export function fluxPourTri(
  transactions: readonly Transaction[],
  valeurFinale: Decimal,
  dateFinale: string,
): FluxExterne[] {
  const flux: FluxExterne[] = [];

  for (const transaction of transactions) {
    if (transaction.type === 'VERSEMENT') {
      flux.push({ date: transaction.date, montant: transaction.montant.neg() });
    } else if (transaction.type === 'RETRAIT') {
      flux.push({ date: transaction.date, montant: transaction.montant });
    }
  }

  if (valeurFinale.estPositif()) {
    flux.push({ date: dateFinale, montant: valeurFinale });
  }

  return flux.sort((a, b) => (a.date < b.date ? -1 : 1));
}
