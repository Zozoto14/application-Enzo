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

export const BAIL = 'gateway';
export const DUREE_BAIL_MS = 60_000;
export const INTERVALLE_MS = 20_000;
export const INTERVALLE_SECOURS_MS = 45_000;
export const SALONS_PAR_RELEVE = 25;

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
  const telecharger = telechargeurCdn(fetchDiscord);

  const ctx = () => ({ base, stockage, reglages, telecharger, botId, maintenant, estStaffCompte, surNouveau, surSalonSupprime, fetch: fetchDiscord, jetonBot });

  async function evenement(type, d) {
    if (type === 'READY') botId = d?.user?.id ?? botId;
    if (type === 'MESSAGE_CREATE') await ingererMessage(ctx(), d);
    else if (type === 'MESSAGE_UPDATE') await modifierMessage(ctx(), d);
    else if (type === 'MESSAGE_DELETE') await supprimerMessage(ctx(), d);
    else if (type === 'CHANNEL_DELETE' && d?.id && surSalonSupprime) await surSalonSupprime(d.id);
  }

  async function demarrerGateway() {
    const session = await lireEtat(base, 'session');
    gw = creerGateway({
      jetonBot,
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
    if (g) await g.arreter(opts);
  }

  /** Un passage (aussi appelé par les tests). */
  async function passage() {
    if (enCours) return enCours;
    enCours = (async () => {
      const t = maintenant();
      reglages = await lireGeneral(base);
      if (!jetonBot || !reglages.actif || !reglages.guildId) {
        if (meneur) await rendreBail(base, identifiant, t);
        meneur = false;
        await arreterGateway();
        return { meneur: false, mode: 'inactif' };
      }
      meneur = await prendreBail(base, identifiant, t, dureeBail);
      if (!meneur) {
        await arreterGateway();
        return { meneur: false, mode: 'suiveur' };
      }
      if (!gw) await demarrerGateway();
      let e = gw.etat();
      // Fermeture définitive (jeton refusé, intent non activé…) : un seul nouvel essai toutes les 30 min, le temps que
      // le Fondateur corrige le portail Discord (jamais de rafale d'IDENTIFY).
      if (e.etat === 'fatal' && Date.now() - e.depuis > 30 * 60_000) {
        await arreterGateway();
        await demarrerGateway();
        e = gw.etat();
      }
      const vivant = e.etat === 'pret' && (!e.dernierAck || t - e.dernierAck < Math.max(120_000, intervalle * 4));
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
      await ecrireEtat(base, 'connexion', { mode, meneur: identifiant, gateway: e.etat, code: e.code ?? null, dernierAck: e.dernierAck ? iso(e.dernierAck) : null, prochainEssai: e.prochainEssai ? iso(e.prochainEssai) : null, connexions: e.connexions, identifies: e.identifies, reprises: e.reprises, ...(releve ? { releve: { ...releve, le: iso(t) } } : {}) }, t);
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
      if (meneur) await rendreBail(base, identifiant, maintenant()).catch(() => undefined);
      meneur = false;
    },
    etat: () => ({ meneur, gateway: gw?.etat() ?? null }),
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
  };
}
