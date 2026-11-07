/**
 * Tickets : connexion Discord du compte, tenue par UN SEUL processus (« meneur »), et repli de secours.
 *
 * Passenger (o2switch) peut lancer plusieurs processus Node pour l'app Esport, et en arrêter : chaque processus a un
 * superviseur qui passe toutes les 20 s (minuterie `unref`, une requête SQL) :
 *  1. tickets désactivés (ou pas de jeton du bot) : rien n'est tenu ;
 *  2. BAIL (`tickets_bail`, une ligne) : le processus le prend s'il est libre ou expiré, le renouvelle s'il l'a
 *     (60 s) ; une mise à jour conditionnelle, atomique en PostgreSQL comme en SQLite : un seul meneur à la fois. Un
 *     meneur arrêté (ou figé) perd son bail à l'expiration ; un autre processus le reprend au passage suivant ;
 *  3. le meneur tient la Gateway (gateway.mjs) et la reprend (RESUME) avec la session mémorisée en base, même si elle a
 *     été ouverte par un autre processus ; un processus qui n'est plus meneur la ferme aussitôt ;
 *  4. Gateway indisponible (connexion en cours, refusée, intent MESSAGE_CONTENT non activé…) : RELECTURE REST des
 *     tickets ouverts toutes les 45 s (25 salons au plus par passage, les plus anciennement relus d'abord ; arrêt au
 *     premier 429). Après une nouvelle session (READY sans reprise), une relecture rattrape ce qui a pu être manqué.
 * Le cron (toutes les 5 min) relit aussi les tickets si plus aucun processus n'est meneur, et réveille l'app.
 * BIENVENUE PAR RÔLE (bienvenue.mjs) : la Gateway est aussi tenue quand seule la bienvenue est activée ; elle demande
 * alors l'intent GUILD_MEMBERS (privilégié). Si Discord le refuse (4014, « Server Members Intent » non activé), la
 * connexion repart aussitôt sans lui (les tickets continuent) et l'app affiche le rappel ; nouvel essai après 30 min.
 * SALONS VOCAUX TEMPORAIRES (vocaux/moteur.mjs, docs/esport/vocaux.md) : la Gateway est aussi tenue quand ils sont
 * activés, avec l'intent GUILD_VOICE_STATES (non privilégié) ; le moteur reçoit les événements vocaux et salons, et
 * chaque passage du meneur supprime les salons vides arrivés au délai. Sans Gateway (relecture de secours), aucune
 * arrivée dans un hub n'est vue : l'app le dit (Administration › Bot Esport HQ › Fonctionnalités).
 * MAINTIEN EN ÉVEIL : Passenger arrête un processus qui ne reçoit plus de requête (quelques minutes) ; le meneur
 * appelle donc sa propre adresse publique (`reveil`, URL_PUBLIQUE/sante) toutes les 4 min pour garder la Gateway.
 *
 * Diagnostic (`diagnosticTickets`) : chaque superviseur note son dernier passage (`superviseur` : inactif et pourquoi,
 * suiveur, meneur), le cron note le sien (`cron_vu`) ; Tickets › Configuration › Connexion dit précisément ce qui
 * manque (jeton, serveur, catégorie, activation, processus de l'app, Gateway et sa dernière erreur, cron).
 *
 * État affiché dans l'app (`tickets_etat`, clé `connexion`) : « en direct » (Gateway prête, battement reçu), « secours »
 * (relecture REST), « hors ligne » (plus rien depuis plusieurs minutes).
 */

import { hostname } from 'node:os';
import { iso, jsonOu } from '../outils.mjs';
import { creerGateway } from './gateway.mjs';
import { ingererMessage, modifierMessage, plusRecent, supprimerMessage, telechargeurCdn } from './conversation.mjs';
import { lireGeneral } from './reglages.mjs';
import { rest } from './discord.mjs';
import { INTENT_MEMBRES, accueillirMembre, ecrireEtatBienvenue, effacerBienvenues, intentsVoulus, lireBienvenue } from './bienvenue.mjs';
import { lireVocaux } from '../vocaux/reglages.mjs';
import { creerMoteurVocaux } from '../vocaux/moteur.mjs';

