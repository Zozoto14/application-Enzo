/**
 * Rôles Discord temporaires : octroi, prolongation, retrait et échéance (docs/esport/bot-discord.md, « Rôles
 * temporaires »). Partagé par la commande /role-temp (bot.mjs), l'app (service.mjs) et l'échéance (cron toutes les
 * 5 minutes + processus qui tient la connexion en direct : `expirerRolesTemp`).
 *
 * Discord : PUT / DELETE /guilds/{serveur}/members/{personne}/roles/{rôle} (raison dans le journal d'audit). Erreurs
 * traduites en refus clairs (`RefusRoleTemp`) : personne absente (10007), rôle disparu (10011), limite de débit,
 * hiérarchie des rôles (le rôle du bot doit être AU-DESSUS du rôle temporaire), permission « Gérer les rôles ».
 *
 * Un seul octroi ACTIF par team et par personne : redonner le rôle prolonge (la fin est la plus tardive entre
 * l'échéance actuelle et maintenant + la durée demandée), sans jamais raccourcir.
 */

import { echec, iso, nouvelId } from '../outils.mjs';
import { evenement } from '../evenements.mjs';
import { bilingue, sur } from '../tickets/textes.mjs';
import { P, idDiscord, permissionsMembre, rest } from '../tickets/discord.mjs';
import { lireGeneral } from '../tickets/reglages.mjs';
import { guildDeEquipe, LIMITES_ROLES_TEMP, lireReglagesEquipe } from './reglages.mjs';
import { dureeTexte, horodatage, tr } from './textes.mjs';

const H = 3_600_000;
const MIN = 60_000;
/** Essais de retrait avant d'abandonner (le salon des journaux est prévenu, et l'app l'affiche). */
export const ESSAIS_MAX = 10;
const RESERVATION_MS = 2 * MIN;
const RETRAIT_MAX_MS = 6 * H;

/** Refus affichable à la personne (clé de textes.mjs). */
export class RefusRoleTemp extends Error {
  constructor(cle, vars = {}) {
    super(cle);
    this.cle = cle;
    this.vars = vars;
  }
}

/**
 * Durée saisie : « 24h », « 90m », « 2j », « 2d », « 36 » (heures), « 1h30 ». Rend des millisecondes ou `null`.
 */
