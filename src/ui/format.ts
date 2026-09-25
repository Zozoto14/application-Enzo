/**
 * Mise en forme des valeurs à l'écran.
 *
 * Séparé des composants pour être testable sans rendu, et pour que les règles
 * d'affichage soient au même endroit plutôt que dispersées dans le JSX.
 *
 * Deux principes tenus partout :
 *  - le signe est toujours explicite sur une variation (« +2,40 % » et non
 *    « 2,40 % »), parce qu'un gain et une perte doivent se distinguer d'un
 *    coup d'œil, sans avoir à chercher la couleur ;
 *  - aucun arrondi n'a lieu avant l'affichage. `Decimal` garde la précision,
 *    le formatage n'en prend qu'une photo.
 */

import { Decimal, type ValeurDecimale } from '../core/money/decimal';

/** Espace insécable étroite, séparateur de milliers de la typographie française. */
const ESPACE_FINE = ' ';
/** Espace insécable, entre le nombre et son unité. */
const ESPACE_INSECABLE = ' ';

function grouperMilliers(entiere: string): string {
  return entiere.replace(/\B(?=(\d{3})+(?!\d))/g, ESPACE_FINE);
}

export interface OptionsMontant {
  /** Nombre de décimales. 2 par défaut. */
  decimales?: number;
  /** Force le signe, y compris pour un montant positif. */
  signeExplicite?: boolean;
  /** Symbole accolé, `€` par défaut. `null` pour n'en afficher aucun. */
  devise?: string | null;
}

/** Formate un montant à la française : « 11 966,07 € ». */
export function formaterMontant(
  valeur: ValeurDecimale,
  options: OptionsMontant = {},
): string {
  const decimal = Decimal.de(valeur);
  const decimales = options.decimales ?? 2;
  const devise = options.devise === undefined ? '€' : options.devise;

  const texte = decimal.abs().toFixed(decimales);
  const [entiere, fraction] = texte.split('.');
  const corps = fraction
    ? `${grouperMilliers(entiere)},${fraction}`
    : grouperMilliers(entiere);

  // Zéro ne prend jamais de signe : « +0,00 % » se lirait comme une hausse.
  const signe = decimal.estNegatif()
    ? '-'
    : options.signeExplicite && decimal.estPositif()
      ? '+'
      : '';
  return devise ? `${signe}${corps}${ESPACE_INSECABLE}${devise}` : `${signe}${corps}`;
}

/**
 * Formate un pourcentage, signe explicite par defaut : « +2,40 % ».
 *
 * Le signe convient a une variation, pas a un niveau : un rendement de
 * « +3,00 % » se lit comme une hausse de trois points alors qu'il n'a pas
 * bouge. Une part dans un total a le meme probleme. D'ou `signeExplicite`,
 * qu'on passe a faux dans ces deux cas.
 */
export function formaterPourcentage(
  valeur: ValeurDecimale | null,
  decimales = 2,
  options: { signeExplicite?: boolean } = {},
): string {
  if (valeur === null) {
    return '—';
  }
  return `${formaterMontant(valeur, {
    decimales,
    signeExplicite: options.signeExplicite ?? true,
    devise: null,
  })}${ESPACE_INSECABLE}%`;
}

/**
 * Formate une quantité de titres.
 * Les décimales inutiles sont supprimées : « 20 » plutôt que « 20,00000000 »,
 * mais « 0,5 » reste lisible pour une fraction de part.
 */
export function formaterQuantite(valeur: ValeurDecimale): string {
  const decimal = Decimal.de(valeur);
  const texte = decimal.toString();
  return texte.includes('.') ? texte.replace('.', ',') : texte;
}

/** Convertit une date ISO en date française : « 2026-08-03 » devient « 03/08/2026 ». */
export function formaterDate(iso: string): string {
  const correspondance = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!correspondance) {
    return iso;
  }
  const [, annee, mois, jour] = correspondance;
  return `${jour}/${mois}/${annee}`;
}

export type Tendance = 'hausse' | 'baisse' | 'neutre';

/** Sens d'une variation, pour choisir couleur et symbole sans dupliquer le test. */
export function tendance(valeur: ValeurDecimale | null): Tendance {
  if (valeur === null) {
    return 'neutre';
  }
  const decimal = Decimal.de(valeur);
  if (decimal.estPositif()) return 'hausse';
  if (decimal.estNegatif()) return 'baisse';
  return 'neutre';
}

const LIBELLES_COMPTE: Record<string, string> = {
  PEA: 'PEA',
  PEA_PME: 'PEA-PME',
  CTO: 'Compte-titres',
};

export function formaterTypeCompte(type: string): string {
  return LIBELLES_COMPTE[type] ?? type;
}
