/**
 * Mémoire, PAR SOURCE, des lecteurs qui marchent le mieux : gardée dans le
 * cache chiffré du profil (sur l'appareil, jamais synchronisée), pour que les
 * lecteurs fiables soient essayés en premier les fois suivantes.
 */

import { fiabiliteValide, noterResultat, ordonnerParFiabilite, type FiabiliteSources } from '../moteur/basculeLecteurs';
import type { Lecteur } from '../moteur/resolution';
import type { ServicesTsuzuku } from './services';

const CLE = 'fiabilite-lecteurs';

const parServices = new WeakMap<object, Promise<FiabiliteSources>>();

/** Mémoire de ce profil (lue une fois, puis tenue à jour en mémoire). */
function charger(s: Pick<ServicesTsuzuku, 'cache'>): Promise<FiabiliteSources> {
  let p = parServices.get(s.cache);
  if (!p) {
    p = s.cache.lire<unknown>(CLE).then(
      e => fiabiliteValide(e?.valeur),
      () => ({}),
    );
    parServices.set(s.cache, p);
  }
  return p;
}

/** Les lecteurs rangés du plus fiable au moins fiable pour cette source (ordre du site sans source ni mémoire). Jamais d'erreur. */
export async function lecteursParFiabilite(s: Pick<ServicesTsuzuku, 'cache'>, source: string | undefined, lecteurs: readonly Lecteur[]): Promise<Lecteur[]> {
  if (!source || lecteurs.length < 2) return [...lecteurs];
  try {
    return ordonnerParFiabilite(lecteurs, (await charger(s))[source]);
  } catch {
    return [...lecteurs];
  }
}

/** Retient qu'un lecteur a marché ou échoué sur cette source. Jamais d'erreur. */
export async function noterLecteur(s: Pick<ServicesTsuzuku, 'cache'>, source: string | undefined, lecteur: Lecteur, reussi: boolean): Promise<void> {
  if (!source) return;
  try {
    const suivant = noterResultat(await charger(s), source, lecteur, reussi);
    parServices.set(s.cache, Promise.resolve(suivant));
    s.cache.ecrire(CLE, suivant);
  } catch {
    // Mémoire facultative.
  }
}
