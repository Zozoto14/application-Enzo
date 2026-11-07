/**
 * Tickets : RGPD.
 *
 *  - Compte de l'app (« Mes données », export et suppression par le Fondateur) : les tickets qu'il a ouverts (par son
 *    compte Discord lié ou le Discord ID saisi par le Fondateur) avec leur conversation SANS les notes internes, et
 *    les messages qu'il a écrits (réponses, notes internes) ailleurs. Suppression : ses tickets sont anonymisés (nom,
 *    réponses du formulaire, ses messages et leurs pièces effacés) ; ce qu'il a écrit pour le club reste, sans auteur.
 *  - Personne sans compte (seulement un compte Discord) : même chose par Discord ID, pour le Fondateur
 *    (`POST /tickets/rgpd/(export|effacer) { discordId }`).
 * Les octets des pièces effacées sont supprimés du stockage par le cron (`piecesEffacees`, cycle.mjs).
 * Les avis gardés d'un ticket supprimé (`tickets_avis_anonymes`, migration 0056) ne sont plus reliés à personne : rien à
 * exporter ni à effacer pour l'auteur ; le responsable d'un compte supprimé y est oublié.
 */

import { echec, iso, jsonOu } from '../outils.mjs';

/** Identifiants Discord d'un compte : liaison /lier, et Discord ID saisi par le Fondateur. */
export async function discordIdsDe(base, compte) {
  const a = await base.tous('SELECT discord_user_id FROM discord_comptes WHERE compte_id = ?', [compte]);
  const b = await base.premier('SELECT discord_id FROM comptes WHERE id = ?', [compte]);
  return [...new Set([...a.map(l => l.discord_user_id), b?.discord_id].filter(Boolean))];
}

/** Données des tickets d'une personne (Discord ID) et, si `compte`, ce que ce compte a écrit. */
export async function exportParDiscord(base, discordIds, compte = null) {
  const tickets = discordIds.length ? await base.tous(`SELECT t.*, c.nom_fr AS categorie FROM tickets t LEFT JOIN tickets_categories c ON c.id = t.categorie_id WHERE t.auteur_discord_id IN (${discordIds.map(() => '?').join(', ')}) ORDER BY t.numero`, discordIds) : [];
  const sortie = [];
  for (const t of tickets) {
    const messages = await base.tous("SELECT genre, auteur_nom, contenu, cree_le FROM tickets_messages WHERE ticket_id = ? AND genre <> 'note' AND supprime_le IS NULL ORDER BY cree_le", [t.id]);
    sortie.push({
      numero: Number(t.numero),
      categorie: t.categorie,
      statut: t.statut,
      ouvertLe: t.ouvert_le,
      fermeLe: t.ferme_le,
      note: t.note === null ? null : Number(t.note),
      commentaire: t.note_commentaire,
      reponses: jsonOu(t.reponses, []).map(r => ({ question: r.libelle?.fr ?? r.id, reponse: r.valeur })),
      conversation: messages.map(m => ({ auteur: m.auteur_nom, genre: m.genre, texte: m.contenu, le: m.cree_le })),
    });
  }
  const ecrits = compte
    ? await base.tous('SELECT t.numero, m.genre, m.contenu, m.cree_le FROM tickets_messages m JOIN tickets t ON t.id = m.ticket_id WHERE m.auteur_compte_id = ? ORDER BY m.cree_le LIMIT 5000', [compte])
    : [];
  return { ticketsOuverts: sortie, ticketsMessagesEcrits: ecrits.map(m => ({ ticket: Number(m.numero), genre: m.genre, texte: m.contenu, le: m.cree_le })) };
}

export async function exportTickets(base, compte) {
  return exportParDiscord(base, await discordIdsDe(base, compte), compte);
}

