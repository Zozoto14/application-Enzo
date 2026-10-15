/**
 * Temps de réponse typique de chaque SITE source (par hôte), mesuré sur cet
 * appareil et gardé dans le cache chiffré du profil (`latences`).
 *
 * Sert à une seule chose : une source prioritaire CONNUE pour être lente (au
 * moins 2 mesures, typiquement 1,5 s ou plus par page) ne fait plus attendre
 * les autres sources ni ses propres variantes de titre avant qu'elles partent
 * (`ContexteResolution.estLente`). La priorité des sources, elle, ne change pas :
 * une moins prioritaire qui trouve attend toujours la plus prioritaire le délai
 * de grâce. Une page servie par le cache du relais n'est pas comptée (elle dirait
 * « rapide » d'un site lent).
 */

import type { CacheTsuzuku } from './cache';

/** Typiquement au moins ce temps par page : la source est « lente ». */
export const SEUIL_LENTE_MS = 1500;
/** Mesures nécessaires avant de conclure. */
export const MESURES_MIN = 2;
/** Hôtes suivis au plus (les plus anciens partent d'abord). */
export const HOTES_MAX = 60;
const CLE = 'latences';
/** Poids de la dernière mesure (moyenne glissante). */
const POIDS = 0.35;

interface Suivi {
  /** Temps typique (moyenne glissante, ms). */
  ms: number;
  n: number;
}

export interface SuiviLatences {
  /** Note le temps d'une requête vers `url`. */
  noter(url: string, ms: number): void;
  /** Temps typique connu pour l'hôte de `url` (undefined : pas assez de mesures). */
  typique(url: string): number | undefined;
  /** Vrai si le site de `url` est connu pour être lent. */
  estLente(url: string): boolean;
  /** Relit les mesures gardées sur l'appareil (une fois). */
  charger(): Promise<void>;
}

function hoteDe(url: string): string | undefined {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url);
  return m ? m[1].toLowerCase() : undefined;
}

export function creerSuiviLatences(cache?: Pick<CacheTsuzuku, 'lire' | 'ecrire'>): SuiviLatences {
  const hotes = new Map<string, Suivi>();
  let charge: Promise<void> | undefined;
  const ranger = () => cache?.ecrire(CLE, Object.fromEntries(hotes));
  const typique = (url: string) => {
    const s = hotes.get(hoteDe(url) ?? '');
    return s && s.n >= MESURES_MIN ? s.ms : undefined;
  };
  return {
    noter(url, ms) {
      const hote = hoteDe(url);
      if (!hote || !Number.isFinite(ms) || ms < 0) return;
      const avant = hotes.get(hote);
      const suivi = avant ? { ms: Math.round(avant.ms * (1 - POIDS) + ms * POIDS), n: Math.min(avant.n + 1, 1000) } : { ms: Math.round(ms), n: 1 };
      hotes.delete(hote);
      hotes.set(hote, suivi);
      while (hotes.size > HOTES_MAX) hotes.delete(hotes.keys().next().value as string);
      ranger();
    },
    typique,
    estLente: url => (typique(url) ?? 0) >= SEUIL_LENTE_MS,
    charger() {
      if (!charge) charge = (async () => {
        try {
          const e = await cache?.lire<Record<string, Suivi>>(CLE);
          for (const [hote, s] of Object.entries(e?.valeur ?? {})) {
            if (!hotes.has(hote) && s && Number.isFinite(s.ms) && Number.isFinite(s.n)) hotes.set(hote, { ms: s.ms, n: s.n });
          }
        } catch {
          // Rien de gardé : les mesures recommencent.
        }
      })();
      return charge;
    },
  };
}