export function lireDuree(texte) {
  const s = String(texte ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  if (!s) return null;
  let m = /^(\d{1,4})(?:h|heure|heures)?$/.exec(s);
  if (m) return Number(m[1]) * H;
  m = /^(\d{1,5})(?:m|min|mn|minute|minutes)$/.exec(s);
  if (m) return Number(m[1]) * MIN;
  m = /^(\d{1,3})(?:j|d|jour|jours|day|days)$/.exec(s);
  if (m) return Number(m[1]) * 24 * H;
  m = /^(\d{1,3})h(\d{1,2})(?:m|min)?$/.exec(s);
  if (m && Number(m[2]) < 60) return Number(m[1]) * H + Number(m[2]) * MIN;
  return null;
}

/** Durée bornée (1 h à 30 j) : refuse sinon. */
export function dureeValide(ms, langue = 'fr') {
  const min = LIMITES_ROLES_TEMP.dureeMinH * H;
  const max = LIMITES_ROLES_TEMP.dureeMaxH * H;
  if (!Number.isFinite(ms) || ms < min || ms > max) throw new RefusRoleTemp('duree_hors_limites', { min: dureeTexte(langue, LIMITES_ROLES_TEMP.dureeMinH), max: dureeTexte(langue, LIMITES_ROLES_TEMP.dureeMaxH) });
  return ms;
}

const CHEMIN = (guildId, membreId, roleId) => `/guilds/${guildId}/members/${membreId}/roles/${roleId}`;

/** Traduit un échec REST en refus ; le 403 est diagnostiqué (hiérarchie, permission, rôle géré). */
async function refusDiscord(ctx, r, { guildId, roleId, membreId }) {
  if (r.motif === 'bot-absent') return new RefusRoleTemp('sans_bot');
  if (r.statut === 0) return new RefusRoleTemp('discord_injoignable');
  if (r.statut === 429) return new RefusRoleTemp('limite', { secondes: r.retryApresS ?? 5 });
  if (r.statut === 404) {
    if (r.code === 10011) return new RefusRoleTemp('role_introuvable');
    if (r.code === 10007) return new RefusRoleTemp('membre_absent', { membre: `<@${membreId}>` });
    return new RefusRoleTemp('discord_refus', { statut: r.statut });
  }
  if (r.statut === 403) return (await diagnostiquerRefus(ctx, guildId, roleId)) ?? new RefusRoleTemp('discord_refus', { statut: 403 });
  return new RefusRoleTemp('discord_refus', { statut: r.statut });
}

/** Pourquoi Discord refuse (403) : lit les rôles du serveur et ceux du bot. `null` : cause inconnue. */
async function diagnostiquerRefus(ctx, guildId, roleId) {
  const [roles, moi] = await Promise.all([rest(ctx.fetch, ctx.jetonBot, 'GET', `/guilds/${guildId}/roles`), rest(ctx.fetch, ctx.jetonBot, 'GET', '/users/@me')]);
  if (!roles.ok || !Array.isArray(roles.corps)) return null;
  const role = roles.corps.find(x => String(x.id) === roleId);
  if (!role) return new RefusRoleTemp('role_introuvable');
  if (role.managed) return new RefusRoleTemp('role_gere');
  const botId = moi.corps?.id ?? ctx.botId;
  const membre = botId ? await rest(ctx.fetch, ctx.jetonBot, 'GET', `/guilds/${guildId}/members/${botId}`) : null;
  if (!membre?.ok) return null;
  const rolesBot = membre.corps?.roles ?? [];
  const p = permissionsMembre({ guildId, roles: roles.corps, membreRoles: rolesBot, salon: null, membreId: botId });
  if ((p & P.GERER_ROLES) !== P.GERER_ROLES) return new RefusRoleTemp('gerer_roles_manquant');
  const plusHaut = roles.corps.filter(x => rolesBot.includes(String(x.id))).sort((a, b) => Number(b.position ?? 0) - Number(a.position ?? 0))[0];
  const positionBot = Number(plusHaut?.position ?? 0);
  if (Number(role.position ?? 0) >= positionBot) return new RefusRoleTemp('hierarchie', { role: String(role.name ?? roleId), bot: String(plusHaut?.name ?? 'bot') });
  return null;
}

// ------------------------------------------------------------------ Lecture

const octroi = l =>
  l && {
    id: l.id,
    teamId: l.team_id,
    guildId: l.guild_id,
    roleId: l.role_id,
    roleNom: l.role_nom,
    membreId: l.membre_discord_id,
    membreNom: l.membre_nom,
    accordePar: l.accorde_par ?? null,
    accordeParDiscordId: l.accorde_par_discord_id ?? null,
    accordeParNom: l.accorde_par_nom,
    raison: l.raison,
    statut: l.statut,
    accordeLe: l.accorde_le,
    expireLe: l.expire_le,
    retireLe: l.retire_le ?? null,
    essais: Number(l.essais ?? 0),
    erreur: l.erreur ?? null,
  };

export async function octroiActif(base, teamId, membreId) {
  return octroi(await base.premier("SELECT * FROM roles_temp_octrois WHERE team_id = ? AND membre_discord_id = ? AND statut = 'actif'", [teamId, membreId]));
}

export async function octroiParId(base, teamId, id) {
  return octroi(await base.premier('SELECT * FROM roles_temp_octrois WHERE team_id = ? AND id = ?', [teamId, id]));
}

/** Octrois actifs d'une team, les plus proches de l'échéance d'abord. */
export async function octroisActifs(base, teamId) {
  return (await base.tous("SELECT * FROM roles_temp_octrois WHERE team_id = ? AND statut = 'actif' ORDER BY expire_le, id", [teamId])).map(octroi);
}

// ------------------------------------------------------------------ Messages (journal, message privé)

const raisonTexte = (langue, raison) => (raison ? tr(langue, 'raison_prefixe', { raison: sur(raison, 300) }) : '');

async function langueMessages(base) {
  const g = await lireGeneral(base);
  return { mode: g.langue ?? 'auteur', general: g };
}

/** Texte publié dans les deux langues selon le réglage ; `vars` : objet, ou fonction de la langue (la raison en dépend). */
const composer = (cle, vars, opts) => bilingue(l => tr(l, cle, typeof vars === 'function' ? vars(l) : vars), opts);

/** Message dans le salon des journaux de la team (silencieux en cas d'échec : le journal ne bloque jamais). */
async function journaliser(ctx, reglages, cle, vars, langue) {
  if (!reglages.salonJournalId) return;
  const { mode } = await langueMessages(ctx.base);
  const contenu = composer(cle, vars, { mode, langue, max: 1900 });
  await rest(ctx.fetch, ctx.jetonBot, 'POST', `/channels/${reglages.salonJournalId}/messages`, { content: contenu, allowed_mentions: { parse: [] } }).catch(() => undefined);
}

/** Message privé à la personne (silencieux : messages privés fermés, personne partie…). */
async function prevenirMembre(ctx, reglages, o, vars, langue) {
  if (!reglages.mp) return false;
  try {
    const { mode, general } = await langueMessages(ctx.base);
    const salon = await rest(ctx.fetch, ctx.jetonBot, 'POST', '/users/@me/channels', { recipient_id: o.membreId });
    if (!salon.ok || !salon.corps?.id) return false;
    const contenu = composer('mp_donne', l => ({ ...vars(l), serveur: sur(general.guildNom || 'Discord', 100) }), { mode, langue, max: 1900 });
    const r = await rest(ctx.fetch, ctx.jetonBot, 'POST', `/channels/${salon.corps.id}/messages`, { content: contenu, allowed_mentions: { parse: [] } });
    return r.ok;
  } catch {
    return false;
  }
}

const nomEquipe = async (base, teamId) => (await base.premier('SELECT nom FROM teams WHERE id = ?', [teamId]))?.nom ?? '';
const parTexte = par => (par?.discordId ? `<@${par.discordId}>` : sur(par?.nom || '—', 80));

// ------------------------------------------------------------------ Octroi

/**
 * Donne (ou prolonge) le rôle temporaire de la team. `ctx` : { base, fetch, jetonBot, maintenant, botId? }.
 * `entree` : { teamId, membreId, membreNom, dureeMs, raison, par: { compte, discordId, nom }, langue }.
 * Rend `{ octroi, prolonge }`.
 */
export async function donnerRoleTemp(ctx, entree) {
  const { base, maintenant } = ctx;
  const t = maintenant();
  const membreId = idDiscord(entree.membreId);
  if (!membreId) throw new RefusRoleTemp('membre_absent', { membre: sur(entree.membreNom || '—', 60) });
  const reglages = await lireReglagesEquipe(base, entree.teamId);
  if (!reglages.actif || !reglages.roleId) throw new RefusRoleTemp('non_configure');
  const general = await lireGeneral(base);
  const guildId = await guildDeEquipe(base, entree.teamId, general);
  if (!guildId) throw new RefusRoleTemp('non_configure');
  const dureeMs = dureeValide(entree.dureeMs ?? reglages.dureeDefautH * H, entree.langue);
  const equipe = await nomEquipe(base, entree.teamId);
  const nom = sur(entree.membreNom || '', 100);
  const raison = sur(entree.raison || '', 300);
  const existant = await octroiActif(base, entree.teamId, membreId);
  if (!existant) {
    const n = Number((await base.premier("SELECT COUNT(*) AS n FROM roles_temp_octrois WHERE team_id = ? AND statut = 'actif'", [entree.teamId]))?.n ?? 0);
    if (n >= reglages.maxSimultanes) throw new RefusRoleTemp('max_atteint', { max: reglages.maxSimultanes, team: sur(equipe, 80) });
  }
  const r = await rest(ctx.fetch, ctx.jetonBot, 'PUT', CHEMIN(guildId, membreId, reglages.roleId), undefined, { raison: `Rôle temporaire (${equipe}) par ${entree.par?.nom || 'Esport HQ'}` });
  if (!r.ok) throw await refusDiscord(ctx, r, { guildId, roleId: reglages.roleId, membreId });

  const fin = Math.min(Math.max(existant ? Date.parse(existant.expireLe) : 0, t + dureeMs), t + LIMITES_ROLES_TEMP.dureeMaxH * H);
  let ligne;
  const evt = evenement('discord.role_temp_given', { teamId: entree.teamId, acteur: entree.par?.compte ?? null, entiteType: 'discord', entiteId: entree.teamId, charge: { role: reglages.roleNom, membre: nom || membreId, expire: iso(fin), prolonge: Boolean(existant) }, maintenant: t });
  if (existant) {
    // Si le rôle réglé a changé depuis l'octroi, l'ancien est retiré (au mieux) et l'octroi suit le nouveau.
    if (existant.roleId !== reglages.roleId) await rest(ctx.fetch, ctx.jetonBot, 'DELETE', CHEMIN(existant.guildId, membreId, existant.roleId), undefined, { raison: 'Rôle temporaire remplacé' }).catch(() => undefined);
    await base.lot([
      {
        sql: `UPDATE roles_temp_octrois SET guild_id = ?, role_id = ?, role_nom = ?, membre_nom = ?, expire_le = ?, raison = ?, accorde_par = ?, accorde_par_discord_id = ?, accorde_par_nom = ?, essais = 0, prochain_essai_le = NULL, erreur = NULL, maj_le = ? WHERE id = ?`,
        params: [guildId, reglages.roleId, reglages.roleNom, nom || existant.membreNom, iso(fin), raison || existant.raison, entree.par?.compte ?? null, entree.par?.discordId ?? null, sur(entree.par?.nom || '', 100), iso(t), existant.id],
      },
      evt,
    ]);
    ligne = await octroiParId(base, entree.teamId, existant.id);
  } else {
    const id = nouvelId();
    await base.lot([
      {
        sql: `INSERT INTO roles_temp_octrois (id, team_id, guild_id, role_id, role_nom, membre_discord_id, membre_nom, accorde_par, accorde_par_discord_id, accorde_par_nom, raison, statut, accorde_le, expire_le, maj_le)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'actif', ?, ?, ?)`,
        params: [id, entree.teamId, guildId, reglages.roleId, reglages.roleNom, membreId, nom, entree.par?.compte ?? null, entree.par?.discordId ?? null, sur(entree.par?.nom || '', 100), raison, iso(t), iso(fin), iso(t)],
      },
      evt,
    ]);
    ligne = await octroiParId(base, entree.teamId, id);
  }
  const vars = langue => ({ role: sur(reglages.roleNom || ligne.roleNom, 100), membre: `<@${membreId}>`, team: sur(equipe, 80), fin: horodatage(fin, 'f'), relatif: horodatage(fin, 'R'), par: parTexte(entree.par), raison: raisonTexte(langue, raison) });
  await journaliser(ctx, reglages, existant ? 'j_prolonge' : 'j_donne', vars, entree.langue);
  const prevenu = existant ? false : await prevenirMembre(ctx, reglages, ligne, vars, entree.langue);
  return { octroi: ligne, prolonge: Boolean(existant), prevenu };
}

/** Prolonge un octroi actif de `dureeMs` (ajoutée à l'échéance actuelle, 30 jours au plus à partir de maintenant). */
export async function prolongerRoleTemp(ctx, octroiId, { teamId, dureeMs, par, langue }) {
  const { base, maintenant } = ctx;
  const t = maintenant();
  const o = await octroiParId(base, teamId, octroiId);
  if (!o || o.statut !== 'actif') throw echec(404, 'octroi', 'Rôle temporaire introuvable ou déjà terminé.');
  dureeValide(dureeMs, langue);
  const fin = Math.min(Math.max(Date.parse(o.expireLe), t) + dureeMs, t + LIMITES_ROLES_TEMP.dureeMaxH * H);
  await base.lot([
    { sql: 'UPDATE roles_temp_octrois SET expire_le = ?, essais = 0, prochain_essai_le = NULL, erreur = NULL, maj_le = ? WHERE id = ?', params: [iso(fin), iso(t), o.id] },
    evenement('discord.role_temp_given', { teamId, acteur: par?.compte ?? null, entiteType: 'discord', entiteId: teamId, charge: { role: o.roleNom, membre: o.membreNom || o.membreId, expire: iso(fin), prolonge: true }, maintenant: t }),
  ]);
  const reglages = await lireReglagesEquipe(base, teamId);
  const equipe = await nomEquipe(base, teamId);
  await journaliser(ctx, reglages, 'j_prolonge', { role: sur(o.roleNom, 100), membre: `<@${o.membreId}>`, team: sur(equipe, 80), fin: horodatage(fin, 'f'), par: parTexte(par), raison: '' }, langue);
  return octroiParId(base, teamId, o.id);
}

/**
 * Retire le rôle (action de la personne qui gère). Personne ou rôle disparus (404) : l'octroi est clos sans erreur.
 * Autre refus : explication claire, l'octroi reste actif.
 */
export async function retirerRoleTemp(ctx, o, { par, langue }) {
  const { base, maintenant } = ctx;
  const t = maintenant();
  const r = await rest(ctx.fetch, ctx.jetonBot, 'DELETE', CHEMIN(o.guildId, o.membreId, o.roleId), undefined, { raison: `Rôle temporaire retiré par ${par?.nom || 'Esport HQ'}` });
  let deja = false;
  if (!r.ok) {
    if (r.statut === 404 && (r.code === 10007 || r.code === 10011)) deja = true;
    else throw await refusDiscord(ctx, r, { guildId: o.guildId, roleId: o.roleId, membreId: o.membreId });
  }
  await base.lot([
    { sql: "UPDATE roles_temp_octrois SET statut = 'retire', retire_le = ?, retire_par = ?, prochain_essai_le = NULL, maj_le = ? WHERE id = ? AND statut = 'actif'", params: [iso(t), par?.compte ?? null, iso(t), o.id] },
    evenement('discord.role_temp_removed', { teamId: o.teamId, acteur: par?.compte ?? null, entiteType: 'discord', entiteId: o.teamId, charge: { role: o.roleNom, membre: o.membreNom || o.membreId, expire: false }, maintenant: t }),
  ]);
  const reglages = await lireReglagesEquipe(base, o.teamId);
  const equipe = await nomEquipe(base, o.teamId);
  await journaliser(ctx, reglages, 'j_retire', { role: sur(o.roleNom, 100), membre: `<@${o.membreId}>`, team: sur(equipe, 80), par: parTexte(par) }, langue);
  return { deja };
}

// ------------------------------------------------------------------ Échéance

/**
 * Retire les rôles arrivés à échéance (cron + processus de la connexion en direct). Sans jeton du bot : rien n'est fait
 * (les octrois restent actifs, repris dès que le bot est configuré). Chaque octroi est réservé 2 minutes avant l'appel
 * (deux processus ne traitent jamais le même). Limite de débit : nouvel essai après `retry_after` ; hiérarchie, Discord
 * injoignable : essais espacés (5 min, 10 min… 6 h), `ESSAIS_MAX` au plus, puis statut 'echec' et message au journal.
 * Personne partie, rôle supprimé (404) ou déjà retiré : octroi clos.
 */
export async function expirerRolesTemp(base, { fetch: fetchDiscord = (...a) => globalThis.fetch(...a), jetonBot, maintenant = () => Date.now(), max = 25 } = {}) {
  const bilan = { retires: 0, reportes: 0, abandons: 0 };
  if (!jetonBot) return bilan;
  const t0 = maintenant();
  const dus = await base.tous(
    "SELECT * FROM roles_temp_octrois WHERE statut = 'actif' AND expire_le <= ? AND (prochain_essai_le IS NULL OR prochain_essai_le <= ?) ORDER BY expire_le LIMIT ?",
    [iso(t0), iso(t0), max],
  );
  const ctx = { base, fetch: fetchDiscord, jetonBot, maintenant };
  for (const l of dus) {
    const o = octroi(l);
    const t = maintenant();
    const pris = await base.executer("UPDATE roles_temp_octrois SET prochain_essai_le = ?, maj_le = ? WHERE id = ? AND statut = 'actif' AND (prochain_essai_le IS NULL OR prochain_essai_le <= ?)", [iso(t + RESERVATION_MS), iso(t), o.id, iso(t)]);
    if (pris.changements !== 1) continue;
    const r = await rest(fetchDiscord, jetonBot, 'DELETE', CHEMIN(o.guildId, o.membreId, o.roleId), undefined, { raison: 'Rôle temporaire arrivé à échéance' });
    const reglages = await lireReglagesEquipe(base, o.teamId);
    const equipe = await nomEquipe(base, o.teamId);
    const vars = { role: sur(o.roleNom, 100), membre: `<@${o.membreId}>`, team: sur(equipe, 80) };
    const disparu = r.statut === 404 && (r.code === 10007 || r.code === 10011 || r.code === 10004);
    if (r.ok || disparu) {
      await base.lot([
        { sql: "UPDATE roles_temp_octrois SET statut = 'expire', retire_le = ?, prochain_essai_le = NULL, erreur = NULL, maj_le = ? WHERE id = ? AND statut = 'actif'", params: [iso(t), iso(t), o.id] },
        evenement('discord.role_temp_removed', { teamId: o.teamId, acteur: null, entiteType: 'discord', entiteId: o.teamId, charge: { role: o.roleNom, membre: o.membreNom || o.membreId, expire: true }, maintenant: t }),
      ]);
      bilan.retires++;
      await journaliser(ctx, reglages, 'j_expire', vars, 'fr');
      continue;
    }
    // Échec : nouvel essai plus tard (ou abandon).
    const refus = await refusDiscord(ctx, r, { guildId: o.guildId, roleId: o.roleId, membreId: o.membreId }).catch(() => new RefusRoleTemp('discord_refus', { statut: r.statut }));
    const motif = tr('fr', refus.cle, refus.vars).replace(/\*\*/g, '').slice(0, 300);
    const essais = o.essais + 1;
    const attente = r.statut === 429 ? Math.max(1, Number(r.retryApresS) || 5) * 1000 : Math.min(RETRAIT_MAX_MS, 5 * MIN * 2 ** Math.min(o.essais, 10));
    if (essais >= ESSAIS_MAX) {
      await base.executer("UPDATE roles_temp_octrois SET statut = 'echec', essais = ?, erreur = ?, prochain_essai_le = NULL, maj_le = ? WHERE id = ?", [essais, motif, iso(t), o.id]);
      bilan.abandons++;
      await journaliser(ctx, reglages, 'j_abandon', { ...vars, motif }, 'fr');
    } else {
      await base.executer('UPDATE roles_temp_octrois SET essais = ?, erreur = ?, prochain_essai_le = ?, maj_le = ? WHERE id = ?', [essais, motif, iso(t + attente), iso(t), o.id]);
      bilan.reportes++;
      if (essais === 1 && r.statut !== 429) await journaliser(ctx, reglages, 'j_echec', { ...vars, motif }, 'fr');
    }
  }
  return bilan;
}
