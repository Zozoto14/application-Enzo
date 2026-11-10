/**
 * Rôles temporaires : services de l'app (docs/esport/bot-discord.md, « Rôles temporaires »).
 *
 * Par team (page de la team › Discord pour les réglages, › Membres et rôles pour la liste) :
 *   - RÉGLAGES : permission `discord.manage` (module Discord activé) ou Fondateur ;
 *   - USAGE (liste des rôles actifs, donner, prolonger, retirer, recherche d'une personne) : les rôles de la team
 *     autorisés dans les réglages (Coach, Manager et Propriétaire par défaut), ou le Fondateur. Aucune permission
 *     nouvelle : l'autorisation est un réglage de la team.
 * Club (Administration › Bot Esport HQ › Fonctionnalités › Rôles temporaires) : vue d'ensemble des teams et commandes
 * /role-temp activées (Fondateur, `tickets.configurer` ou `vocaux.configurer`, comme le reste de l'onglet).
 *
 * Journal : `tickets.config_modifiee` n'est pas réutilisé ; les réglages et octrois laissent `discord.role_temp_given`
 * et `discord.role_temp_removed` (journal d'activité de la team).
 */

import { echec, iso } from '../outils.mjs';
import { evenement } from '../evenements.mjs';
import { aGlobale } from '../roles/globales.mjs';
import { droitsTickets } from '../tickets/acces.mjs';
import { instructionReglage, lireGeneral } from '../tickets/reglages.mjs';
import { P, idDiscord, permissionsMembre, rest } from '../tickets/discord.mjs';
import { lienInvitationBot } from '../discord/permissions-bot.mjs';
import { COMMANDES_ROLES_TEMP, LIMITES_ROLES_TEMP, ROLES_PAR_DEFAUT, guildDeEquipe, instructionReglagesEquipe, lireCommandesRolesTemp, lireReglagesEquipe, rolesAutorisesDeEquipe, validerCommandesRolesTemp, validerReglagesEquipe } from './reglages.mjs';
import { RefusRoleTemp, donnerRoleTemp, octroiParId, octroisActifs, prolongerRoleTemp, retirerRoleTemp } from './moteur.mjs';
import { tr } from './textes.mjs';

const H = 3_600_000;

/** Refus du moteur → erreur HTTP lisible dans la langue de l'acteur. */
function enErreur(e, langue) {
  if (!(e instanceof RefusRoleTemp)) return e;
  const statut = ['limite', 'discord_injoignable'].includes(e.cle) ? 503 : ['membre_absent', 'role_introuvable'].includes(e.cle) ? 404 : ['max_atteint', 'duree_hors_limites', 'duree_invalide', 'non_configure'].includes(e.cle) ? 400 : 502;
  const err = echec(statut, `roles-temp-${e.cle.replace(/_/g, '-')}`, tr(langue === 'fr' ? 'fr' : 'en', e.cle, e.vars));
  err.details = { cle: e.cle, ...e.vars };
  return err;
}

