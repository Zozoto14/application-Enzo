/**
 * Indices de référence, pour comparer la performance du portefeuille.
 *
 * Un indice n'est pas une valeur détenue : il n'apparaît ni dans les
 * positions ni dans les titres. Ses cours sont rangés dans la même table que
 * les autres, sous un identifiant préfixé, et chargés uniquement quand
 * l'utilisateur l'a choisi comme référence.
 *
 * Les références sont des ETF cotés en euros plutôt que les indices bruts en
 * dollars : comparer un portefeuille en euros à un indice en dollars
 * mesurerait surtout le taux de change.
 */

export const PREFIXE_INDICE = 'indice:';

export interface Indice {
  id: string;
  nom: string;
  /** Libellé court, pour une légende de graphique. */
  court: string;
  /** Symbole Yahoo Finance. */
  symbole: string;
}

export const INDICES: readonly Indice[] = [
  { id: `${PREFIXE_INDICE}sp500`, nom: 'S&P 500 (ETF ESE, EUR)', court: 'S&P 500', symbole: 'ESE.PA' },
  { id: `${PREFIXE_INDICE}msci-world`, nom: 'MSCI World (ETF CW8, EUR)', court: 'MSCI World', symbole: 'CW8.PA' },
  { id: `${PREFIXE_INDICE}nasdaq100`, nom: 'Nasdaq-100 (ETF PUST, EUR)', court: 'Nasdaq-100', symbole: 'PUST.PA' },
  { id: `${PREFIXE_INDICE}cac40`, nom: 'CAC 40 (indice)', court: 'CAC 40', symbole: '^FCHI' },
  { id: `${PREFIXE_INDICE}eurostoxx50`, nom: 'Euro Stoxx 50 (indice)', court: 'Euro Stoxx 50', symbole: '^STOXX50E' },
];

/** Référence retenue quand l'utilisateur n'en a choisi aucune. */
export const INDICE_DEFAUT = INDICES[0].id;

export function estIndice(identifiant: string): boolean {
  return identifiant.startsWith(PREFIXE_INDICE);
}

export function indiceParId(identifiant: string | undefined): Indice | undefined {
  return INDICES.find(indice => indice.id === identifiant);
}

/** Sépare l'historique des valeurs détenues de celui des indices. */
export function separerHistorique<T>(
  historique: ReadonlyMap<string, T>,
): { titres: Map<string, T>; indices: Map<string, T> } {
  const titres = new Map<string, T>();
  const indices = new Map<string, T>();
  for (const [identifiant, serie] of historique) {
    (estIndice(identifiant) ? indices : titres).set(identifiant, serie);
  }
  return { titres, indices };
}

/**
 * Profondeur d'historique à demander, selon l'ancienneté du portefeuille.
 *
 * Deux ans suffisent tant que le portefeuille est jeune ; au-delà, il faut
 * couvrir toute son histoire pour que « MAX » dise vrai.
 */
export function plagePour(premiereDate: string | undefined, aujourdhui: string): string {
  if (!premiereDate) {
    return '2y';
  }
  const annees =
    (Date.parse(`${aujourdhui}T00:00:00Z`) - Date.parse(`${premiereDate}T00:00:00Z`)) /
    (365.25 * 86_400_000);
  if (!Number.isFinite(annees) || annees <= 1.9) {
    return '2y';
  }
  if (annees <= 4.9) {
    return '5y';
  }
  if (annees <= 9.9) {
    return '10y';
  }
  return 'max';
}
