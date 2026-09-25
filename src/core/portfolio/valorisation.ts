/**
 * Valorisation des positions et agrégats de portefeuille.
 *
 * Le moteur de rejeu ne connaît que le passé (ce qui a été payé). Ce module y
 * confronte le présent (les cours du jour) pour en tirer les plus-values
 * latentes et la répartition du portefeuille.
 */

import { Decimal } from '../money/decimal';
import type { EtatCompte, Position, Titre } from '../domain/types';

export interface PositionValorisee extends Position {
  /** Dernier cours connu, exprimé dans la devise du compte. */
  cours: Decimal;
  valeurMarche: Decimal;
  /** Positive : plus-value latente. Négative : moins-value latente. */
  plusValueLatente: Decimal;
  /** Variation en pourcentage, `null` si le prix de revient est nul. */
  plusValueLatentePct: Decimal | null;
}

export interface TotauxPortefeuille {
  /** Valeur de marché de l'ensemble des titres détenus. */
  valeurTitres: Decimal;
  cash: Decimal;
  /** Valorisation totale, cash inclus. */
  valeurTotale: Decimal;
  prixRevientTotal: Decimal;
  plusValueLatente: Decimal;
  plusValueLatentePct: Decimal | null;
}

export function valoriser(position: Position, cours: Decimal): PositionValorisee {
  const valeurMarche = position.quantite.mul(cours);
  const plusValueLatente = valeurMarche.sub(position.coutTotal);
  return {
    ...position,
    cours,
    valeurMarche,
    plusValueLatente,
    plusValueLatentePct: position.coutTotal.estZero()
      ? null
      : plusValueLatente.div(position.coutTotal).mul(100),
  };
}

/**
 * Valorise un ensemble de positions.
 * Une position dont le cours est absent est écartée plutôt que valorisée à
 * zéro : mieux vaut un total incomplet et signalé qu'un total faux.
 */
export function valoriserPositions(
  positions: readonly Position[],
  cours: ReadonlyMap<string, Decimal>,
): { valorisees: PositionValorisee[]; sansCours: Position[] } {
  const valorisees: PositionValorisee[] = [];
  const sansCours: Position[] = [];

  for (const position of positions) {
    const cote = cours.get(position.titreId);
    if (cote === undefined) {
      sansCours.push(position);
    } else {
      valorisees.push(valoriser(position, cote));
    }
  }
  return { valorisees, sansCours };
}

export function totaux(
  positions: readonly PositionValorisee[],
  comptes: Iterable<EtatCompte>,
): TotauxPortefeuille {
  const valeurTitres = Decimal.somme(positions.map(p => p.valeurMarche));
  const prixRevientTotal = Decimal.somme(positions.map(p => p.coutTotal));
  const cash = Decimal.somme([...comptes].map(c => c.cash));
  const plusValueLatente = valeurTitres.sub(prixRevientTotal);

  return {
    valeurTitres,
    cash,
    valeurTotale: valeurTitres.add(cash),
    prixRevientTotal,
    plusValueLatente,
    plusValueLatentePct: prixRevientTotal.estZero()
      ? null
      : plusValueLatente.div(prixRevientTotal).mul(100),
  };
}

export type CritereRepartition = 'secteur' | 'zoneGeographique' | 'compte';

export interface LigneRepartition {
  cle: string;
  valeur: Decimal;
  /** Part dans la valeur totale des titres, en pourcentage. */
  pourcentage: Decimal;
}

/**
 * Répartition du portefeuille selon un critère, triée par poids décroissant.
 * Sert aussi bien aux graphiques qu'à la détection de concentration.
 */
export function repartition(
  positions: readonly PositionValorisee[],
  titres: ReadonlyMap<string, Titre>,
  critere: CritereRepartition,
): LigneRepartition[] {
  const total = Decimal.somme(positions.map(p => p.valeurMarche));
  if (total.estZero()) {
    return [];
  }

  const cumuls = new Map<string, Decimal>();
  for (const position of positions) {
    const titre = titres.get(position.titreId);
    const cle =
      critere === 'compte'
        ? position.compteId
        : (titre?.[critere] ?? 'Non renseigné');
    cumuls.set(cle, (cumuls.get(cle) ?? Decimal.ZERO).add(position.valeurMarche));
  }

  return [...cumuls.entries()]
    .map(([cle, valeur]) => ({
      cle,
      valeur,
      pourcentage: valeur.div(total).mul(100),
    }))
    .sort((a, b) => b.valeur.compare(a.valeur));
}
