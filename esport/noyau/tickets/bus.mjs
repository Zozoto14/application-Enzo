/**
 * Tickets : événements du bus (journal, notifications, temps réel) et leur abonné. Les événements des tickets sont
 * SANS team ; leurs charges ne portent que des identifiants, le numéro et la catégorie (jamais le contenu d'un
 * message, d'un formulaire ou d'une note). Les messages eux-mêmes ne passent pas par le bus (conversation.mjs).
 *
 * Le fil du centre de notifications ne les montre à personne (règle « aucun » : l'accès dépend de la catégorie du
 * ticket, que le fil ne sait pas exprimer) ; seules les notifications PERSONNELLES `tk-*` partent, à ceux qui voient
 * la catégorie, avec la catégorie notée (`ticket_categorie_id`) : relue à chaque lecture du centre (droits.mjs).
 *
 * Ce fichier n'importe pas evenements.mjs (c'est lui qui nous importe).
 */

import { jsonOu } from '../outils.mjs';
import { comptesDeCategorie } from './acces.mjs';

export const TYPES_TICKETS = [
  'tickets.config_modifiee',
  'tickets.categorie_creee',
  'tickets.categorie_modifiee',
  'tickets.categorie_supprimee',
  'tickets.panneau_publie',
  'tickets.liste_noire',
  'tickets.rgpd',
  'ticket.ouvert',
  'ticket.pris',
  'ticket.libere',
  'ticket.assigne',
  'ticket.priorite',
  'ticket.categorie',
  'ticket.statut',
  'ticket.membre',
  'ticket.renomme',
  'ticket.ferme',
  'ticket.rouvert',
  'ticket.note',
  'ticket.liaison',
  'ticket.permanent',
  'ticket.supprime',
  'ticket.corbeille',
  'ticket.restaure',
  'ticket.purge',
  'ticket.mention',
];

/** Notifications personnelles des tickets (catégorie « tickets » du centre). */
export const NOTIFICATIONS_TICKETS = ['tk-nouveau', 'tk-assigne', 'tk-message', 'tk-note', 'tk-ferme'];

async function notifier(base, ev, compte, type, charge, categorieId) {
  await base.executer(
    'INSERT INTO notifications (id, compte_id, team_id, type, charge, cree_le, categorie, evenement_id, ticket_categorie_id) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    [`${ev.id}:${compte}`, compte, type, JSON.stringify(charge), ev.cree_le, 'tickets', ev.id, categorieId],
  );
}

/** Abonné du bus : notifications personnelles (préférences de chaque compte : `tickets_preferences`). */
export async function abonneTickets(base, ev) {
  if (!ev.type.startsWith('ticket.')) return;
  const charge = jsonOu(ev.charge, {});
  const categorie = charge.categorie ?? null;
  if (!categorie) return;
  const voient = await comptesDeCategorie(base, categorie);
  const donnees = { numero: charge.numero ?? null, ticket: ev.entite_id, categorie, nom: charge.nomCategorie ?? null };
  const envoyer = async (comptes, type, extra = {}) => {
    for (const c of new Set(comptes)) if (c && c !== ev.acteur_id && voient.has(c)) await notifier(base, ev, c, type, { ...donnees, ...extra }, categorie);
  };
  switch (ev.type) {
    case 'ticket.ouvert':
      return envoyer(await comptesDeCategorie(base, categorie, { repondre: true }), 'tk-nouveau', { auteur: charge.auteur ?? null });
    case 'ticket.assigne':
      return envoyer([charge.compte], 'tk-assigne');
    case 'ticket.note':
      return envoyer([charge.responsable], 'tk-note', { note: charge.note ?? null });
    default:
  }
}
