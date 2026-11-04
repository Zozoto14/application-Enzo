/**
 * Tickets : interactions Discord (boutons des panneaux, menus, fenêtres, commandes /ticket et /tickets), branchées
 * dans le bot existant (discord/bot/interactions.mjs : même adresse, même signature vérifiée). Une interaction des
 * tickets ne demande PAS de compte lié : tout membre du serveur du club peut ouvrir un ticket.
 *
 * `interaction(i)` rend la réponse à donner à Discord, ou `undefined` si l'interaction n'est pas pour les tickets.
 */

import { lireGeneral } from './reglages.mjs';
import { t } from './textes.mjs';

const EPHEMERE = 64;
export const estInteractionTickets = i => {
  const id = String(i?.data?.custom_id ?? '');
  return id.startsWith('tk:') || ((i?.type === 2 || i?.type === 4) && ['ticket', 'tickets'].includes(i?.data?.name));
};

const langueInteraction = i => (/^fr([-_]|$)/i.test(String(i?.locale ?? '')) ? 'fr' : 'en');
const avis = (texte, langue) => ({ type: 4, data: { content: texte, flags: EPHEMERE, allowed_mentions: { parse: [] } } });

/** Version de transition : les tickets se configurent ; l'ouverture arrive à l'étape suivante. */
export function creerBotTickets({ base }) {
  async function interaction(i) {
    if (!estInteractionTickets(i)) return undefined;
    const langue = langueInteraction(i);
    if (i.type === 4) return { type: 8, data: { choices: [] } };
    const general = await lireGeneral(base);
    if (!general.actif || !general.guildId) return avis(t(langue, 'non_configure'), langue);
    if (i.guild_id && i.guild_id !== general.guildId) return avis(t(langue, 'autre_serveur'), langue);
    return avis(t(langue, 'bientot'), langue);
  }
  return { interaction };
}
