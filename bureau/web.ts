/**
 * Site de secours : la même interface, dans Safari, sans Electron.
 *
 * Deux choses manquent à un navigateur ordinaire, et le relais Cloudflare
 * les fournit :
 *
 *  - joindre Yahoo Finance et les médias, ce que le navigateur interdit
 *    d'une origine à l'autre. Les mêmes fonctions que le pont d'Electron
 *    (`yahoo`, `medias`) sont posées ici, et passent par le relais ;
 *  - savoir quel relais utiliser. Le QR code affiché par le PC ouvre le site
 *    avec `#liaison=AB1.…` : le code est gardé, et Paramètres ›
 *    Synchronisation le propose sans rien recopier.
 *
 * Les données restent dans le navigateur (IndexedDB), chiffrées comme sur le
 * PC, et arrivent par la synchronisation.
 */

import { decoderLiaison, type Liaison } from '../src/sync/relais/liaison';
import { relaisActif } from '../src/sync/relais/actif';

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

/** Liaison apportée par le lien scanné, ou gardée d'une visite précédente. */
export function liaisonDuSite(adresse: string = globalThis.location?.href ?? ''): Liaison | undefined {
  const depuisLien = decoderLiaison(adresse);
  if (depuisLien) {
    ecrireStockage(CLE_LIAISON, adresse.slice(adresse.indexOf('AB1.')));
    return depuisLien;
  }
  const garde = lireStockage(CLE_LIAISON);
  return garde ? decoderLiaison(garde) : undefined;
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
