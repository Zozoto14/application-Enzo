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
const PERMISSION_EVENEMENTS = 'evenements.gerer';
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
          `SELECT id, nom, statut, debut, staff_role_id, staff_role_nom, (SELECT COUNT(*) FROM club_evenement_equipes e WHERE e.evenement_id = club_evenements.id) AS equipes FROM club_evenements
            WHERE statut NOT IN ('termine', 'annule')${reglages.hubs.some(h => h.tournoiId) ? ` OR id IN (${reglages.hubs.filter(h => h.tournoiId).map(() => '?').join(', ')})` : ''}
            ORDER BY COALESCE(debut, cree_le) DESC, nom LIMIT 50`,
          reglages.hubs.filter(h => h.tournoiId).map(h => h.tournoiId),
        )
      ).map(e => ({ id: e.id, nom: e.nom, statut: e.statut, debut: e.debut ?? null, equipes: Number(e.equipes ?? 0), staffRole: e.staff_role_id ? { id: e.staff_role_id, nom: e.staff_role_nom ?? '' } : null })),
      peutGererEvenements: await aGlobale(base, acteur, 'evenements.gerer'),
    };
  }

  async function changer(acteur, corps) {
    await exiger(acteur);
    const general = await lireGeneral(base);
    const actuel = await lireVocaux(base);
    // Hubs d'événement : créés et modifiés SEULEMENT dans Administration › Événements › (événement) › « Vocaux de
    // l'événement ». Cet écran ne gère que les hubs ordinaires : ceux des événements sont gardés tels qu'enregistrés
    // (même absents du corps, ou renvoyés par une copie ancienne), et un hub d'événement inconnu est refusé.
    const hubsEvt = actuel.hubs.filter(h => h.tournoiId);
    let c = corps ?? {};
    if (Array.isArray(c.hubs)) {
      if (c.hubs.some(h => h && h.tournoiId && !hubsEvt.some(x => x.id === h.id && x.tournoiId === h.tournoiId))) throw echec(400, 'vocaux-hub-evenement', 'Les hubs d’événement se créent dans Administration › Événements (section « Vocaux de l’événement » de l’événement).');
      const ordinaires = c.hubs.filter(h => !(h && h.tournoiId));
      if (ordinaires.length + hubsEvt.length > LIMITES_VOCAUX.hubs) throw echec(400, 'vocaux-hub', '10 hubs au plus.');
      c = { ...c, hubs: [...ordinaires, ...hubsEvt] };
    }
    const reglages = validerVocaux(c, actuel);
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

  // ---------------------------------------------------------------- Vocaux d'un événement (Administration › Événements)
  //
  // La fiche d'un événement édite directement SES hubs (ceux dont `tournoiId` est l'événement), dans les mêmes réglages
  // (`tickets_reglages`, clé `vocaux`) : aucune deuxième source. Lire : `evenements.gerer` (la page) ; créer, modifier,
  // retirer : en plus `vocaux.configurer` (mêmes droits qu'aujourd'hui pour les réglages des salons vocaux). Un hub
  // d'événement est toujours verrouillé (sur le rôle de l'équipe) ; le rôle staff de l'événement y entre d'office.

  async function evenementDe(acteur, evenementId) {
    if (!(await aGlobale(base, acteur, PERMISSION_EVENEMENTS))) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const evt = typeof evenementId === 'string' && /^[0-9a-f-]{36}$/.test(evenementId) ? await base.premier('SELECT id, nom, staff_role_id, staff_role_nom FROM club_evenements WHERE id = ?', [evenementId]) : null;
    if (!evt) throw echec(404, 'evenement-introuvable', 'Événement introuvable.');
    return evt;
  }

  async function hubsEvenement(acteur, evenementId) {
    const evt = await evenementDe(acteur, evenementId);
    const reglages = await lireVocaux(base);
    return {
      hubs: reglages.hubs.filter(h => h.tournoiId === evt.id),
      // Salons déjà pris par un autre hub (ordinaire ou d'un autre événement) : l'écran ne les propose pas.
      autresHubs: reglages.hubs.filter(h => h.tournoiId !== evt.id).map(h => h.id),
      actif: reglages.actif,
      staffRole: evt.staff_role_id ? { id: evt.staff_role_id, nom: evt.staff_role_nom ?? '' } : null,
      peutModifier: await aGlobale(base, acteur, PERMISSION_VOCAUX),
      choix: { limites: LIMITES_VOCAUX, modeleDefaut: MODELE_TOURNOI_DEFAUT },
    };
  }

  /** Enregistre les hubs (validation commune), journal `tickets.config_modifiee` comme l'écran des salons vocaux. */
  async function ecrireHubs(acteur, actuel, hubs) {
    // Le dernier hub retiré : les salons vocaux se désactivent (un réglage actif exige au moins un hub).
    const reglages = validerVocaux({ hubs, ...(hubs.length ? {} : { actif: false }) }, actuel);
    const t = maintenant();
    await base.lot([instructionReglage('vocaux', reglages, acteur.compte, t), evenement('tickets.config_modifiee', { acteur: acteur.compte, entiteType: 'tickets', entiteId: 'vocaux', charge: { cle: 'vocaux', evenement: hubs.find(h => h.tournoiId)?.tournoiId ?? null }, maintenant: t })]);
  }

  /** Champs d'un hub saisis dans la fiche de l'événement (l'événement et le verrouillage sont imposés). */
  const hubSaisi = (c, evtId, avant = {}) => {
    if (!c || typeof c !== 'object') throw echec(400, 'vocaux-hub', 'Hub illisible.');
    const champ = (k, defaut) => (c[k] !== undefined ? c[k] : defaut);
    return {
      id: champ('id', avant.id),
      nom: champ('nom', avant.nom ?? ''),
      categorieId: champ('categorieId', avant.categorieId ?? null),
      modeleNom: champ('modeleNom', avant.modeleNom ?? MODELE_TOURNOI_DEFAUT),
      limite: champ('limite', avant.limite ?? 0),
      rolesAutorises: champ('rolesAutorises', avant.rolesAutorises ?? []),
      verrouille: true,
      tournoiId: evtId,
    };
  };

  async function exigerModifier(acteur, evenementId) {
    const evt = await evenementDe(acteur, evenementId);
    await exiger(acteur);
    return evt;
  }

  async function ajouterHubEvenement(acteur, evenementId, corps) {
    const evt = await exigerModifier(acteur, evenementId);
    const actuel = await lireVocaux(base);
    await ecrireHubs(acteur, actuel, [...actuel.hubs, hubSaisi(corps, evt.id)]);
    return hubsEvenement(acteur, evt.id);
  }

  async function hubDe(actuel, evtId, hubId) {
    const i = actuel.hubs.findIndex(h => h.id === hubId && h.tournoiId === evtId);
    if (i < 0) throw echec(404, 'vocaux-hub-introuvable', 'Ce hub n’est pas lié à cet événement.');
    return i;
  }

  async function modifierHubEvenement(acteur, evenementId, hubId, corps) {
    const evt = await exigerModifier(acteur, evenementId);
    const actuel = await lireVocaux(base);
    const i = await hubDe(actuel, evt.id, hubId);
    await ecrireHubs(acteur, actuel, actuel.hubs.map((h, j) => (j === i ? hubSaisi(corps, evt.id, h) : h)));
    return hubsEvenement(acteur, evt.id);
  }

  async function retirerHubEvenement(acteur, evenementId, hubId) {
    const evt = await exigerModifier(acteur, evenementId);
    const actuel = await lireVocaux(base);
    const i = await hubDe(actuel, evt.id, hubId);
    await ecrireHubs(acteur, actuel, actuel.hubs.filter((_, j) => j !== i));
    return hubsEvenement(acteur, evt.id);
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

  return { config, changer, changerCommandes, discord, exiger, hubsEvenement, ajouterHubEvenement, modifierHubEvenement, retirerHubEvenement };
}