export const BAIL = 'gateway';
export const DUREE_BAIL_MS = 60_000;
export const INTERVALLE_MS = 20_000;
export const INTERVALLE_SECOURS_MS = 45_000;
export const SALONS_PAR_RELEVE = 25;
export const INTERVALLE_REVEIL_MS = 240_000;
/** Un passage du superviseur est noté au plus une fois par minute (sauf changement). */
const NOTE_SUPERVISEUR_MS = 60_000;

/** Prend ou renouvelle le bail du meneur ; rend true si `titulaire` l'a. */
export async function prendreBail(base, titulaire, t, duree = DUREE_BAIL_MS) {
  await base.executer("INSERT INTO tickets_bail (id, titulaire, expire_le, maj_le) VALUES (?, NULL, '1970-01-01T00:00:00.000Z', ?) ON CONFLICT (id) DO NOTHING", [BAIL, iso(t)]);
  const r = await base.executer('UPDATE tickets_bail SET titulaire = ?, expire_le = ?, maj_le = ? WHERE id = ? AND (titulaire = ? OR titulaire IS NULL OR expire_le < ?)', [titulaire, iso(t + duree), iso(t), BAIL, titulaire, iso(t)]);
  return Number(r.changements) === 1;
}

/** Rend le bail (arrêt propre) : un autre processus le reprend au passage suivant. */
export async function rendreBail(base, titulaire, t) {
  await base.executer('UPDATE tickets_bail SET expire_le = ?, maj_le = ? WHERE id = ? AND titulaire = ?', [iso(t - 1), iso(t), BAIL, titulaire]);
}

/** Bail en cours (ou null s'il est libre ou expiré). */
export async function bailActif(base, t) {
  const l = await base.premier('SELECT titulaire, expire_le FROM tickets_bail WHERE id = ?', [BAIL]);
  return l && l.titulaire && l.expire_le >= iso(t) ? l : null;
}

export async function lireEtat(base, cle) {
  const l = await base.premier('SELECT valeur, maj_le FROM tickets_etat WHERE cle = ?', [cle]);
  return l ? { ...jsonOu(l.valeur, {}), majLe: l.maj_le } : null;
}

export async function ecrireEtat(base, cle, valeur, t) {
  await base.executer('INSERT INTO tickets_etat (cle, valeur, maj_le) VALUES (?, ?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le', [cle, JSON.stringify(valeur), iso(t)]);
}

/**
 * Relecture REST des tickets ouverts (secours) : les messages arrivés depuis le dernier connu. Rend
 * `{ salons, messages, limite }`.
 */
export async function releverTickets(ctx, { max = SALONS_PAR_RELEVE } = {}) {
  const { base, fetch: fetchDiscord, jetonBot } = ctx;
  const t = ctx.maintenant();
  const tickets = await base.tous(
    "SELECT id, salon_id, dernier_message_id FROM tickets WHERE statut <> 'ferme' AND salon_id IS NOT NULL AND salon_supprime_le IS NULL ORDER BY COALESCE(releve_le, '') LIMIT ?",
    [max],
  );
  let messages = 0;
  let salons = 0;
  for (const tk of tickets) {
    const apres = tk.dernier_message_id ? `&after=${tk.dernier_message_id}` : '';
    const r = await rest(fetchDiscord, jetonBot, 'GET', `/channels/${tk.salon_id}/messages?limit=100${apres}`);
    if (r.statut === 429) return { salons, messages, limite: true };
    if (r.statut === 404 || r.code === 10003) {
      await base.executer('UPDATE tickets SET salon_supprime_le = ?, releve_le = ? WHERE id = ?', [iso(t), iso(t), tk.id]);
      if (ctx.surSalonSupprime) await ctx.surSalonSupprime(tk.salon_id).catch(e => console.error('[esport] tickets : salon supprimé', e?.message ?? e));
      continue;
    }
    salons++;
    let dernier = tk.dernier_message_id;
    if (r.ok && Array.isArray(r.corps)) {
      // Discord rend les plus récents d'abord : rejoués dans l'ordre.
      for (const m of [...r.corps].reverse()) {
        dernier = plusRecent(dernier, m.id);
        if (await ingererMessage(ctx, { ...m, channel_id: tk.salon_id })) messages++;
      }
    }
    await base.executer('UPDATE tickets SET releve_le = ?, dernier_message_id = ? WHERE id = ?', [iso(t), dernier ?? null, tk.id]);
  }
  return { salons, messages, limite: false };
}

