/**
 * Bienvenue par rôle (Tickets › Configuration › Bienvenue) : quand un membre du serveur Discord du club reçoit le
 * rôle choisi (ex. « The Nuke End »), Esport HQ le mentionne dans le salon choisi avec un message réglable.
 *
 *  - Événements Gateway GUILD_MEMBER_ADD et GUILD_MEMBER_UPDATE (intent GUILD_MEMBERS, PRIVILÉGIÉ : « Server Members
 *    Intent » à activer sur le portail Discord) : demandé seulement quand la bienvenue est activée ;
 *  - une personne n'est accueillie qu'UNE fois par rôle (table discord_bienvenues) ;
 *  - le message peut s'effacer après quelques secondes (`supprimerApresS`, 10 par défaut ; 0 : gardé) : la personne
 *    reçoit la notification, le salon reste propre. Effacement rejoué par le superviseur si le processus s'arrête ;
 *  - à l'activation (ou au changement de rôle), les titulaires actuels du rôle sont notés sans message ; si Discord
 *    refuse la liste des membres, seules les personnes arrivées sur le serveur après l'activation sont accueillies.
 *
 * Documentation : docs/esport/tickets.md, « Bienvenue par rôle ».
 */

import { echec, iso, jsonOu } from '../outils.mjs';
import { INTENTS_TICKETS } from './gateway.mjs';
import { rest } from './discord.mjs';

/** Intents Discord : GUILDS (1 << 0), GUILD_MEMBERS (1 << 1, PRIVILÉGIÉ). */
export const INTENT_GUILDS = 1 << 0;
export const INTENT_MEMBRES = 1 << 1;

export const MESSAGE_DEFAUT = 'Bienvenue {membre} ! Tu fais maintenant partie de **{role}** 💥';
export const MESSAGE_MAX = 1800;
/** Délai d'effacement du message (secondes) : 0 = gardé ; 1 heure au plus. */
export const SUPPRESSION_MAX_S = 3600;

export const BIENVENUE_DEFAUT = Object.freeze({
  actif: false,
  roleId: null,
  roleNom: '',
  salonId: null,
  message: MESSAGE_DEFAUT,
  supprimerApresS: 10,
  // Posé à l'activation : sert si la liste des titulaires actuels n'a pas pu être lue.
  depuis: null,
  existantsNotes: false,
});

const ID = /^\d{5,25}$/;
const idOuNull = (v, quoi) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !ID.test(v)) throw echec(400, quoi, 'Identifiant Discord invalide (chiffres seulement).');
  return v;
};

export async function lireBienvenue(base) {
  const l = await base.premier("SELECT valeur FROM tickets_reglages WHERE cle = 'bienvenue'", []);
  const v = jsonOu(l?.valeur, null);
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...BIENVENUE_DEFAUT, ...v } : { ...BIENVENUE_DEFAUT };
}

/**
 * Valide les réglages (fusion avec l'existant). Activation, ou rôle changé pendant qu'elle est active : nouveau départ
 * (`depuis`, titulaires actuels à noter) — rendu dans `recommencer`.
 */
export function validerBienvenue(c, actuel, t) {
  const s = { ...actuel };
  if (c.actif !== undefined) s.actif = c.actif === true;
  if (c.roleId !== undefined) s.roleId = idOuNull(c.roleId, 'bienvenue-role');
  if (c.roleNom !== undefined) {
    if (typeof c.roleNom !== 'string') throw echec(400, 'bienvenue-role', 'Texte attendu.');
    s.roleNom = c.roleNom.trim().slice(0, 100);
  }
  if (c.salonId !== undefined) s.salonId = idOuNull(c.salonId, 'bienvenue-salon');
  if (c.message !== undefined) {
    if (typeof c.message !== 'string') throw echec(400, 'bienvenue-message', 'Texte attendu.');
    const m = c.message.replace(/\r\n?/g, '\n').trim();
    if (m.length > MESSAGE_MAX) throw echec(400, 'bienvenue-message', `${MESSAGE_MAX} caractères au plus.`);
    s.message = m || MESSAGE_DEFAUT;
  }
  if (c.supprimerApresS !== undefined) {
    const n = Number(c.supprimerApresS);
    if (!Number.isInteger(n) || n < 0 || n > SUPPRESSION_MAX_S) throw echec(400, 'bienvenue-suppression', 'Délai d’effacement : de 0 à 3600 secondes.');
    s.supprimerApresS = n;
  }
  if (s.actif && !s.roleId) throw echec(400, 'bienvenue-role', 'Choisissez le rôle qui déclenche la bienvenue.');
  if (s.actif && !s.salonId) throw echec(400, 'bienvenue-salon', 'Choisissez le salon où publier la bienvenue.');
  const recommencer = s.actif && (!actuel.actif || s.roleId !== actuel.roleId);
  if (recommencer) {
    s.depuis = iso(t);
    s.existantsNotes = false;
  }
  return { reglages: s, recommencer };
}

