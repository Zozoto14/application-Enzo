/**
 * Tickets : la conversation d'un ticket, écrite par la Gateway (temps réel) ou par la relecture REST de secours.
 *
 *  - `ingererMessage()` : un message Discord d'un salon de ticket → `tickets_messages` (sans doublon : la Gateway et
 *    la relecture peuvent voir le même message), activité du ticket, première réponse du staff, retour « ouvert »
 *    d'un ticket « en attente » quand l'auteur répond, pièces jointes ;
 *  - pièces jointes : COPIÉES dans le stockage privé du serveur (`tickets/<ticket>/<pièce>`) si la copie est activée,
 *    seulement depuis le CDN de Discord (cdn.discordapp.com, media.discordapp.net), sans suivre de redirection, sous le
 *    plafond réglé (8 Mo par défaut) ; sinon RÉFÉRENCÉES (adresse d'origine gardée : elle expire chez Discord). Jamais
 *    servies publiquement : lien signé de quelques minutes délivré après contrôle d'accès au ticket ;
 *  - `annoncer()` : « le ticket K a changé » sur le canal temps réel (sujet `tickets`, objet re-contrôlé au nom de
 *    chaque destinataire par la route GET du ticket : aucune fuite entre catégories).
 */

import { iso, jsonOu, nouvelId } from '../outils.mjs';
import { publierEnBase } from '../temps-reel/diffusion.mjs';

const HOTES_CDN = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
const TYPES_MESSAGE = new Set([0, 19, 20]);
export const PIECES_MAX_PAR_MESSAGE = 10;

/** Comparaison de deux identifiants Discord (snowflakes) : plus grand = plus récent. */
export const plusRecent = (a, b) => {
  if (!a) return b ?? null;
  if (!b) return a;
  return BigInt(a) >= BigInt(b) ? a : b;
};

/** Annonce temps réel du ticket (aucune donnée métier : la route GET du ticket est rejouée pour chaque destinataire). */
export async function annoncer(base, ticketId, t, { acteur } = {}) {
  try {
    await publierEnBase(base, { sujet: 'tickets', cle: `ticket:${ticketId}`, sonde: `/tickets/${ticketId}`, action: 'modifie', ...(acteur ? { acteur } : {}) }, t);
  } catch (e) {
    console.error('[esport] tickets : temps réel', e?.message ?? e);
  }
}

/** Nom affiché d'un utilisateur Discord. */
export const nomDiscord = u => String(u?.global_name || u?.username || u?.id || '').slice(0, 100);

/**
 * Copie (ou référence) une pièce jointe Discord. Rend la ligne `tickets_pieces` à insérer.
 * `telecharger(url)` : rend `{ octets, type }` ou null (réseau simulé en test).
 */
export async function preparerPiece({ ticketId, messageId, piece, stockage, reglages, telecharger, t }) {
  const id = nouvelId();
  const nom = String(piece?.filename ?? 'fichier').replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 120) || 'fichier';
  const taille = Number(piece?.size) || 0;
  const type = String(piece?.content_type ?? 'application/octet-stream').split(';')[0].slice(0, 100);
  let url = null;
  try {
    const u = new URL(String(piece?.url ?? ''));
    if (u.protocol === 'https:' && HOTES_CDN.has(u.hostname)) url = u.toString();
  } catch {
    url = null;
  }
  const ligne = { id, ticket_id: ticketId, message_id: messageId, nom, type_mime: type, taille, cle_stockage: null, url_origine: url, statut: 'referencee', cree_le: iso(t) };
  const max = (reglages?.pieceMaxMo ?? 8) * 1024 * 1024;
  if (reglages?.copierPieces && stockage && url && taille > 0 && taille <= max && telecharger) {
    try {
      const r = await telecharger(url, max);
      if (r?.octets && r.octets.length <= max) {
        const cle = `tickets/${ticketId}/${id}`;
        await stockage.deposer(cle, r.octets, { type });
        Object.assign(ligne, { cle_stockage: cle, taille: r.octets.length, statut: 'copiee' });
      }
    } catch (e) {
      console.error('[esport] tickets : pièce jointe non copiée', e?.message ?? e);
    }
  }
  return ligne;
}

