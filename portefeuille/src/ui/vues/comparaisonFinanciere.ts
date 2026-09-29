/**
 * Comparateur d'états financiers : plusieurs sociétés, plusieurs postes.
 *
 * On choisit jusqu'à cinq sociétés et jusqu'à dix postes de leurs comptes ;
 * chaque couple devient une courbe. En « base 100 », chaque courbe part de
 * 100 à son premier exercice : on compare des trajectoires, pas des tailles —
 * un chiffre d'affaires de 300 milliards écraserait sinon un de 3 milliards.
 */

import type { Comptes } from '../../fondamentaux/yahoo';
import { etatsFinanciers, type EtatFinancier } from './fiche';

export const SOCIETES_MAXIMUM = 5;
export const POSTES_MAXIMUM = 10;

export interface SocieteComparee {
  symbole: string;
  nom: string;
  comptes?: Comptes;
  chargement?: boolean;
  erreur?: string;
}

export interface SerieComparee {
  nom: string;
  societe: string;
  poste: string;
  points: Array<{ date: string; valeur: number }>;
}

/** États financiers d'une société, ou rien si ses comptes ne sont pas chargés. */
export function etatsDe(societe: SocieteComparee | undefined): ReturnType<typeof etatsFinanciers> | undefined {
  return societe?.comptes ? etatsFinanciers(societe.comptes) : undefined;
}

/** Nom court d'une société pour une légende : « Apple Inc. » plutôt que la raison sociale entière. */
function court(nom: string): string {
  return nom.length > 22 ? `${nom.slice(0, 21)}…` : nom;
}

export function seriesComparees(
  societes: readonly SocieteComparee[],
  titreEtat: string,
  postes: readonly string[],
  base100: boolean,
): SerieComparee[] {
  const series: SerieComparee[] = [];
  for (const societe of societes) {
    const etats = etatsDe(societe);
    const etat: EtatFinancier | undefined = etats?.etats.find(element => element.titre === titreEtat);
    if (!etats || !etat) {
      continue;
    }
    for (const poste of postes) {
      const ligne = etat.lignes.find(element => element.libelle === poste);
      if (!ligne) {
        continue;
      }
      let points = etats.dates
        .map((date, index) => ({ date, valeur: ligne.brut[index] }))
        .filter((point): point is { date: string; valeur: number } => point.valeur !== null);
      if (base100) {
        const premier = points.find(point => point.valeur !== 0);
        points = premier
          ? points.map(point => ({ date: point.date, valeur: (point.valeur / premier.valeur) * 100 }))
          : [];
      }
      if (points.length > 0) {
        series.push({
          nom: postes.length > 1 ? `${court(societe.nom)} · ${poste}` : court(societe.nom),
          societe: societe.symbole,
          poste,
          points,
        });
      }
    }
  }
  return series;
}

export type Unite = 'auto' | 'M' | 'Md';

/** Valeur d'une cellule dans l'unité et la précision choisies. */
export function formaterCellule(
  valeur: number | null,
  unite: Unite,
  decimales: number,
  parAction: boolean,
): string {
  if (valeur === null) {
    return '—';
  }
  const options = { minimumFractionDigits: decimales, maximumFractionDigits: decimales };
  if (parAction) {
    return valeur.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (unite === 'M') {
    return (valeur / 1e6).toLocaleString('fr-FR', options);
  }
  if (unite === 'Md') {
    return (valeur / 1e9).toLocaleString('fr-FR', options);
  }
  const absolu = Math.abs(valeur);
  if (absolu >= 1e9) return `${(valeur / 1e9).toLocaleString('fr-FR', options)} Md`;
  if (absolu >= 1e6) return `${(valeur / 1e6).toLocaleString('fr-FR', options)} M`;
  return valeur.toLocaleString('fr-FR', options);
}