export function servicesRolesTemp({ base, maintenant = () => Date.now(), noyau, fetch: fetchDiscord, jetonBot, applicationId = '', botId = null }) {
  const ctxMoteur = () => ({ base, fetch: fetchDiscord, jetonBot, maintenant, botId: botId ?? applicationId ?? null });

  // ---------------------------------------------------------------- Droits

  async function peutRegler(ctx) {
    if (ctx.acteur.superAdmin) return true;
    try {
      noyau.exiger(ctx, 'discord.manage');
      return true;
    } catch {
      return false;
    }
  }

  /** Droits de l'acteur dans une team : { ctx, reglages, regler, gerer }. */
  async function droits(acteur, teamId) {
    const ctx = await noyau.contexteTeam(acteur, teamId);
    const reglages = await lireReglagesEquipe(base, teamId);
    const regler = await peutRegler(ctx);
    const gerer = acteur.superAdmin || (ctx.membre?.statut === 'actif' && (await rolesAutorisesDeEquipe(base, teamId, reglages)).has(ctx.membre.role_id));
    return { ctx, reglages, regler, gerer: Boolean(gerer) };
  }

  const exigerGerer = async (acteur, teamId) => {
    const d = await droits(acteur, teamId);
    if (!d.gerer) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    return d;
  };
  const exigerRegler = async (acteur, teamId) => {
    const d = await droits(acteur, teamId);
    if (!d.regler) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    return d;
  };

  async function par(acteur) {
    const c = await base.premier('SELECT pseudo FROM comptes WHERE id = ?', [acteur.compte]);
    const l = await base.premier('SELECT discord_user_id FROM discord_comptes WHERE compte_id = ?', [acteur.compte]);
    return { compte: acteur.compte, discordId: l?.discord_user_id ?? null, nom: c?.pseudo ?? '' };
  }

  // ---------------------------------------------------------------- Lecture

  const publicOctroi = o => ({ id: o.id, roleNom: o.roleNom, membreId: o.membreId, membreNom: o.membreNom, accordeParNom: o.accordeParNom, raison: o.raison, accordeLe: o.accordeLe, expireLe: o.expireLe, essais: o.essais, erreur: o.erreur });

  async function rolesDeEquipe(teamId) {
    return (await base.tous('SELECT id, nom, cle_systeme FROM roles WHERE team_id = ? ORDER BY position, nom', [teamId])).map(r => ({ id: r.id, nom: r.nom, cle: r.cle_systeme ?? null, defaut: ROLES_PAR_DEFAUT.includes(r.cle_systeme) }));
  }

  /** Page d'une team : réglages (si on peut les voir), octrois actifs, droits de l'acteur. */
  async function etat(acteur, teamId) {
    const d = await droits(acteur, teamId);
    if (!d.regler && !d.gerer) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const general = await lireGeneral(base);
    const guildId = await guildDeEquipe(base, teamId, general);
    const actifs = d.gerer || d.regler ? (await octroisActifs(base, teamId)).map(publicOctroi) : [];
    return {
      peutRegler: d.regler,
      peutGerer: d.gerer,
      // Les réglages ne sont donnés qu'à qui peut les régler ; qui peut seulement donner le rôle voit le strict nécessaire.
      reglages: d.regler ? d.reglages : { actif: d.reglages.actif, roleNom: d.reglages.roleNom, dureeDefautH: d.reglages.dureeDefautH, maxSimultanes: d.reglages.maxSimultanes },
      rolesEquipe: d.regler ? await rolesDeEquipe(teamId) : [],
      actifs,
      serveur: guildId ? { id: guildId, nom: general.guildId === guildId ? (general.guildNom ?? '') : '' } : null,
      bot: Boolean(jetonBot),
      limites: LIMITES_ROLES_TEMP,
      lienInvitation: lienInvitationBot(applicationId),
    };
  }

  /**
   * Rôles et salons du serveur Discord de la team, position et permissions du bot : pour choisir le rôle temporaire (et
   * le salon des journaux), et prévenir quand le rôle du bot est sous le rôle choisi. Erreur Discord : `erreur`.
   */
  async function lireServeur(guildId) {
    if (!jetonBot) return { bot: false };
    if (!guildId) return { bot: true, erreur: 'sans-serveur' };
    const [roles, salons, moi] = await Promise.all([rest(fetchDiscord, jetonBot, 'GET', `/guilds/${guildId}/roles`), rest(fetchDiscord, jetonBot, 'GET', `/guilds/${guildId}/channels`), rest(fetchDiscord, jetonBot, 'GET', '/users/@me')]);
    if (!roles.ok) return { bot: true, erreur: `discord-${roles.statut}` };
    const idBot = moi.corps?.id ?? applicationId;
    const membre = await rest(fetchDiscord, jetonBot, 'GET', `/guilds/${guildId}/members/${idBot}`);
    const rolesBot = membre.ok ? (membre.corps?.roles ?? []) : [];
    const liste = Array.isArray(roles.corps) ? roles.corps : [];
    const plusHaut = liste.filter(r => rolesBot.includes(r.id)).sort((a, b) => Number(b.position ?? 0) - Number(a.position ?? 0))[0];
    const perms = permissionsMembre({ guildId, roles: liste, membreRoles: rolesBot, salon: null, membreId: idBot });
    return {
      bot: true,
      erreur: null,
      membreTrouve: membre.ok,
      gererRoles: (perms & P.GERER_ROLES) === P.GERER_ROLES,
      positionBot: Number(plusHaut?.position ?? 0),
      roleBot: plusHaut ? String(plusHaut.name ?? '') : '',
      // Rôles donnables : ni @everyone ni les rôles gérés par une intégration (Discord refuse de les donner).
      roles: liste
        .filter(r => r.id !== guildId && !r.managed)
        .map(r => ({ id: r.id, nom: String(r.name ?? ''), couleur: Number(r.color) ? `#${Number(r.color).toString(16).padStart(6, '0')}` : null, position: Number(r.position ?? 0) }))
        .sort((a, b) => b.position - a.position),
      salons: (Array.isArray(salons.corps) ? salons.corps : [])
        .filter(s => [0, 5].includes(Number(s.type)))
        .map(s => ({ id: String(s.id), nom: String(s.name ?? ''), position: Number(s.position ?? 0) }))
        .sort((a, b) => a.position - b.position),
      le: iso(maintenant()),
    };
  }

  async function discord(acteur, teamId) {
    const d = await droits(acteur, teamId);
    if (!d.regler && !d.gerer) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    return lireServeur(await guildDeEquipe(base, teamId));
  }

  // ---------------------------------------------------------------- Réglages

  async function changerReglages(acteur, teamId, corps) {
    const d = await exigerRegler(acteur, teamId);
    const s = validerReglagesEquipe(corps ?? {}, d.reglages);
    // Rôles de la team autorisés : ceux de CETTE team.
    if (s.rolesAutorises.length) {
      const ids = new Set((await rolesDeEquipe(teamId)).map(r => r.id));
      if (s.rolesAutorises.some(x => !ids.has(x))) throw echec(400, 'roles-temp-autorises', 'Un des rôles choisis n’appartient pas à cette team.');
    }
    // Le rôle Discord doit exister (son nom, affiché tel quel, est celui de Discord) ; un rôle géré ne peut pas être donné.
    let avertissement = null;
    if (s.roleId) {
      const srv = await lireServeur(await guildDeEquipe(base, teamId));
      if (srv.bot && !srv.erreur) {
        const role = srv.roles.find(r => r.id === s.roleId);
        if (!role) throw echec(400, 'roles-temp-role', 'Ce rôle n’existe pas (ou n’est pas donnable) sur le serveur Discord.');
        s.roleNom = role.nom;
        if (role.position >= srv.positionBot) avertissement = 'hierarchie';
        else if (!srv.gererRoles) avertissement = 'gerer_roles';
      }
    }
    const t = maintenant();
    await base.lot([instructionReglagesEquipe(teamId, s, acteur.compte, t)]);
    return { ...(await etat(acteur, teamId)), avertissement };
  }

  // ---------------------------------------------------------------- Octrois

  async function membres(acteur, teamId, requete) {
    await exigerGerer(acteur, teamId);
    const guildId = await guildDeEquipe(base, teamId);
    const q = String(requete ?? '').trim().slice(0, 32);
    if (!jetonBot || !guildId || q.length < 1) return { membres: [] };
    const r = await rest(fetchDiscord, jetonBot, 'GET', `/guilds/${guildId}/members/search?query=${encodeURIComponent(q)}&limit=10`);
    if (!r.ok) throw echec(502, 'discord', `Discord a refusé la recherche (HTTP ${r.statut}).`);
    return { membres: (Array.isArray(r.corps) ? r.corps : []).filter(m => m?.user?.id && !m.user.bot).map(m => ({ id: String(m.user.id), nom: String(m.nick || m.user.global_name || m.user.username || m.user.id).slice(0, 100), pseudo: String(m.user.username ?? '') })) };
  }

  async function donner(acteur, teamId, corps) {
    const d = await exigerGerer(acteur, teamId);
    const langue = acteur.langue ?? 'fr';
    const membreId = idDiscord(corps?.membreId);
    if (!membreId) throw echec(400, 'membre', 'Choisissez une personne du serveur Discord.');
    const dureeH = corps?.dureeH === undefined || corps?.dureeH === null || corps?.dureeH === '' ? d.reglages.dureeDefautH : Number(corps.dureeH);
    if (!Number.isFinite(dureeH)) throw echec(400, 'duree', 'Durée invalide.');
    try {
      const r = await donnerRoleTemp(ctxMoteur(), { teamId, membreId, membreNom: typeof corps?.membreNom === 'string' ? corps.membreNom : '', dureeMs: dureeH * H, raison: typeof corps?.raison === 'string' ? corps.raison : '', par: await par(acteur), langue });
      return { ok: true, prolonge: r.prolonge, octroi: publicOctroi(r.octroi) };
    } catch (e) {
      throw enErreur(e, langue);
    }
  }

  async function prolonger(acteur, teamId, id, corps) {
    const d = await exigerGerer(acteur, teamId);
    const langue = acteur.langue ?? 'fr';
    const dureeH = corps?.dureeH === undefined || corps?.dureeH === null || corps?.dureeH === '' ? d.reglages.dureeDefautH : Number(corps.dureeH);
    if (!Number.isFinite(dureeH)) throw echec(400, 'duree', 'Durée invalide.');
    try {
      return { ok: true, octroi: publicOctroi(await prolongerRoleTemp(ctxMoteur(), id, { teamId, dureeMs: dureeH * H, par: await par(acteur), langue })) };
    } catch (e) {
      throw enErreur(e, langue);
    }
  }

  async function retirer(acteur, teamId, id) {
    await exigerGerer(acteur, teamId);
    const langue = acteur.langue ?? 'fr';
    const o = await octroiParId(base, teamId, id);
    if (!o || o.statut !== 'actif') throw echec(404, 'octroi', 'Rôle temporaire introuvable ou déjà terminé.');
    try {
      const r = await retirerRoleTemp(ctxMoteur(), o, { par: await par(acteur), langue });
      return { ok: true, deja: r.deja };
    } catch (e) {
      throw enErreur(e, langue);
    }
  }

  // ---------------------------------------------------------------- Club (Administration › Bot Esport HQ)

  async function accesBot(acteur) {
    const droitsT = await droitsTickets(base, acteur);
    if (!droitsT.fondateur && !droitsT.configurer && !(await aGlobale(base, acteur, 'vocaux.configurer'))) throw echec(404, 'route', 'Adresse inconnue.');
    return droitsT;
  }

  /** Vue d'ensemble : une ligne par team (réglage, rôle, durée, octrois actifs) et les commandes /role-temp. */
  async function config(acteur) {
    await accesBot(acteur);
    const equipes = [];
    for (const t of await base.tous('SELECT id, nom, jeu FROM teams WHERE supprimee_le IS NULL AND archivee_le IS NULL ORDER BY nom', [])) {
      const r = await lireReglagesEquipe(base, t.id);
      const n = Number((await base.premier("SELECT COUNT(*) AS n FROM roles_temp_octrois WHERE team_id = ? AND statut = 'actif'", [t.id]))?.n ?? 0);
      equipes.push({ id: t.id, nom: t.nom, jeu: t.jeu, actif: r.actif, roleNom: r.roleNom, dureeDefautH: r.dureeDefautH, maxSimultanes: r.maxSimultanes, actifs: n });
    }
    const general = await lireGeneral(base);
    return {
      equipes,
      commandes: await lireCommandesRolesTemp(base),
      serveur: general.guildId ? { id: general.guildId, nom: general.guildNom ?? '' } : null,
      bot: Boolean(jetonBot),
      choix: { commandes: [...COMMANDES_ROLES_TEMP], limites: LIMITES_ROLES_TEMP },
      lienInvitation: lienInvitationBot(applicationId),
    };
  }

  async function changerCommandes(acteur, corps) {
    await accesBot(acteur);
    const t = maintenant();
    await base.lot([instructionReglage('roles_temp_commandes', { ...(await lireCommandesRolesTemp(base)), ...validerCommandesRolesTemp(corps) }, acteur.compte, t), evenement('tickets.config_modifiee', { acteur: acteur.compte, entiteType: 'tickets', entiteId: 'roles_temp_commandes', charge: { cle: 'roles_temp_commandes' }, maintenant: t })]);
    return config(acteur);
  }

  /** Rôles du serveur du club (pour réserver une commande à des rôles Discord). */
  async function discordClub(acteur) {
    await accesBot(acteur);
    return lireServeur((await lireGeneral(base)).guildId);
  }

  return { etat, discord, changerReglages, membres, donner, prolonger, retirer, config, changerCommandes, discordClub };
}
