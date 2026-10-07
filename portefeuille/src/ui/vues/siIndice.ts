/**
 * « Et si j'avais tout mis sur le MSCI World ? »
 *
 * Chaque euro réellement investi est rejoué, à la même date, dans un ETF
 * monde : on compte les parts achetées au cours de clôture du jour, et on
 * les valorise au dernier cours. La comparaison se fait donc à argent égal
 * et à dates égales — ce qui mesure vos choix, pas votre épargne.
 *
 * L'argent investi, ce sont les versements et retraits. Un portefeuille
 * importé depuis un relevé n'en a souvent pas : ce sont alors les achats et
 * les ventes qui en tiennent lieu.
 */

import type { Transaction } from '../../core/domain/types';
import type { CoursDate } from '../../core/performance/serie';

export interface FluxInvesti {
  date: string;
  /** Positif : argent investi ; négatif : argent retiré. */
  montant: number;
}

export function fluxInvestis(transactions: readonly Transaction[]): FluxInvesti[] {
  const taux = (transaction: Transaction) => transaction.tauxChange?.toNumber() ?? 1;
  const versements = transactions.filter(t => t.type === 'VERSEMENT' || t.type === 'RETRAIT');
  const flux = versements.length > 0
    ? versements.map(t => ({
        date: t.date,
        montant: (t.type === 'VERSEMENT' ? 1 : -1) * (t as { montant: { toNumber(): number } }).montant.toNumber() * taux(t),
      }))
    : transactions
        .filter(t => t.type === 'ACHAT' || t.type === 'VENTE')
        .map(t => {
          const operation = t as Extract<Transaction, { type: 'ACHAT' | 'VENTE' }>;
          const brut = operation.quantite.toNumber() * operation.prixUnitaire.toNumber();
          const frais = operation.frais.toNumber();
          return {
            date: t.date,
            montant: (t.type === 'ACHAT' ? brut + frais : -(brut - frais)) * taux(t),
          };
        });
  return flux.sort((a, b) => a.date.localeCompare(b.date));
}

export interface ResultatSiIndice {
  investi: number;
  valeurIndice: number;
  valeurReelle: number;
  /** Réel moins indice : positif, vos choix ont fait mieux. */
  ecart: number;
  performanceReelle: number | null;
  performanceIndice: number | null;
  /** Vrai si des flux précèdent l'historique de l'indice : leur prix est approché. */
  approximatif: boolean;
  /** Valeur du placement fictif au fil du temps. */
  courbe: Array<{ date: string; valeur: number }>;
}

export function simulerToutSurIndice(entrees: {
  transactions: readonly Transaction[];
  serie: readonly CoursDate[];
  valeurReelle: number;
}): ResultatSiIndice | undefined {
  const flux = fluxInvestis(entrees.transactions).filter(element => element.montant !== 0);
  const serie = [...entrees.serie].sort((a, b) => a.date.localeCompare(b.date));
  if (flux.length === 0 || serie.length < 2) return undefined;

  let approximatif = false;
  // Cours du jour du flux, ou du premier jour de cotation qui suit.
  const coursAu = (date: string): number => {
    const point = serie.find(element => element.date >= date);
    if (!point) return serie[serie.length - 1].cloture.toNumber();
    if (date < serie[0].date) approximatif = true;
    return point.cloture.toNumber();
  };

  let parts = 0;
  let investi = 0;
  const partsParDate: Array<{ date: string; parts: number }> = [];
  for (const element of flux) {
    parts += element.montant / coursAu(element.date);
    investi += element.montant;
    partsParDate.push({ date: element.date, parts });
  }
  const dernier = serie[serie.length - 1].cloture.toNumber();
  const valeurIndice = Math.max(0, parts * dernier);

  const debut = flux[0].date;
  const courbe = serie
    .filter(point => point.date >= debut)
    .map(point => {
      const connues = [...partsParDate].reverse().find(element => element.date <= point.date)?.parts ?? 0;
      return { date: point.date, valeur: connues * point.cloture.toNumber() };
    });

  return {
    investi,
    valeurIndice,
    valeurReelle: entrees.valeurReelle,
    ecart: entrees.valeurReelle - valeurIndice,
    performanceReelle: investi > 0 ? (entrees.valeurReelle / investi - 1) * 100 : null,
    performanceIndice: investi > 0 ? (valeurIndice / investi - 1) * 100 : null,
    approximatif,
    courbe,
  };
}
