import { useEffect, useMemo, useState } from 'react';
import { ServiceSupport, type OptionsService } from './service';
import type { Ticket } from './tickets';

/** Période du renvoi automatique des demandes en attente. */
export const PERIODE_RENVOI_MS = 30_000;
/** Période de la relecture des réponses du support (notification). */
export const PERIODE_REPONSES_MS = 120_000;

/**
 * Service de demandes du profil ouvert : renvoi automatique (au montage, toutes les 30 s et dès que
 * le navigateur se dit de nouveau en ligne, tant qu'une demande est restée en attente) et relecture
 * des réponses du Fondateur (au montage puis toutes les 2 minutes) : `nonLus` alimente le badge.
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
    const relire = () => void service.synchroniser().catch(() => 0);
    tenter();
    relire();
    const minuterie = setInterval(tenter, PERIODE_RENVOI_MS);
    const reponses = setInterval(relire, PERIODE_REPONSES_MS);
    const fenetre = (globalThis as { addEventListener?(t: string, f: () => void): void; removeEventListener?(t: string, f: () => void): void });
    fenetre.addEventListener?.('online', tenter);
    return () => {
      clearInterval(minuterie);
      clearInterval(reponses);
      fenetre.removeEventListener?.('online', tenter);
    };
  }, [service]);
  const nonLus = tickets.reduce((n, t) => n + (t.nonLus ?? 0), 0);
  return { service, tickets, nonLus };
}
