/**
 * Du titre au lecteur : liens manuels d'abord, puis sources de l'administrateur.
 * Fonctions asynchrones sans interface, testées avec un faux réseau.
 */

import { lireAssociation, lireLienFilm, adresseEpisode } from '../moteur/liensManuels';
import { classerMedia } from '../moteur/garde';
import { messageDe } from '../moteur/erreurs';
import {
  lecteursPourPage,
  trouverEpisodes,
  trouverFilm,
  trouverLecteurs,
  type EpisodeSource,
  type Lecteur,
} from '../moteur/resolution';
import { MESSAGE_SITE } from '../plateforme/reseauWeb';
import type { ServicesTsuzuku } from './services';

export interface Lecture {
  lecteurs: Lecteur[];
  origine: 'manuel' | 'source' | 'aucune';
  /** Pourquoi rien n'est lisible, ou ce qu'il faut savoir (page seule, site refusant l'iframe…). */
  message?: string;
}

const AUCUNE_SOURCE = 'Aucune source ne fournit ce titre. Ajoutez un lien direct, ou demandez à l’administrateur de brancher une source.';

/** Lien manuel → lecteurs. Sur le site (pas de lecture de pages) : le lien est affiché tel quel. */
async function depuisLien(s: ServicesTsuzuku, url: string, label: string, kind: 'anime' | 'movie'): Promise<Lecture> {
  if (!s.lectureSources) {
    const media = classerMedia(url);
    return {
      lecteurs: [{ label: media === 'iframe' ? `${label} - page intégrée` : `${label} - fichier vidéo`, url, kind: media }],
      origine: 'manuel',
      message: media === 'iframe' ? `${MESSAGE_SITE} La page est affichée telle quelle (le site peut refuser l’intégration).` : undefined,
    };
  }
  const r = await lecteursPourPage(s.ctx, await s.sources(), url, { label, kind });
  return { lecteurs: r.sources, origine: 'manuel', message: r.warning };
}

export async function lireAnime(
  s: ServicesTsuzuku,
  o: { id: string | number; titres: readonly string[]; numero: number },
): Promise<Lecture> {
  const db = await s.depot.lire();
  const adresse = adresseEpisode(lireAssociation(db.manualSources, o.id), o.numero);
  if (adresse) {
    return depuisLien(s, adresse, `Épisode ${o.numero}`, 'anime');
  }
  const sources = await s.sources();
  if (!s.lectureSources) {
    return { lecteurs: [], origine: 'aucune', message: sources.length ? MESSAGE_SITE : `${AUCUNE_SOURCE} ${MESSAGE_SITE}` };
  }
  if (!sources.some(x => x.enabled)) {
    return { lecteurs: [], origine: 'aucune', message: AUCUNE_SOURCE };
  }
  try {
    const langue = (await s.reglages()).langue;
    const r = await trouverEpisodes(s.ctx, sources, { titres: o.titres, langue });
    const ep: EpisodeSource | undefined = r.episodes.find(e => e.number === o.numero);
    if (!ep) {
      return { lecteurs: [], origine: 'aucune', message: r.refuse ? `« ${r.refuse.title} » ressemble trop peu au titre : rien n’a été lu.` : AUCUNE_SOURCE };
    }
    const lecteurs = await trouverLecteurs(s.ctx, sources, ep.url);
    return lecteurs.length ? { lecteurs, origine: 'source' } : { lecteurs, origine: 'aucune', message: 'La page de l’épisode ne contient aucun lecteur reconnu.' };
  } catch (erreur) {
    return { lecteurs: [], origine: 'aucune', message: messageDe(erreur) };
  }
}

export async function lireFilm(
  s: ServicesTsuzuku,
  o: { id: string; titres: readonly string[]; annee?: number | null },
): Promise<Lecture> {
  const db = await s.depot.lire();
  const lien = lireLienFilm(db.manualSources, o.id);
  if (lien) {
    return depuisLien(s, lien.url, lien.label || 'Film', 'movie');
  }
  const sources = await s.sources();
  if (!s.lectureSources) {
    return { lecteurs: [], origine: 'aucune', message: sources.length ? MESSAGE_SITE : `${AUCUNE_SOURCE} ${MESSAGE_SITE}` };
  }
  if (!sources.some(x => x.enabled)) {
    return { lecteurs: [], origine: 'aucune', message: AUCUNE_SOURCE };
  }
  try {
    const r = await trouverFilm(s.ctx, sources, { titres: o.titres, annee: o.annee });
    return r.sources.length
      ? { lecteurs: r.sources, origine: 'source' }
      : { lecteurs: [], origine: 'aucune', message: r.refuse ? `« ${r.refuse.title} » ressemble trop peu au titre : rien n’a été lu.` : AUCUNE_SOURCE };
  } catch (erreur) {
    return { lecteurs: [], origine: 'aucune', message: messageDe(erreur) };
  }
}
