/** Constructeurs abrégés pour les tests, afin que les scénarios restent lisibles. */

import { Decimal, d, type ValeurDecimale } from '../money/decimal';
import type { Compte, Titre, Transaction } from '../domain/types';

let compteur = 0;
const prochainId = (prefixe: string): string => `${prefixe}-${++compteur}`;

export function compte(partiel: Partial<Compte> = {}): Compte {
  return {
    id: 'pea',
    nom: 'PEA Boursobank',
    type: 'PEA',
    dateOuverture: '2019-03-15',
    devise: 'EUR',
    ...partiel,
  };
}

export function titre(partiel: Partial<Titre> = {}): Titre {
  return {
    id: 'air-liquide',
    isin: 'FR0000120073',
    nom: 'Air Liquide',
    ticker: 'AI',
    deviseCotation: 'EUR',
    secteur: 'Matériaux',
    zoneGeographique: 'Europe',
    eligiblePEA: true,
    ...partiel,
  };
}

interface OptionsLigne {
  compteId?: string;
  titreId?: string;
  devise?: string;
  tauxChange?: ValeurDecimale;
}

export function versement(
  date: string,
  montant: ValeurDecimale,
  options: OptionsLigne = {},
): Transaction {
  return {
    id: prochainId('ver'),
    compteId: options.compteId ?? 'pea',
    date,
    devise: options.devise ?? 'EUR',
    tauxChange: options.tauxChange ? d(options.tauxChange) : undefined,
    type: 'VERSEMENT',
    montant: d(montant),
  };
}

export function retrait(
  date: string,
  montant: ValeurDecimale,
  options: OptionsLigne = {},
): Transaction {
  return {
    id: prochainId('ret'),
    compteId: options.compteId ?? 'pea',
    date,
    devise: options.devise ?? 'EUR',
    type: 'RETRAIT',
    montant: d(montant),
  };
}

export function achat(
  date: string,
  quantite: ValeurDecimale,
  prixUnitaire: ValeurDecimale,
  fraisCourtage: ValeurDecimale = 0,
  options: OptionsLigne = {},
): Transaction {
  return {
    id: prochainId('ach'),
    compteId: options.compteId ?? 'pea',
    date,
    devise: options.devise ?? 'EUR',
    tauxChange: options.tauxChange ? d(options.tauxChange) : undefined,
    type: 'ACHAT',
    titreId: options.titreId ?? 'air-liquide',
    quantite: d(quantite),
    prixUnitaire: d(prixUnitaire),
    frais: d(fraisCourtage),
  };
}

export function vente(
  date: string,
  quantite: ValeurDecimale,
  prixUnitaire: ValeurDecimale,
  fraisCourtage: ValeurDecimale = 0,
  options: OptionsLigne = {},
): Transaction {
  return {
    id: prochainId('ven'),
    compteId: options.compteId ?? 'pea',
    date,
    devise: options.devise ?? 'EUR',
    tauxChange: options.tauxChange ? d(options.tauxChange) : undefined,
    type: 'VENTE',
    titreId: options.titreId ?? 'air-liquide',
    quantite: d(quantite),
    prixUnitaire: d(prixUnitaire),
    frais: d(fraisCourtage),
  };
}

export function dividende(
  date: string,
  montantNet: ValeurDecimale,
  options: OptionsLigne & { montantBrut?: ValeurDecimale } = {},
): Transaction {
  return {
    id: prochainId('div'),
    compteId: options.compteId ?? 'pea',
    date,
    devise: options.devise ?? 'EUR',
    tauxChange: options.tauxChange ? d(options.tauxChange) : undefined,
    type: 'DIVIDENDE',
    titreId: options.titreId ?? 'air-liquide',
    montantNet: d(montantNet),
    montantBrut: options.montantBrut === undefined ? undefined : d(options.montantBrut),
  };
}

export function frais(
  date: string,
  montant: ValeurDecimale,
  options: OptionsLigne = {},
): Transaction {
  return {
    id: prochainId('fra'),
    compteId: options.compteId ?? 'pea',
    date,
    devise: options.devise ?? 'EUR',
    type: 'FRAIS',
    montant: d(montant),
  };
}

/** Comparaison lisible dans les rapports d'échec de Jest. */
export const valeur = (decimal: Decimal): string => decimal.toString();
