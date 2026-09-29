/**
 * Simulateur de vente : « si je vends maintenant, qu'est-ce qu'il me reste ? »
 *
 * La réponse dépend d'abord de l'enveloppe, et la différence est structurelle :
 *  - CTO  : la vente est le fait générateur de l'impôt, dû sur la plus-value.
 *  - PEA  : la vente à l'intérieur du plan n'est jamais imposée. L'impôt ne
 *           naît qu'au retrait des liquidités hors du plan, sur une quote-part
 *           du gain global. Vendre pour arbitrer ne coûte donc rien.
 */

import { Decimal } from '../money/decimal';
import type { Compte, Position } from '../domain/types';
import { estPEA } from './pea';
import {
  impotSurGainCTO,
  type ImpotEstime,
  type OptionsImposition,
} from './impots';

export interface ParametresVente {
  quantite: Decimal;
  prixUnitaire: Decimal;
  /** Frais de courtage estimés sur l'opération. */
  frais: Decimal;
  /** Date envisagée de la vente, au format ISO. */
  date: string;
}

export interface ResultatSimulationVente {
  quantite: Decimal;
  /** Produit brut de la vente, avant frais. */
  produitBrut: Decimal;
  produitNet: Decimal;
  /** Prix de revient de la quantité cédée. */
  prixRevient: Decimal;
  plusValue: Decimal;
  plusValuePct: Decimal | null;
  /** Impôt estimé déclenché par la vente elle-même. */
  impot: ImpotEstime;
  /** Liquidités réellement disponibles après impôt. */
  netApresImpot: Decimal;
  /** Vrai si l'impôt est seulement différé au retrait (cas du PEA). */
  impositionDifferee: boolean;
}

export class ErreurSimulation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurSimulation';
  }
}

export function simulerVente(
  compte: Compte,
  position: Position,
  parametres: ParametresVente,
  options: OptionsImposition = {},
): ResultatSimulationVente {
  if (!parametres.quantite.estPositif()) {
    throw new ErreurSimulation('La quantité à vendre doit être positive');
  }
  if (parametres.quantite.gt(position.quantite)) {
    throw new ErreurSimulation(
      `Quantité à vendre (${parametres.quantite.toString()}) supérieure à la quantité détenue (${position.quantite.toString()})`,
    );
  }

  const produitBrut = parametres.quantite.mul(parametres.prixUnitaire);
  const produitNet = produitBrut.sub(parametres.frais);
  const prixRevient = position.pru.mul(parametres.quantite);
  const plusValue = produitNet.sub(prixRevient);

  const surPEA = estPEA(compte.type);
  const impot: ImpotEstime = surPEA
    ? {
        assiette: Decimal.ZERO,
        impotRevenu: Decimal.ZERO,
        prelevementsSociaux: Decimal.ZERO,
        total: Decimal.ZERO,
        tauxEffectif: null,
        explication:
          'Vente à l’intérieur d’un PEA : aucune imposition immédiate. L’impôt ne sera dû qu’au moment d’un retrait hors du plan.',
      }
    : impotSurGainCTO(plusValue, options);

  return {
    quantite: parametres.quantite,
    produitBrut,
    produitNet,
    prixRevient,
    plusValue,
    plusValuePct: prixRevient.estZero() ? null : plusValue.div(prixRevient).mul(100),
    impot,
    netApresImpot: produitNet.sub(impot.total),
    impositionDifferee: surPEA,
  };
}
