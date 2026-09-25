/**
 * Contrat des graphiques.
 *
 * Deux implantations le respectent : `Graphiques.web.tsx`, en SVG, pour
 * l'application de bureau ; `Graphiques.tsx`, en simples vues, pour le
 * téléphone et les tests. Les écrans ne connaissent que ces types.
 */

export interface PointDate {
  /** Date ISO. */
  date: string;
  valeur: number;
}

export interface SerieTemporelle {
  nom: string;
  couleur: string;
  points: readonly PointDate[];
  /** Remplit l'aire entre la courbe et la ligne de base. */
  aire?: boolean;
  pointilles?: boolean;
}

export interface Repere {
  valeur: number;
  libelle?: string;
  couleur?: string;
}

export interface Marqueur {
  date: string;
  valeur: number;
  type: 'achat' | 'vente';
}

export interface ProprietesLignes {
  series: readonly SerieTemporelle[];
  /** Mise en forme des valeurs, sur l'axe comme au survol. */
  formater(valeur: number): string;
  hauteur?: number;
  repere?: Repere;
  marqueurs?: readonly Marqueur[];
  /** Pastille de dernière valeur au bout de chaque courbe. Vrai par défaut. */
  etiquettesFinales?: boolean;
  /** Légende sous le graphique, avec un texte par série. */
  legende?: readonly { couleur: string; texte: string }[];
  testID?: string;
}

export interface Part {
  libelle: string;
  valeur: number;
  couleur?: string;
  /** Texte affiché au survol et dans la légende. */
  detail?: string;
}

export interface ProprietesDonut {
  parts: readonly Part[];
  formater(valeur: number): string;
  hauteur?: number;
  /** Texte au centre de l'anneau. */
  centre?: string;
  testID?: string;
}

export interface Barre {
  libelle: string;
  valeur: number;
  couleur?: string;
  /** Valeur portée vers le bas depuis zéro : les retraits face aux dépôts. */
  negatif?: number;
  detail?: string;
}

export interface ProprietesBarres {
  barres: readonly Barre[];
  formater(valeur: number): string;
  hauteur?: number;
  repere?: Repere;
  /** Montant écrit au-dessus de chaque barre. */
  valeursVisibles?: boolean;
  /** Barres couchées, libellés à gauche : pour des noms longs. */
  horizontal?: boolean;
  legende?: readonly { couleur: string; texte: string }[];
  testID?: string;
}

export interface PointNuage {
  x: number;
  y: number;
  libelle?: string;
  couleur: string;
  forme?: 'rond' | 'triangle' | 'losange';
  detail?: string;
}

export interface ProprietesNuage {
  points: readonly PointNuage[];
  lignes?: readonly { points: readonly { x: number; y: number }[]; couleur: string; pointilles?: boolean }[];
  formaterX(valeur: number): string;
  formaterY(valeur: number): string;
  hauteur?: number;
  legende?: readonly { couleur: string; texte: string }[];
  testID?: string;
}

export interface Tuile {
  libelle: string;
  /** Surface de la tuile : le poids. */
  valeur: number;
  couleur: string;
  /** Lignes affichées dans la tuile quand elle est assez grande. */
  lignes?: readonly string[];
}

export interface ProprietesTreemap {
  tuiles: readonly Tuile[];
  hauteur?: number;
  testID?: string;
}

export interface AxeRadar {
  libelle: string;
  /** Entre 0 et 1. */
  valeur: number;
}

export interface ProprietesRadar {
  axes: readonly AxeRadar[];
  couleur: string;
  hauteur?: number;
  testID?: string;
}
