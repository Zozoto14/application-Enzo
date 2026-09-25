/**
 * Modèle de données du portefeuille.
 *
 * Les transactions forment un journal immuable : c'est la seule source de
 * vérité. Les positions, le cash et les plus-values n'y sont pas stockés, ils
 * sont recalculés en rejouant le journal (voir portfolio/engine.ts). Une saisie
 * corrigée ne laisse donc jamais un solde incohérent derrière elle.
 */

import type { Decimal } from '../money/decimal';

/** Code ISO 4217. */
export type Devise = string;

export type TypeCompte = 'PEA' | 'PEA_PME' | 'CTO';

export interface Compte {
  id: string;
  nom: string;
  type: TypeCompte;
  /** Date d'ouverture au format ISO (AAAA-MM-JJ). Pour un PEA, c'est la date
   *  du premier versement : elle fait courir l'antériorité fiscale. */
  dateOuverture: string;
  /** Devise de tenue du compte, dans laquelle cash et PRU sont exprimés. */
  devise: Devise;
}

export interface Titre {
  id: string;
  isin: string;
  nom: string;
  ticker: string;
  /** Devise de cotation, qui peut différer de celle du compte (actions US sur CTO). */
  deviseCotation: Devise;
  secteur?: string;
  zoneGeographique?: string;
  eligiblePEA: boolean;
  /**
   * Adresse d'une fiche externe, collee par l'utilisateur.
   *
   * Elle ne se devine pas : chez Baggr, une valeur est designee par un
   * identifiant opaque qu'aucun ticker ni ISIN ne permet de reconstruire.
   * Mieux vaut la coller une fois que fabriquer un lien qui tombera a cote.
   */
  lienExterne?: string;
}

export type TypeTransaction =
  | 'ACHAT'
  | 'VENTE'
  | 'DIVIDENDE'
  | 'VERSEMENT'
  | 'RETRAIT'
  | 'FRAIS';

interface TransactionBase {
  id: string;
  compteId: string;
  /** Date d'exécution au format ISO (AAAA-MM-JJ). */
  date: string;
  /** Devise des montants de la ligne. */
  devise: Devise;
  /** Taux de conversion vers la devise du compte, obligatoire si `devise` en
   *  diffère. Le taux du jour de l'opération est figé ici : c'est aussi la
   *  règle fiscale française pour le prix de revient d'un titre étranger. */
  tauxChange?: Decimal;
  /** Note libre de l'utilisateur (thèse d'investissement, référence d'ordre). */
  note?: string;
}

export interface TransactionAchat extends TransactionBase {
  type: 'ACHAT';
  titreId: string;
  quantite: Decimal;
  prixUnitaire: Decimal;
  /** Frais de courtage, qui viennent majorer le prix de revient. */
  frais: Decimal;
}

export interface TransactionVente extends TransactionBase {
  type: 'VENTE';
  titreId: string;
  quantite: Decimal;
  prixUnitaire: Decimal;
  /** Frais de courtage, qui viennent minorer le produit de cession. */
  frais: Decimal;
}

export interface TransactionDividende extends TransactionBase {
  type: 'DIVIDENDE';
  titreId: string;
  /** Montant effectivement crédité sur le compte. */
  montantNet: Decimal;
  /** Montant avant retenue à la source, quand il est connu. */
  montantBrut?: Decimal;
}

export interface TransactionVersement extends TransactionBase {
  type: 'VERSEMENT';
  montant: Decimal;
}

export interface TransactionRetrait extends TransactionBase {
  type: 'RETRAIT';
  montant: Decimal;
}

export interface TransactionFrais extends TransactionBase {
  type: 'FRAIS';
  montant: Decimal;
  /** Renseigné si les frais sont rattachables à un titre (droits de garde). */
  titreId?: string;
}

export type Transaction =
  | TransactionAchat
  | TransactionVente
  | TransactionDividende
  | TransactionVersement
  | TransactionRetrait
  | TransactionFrais;

/** Position détenue sur un titre dans un compte donné, dérivée du journal. */
export interface Position {
  compteId: string;
  titreId: string;
  quantite: Decimal;
  /** Prix de revient total restant, frais d'acquisition inclus. */
  coutTotal: Decimal;
  /** Prix de revient unitaire = coutTotal / quantite (moyenne pondérée). */
  pru: Decimal;
}

/** Cession réalisée, c'est-à-dire une vente et son résultat fiscal. */
export interface Cession {
  transactionId: string;
  compteId: string;
  titreId: string;
  date: string;
  annee: number;
  quantite: Decimal;
  prixUnitaire: Decimal;
  frais: Decimal;
  /** Produit de cession net de frais. */
  produitNet: Decimal;
  /** PRU au moment de la vente. */
  pru: Decimal;
  /** Prix de revient de la quantité cédée = pru * quantite. */
  prixRevient: Decimal;
  /** Positive : plus-value. Négative : moins-value. */
  plusValue: Decimal;
}

/** Agrégats par compte, dérivés du journal. */
export interface EtatCompte {
  compteId: string;
  /** Liquidités disponibles. */
  cash: Decimal;
  /** Cumul des versements, qui sert au suivi du plafond PEA. */
  versementsCumules: Decimal;
  retraitsCumules: Decimal;
  dividendesPercus: Decimal;
  /** Cumul de tous les frais supportés, courtage inclus. */
  fraisCumules: Decimal;
}
