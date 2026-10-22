/**
 * Mémoire, PAR SOURCE, des lecteurs qui marchent le mieux, pour que les
 * lecteurs fiables soient essayés en premier les fois suivantes.
 *
 * Rangée dans la base chiffrée du profil (`tsuzuku.lecteurs.fiabilite`) et
 * SYNCHRONISÉE avec le coffre serveur du compte (une entrée par source,
 * fusion lecteur par lecteur : le résultat le plus récent gagne, voir
 * sync/relais/entitesTsuzuku.ts) : un lecteur en panne repéré sur le PC
 * passe après sur le téléphone aussi. Avant, elle vivait dans le cache de
 * l'appareil (`tsuzuku.cache`, clé `fiabilite-lecteurs`) : elle en est reprise
 * une fois, à la première lecture.
 */

import { fiabiliteValide, noterResultat, ordonnerParFiabilite, type FiabiliteSources } from '../moteur/basculeLecteurs';
import type { Lecteur } from '../moteur/resolution';
import { CLES } from '../plateforme/stockage';
import type { ServicesTsuzuku } from './services';

/** Ancienne place (cache de l'appareil). */
export const CLE_CACHE_ANCIENNE = 'fiabilite-lecteurs';

type Acces = Pick<ServicesTsuzuku, 'cache'> & Partial<Pick<ServicesTsuzuku, 'stockage'>>;

const parCache = new WeakMap<object, Promise<FiabiliteSources>>();

const depuisCache = (s: Acces): Promise<FiabiliteSources> =>
  s.cache.lire<unknown>(CLE_CACHE_ANCIENNE).then(
    e => fiabiliteValide(e?.valeur),
    () => ({}),
  );

/** Mémoire du profil : la base (relue à chaque fois : la synchro peut l'avoir changée), sinon le cache. */
async function charger(s: Acces): Promise<FiabiliteSources> {
  if (!s.stockage) {
    let p = parCache.get(s.cache);
    if (!p) {
      p = depuisCache(s);
      parCache.set(s.cache, p);
    }
    return p;
  }
  const brut = await s.stockage.lire(CLES.fiabiliteLecteurs);
  if (brut) {
    try {
      return fiabiliteValide(JSON.parse(brut));
    } catch {
      return {};
    }
  }
  // Première lecture depuis cette version : reprise de l'ancienne mémoire de l'appareil.
  const ancienne = await depuisCache(s);
  if (Object.keys(ancienne).length) {
    await s.stockage.ecrire(CLES.fiabiliteLecteurs, JSON.stringify(ancienne));
    s.cache.supprimer(CLE_CACHE_ANCIENNE);
  }
  return ancienne;
}

/** Les lecteurs rangés du plus fiable au moins fiable pour cette source (ordre du site sans source ni mémoire). Jamais d'erreur. */
export async function lecteursParFiabilite(s: Acces, source: string | undefined, lecteurs: readonly Lecteur[]): Promise<Lecteur[]> {
  if (!source || lecteurs.length < 2) return [...lecteurs];
  try {
    return ordonnerParFiabilite(lecteurs, (await charger(s))[source]);
  } catch {
    return [...lecteurs];
  }
}

/** Retient qu'un lecteur a marché ou échoué sur cette source. Jamais d'erreur. */
export async function noterLecteur(s: Acces, source: string | undefined, lecteur: Lecteur, reussi: boolean): Promise<void> {
  if (!source) return;
  try {
    const suivant = noterResultat(await charger(s), source, lecteur, reussi);
    if (s.stockage) {
      await s.stockage.ecrire(CLES.fiabiliteLecteurs, JSON.stringify(suivant));
    } else {
      parCache.set(s.cache, Promise.resolve(suivant));
      s.cache.ecrire(CLE_CACHE_ANCIENNE, suivant);
    }
  } catch {
    // Mémoire facultative.
  }
}