/** Téléchargement borné d'une pièce du CDN de Discord (aucune redirection suivie). */
export function telechargeurCdn(fetchDiscord) {
  return async (url, max) => {
    const r = await fetchDiscord(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    if (!r.ok || !r.body) return null;
    const annonce = Number(r.headers.get('Content-Length') ?? 0);
    if (annonce > max) return null;
    const lecteur = r.body.getReader();
    const morceaux = [];
    let total = 0;
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        await lecteur.cancel().catch(() => undefined);
        return null;
      }
      morceaux.push(value);
    }
    const octets = new Uint8Array(total);
    let i = 0;
    for (const m of morceaux) {
      octets.set(m, i);
      i += m.length;
    }
    return { octets, type: r.headers.get('Content-Type') ?? 'application/octet-stream' };
  };
}

export const instructionPiece = p => ({
  sql: 'INSERT INTO tickets_pieces (id, ticket_id, message_id, nom, type_mime, taille, cle_stockage, url_origine, statut, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  params: [p.id, p.ticket_id, p.message_id, p.nom, p.type_mime, p.taille, p.cle_stockage, p.url_origine, p.statut, p.cree_le],
});

/**
 * Le message vient-il du staff ? Rôles Discord de la catégorie (si l'événement les donne), ou compte lié qui voit la
 * catégorie ; à défaut (relecture REST : pas de rôles), toute personne autre que l'auteur et les personnes ajoutées.
 */
async function estStaff(base, ticket, d, estStaffCompte) {
  const auteur = d.author?.id;
  if (auteur === ticket.auteur_discord_id) return false;
  const categorie = await base.premier('SELECT roles_discord FROM tickets_categories WHERE id = ?', [ticket.categorie_id]);
  const roles = jsonOu(categorie?.roles_discord, []);
  if (Array.isArray(d.member?.roles) && d.member.roles.some(r => roles.includes(r))) return true;
  if (estStaffCompte && (await estStaffCompte(auteur, ticket.categorie_id))) return true;
  if (Array.isArray(d.member?.roles)) return false;
  const ajoute = await base.premier('SELECT discord_user_id FROM tickets_membres WHERE ticket_id = ? AND discord_user_id = ?', [ticket.id, auteur]);
  return !ajoute;
}

/**
 * Enregistre un message Discord reçu dans le salon d'un ticket. Rend `{ ticket, message }` s'il est nouveau, sinon
 * null. `ctx` : `{ base, stockage, reglages, telecharger, botId, maintenant, estStaffCompte, surNouveau }`.
 */