/**
 * Superviseur d'un processus. Options : `base`, `jetonBot`, `fetch`, `WebSocket`, `stockage`, `maintenant`,
 * `identifiant` (titulaire du bail), `intervalle`, `dureeBail`, `intervalleSecours`, `gateway` (options passées au
 * client : attentes, hasard), `estStaffCompte`, `surNouveau`, `surSalonSupprime`, `journal`.
 */
export function creerSuperviseurTickets({
  base,
  jetonBot,
  fetch: fetchDiscord = (...a) => globalThis.fetch(...a),
  WebSocket,
  stockage,
  maintenant = () => Date.now(),
  identifiant = `${hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`,
  intervalle = INTERVALLE_MS,
  dureeBail = DUREE_BAIL_MS,
  intervalleSecours = INTERVALLE_SECOURS_MS,
  gateway: optionsGateway = {},
  estStaffCompte,
  surNouveau,
  surSalonSupprime,
  botId: botInitial = null,
  reveil = null,
  fetchReveil = (...a) => globalThis.fetch(...a),
  intervalleReveil = INTERVALLE_REVEIL_MS,
  vocaux: optionsVocaux = {},
  journal = console,
}) {
  let minuterie = null;
  let gw = null;
  // Identifiant du bot : celui de l'application (le même pour les bots récents), puis celui donné par READY.
  let botId = botInitial;
  let meneur = false;
  let dernierSecours = 0;
  let rattraper = false;
  let enCours = null;
  let arrete = false;
  let reglages = null;
  let dernierReveil = 0;
  let etatReveil = null;
  let noteSuperviseur = { role: null, le: 0 };
  let bienvenue = null;
  let intentsCourants = null;
  // Intent GUILD_MEMBERS refusé par Discord : on repart sans lui (date du refus, nouvel essai après 30 min).
  let membresRefusesLe = 0;
  const telecharger = telechargeurCdn(fetchDiscord);
  let vocaux = null;
  // Moteur des salons vocaux temporaires (meneur seulement : il ne reçoit que les événements de SA Gateway).
  const moteur = creerMoteurVocaux({ base, fetch: fetchDiscord, jetonBot, maintenant, journal, botId: () => botId, ...optionsVocaux });

  const ctx = () => ({ base, stockage, reglages, telecharger, botId, maintenant, estStaffCompte, surNouveau, surSalonSupprime, fetch: fetchDiscord, jetonBot });

  const ctxBienvenue = () => ({ base, bienvenue, guildId: reglages?.guildId, guildNom: reglages?.guildNom, fetch: fetchDiscord, jetonBot, maintenant, journal });

  async function evenement(type, d) {
    if (type === 'READY') botId = d?.user?.id ?? botId;
    if (['READY', 'RESUMED', 'GUILD_CREATE', 'VOICE_STATE_UPDATE', 'CHANNEL_CREATE', 'CHANNEL_UPDATE', 'CHANNEL_DELETE'].includes(type)) await moteur.evenement(type, d);
    if (type === 'GUILD_MEMBER_ADD' || type === 'GUILD_MEMBER_UPDATE') {
      await accueillirMembre(ctxBienvenue(), d);
      return;
    }
    if (type === 'MESSAGE_CREATE') await ingererMessage(ctx(), d);
    else if (type === 'MESSAGE_UPDATE') await modifierMessage(ctx(), d);
    else if (type === 'MESSAGE_DELETE') await supprimerMessage(ctx(), d);
    else if (type === 'CHANNEL_DELETE' && d?.id && surSalonSupprime) await surSalonSupprime(d.id);
  }

  async function demarrerGateway(intents) {
    // Intents changés (bienvenue activée ou coupée) : une session ne peut pas être reprise avec d'autres intents.
    if (intentsCourants !== null && intents !== intentsCourants) await ecrireEtat(base, 'session', {}, maintenant()).catch(() => undefined);
    intentsCourants = intents;
    const session = await lireEtat(base, 'session');
    gw = creerGateway({
      jetonBot,
      intents,
      fetch: fetchDiscord,
      ...(WebSocket ? { WebSocket } : {}),
      session: session?.id ? { id: session.id, seq: session.seq ?? null, url: session.url ?? null } : null,
      surSession: s => void ecrireEtat(base, 'session', s ?? {}, maintenant()).catch(() => undefined),
      surEtat: e => {
        if (e.etat === 'pret' && e.utilisateur) rattraper = true;
        if (e.utilisateur) botId = e.utilisateur;
      },
      surEvenement: (type, d) => {
        evenement(type, d).catch(err => journal.error?.('[esport] tickets : événement Discord', err?.message ?? err));
      },
      journal,
      ...optionsGateway,
    });
    gw.demarrer();
  }

  async function arreterGateway(opts) {
    const g = gw;
    gw = null;
    if (g) {
      moteur.reinitialiser();
      await g.arreter(opts);
    }
  }

  /** Note le passage de ce processus (au plus une fois par minute, ou quand le rôle change). */
  async function noter(role, raison, t) {
    if (noteSuperviseur.role === `${role}:${raison ?? ''}` && t - noteSuperviseur.le < NOTE_SUPERVISEUR_MS) return;
    noteSuperviseur = { role: `${role}:${raison ?? ''}`, le: t };
    await ecrireEtat(base, 'superviseur', { role, raison: raison ?? null, processus: identifiant }, t).catch(() => undefined);
  }

  /** Maintien en éveil (meneur seulement) : une requête à l'adresse publique de l'app, sans attendre la réponse. */
  function maintenirEveil(t) {
    if (!reveil || t - dernierReveil < intervalleReveil) return;
    dernierReveil = t;
    Promise.resolve()
      .then(() => fetchReveil(reveil, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000) }))
      .then(
        r => {
          etatReveil = { ok: Boolean(r && r.status < 400), statut: r?.status ?? 0, le: iso(t) };
        },
        e => {
          etatReveil = { ok: false, statut: 0, erreur: String(e?.message ?? e).slice(0, 120), le: iso(t) };
        },
      );
  }

  /** Un passage (aussi appelé par les tests). */
  async function passage() {
    if (enCours) return enCours;
    enCours = (async () => {
      const t = maintenant();
      reglages = await lireGeneral(base);
      bienvenue = await lireBienvenue(base);
      vocaux = await lireVocaux(base);
      if (!jetonBot || !(reglages.actif || bienvenue.actif || vocaux.actif) || !reglages.guildId) {
        if (meneur) await rendreBail(base, identifiant, t);
        meneur = false;
        await arreterGateway();
        await noter('inactif', !jetonBot ? 'sans-jeton' : !reglages.guildId ? 'sans-serveur' : 'desactive', t);
        return { meneur: false, mode: 'inactif' };
      }
      meneur = await prendreBail(base, identifiant, t, dureeBail);
      if (!meneur) {
        await arreterGateway();
        await noter('suiveur', null, t);
        return { meneur: false, mode: 'suiveur' };
      }
      await noter('meneur', null, t);
      maintenirEveil(t);
      if (membresRefusesLe && t - membresRefusesLe > 30 * 60_000) membresRefusesLe = 0;
      const voulus = intentsVoulus(reglages, bienvenue, { sansMembres: Boolean(membresRefusesLe), vocaux: vocaux.actif });
      if (gw && voulus !== intentsCourants) await arreterGateway();
      if (!gw) await demarrerGateway(voulus);
      let e = gw.etat();
      // GUILD_MEMBERS refusé (intent privilégié non activé sur le portail) : on repart tout de suite sans lui.
      if (e.etat === 'fatal' && (e.code === 4014 || e.code === 4013) && intentsCourants & INTENT_MEMBRES) {
        membresRefusesLe = t;
        await ecrireEtatBienvenue(base, { membresRefuses: true, refusLe: iso(t) }, t).catch(() => undefined);
        await arreterGateway();
        await demarrerGateway(intentsVoulus(reglages, bienvenue, { sansMembres: true, vocaux: vocaux.actif }));
        e = gw.etat();
      } else if (e.etat === 'pret' && intentsCourants & INTENT_MEMBRES) {
        await ecrireEtatBienvenue(base, { membresRefuses: false }, t).catch(() => undefined);
      }
      // Fermeture définitive (jeton refusé, intent non activé…) : un seul nouvel essai toutes les 30 min, le temps que
      // le Fondateur corrige le portail Discord (jamais de rafale d'IDENTIFY).
      if (e.etat === 'fatal' && Date.now() - e.depuis > 30 * 60_000) {
        await arreterGateway();
        await demarrerGateway(intentsCourants ?? voulus);
        e = gw.etat();
      }
      // Messages de bienvenue à effacer (rattrapage si un processus s'est arrêté avant l'heure).
      if (bienvenue.actif) await effacerBienvenues(ctxBienvenue()).catch(err => journal.error?.('[esport] bienvenue : effacement', err?.message ?? err));
      const vivant = e.etat === 'pret' && (!e.dernierAck || t - e.dernierAck < Math.max(120_000, intervalle * 4));
      // Salons vocaux vides arrivés au délai (rattrapage des minuteries : processus remplacé, redémarrage).
      if (vivant) await moteur.passage().catch(err => journal.error?.('[esport] vocaux : passage', err?.message ?? err));
      let mode = vivant ? 'direct' : 'secours';
      let releve = null;
      if (mode === 'secours' ? t - dernierSecours >= intervalleSecours : rattraper) {
        rattraper = false;
        dernierSecours = t;
        releve = await releverTickets(ctx()).catch(err => {
          journal.error?.('[esport] tickets : relecture', err?.message ?? err);
          return null;
        });
      }
      await ecrireEtat(base, 'connexion', { mode, meneur: identifiant, gateway: e.etat, code: e.code ?? null, dernierAck: e.dernierAck ? iso(e.dernierAck) : null, prochainEssai: e.prochainEssai ? iso(e.prochainEssai) : null, connexions: e.connexions, identifies: e.identifies, reprises: e.reprises, dernierEssai: e.dernierEssai ? iso(e.dernierEssai) : null, derniereErreur: e.derniereErreur ? { motif: e.derniereErreur.motif, le: iso(e.derniereErreur.le) } : null, reveil: etatReveil, ...(releve ? { releve: { ...releve, le: iso(t) } } : {}) }, t);
      return { meneur: true, mode, releve };
    })();
    try {
      return await enCours;
    } finally {
      enCours = null;
    }
  }

  return {
    identifiant,
    passage,
    demarrer() {
      if (minuterie || arrete) return;
      const tour = () => {
        passage().catch(e => journal.error?.('[esport] tickets : superviseur', e?.message ?? e));
      };
      tour();
      minuterie = setInterval(tour, intervalle);
      minuterie.unref?.();
    },
    async arreter() {
      arrete = true;
      if (minuterie) clearInterval(minuterie);
      minuterie = null;
      await enCours?.catch(() => undefined);
      await arreterGateway();
      moteur.arreter();
      if (meneur) await rendreBail(base, identifiant, maintenant()).catch(() => undefined);
      meneur = false;
    },
    etat: () => ({ meneur, gateway: gw?.etat() ?? null, vocaux: moteur.etat() }),
    /** Tests : le moteur des salons vocaux (file d'événements à attendre). */
    moteurVocaux: moteur,
    /** Tests : processus « mort » (plus de passage, connexion coupée net, bail NON rendu : il expirera). */
    async figer() {
      arrete = true;
      if (minuterie) clearInterval(minuterie);
      minuterie = null;
      await arreterGateway();
    },
  };
}

