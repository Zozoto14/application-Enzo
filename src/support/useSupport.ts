import { useEffect, useMemo, useState } from 'react';
import { ServiceSupport, type OptionsService } from './service';
import type { Ticket } from './tickets';

/** Période du renvoi automatique des tickets en attente. */
export const PERIODE_RENVOI_MS = 30_000;

/**
 * Service de tickets du profil ouvert, avec renvoi automatique : au montage, toutes les 30 s et
 * dès que le navigateur se dit de nouveau en ligne, tant qu'un ticket est resté en attente.
 */
export function useSupport(options: OptionsService | undefined) {
  const service = useMemo(() => (options ? new ServiceSupport({ ...options, surChangement: t => setTickets(t) }) : undefined), [options?.depot]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tickets, setTickets] = useState<readonly Ticket[]>(() => service?.liste() ?? []);
  useEffect(() => {
    setTickets(service?.liste() ?? []);
  }, [service]);
  useEffect(() => {
    if (!service) return undefined;
    const tenter = () => {
      if (service.enAttente > 0) void service.renvoyerEnAttente();
    };
    tenter();
    const minuterie = setInterval(tenter, PERIODE_RENVOI_MS);
    const fenetre = (globalThis as { addEventListener?(t: string, f: () => void): void; removeEventListener?(t: string, f: () => void): void });
    fenetre.addEventListener?.('online', tenter);
    return () => {
      clearInterval(minuterie);
      fenetre.removeEventListener?.('online', tenter);
    };
  }, [service]);
  return { service, tickets };
}
