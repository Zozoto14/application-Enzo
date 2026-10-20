/**
 * Liaisons du bot Discord, côté app (routes avec session) et côté bot :
 *
 *  - joueur ↔ compte Discord : « Lier mon Discord » (POST /moi/discord/code)
 *    affiche un code à usage unique valable 10 minutes ; le joueur tape
 *    /lier code:XXXX dans Discord ; le serveur enregistre son identifiant
 *    Discord. Délier : DELETE /moi/discord (ou /delier dans Discord).
 *  - serveur Discord ↔ team : « Lier un serveur Discord » (discord.manage)
 *    donne un code ; un admin du serveur tape /esport-lier-serveur code:XXXX.
 *  - réglage des pings par type d'événement, et la liste de qui est lié
 *    (discord.manage : Fondateur, Propriétaire, Manager).
 *
 * On ne garde que l'EMPREINTE des codes (SHA-256) ; un code sert une fois.
 */

import { evenement } from '../../evenements.mjs';
import { echec, iso, sha256Hex } from '../../outils.mjs';
import { TYPES_EVENEMENT } from '../../planning/service.mjs';
import { nomType } from '../embeds.mjs';

export const DUREE_CODE_MS = 10 * 60_000;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Permissions demandées à l'invitation : voir les salons, envoyer, intégrer des liens, mentionner (rôles). */
export const PERMISSIONS_BOT = String(1024 + 2048 + 16384 + 131072);

