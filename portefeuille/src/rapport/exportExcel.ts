/**
 * Export du portefeuille vers Excel : positions, opérations, dividendes et
 * comptes, chacun dans sa feuille, avec des nombres qu'on peut trier et
 * sommer.
 */

import type { Compte, Titre, Transaction } from '../core/domain/types';
import type { Decimal } from '../core/money/decimal';
import type { EtatPortefeuille } from '../core/portfolio/engine';
import { totaux, valoriserPositions } from '../core/portfolio/valorisation';
import { LIBELLES_TYPE } from '../ui/vues/saisie';
import { creerClasseur, type Feuille } from './xlsx';

export interface EntreesExport {
  etat: EtatPortefeuille;
  comptes: readonly Compte[];
  titres: readonly Titre[];
  transactions: readonly Transaction[];
  cours: ReadonlyMap<string, Decimal>;
}

const n = (valeur: Decimal | undefined | null) => (valeur ? valeur.toNumber() : null);

export function feuillesPortefeuille(entrees: EntreesExport): Feuille[] {
  const titres = new Map(entrees.titres.map(titre => [titre.id, titre]));
  const comptes = new Map(entrees.comptes.map(compte => [compte.id, compte]));
  const { valorisees } = valoriserPositions(entrees.etat.positions, entrees.cours);
  const valorisation = new Map(valorisees.map(position => [`${position.compteId}|${position.titreId}`, position]));

  const positions: Feuille = {
    nom: 'Positions',
    colonnes: [
      { titre: 'Compte', largeur: 16 },
      { titre: 'Valeur', largeur: 34 },
      { titre: 'ISIN', largeur: 14 },
      { titre: 'Symbole', largeur: 10 },
      { titre: 'Quantité', format: 'nombre' },
      { titre: 'PRU', format: 'euro', largeur: 12 },
      { titre: 'Cours', format: 'nombre', largeur: 12 },
      { titre: 'Devise', largeur: 8 },
      { titre: 'Valeur de marché', format: 'euro', largeur: 16 },
      { titre: 'Plus-value', format: 'euro', largeur: 14 },
      { titre: 'Plus-value %', format: 'pourcent', largeur: 12 },
    ],
    lignes: entrees.etat.positions
      .filter(position => position.quantite.estPositif())
      .map(position => {
        const titre = titres.get(position.titreId);
        const valorisee = valorisation.get(`${position.compteId}|${position.titreId}`);
        return [
          comptes.get(position.compteId)?.nom ?? position.compteId,
          titre?.nom ?? position.titreId,
          titre?.isin.startsWith('SYMBOLE:') ? '' : titre?.isin,
          titre?.ticker,
          position.quantite.toNumber(),
          position.pru.toNumber(),
          n(entrees.cours.get(position.titreId)),
          titre?.deviseCotation ?? 'EUR',
          n(valorisee?.valeurMarche),
          n(valorisee?.plusValueLatente),
          n(valorisee?.plusValueLatentePct),
        ];
      }),
  };

  const operations: Feuille = {
    nom: 'Opérations',
    colonnes: [
      { titre: 'Date', format: 'date', largeur: 12 },
      { titre: 'Compte', largeur: 16 },
      { titre: 'Type', largeur: 11 },
      { titre: 'Valeur', largeur: 34 },
      { titre: 'Quantité', format: 'nombre' },
      { titre: 'Prix unitaire', format: 'nombre', largeur: 13 },
      { titre: 'Frais', format: 'euro' },
      { titre: 'Montant', format: 'euro', largeur: 14 },
      { titre: 'Devise', largeur: 8 },
      { titre: 'Note', largeur: 40 },
    ],
    lignes: [...entrees.transactions]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(transaction => {
        const titreId = 'titreId' in transaction ? transaction.titreId : undefined;
        const quantite = 'quantite' in transaction ? transaction.quantite.toNumber() : null;
        const prix = 'prixUnitaire' in transaction ? transaction.prixUnitaire.toNumber() : null;
        const frais = 'frais' in transaction ? transaction.frais.toNumber() : null;
        const montant =
          transaction.type === 'ACHAT'
            ? -(quantite! * prix! + frais!)
            : transaction.type === 'VENTE'
              ? quantite! * prix! - frais!
              : transaction.type === 'DIVIDENDE'
                ? transaction.montantNet.toNumber()
                : transaction.type === 'RETRAIT' || transaction.type === 'FRAIS'
                  ? -transaction.montant.toNumber()
                  : transaction.montant.toNumber();
        return [
          transaction.date,
          comptes.get(transaction.compteId)?.nom ?? transaction.compteId,
          LIBELLES_TYPE[transaction.type],
          titreId ? titres.get(titreId)?.nom ?? titreId : '',
          quantite,
          prix,
          frais,
          Math.round(montant * 100) / 100,
          transaction.devise,
          transaction.note,
        ];
      }),
  };

  const dividendes: Feuille = {
    nom: 'Dividendes',
    colonnes: [
      { titre: 'Date', format: 'date', largeur: 12 },
      { titre: 'Compte', largeur: 16 },
      { titre: 'Valeur', largeur: 34 },
      { titre: 'Net', format: 'euro' },
      { titre: 'Brut', format: 'euro' },
    ],
    lignes: entrees.transactions
      .filter((transaction): transaction is Extract<Transaction, { type: 'DIVIDENDE' }> => transaction.type === 'DIVIDENDE')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(transaction => [
        transaction.date,
        comptes.get(transaction.compteId)?.nom ?? transaction.compteId,
        titres.get(transaction.titreId)?.nom ?? transaction.titreId,
        transaction.montantNet.toNumber(),
        n(transaction.montantBrut),
      ]),
  };

  const feuilleComptes: Feuille = {
    nom: 'Comptes',
    colonnes: [
      { titre: 'Compte', largeur: 18 },
      { titre: 'Type', largeur: 8 },
      { titre: 'Ouverture', format: 'date', largeur: 12 },
      { titre: 'Versements cumulés', format: 'euro', largeur: 18 },
      { titre: 'Liquidités', format: 'euro', largeur: 14 },
      { titre: 'Valeur totale', format: 'euro', largeur: 16 },
    ],
    lignes: entrees.comptes.map(compte => {
      const etat = entrees.etat.comptes.get(compte.id);
      const valeur = totaux(
        valorisees.filter(position => position.compteId === compte.id),
        etat ? [etat] : [],
      ).valeurTotale;
      return [compte.nom, compte.type.replace('_', ' '), compte.dateOuverture, n(etat?.versementsCumules), n(etat?.cash), valeur.toNumber()];
    }),
  };

  return [positions, operations, dividendes, feuilleComptes];
}

export function exporterExcel(entrees: EntreesExport): Uint8Array {
  return creerClasseur(feuillesPortefeuille(entrees));
}