export async function ingererMessage(ctx, d) {
  const { base, botId } = ctx;
  if (!d?.channel_id || !d.id || !d.author?.id) return null;
  if (!TYPES_MESSAGE.has(Number(d.type ?? 0))) return null;
  // Les messages du bot sont enregistrés au moment où il les envoie (réponses de l'app, messages du système).
  if (botId && d.author.id === botId) return null;
  if (d.webhook_id) return null;
  const ticket = await base.premier("SELECT * FROM tickets WHERE salon_id = ? AND statut <> 'ferme'", [d.channel_id]);
  if (!ticket) return null;
  const deja = await base.premier('SELECT id FROM tickets_messages WHERE ticket_id = ? AND discord_message_id = ?', [ticket.id, d.id]);
  if (deja) return null;
  const t = ctx.maintenant();
  const staff = await estStaff(base, ticket, d, ctx.estStaffCompte);
  const lie = await base.premier('SELECT compte_id FROM discord_comptes WHERE discord_user_id = ?', [d.author.id]);
  const id = nouvelId();
  const quand = Date.parse(d.timestamp ?? '') || t;
  const insertion = await base.executer(
    `INSERT INTO tickets_messages (id, ticket_id, discord_message_id, genre, auteur_discord_id, auteur_compte_id, auteur_nom, staff, contenu, envoi, cree_le)
     VALUES (?, ?, ?, 'discord', ?, ?, ?, ?, ?, 'ok', ?) ON CONFLICT (ticket_id, discord_message_id) DO NOTHING`,
    [id, ticket.id, d.id, d.author.id, lie?.compte_id ?? null, nomDiscord(d.author), staff ? 1 : 0, String(d.content ?? '').slice(0, 8000), iso(quand)],
  );
  if (Number(insertion.changements) !== 1) return null;
  const pieces = [];
  for (const p of (Array.isArray(d.attachments) ? d.attachments : []).slice(0, PIECES_MAX_PAR_MESSAGE)) {
    pieces.push(await preparerPiece({ ticketId: ticket.id, messageId: id, piece: p, stockage: ctx.stockage, reglages: ctx.reglages, telecharger: ctx.telecharger, t }));
  }
  const auteurRepond = d.author.id === ticket.auteur_discord_id;
  const statut = auteurRepond && ticket.statut === 'en_attente' ? (ticket.responsable_compte_id || ticket.responsable_discord_id ? 'pris_en_charge' : 'ouvert') : ticket.statut;
  await base.lot([
    ...pieces.map(instructionPiece),
    {
      sql: `UPDATE tickets SET derniere_activite_le = ?, maj_le = ?, avertissement_le = NULL, statut = ?,
              premiere_reponse_le = CASE WHEN premiere_reponse_le IS NULL AND ? = 1 THEN ? ELSE premiere_reponse_le END,
              dernier_message_id = ? WHERE id = ?`,
      params: [iso(quand), iso(t), statut, staff ? 1 : 0, iso(quand), plusRecent(ticket.dernier_message_id, d.id), ticket.id],
    },
  ]);
  await annoncer(base, ticket.id, t);
  const message = { id, staff, auteurDiscordId: d.author.id, auteurNom: nomDiscord(d.author), auteurCompte: lie?.compte_id ?? null };
  if (ctx.surNouveau) {
    try {
      await ctx.surNouveau(ticket, message);
    } catch (e) {
      console.error('[esport] tickets : suite d’un message', e?.message ?? e);
    }
  }
  return { ticket, message };
}

/** Message modifié sur Discord : le texte est mis à jour (l'ancien n'est pas gardé). */
export async function modifierMessage(ctx, d) {
  if (!d?.id || typeof d.content !== 'string') return false;
  const l = await ctx.base.premier('SELECT m.id, m.ticket_id FROM tickets_messages m JOIN tickets t ON t.id = m.ticket_id WHERE m.discord_message_id = ? AND t.salon_id = ?', [d.id, d.channel_id ?? '']);
  if (!l) return false;
  const t = ctx.maintenant();
  await ctx.base.executer('UPDATE tickets_messages SET contenu = ?, modifie_le = ? WHERE id = ?', [d.content.slice(0, 8000), iso(t), l.id]);
  await annoncer(ctx.base, l.ticket_id, t);
  return true;
}

/** Message supprimé sur Discord : marqué supprimé (le transcript garde la trace, contenu compris). */
export async function supprimerMessage(ctx, d) {
  if (!d?.id) return false;
  const l = await ctx.base.premier('SELECT m.id, m.ticket_id FROM tickets_messages m JOIN tickets t ON t.id = m.ticket_id WHERE m.discord_message_id = ? AND t.salon_id = ?', [d.id, d.channel_id ?? '']);
  if (!l) return false;
  const t = ctx.maintenant();
  await ctx.base.executer('UPDATE tickets_messages SET supprime_le = ? WHERE id = ? AND supprime_le IS NULL', [iso(t), l.id]);
  await annoncer(ctx.base, l.ticket_id, t);
  return true;
}
