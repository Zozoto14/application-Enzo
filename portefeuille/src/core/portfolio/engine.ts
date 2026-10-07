/**
 * Moteur de rejeu du journal de transactions.
 *
 * Une seule traversée chronologique produit à la fois les positions, les
 * cessions et les soldes de chaque compte. Les trois vues partagent donc le
 * même état courant : impossible qu'un PRU affiché à l'écran diverge du PRU
 * utilisé pour calculer une plus-value réalisée.
 *
 * Méthode de calcul du prix de revient : moyenne pondérée, conformément à
 * l'article 150-0 D du CGI, et non FIFO. Les frais d'acquisition majorent le
 * prix de revient, les frais de cession minorent le produit de la vente.
 */

import { Decimal } from '../money/decimal';
import type {
  Cession,
  Compte,
  EtatCompte,
  Position,
  Transaction,
} from '../domain/types';

export class ErreurTransaction extends Error {
  constructor(readonly transactionId: string, message: string) {
    super(`Transaction ${transactionId} : ${message}`);
    this.name = 'ErreurTransaction';
  }
}

export interface EtatPortefeuille {
  /** Positions encore ouvertes, quantité strictement positive. */
  positions: Position[];
  /** Positions entièrement soldées, conservées pour l'historique. */
  positionsSoldees: Position[];
  cessions: Cession[];
  comptes: Map<string, EtatCompte>;
}

const cleDePosition = (compteId: string, titreId: string): string =>
  `${compteId}::${titreId}`;