/**
 * Intents de la Gateway : ceux des tickets quand ils sont activés (messages des salons), sinon GUILDS seul ; plus
 * GUILD_MEMBERS quand la bienvenue est activée (sauf si Discord l'a refusé : `sansMembres`).
 */
export function intentsVoulus(general, bienvenue, { sansMembres = false } = {}) {
  let i = general?.actif ? INTENTS_TICKETS : INTENT_GUILDS;
  if (bienvenue?.actif && !sansMembres) i |= INTENT_MEMBRES;
  return i;
}

/** Message final : {membre} (mention), {pseudo}, {role}, {serveur}. */
export function texteBienvenue(modele, { membreId, pseudo = '', role = '', serveur = '' }) {
  const v = { membre: membreId ? `<@${membreId}>` : pseudo, pseudo, role, serveur };
  return String(modele || MESSAGE_DEFAUT).replace(/\{(membre|pseudo|role|serveur)\}/g, (_, k) => v[k] ?? '').slice(0, 2000);
}

const nomMembre = d => String(d?.nick || d?.user?.global_name || d?.user?.username || '').slice(0, 100);

/** Note une personne comme accueillie ; rend true si elle ne l'était pas encore. */
async function noter(base, guildId, userId, roleId, issue, t) {
  const r = await base.executer(
    'INSERT INTO discord_bienvenues (guild_id, discord_user_id, role_id, issue, accueilli_le) VALUES (?, ?, ?, ?, ?) ON CONFLICT (guild_id, discord_user_id, role_id) DO NOTHING',
    [guildId, userId, roleId, issue, iso(t)],
  );
  return Number(r.changements) === 1;
}

/**
 * Événement GUILD_MEMBER_ADD / GUILD_MEMBER_UPDATE. `ctx` : `base`, `bienvenue`, `guildId`, `guildNom`, `fetch`,
 * `jetonBot`, `maintenant`, `journal`. Rend `'accueilli'`, `'echec'` ou null (rien à faire).
 */
export async function accueillirMembre(ctx, d) {
  const { base, bienvenue: b, guildId } = ctx;
  if (!b?.actif || !b.roleId || !b.salonId || !d || d.guild_id !== guildId) return null;
  const userId = d.user?.id;
  if (!userId || d.user?.bot || !Array.isArray(d.roles) || !d.roles.includes(b.roleId)) return null;
  // Liste des titulaires actuels non lue à l'activation : seules les arrivées après l'activation comptent.
  if (!b.existantsNotes && b.depuis && d.joined_at && Date.parse(d.joined_at) < Date.parse(b.depuis)) return null;
  const t = ctx.maintenant();
  if (!(await noter(base, guildId, userId, b.roleId, 'message', t))) return null;
  const contenu = texteBienvenue(b.message, { membreId: userId, pseudo: nomMembre(d), role: b.roleNom, serveur: ctx.guildNom ?? '' });
  const r = await rest(ctx.fetch, ctx.jetonBot, 'POST', `/channels/${b.salonId}/messages`, {
    content: contenu,
    // Seule la personne accueillie est notifiée (jamais @everyone ni un rôle écrit dans le message).
    allowed_mentions: { parse: [], users: [userId] },
  });
  await ecrireEtatBienvenue(base, r.ok ? { dernier: { le: iso(t), ok: true } } : { dernier: { le: iso(t), ok: false, statut: r.statut, code: r.code ?? null } }, t);
  if (!r.ok) {
    await base.executer("UPDATE discord_bienvenues SET issue = 'echec' WHERE guild_id = ? AND discord_user_id = ? AND role_id = ?", [guildId, userId, b.roleId]);
    ctx.journal?.error?.('[esport] bienvenue : message refusé par Discord', r.statut, r.code ?? '');
    return 'echec';
  }
  // Effacement programmé : noté en base (rejoué par le superviseur), puis tenté à l'heure dite par ce processus.
  const delai = Number(b.supprimerApresS ?? 0);
  if (delai > 0 && r.corps?.id) {
    await base.executer('UPDATE discord_bienvenues SET message_id = ?, supprimer_le = ? WHERE guild_id = ? AND discord_user_id = ? AND role_id = ?', [String(r.corps.id), iso(t + delai * 1000), guildId, userId, b.roleId]);
    const minuterie = setTimeout(() => {
      effacerBienvenues(ctx).catch(e => ctx.journal?.error?.('[esport] bienvenue : effacement', e?.message ?? e));
    }, delai * 1000 + 50);
    minuterie.unref?.();
  }
  return 'accueilli';
}

