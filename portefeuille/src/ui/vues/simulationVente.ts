/**
 * Simulateur de vente : combien d'impôt si je vends cette ligne ?
 *
 * La réponse dépend de l'enveloppe, et c'est ce que l'écran doit faire
 * comprendre :
 *
 * - **Compte-titres** : la plus-value de la vente est imposée tout de suite,
 *   au prélèvement forfaitaire unique de 30 % (12,8 % d'impôt + 17,2 % de
 *   prélèvements sociaux). Une moins-value ne coûte rien et s'impute sur les
 *   gains de l'année ou des dix suivantes.
 * - **PEA** : vendre une ligne ne coûte **rien** tant que l'argent reste dans
 *   le plan. L'impôt ne tombe qu'au retrait, sur la part de gain qu'il
 *   contient : 17,2 % après cinq ans, 30 % avant — et un retrait avant cinq
 *   ans clôture le plan.
 *
 * Estimation, pas avis fiscal : les cas particuliers (option pour le barème,
 * abattements anciens, PEA ouvert avant 2019…) ne sont pas traités.
 */

import { TAUX_PFU, TAUX_PRELEVEMENTS_SOCIAUX } from '../../core/tax/impots';
import { ancienneteEnAnnees } from '../../core/tax/pea';

export interface EntreesVente {
  enveloppe: 'PEA' | 'CTO';
  dateOuverture: string;
  aujourdhui: string;
  quantite: number;
  prixVente: number;
  pru: number;
  frais?: number;
  /** PEA : valeur totale du plan et versements cumulés, pour le retrait. */
  valeurPlan?: number;
  versementsPlan?: number;
}

export interface ResultatVente {
  produit: number;
  plusValue: number;
  /** Impôt dû du seul fait de la vente. */
  impotVente: number;
  netVente: number;
  /** PEA : ce que coûterait le retrait du produit de la vente. */
  retrait?: { impot: number; partGain: number; taux: number; clotureLePlan: boolean; net: number };
  cinqAns?: { date: string; joursRestants: number; atteint: boolean };
  explication: string;
}

const PFU = TAUX_PFU.toNumber();
const PS = TAUX_PRELEVEMENTS_SOCIAUX.toNumber();

function ajouterAns(iso: string, ans: number): string {
  const [annee, mois, jour] = iso.split('-').map(Number);
  return `${annee + ans}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

function joursEntre(debut: string, fin: string): number {
  return Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${debut}T00:00:00Z`)) / 86_400_000);
}

const arrondi = (valeur: number) => Math.round(valeur * 100) / 100;

export function simulerVente(entrees: EntreesVente): ResultatVente {
  const frais = entrees.frais ?? 0;
  const produit = arrondi(entrees.quantite * entrees.prixVente - frais);
  const plusValue = arrondi(produit - entrees.quantite * entrees.pru);

  if (entrees.enveloppe === 'CTO') {
    const impotVente = plusValue > 0 ? arrondi(plusValue * PFU) : 0;
    return {
      produit,
      plusValue,
      impotVente,
      netVente: arrondi(produit - impotVente),
      explication:
        plusValue > 0
          ? 'Compte-titres : la plus-value est imposée l’année de la vente, à 30 % (12,8 % d’impôt + 17,2 % de prélèvements sociaux).'
          : 'Compte-titres : une moins-value ne coûte rien. Elle réduit l’impôt sur vos plus-values de cette année ou des dix suivantes.',
    };
  }

  const dateCinqAns = ajouterAns(entrees.dateOuverture, 5);
  const atteint = ancienneteEnAnnees(entrees.dateOuverture, entrees.aujourdhui) >= 5;
  const cinqAns = { date: dateCinqAns, joursRestants: Math.max(0, joursEntre(entrees.aujourdhui, dateCinqAns)), atteint };

  let retrait: ResultatVente['retrait'];
  if (entrees.valeurPlan && entrees.valeurPlan > 0 && entrees.versementsPlan !== undefined) {
    // Un retrait emporte une part de gain proportionnelle au gain du plan entier.
    const gainPlan = Math.max(0, entrees.valeurPlan - entrees.versementsPlan);
    const partGain = arrondi(Math.min(produit, entrees.valeurPlan) * (gainPlan / entrees.valeurPlan));
    const taux = atteint ? PS : PFU;
    const impot = arrondi(partGain * taux);
    retrait = { impot, partGain, taux, clotureLePlan: !atteint, net: arrondi(produit - impot) };
  }

  return {
    produit,
    plusValue,
    impotVente: 0,
    netVente: produit,
    retrait,
    cinqAns,
    explication: atteint
      ? 'PEA de plus de cinq ans : vendre ne coûte rien. Si vous retirez l’argent, seuls les prélèvements sociaux (17,2 %) portent sur la part de gain retirée, et le plan reste ouvert.'
      : 'PEA : vendre ne coûte rien tant que l’argent reste dans le plan. Un retrait avant cinq ans clôture le PEA et la part de gain est imposée à 30 %.',
  };
}

/** Une ligne qu'on peut vendre, telle que le simulateur la propose. */
export interface LigneVendable {
  cle: string;
  libelle: string;
  enveloppe: 'PEA' | 'CTO';
  dateOuverture: string;
  quantite: number;
  pru: number;
  cours?: number;
  valeurPlan?: number;
  versementsPlan?: number;
}
