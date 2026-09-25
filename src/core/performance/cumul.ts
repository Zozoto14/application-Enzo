/**
 * Performance cumulée, date par date : de quoi tracer une courbe.
 *
 * Le TWR de `rendements.ts` rend un seul chiffre sur toute la période. Pour un
 * graphique, il faut le même calcul arrêté à chaque date, puis la possibilité
 * de le rebaser sur une fenêtre — « depuis un an », « depuis janvier » — sans
 * refaire le chaînage.
 *
 * On garde donc le **facteur** cumulé (1,12 pour +12 %) : rebaser une fenêtre
 * revient à diviser par le facteur de son premier jour.
 */

import type { CoursDate } from './serie';
import type { PointValorisation } from './rendements';

export interface FacteurDate {
  date: string;
  /** 1 au départ ; 1,12 après une hausse de 12 %. */
  facteur: number;
}

/**
 * Facteur TWR cumulé à chaque point de valorisation.
 *
 * La série commence au premier point où le portefeuille vaut quelque chose :
 * avant le premier versement, il n'y a rien à mesurer. Une sous-période qui
 * part d'une valeur nulle — tout vendu et retiré, puis réinvesti — est
 * neutralisée plutôt que de produire un rendement infini.
 */
export function facteursTwr(points: readonly PointValorisation[]): FacteurDate[] {
  const depart = points.findIndex(point => point.valeurTotale.estPositif());
  if (depart === -1) {
    return [];
  }

  const resultat: FacteurDate[] = [{ date: points[depart].date, facteur: 1 }];
  let facteur = 1;
  for (let i = depart + 1; i < points.length; i++) {
    const debut = points[i - 1].valeurTotale;
    if (debut.estPositif()) {
      const fin = points[i].valeurTotale.sub(points[i].fluxExterne);
      const rapport = fin.div(debut).toNumber();
      if (Number.isFinite(rapport) && rapport > 0) {
        facteur *= rapport;
      }
    }
    resultat.push({ date: points[i].date, facteur });
  }
  return resultat;
}

/** Facteur d'un cours rapporté à son premier cours. */
export function facteursCours(serie: readonly CoursDate[]): FacteurDate[] {
  const premier = serie.find(point => point.cloture.estPositif());
  if (!premier) {
    return [];
  }
  const base = premier.cloture.toNumber();
  return serie
    .filter(point => point.date >= premier.date && point.cloture.estPositif())
    .map(point => ({ date: point.date, facteur: point.cloture.toNumber() / base }));
}

export type Periode = 'YTD' | '1A' | '3A' | '5A' | 'MAX';

export const PERIODES: readonly Periode[] = ['YTD', '1A', '3A', '5A', 'MAX'];

/** Date de début d'une période, comptée depuis `aujourdhui`. */
export function debutPeriode(periode: Periode, aujourdhui: string): string | undefined {
  const annee = Number(aujourdhui.slice(0, 4));
  const reste = aujourdhui.slice(4);
  switch (periode) {
    case 'YTD':
      // Dernière clôture de l'année précédente : c'est elle qui sert de base.
      return `${annee - 1}-12-31`;
    case '1A':
      return `${annee - 1}${reste}`;
    case '3A':
      return `${annee - 3}${reste}`;
    case '5A':
      return `${annee - 5}${reste}`;
    case 'MAX':
      return undefined;
  }
}

export interface PointPourcentage {
  date: string;
  /** Rendement cumulé depuis le début de la fenêtre, en pourcentage. */
  valeur: number;
}

/**
 * Rebase une série de facteurs sur une fenêtre.
 *
 * Le premier point retenu est le dernier connu au début de la fenêtre, s'il
 * existe : la courbe part de 0 % au jour exact où la fenêtre s'ouvre, au lieu
 * d'ignorer le mouvement du premier jour.
 */
export function rebaser(serie: readonly FacteurDate[], debut: string | undefined): PointPourcentage[] {
  if (serie.length === 0) {
    return [];
  }
  let index = 0;
  if (debut) {
    const avant = serie.filter(point => point.date <= debut).length - 1;
    index = Math.max(0, avant);
  }
  const base = serie[index].facteur;
  if (!(base > 0)) {
    return [];
  }
  return serie.slice(index).map((point, rang) => ({
    // Le point de base vaut « au début de la fenêtre » : on le date ainsi, pour
    // que la courbe ne déborde pas à gauche de la période demandée.
    date: rang === 0 && debut && point.date < debut ? debut : point.date,
    valeur: (point.facteur / base - 1) * 100,
  }));
}

/**
 * Restreint une série de référence à la plage couverte par le portefeuille,
 * puis la rebase au même jour : les deux courbes partent ensemble de 0 %.
 */
export function alignerReference(
  reference: readonly FacteurDate[],
  portefeuille: readonly PointPourcentage[],
): PointPourcentage[] {
  if (portefeuille.length === 0) {
    return [];
  }
  const debut = portefeuille[0].date;
  const fin = portefeuille[portefeuille.length - 1].date;
  const dans = reference.filter(point => point.date <= fin);
  if (dans.length === 0 || dans[dans.length - 1].date < debut) {
    return [];
  }
  return rebaser(dans, debut);
}
