/**
 * Administration › Bot Esport HQ : tout ce qui règle le bot Discord du club, réuni sur une page (docs/esport/bot-discord.md,
 * « Administration › Bot Esport HQ »). Ce service LIT les réglages là où ils vivent (aucune copie) :
 *  - connexion : variables du serveur (DISCORD_APPLICATION_ID, clé publique, jeton : présents ou non, jamais leur
 *    valeur), diagnostic de la connexion des tickets (superviseur.mjs), lien d'invitation (permissions-bot.mjs) ;
 *  - serveur Discord du club : celui des tickets (`tickets_reglages.general.guildId`, seule source) ;
 *  - teams : réglages Discord de chaque team (webhook, serveur lié par le bot, langue, fil français, MP) ;
 *  - commandes : celles attendues (commandes.mjs) comparées à celles enregistrées chez Discord, et le
 *    réenregistrement (même appel que esport/outils/discord-commandes.mjs).
 *
 * Droits : le Fondateur, ou `tickets.configurer` (404 sinon). Les lignes des teams : toutes pour le Fondateur, sinon
 * celles où le compte a `discord.manage`. Chaque page d'origine garde ses propres contrôles.
 *
 *   GET  /bot-discord              état complet (sans appel à Discord)
 *   GET  /bot-discord/serveur      vérifier le serveur Discord : permissions du bot qui manquent, par fonctionnalité
 *   GET  /bot-discord/commandes    commandes enregistrées chez Discord comparées à celles attendues
 *   POST /bot-discord/commandes    réenregistrer les commandes (Fondateur ou tickets.configurer)
 */

import { echec } from '../../outils.mjs';
import { droitsTickets } from '../../tickets/acces.mjs';
import { lireCommandes, lireGeneral } from '../../tickets/reglages.mjs';
import { diagnosticConnexion, diagnosticTickets } from '../../tickets/superviseur.mjs';
import { permissionsMembre, rest } from '../../tickets/discord.mjs';
import { lireLangue } from '../../langues.mjs';
import { FONCTIONNALITES_PERMISSIONS, lienInvitationBot, manquantesParFonctionnalite, permissionsInvitation } from '../permissions-bot.mjs';
import { appelEnregistrement, cheminCommandes, comparerCommandes, definitionsCommandes } from './commandes.mjs';

const ID = /^\d{5,25}$/;

/** Description d'une commande ou d'une option dans la langue de l'app (anglais par défaut, français traduit). */
const decrire = (o, langue) => (langue === 'fr' ? (o.description_localizations?.fr ?? o.description) : o.description);

/** Liste lisible des commandes attendues (nom, description, sous-commandes, réservée aux admins du serveur). */
export function listeCommandes(langue = 'fr') {
  return definitionsCommandes().map(c => ({
    nom: c.name,
    description: decrire(c, langue),
    partout: Array.isArray(c.contexts) && c.contexts.includes(1),
    admin: Boolean(c.default_member_permissions),
    sousCommandes: (c.options ?? []).filter(o => o.type === 1).map(o => ({ nom: o.name, description: decrire(o, langue) })),
  }));
}

