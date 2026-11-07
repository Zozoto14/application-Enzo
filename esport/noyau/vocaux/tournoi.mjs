/**
 * Équipes d'un tournoi et rôles Discord (docs/esport/vocaux.md, « Tournois : rôles des équipes ») — migration 0063.
 *
 * Pour un tournoi du module Tournois (ex. The Nuke End), le Fondateur (ou qui gère les tournois de la team) note les
 * ÉQUIPES PARTICIPANTES (nom, TAG, membres avec leur Discord ID, Embark ID, poste), à la main ou importées depuis les
 * tickets d'inscription d'une catégorie de tickets (réponses du formulaire lues ICI, jamais envoyées à une IA ; les
 * membres sans Discord ID lisible sont signalés pour être corrigés). Puis, en une action :
 *  - « Créer les rôles Discord » : un rôle par équipe sur le serveur du club, nommé d'après un modèle (`{tag} {nom}`),
 *    non mentionnable, couleur facultative, sans permission ; donné aux membres présents sur le serveur (bilan : qui
 *    n'a pas été trouvé, qui n'a pas de Discord ID) ; rejouable (seuls les rôles et attributions manquants sont faits) ;
 *  - « Supprimer les rôles » : rôles supprimés sur Discord, ainsi que les salons vocaux des équipes du tournoi ; fait
 *    aussi par le cron quand le tournoi est terminé (ou annulé), et N heures après sa date de fin (24 h par défaut).
 *
 * HUB DE TOURNOI (Administration › Bot Esport HQ › Fonctionnalités › Salons vocaux : hub lié au tournoi) : seuls les
 * membres qui ont le rôle d'une équipe du tournoi peuvent s'en servir (les autres sont déconnectés et reçoivent un MP
 * d'explication) ; le salon créé porte le nom de l'équipe (`{tag} — {nom}`) et reste VERROUILLÉ sur son rôle (plus
 * les rôles du staff et les rôles autorisés du hub : casters, admins) ; ni renommage, ni déverrouillage ; UN salon par
 * équipe à la fois (un coéquipier qui passe par le hub y est déplacé).
 * Hiérarchie Discord : le rôle du bot doit être AU-DESSUS des rôles créés (ils naissent tout en bas) ; un refus (403)
 * est expliqué.
 *
 * Droits : `tournois.gerer` dans la team (404 sans le module) ; les actions sur Discord demandent en plus
 * `vocaux.configurer` ; l'import demande de voir les tickets de la catégorie choisie.
 */

import { echec, iso, jsonOu, nouvelId } from '../outils.mjs';
import { aGlobale } from '../roles/globales.mjs';
import { MODULE_TOURNOIS, exigerModule, exigerUuid, peut } from '../competition/commun.mjs';
import { droitsTickets, voitCategorie } from '../tickets/acces.mjs';
import { lireGeneral } from '../tickets/reglages.mjs';
import { rest } from '../tickets/discord.mjs';
import { lireVocaux, nomSalon } from './reglages.mjs';
import { nomMembre, salonsDuServeur, supprimerLigne } from './salons.mjs';
import { tv2 } from './textes.mjs';

export const POSTES = Object.freeze(['joueur', 'coach', 'remplacant']);
export const MODELE_ROLE_DEFAUT = '{tag} {nom}';
export const LIMITES_EQUIPES = Object.freeze({ equipes: 64, membres: 10, resolutions: 150 });
export const SUPPRESSION_DEFAUT_H = 24;
const ID = /^\d{17,20}$/;

// ------------------------------------------------------------------ Lecture des réponses d'inscription

const MENTION = /<@!?(\d{17,20})>/;
const ID_LIBRE = /(?:^|[^\d])(\d{17,20})(?!\d)/;
const EMBARK = /([^\s|,;:—–<>@]+#\d{4})(?!\d)/;
const PUCE = /^\s*(?:[-*•·]+|\d+\s*[.)]|(?:joueur|player|sub|rempla[cç]ant|coach)\s*\d*\s*[:.)-])\s*/i;

