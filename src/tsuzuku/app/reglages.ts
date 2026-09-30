/**
 * Réglages de Tsuzuku (Paramètres › Tsuzuku), rangés dans la base du profil.
 * Données pures : lecture tolérante (une valeur retouchée retombe sur le défaut).
 */

import { LANGUES, type Langue } from '../moteur/sources';

export interface ReglagesTsuzuku {
  /** Clé TMDB (v3 ou jeton « Bearer »), facultative : sans elle, les films passent par Jikan. */
  cleTmdb: string;
  /** Doublage préféré quand une source distingue VF et VOSTFR. */
  langue: Langue;
  /** Lance l'épisode suivant à la fin de celui-ci. */
  suivantAuto: boolean;
  /** Cache les titres déjà vus dans le catalogue. */
  masquerVus: boolean;
}

export const REGLAGES_DEFAUT: ReglagesTsuzuku = { cleTmdb: '', langue: 'vostfr', suivantAuto: true, masquerVus: false };

export function lireReglages(texte: string | null | undefined): ReglagesTsuzuku {
  try {
    const o = texte ? (JSON.parse(texte) as Record<string, unknown>) : {};
    return {
      cleTmdb: typeof o.cleTmdb === 'string' ? o.cleTmdb.trim().slice(0, 600) : '',
      langue: LANGUES.includes(o.langue as Langue) ? (o.langue as Langue) : REGLAGES_DEFAUT.langue,
      suivantAuto: typeof o.suivantAuto === 'boolean' ? o.suivantAuto : REGLAGES_DEFAUT.suivantAuto,
      masquerVus: typeof o.masquerVus === 'boolean' ? o.masquerVus : REGLAGES_DEFAUT.masquerVus,
    };
  } catch {
    return { ...REGLAGES_DEFAUT };
  }
}

export const ecrireReglages = (r: ReglagesTsuzuku): string => JSON.stringify(lireReglages(JSON.stringify(r)));