/** Code lisible de 8 caractères (sans I, L, O, 0, 1), affiché « ABCD-EFGH ». */
export function nouveauCode() {
  const octets = new Uint8Array(16);
  let code = '';
  while (code.length < 8) {
    globalThis.crypto.getRandomValues(octets);
    for (const o of octets) {
      // Rejet : distribution uniforme sur l'alphabet (31 symboles).
      if (o < 248 && code.length < 8) code += ALPHABET[o % ALPHABET.length];
    }
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Saisie normalisée (« abcd efgh », « ABCD-EFGH ») ou null. */
export function lireCode(saisie) {
  const c = String(saisie ?? '').toUpperCase().replace(/[\s-]/g, '');
  return new RegExp(`^[${ALPHABET}]{8}$`).test(c) ? c : null;
}

const empreinte = code => sha256Hex(`esport-discord-code:${code}`);

/** Lien d'invitation du bot (public : l'Application ID n'est pas un secret). */
export function lienInvitation(applicationId) {
  if (!/^\d{5,25}$/.test(String(applicationId ?? ''))) return null;
  return `https://discord.com/oauth2/authorize?client_id=${applicationId}&scope=bot%20applications.commands&permissions=${PERMISSIONS_BOT}`;
}

/** Masque d'un identifiant Discord : « 1234…5678 ». */
export const masquerId = id => (id ? `${String(id).slice(0, 4)}…${String(id).slice(-4)}` : null);

export function servicesLiaisons({ base, maintenant = () => Date.now(), noyau, config = {} }) {
  const botDisponible = Boolean(config.applicationId && config.publicKey);

  async function creerCode(genre, acteur, teamId = null) {
    const code = nouveauCode();
    const t = maintenant();
    await base.lot([
      // Un nouveau code remplace les précédents (non utilisés) du même genre.
      { sql: `DELETE FROM discord_codes WHERE compte_id = ? AND genre = ? AND utilise_le IS NULL AND (team_id = ? OR (team_id IS NULL AND ? IS NULL))`, params: [acteur.compte, genre, teamId, teamId] },
      {
        sql: 'INSERT INTO discord_codes (code_hash, genre, team_id, compte_id, super_admin, expire_le, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)',
        params: [await empreinte(lireCode(code)), genre, teamId, acteur.compte, acteur.superAdmin ? 1 : 0, iso(t + DUREE_CODE_MS), iso(t)],
      },
    ]);
    return { code, expire: iso(t + DUREE_CODE_MS), commande: genre === 'compte' ? `/lier code:${code}` : `/esport-lier-serveur code:${code}` };
  }

  /**
   * Côté bot : consomme un code (usage unique, non expiré, du bon genre).
   * Rend la ligne `{ compte_id, team_id, super_admin }`, ou null.
   */
  async function consommerCode(genre, saisie) {
    const code = lireCode(saisie);
    if (!code) return null;
    const hash = await empreinte(code);
    const t = maintenant();
    const ligne = await base.premier('SELECT * FROM discord_codes WHERE code_hash = ? AND genre = ?', [hash, genre]);
    if (!ligne || ligne.utilise_le || Date.parse(ligne.expire_le) <= t) return null;
    const pris = await base.executer('UPDATE discord_codes SET utilise_le = ? WHERE code_hash = ? AND utilise_le IS NULL', [iso(t), hash]);
    return pris.changements === 1 ? ligne : null;
  }

  // -------------------------------------------------------------- Joueur ↔ Discord

  async function exigerProfil(acteur) {
    if (!(await base.premier('SELECT id FROM comptes WHERE id = ?', [acteur.compte]))) throw echec(428, 'pseudo-requis', 'Choisissez d’abord votre pseudo Esport.');
  }

  async function moiDiscord(acteur) {
    const l = await base.premier('SELECT * FROM discord_comptes WHERE compte_id = ?', [acteur.compte]);
    return { botDisponible, lie: Boolean(l), discordNom: l?.discord_nom || null, lieLe: l?.lie_le ?? null };
  }

  async function codeCompte(acteur) {
    await exigerProfil(acteur);
    if (!botDisponible) throw echec(503, 'bot-absent', 'Le bot Discord n’est pas encore installé sur le serveur Esport (voir docs/esport/bot-discord.md).');
    return creerCode('compte', acteur);
  }

  async function delierCompte(acteur, { origine = 'app' } = {}) {
    const l = await base.premier('SELECT * FROM discord_comptes WHERE compte_id = ?', [acteur.compte]);
    if (!l) return { ok: true, lie: false };
    await base.lot([
      { sql: 'DELETE FROM discord_comptes WHERE compte_id = ?', params: [acteur.compte] },
      evenement('discord.account_unlinked', { acteur: acteur.compte, entiteType: 'compte', entiteId: acteur.compte, charge: { origine }, maintenant: maintenant() }),
    ]);
    return { ok: true, lie: false };
  }

  /** Côté bot : enregistre la liaison (un compte Discord ↔ un compte Esport, l'ancienne est remplacée). */
  async function lierCompte(ligneCode, utilisateur) {
    const t = maintenant();
    const nom = String(utilisateur.global_name || utilisateur.username || '').slice(0, 40);
    await base.lot([
      { sql: 'DELETE FROM discord_comptes WHERE compte_id = ? OR discord_user_id = ?', params: [ligneCode.compte_id, utilisateur.id] },
      {
        sql: 'INSERT INTO discord_comptes (compte_id, discord_user_id, discord_nom, super_admin, lie_le) VALUES (?, ?, ?, ?, ?)',
        params: [ligneCode.compte_id, utilisateur.id, nom, Number(ligneCode.super_admin) === 1 ? 1 : 0, iso(t)],
      },
      evenement('discord.account_linked', { acteur: ligneCode.compte_id, entiteType: 'compte', entiteId: ligneCode.compte_id, charge: { origine: 'discord' }, maintenant: t }),
    ]);
  }

  // -------------------------------------------------------------- Team ↔ serveur

  async function contexteGestion(acteur, teamId) {
    const ctx = await noyau.contexteTeam(acteur, teamId);
    noyau.exiger(ctx, 'discord.manage');
    return ctx;
  }

  async function pings(teamId, langue = 'fr') {
    const lignes = await base.tous('SELECT type_evenement, ping FROM discord_bot_pings WHERE team_id = ?', [teamId]);
    return TYPES_EVENEMENT.map(type => {
      const l = lignes.find(x => x.type_evenement === type);
      return { type, libelle: nomType(type, langue), ping: !l || Number(l.ping) === 1 };
    });
  }

  async function etatTeam(acteur, teamId) {
    await contexteGestion(acteur, teamId);
    const s = await base.premier('SELECT * FROM discord_serveurs WHERE team_id = ?', [teamId]);
    const comptes = await base.tous(
      `SELECT m.compte_id, c.pseudo, r.nom AS role, dc.discord_nom, dc.lie_le FROM membres m
         JOIN comptes c ON c.id = m.compte_id JOIN roles r ON r.id = m.role_id
         LEFT JOIN discord_comptes dc ON dc.compte_id = m.compte_id
        WHERE m.team_id = ? AND m.statut = 'actif' ORDER BY r.position, c.pseudo_cle`,
      [teamId],
    );
    return {
      disponible: botDisponible,
      invitation: botDisponible ? lienInvitation(config.applicationId) : null,
      serveur: s
        ? { serveur: masquerId(s.guild_id), salonNom: s.salon_nom || null, salon: masquerId(s.salon_id), lieLe: s.cree_le, majLe: s.maj_le, dernierSucces: s.dernier_succes_le ?? null, dernierEchec: s.dernier_echec_le ?? null, invalide: Boolean(s.invalide_le) }
        : null,
      pings: await pings(teamId, acteur.langue),
      comptes: comptes.map(l => ({ compte: l.compte_id, pseudo: l.pseudo, role: l.role, lie: Boolean(l.lie_le), discordNom: l.discord_nom || null, lieLe: l.lie_le ?? null })),
    };
  }

  async function codeServeur(acteur, teamId) {
    await contexteGestion(acteur, teamId);
    if (!botDisponible) throw echec(503, 'bot-absent', 'Le bot Discord n’est pas encore installé sur le serveur Esport (voir docs/esport/bot-discord.md).');
    return creerCode('serveur', acteur, teamId);
  }

  async function delierServeur(acteur, teamId) {
    await contexteGestion(acteur, teamId);
    const s = await base.premier('SELECT * FROM discord_serveurs WHERE team_id = ?', [teamId]);
    if (!s) throw echec(404, 'serveur-absent', 'Aucun serveur Discord n’est lié à cette team.');
    const t = maintenant();
    await base.lot([
      { sql: 'DELETE FROM discord_serveurs WHERE team_id = ?', params: [teamId] },
      { sql: 'DELETE FROM discord_annonces WHERE team_id = ?', params: [teamId] },
      { sql: "UPDATE discord_file SET statut = 'abandonne', derniere_erreur = 'Serveur Discord délié', verrou_jusqua = NULL, maj_le = ? WHERE team_id = ? AND canal = 'bot' AND statut = 'attente'", params: [iso(t), teamId] },
      evenement('discord.server_unlinked', { teamId, acteur: acteur.compte, entiteType: 'discord', entiteId: teamId, charge: {}, maintenant: t }),
    ]);
    return { ok: true };
  }

  /** Côté bot : lie la team du code au serveur (et au salon) ; le créateur du code doit toujours gérer Discord. */
  async function lierServeur(ligneCode, { guildId, salonId, salonNom, discordUserId }) {
    const acteur = { compte: ligneCode.compte_id, superAdmin: Number(ligneCode.super_admin) === 1 };
    const ctx = await contexteGestion(acteur, ligneCode.team_id);
    const t = maintenant();
    await base.lot([
      {
        sql: `INSERT INTO discord_serveurs (team_id, guild_id, salon_id, salon_nom, lie_par_discord, lie_par_compte, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (team_id) DO UPDATE SET guild_id = excluded.guild_id, salon_id = excluded.salon_id, salon_nom = excluded.salon_nom, lie_par_discord = excluded.lie_par_discord,
                lie_par_compte = excluded.lie_par_compte, maj_le = excluded.maj_le, bloque_jusqua = NULL, invalide_le = NULL, dernier_echec_le = NULL`,
        params: [ctx.team.id, guildId, salonId, String(salonNom ?? '').slice(0, 100), discordUserId, acteur.compte, iso(t), iso(t)],
      },
      evenement('discord.server_linked', { teamId: ctx.team.id, acteur: acteur.compte, entiteType: 'discord', entiteId: ctx.team.id, charge: { salon: String(salonNom ?? '').slice(0, 100) }, maintenant: t }),
    ]);
    return ctx.team;
  }

  async function changerPing(acteur, teamId, type, corps) {
    await contexteGestion(acteur, teamId);
    if (!TYPES_EVENEMENT.includes(type)) throw echec(404, 'type', 'Type d’événement inconnu.');
    if (typeof corps?.ping !== 'boolean') throw echec(400, 'ping', 'Ping : vrai ou faux.');
    const t = maintenant();
    await base.lot([
      {
        sql: `INSERT INTO discord_bot_pings (team_id, type_evenement, ping, maj_le) VALUES (?, ?, ?, ?)
              ON CONFLICT (team_id, type_evenement) DO UPDATE SET ping = excluded.ping, maj_le = excluded.maj_le`,
        params: [teamId, type, corps.ping ? 1 : 0, iso(t)],
      },
      evenement('discord.pings_changed', { teamId, acteur: acteur.compte, entiteType: 'discord', entiteId: teamId, charge: { type, ping: corps.ping }, maintenant: t }),
    ]);
    return { pings: await pings(teamId, acteur.langue) };
  }

  return { moiDiscord, codeCompte, delierCompte, lierCompte, etatTeam, codeServeur, delierServeur, lierServeur, changerPing, consommerCode };
}

/**
 * Routes de l'app (session déjà vérifiée) :
 *   GET|DELETE /moi/discord            ; POST /moi/discord/code
 *   GET        /teams/:t/discord/bot   ; POST /teams/:t/discord/bot/code ; DELETE /teams/:t/discord/bot/serveur
 *   PUT        /teams/:t/discord/bot/pings/:type   { ping }
 */
export async function routesLiaisons(l, { methode: m, chemin, acteur, lireCorps, limite }) {
  if (chemin === '/moi/discord') {
    if (m === 'GET') return l.moiDiscord(acteur);
    if (m === 'DELETE') return l.delierCompte(acteur);
  }
  if (chemin === '/moi/discord/code' && m === 'POST') {
    await limite('discord_code', acteur.compte);
    return l.codeCompte(acteur);
  }
  const r = /^\/teams\/([^/]+)\/discord\/bot(?:\/([a-z]+)(?:\/([a-z_]+))?)?$/.exec(chemin);
  if (!r) return undefined;
  const [, teamId, section, sousId] = r;
  if (!section && m === 'GET') return l.etatTeam(acteur, teamId);
  if (section === 'code' && !sousId && m === 'POST') {
    await limite('discord_code', acteur.compte);
    return l.codeServeur(acteur, teamId);
  }
  if (section === 'serveur' && !sousId && m === 'DELETE') return l.delierServeur(acteur, teamId);
  if (section === 'pings' && sousId && (m === 'PUT' || m === 'PATCH')) return l.changerPing(acteur, teamId, sousId, await lireCorps());
  throw echec(404, 'route', 'Adresse inconnue.');
}