/**
 * État de la connexion pour l'app : `direct` (Gateway prête et à jour), `secours` (relecture REST, par le meneur ou
 * le cron), `hors_ligne` (plus rien depuis 3 min, ou tickets désactivés).
 */
export async function diagnosticConnexion(base, t) {
  const c = await lireEtat(base, 'connexion');
  const cron = await lireEtat(base, 'cron');
  const frais = c?.majLe && t - Date.parse(c.majLe) < 3 * 60_000;
  const cronFrais = cron?.majLe && t - Date.parse(cron.majLe) < 11 * 60_000;
  const mode = frais ? c.mode : cronFrais ? 'secours' : 'hors_ligne';
  return {
    mode,
    depuis: frais ? c.majLe : cronFrais ? cron.majLe : (c?.majLe ?? null),
    gateway: frais ? c.gateway : null,
    code: c?.code ?? null,
    dernierAck: c?.dernierAck ?? null,
    prochainEssai: frais ? (c?.prochainEssai ?? null) : null,
    releve: c?.releve ?? cron?.releve ?? null,
    intentRefuse: c?.code === 4014,
    jetonRefuse: c?.code === 4004,
    sansWebSocket: c?.code === 'sans-websocket',
    dernierEssai: c?.dernierEssai ?? null,
    derniereErreur: c?.derniereErreur ?? null,
    reveil: c?.reveil ?? null,
  };
}

