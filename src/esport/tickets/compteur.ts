/**
 * Compteur des tickets non lus de la navigation (entrée « Tickets ») : relu à chaque changement annoncé par le temps
 * réel (sujet `tickets`, contrôlé par le serveur), et toutes les 2 minutes en secours.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ClientEsport } from '../client';
import { useTempsReel } from '../tempsReel/hooks';
import { apiTickets } from './api';

export function useCompteurTickets(client: ClientEsport | undefined): number {
  const [n, setN] = useState(0);
  const relire = useCallback(() => {
    if (!client) return;
    apiTickets(client)
      .compteur()
      .then(r => setN(r.nonLus))
      .catch(() => undefined);
  }, [client]);
  useEffect(() => {
    if (!client) {
      setN(0);
      return undefined;
    }
    relire();
    const id = setInterval(relire, 120_000);
    return () => clearInterval(id);
  }, [client, relire]);
  useTempsReel(client, 'tickets', relire, { actif: Boolean(client) });
  return n;
}
