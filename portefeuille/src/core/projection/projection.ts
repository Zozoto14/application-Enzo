/**
 * Projections d'épargne et d'indépendance financière.
 *
 * Une projection n'est pas une prévision. Elle répond à « si le rendement
 * moyen était de tant, où serais-je dans quinze ans ? » — une question sur une
 * hypothèse, pas sur l'avenir.
 *
 * Quatre choses sont donc traitées explicitement, parce que les omettre est ce
 * qui rend la plupart des simulateurs trompeurs.
 *
 * **L'inflation.** Sur vingt ans, 2 % par an divisent le pouvoir d'achat par
 * 1,5. Une projection nominale de 500 000 € n'est pas une projection de
 * 500 000 € d'aujourd'hui. On rend donc toujours les deux.
 *
 * **Les frais.** Ils se retranchent du rendement chaque année, et ils
 * composent comme lui. 0,5 % de frais sur trente ans, c'est environ 15 % du
 * capital final.
 *
 * **La dispersion.** Un rendement moyen ne se produit presque jamais. Trois
 * scénarios sont calculés, et l'écart entre eux est l'information principale.
 *
 * **La règle des 4 %.** Elle vient d'une étude américaine sur trente ans de
 * retraite, en dollars, sans impôt français ni prélèvements sociaux. Le taux
 * est un réglage, pas une vérité, et la limite est écrite.
 */

import { Decimal } from '../money/decimal';

/** Taux de retrait annuel par défaut, en pourcentage. */
export const TAUX_RETRAIT_DEFAUT = 4;

/** Inflation annuelle par défaut, en pourcentage — cible de la BCE. */
export const INFLATION_DEFAUT = 2;

/** Horizon maximal simulé, en années. Au-delà, le chiffre n'informe plus. */
export const HORIZON_MAXIMUM = 50;

export interface HypothesesProjection {
  /** Capital de départ. */
  capital: Decimal;
  /** Versement mensuel régulier. */
  versementMensuel: Decimal;
  /** Rendement annuel moyen espéré, en pourcentage, avant frais. */
  rendementAnnuel: number;
  /** Frais annuels, en pourcentage du capital. */
  fraisAnnuels?: number;
  /** Inflation annuelle, en pourcentage. */
  inflation?: number;
  /** Durée simulée, en années. */
  annees: number;
  /** Progression annuelle du versement, en pourcentage. */
  indexationVersement?: number;
}

export interface PointProjection {
  annee: number;
  /** Capital en euros courants. */
  nominal: Decimal;
  /** Capital en euros d'aujourd'hui, inflation déduite. */
  reel: Decimal;
  /** Cumul de ce que vous avez versé, capital de départ inclus. */
  verse: Decimal;
  /** Part du capital qui vient des intérêts plutôt que des versements. */
  interets: Decimal;
}

export interface Projection {
  points: PointProjection[];
  /** Dernier point, pour l'affichage en tête. */
  final: PointProjection;
  /** Rendement réellement appliqué, frais déduits. */
  rendementNet: number;
  /** Année où les intérêts dépassent les versements, si elle arrive. */
  anneeBascule?: number;
}

function valide(hypotheses: HypothesesProjection): number {
  return Math.max(0, Math.min(HORIZON_MAXIMUM, Math.floor(hypotheses.annees)));
}

/**
 * Projette le capital année par année.
 *
 * Les versements sont supposés faits en début de mois et capitalisés sur
 * l'année : c'est l'hypothèse la plus proche d'un virement permanent, et elle
 * majore légèrement le résultat par rapport à un versement de fin d'année.
 */
export function projeter(hypotheses: HypothesesProjection): Projection {
  const annees = valide(hypotheses);
  const frais = hypotheses.fraisAnnuels ?? 0;
  const inflation = hypotheses.inflation ?? INFLATION_DEFAUT;
  const indexation = hypotheses.indexationVersement ?? 0;

  const rendementNet = hypotheses.rendementAnnuel - frais;
  const tauxMensuel = Math.pow(1 + rendementNet / 100, 1 / 12) - 1;

  let capital = hypotheses.capital.toNumber();
  let verse = hypotheses.capital.toNumber();
  let mensuel = hypotheses.versementMensuel.toNumber();

  const points: PointProjection[] = [
    {
      annee: 0,
      nominal: hypotheses.capital,
      reel: hypotheses.capital,
      verse: hypotheses.capital,
      interets: Decimal.ZERO,
    },
  ];

  let anneeBascule: number | undefined;

  for (let annee = 1; annee <= annees; annee++) {
    for (let mois = 0; mois < 12; mois++) {
      // Versement en debut de mois, puis capitalisation : l'ordre compte, et
      // c'est celui d'un virement permanent.
      capital += mensuel;
      verse += mensuel;
      capital *= 1 + tauxMensuel;
    }
    mensuel *= 1 + indexation / 100;

    const interets = capital - verse;
    const reel = capital / Math.pow(1 + inflation / 100, annee);

    if (anneeBascule === undefined && interets > verse) {
      anneeBascule = annee;
    }

    points.push({
      annee,
      nominal: Decimal.de(capital.toFixed(2)),
      reel: Decimal.de(reel.toFixed(2)),
      verse: Decimal.de(verse.toFixed(2)),
      interets: Decimal.de(interets.toFixed(2)),
    });
  }

  return {
    points,
    final: points[points.length - 1],
    rendementNet,
    anneeBascule,
  };
}

