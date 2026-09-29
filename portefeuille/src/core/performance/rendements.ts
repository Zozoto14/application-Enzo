/**
 * Mesures de performance : TWR, TRI, drawdown, volatilité.
 *
 * **Frontière assumée entre exact et approché.** Les montants restent des
 * `Decimal` : ce sont des euros, ils doivent tomber juste. Les taux, eux, sont
 * calculés en flottant. Un TRI se résout par approximations successives et une
 * volatilité passe par une racine carrée : exiger l'exactitude n'aurait pas de
 * sens, et la fausse précision serait trompeuse. La conversion se fait à la
 * frontière, jamais au milieu d'un calcul de montant.
 *
 * **Refuser vaut mieux que mentir.** Chaque mesure peut renvoyer
 * `indisponible` avec un motif lisible. C'est délibéré : un TWR calculé depuis
 * une valorisation quasi nulle donne des milliers de pour cent, et une
 * annualisation sur trois semaines en donne des milliards. Ces chiffres sont
 * affichés par des outils connus ; ils n'informent personne.
 */

import { Decimal } from '../money/decimal';

export interface PointValorisation {
  /** Date ISO du point. */
  date: string;
  /** Valeur totale du portefeuille, liquidités comprises. */
  valeurTotale: Decimal;
  /**
   * Flux externe net survenu depuis le point précédent : versements moins
   * retraits. Il gonfle la valeur sans être une performance, et c'est
   * précisément ce que le TWR neutralise.
   */
  fluxExterne: Decimal;
}

export interface Mesure {
  /** Valeur en pourcentage, `null` si la mesure n'a pas de sens ici. */
  valeur: number | null;
  /** Motif de l'indisponibilité, rédigé pour être affiché tel quel. */
  motif?: string;
}

const indisponible = (motif: string): Mesure => ({ valeur: null, motif });

/** Durée minimale avant d'accepter d'annualiser un rendement. */
export const JOURS_MINIMUM_ANNUALISATION = 90;

const MS_PAR_JOUR = 86_400_000;

export function joursEntre(debut: string, fin: string): number {
  const depart = Date.parse(`${debut}T00:00:00Z`);
  const arrivee = Date.parse(`${fin}T00:00:00Z`);
  if (Number.isNaN(depart) || Number.isNaN(arrivee)) {
    return NaN;
  }
  return (arrivee - depart) / MS_PAR_JOUR;
}

/**
 * Rendement pondéré par le temps (Time-Weighted Return).
 *
 * Chaîne les rendements de chaque sous-période, chacune délimitée par un point
 * de valorisation. Neutralise ainsi les versements et retraits : c'est la
 * mesure qui dit si les choix d'investissement ont été bons, indépendamment
 * du moment où l'argent est entré.
 *
 * Pour chaque sous-période : (V_fin - flux) / V_début - 1.
 */
export function twr(points: readonly PointValorisation[]): Mesure {
  if (points.length < 2) {
    return indisponible(
      'Au moins deux valorisations à des dates différentes sont nécessaires.',
    );
  }

  let facteur = 1;
  let sousPeriodes = 0;

  for (let i = 1; i < points.length; i++) {
    const debut = points[i - 1].valeurTotale;
    const fin = points[i].valeurTotale;
    const flux = points[i].fluxExterne;

    if (!debut.estPositif()) {
      // Diviser par une valorisation nulle ou négative produit les rendements
      // aberrants de plusieurs milliers de pour cent que l'on voit ailleurs.
      return indisponible(
        `La valorisation du ${points[i - 1].date} est nulle ou négative : le rendement ne peut pas être calculé sur cette période.`,
      );
    }

    facteur *= fin.sub(flux).div(debut).toNumber();
    sousPeriodes++;
  }

  if (sousPeriodes === 0) {
    return indisponible('Aucune sous-période exploitable.');
  }

  return { valeur: (facteur - 1) * 100 };
}

/** Annualise un rendement cumulé, en refusant les périodes trop courtes. */
export function annualiser(rendementPourcent: number, jours: number): Mesure {
  if (!Number.isFinite(jours) || jours <= 0) {
    return indisponible('Période invalide.');
  }
  if (jours < JOURS_MINIMUM_ANNUALISATION) {
    // Annualiser trois semaines de hausse donne des chiffres à plusieurs
    // chiffres qui n'informent sur rien.
    return indisponible(
      `Période trop courte pour être annualisée (${Math.round(jours)} jours, ${JOURS_MINIMUM_ANNUALISATION} minimum).`,
    );
  }

  const base = 1 + rendementPourcent / 100;
  if (base <= 0) {
    return indisponible('Perte totale : le taux annualisé n’est pas défini.');
  }

  return { valeur: (base ** (365 / jours) - 1) * 100 };
}

export interface FluxDate {
  date: string;
  /** Positif : argent qui entre dans le portefeuille. Négatif : qui en sort. */
  montant: Decimal;
}

/**
 * Taux de rentabilité interne (TRI, ou Money-Weighted Return).
 *
 * Contrairement au TWR, il tient compte du moment des versements : c'est le
 * rendement réellement obtenu sur l'argent effectivement investi.
 *
 * Résolu par dichotomie plutôt que par Newton-Raphson : plus lent, mais il ne
 * diverge pas sur les séries de flux irrégulières, fréquentes sur un
 * portefeuille personnel.
 */
