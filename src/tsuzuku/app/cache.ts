/**
 * Cache de Tsuzuku, par profil : en mémoire, et GARDÉ SUR L'APPAREIL dans la
 * base chiffrée du profil (`tsuzuku.cache`), pour que la seconde ouverture
 * d'une fiche ou de l'accueil soit quasi instantanée, même après un
 * rechargement du site (base rangée dans IndexedDB) ou un redémarrage du PC
 * (fichier de la base).
 *
 * - Chiffré comme le reste du profil : un autre profil, un autre appareil ou
 *   un curieux qui ouvrirait le stockage du navigateur ne voit rien (pas de
 *   stockage local en clair). Jamais synchronisé (clé hors des entités).
 * - Borné : `entreesMax` entrées et `octetsMax` octets (les plus anciennes
 *   partent d'abord) ; une entrée trop grosse reste en mémoire seulement.
 * - Écriture groupée (`delaiEcritureMs`) : une rafale de mises en cache
 *   n'écrit la base qu'une fois.
 * - Chaque entrée a son âge ; l'appelant décide de la fraîcheur (TTL,
 *   « périmé mais servi, puis rafraîchi »).
 */

import type { Stockage } from '../moteur/bibliotheque';
import { CLES } from '../plateforme/stockage';

export interface EntreeCache<T = unknown> {
  valeur: T;
  /** Date de mise en cache (ms). */
  a: number;
  /** D'où vient l'entrée lors de cette lecture. */
  origine: 'memoire' | 'appareil';
}

export interface OptionsCache {
  entreesMax?: number;
  octetsMax?: number;
  delaiEcritureMs?: number;
  maintenant?: () => number;
}

export interface CacheTsuzuku {
  lire<T>(cle: string): Promise<EntreeCache<T> | undefined>;
  /** Range (ou remplace) une entrée ; `persister: false` : en mémoire seulement. */
  ecrire<T>(cle: string, valeur: T, o?: { persister?: boolean; a?: number }): void;
  /** L'entrée a été modifiée sur place (objet déjà rangé) : à réécrire. */
  toucher(cle: string): void;
  supprimer(cle: string): void;
  /** Supprime les entrées dont la clé commence par `prefixe`. */
  supprimerPrefixe(prefixe: string): void;
  vider(): Promise<void>;
  /** Écrit tout de suite ce qui attend (fermeture, tests). */
  ecrireMaintenant(): Promise<void>;
  /** Entrées en mémoire (diagnostic, tests). */
  taille(): number;
}

interface Ligne {
  v: unknown;
  a: number;
  /** Lue depuis la base au chargement (et pas réécrite depuis). */
  appareil?: boolean;
  persister: boolean;
}

/** Format rangé dans la base. */
interface Fichier {
  v: 1;
  e: Record<string, { v: unknown; a: number }>;
}

export const ENTREES_MAX = 200;
/** ~0,6 Mo : la base du profil reste petite (elle est chiffrée et rangée en entier). */
export const OCTETS_MAX = 600_000;

