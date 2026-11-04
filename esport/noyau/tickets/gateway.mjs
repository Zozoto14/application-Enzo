/**
 * Client de la Gateway Discord (WebSocket, API v10, JSON, sans compression) pour les tickets : le bot reçoit les
 * messages des salons de tickets en temps réel. Client WebSocket NATIF de Node 22 (`globalThis.WebSocket`),
 * injectable pour les tests (faux serveur). Aucune dépendance.
 *
 * Protocole (https://discord.com/developers/docs/events/gateway) :
 *  - HELLO (op 10) → battement (op 1) toutes les `heartbeat_interval` ms (le premier après une part au hasard),
 *    puis IDENTIFY (op 2 : jeton, intents) ou RESUME (op 6 : session, dernier numéro) ;
 *  - HEARTBEAT_ACK (op 11) attendu avant le battement suivant, sinon connexion « zombie » : fermée puis reprise ;
 *  - op 1 reçu : battement immédiat ; RECONNECT (op 7) : reprise ; INVALID_SESSION (op 9) : reprise si `d` vaut
 *    true, sinon nouvelle session après 1 à 5 s ;
 *  - DISPATCH (op 0) : `s` mémorisé, READY (session_id, resume_gateway_url, utilisateur du bot), RESUMED, puis les
 *    événements transmis à `surEvenement(type, donnees)`.
 *
 * Sobriété (hébergement mutualisé, pare-feu sensible au nombre de connexions) : UNE connexion ; reconnexion à
 * attente exponentielle avec une part au hasard (`attenteMin` → `attenteMax`), remise à zéro seulement après un
 * READY / RESUMED ; reprise de session (RESUME) plutôt qu'un nouvel IDENTIFY dès que possible ; adresse donnée par
 * GET /gateway/bot, avec le budget de sessions (`session_start_limit`) respecté : budget presque épuisé → pas
 * d'IDENTIFY, état `limite` jusqu'à `reset_after`. Codes de fermeture fatals (jeton refusé, intents non permis…) :
 * plus aucune tentative, état `fatal` avec le code (l'app l'affiche, le superviseur passe en relecture de secours).
 */

import { rest } from './discord.mjs';

/** Intents : GUILDS (1 << 0), GUILD_MESSAGES (1 << 9), MESSAGE_CONTENT (1 << 15, intent PRIVILÉGIÉ). */
export const INTENTS_TICKETS = (1 << 0) | (1 << 9) | (1 << 15);
/** Fermetures sans reprise possible : jeton (4004), shard (4010, 4011), version (4012), intents (4013, 4014). */
export const FERMETURES_FATALES = Object.freeze([4004, 4010, 4011, 4012, 4013, 4014]);
/** Fermetures où la session est perdue (nouvel IDENTIFY) : numéro invalide (4007), session expirée (4009). */
const FERMETURES_SANS_REPRISE = [4007, 4009];
/** Sessions gardées en réserve : en dessous, pas de nouvel IDENTIFY (1 000 par jour pour un bot). */
const RESERVE_SESSIONS = 5;

