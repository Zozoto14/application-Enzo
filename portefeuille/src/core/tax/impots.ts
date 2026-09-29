/**
 * Estimation de l'imposition des gains de cession.
 *
 * Estimations indicatives uniquement, destinées à éclairer une décision de
 * vente. Non traités volontairement : abattements pour durée de détention
 * (titres acquis avant 2018), CSG déductible de 6,8 % en cas d'option pour le
 * barème, report des moins-values sur 10 ans, quotient familial.
 */

import { Decimal, d } from '../money/decimal';
import type { Compte } from '../domain/types';
import { estExonereImpotRevenu, estPEA } from './pea';

/** Part « impôt sur le revenu » du prélèvement forfaitaire unique. */
export const TAUX_IR_PFU = d('0.128');

/** Prélèvements sociaux, dus quelle que soit l'enveloppe. */
export const TAUX_PRELEVEMENTS_SOCIAUX = d('0.172');

/** Taux global du PFU, dit « flat tax ». */
export const TAUX_PFU = TAUX_IR_PFU.add(TAUX_PRELEVEMENTS_SOCIAUX);

export type OptionImposition = 'PFU' | 'BAREME';

export interface ImpotEstime {
  /** Base taxable retenue, nulle en cas de moins-value. */
  assiette: Decimal;
  impotRevenu: Decimal;
  prelevementsSociaux: Decimal;
  total: Decimal;
  /** Taux effectif sur le gain, `null` si le gain est nul ou négatif. */
  tauxEffectif: Decimal | null;
  /** Explication en clair, affichable telle quelle dans l'interface. */
  explication: string;
}

function sansImpot(explication: string): ImpotEstime {
  return {
    assiette: Decimal.ZERO,
    impotRevenu: Decimal.ZERO,
    prelevementsSociaux: Decimal.ZERO,
    total: Decimal.ZERO,
    tauxEffectif: null,
    explication,
  };
}

function composer(
  assiette: Decimal,
  impotRevenu: Decimal,
  prelevementsSociaux: Decimal,
  explication: string,
): ImpotEstime {
  const total = impotRevenu.add(prelevementsSociaux);
  return {
    assiette,
    impotRevenu,
    prelevementsSociaux,
    total,
    tauxEffectif: assiette.estPositif() ? total.div(assiette).mul(100) : null,
    explication,
  };
}

export interface OptionsImposition {
  /** Mode d'imposition au CTO. Par défaut le PFU. */
  option?: OptionImposition;
  /** Taux marginal d'imposition, requis si `option` vaut BAREME (ex. 0.30). */
  tauxMarginal?: Decimal;
}

/** Imposition d'un gain réalisé sur un compte-titres ordinaire. */
export function impotSurGainCTO(gain: Decimal, options: OptionsImposition = {}): ImpotEstime {
  if (!gain.estPositif()) {
    return sansImpot(
      'Moins-value : aucun impôt dû. Elle est imputable sur les plus-values de même nature de l’année, puis reportable 10 ans.',
    );
  }

  const option = options.option ?? 'PFU';
  const prelevementsSociaux = gain.mul(TAUX_PRELEVEMENTS_SOCIAUX);

  if (option === 'PFU') {
    return composer(
      gain,
      gain.mul(TAUX_IR_PFU),
      prelevementsSociaux,
      'CTO au prélèvement forfaitaire unique : 12,8 % d’impôt sur le revenu + 17,2 % de prélèvements sociaux.',
    );
  }

  if (!options.tauxMarginal) {
    throw new TypeError('Le taux marginal est requis pour une imposition au barème');
  }
  return composer(
    gain,
    gain.mul(options.tauxMarginal),
    prelevementsSociaux,
    `CTO au barème progressif : ${options.tauxMarginal.mul(100).toFixed(1)} % d’impôt sur le revenu + 17,2 % de prélèvements sociaux. La CSG déductible de 6,8 % n’est pas prise en compte ici.`,
  );
}

/**
 * Imposition d'un gain en cas de retrait d'un PEA.
 * Avant 5 ans, le gain est taxé comme au CTO. À partir de 5 ans, seuls les
 * prélèvements sociaux restent dus.
 */
export function impotSurGainPEA(gain: Decimal, exonereImpotRevenu: boolean): ImpotEstime {
  if (!gain.estPositif()) {
    return sansImpot('Moins-value : aucun impôt dû sur ce retrait.');
  }

  const prelevementsSociaux = gain.mul(TAUX_PRELEVEMENTS_SOCIAUX);

  if (exonereImpotRevenu) {
    return composer(
      gain,
      Decimal.ZERO,
      prelevementsSociaux,
      'PEA de plus de 5 ans : gain exonéré d’impôt sur le revenu, seuls les prélèvements sociaux de 17,2 % restent dus.',
    );
  }

  return composer(
    gain,
    gain.mul(TAUX_IR_PFU),
    prelevementsSociaux,
    'PEA de moins de 5 ans : retrait taxé à 30 % (12,8 % + 17,2 %) et entraînant en principe la clôture du plan.',
  );
}

/** Aiguillage selon l'enveloppe du compte. */
export function impotSurGain(
  compte: Compte,
  gain: Decimal,
  aLaDate: string,
  options: OptionsImposition = {},
): ImpotEstime {
  if (estPEA(compte.type)) {
    return impotSurGainPEA(gain, estExonereImpotRevenu(compte, aLaDate));
  }
  return impotSurGainCTO(gain, options);
}

export interface RetraitPEA {
  /** Valeur liquidative du plan : titres valorisés + liquidités. */
  valeurLiquidative: Decimal;
  /** Versements cumulés, diminués de ceux déjà repris par des retraits antérieurs. */
  versementsNets: Decimal;
  montantRetrait: Decimal;
}

/**
 * Assiette taxable d'un retrait de PEA.
 *
 * Contrairement au CTO, l'assiette n'est pas la plus-value du titre vendu : le
 * gain est apprécié au niveau du plan entier, et le retrait n'en taxe qu'une
 * quote-part, proportionnelle à la part de la valeur liquidative retirée.
 *
 *   assiette = retrait x (valeur liquidative - versements nets) / valeur liquidative
 */
export function assietteRetraitPEA(retrait: RetraitPEA): Decimal {
  if (!retrait.valeurLiquidative.estPositif()) {
    return Decimal.ZERO;
  }
  const gainDuPlan = retrait.valeurLiquidative.sub(retrait.versementsNets);
  if (!gainDuPlan.estPositif()) {
    return Decimal.ZERO;
  }
  const retraitPlafonne = Decimal.min(retrait.montantRetrait, retrait.valeurLiquidative);
  return retraitPlafonne.mul(gainDuPlan).div(retrait.valeurLiquidative);
}

/** Estimation complète de l'imposition d'un retrait de PEA. */
export function impotSurRetraitPEA(
  compte: Compte,
  retrait: RetraitPEA,
  aLaDate: string,
): ImpotEstime {
  if (!estPEA(compte.type)) {
    throw new TypeError(`Le compte ${compte.id} n'est pas un PEA`);
  }
  return impotSurGainPEA(
    assietteRetraitPEA(retrait),
    estExonereImpotRevenu(compte, aLaDate),
  );
}
