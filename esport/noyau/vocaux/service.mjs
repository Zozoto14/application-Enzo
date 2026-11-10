/**
 * Salons vocaux temporaires : services de l'app (Administration › Bot Esport HQ › Fonctionnalités). Documentation : docs/esport/vocaux.md.
 *
 * Journal : l'événement `tickets.config_modifiee` (clé `vocaux` ou `vocaux_commandes`), comme les autres réglages du bot.
 * Permission du club `vocaux.configurer` (le Fondateur l'a d'office) : lire et changer les réglages, voir les salons
 * temporaires ouverts et l'état de la connexion. Le serveur Discord est celui des tickets (Tickets › Configuration ›
 * Général) ; les arrivées dans un hub ne sont vues que par la connexion EN DIRECT (Gateway) : en relecture de secours,
 * l'écran le dit.
 */

import { echec, iso } from '../outils.mjs';
import { evenement } from '../evenements.mjs';
import { aGlobale } from '../roles/globales.mjs';
import { instructionReglage, lireGeneral } from '../tickets/reglages.mjs';
import { diagnosticConnexion } from '../tickets/superviseur.mjs';
import { permissionsMembre, rest } from '../tickets/discord.mjs';
import { FONCTIONNALITES_PERMISSIONS, entierPermissions, lienInvitationBot } from '../discord/permissions-bot.mjs';
import { COMMANDES_VOCAUX, LIMITES_VOCAUX, MODELE_DEFAUT, MODELE_TOURNOI_DEFAUT, MODES_PROPRIETAIRE, lireCommandesVocaux, lireVocaux, validerCommandesVocaux, validerVocaux } from './reglages.mjs';
import { lireEtatVocaux } from './moteur.mjs';
import { salonsDuServeur } from './salons.mjs';

export const PERMISSION_VOCAUX = 'vocaux.configurer';
/** Permissions du bot nécessaires aux salons vocaux temporaires : celles de la liste centrale (discord/permissions-bot.mjs). */
export const PERMISSIONS_VOCAUX = Object.freeze(FONCTIONNALITES_PERMISSIONS.find(f => f.id === 'vocaux').permissions);
const manquantesVocaux = p => PERMISSIONS_VOCAUX.filter(cle => (p & entierPermissions([cle])) === 0n);

