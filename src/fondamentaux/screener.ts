/**
 * Screener : des catégories d'actions prêtes à l'emploi, sur le modèle des
 * screeners en ligne — France, PEA, Qualité, Croissance, Value, Dividendes,
 * Petites capitalisations.
 *
 * Les requêtes vont au screener de Yahoo Finance, qui filtre sur les
 * derniers chiffres publiés. Les critères sont ceux qu'il sait appliquer ;
 * quand une définition usuelle en demande davantage (dix ans de croissance
 * des bénéfices, vingt-cinq ans de dividende en hausse), la catégorie en
 * garde l'esprit et sa description dit ce qui est réellement filtré.
 */

import type { NomIcone } from '../ui/icones/traces';

export type CleCategorie =
  | 'tout'
  | 'france'
  | 'pea'
  | 'qualite'
  | 'croissance'
  | 'value'
  | 'dividendes'
  | 'petites';

export type Region = 'monde' | 'us' | 'france' | 'europe';

export interface Categorie {
  cle: CleCategorie;
  nom: string;
  /** Icône monochrome de la catégorie (src/ui/icones). */
  icone: NomIcone;
  description: string;
  /** Conditions propres à la catégorie. */
  conditions: Condition[];
  /** Région imposée par la catégorie (France, PEA). */
  regionImposee?: Region;
}

type Condition = { operator: string; operands: Array<string | number | Condition> };

const gt = (champ: string, valeur: number): Condition => ({ operator: 'gt', operands: [champ, valeur] });
const lt = (champ: string, valeur: number): Condition => ({ operator: 'lt', operands: [champ, valeur] });
const btwn = (champ: string, bas: number, haut: number): Condition => ({ operator: 'btwn', operands: [champ, bas, haut] });
const eq = (champ: string, valeur: string): Condition => ({ operator: 'eq', operands: [champ, valeur] });
const ou = (conditions: Condition[]): Condition => ({ operator: 'or', operands: conditions });

/** Pays de l'Espace économique européen dont les actions entrent dans un PEA. */
const PAYS_PEA = ['fr', 'de', 'nl', 'be', 'it', 'es', 'pt', 'ie', 'at', 'fi', 'lu', 'dk', 'se', 'no', 'gr', 'pl'];
const PAYS_EUROPE = [...PAYS_PEA, 'ch', 'gb'];

export const CATEGORIES: readonly Categorie[] = [
  {
    cle: 'tout',
    nom: 'Tout',
    icone: 'globe',
    description: 'Les plus grandes capitalisations de la région choisie.',
    conditions: [gt('intradaymarketcap', 2e9)],
  },
  {
    cle: 'france',
    nom: 'France',
    icone: 'drapeau',
    description: 'Actions françaises, des plus grosses aux plus petites.',
    conditions: [gt('intradaymarketcap', 1e8)],
    regionImposee: 'france',
  },
  {
    cle: 'pea',
    nom: 'PEA',
    icone: 'portefeuille',
    description:
      'Sociétés de l’Union européenne et de l’EEE, en principe éligibles au PEA. À confirmer chez votre courtier avant d’acheter.',
    conditions: [gt('intradaymarketcap', 5e8)],
    regionImposee: 'europe',
  },
  {
    cle: 'qualite',
    nom: 'Qualité',
    icone: 'valide',
    description: 'Rentabilité des fonds propres (ROE) ≥ 20 % et marge nette ≥ 10 %.',
    conditions: [gt('returnonequity.lasttwelvemonths', 20), gt('netincomemargin.lasttwelvemonths', 10), gt('intradaymarketcap', 1e9)],
  },
  {
    cle: 'croissance',
    nom: 'Croissance',
    icone: 'tendance-haut',
    description: 'Chiffre d’affaires en hausse de 10 % ou plus sur un an, bénéfices positifs.',
    conditions: [gt('quarterlyrevenuegrowth.quarterly', 10), gt('epsgrowth.lasttwelvemonths', 0), gt('intradaymarketcap', 1e9)],
  },
  {
    cle: 'value',
    nom: 'Value',
    icone: 'billets',
    description: 'PER ≤ 15 et cours / valeur comptable ≤ 1,5 : des actions peu chères au regard de leurs chiffres.',
    conditions: [btwn('peratio.lasttwelvemonths', 0, 15), lt('pricebookratio.quarterly', 1.5), gt('intradaymarketcap', 5e8)],
  },
  {
    cle: 'dividendes',
    nom: 'Dividendes',
    icone: 'banque',
    description: 'Rendement du dividende ≥ 3 %, avec un bénéfice qui le couvre (PER positif).',
    conditions: [gt('forward_dividend_yield', 3), gt('peratio.lasttwelvemonths', 0), gt('intradaymarketcap', 1e9)],
  },
  {
    cle: 'petites',
    nom: 'Petites capitalisations',
    icone: 'fusee',
    description: 'Capitalisation inférieure à un milliard de dollars : plus de potentiel, plus de risque.',
    conditions: [btwn('intradaymarketcap', 5e7, 1e9)],
  },
];

