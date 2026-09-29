/**
 * Mesures de risque : corrélation, concentration, contribution à la volatilité.
 *
 * Deux principes gouvernent ce fichier.
 *
 * **Le nombre d'observations fait la mesure.** Une corrélation calculée sur
 * cinq points est un nombre, pas une information : deux séries quelconques
 * donnent facilement 0,9 par hasard. Chaque fonction exige donc un minimum
 * d'observations et refuse en disant pourquoi, plutôt que de rendre un chiffre
 * qu'on prendrait au sérieux.
 *
 * **Les corrélations se calculent sur des dates communes.** Deux titres dont
 * les relevés ne tombent pas les mêmes jours ne se comparent pas point par
 * point : on aligne d'abord, et on compte ce qui reste.
 *
 * Comme pour les rendements, la frontière est nette : les montants restent des
 * `Decimal`, les statistiques se calculent en virgule flottante. Une
 * corrélation n'a pas de centimes.
 */

import { Decimal } from '../money/decimal';
import type { CoursDate } from './serie';
import type { Mesure } from './rendements';

/**
 * Observations minimales pour qu'une corrélation veuille dire quelque chose.
 *
 * Trente est le seuil usuel : en dessous, l'intervalle de confiance est si
 * large que le signe lui-même n'est pas acquis.
 */
export const OBSERVATIONS_MINIMUM_CORRELATION = 30;

/** Rendements successifs d'une série de cours, en proportion. */
export function rendementsDeSerie(serie: readonly CoursDate[]): number[] {
  const rendements: number[] = [];

  for (let index = 1; index < serie.length; index++) {
    const precedent = serie[index - 1].cloture.toNumber();
    const courant = serie[index].cloture.toNumber();
    if (precedent === 0) {
      continue;
    }
    rendements.push(courant / precedent - 1);
  }
  return rendements;
}

/**
 * Aligne deux séries sur leurs dates communes.
 *
 * Sans cet alignement, on comparerait le lundi de l'une au mercredi de
 * l'autre, ce qui fabrique une corrélation de toutes pièces.
 */
export function alignerSeries(
  a: readonly CoursDate[],
  b: readonly CoursDate[],
): { dates: string[]; a: Decimal[]; b: Decimal[] } {
  const parDateB = new Map(b.map(point => [point.date, point.cloture]));
  const dates: string[] = [];
  const valeursA: Decimal[] = [];
  const valeursB: Decimal[] = [];

  for (const point of a) {
    const correspondant = parDateB.get(point.date);
    if (correspondant) {
      dates.push(point.date);
      valeursA.push(point.cloture);
      valeursB.push(correspondant);
    }
  }
  return { dates, a: valeursA, b: valeursB };
}

function moyenne(valeurs: readonly number[]): number {
  return valeurs.reduce((somme, valeur) => somme + valeur, 0) / valeurs.length;
}

/**
 * Corrélation de Pearson entre deux séries de rendements.
 *
 * Rend `null` avec un motif quand elle ne veut rien dire : trop peu
 * d'observations, ou une série plate dont l'écart-type est nul.
 */
export function correlation(
  rendementsA: readonly number[],
  rendementsB: readonly number[],
  observationsMinimum = OBSERVATIONS_MINIMUM_CORRELATION,
): Mesure {
  const taille = Math.min(rendementsA.length, rendementsB.length);

  if (taille < observationsMinimum) {
    return {
      valeur: null,
      motif: `${taille} observation(s) communes, ${observationsMinimum} nécessaires. Sur moins, deux séries quelconques donnent facilement une corrélation forte par hasard.`,
    };
  }

  const a = rendementsA.slice(0, taille);
  const b = rendementsB.slice(0, taille);
  const moyenneA = moyenne(a);
  const moyenneB = moyenne(b);

  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;

  for (let index = 0; index < taille; index++) {
    const ecartA = a[index] - moyenneA;
    const ecartB = b[index] - moyenneB;
    covariance += ecartA * ecartB;
    varianceA += ecartA * ecartA;
    varianceB += ecartB * ecartB;
  }

  if (varianceA === 0 || varianceB === 0) {
    return {
      valeur: null,
      motif:
        'Une des deux séries ne bouge pas. La corrélation avec une constante n’est pas définie.',
    };
  }

  return { valeur: covariance / Math.sqrt(varianceA * varianceB) };
}