export function creerCache(stockage: Pick<Stockage, 'lire' | 'ecrire'> | null, o: OptionsCache = {}): CacheTsuzuku {
  const entreesMax = o.entreesMax ?? ENTREES_MAX;
  const octetsMax = o.octetsMax ?? OCTETS_MAX;
  const delai = o.delaiEcritureMs ?? 1500;
  const maintenant = o.maintenant ?? (() => Date.now());
  const memoire = new Map<string, Ligne>();
  let charge: Promise<void> | null = null;
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  let ecriture: Promise<void> = Promise.resolve();

  const borner = () => {
    while (memoire.size > entreesMax) memoire.delete(memoire.keys().next().value as string);
  };

  const charger = () => {
    if (!charge) {
      charge = (async () => {
        if (!stockage) return;
        try {
          const brut = await stockage.lire(CLES.cache);
          const f = brut ? (JSON.parse(brut) as Fichier) : null;
          if (!f || f.v !== 1 || !f.e || typeof f.e !== 'object') return;
          // Les plus anciennes d'abord : l'ordre de la Map est l'ordre d'éviction.
          const lues: Array<[string, Ligne]> = Object.entries(f.e)
            .filter(([cle, x]) => !memoire.has(cle) && x && typeof x.a === 'number')
            .map(([cle, x]) => [cle, { v: x.v, a: x.a, appareil: true, persister: true }]);
          // Ordre d'éviction = ancienneté (les écritures faites pendant le chargement comprises).
          const toutes = [...memoire.entries(), ...lues].sort((p, q) => p[1].a - q[1].a);
          memoire.clear();
          for (const [cle, l] of toutes) memoire.set(cle, l);
          borner();
        } catch {
          // Cache illisible (ancienne version, base abîmée) : on repart de zéro, rien n'est perdu.
        }
      })();
    }
    return charge;
  };

  async function ecrireBase(): Promise<void> {
    if (!stockage) return;
    await charger();
    // Les plus récentes d'abord, jusqu'à la limite d'octets.
    const lignes = [...memoire.entries()].filter(([, l]) => l.persister).sort((p, q) => q[1].a - p[1].a);
    const e: Fichier['e'] = {};
    let octets = 20;
    for (const [cle, l] of lignes) {
      let texte: string;
      try {
        texte = JSON.stringify({ v: l.v, a: l.a });
      } catch {
        continue;
      }
      const taille = texte.length + cle.length + 6;
      if (octets + taille > octetsMax) continue;
      octets += taille;
      e[cle] = { v: l.v, a: l.a };
    }
    try {
      await stockage.ecrire(CLES.cache, JSON.stringify({ v: 1, e } satisfies Fichier));
    } catch {
      // Base indisponible (verrouillée, quota) : le cache reste en mémoire.
    }
  }

  const programmer = () => {
    if (!stockage) return;
    if (minuteur) clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      minuteur = undefined;
      ecriture = ecriture.then(ecrireBase, ecrireBase);
    }, delai);
    // Node (tests, Electron) : l'écriture en attente ne retient pas le processus.
    (minuteur as { unref?: () => void }).unref?.();
  };

  return {
    async lire<T>(cle: string) {
      await charger();
      const l = memoire.get(cle);
      if (!l) return undefined;
      // Récemment utilisée : passe en fin d'ordre d'éviction.
      memoire.delete(cle);
      memoire.set(cle, l);
      return { valeur: l.v as T, a: l.a, origine: l.appareil ? 'appareil' : 'memoire' };
    },
    ecrire(cle, valeur, opts = {}) {
      // Visible tout de suite en mémoire (même avant la fin du chargement de la base).
      memoire.delete(cle);
      memoire.set(cle, { v: valeur, a: opts.a ?? maintenant(), persister: opts.persister !== false });
      borner();
      if (opts.persister !== false) void charger().then(programmer);
    },
    toucher(cle) {
      const l = memoire.get(cle);
      if (l?.persister) {
        l.appareil = false;
        programmer();
      }
    },
    supprimer(cle) {
      if (memoire.delete(cle)) programmer();
    },
    supprimerPrefixe(prefixe) {
      let n = 0;
      for (const cle of [...memoire.keys()]) {
        if (cle.startsWith(prefixe)) {
          memoire.delete(cle);
          n += 1;
        }
      }
      if (n) programmer();
    },
    async vider() {
      await charger();
      memoire.clear();
      if (minuteur) clearTimeout(minuteur);
      minuteur = undefined;
      await (ecriture = ecriture.then(ecrireBase, ecrireBase));
    },
    async ecrireMaintenant() {
      if (minuteur) {
        clearTimeout(minuteur);
        minuteur = undefined;
        ecriture = ecriture.then(ecrireBase, ecrireBase);
      }
      await ecriture;
    },
    taille: () => memoire.size,
  };
}

/** Empreinte courte et stable d'un texte (clé de cache : définition des sources). */
export function empreinteTexte(t: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < t.length; i += 1) {
    const c = t.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}${t.length.toString(36)}`;
}
