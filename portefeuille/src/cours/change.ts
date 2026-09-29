/**
 * Conversion en euros des cours cotés dans une autre devise.
 *
 * NVIDIA cotée à Varsovie s'affiche 865 PLN : illisible pour qui compte en
 * euros. On affiche donc l'équivalent en euros, au taux du jour, et la
 * devise d'origine en petit à côté — l'ordre passé chez le courtier, lui,
 * reste dans la devise de cotation.
 *
 * Les taux viennent de Yahoo Finance (paires « PLNEUR=X ») et sont gardés
 * une heure. Tant qu'un taux n'est pas connu, le montant reste dans sa
 * devise : jamais de conversion inventée.
 */

import { useSyncExternalStore } from 'react';

type Recuperer = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const DUREE_MS = 60 * 60 * 1000;

/** Devises cotées en centièmes : GBp (pence), ZAc, ILA… ramenées à l'unité. */
const CENTIEMES: Record<string, string> = { GBp: 'GBP', GBX: 'GBP', ZAc: 'ZAR', ILA: 'ILS' };

export function normaliserDevise(devise: string): { devise: string; facteur: number } {
  const unite = CENTIEMES[devise];
  return unite ? { devise: unite, facteur: 0.01 } : { devise: devise.toUpperCase(), facteur: 1 };
}

export function urlTaux(devise: string): string {
  return `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(`${devise}EUR=X`)}?range=5d&interval=1d`;
}

/** Dernier taux d'une réponse « chart » de Yahoo. */
export function lireTaux(json: unknown): number | undefined {
  const resultat = (json as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: unknown } }> } })?.chart?.result?.[0];
  const taux = resultat?.meta?.regularMarketPrice;
  return typeof taux === 'number' && Number.isFinite(taux) && taux > 0 ? taux : undefined;
}

export function creerConvertisseur(recuperer: Recuperer | undefined, horloge: () => number = () => Date.now()) {
  const taux = new Map<string, { valeur: number; quand: number }>();
  const enCours = new Set<string>();
  const abonnes = new Set<() => void>();
  let version = 0;

  const charger = (devise: string) => {
    if (!recuperer || enCours.has(devise)) return;
    enCours.add(devise);
    recuperer(urlTaux(devise))
      .then(reponse => (reponse.ok ? reponse.json() : undefined))
      .then(json => {
        const valeur = lireTaux(json);
        if (valeur) {
          taux.set(devise, { valeur, quand: horloge() });
          version += 1;
          abonnes.forEach(rappel => rappel());
        }
      })
      .catch(() => undefined)
      .finally(() => enCours.delete(devise));
  };

  return {
    /** Montant en euros, ou `undefined` tant que le taux n'est pas connu. */
    enEuros(montant: number, devise: string | undefined): number | undefined {
      if (!devise) return undefined;
      const { devise: unite, facteur } = normaliserDevise(devise);
      if (unite === 'EUR') return montant * facteur;
      const connu = taux.get(unite);
      if (!connu || horloge() - connu.quand > DUREE_MS) charger(unite);
      return connu ? montant * facteur * connu.valeur : undefined;
    },
    abonner(rappel: () => void) {
      abonnes.add(rappel);
      return () => abonnes.delete(rappel);
    },
    version: () => version,
  };
}

export type Convertisseur = ReturnType<typeof creerConvertisseur>;

let partage: Convertisseur = creerConvertisseur(undefined);

/** Branche le téléchargement des taux (l'application de bureau le fait au démarrage). */
export function installerConvertisseur(recuperer: Recuperer | undefined): void {
  partage = creerConvertisseur(recuperer);
}

export function convertisseur(): Convertisseur {
  return partage;
}

/** Re-rend le composant quand un nouveau taux arrive. */
export function useEnEuros(): Convertisseur['enEuros'] {
  const courant = partage;
  useSyncExternalStore(courant.abonner, courant.version, courant.version);
  return courant.enEuros;
}

