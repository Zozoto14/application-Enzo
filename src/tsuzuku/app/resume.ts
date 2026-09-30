/**
 * Information en direct de la tuile Tsuzuku du hub, calculée depuis la
 * bibliothèque du profil (JSON de la base, lu de façon synchrone par l'hôte).
 * Données pures.
 */

import type { InfoLive } from '../../hub/types';
import { migrerBibliotheque, type Entree } from '../moteur/bibliotheque';

export interface ResumeTsuzuku {
  /** Ce qu'on reprendrait : le titre le plus récemment regardé et pas terminé. */
  reprise?: { titre: string; episode: number | null; film: boolean };
  aVoir: number;
  enCours: number;
  vus: number;
}

const VUS = new Set(['vu', 'vu_ailleurs']);

export function resumerBibliotheque(texte: string | null | undefined): ResumeTsuzuku | undefined {
  if (texte === undefined || texte === null) {
    return undefined;
  }
  let db;
  try {
    db = migrerBibliotheque(texte ? JSON.parse(texte) : {});
  } catch {
    return undefined;
  }
  const tous: Entree[] = [...db.anime, ...db.movies];
  const reprenables = tous
    .filter(e => e.status === 'en_cours' || e.status === 'a_reprendre')
    .sort((a, b) => String(b.lastWatched ?? '').localeCompare(String(a.lastWatched ?? '')));
  const e = reprenables[0];
  return {
    reprise: e
      ? {
          titre: e.title,
          film: e.kind === 'movie',
          episode: e.kind === 'movie' ? null : Math.min((e.currentEpisode || 0) + 1, e.totalEpisodes && e.totalEpisodes > 0 ? e.totalEpisodes : Infinity),
        }
      : undefined,
    aVoir: tous.filter(x => x.status === 'a_voir').length,
    enCours: reprenables.length,
    vus: tous.filter(x => VUS.has(x.status)).length,
  };
}

export function infoTsuzuku(resume: ResumeTsuzuku | undefined): InfoLive | undefined {
  if (!resume) {
    return undefined;
  }
  const { reprise } = resume;
  let sousTitre = 'Animés et films, sans serveur.';
  if (reprise) {
    sousTitre = reprise.episode === null ? `Reprendre ${reprise.titre}` : `Reprendre ${reprise.titre} · Ép. ${reprise.episode}`;
  } else if (resume.aVoir > 0) {
    sousTitre = `${resume.aVoir} à voir`;
  }
  return {
    sousTitre,
    indicateurs: [
      { libelle: 'À voir', valeur: String(resume.aVoir) },
      { libelle: 'En cours', valeur: String(resume.enCours) },
      { libelle: 'Vus', valeur: String(resume.vus) },
    ],
  };
}
