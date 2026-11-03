/**
 * Pastilles « nouveautés » du Drive (migration 0038, docs/esport/drive.md) : nombre de fichiers, dossiers ou
 * nouvelles versions ajoutés par d'autres depuis la dernière visite de chaque dossier. L'état « vu » est gardé
 * par le serveur, par compte et par dossier (jamais dans le navigateur).
 *
 * `useNouveautesDrive` lit le total (tous les Drive visibles, ou une portée) à l'ouverture, toutes les 2 minutes
 * et au retour sur l'onglet ; `signalerNouveautesDrive()` fait relire toutes les pastilles affichées (après
 * l'ouverture d'un dossier, « Tout marquer comme vu »…).
 */

import { useEffect, useState } from 'react';
import type { ClientEsport } from '../client';
import { apiDrive } from './drive';

const ecouteurs = new Set<() => void>();
const PERIODE_MS = 120_000;

/** Fait relire toutes les pastilles du Drive affichées. */
export function signalerNouveautesDrive(): void {
  for (const f of [...ecouteurs]) f();
}

/** Total des nouveautés (`portee` : un Drive ; sinon tous ceux que le compte voit). 0 sans droit ou hors ligne. */
export function useNouveautesDrive(client: ClientEsport | undefined, portee?: string, actif = true): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!client || !actif) return undefined;
    let vivant = true;
    const api = apiDrive(client);
    const lire = () => {
      void Promise.resolve()
        .then(async (): Promise<{ total: number } | undefined> => (portee ? api.nouveautes(portee) : api.nouveautesGlobales()))
        .then(r => vivant && setN(r?.total ?? 0))
        .catch(() => undefined);
    };
    lire();
    ecouteurs.add(lire);
    const minuterie = setInterval(lire, PERIODE_MS);
    const doc = (globalThis as { document?: { addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void; visibilityState?: string } }).document;
    const visible = () => {
      if (doc?.visibilityState === 'visible') lire();
    };
    doc?.addEventListener?.('visibilitychange', visible);
    return () => {
      vivant = false;
      ecouteurs.delete(lire);
      clearInterval(minuterie);
      doc?.removeEventListener?.('visibilitychange', visible);
    };
  }, [client, portee, actif]);
  return n;
}
