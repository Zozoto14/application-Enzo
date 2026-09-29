/**
 * Liens vers les fiches externes d'une valeur.
 *
 * L'application tient un registre exact de ce que vous détenez : prix de
 * revient au centime, fiscalité française, tout hors ligne. Elle ne dira
 * jamais si une action est chère, ce que pensent les analystes, ou comment se
 * porte le bilan — ces données demandent des flux payants que le projet n'a
 * pas et n'aura pas.
 *
 * Plutôt que de faire semblant, on renvoie là où l'information existe.
 *
 * ## Pourquoi un lien collé plutôt qu'une adresse construite
 *
 * Chez Baggr, une valeur est désignée par un identifiant opaque :
 * `app.baggr.fr/screener/1c7a9641-…`. Aucun ticker, aucun ISIN ne permet de le
 * reconstruire. Fabriquer une adresse reviendrait à ouvrir une page au hasard.
 *
 * Le lien se colle donc une fois par valeur, et il tombe toujours juste.
 * Tant qu'il est absent, on propose l'accueil du service : un clic de plus,
 * mais jamais une mauvaise page.
 *
 * Yahoo Finance, lui, se construit sans risque à partir du symbole — c'est
 * déjà celui qu'on interroge pour les cours.
 */

import type { Titre } from '../../core/domain/types';

export interface LienExterne {
  cle: string;
  libelle: string;
  url: string;
  /** Ce qu'on va y trouver, en une phrase. */
  aQuoiCaSert: string;
  /** Vrai quand le lien mène à la fiche exacte, faux quand il faut chercher. */
  direct: boolean;
}

export const ACCUEIL_BAGGR = 'https://app.baggr.fr/';

/** Protocoles acceptés pour un lien collé. */
const PROTOCOLES = ['https://', 'http://'];

/**
 * Valide un lien collé.
 *
 * Refuse tout ce qui n'est pas une adresse web : coller un `javascript:` dans
 * un champ qui finira dans un `openURL` serait une mauvaise idée, même sur sa
 * propre machine.
 */
export function lienValide(texte: string): boolean {
  const propre = texte.trim();
  if (propre === '') {
    return false;
  }
  return PROTOCOLES.some(protocole => propre.toLowerCase().startsWith(protocole));
}

export function erreurLien(texte: string): string | undefined {
  const propre = texte.trim();
  if (propre === '' || lienValide(propre)) {
    return undefined;
  }
  return 'Adresse attendue, commençant par https://';
}

/** Symbole Yahoo d'une valeur, ou `undefined` s'il n'est pas réglé. */
function symboleYahoo(titre: Titre): string | undefined {
  const symbole = titre.ticker?.trim();
  return symbole ? symbole : undefined;
}

export function liensDe(titre: Titre): LienExterne[] {
  const liens: LienExterne[] = [];

  const colle = titre.lienExterne?.trim();
  if (colle && lienValide(colle)) {
    liens.push({
      cle: 'baggr',
      libelle: 'Fiche Baggr',
      url: colle,
      aQuoiCaSert: 'Fondamentaux, valorisation, analystes et thèses.',
      direct: true,
    });
  } else {
    liens.push({
      cle: 'baggr',
      libelle: 'Chercher sur Baggr',
      url: ACCUEIL_BAGGR,
      aQuoiCaSert:
        'Collez l’adresse de la fiche une fois, et ce bouton y mènera directement.',
      direct: false,
    });
  }

  const symbole = symboleYahoo(titre);
  if (symbole) {
    liens.push({
      cle: 'yahoo',
      libelle: 'Yahoo Finance',
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbole)}`,
      aQuoiCaSert: 'Cours, historique et actualité — la source des cours de l’application.',
      direct: true,
    });
  }

  // Un vrai ISIN seulement : une valeur ajoutée depuis la recherche n'en a pas.
  if (/^[A-Z]{2}[A-Z0-9]{10}$/.test(titre.isin)) {
    liens.push({
      cle: 'euronext',
      libelle: 'Euronext',
      url: `https://live.euronext.com/fr/search_instruments/${encodeURIComponent(titre.isin)}`,
      aQuoiCaSert: 'Fiche officielle de la place : cotation, avis, documents.',
      direct: true,
    });
  }

  return liens;
}