/** Ordonne le journal par date, en conservant l'ordre de saisie à date égale. */
function trierChronologiquement(transactions: readonly Transaction[]): Transaction[] {
  return transactions
    .map((transaction, index) => ({ transaction, index }))
    .sort((a, b) => {
      if (a.transaction.date !== b.transaction.date) {
        return a.transaction.date < b.transaction.date ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map(({ transaction }) => transaction);
}

/**
 * Convertit un montant vers la devise du compte.
 * Le taux retenu est celui figé sur la transaction, jamais un taux courant :
 * rejouer le journal deux ans plus tard doit redonner les mêmes chiffres.
 */
function versDeviseCompte(
  montant: Decimal,
  transaction: Transaction,
  compte: Compte,
): Decimal {
  if (transaction.devise === compte.devise) {
    return montant;
  }
  if (!transaction.tauxChange) {
    throw new ErreurTransaction(
      transaction.id,
      `taux de change manquant pour convertir ${transaction.devise} en ${compte.devise}`,
    );
  }
  if (!transaction.tauxChange.estPositif()) {
    throw new ErreurTransaction(transaction.id, 'taux de change nul ou négatif');
  }
  return montant.mul(transaction.tauxChange);
}

function etatCompteVide(compteId: string): EtatCompte {
  return {
    compteId,
    cash: Decimal.ZERO,
    versementsCumules: Decimal.ZERO,
    retraitsCumules: Decimal.ZERO,
    dividendesPercus: Decimal.ZERO,
    fraisCumules: Decimal.ZERO,
  };
}

function positionVide(compteId: string, titreId: string): Position {
  return {
    compteId,
    titreId,
    quantite: Decimal.ZERO,
    coutTotal: Decimal.ZERO,
    pru: Decimal.ZERO,
  };
}

/** Rejoue l'intégralité du journal et renvoie l'état dérivé du portefeuille. */
export function rejouer(
  comptes: readonly Compte[],
  transactions: readonly Transaction[],
): EtatPortefeuille {
  const parId = new Map(comptes.map(compte => [compte.id, compte]));
  const etatsComptes = new Map<string, EtatCompte>(
    comptes.map(compte => [compte.id, etatCompteVide(compte.id)]),
  );
  const positions = new Map<string, Position>();
  const cessions: Cession[] = [];

  for (const transaction of trierChronologiquement(transactions)) {
    const compte = parId.get(transaction.compteId);
    if (!compte) {
      throw new ErreurTransaction(
        transaction.id,
        `compte inconnu "${transaction.compteId}"`,
      );
    }
    const etat = etatsComptes.get(compte.id)!;

    switch (transaction.type) {
      case 'ACHAT': {
        if (!transaction.quantite.estPositif()) {
          throw new ErreurTransaction(
            transaction.id,
            'quantité achetée nulle ou négative',
          );
        }
        if (transaction.prixUnitaire.estNegatif()) {
          throw new ErreurTransaction(transaction.id, 'prix unitaire négatif');
        }
        const brut = transaction.quantite.mul(transaction.prixUnitaire);
        const cout = versDeviseCompte(brut.add(transaction.frais), transaction, compte);
        const frais = versDeviseCompte(transaction.frais, transaction, compte);

        const cle = cleDePosition(compte.id, transaction.titreId);
        const position =
          positions.get(cle) ?? positionVide(compte.id, transaction.titreId);
        const quantite = position.quantite.add(transaction.quantite);
        const coutTotal = position.coutTotal.add(cout);
        positions.set(cle, {
          ...position,
          quantite,
          coutTotal,
          pru: coutTotal.div(quantite),
        });

        etat.cash = etat.cash.sub(cout);
        etat.fraisCumules = etat.fraisCumules.add(frais);
        break;
      }

      case 'VENTE': {
        if (!transaction.quantite.estPositif()) {
          throw new ErreurTransaction(
            transaction.id,
            'quantité vendue nulle ou négative',
          );
        }
        const cle = cleDePosition(compte.id, transaction.titreId);
        const position = positions.get(cle);
        if (!position || position.quantite.lt(transaction.quantite)) {
          const detenue = position ? position.quantite.toString() : '0';
          throw new ErreurTransaction(
            transaction.id,
            `vente de ${transaction.quantite.toString()} titres alors que ${detenue} sont détenus`,
          );
        }

        const brut = transaction.quantite.mul(transaction.prixUnitaire);
        const produitNet = versDeviseCompte(
          brut.sub(transaction.frais),
          transaction,
          compte,
        );
        const frais = versDeviseCompte(transaction.frais, transaction, compte);

        // Le PRU ne bouge pas lors d'une vente : seuls la quantité restante et
        // le coût encore engagé diminuent, au prorata des titres cédés.
        const prixRevient = position.pru.mul(transaction.quantite);
        const quantiteRestante = position.quantite.sub(transaction.quantite);
        positions.set(cle, {
          ...position,
          quantite: quantiteRestante,
          coutTotal: quantiteRestante.estZero()
            ? Decimal.ZERO
            : position.coutTotal.sub(prixRevient),
          pru: quantiteRestante.estZero() ? Decimal.ZERO : position.pru,
        });

        cessions.push({
          transactionId: transaction.id,
          compteId: compte.id,
          titreId: transaction.titreId,
          date: transaction.date,
          annee: Number(transaction.date.slice(0, 4)),
          quantite: transaction.quantite,
          prixUnitaire: transaction.prixUnitaire,
          frais,
          produitNet,
          pru: position.pru,
          prixRevient,
          plusValue: produitNet.sub(prixRevient),
        });

        etat.cash = etat.cash.add(produitNet);
        etat.fraisCumules = etat.fraisCumules.add(frais);
        break;
      }

      case 'DIVIDENDE': {
        const montant = versDeviseCompte(transaction.montantNet, transaction, compte);
        etat.cash = etat.cash.add(montant);
        etat.dividendesPercus = etat.dividendesPercus.add(montant);
        break;
      }

      case 'VERSEMENT': {
        if (transaction.montant.estNegatif()) {
          throw new ErreurTransaction(transaction.id, 'versement négatif');
        }
        const montant = versDeviseCompte(transaction.montant, transaction, compte);
        etat.cash = etat.cash.add(montant);
        etat.versementsCumules = etat.versementsCumules.add(montant);
        break;
      }

      case 'RETRAIT': {
        if (transaction.montant.estNegatif()) {
          throw new ErreurTransaction(transaction.id, 'retrait négatif');
        }
        const montant = versDeviseCompte(transaction.montant, transaction, compte);
        etat.cash = etat.cash.sub(montant);
        etat.retraitsCumules = etat.retraitsCumules.add(montant);
        break;
      }

      case 'FRAIS': {
        const montant = versDeviseCompte(transaction.montant, transaction, compte);
        etat.cash = etat.cash.sub(montant);
        etat.fraisCumules = etat.fraisCumules.add(montant);
        break;
      }
    }
  }

  const toutes = [...positions.values()];
  return {
    positions: toutes.filter(position => position.quantite.estPositif()),
    positionsSoldees: toutes.filter(position => !position.quantite.estPositif()),
    cessions,
    comptes: etatsComptes,
  };
}

/** Plus ou moins-values réalisées, agrégées par année civile. */
export function plusValuesParAnnee(
  cessions: readonly Cession[],
  filtre?: { compteId?: string },
): Map<number, Decimal> {
  const parAnnee = new Map<number, Decimal>();
  for (const cession of cessions) {
    if (filtre?.compteId && cession.compteId !== filtre.compteId) {
      continue;
    }
    const cumul = parAnnee.get(cession.annee) ?? Decimal.ZERO;
    parAnnee.set(cession.annee, cumul.add(cession.plusValue));
  }
  return parAnnee;
}
