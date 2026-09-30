/**
 * Envoi d'un ticket au relais (`POST /support`). L'adresse du webhook Discord
 * n'est JAMAIS connue d'ici : seul le relais la détient (secret du Worker).
 */

import { corpsDuTicket, type Ticket } from './tickets';

export interface LiaisonSupport {
  relais: string;
  jeton: string;
}

export type ResultatEnvoi =
  | { ok: true }
  /** `reessayer` : panne passagère (hors ligne, relais ou Discord indisponible) : renvoi automatique possible. */
  | { ok: false; motif: string; reessayer: boolean };

export async function envoyerTicket(liaison: LiaisonSupport | undefined, ticket: Ticket, requete: typeof fetch = fetch): Promise<ResultatEnvoi> {
  if (!liaison) {
    return { ok: false, motif: 'Relais non relié : le ticket part dès que cet appareil sera relié (Paramètres › Synchronisation).', reessayer: true };
  }
  let reponse: Response;
  try {
    reponse = await requete(`${liaison.relais}/support`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${liaison.jeton}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpsDuTicket(ticket)),
    });
  } catch {
    return { ok: false, motif: 'Pas de connexion : le ticket sera renvoyé automatiquement.', reessayer: true };
  }
  if (reponse.ok) {
    return { ok: true };
  }
  let motif = `Le relais a répondu ${reponse.status}.`;
  try {
    const corps = (await reponse.json()) as { erreur?: unknown };
    if (typeof corps.erreur === 'string') motif = corps.erreur.slice(0, 200);
  } catch {
    // Réponse sans corps JSON : le statut suffit.
  }
  if (reponse.status === 404) {
    motif = 'Ce relais ne connaît pas encore le support : redéployez-le (npm run relais:deployer).';
  }
  // 5xx (sauf 503 : support non configuré) : panne passagère, on retentera ; 4xx (ticket refusé, limite de débit, jeton) : à corriger ou à attendre.
  return { ok: false, motif, reessayer: reponse.status >= 500 && reponse.status !== 503 };
}