/** Adresse de Gateway acceptée : wss:// (Discord) ; ws:// seulement en local (faux serveur des tests). */
export function adresseSure(v) {
  if (typeof v !== 'string' || v.length > 200) return null;
  try {
    const u = new URL(v);
    if (u.protocol === 'wss:') return v.replace(/\/+$/, '');
    if (u.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return v.replace(/\/+$/, '');
  } catch {
    return null;
  }
  return null;
}

const OP = { DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, RESUME: 6, RECONNECT: 7, INVALID_SESSION: 9, HELLO: 10, ACK: 11 };

/**
 * Crée le client. Options :
 *  - `jetonBot`, `intents`, `fetch` (REST : GET /gateway/bot), `WebSocket` (constructeur, défaut : natif) ;
 *  - `surEvenement(type, d)`, `surEtat(etat)` (`connexion`, `pret`, `reprise`, `attente`, `limite`, `fatal`,
 *    `ferme`), `session` initiale `{ id, seq, url }` et `surSession(session)` (mémorisée par le superviseur : un
 *    autre processus peut reprendre la session) ;
 *  - `attenteMin` / `attenteMax` (ms), `hasard()` (0..1), `journal`.
 */
export function creerGateway({
  jetonBot,
  intents = INTENTS_TICKETS,
  fetch: fetchDiscord = (...a) => globalThis.fetch(...a),
  WebSocket: Ws = globalThis.WebSocket,
  surEvenement = () => {},
  surEtat = () => {},
  session: sessionInitiale = null,
  surSession = () => {},
  attenteMin = 2_000,
  attenteMax = 300_000,
  hasard = Math.random,
  journal = console,
  proprietes = { os: 'linux', browser: 'esport-hq', device: 'esport-hq' },
} = {}) {
  let ws = null;
  let ferme = false;
  let battement = null;
  let minuterie = null;
  let ackRecu = true;
  let seq = sessionInitiale?.seq ?? null;
  let sessionId = sessionInitiale?.id ?? null;
  let urlReprise = sessionInitiale?.url ?? null;
  let urlGateway = null;
  let echecs = 0;
  let utilisateur = null;
  const etat = { etat: 'ferme', depuis: Date.now(), code: null, dernierAck: null, identifies: 0, reprises: 0, connexions: 0, utilisateur: null };

  const changer = (e, extra = {}) => {
    Object.assign(etat, { etat: e, depuis: Date.now(), ...extra });
    try {
      surEtat({ ...etat });
    } catch (err) {
      journal.error?.('[esport] tickets gateway : état', err?.message ?? err);
    }
  };
  const memoriser = () => {
    try {
      surSession(sessionId ? { id: sessionId, seq, url: urlReprise } : null);
    } catch {
      // Mémorisation facultative.
    }
  };

  const arreterBattement = () => {
    if (battement) clearTimeout(battement);
    battement = null;
  };

  function envoyer(op, d) {
    if (!ws || ws.readyState !== 1) return false;
    try {
      ws.send(JSON.stringify({ op, d }));
      return true;
    } catch {
      return false;
    }
  }

  function battre(intervalle, premier = false) {
    arreterBattement();
    const delai = premier ? Math.floor(intervalle * hasard()) : intervalle;
    battement = setTimeout(() => {
      if (!ackRecu) {
        // Connexion zombie : aucun ACK depuis le dernier battement. Fermée sans code 1000 : la session se reprend.
        journal.warn?.('[esport] tickets gateway : pas de réponse au battement, reconnexion');
        couper(4900);
        return;
      }
      ackRecu = false;
      envoyer(OP.HEARTBEAT, seq);
      battre(intervalle);
    }, delai);
    battement.unref?.();
  }

  /** Ferme la connexion courante (la reconnexion est décidée par `surFermeture`). */
  function couper(code = 4900) {
    const w = ws;
    if (!w) return;
    try {
      w.close(code);
    } catch {
      surFermeture(w, code);
    }
  }

  function planifier(reprendre = true) {
    if (ferme || minuterie) return;
    const base = Math.min(attenteMax, attenteMin * 2 ** Math.min(10, echecs));
    const delai = Math.floor(base / 2 + (base / 2) * hasard());
    echecs++;
    changer('attente', { prochainEssai: Date.now() + delai });
    minuterie = setTimeout(() => {
      minuterie = null;
      void connecter(reprendre);
    }, delai);
    minuterie.unref?.();
  }

  function surFermeture(w, code) {
    if (w !== ws) return;
    ws = null;
    arreterBattement();
    if (ferme) {
      changer('ferme');
      return;
    }
    if (FERMETURES_FATALES.includes(Number(code))) {
      journal.error?.(`[esport] tickets gateway : fermeture définitive (code ${code})`);
      changer('fatal', { code: Number(code) });
      return;
    }
    if (FERMETURES_SANS_REPRISE.includes(Number(code))) {
      sessionId = null;
      seq = null;
      urlReprise = null;
      memoriser();
    }
    planifier(true);
  }

  async function budget() {
    const r = await rest(fetchDiscord, jetonBot, 'GET', '/gateway/bot');
    if (!r.ok) {
      if (r.statut === 401) return { fatal: 4004 };
      return { erreur: r.retryApresS ? r.retryApresS * 1000 : null };
    }
    const limite = r.corps?.session_start_limit ?? {};
    urlGateway = adresseSure(r.corps?.url) ?? 'wss://gateway.discord.gg';
    return { restantes: Number(limite.remaining ?? 1000), reprise: Number(limite.reset_after ?? 0) };
  }

  async function connecter(reprendre = true) {
    if (ferme || ws) return;
    // Node sans client WebSocket (version trop ancienne) : définitif, la relecture de secours prend le relais.
    if (typeof Ws !== 'function') {
      changer('fatal', { code: 'sans-websocket' });
      return;
    }
    const reprise = reprendre && sessionId && urlReprise;
    if (!reprise) {
      const b = await budget();
      if (ferme) return;
      if (b.fatal) {
        changer('fatal', { code: b.fatal });
        return;
      }
      if (b.erreur !== undefined) {
        planifier(false);
        return;
      }
      if (b.restantes <= RESERVE_SESSIONS) {
        // Budget de sessions presque épuisé : on attend sa remise à zéro (jamais d'IDENTIFY de trop).
        const attente = Math.max(60_000, Math.min(24 * 3_600_000, b.reprise || 3_600_000));
        changer('limite', { prochainEssai: Date.now() + attente });
        minuterie = setTimeout(() => {
          minuterie = null;
          void connecter(false);
        }, attente);
        minuterie.unref?.();
        return;
      }
    }
    const adresse = `${reprise ? urlReprise : urlGateway}/?v=10&encoding=json`;
    changer(reprise ? 'reprise' : 'connexion');
    etat.connexions++;
    let w;
    try {
      w = new Ws(adresse);
    } catch (e) {
      journal.error?.('[esport] tickets gateway : connexion impossible', e?.message ?? e);
      planifier(reprendre);
      return;
    }
    ws = w;
    ackRecu = true;
    w.onmessage = ev => recevoir(w, ev.data, reprise);
    w.onclose = ev => surFermeture(w, ev?.code);
    w.onerror = () => {
      // Suivi d'un « close » : rien à faire ici (pas de double reconnexion).
    };
  }

  function recevoir(w, donnees, reprise) {
    if (w !== ws) return;
    let m;
    try {
      m = JSON.parse(typeof donnees === 'string' ? donnees : Buffer.from(donnees).toString('utf8'));
    } catch {
      return;
    }
    if (m.s !== null && m.s !== undefined) seq = m.s;
    switch (m.op) {
      case OP.HELLO: {
        const intervalle = Math.max(10, Number(m.d?.heartbeat_interval) || 41_250);
        battre(intervalle, true);
        if (reprise && sessionId) {
          etat.reprises++;
          envoyer(OP.RESUME, { token: jetonBot, session_id: sessionId, seq });
        } else {
          etat.identifies++;
          envoyer(OP.IDENTIFY, { token: jetonBot, intents, properties: proprietes });
        }
        return;
      }
      case OP.ACK:
        ackRecu = true;
        etat.dernierAck = Date.now();
        return;
      case OP.HEARTBEAT:
        envoyer(OP.HEARTBEAT, seq);
        return;
      case OP.RECONNECT:
        couper(4901);
        return;
      case OP.INVALID_SESSION:
        if (m.d !== true) {
          sessionId = null;
          seq = null;
          urlReprise = null;
          memoriser();
        }
        // Discord demande d'attendre 1 à 5 s avant de recommencer.
        arreterBattement();
        ws = null;
        try {
          w.close(4902);
        } catch {
          // Déjà fermée.
        }
        if (!ferme && !minuterie) {
          const delai = 1000 + Math.floor(4000 * hasard());
          minuterie = setTimeout(() => {
            minuterie = null;
            void connecter(m.d === true);
          }, Math.min(delai, attenteMax));
          minuterie.unref?.();
        }
        return;
      case OP.DISPATCH:
        if (m.t === 'READY') {
          sessionId = m.d?.session_id ?? null;
          urlReprise = adresseSure(m.d?.resume_gateway_url);
          utilisateur = m.d?.user?.id ?? null;
          echecs = 0;
          memoriser();
          changer('pret', { code: null, utilisateur, prochainEssai: null });
        } else if (m.t === 'RESUMED') {
          echecs = 0;
          memoriser();
          changer('pret', { code: null, prochainEssai: null });
        }
        try {
          surEvenement(m.t, m.d);
        } catch (e) {
          journal.error?.('[esport] tickets gateway : événement', e?.message ?? e);
        }
        if (m.t !== 'READY' && m.t !== 'RESUMED' && seq !== null) memoriserSeq();
        return;
      default:
    }
  }

  // Le numéro de séquence est mémorisé au plus toutes les 5 s (pas une écriture par message).
  let dernierSeqMemorise = 0;
  function memoriserSeq() {
    const t = Date.now();
    if (t - dernierSeqMemorise < 5_000) return;
    dernierSeqMemorise = t;
    memoriser();
  }

  return {
    demarrer() {
      ferme = false;
      if (!ws && !minuterie) void connecter(true);
    },
    /** Ferme la connexion (code 1000 si `oublier` : Discord oublie la session ; sinon 4903, elle reste reprenable). */
    async arreter({ oublier = false } = {}) {
      ferme = true;
      if (minuterie) clearTimeout(minuterie);
      minuterie = null;
      arreterBattement();
      const w = ws;
      ws = null;
      if (oublier) {
        sessionId = null;
        seq = null;
        urlReprise = null;
      }
      memoriser();
      if (w) {
        try {
          w.close(oublier ? 1000 : 4903);
        } catch {
          // Déjà fermée.
        }
      }
      changer('ferme');
    },
    etat: () => ({ ...etat, session: Boolean(sessionId), seq }),
    get utilisateur() {
      return utilisateur;
    },
  };
}