export function servicesBotAdmin({ base, maintenant = () => Date.now(), fetch: fetchDiscord, jetonBot, config = {}, noyau, serveurTickets = {} }) {
  const applicationId = ID.test(String(config.applicationId ?? '')) ? String(config.applicationId) : '';

  async function acces(acteur) {
    const droits = await droitsTickets(base, acteur);
    if (!droits.fondateur && !droits.configurer) throw echec(404, 'route', 'Adresse inconnue.');
    return droits;
  }

  /** Réglages Discord des teams que l'acteur peut régler (Fondateur : toutes). */
  async function teams(acteur) {
    const lignes = await base.tous('SELECT id, nom, jeu, langue_discord, archivee_le FROM teams WHERE supprimee_le IS NULL ORDER BY nom', []);
    const sortie = [];
    for (const t of lignes) {
      let ctx;
      try {
        ctx = await noyau.contexteTeam(acteur, t.id);
      } catch {
        continue;
      }
      const moduleActif = ctx.modules.has('discord');
      if (!acteur.superAdmin) {
        try {
          noyau.exiger(ctx, 'discord.manage');
        } catch {
          continue;
        }
      }
      const [w, s, bi, mp, n] = await Promise.all([
        base.premier('SELECT invalide_le, dernier_succes_le, dernier_echec_le FROM discord_webhooks WHERE team_id = ?', [t.id]),
        base.premier('SELECT salon_nom, invalide_le, dernier_succes_le FROM discord_serveurs WHERE team_id = ?', [t.id]),
        base.premier('SELECT fil_fr FROM discord_bilingue WHERE team_id = ?', [t.id]),
        base.premier('SELECT relances_mp FROM discord_mp_reglages WHERE team_id = ?', [t.id]),
        base.premier("SELECT COUNT(*) AS n FROM discord_file WHERE team_id = ? AND statut = 'abandonne'", [t.id]),
      ]);
      sortie.push({
        id: t.id,
        nom: t.nom,
        jeu: t.jeu,
        archivee: Boolean(t.archivee_le),
        moduleActif,
        webhook: w ? { invalide: Boolean(w.invalide_le), dernierSucces: w.dernier_succes_le ?? null } : null,
        serveurBot: s ? { salonNom: s.salon_nom || null, invalide: Boolean(s.invalide_le), dernierSucces: s.dernier_succes_le ?? null } : null,
        langue: lireLangue(t.langue_discord) ?? 'fr',
        filFr: !bi || Number(bi.fil_fr) === 1,
        relancesMp: !mp || Number(mp.relances_mp) === 1,
        abandonnes: Number(n?.n ?? 0),
      });
    }
    return sortie;
  }

  async function etat(acteur) {
    const droits = await acces(acteur);
    const general = await lireGeneral(base);
    const t = maintenant();
    const langue = lireLangue(acteur.langue) ?? 'fr';
    return {
      fondateur: Boolean(droits.fondateur),
      bot: { configure: Boolean(applicationId && config.publicKey && jetonBot), applicationId: applicationId || null, clePublique: Boolean(config.publicKey), jeton: Boolean(jetonBot) },
      invitation: lienInvitationBot(applicationId),
      permissions: { entier: permissionsInvitation().toString(), fonctionnalites: FONCTIONNALITES_PERMISSIONS.map(f => ({ id: f.id, permissions: [...f.permissions] })) },
      // Connexion en direct (Gateway) et diagnostic : ceux des tickets (même superviseur).
      tickets: {
        actif: Boolean(general.actif),
        langue: general.langue,
        connexion: general.actif && jetonBot ? await diagnosticConnexion(base, t) : { mode: 'hors_ligne', depuis: null },
        diagnostic: await diagnosticTickets(base, t, { jetonBot, general, serveurTickets }),
        commandes: await lireCommandes(base),
      },
      // Serveur Discord du club : un seul réglage, celui des tickets (Tickets › Configuration › Général).
      serveur: general.guildId ? { id: general.guildId, nom: general.guildNom ?? '' } : null,
      teams: await teams(acteur),
      commandes: listeCommandes(langue),
    };
  }

  /** Vérifier le serveur Discord du club : présence du bot et permissions qui manquent, par fonctionnalité. */
  async function verifierServeur(acteur) {
    await acces(acteur);
    if (!jetonBot) return { bot: false };
    const general = await lireGeneral(base);
    if (!general.guildId) return { bot: true, serveur: null };
    const guildId = general.guildId;
    const serveur = { id: guildId, nom: general.guildNom ?? '' };
    const serveurs = await rest(fetchDiscord, jetonBot, 'GET', '/users/@me/guilds');
    if (!serveurs.ok) return { bot: true, serveur, erreur: `discord-${serveurs.statut}` };
    if (!(Array.isArray(serveurs.corps) ? serveurs.corps : []).some(g => String(g.id) === guildId)) return { bot: true, serveur, erreur: 'bot-absent' };
    const [roles, moiBot] = await Promise.all([rest(fetchDiscord, jetonBot, 'GET', `/guilds/${guildId}/roles`), rest(fetchDiscord, jetonBot, 'GET', '/users/@me')]);
    if (!roles.ok) return { bot: true, serveur, erreur: `discord-${roles.statut}` };
    const botId = moiBot.corps?.id ?? applicationId;
    const membre = await rest(fetchDiscord, jetonBot, 'GET', `/guilds/${guildId}/members/${botId}`);
    const p = permissionsMembre({ guildId, roles: roles.corps, membreRoles: membre.ok ? (membre.corps?.roles ?? []) : [], salon: null, membreId: botId });
    const fonctionnalites = manquantesParFonctionnalite(p);
    return { bot: true, serveur, erreur: null, membreTrouve: membre.ok, fonctionnalites, complet: fonctionnalites.every(f => !f.manquantes.length) };
  }

  /** Commandes enregistrées chez Discord (globales, comme le script) comparées à celles attendues. */
  async function commandes(acteur) {
    await acces(acteur);
    const attendues = definitionsCommandes().map(c => c.name);
    if (!applicationId || !jetonBot) return { bot: false, attendues, enregistrees: null };
    const r = await rest(fetchDiscord, jetonBot, 'GET', `${cheminCommandes(applicationId)}?with_localizations=true`);
    if (!r.ok) return { bot: true, attendues, enregistrees: null, erreur: `discord-${r.statut}` };
    const lues = Array.isArray(r.corps) ? r.corps : [];
    return { bot: true, attendues, enregistrees: lues.map(c => String(c.name)), ...comparerCommandes(lues), erreur: null };
  }

  /** Réenregistrer les commandes (même appel que esport/outils/discord-commandes.mjs). */
  async function reenregistrer(acteur) {
    await acces(acteur);
    if (!applicationId || !jetonBot) throw echec(503, 'bot-absent', 'Le bot Discord n’est pas encore installé sur le serveur Esport (voir docs/esport/bot-discord.md).');
    const a = appelEnregistrement(applicationId);
    const r = await rest(fetchDiscord, jetonBot, a.methode, a.chemin, a.corps);
    if (!r.ok) throw echec(502, 'discord', `Discord a refusé l’enregistrement des commandes (HTTP ${r.statut}${r.code ? `, code ${r.code}` : ''}).`);
    return { ok: true, n: a.corps.length, ...(await commandes(acteur)) };
  }

  return { etat, verifierServeur, commandes, reenregistrer };
}

export async function routesBotAdmin(ba, { acteur, chemin, methode: m, limite }) {
  if (chemin !== '/bot-discord' && !chemin.startsWith('/bot-discord/')) return undefined;
  if (chemin === '/bot-discord' && m === 'GET') return ba.etat(acteur);
  if (chemin === '/bot-discord/serveur' && m === 'GET') {
    await limite('tickets_discord', acteur.compte);
    return ba.verifierServeur(acteur);
  }
  if (chemin === '/bot-discord/commandes') {
    if (m === 'GET') {
      await limite('tickets_discord', acteur.compte);
      return ba.commandes(acteur);
    }
    if (m === 'POST') {
      await limite('tickets_discord', acteur.compte);
      return ba.reenregistrer(acteur);
    }
  }
  throw echec(404, 'route', 'Adresse inconnue.');
}
