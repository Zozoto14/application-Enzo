/**
 * `Stockage` du moteur = base chiffrée du PROFIL courant.
 *
 * On ne crée aucun fichier : les données de Tsuzuku sont des paramètres de la
 * base du profil ouvert (`DepotParametres`, une base par profil, chiffrée avec
 * ses clés). Deux profils n'ont donc jamais la même base : rien n'est partagé,
 * ni la bibliothèque, ni les liens manuels, ni la clé TMDB. Les clés sont
 * préfixées `tsuzuku.` pour ne rien heurter.
 */

import type { Stockage } from '../moteur/bibliotheque';

/** Clé/valeur synchrone de la base du profil (forme de `StockagePrefs` du hub, avec suppression facultative). */
export interface BasePrefs {
  lire(cle: string): string | undefined | null;
  ecrire(cle: string, valeur: string): void;
  supprimer?(cle: string): void;
}

export const PREFIXE = 'tsuzuku.';

export const CLES = {
  bibliotheque: 'tsuzuku.bibliotheque',
  /** Sources : dans la base de l'administrateur. */
  sources: 'tsuzuku.sources',
  /** Copie lisible des sources de l'administrateur, dans la base d'un ami (remplie par la synchro, P3). */
  sourcesAdmin: 'tsuzuku.sources.admin',
  reglages: 'tsuzuku.reglages',
  /** Dernier mode ouvert (animés ou films). */
  mode: 'tsuzuku.mode',
} as const;

export function stockageDepuisBase(base: BasePrefs): Stockage {
  const cleSure = (cle: string) => {
    if (!cle.startsWith(PREFIXE)) {
      throw new Error(`Clé Tsuzuku invalide : ${cle}`);
    }
    return cle;
  };
  return {
    lire: async cle => base.lire(cleSure(cle)) || null,
    ecrire: async (cle, valeur) => base.ecrire(cleSure(cle), valeur),
    // Sans suppression native : une valeur vide vaut « absente » pour le moteur (lire renvoie '' → null).
    supprimer: async cle => {
      if (base.supprimer) {
        base.supprimer(cleSure(cle));
      } else {
        base.ecrire(cleSure(cle), '');
      }
    },
  };
}
