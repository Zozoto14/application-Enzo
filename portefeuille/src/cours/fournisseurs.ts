/**
 * Fournisseurs de cours prédéfinis.
 *
 * **Tous sont marqués `provisoire`.** Leurs gabarits d'URL et leurs chemins
 * JSON sont établis d'après la documentation publique, sans qu'aucune réponse
 * réelle n'ait pu être observée : les plans gratuits exigent une clé, et la
 * couverture d'Euronext Paris — le point ouvert du cadrage — ne se vérifie
 * qu'avec des tickers réels.
 *
 * C'est la même prudence que pour les modèles d'import : la mécanique est
 * testée, le mapping ne l'est pas. Le corriger demande une ligne, pas une
 * réécriture, et l'interface doit afficher l'avertissement.
 *
 * Marche à suivre pour en valider un :
 *  1. créer un compte et obtenir une clé sur le plan gratuit ;
 *  2. lancer `rafraichirCours` sur un seul titre réel ;
 *  3. comparer le cours obtenu à celui affiché par le courtier ;
 *  4. si la réponse ne correspond pas, ajuster `cheminCours` d'après le JSON
 *     réellement reçu, puis retirer `provisoire`.
 */

import { fournisseurConfigurable, type ConfigFournisseur } from './fournisseur-configurable';
import type { FournisseurCours } from './fournisseur';

/**
 * Financial Modeling Prep, socle `/stable/`.
 *
 * L'ancienne API `/api/v3/` a ete retiree le 31 aout 2025 : elle ne repond
 * plus que « Legacy Endpoint » aux comptes crees apres cette date. Le gabarit
 * ci-dessous vient de la documentation courante, observee le 24/09/2026.
 *
 * `/stable/quote` ne prend **qu'un symbole par appel** — la cotation groupee
 * est passee derriere un endpoint « Bulk ». Sur un portefeuille de quatre
 * lignes, cela fait quatre requetes par rafraichissement, largement tenable
 * face aux 250 requetes quotidiennes du palier gratuit.
 */
export const CONFIG_FINANCIAL_MODELING_PREP: ConfigFournisseur = {
  id: 'fmp',
  libelle: 'Financial Modeling Prep',
  provisoire: true,
  cleRequise: true,
  urlGabarit: 'https://financialmodelingprep.com/stable/quote?symbol={symboles}&apikey={cle}',
  symbolesParAppel: 1,
  separateurSymboles: ',',
  cheminListe: '',
  cheminCours: 'price',
  cheminSymbole: 'symbol',
  cheminDate: 'timestamp',
};

/**
 * Yahoo Finance, point d'entree « chart ».
 *
 * Le seul fournisseur verifie qui cote Euronext Paris sans abonnement. Les
 * paliers gratuits des fournisseurs commerciaux sont tous americains : FMP
 * refuse les symboles europeens (« this value set for 'symbol' is not
 * available »), et Twelve Data reserve les 27 marches a son palier payant.
 *
 * Reponse observee le 24/09/2026 sur STLAP.PA et CW8.PA, d'ou l'absence de
 * `provisoire` : le mapping ci-dessous a ete lu dans un vrai JSON, pas dans
 * une documentation.
 *
 * **La contrepartie est reelle** : cette interface n'est ni documentee ni
 * officielle. Yahoo peut la modifier ou la fermer sans preavis. C'est pourquoi
 * le re-import de l'export de positions du courtier reste la procedure de
 * secours — il porte `lastPrice`, donc il met les cours a jour sans aucun
 * tiers. Voir docs/cours.md.
 */
export const CONFIG_YAHOO: ConfigFournisseur = {
  id: 'yahoo',
  libelle: 'Yahoo Finance',
  cleRequise: false,
  // Un symbole par appel : il vit dans le chemin de l'URL, pas en parametre.
  urlGabarit:
    'https://query1.finance.yahoo.com/v8/finance/chart/{symboles}?range=1d&interval=1d',
  symbolesParAppel: 1,
  separateurSymboles: ',',
  cheminListe: 'chart.result',
  cheminCours: 'meta.regularMarketPrice',
  cheminSymbole: 'meta.symbol',
  // Horodatage en secondes.
  cheminDate: 'meta.regularMarketTime',
};

export const CONFIG_FINNHUB: ConfigFournisseur = {
  id: 'finnhub',
  libelle: 'Finnhub',
  provisoire: true,
  cleRequise: true,
  // Finnhub ne cote qu'un symbole par appel : sur un portefeuille de vingt
  // lignes, cela fait vingt requêtes, à surveiller face aux limites de débit.
  urlGabarit: 'https://finnhub.io/api/v1/quote?symbol={symboles}&token={cle}',
  symbolesParAppel: 1,
  separateurSymboles: ',',
  cheminListe: '',
  cheminCours: 'c',
  cheminDate: 't',
};

export const CONFIG_ALPHA_VANTAGE: ConfigFournisseur = {
  id: 'alpha-vantage',
  libelle: 'Alpha Vantage',
  provisoire: true,
  cleRequise: true,
  urlGabarit:
    'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol={symboles}&apikey={cle}',
  symbolesParAppel: 1,
  separateurSymboles: ',',
  // Segments explicites : ces noms de champs contiennent un point.
  cheminListe: ['Global Quote'],
  cheminCours: ['05. price'],
  cheminDate: ['07. latest trading day'],
};

export const CONFIGS: readonly ConfigFournisseur[] = [
  // Yahoo en tete : c'est le seul verifie sur Euronext Paris.
  CONFIG_YAHOO,
  CONFIG_FINANCIAL_MODELING_PREP,
  CONFIG_FINNHUB,
  CONFIG_ALPHA_VANTAGE,
];

export function fournisseurParId(id: string): FournisseurCours | undefined {
  const config = CONFIGS.find(candidat => candidat.id === id);
  return config ? fournisseurConfigurable(config) : undefined;
}

export const FOURNISSEURS: readonly FournisseurCours[] =
  CONFIGS.map(fournisseurConfigurable);
