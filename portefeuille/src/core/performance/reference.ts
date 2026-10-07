/**
 * Comparaison à un indice de référence.
 *
 * La question — « est-ce que je fais mieux que le marché ? » — est légitime,
 * et presque toujours mal mesurée. Trois pièges, qu'on évite ici explicitement.
 *
 * **Comparer la même période.** Un portefeuille suivi depuis trois mois ne se
 * compare pas à la performance annuelle d'un indice. On borne donc les deux
 * séries à leur intersection, et on refuse s'il n'en reste rien.
 *
 * **Comparer la bonne performance.** Le rendement brut d'un portefeuille
 * alimenté par des versements réguliers monte sans rien devoir au marché.
 * C'est le TWR, neutre aux versements, qui se compare à un indice — jamais le
 * gain total.
 *
 * **Un indice n'est pas un objectif.** Le bêta et l'alpha sont fournis avec
 * leurs conditions de validité, et refusés en dessous.
 *
 * Aucune donnée d'indice n'est fabriquée : la référence est une valeur comme
 * une autre, dont les cours viennent du même historique que les vôtres.
 */

import type { PointValorisation } from './rendements';
import { annualiser, joursEntre, twr, type Mesure } from './rendements';
import { coursALaDate, type CoursDate } from './serie';
import {
  OBSERVATIONS_MINIMUM_CORRELATION,
  correlation,
  rendementsDeSerie,
} from './risque';

export interface ComparaisonReference {
  /** Performance du portefeuille sur la période commune, en pourcentage. */
  portefeuille: Mesure;
  /** Performance de la référence sur la même période. */
  reference: Mesure;
  /** Écart des deux, en points de pourcentage. */
  ecart: Mesure;
  /** Performance annualisée du portefeuille. */
  portefeuilleAnnualise: Mesure;
  referenceAnnualisee: Mesure;
  /** Sensibilité aux mouvements de la référence. */
  beta: Mesure;
  /**
   * Rendement au-delà de ce que le bêta expliquerait, **sur la période
   * comparée** — la même base que `portefeuille` et `reference`, et non une
   * valeur annualisée qui exigerait trois mois d'historique là où le bêta
   * n'en demande que trente relevés.
   */
  alpha: Mesure;
  /** Corrélation avec la référence. */
  correlation: Mesure;
  /** Première et dernière date réellement comparées. */
  debut?: string;
  fin?: string;
  jours: number;
}

/** Points minimaux pour comparer deux séries sur une période commune. */
export const POINTS_MINIMUM_COMPARAISON = 2;

function indisponible(motif: string): Mesure {
  return { valeur: null, motif };
}

function vide(motif: string): ComparaisonReference {
  const mesure = indisponible(motif);
  return {
    portefeuille: mesure,
    reference: mesure,
    ecart: mesure,
    portefeuilleAnnualise: mesure,
    referenceAnnualisee: mesure,
    beta: mesure,
    alpha: mesure,
    correlation: mesure,
    jours: 0,
  };
}

/**
 * Compare un portefeuille à une référence sur leur période commune.
 *
 * `serieReference` est l'historique de cours de la valeur choisie comme
 * référence : un tracker, un indice saisi à la main, peu importe. Chaque date
 * de valorisation est rapprochée du dernier cours connu de la référence à
 * cette date — jamais d'un cours postérieur.
 */
