/**
 * Site de secours : la même interface, dans Safari, sans Electron.
 *
 * Deux choses manquent à un navigateur ordinaire, et le relais Cloudflare
 * les fournit :
 *
 *  - joindre Yahoo Finance et les médias, ce que le navigateur interdit
 *    d'une origine à l'autre. Les mêmes fonctions que le pont d'Electron
 *    (`yahoo`, `medias`) sont posées ici, et passent par le relais ;
 *  - lire les pages des SOURCES de Tsuzuku (`tsuzukuRelais`) : route
 *    `/tsuzuku/requete` du relais, réservée au jeton maître (compte Fondateur
 *    relié). Le jeton est celui de la liaison déjà en place : aucun nouveau
 *    secret. Clé distincte du pont du PC (`tsuzuku`) : le site n'est jamais
 *    pris pour l'app PC ;
 *  - savoir quel relais utiliser : la liaison retenue par ce navigateur à la
 *    connexion (identifiant + mot de passe : jeton de session du Fondateur, ou
 *    jeton de profil d'un ami). Plus de code de liaison dans l'adresse (relais
 *    version 9) : un ancien lien `#liaison=AB1.…` n'est plus lu.
 *
 * Les données restent dans le navigateur (IndexedDB), chiffrées comme sur le
 * PC, et arrivent par la synchronisation.
 */

import { decoderLiaison, type Liaison } from '../src/sync/relais/liaison';
import { relaisActif } from '../src/sync/relais/actif';
import { estMaitre } from '../src/sync/relais/portees';
import type { DemandeRelais, TransportRelais } from '../src/tsuzuku/plateforme/reseauRelais';

const CLE_LIAISON = 'applibourse.liaison';

function lireStockage(cle: string): string | undefined {
  try {
    return globalThis.localStorage?.getItem(cle) ?? undefined;
  } catch {
    return undefined;
  }
}

function ecrireStockage(cle: string, valeur: string): void {
  try {
    globalThis.localStorage?.setItem(cle, valeur);
  } catch {
    // Navigation privée : le code reste dans l'adresse, c'est suffisant.
  }
}

/** Liaison retenue par ce navigateur à la connexion (jamais lue dans l'adresse). */
export function liaisonDuSite(): Liaison | undefined {
  const garde = lireStockage(CLE_LIAISON);
  return garde ? decoderLiaison(garde) : undefined;
}

/** Oublie la liaison retenue (déconnexion). */
export function oublierLiaisonDuSite(): void {
  ecrireStockage(CLE_LIAISON, '');
}

async function viaRelais(chemin: string, corps: unknown): Promise<Response> {
  const relais = relaisActif() ?? liaisonDuSite();
  if (!relais) {
    throw new Error('Reliez d’abord ce site au relais : Paramètres › Synchronisation.');
  }
  const reponse = await fetch(`${relais.relais}${chemin}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${relais.jeton}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  });
  if (!reponse.ok) {
    let motif = `Le relais a répondu ${reponse.status}.`;
    try {
      motif = ((await reponse.json()) as { erreur?: string }).erreur ?? motif;
    } catch {
      // Réponse sans corps JSON : le statut suffit.
    }
    throw new Error(motif);
  }
  return reponse;
}

/** Relais de la lecture des sources : celui du compte ouvert, et seulement avec le jeton maître. */
function relaisFondateur() {
  const relais = relaisActif() ?? liaisonDuSite();
  return relais && estMaitre(relais) ? relais : undefined;
}

/** Transport de Tsuzuku vers `POST /tsuzuku/requete` (un saut ; le moteur suit et revérifie les redirections). */
export function transportTsuzuku(fetchFn: typeof fetch = (...a) => globalThis.fetch(...a)): TransportRelais {
  return {
    disponible: () => Boolean(relaisFondateur()),
    async envoyer(demande: DemandeRelais, delaiMs: number) {
      const relais = relaisFondateur();
      if (!relais) {
        return { statut: 403, json: { erreur: 'Site non relié avec le jeton du Fondateur.', code: 'interdit' } };
      }
      const controleur = new AbortController();
      const minuteur = setTimeout(() => controleur.abort(), Math.min(60_000, Math.max(1000, delaiMs) + 3000));
      try {
        const reponse = await fetchFn(`${relais.relais}/tsuzuku/requete`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${relais.jeton}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(demande),
          credentials: 'omit',
          cache: 'no-store',
          signal: controleur.signal,
        });
        let json: unknown = null;
        try {
          json = await reponse.json();
        } catch {
          // Pas de JSON (ancienne version du relais, page d'erreur) : le statut suffit.
        }
        return { statut: reponse.status, json };
      } finally {
        clearTimeout(minuteur);
      }
    },
  };
}

export function installerPontWeb(): void {
  const global = globalThis as { applibourse?: Record<string, unknown>; fetch: typeof fetch };
  if (global.applibourse) {
    return; // Electron : le vrai pont est déjà là.
  }
  global.applibourse = {
    yahoo: {
      json: async (url: string) => (await viaRelais('/yahoo/json', { url })).json(),
      screener: async (corps: unknown) => (await viaRelais('/yahoo/screener', { corps })).json(),
    },
    medias: {
      flux: async (url: string) => (await viaRelais('/medias/flux', { url })).text(),
      page: async (url: string) => (await viaRelais('/medias/page', { url })).text(),
    },
    relais: {
      config: async () => liaisonDuSite(),
    },
    tsuzukuRelais: transportTsuzuku(),
  };

  // Les cours passent par `fetch` directement : même détour pour Yahoo.
  const natif = global.fetch.bind(globalThis);
  global.fetch = async (entree, init) => {
    const url = typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url;
    if (!/^https:\/\/query[12]\.finance\.yahoo\.com\//.test(url) || !(relaisActif() ?? liaisonDuSite())) {
      return natif(entree, init);
    }
    try {
      const json = await (await viaRelais('/yahoo/json', { url })).json();
      return new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (erreur) {
      return new Response(erreur instanceof Error ? erreur.message : String(erreur), { status: 502 });
    }
  };
}
