/**
 * `Reseau` direct du site (navigateur) : le CORS interdit de lire les pages
 * d'un site tiers, et un navigateur ne voit pas les redirections. On n'y joint
 * donc directement QUE les catalogues qui autorisent le CORS (Jikan, AniList,
 * TMDB) ; toute autre adresse (une source, un lien manuel à analyser) passe par
 * le relais pour le compte Fondateur relié (`reseauRelais.ts`), ou est refusée
 * avec un message clair. Un lien direct (mp4, m3u8, iframe) reste lisible : il
 * est affiché, pas lu.
 */

import { echec } from '../moteur/erreurs';
import { analyserAdresse } from '../moteur/adresse';
import { reseauDepuisFetch, type FonctionFetch, type Reseau } from '../moteur/reseau';

export const HOTES_CATALOGUE: readonly string[] = ['api.jikan.moe', 'graphql.anilist.co', 'api.themoviedb.org'];

export const MESSAGE_SITE =
  'Sur le site, les sources se lisent par le relais, pour le seul compte Fondateur relié au relais (Paramètres › Synchronisation, code de liaison du PC). Sinon : lecture des sources sur l’app PC/iPhone, ou collez un lien direct.';

export function hoteDeCatalogue(url: string): boolean {
  const a = analyserAdresse(url);
  return Boolean(a && a.schema === 'https' && a.hote && HOTES_CATALOGUE.includes(a.hote.toLowerCase()));
}

export function reseauWeb(fetchFn?: FonctionFetch): Reseau {
  const brut = fetchFn ?? ((globalThis as { fetch?: unknown }).fetch as FonctionFetch | undefined);
  const interne = brut ? reseauDepuisFetch((url, init) => brut(url, init)) : undefined;
  return {
    async requete(r) {
      if (!hoteDeCatalogue(r.url)) {
        throw echec(MESSAGE_SITE, 'reseau', 501);
      }
      if (!interne) {
        throw echec('Réseau indisponible', 'reseau', 502);
      }
      return interne.requete(r);
    },
  };
}