/** Corrélation entre deux titres, à partir de leurs historiques de cours. */
export function correlationEntreTitres(
  serieA: readonly CoursDate[],
  serieB: readonly CoursDate[],
  observationsMinimum = OBSERVATIONS_MINIMUM_CORRELATION,
): Mesure {
  const alignees = alignerSeries(serieA, serieB);
  const rendementsA = rendementsDeSerie(
    alignees.dates.map((date, index) => ({ date, cloture: alignees.a[index] })),
  );
  const rendementsB = rendementsDeSerie(
    alignees.dates.map((date, index) => ({ date, cloture: alignees.b[index] })),
  );

  return correlation(rendementsA, rendementsB, observationsMinimum);
}

// ------------------------------------------------------------ Concentration

export interface Poids {
  cle: string;
  /** Part dans le total, entre 0 et 1. */
  poids: number;
}

export interface Concentration {
  /** Indice de Herfindahl-Hirschman, entre 0 et 1. */
  herfindahl: number;
  /**
   * Nombre de lignes équipondérées qui donnerait la même concentration.
   * Un portefeuille de dix lignes dont une pèse 80 % « vaut » 1,5 ligne.
   */
  lignesEquivalentes: number;
  /** Part de la plus grosse ligne, entre 0 et 1. */
  premierePart: number;
  /** Nombre de lignes nécessaires pour atteindre la moitié du portefeuille. */
  lignesPourMoitie: number;
  nombreLignes: number;
}

/**
 * Mesure la concentration d'un ensemble de poids.
 *
 * Le nombre de lignes ne dit rien à lui seul : dix lignes dont une pèse 80 %
 * sont moins diversifiées que trois lignes égales. Le nombre de lignes
 * équivalentes traduit cela en une grandeur qui se lit sans formation.
 */
export function concentration(poids: readonly Poids[]): Concentration | null {
  if (poids.length === 0) {
    return null;
  }

  const total = poids.reduce((somme, ligne) => somme + ligne.poids, 0);
  if (total <= 0) {
    return null;
  }

  const normalises = poids
    .map(ligne => ligne.poids / total)
    .sort((a, b) => b - a);

  const herfindahl = normalises.reduce((somme, part) => somme + part * part, 0);

  let cumul = 0;
  let lignesPourMoitie = 0;
  for (const part of normalises) {
    cumul += part;
    lignesPourMoitie++;
    if (cumul >= 0.5) {
      break;
    }
  }

  return {
    herfindahl,
    lignesEquivalentes: 1 / herfindahl,
    premierePart: normalises[0],
    lignesPourMoitie,
    nombreLignes: normalises.length,
  };
}

/** Poids d'une liste de montants, pour alimenter `concentration`. */
export function poidsDepuisMontants(
  montants: readonly { cle: string; montant: Decimal }[],
): Poids[] {
  const total = Decimal.somme(montants.map(ligne => ligne.montant));
  if (!total.estPositif()) {
    return [];
  }
  return montants.map(ligne => ({
    cle: ligne.cle,
    poids: ligne.montant.div(total).toNumber(),
  }));
}

// -------------------------------------------------- Contribution au risque

export interface ContributionRisque {
  cle: string;
  /** Part dans le portefeuille, entre 0 et 1. */
  poids: number;
  /** Volatilité annualisée de la ligne, en pourcentage. */
  volatilite: number;
  /**
   * Part du risque total imputable à cette ligne, entre 0 et 1.
   *
   * Approximation délibérée : elle ignore les corrélations et ne pondère que
   * par la volatilité propre. Elle répond à « d'où vient l'agitation ? », pas
   * à « quel est le risque exact du portefeuille ». Le second demande une
   * matrice de covariance complète, donc bien plus d'historique.
   */
  part: number;
}

/**
 * Répartit le risque entre les lignes, au prorata de poids × volatilité.
 *
 * Utile parce que l'intuition se trompe : une ligne qui pèse 10 % mais bouge
 * trois fois plus que les autres pèse bien davantage dans l'agitation
 * quotidienne du portefeuille que son poids ne le laisse croire.
 */
export function contributionsAuRisque(
  lignes: readonly { cle: string; poids: number; volatilite: number }[],
): ContributionRisque[] {
  const total = lignes.reduce(
    (somme, ligne) => somme + ligne.poids * ligne.volatilite,
    0,
  );

  return lignes
    .map(ligne => ({
      cle: ligne.cle,
      poids: ligne.poids,
      volatilite: ligne.volatilite,
      part: total > 0 ? (ligne.poids * ligne.volatilite) / total : 0,
    }))
    .sort((a, b) => b.part - a.part);
}