// ---------------------------------------------------------- Trois scénarios

export interface Scenarios {
  prudent: Projection;
  central: Projection;
  favorable: Projection;
  /** Écart entre le scénario favorable et le prudent, en euros réels. */
  dispersion: Decimal;
}

/** Écart appliqué au rendement central pour borner les scénarios, en points. */
export const ECART_SCENARIOS = 3;

/**
 * Trois scénarios autour du rendement central.
 *
 * L'écart entre le prudent et le favorable est l'information principale : il
 * dit à quel point la projection dépend d'une hypothèse qu'on ne maîtrise pas.
 * Un simulateur qui ne rend qu'un chiffre cache précisément cela.
 */
export function scenarios(
  hypotheses: HypothesesProjection,
  ecart = ECART_SCENARIOS,
): Scenarios {
  const prudent = projeter({
    ...hypotheses,
    rendementAnnuel: hypotheses.rendementAnnuel - ecart,
  });
  const central = projeter(hypotheses);
  const favorable = projeter({
    ...hypotheses,
    rendementAnnuel: hypotheses.rendementAnnuel + ecart,
  });

  return {
    prudent,
    central,
    favorable,
    dispersion: favorable.final.reel.sub(prudent.final.reel),
  };
}

// ------------------------------------------------------- Indépendance

export interface ObjectifIndependance {
  /** Dépenses annuelles à couvrir, en euros d'aujourd'hui. */
  depensesAnnuelles: Decimal;
  /** Taux de retrait annuel retenu, en pourcentage. */
  tauxRetrait?: number;
}

export interface ResultatIndependance {
  /** Capital nécessaire, en euros d'aujourd'hui. */
  capitalNecessaire: Decimal;
  /** Années avant de l'atteindre, `null` si l'horizon simulé n'y suffit pas. */
  annees: number | null;
  /** Part du chemin déjà parcourue, entre 0 et 1. */
  progression: number;
  /** Explication quand l'objectif n'est pas atteint dans l'horizon. */
  motif?: string;
}

/**
 * Capital nécessaire pour couvrir des dépenses, et le temps pour y arriver.
 *
 * Le capital est comparé à la projection **réelle**, pas nominale : un
 * objectif exprimé en euros d'aujourd'hui doit se mesurer en euros
 * d'aujourd'hui, faute de quoi l'inflation offre une indépendance qui n'existe
 * pas.
 */
export function independance(
  projection: Projection,
  objectif: ObjectifIndependance,
): ResultatIndependance {
  const taux = objectif.tauxRetrait ?? TAUX_RETRAIT_DEFAUT;

  if (taux <= 0) {
    return {
      capitalNecessaire: Decimal.ZERO,
      annees: null,
      progression: 0,
      motif: 'Un taux de retrait nul ou négatif ne définit aucun capital cible.',
    };
  }

  const necessaire = objectif.depensesAnnuelles.div(Decimal.de(taux)).mul(100);

  const atteint = projection.points.find(point => point.reel.gte(necessaire));
  const dernier = projection.final;
  const progression = necessaire.estPositif()
    ? Math.min(1, dernier.reel.div(necessaire).toNumber())
    : 1;

  return {
    capitalNecessaire: necessaire,
    annees: atteint ? atteint.annee : null,
    progression,
    motif: atteint
      ? undefined
      : `L’objectif n’est pas atteint dans les ${projection.points.length - 1} année(s) simulées. Augmentez l’horizon, le versement, ou revoyez les dépenses visées.`,
  };
}

/**
 * Nombre d'années de dépenses que le capital actuel couvre déjà.
 *
 * Mesure volontairement simple, et honnête sur ce qu'elle ignore : elle ne
 * suppose aucun rendement, aucune inflation, aucun impôt. Elle répond à
 * « combien de temps je tiendrais en m'arrêtant demain », rien de plus.
 */
export function anneesDeDepensesCouvertes(
  capital: Decimal,
  depensesAnnuelles: Decimal,
): number | null {
  if (!depensesAnnuelles.estPositif()) {
    return null;
  }
  return capital.div(depensesAnnuelles).toNumber();
}