/**
 * Efface les messages de bienvenue arrivés à échéance (appelé à l'heure dite et à chaque passage du superviseur).
 * Message déjà effacé (404) : considéré comme fait. Rend le nombre de messages effacés.
 */
export async function effacerBienvenues(ctx, { max = 20 } = {}) {
  const { base } = ctx;
  const t = ctx.maintenant();
  const dus = await base.tous(
    'SELECT guild_id, discord_user_id, role_id, message_id, supprimer_le FROM discord_bienvenues WHERE message_id IS NOT NULL AND supprimer_le <= ? ORDER BY supprimer_le LIMIT ?',
    [iso(t), max],
  );
  let effaces = 0;
  for (const l of dus) {
    const salon = ctx.bienvenue?.salonId;
    if (!salon) break;
    const r = await rest(ctx.fetch, ctx.jetonBot, 'DELETE', `/channels/${salon}/messages/${l.message_id}`);
    if (r.statut === 429) break;
    // Fait (204), déjà effacé (404) ou refusé (403 : droit « Gérer les messages » inutile pour ses propres messages,
    // mais salon devenu invisible) : on n'insiste pas.
    if (r.ok || r.statut === 404 || r.statut === 403) {
      await base.executer('UPDATE discord_bienvenues SET message_id = NULL, supprimer_le = NULL WHERE guild_id = ? AND discord_user_id = ? AND role_id = ?', [l.guild_id, l.discord_user_id, l.role_id]);
      if (r.ok) effaces++;
    }
  }
  return effaces;
}

/**
 * Note sans message les titulaires actuels du rôle (liste des membres : intent GUILD_MEMBERS requis). Rend
 * `{ ok, notes }` ou `{ ok: false, statut, code }`.
 */
export async function noterTitulaires({ base, fetch: fetchDiscord, jetonBot, guildId, roleId, maintenant = () => Date.now() }, { pages = 20 } = {}) {
  const t = maintenant();
  let apres = '0';
  let notes = 0;
  for (let i = 0; i < pages; i++) {
    const r = await rest(fetchDiscord, jetonBot, 'GET', `/guilds/${guildId}/members?limit=1000&after=${apres}`);
    if (!r.ok || !Array.isArray(r.corps)) return { ok: false, statut: r.statut, code: r.code ?? null, notes };
    for (const m of r.corps) {
      if (m?.user?.id && Array.isArray(m.roles) && m.roles.includes(roleId) && (await noter(base, guildId, m.user.id, roleId, 'existant', t))) notes++;
    }
    if (r.corps.length < 1000) return { ok: true, notes };
    apres = r.corps[r.corps.length - 1].user.id;
  }
  return { ok: true, notes };
}

export async function lireEtatBienvenue(base) {
  const l = await base.premier("SELECT valeur, maj_le FROM tickets_etat WHERE cle = 'bienvenue'", []);
  return l ? { ...jsonOu(l.valeur, {}), majLe: l.maj_le } : {};
}

/** Fusionne dans l'état affiché (Tickets › Configuration › Bienvenue) : dernier message, intent refusé… */
export async function ecrireEtatBienvenue(base, morceau, t) {
  const actuel = await lireEtatBienvenue(base);
  delete actuel.majLe;
  await base.executer(
    'INSERT INTO tickets_etat (cle, valeur, maj_le) VALUES (?, ?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le',
    ['bienvenue', JSON.stringify({ ...actuel, ...morceau }), iso(t)],
  );
}