/** Instructions d'anonymisation des tickets ouverts par ces Discord ID (et de ce que le compte a écrit). */
export function effacementParDiscord(discordIds, compte = null, t = Date.now()) {
  const lot = [];
  if (discordIds.length) {
    lot.push(
      { sql: `UPDATE tickets_messages SET contenu = '', supprime_le = COALESCE(supprime_le, ?) WHERE auteur_discord_id IN (${discordIds.map(() => '?').join(', ')}) AND genre = 'discord'`, params: [iso(t), ...discordIds] },
      { sql: `UPDATE tickets SET auteur_nom = '', auteur_compte_id = NULL, reponses = '[]', note_commentaire = NULL WHERE auteur_discord_id IN (${discordIds.map(() => '?').join(', ')})`, params: discordIds },
      { sql: `DELETE FROM tickets_membres WHERE discord_user_id IN (${discordIds.map(() => '?').join(', ')})`, params: discordIds },
      { sql: `DELETE FROM tickets_liste_noire WHERE discord_user_id IN (${discordIds.map(() => '?').join(', ')})`, params: discordIds },
      { sql: `DELETE FROM discord_bienvenues WHERE discord_user_id IN (${discordIds.map(() => '?').join(', ')})`, params: discordIds },
      // Salons vocaux temporaires : le nom affiché du propriétaire (le salon, éphémère, disparaît une fois vide).
      { sql: `UPDATE vocaux_salons SET proprietaire_nom = '' WHERE proprietaire_id IN (${discordIds.map(() => '?').join(', ')})`, params: discordIds },
    );
  }
  if (compte) {
    lot.push(
      { sql: 'UPDATE tickets_messages SET auteur_compte_id = NULL WHERE auteur_compte_id = ?', params: [compte] },
      { sql: 'UPDATE tickets SET responsable_compte_id = NULL WHERE responsable_compte_id = ?', params: [compte] },
      { sql: 'UPDATE tickets_avis_anonymes SET responsable_compte_id = NULL WHERE responsable_compte_id = ?', params: [compte] },
      { sql: 'UPDATE tickets SET auteur_compte_id = NULL WHERE auteur_compte_id = ?', params: [compte] },
      { sql: 'DELETE FROM tickets_lectures WHERE compte_id = ?', params: [compte] },
      { sql: 'UPDATE tickets_liste_noire SET ajoute_par = NULL WHERE ajoute_par = ?', params: [compte] },
      { sql: 'UPDATE tickets_panneaux SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
      { sql: 'UPDATE tickets_reglages SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    );
  }
  return lot;
}

/** Suppression d'un compte (à mettre dans le lot de la suppression ; Discord ID lus AVANT l'effacement de la liaison). */
export async function effacementTickets(base, compte, t = Date.now()) {
  return effacementParDiscord(await discordIdsDe(base, compte), compte, t);
}

/**
 * RGPD par Discord ID (personne sans compte de l'app) : le Fondateur seul. 404 sans accès aux tickets, 403 pour tout
 * autre compte qui les voit.
 */
export function servicesRgpdTickets({ base, maintenant = () => Date.now(), contexteTickets, evenement }) {
  async function verifier(acteur, corps) {
    await contexteTickets(base, acteur);
    if (!acteur.superAdmin) throw echec(403, 'super-admin', 'Réservé au Fondateur.');
    const id = String(corps?.discordId ?? '');
    if (!/^\d{5,25}$/.test(id)) throw echec(400, 'discord-id', 'Identifiant Discord obligatoire.');
    return id;
  }
  return {
    async exporter(acteur, corps) {
      return exportParDiscord(base, [await verifier(acteur, corps)]);
    },
    async effacer(acteur, corps) {
      const id = await verifier(acteur, corps);
      const t = maintenant();
      await base.lot([...effacementParDiscord([id], null, t), evenement('tickets.rgpd', { acteur: acteur.compte, entiteType: 'tickets', entiteId: null, charge: {}, maintenant: t })]);
      return { ok: true };
    },
  };
}