export function servicesVocaux({ base, maintenant = () => Date.now(), fetch: fetchDiscord, jetonBot, applicationId = '', serveurTickets = {} }) {
  async function exiger(acteur) {
    if (!(await aGlobale(base, acteur, PERMISSION_VOCAUX))) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
  }

  async function config(acteur) {
    await exiger(acteur);
    const general = await lireGeneral(base);
    const reglages = await lireVocaux(base);
    const t = maintenant();
    const salons = general.guildId ? await salonsDuServeur(base, general.guildId) : [];
    return {
      reglages,
      commandes: await lireCommandesVocaux(base),
      serveur: general.guildId ? { id: general.guildId, nom: general.guildNom ?? '' } : null,
      // Connexion Discord (tenue par le superviseur des tickets) : les salons temporaires exigent le mode « direct ».
      connexion: jetonBot && (general.actif || reglages.actif) ? await diagnosticConnexion(base, t) : { mode: 'hors_ligne', depuis: null },
      gatewayActivee: serveurTickets.gateway !== false,
      etat: await lireEtatVocaux(base),
      salons: salons.map(s => ({ id: s.salonId, nom: s.nom, hubId: s.hubId, proprietaireId: s.proprietaireId, proprietaireNom: s.proprietaireNom, verrouille: s.verrouille, limite: s.limite, presents: s.occupants.length, amis: s.amis.length, tournoiId: s.tournoiId, equipeId: s.equipeId, videDepuis: s.videDepuis, creeLe: s.creeLe })),
      choix: { commandes: COMMANDES_VOCAUX, modesProprietaire: MODES_PROPRIETAIRE, limites: LIMITES_VOCAUX, modeleDefaut: MODELE_DEFAUT, modeleTournoiDefaut: MODELE_TOURNOI_DEFAUT, permissionsBot: [...PERMISSIONS_VOCAUX] },
      bot: Boolean(jetonBot),
      lienInvitation: lienInvitationBot(applicationId),
      // Événements du club proposés pour un hub d'équipe (Administration › Événements) : ceux qui ne sont ni terminés ni
      // annulés, plus ceux déjà liés à un hub. Clé `tournoiId` du hub : l'identifiant de l'événement. `peutGererEvenements` :
      // l'écran propose d'aller créer un événement (Administration › Événements).
      evenements: (
        await base.tous(
          `SELECT id, nom, statut, debut, (SELECT COUNT(*) FROM club_evenement_equipes e WHERE e.evenement_id = club_evenements.id) AS equipes FROM club_evenements
            WHERE statut NOT IN ('termine', 'annule')${reglages.hubs.some(h => h.tournoiId) ? ` OR id IN (${reglages.hubs.filter(h => h.tournoiId).map(() => '?').join(', ')})` : ''}
            ORDER BY COALESCE(debut, cree_le) DESC, nom LIMIT 50`,
          reglages.hubs.filter(h => h.tournoiId).map(h => h.tournoiId),
        )
      ).map(e => ({ id: e.id, nom: e.nom, statut: e.statut, debut: e.debut ?? null, equipes: Number(e.equipes ?? 0) })),
      peutGererEvenements: await aGlobale(base, acteur, 'evenements.gerer'),
    };
  }

  async function changer(acteur, corps) {
    await exiger(acteur);
    const general = await lireGeneral(base);
    const reglages = validerVocaux(corps ?? {}, await lireVocaux(base));
    if (reglages.actif && !general.guildId) throw echec(400, 'vocaux-serveur', 'Choisissez d’abord le serveur Discord (Tickets › Configuration › Général).');
    for (const h of reglages.hubs) {
      if (h.tournoiId && !(await base.premier('SELECT id FROM club_evenements WHERE id = ?', [h.tournoiId]))) throw echec(400, 'vocaux-tournoi', 'Événement introuvable (Administration › Événements).');
    }
    const t = maintenant();
    await base.lot([instructionReglage('vocaux', reglages, acteur.compte, t), evenement('tickets.config_modifiee', { acteur: acteur.compte, entiteType: 'tickets', entiteId: 'vocaux', charge: { cle: 'vocaux' }, maintenant: t })]);
    return config(acteur);
  }

  async function changerCommandes(acteur, corps) {
    await exiger(acteur);
    const t = maintenant();
    await base.lot([instructionReglage('vocaux_commandes', { ...(await lireCommandesVocaux(base)), ...validerCommandesVocaux(corps) }, acteur.compte, t), evenement('tickets.config_modifiee', { acteur: acteur.compte, entiteType: 'tickets', entiteId: 'vocaux_commandes', charge: { cle: 'vocaux_commandes' }, maintenant: t })]);
    return config(acteur);
  }

  /**
   * Ce que l'écran propose du serveur Discord des tickets : salons vocaux (hubs), catégories, salons écrits (journaux),
   * rôles (staff), et permissions du bot (serveur, puis chaque hub), avec ce qui manque. Erreur Discord : `erreur`.
   */
  async function discord(acteur) {
    await exiger(acteur);
    if (!jetonBot) return { bot: false };
    const general = await lireGeneral(base);
    if (!general.guildId) return { bot: true, erreur: 'sans-serveur' };
    const guildId = general.guildId;
    const [salons, roles, moiBot] = await Promise.all([rest(fetchDiscord, jetonBot, 'GET', `/guilds/${guildId}/channels`), rest(fetchDiscord, jetonBot, 'GET', `/guilds/${guildId}/roles`), rest(fetchDiscord, jetonBot, 'GET', '/users/@me')]);
    if (!salons.ok) return { bot: true, erreur: `discord-${salons.statut}` };
    if (!roles.ok) return { bot: true, erreur: `discord-${roles.statut}` };
    const botId = moiBot.corps?.id ?? applicationId;
    const membre = await rest(fetchDiscord, jetonBot, 'GET', `/guilds/${guildId}/members/${botId}`);
    const rolesBot = membre.ok ? (membre.corps?.roles ?? []) : [];
    const liste = Array.isArray(salons.corps) ? salons.corps : [];
    const perm = salon => permissionsMembre({ guildId, roles: roles.corps, membreRoles: rolesBot, salon, membreId: botId });
    const reglages = await lireVocaux(base);
    const positionBot = Math.max(0, ...(roles.corps ?? []).filter(r => rolesBot.includes(r.id)).map(r => Number(r.position ?? 0)));
    const genre = s => (Number(s.type) === 2 ? 'vocal' : Number(s.type) === 4 ? 'categorie' : [0, 5].includes(Number(s.type)) ? 'texte' : null);
    return {
      bot: true,
      erreur: null,
      serveur: { id: guildId, nom: general.guildNom ?? '' },
      salons: liste
        .filter(s => genre(s))
        .map(s => ({ id: String(s.id), nom: String(s.name ?? ''), type: genre(s), parent: s.parent_id ?? null, position: Number(s.position ?? 0) }))
        .sort((a, b) => a.position - b.position),
      roles: (Array.isArray(roles.corps) ? roles.corps : []).filter(r => r.id !== guildId && !r.managed).map(r => ({ id: r.id, nom: String(r.name ?? ''), couleur: Number(r.color) ? `#${Number(r.color).toString(16).padStart(6, '0')}` : null, position: Number(r.position ?? 0) })).sort((a, b) => b.position - a.position),
      positionBot,
      permissions: {
        membreTrouve: membre.ok,
        serveur: manquantesVocaux(perm(null)),
        hubs: reglages.hubs.map(h => {
          const s = liste.find(x => String(x.id) === h.id);
          return s ? { id: h.id, nom: String(s.name ?? ''), manquantes: manquantesVocaux(perm(s)) } : { id: h.id, introuvable: true, manquantes: [] };
        }),
      },
      le: iso(maintenant()),
    };
  }

  return { config, changer, changerCommandes, discord, exiger };
}
