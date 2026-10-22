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
  /** Sources d'un Fondateur (les siennes), dans SA base. */
  sources: 'tsuzuku.sources',
  /** Ancienne copie des sources de l'administrateur (jamais remplie) : plus lue. */
  sourcesAdmin: 'tsuzuku.sources.admin',
  /** Partage de chaque source (Fondateur) : personne, tous, ou une sélection de comptes. */
  partages: 'tsuzuku.partages',
  /** Sources partagées reçues par la synchronisation (lecture seule), dans la base du bénéficiaire. */
  sourcesRecues: 'tsuzuku.sources.partagees',
  /** Choix personnels : source partagée activée ou non pour soi. */
  choixSources: 'tsuzuku.sources.choix',
  /** Paire X25519 de réception des sources partagées (clé privée : jamais hors de la base). */
  reception: 'tsuzuku.reception',
  /** Résultat du dernier test de chaque source (Fondateur) : OK/KO, date, détail. */
  testsSources: 'tsuzuku.sources.tests',
  /** Clés d'API et options avancées du moteur (Fondateur). */
  avance: 'tsuzuku.avance',
  /** Réglages de confort (doublage, épisode suivant, déjà vus). */
  reglages: 'tsuzuku.reglages',
  /** Langue choisie (VF / VOSTFR) par série (synchronisée, une entrée par série). */
  languesSeries: 'tsuzuku.langues',
  /** Fiabilité des lecteurs, par source (synchronisée : les lecteurs qui marchent passent en premier partout). */
  fiabiliteLecteurs: 'tsuzuku.lecteurs.fiabilite',
  /** Position de lecture dans l'épisode en cours, par titre (vidéo directe ; synchronisée). */
  positions: 'tsuzuku.positions',
  /** Titre choisi à la main pour chercher une fiche sur les sources (« Chercher avec un autre titre »), par fiche. */
  titresRecherche: 'tsuzuku.recherche.titres',
  /** Dernier mode ouvert (animés ou films). */
  mode: 'tsuzuku.mode',
  /** Cache (catalogue, recherches sur les sources, lecteurs, temps de réponse des sites) : sur CET appareil, borné, jamais synchronisé (régénérable). */
  cache: 'tsuzuku.cache',
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
