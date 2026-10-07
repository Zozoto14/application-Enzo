/**
 * Aperçu d'un import de positions, avant écriture en base.
 *
 * Rien n'est enregistré tant que l'utilisateur n'a pas vu ce qui va l'être.
 * Un import de portefeuille est une opération qu'on ne refait pas volontiers :
 * mieux vaut une étape de plus qu'un journal à nettoyer à la main.
 *
 * L'aperçu dit aussi ce qu'il ne sait pas — lignes refusées, prix de revient
 * approchés, colonnes absentes — plutôt que de présenter un résultat lisse.
 */

import { Decimal } from '../../core/money/decimal';
import { importerPositions, type PositionImportee } from '../../core/import/positions';
import { MODELE_BOURSOBANK_POSITIONS } from '../../core/import/modeles';
import type { ModelePositions } from '../../core/import/positions';
import { formaterMontant, formaterQuantite } from '../format';

export interface LigneApercu {
  isin: string;
  nom: string;
  quantite: string;
  pru: string;
  coutTotal: string;
  /** Vrai si le prix de revient a dû être déduit d'un PRU arrondi. */
  approche: boolean;
}

export interface AnomalieApercu {
  ligne: number;
  message: string;
}

export interface ApercuImport {
  lignes: LigneApercu[];
  anomalies: AnomalieApercu[];
  /** Colonnes attendues par le modèle et absentes du fichier collé. */
  colonnesManquantes: string[];
  /** Coût de revient total des positions lisibles. */
  total: string;
  /** Vrai si au moins une position est exploitable. */
  pret: boolean;
  /** Messages à afficher avant de confirmer. */
  avertissements: string[];
  /** Positions brutes, à passer à `transactionsDeReprise` après confirmation. */
  positions: PositionImportee[];
}

const APERCU_VIDE: ApercuImport = {
  lignes: [],
  anomalies: [],
  colonnesManquantes: [],
  total: formaterMontant(Decimal.ZERO),
  pret: false,
  avertissements: [],
  positions: [],
};

export function apercuPositions(
  contenu: string,
  modele: ModelePositions = MODELE_BOURSOBANK_POSITIONS,
): ApercuImport {
  if (contenu.trim() === '') {
    return APERCU_VIDE;
  }

  const resultat = importerPositions(contenu, modele);

  if (resultat.colonnesManquantes.length > 0) {
    return {
      ...APERCU_VIDE,
      colonnesManquantes: resultat.colonnesManquantes,
      avertissements: [
        `Ce fichier ne correspond pas au modèle « ${modele.libelle} ». Colonnes attendues et absentes : ${resultat.colonnesManquantes.join(', ')}.`,
      ],
    };
  }

  const total = Decimal.somme(resultat.positions.map(p => p.coutTotal));
  const avertissements: string[] = [];

  if (resultat.positions.some(p => p.coutApproche)) {
    avertissements.push(
      'Le prix de revient de certaines lignes est déduit d’un montant arrondi au centime : il peut différer de quelques centimes du prix réellement payé.',
    );
  }
  if (resultat.anomalies.length > 0) {
    avertissements.push(
      `${resultat.anomalies.length} ligne(s) n’ont pas pu être lues et seront ignorées.`,
    );
  }
  if (resultat.positions.length > 0) {
    avertissements.push(
      'Un versement d’équilibre sera ajouté pour couvrir ce prix de revient, afin que le solde espèces ne devienne pas négatif. Son montant est approché pour le suivi du plafond PEA.',
    );
  }

  return {
    lignes: resultat.positions.map(position => ({
      isin: position.isin,
      nom: position.nom,
      quantite: formaterQuantite(position.quantite),
      pru: formaterMontant(position.pru),
      coutTotal: formaterMontant(position.coutTotal),
      approche: position.coutApproche,
    })),
    anomalies: resultat.anomalies.map(({ ligne, message }) => ({ ligne, message })),
    colonnesManquantes: [],
    total: formaterMontant(total),
    pret: resultat.positions.length > 0,
    avertissements,
    positions: resultat.positions,
  };
}