/** Une ligne « Discord ID — Embark ID » (mention, ID, @pseudo, Embark ID « nom#1234 », dans tout ordre). */
export function lireLigneMembre(ligne, poste = 'joueur') {
  const brut = String(ligne ?? '').trim().slice(0, 300);
  let reste = brut.replace(PUCE, '');
  let discordId = null;
  const m = MENTION.exec(reste) ?? ID_LIBRE.exec(reste);
  if (m) {
    discordId = m[1];
    reste = reste.replace(m[0].startsWith('<') ? m[0] : m[1], ' ');
  }
  let embarkId = '';
  const e = EMBARK.exec(reste);
  if (e) {
    embarkId = e[1].slice(0, 60);
    reste = reste.replace(e[1], ' ');
  }
  const nom = reste
    .replace(/[—–|,;:()[\]]/g, ' ')
    .replace(/(^|\s)-+(?=\s|$)/g, ' ')
    .replace(/@/g, '')
    .replace(/\b(discord|embark|id)\b\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return { poste, discordId, nom, embarkId, brut };
}

const lignes = v => String(v ?? '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^[-—–_.\s]*$/.test(l));
const libelleDe = r => `${r?.libelle?.fr ?? ''} ${r?.libelle?.en ?? ''} ${r?.id ?? ''}`.toLowerCase();

/**
 * Réponses du formulaire d'un ticket d'inscription (`[{ id, libelle, valeur }]`) → `{ nom, tag, membres, problemes }`.
 * Champs reconnus par leur identifiant (equipe, tag, joueurs, coach, remplacants : catégorie « Inscription The Nuke
 * End ») ou leur libellé (équipe / team, tag, joueur / player, coach, remplaçant / sub).
 */
export function lireReponsesInscription(reponses) {
  const liste = Array.isArray(reponses) ? reponses : [];
  const champ = (ids, motif) => liste.find(r => ids.includes(String(r?.id ?? ''))) ?? liste.find(r => motif.test(libelleDe(r)));
  const nom = String(champ(['equipe', 'nom', 'team'], /(équipe|equipe|team)/)?.valeur ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const tag = String(champ(['tag'], /\btag\b/)?.valeur ?? '').replace(/[^\p{L}\p{N}]/gu, '').toUpperCase().slice(0, 6);
  const membres = [];
  for (const [poste, ids, motif] of [
    ['joueur', ['joueurs', 'players'], /(joueur|player)/],
    ['coach', ['coach'], /coach/],
    ['remplacant', ['remplacants', 'subs'], /(rempla|\bsubs?\b)/],
  ]) {
    for (const l of lignes(champ(ids, motif)?.valeur)) if (!/^(aucun|none|n\/a|-|non|no)$/i.test(l)) membres.push(lireLigneMembre(l, poste));
  }
  const problemes = [];
  if (!nom) problemes.push('nom');
  if (!tag) problemes.push('tag');
  if (!membres.some(x => x.poste === 'joueur')) problemes.push('joueurs');
  if (membres.some(x => !x.discordId)) problemes.push('sans_id');
  return { nom, tag, membres: membres.slice(0, LIMITES_EQUIPES.membres), problemes };
}

/** Nom du rôle d'une équipe : modèle et variables {tag}, {nom} (100 caractères au plus). */
export function nomRole(modele, { tag = '', nom = '' }) {
  const s = String(modele || MODELE_ROLE_DEFAUT)
    .replace(/\{(tag|nom)\}/g, (_, k) => (k === 'tag' ? tag : nom))
    .replace(/@(everyone|here)/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return (s || `${tag} ${nom}`.trim() || 'Team').slice(0, 100);
}

// ------------------------------------------------------------------ Base

export async function lireReglagesTournoi(base, tournoiId) {
  const l = await base.premier('SELECT * FROM tournoi_discord WHERE tournoi_id = ?', [tournoiId]);
  return {
    modeleRole: l?.modele_role || MODELE_ROLE_DEFAUT,
    couleur: l?.couleur ?? null,
    suppressionH: l ? Number(l.suppression_h) : SUPPRESSION_DEFAUT_H,
    categorieTicketId: l?.categorie_ticket_id ?? null,
    rolesCreesLe: l?.roles_crees_le ?? null,
    rolesSupprimesLe: l?.roles_supprimes_le ?? null,
  };
}

export async function equipesDuTournoi(base, tournoiId) {
  const equipes = await base.tous('SELECT * FROM tournoi_equipes WHERE tournoi_id = ? ORDER BY position, nom', [tournoiId]);
  const membres = equipes.length ? await base.tous(`SELECT * FROM tournoi_equipe_membres WHERE equipe_id IN (${equipes.map(() => '?').join(', ')}) ORDER BY position`, equipes.map(e => e.id)) : [];
  return equipes.map(e => ({
    id: e.id,
    nom: e.nom,
    tag: e.tag,
    roleId: e.role_id ?? null,
    ticketId: e.ticket_id ?? null,
    membres: membres.filter(m => m.equipe_id === e.id).map(m => ({ id: m.id, poste: m.poste, discordId: m.discord_id ?? null, nom: m.nom, embarkId: m.embark_id, roleStatut: m.role_statut ?? null })),
  }));
}

/** Rôles qui ouvrent le salon d'une équipe : son rôle, et les rôles autorisés du hub (casters, admins). */
export async function rolesEquipe(ctx, s) {
  if (!s?.equipeId) return [];
  const e = await ctx.base.premier('SELECT role_id FROM tournoi_equipes WHERE id = ?', [s.equipeId]);
  const hub = ctx.reglages?.hubs?.find(h => h.id === s.hubId);
  return [...new Set([e?.role_id, ...(hub?.rolesAutorises ?? [])].filter(Boolean))];
}

/** « TAG Nom » de l'équipe d'un salon (panneau). */
export async function equipeDe(base, s) {
  if (!s?.equipeId) return '';
  const e = await base.premier('SELECT nom, tag FROM tournoi_equipes WHERE id = ?', [s.equipeId]);
  return e ? `${e.tag} ${e.nom}`.trim() : '';
}

/**
 * Arrivée dans un hub de tournoi (moteur.mjs) : `membre` = `{ id, nom, roles }` (rôles donnés par l'événement vocal).
 * `outils` : `{ creerSalon, deplacer }` du moteur. Rend `'cree' | 'deplace' | 'refuse' | null`.
 */
export async function gererHubTournoi(ctx, hub, membre, { creerSalon, deplacer }) {
  const { base } = ctx;
  const equipes = await base.tous('SELECT id, nom, tag, role_id FROM tournoi_equipes WHERE tournoi_id = ? AND role_id IS NOT NULL ORDER BY position', [hub.tournoiId]);
  const roles = Array.isArray(membre.roles) ? membre.roles : [];
  const equipe = equipes.find(e => roles.includes(e.role_id));
  if (!equipe) {
    // Pas d'équipe : déconnecté du hub, et un MP explique pourquoi (au mieux : MP fermés, rien de plus).
    await rest(ctx.fetch, ctx.jetonBot, 'PATCH', `/guilds/${ctx.guildId}/members/${membre.id}`, { channel_id: null }, { raison: 'Esport HQ : hub réservé aux équipes du tournoi' });
    const t = await base.premier('SELECT nom FROM tournois WHERE id = ?', [hub.tournoiId]);
    const mp = await rest(ctx.fetch, ctx.jetonBot, 'POST', '/users/@me/channels', { recipient_id: membre.id });
    if (mp.ok && mp.corps?.id) await rest(ctx.fetch, ctx.jetonBot, 'POST', `/channels/${mp.corps.id}/messages`, { content: tv2('tournoi_refus', { tournoi: t?.nom ?? '' }, { mode: ctx.mode, langue: 'fr', max: 1900 }), allowed_mentions: { parse: [] } });
    return 'refuse';
  }
  // Un salon par équipe : s'il existe, le membre y est déplacé.
  const existant = await base.premier('SELECT salon_id FROM vocaux_salons WHERE equipe_id = ? ORDER BY cree_le LIMIT 1', [equipe.id]);
  if (existant) {
    const d = await deplacer(ctx, membre.id, existant.salon_id);
    if (d.ok) return 'deplace';
    if (d.statut !== 404 && d.code !== 10003) return null;
    await supprimerLigne(base, existant.salon_id);
  }
  const s = await creerSalon(ctx, hub, membre, { nom: nomSalon(hub.modeleNom, { tag: equipe.tag, nom: equipe.nom, pseudo: membre.nom }), tournoiId: hub.tournoiId, equipeId: equipe.id, equipe: `${equipe.tag} ${equipe.nom}`.trim() });
  return s ? 'cree' : null;
}

/**
 * Supprime les rôles Discord du tournoi et les salons vocaux de ses équipes. `ctx` : `base`, `fetch`, `jetonBot`,
 * `guildId`, `maintenant`. Rend `{ roles, salons, echecs }`. Rôle ou salon déjà supprimé : considéré comme fait.
 */
export async function nettoyerTournoi(ctx, tournoiId) {
  const { base } = ctx;
  let roles = 0;
  let salons = 0;
  const echecs = [];
  for (const s of (await salonsDuServeur(base, ctx.guildId)).filter(x => x.tournoiId === tournoiId)) {
    const r = await rest(ctx.fetch, ctx.jetonBot, 'DELETE', `/channels/${s.salonId}`, undefined, { raison: 'Esport HQ : fin du tournoi' });
    if (r.ok || r.statut === 404) {
      await supprimerLigne(base, s.salonId);
      salons++;
    } else echecs.push({ quoi: 'salon', id: s.salonId, statut: r.statut, code: r.code ?? null });
  }
  for (const e of await base.tous('SELECT id, role_id FROM tournoi_equipes WHERE tournoi_id = ? AND role_id IS NOT NULL', [tournoiId])) {
    const r = await rest(ctx.fetch, ctx.jetonBot, 'DELETE', `/guilds/${ctx.guildId}/roles/${e.role_id}`, undefined, { raison: 'Esport HQ : fin du tournoi' });
    if (r.ok || r.statut === 404) {
      await base.executer('UPDATE tournoi_equipes SET role_id = NULL, maj_le = ? WHERE id = ?', [iso(ctx.maintenant()), e.id]);
      await base.executer('UPDATE tournoi_equipe_membres SET role_statut = NULL WHERE equipe_id = ?', [e.id]);
      roles++;
    } else echecs.push({ quoi: 'role', id: e.role_id, statut: r.statut, code: r.code ?? null });
    if (r.statut === 429) break;
  }
  if (!echecs.length) await base.executer('UPDATE tournoi_discord SET roles_supprimes_le = ?, maj_le = ? WHERE tournoi_id = ?', [iso(ctx.maintenant()), iso(ctx.maintenant()), tournoiId]);
  return { roles, salons, echecs };
}

/** Fin de journée (UTC) de la date de fin d'un tournoi (AAAA-MM-JJ), ou null. */
const finDe = fin => (typeof fin === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fin) ? Date.parse(`${fin}T23:59:59.999Z`) : null);

/**
 * Cron (toutes les 5 min) : rôles des tournois terminés ou annulés, ou dont la date de fin est passée depuis le délai
 * réglé (0 : jamais par la date), supprimés avec les salons vocaux des équipes. Rend le nombre de tournois nettoyés.
 */
export async function tachesTournoisDiscord(base, { fetch: fetchDiscord = (...a) => globalThis.fetch(...a), jetonBot, maintenant = () => Date.now() } = {}) {
  if (!jetonBot) return 0;
  const general = await lireGeneral(base);
  if (!general.guildId) return 0;
  const t = maintenant();
  const lignes = await base.tous(
    'SELECT d.tournoi_id, d.suppression_h, t.statut, t.fin, t.supprime_le FROM tournoi_discord d JOIN tournois t ON t.id = d.tournoi_id WHERE d.roles_crees_le IS NOT NULL AND d.roles_supprimes_le IS NULL',
    [],
  );
  let n = 0;
  for (const l of lignes) {
    const fin = finDe(l.fin);
    const h = Number(l.suppression_h);
    const du = l.supprime_le || ['termine', 'annule'].includes(l.statut) || (h > 0 && fin !== null && t >= fin + h * 3_600_000);
    if (!du) continue;
    await nettoyerTournoi({ base, fetch: fetchDiscord, jetonBot, guildId: general.guildId, maintenant }, l.tournoi_id);
    n++;
  }
  return n;
}

// ------------------------------------------------------------------ Services de l'app

const texte = (v, max, quoi, { requis = false } = {}) => {
  if (v === undefined || v === null) {
    if (requis) throw echec(400, quoi, 'Champ obligatoire.');
    return '';
  }
  if (typeof v !== 'string') throw echec(400, quoi, 'Texte attendu.');
  const s = v.replace(/\s+/g, ' ').trim();
  if (requis && !s) throw echec(400, quoi, 'Champ obligatoire.');
  if (s.length > max) throw echec(400, quoi, `${max} caractères au plus.`);
  return s;
};

function validerEquipe(c) {
  if (!c || typeof c !== 'object') throw echec(400, 'equipe', 'Équipe illisible.');
  const nom = texte(c.nom, 80, 'equipe-nom', { requis: true });
  const tag = texte(c.tag, 6, 'equipe-tag', { requis: true }).toUpperCase();
  if (!/^[\p{L}\p{N}]{1,6}$/u.test(tag)) throw echec(400, 'equipe-tag', 'TAG : lettres et chiffres, 6 au plus.');
  const membres = c.membres === undefined ? [] : c.membres;
  if (!Array.isArray(membres) || membres.length > LIMITES_EQUIPES.membres) throw echec(400, 'equipe-membres', 'Membres : 10 au plus.');
  return {
    nom,
    tag,
    ticketId: typeof c.ticketId === 'string' && /^[0-9a-f-]{36}$/.test(c.ticketId) ? c.ticketId : null,
    membres: membres.map(m => {
      const poste = POSTES.includes(m?.poste) ? m.poste : 'joueur';
      const discordId = m?.discordId === null || m?.discordId === undefined || m?.discordId === '' ? null : String(m.discordId).trim();
      if (discordId !== null && !ID.test(discordId)) throw echec(400, 'equipe-discord', 'Discord ID invalide (17 à 20 chiffres).');
      return { poste, discordId, nom: texte(m?.nom ?? '', 100, 'equipe-membre'), embarkId: texte(m?.embarkId ?? '', 60, 'equipe-embark') };
    }),
  };
}

export function servicesEquipesTournoi({ base, maintenant = () => Date.now(), socle, fetch: fetchDiscord, jetonBot }) {
  async function contexte(acteur, teamId, tournoiId) {
    const ctx = await socle.contexteTeam(acteur, teamId);
    exigerModule(ctx, MODULE_TOURNOIS, 'tournois.gerer');
    exigerUuid(tournoiId, 'tournoi');
    const tournoi = await base.premier('SELECT id, nom, statut, debut, fin, team_id FROM tournois WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [tournoiId, teamId]);
    if (!tournoi) throw echec(404, 'tournoi-introuvable', 'Tournoi introuvable.');
    return { ctx, tournoi };
  }

  async function exigerDiscord(acteur) {
    if (!(await aGlobale(base, acteur, 'vocaux.configurer'))) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    if (!jetonBot) throw echec(503, 'bot-absent', 'Bot Discord non configuré (DISCORD_BOT_TOKEN).');
    const general = await lireGeneral(base);
    if (!general.guildId) throw echec(400, 'vocaux-serveur', 'Choisissez d’abord le serveur Discord (Tickets › Configuration › Général).');
    return general;
  }

  async function lire(acteur, teamId, tournoiId) {
    const { ctx, tournoi } = await contexte(acteur, teamId, tournoiId);
    const droitsTk = await droitsTickets(base, acteur);
    const categories = (await base.tous('SELECT id, nom_fr, nom_en FROM tickets_categories WHERE supprime_le IS NULL ORDER BY position, nom_fr', [])).filter(c => voitCategorie(droitsTk, c.id) || droitsTk.fondateur);
    const general = await lireGeneral(base);
    const hubs = (await lireVocaux(base)).hubs.filter(h => h.tournoiId === tournoiId).map(h => ({ id: h.id, nom: h.nom }));
    return {
      tournoi: { id: tournoi.id, nom: tournoi.nom, statut: tournoi.statut, fin: tournoi.fin ?? null },
      reglages: await lireReglagesTournoi(base, tournoiId),
      equipes: await equipesDuTournoi(base, tournoiId),
      categoriesTickets: categories.map(c => ({ id: c.id, nom: { fr: c.nom_fr, en: c.nom_en } })),
      serveur: general.guildId ? { id: general.guildId, nom: general.guildNom ?? '' } : null,
      hubs,
      droits: { gerer: peut(ctx, 'tournois.gerer'), discord: await aGlobale(base, acteur, 'vocaux.configurer'), importer: categories.length > 0 },
      bot: Boolean(jetonBot),
      limites: LIMITES_EQUIPES,
      modeleDefaut: MODELE_ROLE_DEFAUT,
    };
  }

  async function changerReglages(acteur, teamId, tournoiId, c) {
    await contexte(acteur, teamId, tournoiId);
    const actuel = await lireReglagesTournoi(base, tournoiId);
    const s = { ...actuel };
    if (c?.modeleRole !== undefined) {
      const m = texte(c.modeleRole, 90, 'tournoi-modele-role');
      if (m && !/\{(tag|nom)\}/.test(m)) throw echec(400, 'tournoi-modele-role', 'Le modèle du nom des rôles doit contenir {tag} ou {nom}.');
      s.modeleRole = m || MODELE_ROLE_DEFAUT;
    }
    if (c?.couleur !== undefined) {
      if (c.couleur !== null && c.couleur !== '' && (typeof c.couleur !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(c.couleur))) throw echec(400, 'couleur', 'Couleur : #rrggbb.');
      s.couleur = c.couleur ? c.couleur.toLowerCase() : null;
    }
    if (c?.suppressionH !== undefined) {
      const n = Number(c.suppressionH);
      if (!Number.isInteger(n) || n < 0 || n > 720) throw echec(400, 'tournoi-suppression', 'Délai de suppression des rôles : de 0 à 720 heures.');
      s.suppressionH = n;
    }
    if (c?.categorieTicketId !== undefined) {
      if (c.categorieTicketId && !(await base.premier('SELECT id FROM tickets_categories WHERE id = ?', [String(c.categorieTicketId)]))) throw echec(400, 'categories', 'Catégorie introuvable.');
      s.categorieTicketId = c.categorieTicketId || null;
    }
    const t = iso(maintenant());
    await base.executer(
      `INSERT INTO tournoi_discord (tournoi_id, team_id, modele_role, couleur, suppression_h, categorie_ticket_id, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tournoi_id) DO UPDATE SET modele_role = excluded.modele_role, couleur = excluded.couleur, suppression_h = excluded.suppression_h, categorie_ticket_id = excluded.categorie_ticket_id, maj_le = excluded.maj_le`,
      [tournoiId, teamId, s.modeleRole, s.couleur, s.suppressionH, s.categorieTicketId, t],
    );
    return lire(acteur, teamId, tournoiId);
  }

  async function ecrireMembres(equipeId, membres) {
    await base.executer('DELETE FROM tournoi_equipe_membres WHERE equipe_id = ?', [equipeId]);
    let i = 0;
    for (const m of membres) await base.executer('INSERT INTO tournoi_equipe_membres (id, equipe_id, poste, discord_id, nom, embark_id, role_statut, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [nouvelId(), equipeId, m.poste, m.discordId, m.nom, m.embarkId, m.roleStatut ?? null, i++]);
  }

  async function tagPris(tournoiId, tag, sauf = null) {
    const l = await base.premier('SELECT id FROM tournoi_equipes WHERE tournoi_id = ? AND UPPER(tag) = ? AND id <> ?', [tournoiId, tag.toUpperCase(), sauf ?? '']);
    return Boolean(l);
  }

  /** Ajoute des équipes (`{ equipes: [...] }`) ; un TAG déjà pris dans ce tournoi est refusé. */
  async function ajouterEquipes(acteur, teamId, tournoiId, corps) {
    await contexte(acteur, teamId, tournoiId);
    const liste = Array.isArray(corps?.equipes) ? corps.equipes : [corps];
    const n = await base.premier('SELECT COUNT(*) AS n FROM tournoi_equipes WHERE tournoi_id = ?', [tournoiId]);
    if (Number(n?.n ?? 0) + liste.length > LIMITES_EQUIPES.equipes) throw echec(409, 'trop', '64 équipes au plus par tournoi.');
    const valides = liste.map(validerEquipe);
    const tags = new Set();
    for (const e of valides) {
      if (tags.has(e.tag) || (await tagPris(tournoiId, e.tag))) throw echec(409, 'equipe-tag', `TAG déjà pris dans ce tournoi : ${e.tag}.`);
      tags.add(e.tag);
    }
    const t = iso(maintenant());
    const pos = await base.premier('SELECT MAX(position) AS p FROM tournoi_equipes WHERE tournoi_id = ?', [tournoiId]);
    let p = Number(pos?.p ?? -1);
    for (const e of valides) {
      const id = nouvelId();
      await base.executer('INSERT INTO tournoi_equipes (id, tournoi_id, team_id, nom, tag, ticket_id, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, tournoiId, teamId, e.nom, e.tag, e.ticketId, ++p, t, t]);
      await ecrireMembres(id, e.membres);
    }
    return lire(acteur, teamId, tournoiId);
  }

  async function equipe(tournoiId, equipeId) {
    exigerUuid(equipeId, 'equipe');
    const e = await base.premier('SELECT * FROM tournoi_equipes WHERE id = ? AND tournoi_id = ?', [equipeId, tournoiId]);
    if (!e) throw echec(404, 'equipe-introuvable', 'Équipe introuvable.');
    return e;
  }

  /** Modifie une équipe (nom, TAG, membres remplacés) ; l'attribution du rôle d'un membre inchangé est gardée. */
  async function modifierEquipe(acteur, teamId, tournoiId, equipeId, corps) {
    await contexte(acteur, teamId, tournoiId);
    const e = await equipe(tournoiId, equipeId);
    const v = validerEquipe({ nom: e.nom, tag: e.tag, ...corps, membres: corps?.membres ?? (await equipesDuTournoi(base, tournoiId)).find(x => x.id === equipeId)?.membres ?? [] });
    if (await tagPris(tournoiId, v.tag, equipeId)) throw echec(409, 'equipe-tag', `TAG déjà pris dans ce tournoi : ${v.tag}.`);
    const avant = new Map((await base.tous('SELECT discord_id, role_statut FROM tournoi_equipe_membres WHERE equipe_id = ?', [equipeId])).map(m => [m.discord_id, m.role_statut]));
    await base.executer('UPDATE tournoi_equipes SET nom = ?, tag = ?, maj_le = ? WHERE id = ?', [v.nom, v.tag, iso(maintenant()), equipeId]);
    await ecrireMembres(equipeId, v.membres.map(m => ({ ...m, roleStatut: m.discordId ? (avant.get(m.discordId) ?? null) : null })));
    return lire(acteur, teamId, tournoiId);
  }

  /** Supprime une équipe (son rôle Discord aussi, au mieux). */
  async function supprimerEquipe(acteur, teamId, tournoiId, equipeId) {
    await contexte(acteur, teamId, tournoiId);
    const e = await equipe(tournoiId, equipeId);
    if (e.role_id) {
      const general = await exigerDiscord(acteur);
      await rest(fetchDiscord, jetonBot, 'DELETE', `/guilds/${general.guildId}/roles/${e.role_id}`, undefined, { raison: 'Esport HQ : équipe retirée du tournoi' });
    }
    await base.executer('DELETE FROM tournoi_equipe_membres WHERE equipe_id = ?', [equipeId]);
    await base.executer('DELETE FROM tournoi_equipes WHERE id = ?', [equipeId]);
    return lire(acteur, teamId, tournoiId);
  }

  /**
   * Propositions d'équipes lues dans les tickets d'une catégorie (`categorieId`, sinon celle réglée pour le tournoi) :
   * rien n'est enregistré. Chaque proposition : ticket (numéro, statut), nom, TAG, membres (présents ou non sur le
   * serveur quand le bot peut le vérifier), problèmes, `deja` (ticket ou TAG déjà dans le tournoi).
   */
  async function importer(acteur, teamId, tournoiId, corps) {
    await contexte(acteur, teamId, tournoiId);
    const reglages = await lireReglagesTournoi(base, tournoiId);
    const categorieId = String(corps?.categorieId || reglages.categorieTicketId || '');
    const cat = categorieId ? await base.premier('SELECT id FROM tickets_categories WHERE id = ?', [categorieId]) : null;
    if (!cat) throw echec(400, 'categories', 'Catégorie introuvable.');
    const d = await droitsTickets(base, acteur);
    if (!d.fondateur && !voitCategorie(d, categorieId)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const tickets = await base.tous('SELECT id, numero, statut, auteur_discord_id, auteur_nom, reponses FROM tickets WHERE categorie_id = ? ORDER BY numero LIMIT 200', [categorieId]);
    const deja = await equipesDuTournoi(base, tournoiId);
    const general = await lireGeneral(base);
    const presents = new Map();
    let resolutions = 0;
    const verifier = async id => {
      if (presents.has(id) || !jetonBot || !general.guildId || resolutions >= LIMITES_EQUIPES.resolutions) return presents.get(id);
      resolutions++;
      const r = await rest(fetchDiscord, jetonBot, 'GET', `/guilds/${general.guildId}/members/${id}`);
      const v = r.ok ? { present: true, nom: nomMembre(r.corps) } : r.statut === 404 ? { present: false } : undefined;
      presents.set(id, v);
      return v;
    };
    // Sans Discord ID mais avec un pseudo (« @pseudo ») : recherche d'un membre du serveur au nom EXACT (pseudo, nom
    // affiché ou surnom) ; sinon la ligne reste à corriger dans l'app.
    const rechercher = async nom => {
      if (!nom || !jetonBot || !general.guildId || resolutions >= LIMITES_EQUIPES.resolutions) return null;
      resolutions++;
      const r = await rest(fetchDiscord, jetonBot, 'GET', `/guilds/${general.guildId}/members/search?query=${encodeURIComponent(nom.slice(0, 32))}&limit=5`);
      const exact = (r.ok && Array.isArray(r.corps) ? r.corps : []).filter(x => !x?.user?.bot && [x?.user?.username, x?.user?.global_name, x?.nick].some(v => v && v.toLowerCase() === nom.toLowerCase()));
      return exact.length === 1 ? { id: String(exact[0].user.id), nom: nomMembre(exact[0]) } : null;
    };
    const propositions = [];
    for (const tk of tickets) {
      const lu = lireReponsesInscription(jsonOu(tk.reponses, []));
      const membres = [];
      for (const m of lu.membres) {
        if (!m.discordId) {
          const trouve = await rechercher(m.nom);
          if (trouve) {
            membres.push({ ...m, discordId: trouve.id, nom: m.nom || trouve.nom, present: true, trouveParNom: true });
            continue;
          }
        }
        const v = m.discordId ? await verifier(m.discordId) : undefined;
        membres.push({ ...m, nom: m.nom || v?.nom || '', present: v ? v.present : null });
      }
      if (membres.every(x => x.discordId)) lu.problemes = lu.problemes.filter(p => p !== 'sans_id');
      const problemes = [...lu.problemes, ...(membres.some(m => m.present === false) ? ['absents'] : [])];
      propositions.push({
        ticketId: tk.id,
        numero: Number(tk.numero),
        statut: tk.statut,
        auteur: tk.auteur_nom ?? '',
        nom: lu.nom,
        tag: lu.tag,
        membres,
        problemes,
        deja: deja.some(e => e.ticketId === tk.id || (lu.tag && e.tag === lu.tag)),
      });
    }
    return { categorieId, propositions };
  }

  /**
   * Crée les rôles manquants (un par équipe) et les donne aux membres qui ne l'ont pas encore. Rend le bilan :
   * `{ creees, attribues, absents, sansId, refus, limite, hierarchie }`.
   */
  async function creerRoles(acteur, teamId, tournoiId) {
    await contexte(acteur, teamId, tournoiId);
    const general = await exigerDiscord(acteur);
    const g = general.guildId;
    const reglages = await lireReglagesTournoi(base, tournoiId);
    const bilan = { creees: 0, attribues: 0, absents: [], sansId: [], refus: [], limite: false, hierarchie: null };
    // Hiérarchie : le rôle le plus haut du bot doit dépasser la position 1 (les rôles créés naissent tout en bas).
    const [roles, moiBot] = await Promise.all([rest(fetchDiscord, jetonBot, 'GET', `/guilds/${g}/roles`), rest(fetchDiscord, jetonBot, 'GET', '/users/@me')]);
    const membreBot = moiBot.corps?.id ? await rest(fetchDiscord, jetonBot, 'GET', `/guilds/${g}/members/${moiBot.corps.id}`) : { ok: false };
    if (roles.ok && membreBot.ok) {
      const position = Math.max(0, ...(roles.corps ?? []).filter(r => (membreBot.corps?.roles ?? []).includes(r.id)).map(r => Number(r.position ?? 0)));
      bilan.hierarchie = { positionBot: position, ok: position > 1 };
    }
    const t = iso(maintenant());
    for (const e of await equipesDuTournoi(base, tournoiId)) {
      let roleId = e.roleId;
      if (!roleId) {
        const r = await rest(fetchDiscord, jetonBot, 'POST', `/guilds/${g}/roles`, { name: nomRole(reglages.modeleRole, e), permissions: '0', mentionable: false, hoist: false, ...(reglages.couleur ? { color: Number.parseInt(reglages.couleur.slice(1), 16) } : {}) }, { raison: 'Esport HQ : rôle d’équipe de tournoi' });
        if (r.statut === 429) {
          bilan.limite = true;
          break;
        }
        if (!r.ok || !r.corps?.id) {
          bilan.refus.push({ equipe: `${e.tag} ${e.nom}`, quoi: 'creation', statut: r.statut, code: r.code ?? null });
          continue;
        }
        roleId = String(r.corps.id);
        await base.executer('UPDATE tournoi_equipes SET role_id = ?, maj_le = ? WHERE id = ?', [roleId, t, e.id]);
        bilan.creees++;
      }
      for (const m of e.membres) {
        if (!m.discordId) {
          bilan.sansId.push({ equipe: `${e.tag} ${e.nom}`, nom: m.nom });
          continue;
        }
        if (m.roleStatut === 'attribue') continue;
        const r = await rest(fetchDiscord, jetonBot, 'PUT', `/guilds/${g}/members/${m.discordId}/roles/${roleId}`, undefined, { raison: 'Esport HQ : équipe de tournoi' });
        let statut = null;
        if (r.ok) {
          statut = 'attribue';
          bilan.attribues++;
        } else if (r.statut === 429) {
          bilan.limite = true;
          break;
        } else if (r.code === 10007 || (r.statut === 404 && r.code !== 10011)) {
          statut = 'absent';
          bilan.absents.push({ equipe: `${e.tag} ${e.nom}`, nom: m.nom, discordId: m.discordId });
        } else if (r.code === 10011) {
          // Rôle supprimé à la main sur Discord : oublié, recréé au prochain passage.
          await base.executer('UPDATE tournoi_equipes SET role_id = NULL WHERE id = ?', [e.id]);
          bilan.refus.push({ equipe: `${e.tag} ${e.nom}`, quoi: 'role-disparu', statut: r.statut, code: r.code });
          break;
        } else {
          statut = 'refus';
          bilan.refus.push({ equipe: `${e.tag} ${e.nom}`, quoi: 'attribution', nom: m.nom, statut: r.statut, code: r.code ?? null });
        }
        await base.executer('UPDATE tournoi_equipe_membres SET role_statut = ? WHERE id = ?', [statut, m.id]);
      }
      if (bilan.limite) break;
    }
    await base.executer(
      `INSERT INTO tournoi_discord (tournoi_id, team_id, modele_role, couleur, suppression_h, categorie_ticket_id, roles_crees_le, roles_supprimes_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT (tournoi_id) DO UPDATE SET roles_crees_le = excluded.roles_crees_le, roles_supprimes_le = NULL, maj_le = excluded.maj_le`,
      [tournoiId, teamId, reglages.modeleRole, reglages.couleur, reglages.suppressionH, reglages.categorieTicketId, t, t],
    );
    return { ...(await lire(acteur, teamId, tournoiId)), bilan };
  }

  async function supprimerRoles(acteur, teamId, tournoiId) {
    await contexte(acteur, teamId, tournoiId);
    const general = await exigerDiscord(acteur);
    const r = await nettoyerTournoi({ base, fetch: fetchDiscord, jetonBot, guildId: general.guildId, maintenant }, tournoiId);
    return { ...(await lire(acteur, teamId, tournoiId)), nettoyage: r };
  }

  return { lire, changerReglages, ajouterEquipes, modifierEquipe, supprimerEquipe, importer, creerRoles, supprimerRoles };
}