export function comparerAReference(
  points: readonly PointValorisation[],
  serieReference: readonly CoursDate[],
  observationsMinimum = OBSERVATIONS_MINIMUM_CORRELATION,
): ComparaisonReference {
  if (points.length < POINTS_MINIMUM_COMPARAISON) {
    return vide(
      'Il faut au moins deux valorisations du portefeuille pour le comparer à quoi que ce soit.',
    );
  }
  if (serieReference.length < POINTS_MINIMUM_COMPARAISON) {
    return vide(
      'La référence choisie n’a pas assez de cours enregistrés. Rafraîchissez les cours, ou saisissez-en à la main.',
    );
  }

  // Periode commune : on ne compare pas trois mois de portefeuille a un an
  // d'indice. La reference doit exister avant le premier point retenu.
  const debutReference = serieReference[0].date;
  const finReference = serieReference[serieReference.length - 1].date;
  const communs = points.filter(
    point => point.date >= debutReference && point.date <= finReference,
  );

  if (communs.length < POINTS_MINIMUM_COMPARAISON) {
    return vide(
      `Aucune période commune exploitable. La référence court du ${debutReference} au ${finReference}, votre historique est ailleurs.`,
    );
  }

  const debut = communs[0].date;
  const fin = communs[communs.length - 1].date;
  const jours = joursEntre(debut, fin);

  // Le TWR neutralise les versements : c'est la seule performance qui se
  // compare a un indice. Le gain total monterait avec les seuls apports.
  const mesurePortefeuille = twr(communs);

  const coursDebut = coursALaDate(serieReference, debut);
  const coursFin = coursALaDate(serieReference, fin);
  const mesureReference: Mesure =
    coursDebut && coursFin && coursDebut.estPositif()
      ? { valeur: (coursFin.div(coursDebut).toNumber() - 1) * 100 }
      : indisponible('Cours de référence absent aux bornes de la période.');

  const ecart: Mesure =
    mesurePortefeuille.valeur !== null && mesureReference.valeur !== null
      ? { valeur: mesurePortefeuille.valeur - mesureReference.valeur }
      : indisponible(mesurePortefeuille.motif ?? mesureReference.motif ?? '');

  const portefeuilleAnnualise =
    mesurePortefeuille.valeur === null
      ? mesurePortefeuille
      : annualiser(mesurePortefeuille.valeur, jours);
  const referenceAnnualisee =
    mesureReference.valeur === null
      ? mesureReference
      : annualiser(mesureReference.valeur, jours);

  // ---- Beta, alpha, correlation : sur les rendements periode par periode.

  const rendementsPortefeuille: number[] = [];
  const rendementsReference: number[] = [];

  for (let index = 1; index < communs.length; index++) {
    const avant = communs[index - 1];
    const apres = communs[index];
    const refAvant = coursALaDate(serieReference, avant.date);
    const refApres = coursALaDate(serieReference, apres.date);

    if (
      !refAvant ||
      !refApres ||
      !refAvant.estPositif() ||
      !avant.valeurTotale.estPositif()
    ) {
      continue;
    }

    // Le flux externe de la periode est retire : un versement n'est pas une
    // performance.
    const flux = apres.fluxExterne.toNumber();
    const debutValeur = avant.valeurTotale.toNumber();
    const finValeur = apres.valeurTotale.toNumber();

    rendementsPortefeuille.push((finValeur - flux) / debutValeur - 1);
    rendementsReference.push(refApres.div(refAvant).toNumber() - 1);
  }

  const mesureCorrelation = correlation(
    rendementsPortefeuille,
    rendementsReference,
    observationsMinimum,
  );

  const beta = calculerBeta(
    rendementsPortefeuille,
    rendementsReference,
    observationsMinimum,
  );

  // Alpha sur la periode, pas annualise : il doit etre disponible des que le
  // beta l'est, et se lire sur la meme base que les deux performances
  // affichees au-dessus.
  const alpha: Mesure =
    beta.valeur !== null &&
    mesurePortefeuille.valeur !== null &&
    mesureReference.valeur !== null
      ? { valeur: mesurePortefeuille.valeur - beta.valeur * mesureReference.valeur }
      : indisponible(
          beta.motif ??
            mesurePortefeuille.motif ??
            mesureReference.motif ??
            'Alpha incalculable.',
        );

  return {
    portefeuille: mesurePortefeuille,
    reference: mesureReference,
    ecart,
    portefeuilleAnnualise,
    referenceAnnualisee,
    beta,
    alpha,
    correlation: mesureCorrelation,
    debut,
    fin,
    jours,
  };
}

/**
 * Bêta : sensibilité du portefeuille aux mouvements de la référence.
 *
 * Un bêta de 1 signifie qu'il suit l'indice point pour point ; 1,3 qu'il
 * amplifie de 30 % ; 0,6 qu'il amortit.
 */
export function calculerBeta(
  rendementsPortefeuille: readonly number[],
  rendementsReference: readonly number[],
  observationsMinimum = OBSERVATIONS_MINIMUM_CORRELATION,
): Mesure {
  const taille = Math.min(rendementsPortefeuille.length, rendementsReference.length);

  if (taille < observationsMinimum) {
    return indisponible(
      `${taille} période(s) communes, ${observationsMinimum} nécessaires. Un bêta calculé sur moins n’est qu’un accident de mesure.`,
    );
  }

  const portefeuille = rendementsPortefeuille.slice(0, taille);
  const reference = rendementsReference.slice(0, taille);
  const moyennePortefeuille =
    portefeuille.reduce((somme, valeur) => somme + valeur, 0) / taille;
  const moyenneReference =
    reference.reduce((somme, valeur) => somme + valeur, 0) / taille;

  let covariance = 0;
  let varianceReference = 0;

  for (let index = 0; index < taille; index++) {
    const ecartReference = reference[index] - moyenneReference;
    covariance += (portefeuille[index] - moyennePortefeuille) * ecartReference;
    varianceReference += ecartReference * ecartReference;
  }

  if (varianceReference === 0) {
    return indisponible(
      'La référence n’a pas bougé sur la période. Le bêta divise par cette variation : il n’est pas défini.',
    );
  }

  return { valeur: covariance / varianceReference };
}

/** Rendements d'une série de cours, exposés pour les vues. */
export { rendementsDeSerie };
