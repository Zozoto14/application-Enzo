/**
 * Échanges avec le relais pour le support (`/support…`). L'adresse du webhook Discord n'est JAMAIS
 * connue d'ici : seul le relais la détient (secret du serveur).
 */

import { corpsDuTicket, type Ticket, type VueServeur } from './tickets';

export interface LiaisonSupport {
  relais: string;
  jeton: string;
}

export type ResultatEnvoi =
  | { ok: true; vue?: VueServeur; avertissement?: string }
  /** `reessayer` : panne passagère (hors ligne, relais indisponible) : renvoi automatique possible. */
  | { ok: false; motif: string; reessayer: boolean };

type Requete = typeof fetch;

const url = (l: LiaisonSupport, chemin: string) => `${l.relais.replace(/\/+$/, '')}${chemin}`;
const entetes = (l: LiaisonSupport) => ({ Authorization: `Bearer ${l.jeton}`, 'Content-Type': 'application/json' });

async function motifDe(reponse: Response): Promise<string> {
  let motif = `Le relais a répondu ${reponse.status}.`;
  try {
    const corps = (await reponse.json()) as { erreur?: unknown };
    if (typeof corps.erreur === 'string') motif = corps.erreur.slice(0, 200);
  } catch {
    // Réponse sans corps JSON : le statut suffit.
  }
  if (reponse.status === 404) motif = 'Ce relais ne connaît pas encore le support : il doit être mis à jour.';
  return motif;
}

export async function envoyerTicket(liaison: LiaisonSupport | undefined, ticket: Ticket, requete: Requete = fetch, auteur?: string): Promise<ResultatEnvoi> {
  if (!liaison) {
    return { ok: false, motif: 'Relais non relié : la demande part dès que cet appareil sera relié (Paramètres › Synchronisation).', reessayer: true };
  }
  let reponse: Response;
  try {
    reponse = await requete(url(liaison, '/support'), { method: 'POST', headers: entetes(liaison), body: JSON.stringify(corpsDuTicket(ticket, auteur)) });
  } catch {
    return { ok: false, motif: 'Pas de connexion : la demande sera renvoyée automatiquement.', reessayer: true };
  }
  if (reponse.ok) {
    try {
      const lu = (await reponse.json()) as { ticket?: VueServeur; avertissement?: string };
      return { ok: true, ...(lu?.ticket ? { vue: lu.ticket } : {}), ...(typeof lu?.avertissement === 'string' ? { avertissement: lu.avertissement } : {}) };
    } catch {
      return { ok: true };
    }
  }
  const motif = await motifDe(reponse);
  // 5xx : panne passagère, on retentera ; 4xx (demande refusée, limite de débit, jeton) : à corriger ou à attendre.
  return { ok: false, motif, reessayer: reponse.status >= 500 && reponse.status !== 503 };
}

/** Mes demandes connues du relais (le Fondateur : `tous` pour toutes). `undefined` : relais injoignable. */
export async function listerTickets(liaison: LiaisonSupport | undefined, requete: Requete = fetch, tous = false): Promise<{ tickets: VueServeur[]; discord?: string; mode?: string | null } | undefined> {
  if (!liaison) return undefined;
  try {
    const r = await requete(url(liaison, `/support/tickets${tous ? '?tous=1' : ''}`), { headers: entetes(liaison) });
    if (!r.ok) return undefined;
    const lu = (await r.json()) as { tickets?: VueServeur[]; discord?: string; mode?: string | null };
    return Array.isArray(lu?.tickets) ? { tickets: lu.tickets, ...(lu.discord ? { discord: lu.discord } : {}), ...(lu.mode !== undefined ? { mode: lu.mode } : {}) } : undefined;
  } catch {
    return undefined;
  }
}

export type ResultatAction = { ok: true; vue: VueServeur; discord?: boolean; courriel?: { ok: boolean; erreur?: string } } | { ok: false; motif: string };

/** Action sur une demande : `messages` (répondre / compléter), `lu`, `statut`, `discord` (renvoi). */
export async function agirSurTicket(liaison: LiaisonSupport | undefined, id: string, action: 'messages' | 'lu' | 'statut' | 'discord', corps: unknown = {}, requete: Requete = fetch): Promise<ResultatAction> {
  if (!liaison) return { ok: false, motif: 'Relais non relié.' };
  let r: Response;
  try {
    r = await requete(url(liaison, `/support/tickets/${encodeURIComponent(id)}/${action}`), { method: 'POST', headers: entetes(liaison), body: JSON.stringify(corps) });
  } catch {
    return { ok: false, motif: 'Pas de connexion.' };
  }
  let lu: { ticket?: VueServeur; erreur?: string; discord?: boolean; courriel?: { ok: boolean; erreur?: string } } | undefined;
  try {
    lu = await r.json();
  } catch {
    lu = undefined;
  }
  if (lu?.ticket && (r.ok || action === 'discord')) {
    return { ok: true, vue: lu.ticket, ...(lu.discord !== undefined ? { discord: lu.discord } : {}), ...(lu.courriel ? { courriel: lu.courriel } : {}) };
  }
  return { ok: false, motif: typeof lu?.erreur === 'string' ? lu.erreur : `Le relais a répondu ${r.status}.` };
}

/** Diagnostic du support (Fondateur) : webhook présent ? mode du salon ? dernier envoi ? */
export async function etatSupport(liaison: LiaisonSupport | undefined, requete: Requete = fetch): Promise<{ webhook: string; mode: string | null; bot: boolean; dernierEnvoi: { date: string; ok: boolean; statut: number | null; code: number | null } | null; courriel: boolean } | undefined> {
  if (!liaison) return undefined;
  try {
    const r = await requete(url(liaison, '/support/etat'), { headers: entetes(liaison) });
    return r.ok ? await r.json() : undefined;
  } catch {
    return undefined;
  }
}