export function tri(flux: readonly FluxDate[]): Mesure {
  if (flux.length < 2) {
    return indisponible('Au moins deux mouvements sont nécessaires.');
  }

  const ordonnes = [...flux].sort((a, b) => (a.date < b.date ? -1 : 1));
  const depart = ordonnes[0].date;
  const montants = ordonnes.map(f => f.montant.toNumber());

  if (!montants.some(m => m > 0) || !montants.some(m => m < 0)) {
    return indisponible(
      'Le calcul exige au moins une entrée et une sortie d’argent.',
    );
  }

  const jours = ordonnes.map(f => joursEntre(depart, f.date));
  if (jours.some(j => !Number.isFinite(j))) {
    return indisponible('Dates invalides.');
  }
  if (jours[jours.length - 1] < JOURS_MINIMUM_ANNUALISATION) {
    // Le TRI est annualisé par construction : sur quelques semaines, il donne
    // les -77 % ou +900 % que l'on voit sur les portefeuilles récents.
    return indisponible(
      `Historique trop court pour un taux annualisé (${Math.round(jours[jours.length - 1])} jours, ${JOURS_MINIMUM_ANNUALISATION} minimum).`,
    );
  }

  const valeurActuelle = (taux: number): number =>
    montants.reduce(
      (somme, montant, i) => somme + montant / (1 + taux) ** (jours[i] / 365),
      0,
    );

  let bas = -0.9999;
  let haut = 10;
  if (valeurActuelle(bas) * valeurActuelle(haut) > 0) {
    return indisponible(
      'Aucun taux ne satisfait ces flux : la série est probablement incohérente.',
    );
  }

  for (let i = 0; i < 200; i++) {
    const milieu = (bas + haut) / 2;
    if (valeurActuelle(bas) * valeurActuelle(milieu) <= 0) {
      haut = milieu;
    } else {
      bas = milieu;
    }
  }

  return { valeur: ((bas + haut) / 2) * 100 };
}

export interface Drawdown {
  /** Plus forte baisse depuis un sommet, en pourcentage négatif. */
  perteMaximale: number;
  /** Baisse en cours par rapport au dernier sommet. */
  baisseEnCours: number;
  /** Date du creux le plus profond. */
  dateCreux?: string;
  /** Date du sommet précédant ce creux. */
  dateSommet?: string;
}

/** Plus forte baisse subie depuis un sommet. */
export function drawdown(points: readonly PointValorisation[]): Drawdown | null {
  if (points.length < 2) {
    return null;
  }

  let sommet = points[0].valeurTotale;
  let dateSommet = points[0].date;
  let perteMaximale = 0;
  let dateCreux: string | undefined;
  let sommetDuCreux: string | undefined;

  for (const point of points) {
    if (point.valeurTotale.gt(sommet)) {
      sommet = point.valeurTotale;
      dateSommet = point.date;
    }
    if (!sommet.estPositif()) {
      continue;
    }
    const baisse = point.valeurTotale.sub(sommet).div(sommet).toNumber() * 100;
    if (baisse < perteMaximale) {
      perteMaximale = baisse;
      dateCreux = point.date;
      sommetDuCreux = dateSommet;
    }
  }

  const dernier = points[points.length - 1];
  const baisseEnCours = sommet.estPositif()
    ? dernier.valeurTotale.sub(sommet).div(sommet).toNumber() * 100
    : 0;

  return { perteMaximale, baisseEnCours, dateCreux, dateSommet: sommetDuCreux };
}

/** Rendements période par période, en pourcentage, flux externes neutralisés. */
export function rendementsPeriodiques(points: readonly PointValorisation[]): number[] {
  const rendements: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const debut = points[i - 1].valeurTotale;
    if (!debut.estPositif()) {
      continue;
    }
    const fin = points[i].valeurTotale.sub(points[i].fluxExterne);
    rendements.push((fin.div(debut).toNumber() - 1) * 100);
  }
  return rendements;
}

/**
 * Volatilité : écart-type des rendements, annualisé.
 * `periodesParAn` vaut 252 pour des rendements quotidiens de marché, 12 pour
 * des rendements mensuels.
 */
export function volatilite(rendements: readonly number[], periodesParAn = 252): Mesure {
  if (rendements.length < 2) {
    return indisponible('Au moins deux rendements sont nécessaires.');
  }

  const moyenne = rendements.reduce((a, b) => a + b, 0) / rendements.length;
  // Estimateur sans biais : on divise par n-1, pas par n.
  const variance =
    rendements.reduce((somme, r) => somme + (r - moyenne) ** 2, 0) /
    (rendements.length - 1);

  return { valeur: Math.sqrt(variance) * Math.sqrt(periodesParAn) };
}

/**
 * Ratio de Sharpe : rendement excédentaire par unité de risque.
 * Au-dessus de 1, le rendement rémunère bien le risque pris.
 */
export function sharpe(
  rendementAnnualise: number,
  volatiliteAnnualisee: number,
  tauxSansRisque = 0,
): Mesure {
  if (!Number.isFinite(volatiliteAnnualisee) || volatiliteAnnualisee <= 0) {
    return indisponible('Volatilité nulle ou inconnue : le ratio n’est pas défini.');
  }
  return {
    valeur: (rendementAnnualise - tauxSansRisque) / volatiliteAnnualisee,
  };
}