/**
 * Diagnostic complet (Tickets › Configuration › Connexion) : chaque condition, dans l'ordre où il faut les remplir.
 * `serveurTickets` : `{ gateway }` (TICKETS_GATEWAY), `{ reveil }` (URL_PUBLIQUE posée) quand l'app les connaît.
 */
export async function diagnosticTickets(base, t, { jetonBot, general, serveurTickets = {} }) {
  const sup = await lireEtat(base, 'superviseur');
  const cronVu = await lireEtat(base, 'cron_vu');
  const bail = await bailActif(base, t);
  const frais = (e, ms) => Boolean(e?.majLe && t - Date.parse(e.majLe) < ms);
  return {
    bot: Boolean(jetonBot),
    serveur: general.guildId ? { id: general.guildId, nom: general.guildNom ?? '' } : null,
    categorie: Boolean(general.categorieOuverts),
    actif: Boolean(general.actif),
    gatewayActivee: serveurTickets.gateway !== false,
    reveilConfigure: serveurTickets.reveil === undefined ? null : Boolean(serveurTickets.reveil),
    // Processus de l'app : dernier passage d'un superviseur (toutes les 20 s tant que l'app tourne).
    processus: sup ? { role: sup.role ?? null, raison: sup.raison ?? null, le: sup.majLe, frais: frais(sup, 3 * 60_000) } : null,
    meneur: Boolean(bail),
    connexion: await diagnosticConnexion(base, t),
    // Tâche cron (toutes les 5 min) : dernier passage, quel que soit l'état des tickets.
    cron: cronVu ? { le: cronVu.majLe, frais: frais(cronVu, 11 * 60_000) } : null,
  };
}
