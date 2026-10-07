/**
 * Règles propres au PEA et au PEA-PME.
 *
 * Attention : ce module produit des estimations indicatives destinées à
 * préparer une décision, jamais une déclaration officielle. Les cas
 * particuliers (retrait anticipé pour création d'entreprise, licenciement,
 * invalidité, mise à la retraite, titres non cotés) ne sont pas traités.
 */

import { Decimal, d } from '../money/decimal';
import type { Compte, TypeCompte } from '../domain/types';

/** Plafond de versements sur un PEA classique. */
export const PLAFOND_PEA = d('150000');

/** Plafond de versements sur un PEA-PME. */
export const PLAFOND_PEA_PME = d('225000');

/** Plafond cumulé lorsque les deux plans sont détenus par la même personne. */
export const PLAFOND_GLOBAL_PEA_ET_PEA_PME = d('225000');

/** Durée de détention ouvrant droit à l'exonération d'impôt sur le revenu. */
export const ANNEES_EXONERATION_IR = 5;

const MOTIF_DATE = /^\d{4}-\d{2}-\d{2}$/;

function decomposer(date: string): { annee: number; mois: number; jour: number } {
  if (!MOTIF_DATE.test(date)) {
    throw new TypeError(`Date ISO attendue (AAAA-MM-JJ), reçu "${date}"`);
  }
  return {
    annee: Number(date.slice(0, 4)),
    mois: Number(date.slice(5, 7)),
    jour: Number(date.slice(8, 10)),
  };
}

/**
 * Nombre d'années révolues entre deux dates.
 * Renvoie une valeur négative si `aLaDate` précède l'ouverture.
 */
export function ancienneteEnAnnees(dateOuverture: string, aLaDate: string): number {
  const debut = decomposer(dateOuverture);
  const fin = decomposer(aLaDate);

  let annees = fin.annee - debut.annee;
  const anniversairePasse =
    fin.mois > debut.mois || (fin.mois === debut.mois && fin.jour >= debut.jour);
  if (!anniversairePasse) {
    annees -= 1;
  }
  return annees;
}

export function estPEA(type: TypeCompte): boolean {
  return type === 'PEA' || type === 'PEA_PME';
}

export function plafondDe(type: TypeCompte): Decimal | null {
  if (type === 'PEA') return PLAFOND_PEA;
  if (type === 'PEA_PME') return PLAFOND_PEA_PME;
  return null;
}

/**
 * Vrai si les gains du plan échappent à l'impôt sur le revenu en cas de
 * retrait à la date donnée. Les prélèvements sociaux restent dus dans tous
 * les cas : l'exonération ne porte que sur l'IR.
 */
export function estExonereImpotRevenu(compte: Compte, aLaDate: string): boolean {
  if (!estPEA(compte.type)) {
    return false;
  }
  return ancienneteEnAnnees(compte.dateOuverture, aLaDate) >= ANNEES_EXONERATION_IR;
}

export interface EtatPlafond {
  compteId: string;
  plafond: Decimal;
  verse: Decimal;
  /** Capacité de versement restante, jamais négative. */
  restant: Decimal;
  /** Montant au-delà du plafond, jamais négatif. */
  depassement: Decimal;
  /** Part du plafond consommée, en pourcentage. */
  pourcentageUtilise: Decimal;
}

/**
 * État du plafond de versement d'un plan.
 *
 * Seuls les versements comptent, et ils ne se « libèrent » pas : un retrait ne
 * restaure pas de capacité de versement.
 */
export function etatPlafond(compte: Compte, versementsCumules: Decimal): EtatPlafond {
  const plafond = plafondDe(compte.type);
  if (!plafond) {
    throw new TypeError(`Le compte ${compte.id} de type ${compte.type} n'a pas de plafond`);
  }
  const restant = Decimal.max(Decimal.ZERO, plafond.sub(versementsCumules));
  const depassement = Decimal.max(Decimal.ZERO, versementsCumules.sub(plafond));

  return {
    compteId: compte.id,
    plafond,
    verse: versementsCumules,
    restant,
    depassement,
    pourcentageUtilise: versementsCumules.div(plafond).mul(100),
  };
}

export interface EtatPlafondGlobal {
  plafond: Decimal;
  verse: Decimal;
  restant: Decimal;
  depassement: Decimal;
}

/**
 * Plafond global lorsque PEA et PEA-PME coexistent : la somme des versements
 * sur les deux plans ne peut pas dépasser 225 000 €, même si chaque plan pris
 * isolément respecte le sien.
 */
export function etatPlafondGlobal(
  versementsParCompte: ReadonlyArray<{ compte: Compte; versementsCumules: Decimal }>,
): EtatPlafondGlobal {
  const verse = Decimal.somme(
    versementsParCompte
      .filter(({ compte }) => estPEA(compte.type))
      .map(({ versementsCumules }) => versementsCumules),
  );

  return {
    plafond: PLAFOND_GLOBAL_PEA_ET_PEA_PME,
    verse,
    restant: Decimal.max(Decimal.ZERO, PLAFOND_GLOBAL_PEA_ET_PEA_PME.sub(verse)),
    depassement: Decimal.max(Decimal.ZERO, verse.sub(PLAFOND_GLOBAL_PEA_ET_PEA_PME)),
  };
}