export const REGIONS: ReadonlyArray<{ cle: Region; libelle: string }> = [
  { cle: 'monde', libelle: 'Monde' },
  { cle: 'us', libelle: 'États-Unis' },
  { cle: 'france', libelle: 'France' },
  { cle: 'europe', libelle: 'Europe' },
];

function conditionRegion(region: Region): Condition | undefined {
  if (region === 'us') return eq('region', 'us');
  if (region === 'france') return eq('region', 'fr');
  if (region === 'europe') return ou(PAYS_EUROPE.map(pays => eq('region', pays)));
  // « Monde » : les grandes places, pour éviter une liste noyée de doublons.
  return ou(['us', 'fr', 'de', 'gb', 'nl', 'ch', 'jp', 'ca', 'it', 'es'].map(pays => eq('region', pays)));
}

export type TriScreener = 'capitalisation' | 'variation' | 'rendement' | 'per';
const CHAMPS_TRI: Record<TriScreener, string> = {
  capitalisation: 'intradaymarketcap',
  variation: 'percentchange',
  rendement: 'forward_dividend_yield',
  per: 'peratio.lasttwelvemonths',
};

export const TAILLE_PAGE = 25;

/** Corps de la requête envoyée au screener. */
export function requeteScreener(
  cle: CleCategorie,
  region: Region,
  options: { page?: number; tri?: TriScreener; sens?: 'DESC' | 'ASC' } = {},
) {
  const categorie = CATEGORIES.find(element => element.cle === cle) ?? CATEGORIES[0];
  const conditionPays =
    categorie.cle === 'pea'
      ? ou(PAYS_PEA.map(pays => eq('region', pays)))
      : conditionRegion(categorie.regionImposee ?? region);
  const tri = options.tri ?? 'capitalisation';
  return {
    size: TAILLE_PAGE,
    offset: (options.page ?? 0) * TAILLE_PAGE,
    sortField: CHAMPS_TRI[tri],
    sortType: options.sens ?? (tri === 'per' ? 'ASC' : 'DESC'),
    quoteType: 'EQUITY',
    query: { operator: 'and', operands: [...(conditionPays ? [conditionPays] : []), ...categorie.conditions] },
    userId: '',
    userIdType: 'guid',
  };
}

export interface ActionScreener {
  symbole: string;
  nom: string;
  place: string;
  devise?: string;
  cours: number | null;
  /** Variation du jour, en %. */
  variation: number | null;
  capitalisation: number | null;
  per: number | null;
  prixSurActif: number | null;
  /** Rendement du dividende, en %. */
  rendement: number | null;
  /** Code pays, pour un drapeau. */
  pays?: string;
}

export interface ResultatScreener {
  actions: ActionScreener[];
  total: number;
}

const nombre = (valeur: unknown): number | null =>
  typeof valeur === 'number' && Number.isFinite(valeur)
    ? valeur
    : valeur && typeof valeur === 'object' && typeof (valeur as { raw?: unknown }).raw === 'number'
      ? (valeur as { raw: number }).raw
      : null;
const texte = (valeur: unknown): string | undefined => (typeof valeur === 'string' && valeur ? valeur : undefined);

/** Lit la réponse du screener ; une réponse inattendue donne une liste vide. */
export function lireScreener(json: unknown): ResultatScreener {
  const resultat = (json as { finance?: { result?: Array<{ quotes?: unknown[]; total?: number }> } })?.finance?.result?.[0];
  const brutes = Array.isArray(resultat?.quotes) ? resultat!.quotes : [];
  const actions: ActionScreener[] = [];
  for (const brute of brutes) {
    const ligne = (brute && typeof brute === 'object' ? brute : {}) as Record<string, unknown>;
    const symbole = texte(ligne.symbol);
    if (!symbole) continue;
    const rendementBrut = nombre(ligne.dividendYield) ?? nombre(ligne.trailingAnnualDividendYield);
    actions.push({
      symbole,
      nom: texte(ligne.longName) ?? texte(ligne.shortName) ?? symbole,
      place: texte(ligne.fullExchangeName) ?? texte(ligne.exchange) ?? '',
      devise: texte(ligne.currency),
      cours: nombre(ligne.regularMarketPrice),
      variation: nombre(ligne.regularMarketChangePercent),
      capitalisation: nombre(ligne.marketCap),
      per: nombre(ligne.trailingPE),
      prixSurActif: nombre(ligne.priceToBook),
      // Yahoo donne tantôt 0,031, tantôt 3,1 : ramené en pourcentage.
      rendement: rendementBrut === null ? null : rendementBrut < 1 && ligne.dividendYield === undefined ? rendementBrut * 100 : rendementBrut,
      pays: texte(ligne.region),
    });
  }
  return { actions, total: typeof resultat?.total === 'number' ? resultat.total : actions.length };
}
