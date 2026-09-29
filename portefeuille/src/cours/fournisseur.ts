/**
 * Récupération des cours auprès d'un fournisseur externe.
 *
 * Deux principes, tirés de ce qu'on a déjà appris sur les imports :
 *
 *  - **Le mapping est de la configuration, pas du code.** La forme exacte des
 *    réponses d'une API de cotation ne se devine pas depuis un PC sans clé.
 *    Un fournisseur se décrit donc par un gabarit d'URL et des chemins JSON,
 *    que l'on corrige en une ligne une fois la vraie réponse observée.
 *
 *  - **Un échec partiel est le cas normal.** Un titre introuvable, une limite
 *    de débit atteinte ou une coupure réseau ne doivent jamais faire échouer
 *    l'ensemble ni écraser les cours déjà connus.
 */

import { Decimal } from '../core/money/decimal';

export interface DemandeCours {
  titreId: string;
  /** Symbole attendu par le fournisseur, généralement le ticker. */
  symbole: string;
}

export interface CoursRecupere {
  titreId: string;
  cours: Decimal;
  /** Date de la cotation au format ISO. */
  date: string;
}

export interface EchecCours {
  titreId: string;
  symbole: string;
  raison: string;
}

export interface ResultatCours {
  cours: CoursRecupere[];
  echecs: EchecCours[];
}

export interface OptionsRecuperation {
  /** Clé d'API, si le fournisseur en exige une. */
  cle?: string;
  /** Date attribuée aux cotations qui n'en portent pas. */
  aujourdhui?: string;
  /** Implémentation de `fetch`, injectable pour les tests. */
  recuperer?: typeof fetch;
}

export interface FournisseurCours {
  id: string;
  libelle: string;
  /** Vrai tant que le mapping n'a pas été confronté à une vraie réponse. */
  provisoire?: boolean;
  /** Vrai si une clé d'API est nécessaire. */
  cleRequise: boolean;
  recuperer(
    demandes: readonly DemandeCours[],
    options?: OptionsRecuperation,
  ): Promise<ResultatCours>;
}

export class ErreurFournisseur extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurFournisseur';
  }
}

/**
 * Chemin d'accès dans une réponse JSON.
 *
 * La forme pointée (« quote.c », « 0.price ») suffit dans la plupart des cas.
 * La forme en segments est indispensable dès qu'un nom de champ contient
 * lui-même un point : Alpha Vantage nomme littéralement ses champs
 * « 05. price », qu'un découpage sur le point mettrait en pièces.
 */
export type CheminJson = string | readonly string[];

function segments(chemin: CheminJson): readonly string[] {
  if (Array.isArray(chemin)) {
    return chemin;
  }
  const texte = chemin as string;
  return texte === '' ? [] : texte.split('.');
}

/**
 * Lit une valeur dans une réponse JSON.
 * Renvoie `undefined` dès qu'un maillon manque, plutôt que de lever : une
 * réponse incomplète est un échec de ligne, pas de l'appel entier.
 */
export function lireChemin(source: unknown, chemin: CheminJson): unknown {
  let courant: unknown = source;
  for (const segment of segments(chemin)) {
    if (courant === null || courant === undefined) {
      return undefined;
    }
    if (Array.isArray(courant)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      courant = courant[index];
    } else if (typeof courant === 'object') {
      courant = (courant as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return courant;
}

/** Convertit une valeur de réponse en Decimal, ou `undefined` si elle n'en est pas une. */
export function versCours(valeur: unknown): Decimal | undefined {
  if (typeof valeur === 'number') {
    if (!Number.isFinite(valeur) || valeur <= 0) {
      return undefined;
    }
    return Decimal.de(valeur);
  }
  if (typeof valeur === 'string' && valeur.trim() !== '') {
    try {
      const cours = Decimal.de(valeur.trim());
      return cours.estPositif() ? cours : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
