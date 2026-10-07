/**
 * Recherche du symbole d'une valeur.
 *
 * L'export de positions d'un courtier donne un ISIN et un libellé, pas un
 * symbole de cotation. Il faut donc en trouver un — et c'est là qu'on peut se
 * tromper très discrètement.
 *
 * **Un ISIN ne désigne pas une place de cotation.** La même société s'échange
 * sur plusieurs marchés, à des cours différents, dans des devises différentes.
 * Vérifié le 24/09/2026 : l'ISIN de Stellantis rend Milan et Stuttgart, mais
 * pas Paris, alors que c'est à Paris que la ligne est détenue. Une résolution
 * automatique aurait valorisé le portefeuille sur le mauvais marché, et
 * l'écart n'aurait sauté aux yeux de personne.
 *
 * Ce module **propose donc des candidats et n'en choisit aucun**. Il met en
 * tête ceux d'Euronext Paris, signale quand il n'y en a pas, et laisse
 * trancher.
 */

import { ErreurFournisseur } from './fournisseur';

/** Codes de place renvoyés par Yahoo pour Euronext Paris. */
const PLACES_PARIS = new Set(['PAR', 'ENX', 'EPA']);

/** Suffixe de symbole d'Euronext Paris. */
export const SUFFIXE_PARIS = '.PA';

export interface CandidatSymbole {
  symbole: string;
  nom: string;
  /** Code de la place de cotation, tel que rendu par la source. */
  place: string;
  /** Devise de cotation, quand la source la donne. */
  devise?: string;
  /** Type d'instrument : action, ETF… */
  type?: string;
  /** Vrai si le candidat cote à Euronext Paris. */
  paris: boolean;
}

export interface ResultatRecherche {
  candidats: CandidatSymbole[];
  /** Renseigné quand le résultat demande une vigilance particulière. */
  avertissement?: string;
}

export interface OptionsRecherche {
  /** Implémentation de `fetch`, injectable pour les tests. */
  recuperer?: typeof fetch;
  /** Nombre maximal de candidats rendus. */
  limite?: number;
}

const URL_RECHERCHE = 'https://query1.finance.yahoo.com/v1/finance/search';

function estParis(place: string, symbole: string): boolean {
  return PLACES_PARIS.has(place.toUpperCase()) || symbole.toUpperCase().endsWith(SUFFIXE_PARIS);
}

/**
 * Cherche les symboles correspondant à un ISIN, un nom ou un ticker.
 *
 * Ne lève que si la source est injoignable : une recherche sans résultat est
 * une réponse, pas une panne.
 */
export async function chercherSymboles(
  requete: string,
  options: OptionsRecherche = {},
): Promise<ResultatRecherche> {
  const terme = requete.trim();
  if (terme === '') {
    return { candidats: [], avertissement: 'Saisissez un ISIN, un nom ou un ticker.' };
  }

  const limite = options.limite ?? 8;
  const appeler = options.recuperer ?? fetch;
  const url = `${URL_RECHERCHE}?q=${encodeURIComponent(terme)}&quotesCount=${limite}&newsCount=0`;

  let charge: unknown;
  try {
    const reponse = await appeler(url);
    if (!reponse.ok) {
      throw new ErreurFournisseur(`réponse ${reponse.status} de la recherche`);
    }
    charge = await reponse.json();
  } catch (erreur) {
    throw new ErreurFournisseur(
      erreur instanceof Error ? erreur.message : String(erreur),
    );
  }

  const brutes = (charge as { quotes?: unknown })?.quotes;
  const lignes = Array.isArray(brutes) ? brutes : [];

  const candidats: CandidatSymbole[] = [];
  for (const ligne of lignes) {
    if (!ligne || typeof ligne !== 'object') {
      continue;
    }
    const enregistrement = ligne as Record<string, unknown>;
    const symbole = enregistrement.symbol;
    if (typeof symbole !== 'string' || symbole === '') {
      continue;
    }
    const place = typeof enregistrement.exchange === 'string' ? enregistrement.exchange : '';
    const nom =
      (typeof enregistrement.shortname === 'string' && enregistrement.shortname) ||
      (typeof enregistrement.longname === 'string' && enregistrement.longname) ||
      symbole;

    candidats.push({
      symbole,
      nom,
      place,
      devise: typeof enregistrement.currency === 'string' ? enregistrement.currency : undefined,
      type: typeof enregistrement.quoteType === 'string' ? enregistrement.quoteType : undefined,
      paris: estParis(place, symbole),
    });
  }

  // Paris en tete : c'est la place ou vit le portefeuille. L'ordre d'origine
  // est conserve a l'interieur de chaque groupe.
  const ordonnes = [
    ...candidats.filter(candidat => candidat.paris),
    ...candidats.filter(candidat => !candidat.paris),
  ];

  return {
    candidats: ordonnes,
    avertissement: avertissementDe(ordonnes, terme),
  };
}

function avertissementDe(
  candidats: readonly CandidatSymbole[],
  terme: string,
): string | undefined {
  if (candidats.length === 0) {
    return `Aucun résultat pour « ${terme} ». Essayez le nom de la valeur, ou son ticker suivi de ${SUFFIXE_PARIS}.`;
  }
  if (!candidats.some(candidat => candidat.paris)) {
    return `Aucun résultat sur Euronext Paris. Les places proposées cotent la même valeur, mais à un autre cours et parfois dans une autre devise — vérifiez que c’est bien celle où vous détenez la ligne.`;
  }
  return undefined;
}

/** Symbole Euronext Paris construit à partir d'un ticker, pour un essai direct. */
export function symboleParis(ticker: string): string {
  const propre = ticker.trim().toUpperCase();
  if (propre === '') {
    return '';
  }
  return propre.endsWith(SUFFIXE_PARIS) ? propre : `${propre}${SUFFIXE_PARIS}`;
}
