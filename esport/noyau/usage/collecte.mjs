/**
 * Statistiques d'usage internes (migration 0018) : collecte, agrégation journalière, rétention, RGPD.
 * Voir docs/esport/statistiques.md.
 *
 *  - L'app envoie ses événements PAR LOTS (`POST /usage`, un lot toutes les 45 s au plus, ou au départ de la
 *    page avec `keepalive`) : page ouverte et durée passée, actions clés, erreurs JS. Rien n'est envoyé quand
 *    il ne se passe rien. Le serveur valide chaque événement (identifiants stables, listes fermées, textes
 *    bornés) et l'écrit dans `usage_evenements` en un seul lot SQL.
 *  - Uniquement des métadonnées : jamais de contenu saisi, jamais d'adresse IP, aucun traceur tiers. Le
 *    message d'une erreur JS est tronqué et nettoyé (adresses, e-mails, nombres longs retirés).
 *  - Le Fondateur peut couper la collecte (`usage_reglages.collecte = '0'`) : le serveur ignore alors les
 *    lots et répond `{ actif: false }`, l'app cesse d'envoyer.
 *  - Le cron agrège chaque jour civil (heure de Paris) terminé depuis plus d'une heure dans les tables
 *    `usage_jour_*` (une fois par jour : l'état `agrege_jusqua` dit où il en est), puis purge le détail brut
 *    de plus de 90 jours déjà agrégé. Les agrégats sont gardés sans limite.
 *
 * SQL du dialecte commun SQLite / PostgreSQL ; dates et heures calculées en JavaScript (pas de fonction de
 * date propre à un moteur).
 */

import CATALOGUE_USAGE from './pages.json' with { type: 'json' };
import { echec, iso, nouvelId } from '../outils.mjs';
import { ajouterJours, dateLocale, instantMural, lireDate, partiesLocales, texteDate } from '../planning/temps.mjs';

export { CATALOGUE_USAGE };
export const FUSEAU_USAGE = 'Europe/Paris';
export const RETENTION_BRUT_JOURS = 90;
export const MAX_EVENEMENTS_LOT = 100;
export const DUREE_MAX_MS = 4 * 3_600_000;
/** Âge maximal annoncé d'un événement (envoi différé du lot) : 10 minutes. */
const AGE_MAX_MS = 10 * 60_000;
const JOUR_MS = 86_400_000;
/** Jours agrégés au plus par passage du cron (rattrapage progressif, sans longue exécution). */
const JOURS_PAR_PASSAGE = 31;
const TAILLE_LOT_SQL = 80;

export const APPAREILS_CLIENT = ['pc', 'tablette', 'telephone', 'app_pc'];
export const APPAREILS = [...APPAREILS_CLIENT, 'discord'];
export const ACTIONS_CLIENT = new Set(CATALOGUE_USAGE.actions.map(a => a.id).filter(a => !a.startsWith('bot.')));
export const FONCTION_ACTION = Object.fromEntries(CATALOGUE_USAGE.actions.map(a => [a.id, a.fonction]));
export const PAGES = CATALOGUE_USAGE.pages;

const MOTIF_PAGE = /^[a-z][a-z0-9_]{0,20}(\.[a-z0-9_]{1,24}){1,3}$/;
const MOTIF_SESSION = /^[A-Za-z0-9_-]{8,40}$/;
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ------------------------------------------------------------------ Jours de Paris

/** Jour civil (Paris) d'un instant : « AAAA-MM-JJ ». */
export const jourDe = ms => texteDate(dateLocale(FUSEAU_USAGE, ms));
/** Début (instant UTC, ms) d'un jour civil de Paris. */
export const debutDuJour = jour => instantMural(FUSEAU_USAGE, lireDate(jour), 0);
/** Jour civil + n jours. */
export const plusJours = (jour, n) => texteDate(ajouterJours(lireDate(jour), n));
/** Jours de `du` à `au` inclus. */
export function joursEntre(du, au) {
  const sortie = [];
  for (let j = du; j <= au && sortie.length < 3700; j = plusJours(j, 1)) sortie.push(j);
  return sortie;
}

// ------------------------------------------------------------------ Réglages

export async function lireReglage(base, cle) {
  const l = await base.premier('SELECT valeur FROM usage_reglages WHERE cle = ?', [cle]);
  return l ? l.valeur : null;
}

export function instructionReglage(cle, valeur, maintenant, { siAbsent = false } = {}) {
  return {
    sql: `INSERT INTO usage_reglages (cle, valeur, maj_le) VALUES (?, ?, ?) ON CONFLICT (cle) DO ${siAbsent ? 'NOTHING' : 'UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le'}`,
    params: [cle, String(valeur), iso(maintenant)],
  };
}

/** Collecte active ? (par défaut : oui, tant que le Fondateur ne l'a pas coupée). */
export async function collecteActive(base) {
  return (await lireReglage(base, 'collecte')) !== '0';
}

// ------------------------------------------------------------------ Nettoyage

/** Message d'erreur JS : sans adresses, e-mails, jetons ni nombres longs ; 200 caractères au plus. */
export function nettoyerMessage(brut) {
  return String(brut ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/g, '<e-mail>')
    .replace(/\b(https?|wss?|file|blob):\/\/\S+/gi, '<url>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b(es1|p1)\.[\w.-]+/g, '<jeton>')
    .replace(/[A-Za-z0-9_-]{32,}/g, '<jeton>')
    .replace(/\d{4,}/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Empreinte stable d'un message (regroupement des erreurs) : FNV-1a 32 bits, en hexadécimal. */
export function empreinte(texte) {
  let h = 0x811c9dc5;
  const s = String(texte).toLowerCase().replace(/\d+/g, '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const borne = (n, min, max) => Math.min(max, Math.max(min, Math.round(Number(n) || 0)));

// ------------------------------------------------------------------ Journal du serveur

export const JOURNAL_ERREURS_PAR_MINUTE = 30;
export const JOURNAL_ERREUR_REPETEE_MS = 10 * 60_000;

/**
 * Erreurs JS des apps recopiées dans le journal du serveur (~/logs/esport.log, docs/performance.md) : un bug
 * passager (« des fois il bug ») y laisse une trace lisible sans ouvrir les statistiques. Message déjà nettoyé
 * (`nettoyerMessage`), ni compte ni adresse IP. Sobre : une même erreur (empreinte) au plus une fois par
 * 10 minutes, 30 lignes par minute en tout ; au-delà, un seul résumé « N erreurs non recopiées ».
 */
export function creerJournalErreursClient({ ecrire = ligne => console.warn(ligne), maintenant = () => Date.now() } = {}) {
  const vues = new Map();
  let minute = -1;
  let ecrites = 0;
  let tues = 0;
  return function journaliser({ message, page, appareil }) {
    const t = maintenant();
    const m = Math.floor(t / 60_000);
    if (m !== minute) {
      if (tues > 0) ecrire(`erreur client : ${tues} erreur(s) non recopiée(s) la minute précédente (plafond ${JOURNAL_ERREURS_PAR_MINUTE}/min)`);
      minute = m;
      ecrites = 0;
      tues = 0;
    }
    const emp = empreinte(message);
    const vu = vues.get(emp);
    if (vu !== undefined && t - vu < JOURNAL_ERREUR_REPETEE_MS) return false;
    if (ecrites >= JOURNAL_ERREURS_PAR_MINUTE) {
      tues++;
      return false;
    }
    if (vues.size > 500) vues.clear();
    vues.set(emp, t);
    ecrites++;
    ecrire(`erreur client [${emp}] ${appareil ?? '?'} ${page ?? '-'} : ${message}`);
    return true;
  };
}

// ------------------------------------------------------------------ Ingestion

/**
 * Lot envoyé par l'app : `{ session, appareil, langue, evenements: [{ g, p?, t?, a?, d?, m?, il? }] }`
 *  - `g` : genre (page, action, erreur) ; `p` : page (identifiant de route) ; `t` : team ;
 *  - `a` : action clé (liste fermée) ; `d` : durée sur la page (ms) ; `m` : message d'erreur ;
 *  - `il` : âge de l'événement à l'envoi (ms, 10 minutes au plus) : l'heure reste juste.
 * Un événement illisible est ignoré (pas d'erreur pour tout le lot) ; un lot illisible : 400.
 */
export function servicesCollecte({ base, maintenant = () => Date.now(), journalErreurs = creerJournalErreursClient() }) {
  async function ingerer(acteur, corps) {
    if (!(await collecteActive(base))) return { actif: false, recus: 0 };
    const session = String(corps?.session ?? '');
    if (!MOTIF_SESSION.test(session)) throw echec(400, 'usage-session', 'Lot d’usage illisible (session).');
    const appareil = APPAREILS_CLIENT.includes(corps?.appareil) ? corps.appareil : null;
    if (!appareil) throw echec(400, 'usage-appareil', 'Lot d’usage illisible (appareil).');
    const langue = corps?.langue === 'en' ? 'en' : 'fr';
    const liste = Array.isArray(corps?.evenements) ? corps.evenements : null;
    if (!liste) throw echec(400, 'usage-lot', 'Lot d’usage illisible.');
    if (liste.length > MAX_EVENEMENTS_LOT) throw echec(413, 'usage-lot', '100 événements au plus par lot.');
    if (liste.length === 0) return { actif: true, recus: 0 };
    // Teams de l'acteur : une team citée doit être la sienne (le Fondateur : toutes).
    const sesTeams = new Set((await base.tous("SELECT team_id FROM membres WHERE compte_id = ? AND statut = 'actif'", [acteur.compte])).map(l => l.team_id));
    const t = maintenant();
    const lot = [];
    for (const e of liste) {
      if (!e || typeof e !== 'object') continue;
      const genre = ['page', 'action', 'erreur'].includes(e.g) ? e.g : null;
      if (!genre) continue;
      const page = typeof e.p === 'string' && MOTIF_PAGE.test(e.p) ? e.p : null;
      if (genre === 'page' && !page) continue;
      const action = genre === 'action' && typeof e.a === 'string' && ACTIONS_CLIENT.has(e.a) ? e.a : null;
      if (genre === 'action' && !action) continue;
      const message = genre === 'erreur' ? nettoyerMessage(e.m) : null;
      if (genre === 'erreur' && !message) continue;
      const team = typeof e.t === 'string' && MOTIF_UUID.test(e.t) && (acteur.superAdmin || sesTeams.has(e.t)) ? e.t : null;
      const duree = genre === 'page' ? borne(e.d, 0, DUREE_MAX_MS) : 0;
      const date = t - borne(e.il, 0, AGE_MAX_MS);
      if (genre === 'erreur') journalErreurs({ message, page, appareil });
      lot.push({
        sql: 'INSERT INTO usage_evenements (id, compte_id, session_id, genre, page, team_id, action, duree_ms, appareil, langue, message, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params: [nouvelId(), acteur.compte, session, genre, page, team, action, duree, appareil, langue, message, iso(date)],
      });
    }
    if (lot.length > 0) {
      // Premier jour mesuré : avant lui, l'écran reconstitue l'historique depuis le journal.
      lot.push(instructionReglage('debut_collecte', jourDe(t), t, { siAbsent: true }));
      await base.lot(lot);
    }
    return { actif: true, recus: Math.max(0, lot.length - 1) };
  }

  return { ingerer };
}

/**
 * Commande du bot Discord (fonction « bot » des statistiques) : comptée pour le compte Esport lié (liaison
 * /lier, sinon Discord ID saisi par le Fondateur). Jamais d'erreur remontée au bot.
 */
export async function noterCommandeBot(base, discordUserId, maintenant = Date.now()) {
  try {
    if (!(await collecteActive(base))) return false;
    const lie = await base.premier('SELECT compte_id FROM discord_comptes WHERE discord_user_id = ?', [String(discordUserId)]);
    const compte = lie?.compte_id ?? (await base.premier('SELECT id FROM comptes WHERE discord_id = ?', [String(discordUserId)]))?.id;
    if (!compte) return false;
    await base.lot([
      {
        sql: "INSERT INTO usage_evenements (id, compte_id, session_id, genre, page, team_id, action, duree_ms, appareil, langue, message, cree_le) VALUES (?, ?, ?, 'action', NULL, NULL, 'bot.commande', 0, 'discord', ?, NULL, ?)",
        params: [nouvelId(), compte, 'discord-bot', 'fr', iso(maintenant)],
      },
      instructionReglage('debut_collecte', jourDe(maintenant), maintenant, { siAbsent: true }),
    ]);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ Agrégation (mémoire)

/**
 * Lignes brutes → lignes des tables journalières (même forme que `usage_jour_*`). Sert au cron (jours
 * terminés) ET à la lecture des jours pas encore agrégés (aujourd'hui) : un seul calcul.
 */
export function agreger(evenements) {
  const pages = new Map();
  const membres = new Map();
  const actions = new Map();
  const heures = new Map();
  const erreurs = new Map();
  const ajouter = (carte, cle, init, f) => {
    let l = carte.get(cle);
    if (!l) {
      l = init();
      carte.set(cle, l);
    }
    f(l);
  };
  for (const e of evenements) {
    const ms = Date.parse(e.cree_le);
    if (!Number.isFinite(ms)) continue;
    const p = partiesLocales(FUSEAU_USAGE, ms);
    const jour = texteDate(p);
    const team = e.team_id ?? '';
    const compte = e.compte_id;
    const appareil = e.appareil;
    const duree = borne(e.duree_ms, 0, DUREE_MAX_MS);
    ajouter(
      membres,
      `${jour}|${compte}|${appareil}`,
      () => ({ jour, compte_id: compte, appareil, langues: new Map(), sessionsSet: new Set(), vues: 0, duree_ms: 0, actions: 0, erreurs: 0, premiere: e.cree_le, derniere: e.cree_le }),
      l => {
        if (e.session_id && e.session_id !== 'discord-bot') l.sessionsSet.add(e.session_id);
        l.langues.set(e.langue, (l.langues.get(e.langue) ?? 0) + 1);
        if (e.genre === 'page') {
          l.vues++;
          l.duree_ms += duree;
        } else if (e.genre === 'action') l.actions++;
        else l.erreurs++;
        if (e.cree_le < l.premiere) l.premiere = e.cree_le;
        if (e.cree_le > l.derniere) l.derniere = e.cree_le;
      },
    );
    if (e.genre === 'page') {
      ajouter(pages, `${jour}|${compte}|${team}|${e.page}|${appareil}`, () => ({ jour, compte_id: compte, team_id: team, page: e.page, appareil, vues: 0, duree_ms: 0 }), l => {
        l.vues++;
        l.duree_ms += duree;
      });
    } else if (e.genre === 'action') {
      ajouter(actions, `${jour}|${compte}|${team}|${e.action}|${appareil}`, () => ({ jour, compte_id: compte, team_id: team, action: e.action, appareil, n: 0 }), l => {
        l.n++;
      });
    } else {
      const message = String(e.message ?? '');
      const emp = empreinte(message);
      ajouter(erreurs, `${jour}|${emp}|${e.page ?? ''}|${compte}|${appareil}`, () => ({ jour, empreinte: emp, page: e.page ?? '', compte_id: compte, appareil, message, n: 0 }), l => {
        l.n++;
      });
    }
    if (e.genre !== 'erreur') {
      ajouter(heures, `${jour}|${p.heure}|${compte}|${team}|${appareil}`, () => ({ jour, heure: p.heure, compte_id: compte, team_id: team, appareil, n: 0 }), l => {
        l.n++;
      });
    }
  }
  return {
    pages: [...pages.values()],
    membres: [...membres.values()].map(({ langues, sessionsSet, ...l }) => ({ ...l, sessions: sessionsSet.size, langue: [...langues.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'fr' })),
    actions: [...actions.values()],
    heures: [...heures.values()],
    erreurs: [...erreurs.values()],
  };
}

const COLONNES = {
  usage_jour_pages: ['jour', 'compte_id', 'team_id', 'page', 'appareil', 'vues', 'duree_ms'],
  usage_jour_membres: ['jour', 'compte_id', 'appareil', 'langue', 'sessions', 'vues', 'duree_ms', 'actions', 'erreurs', 'premiere', 'derniere'],
  usage_jour_actions: ['jour', 'compte_id', 'team_id', 'action', 'appareil', 'n'],
  usage_jour_heures: ['jour', 'heure', 'compte_id', 'team_id', 'appareil', 'n'],
  usage_jour_erreurs: ['jour', 'empreinte', 'page', 'compte_id', 'appareil', 'message', 'n'],
};
export const TABLES_JOUR = Object.keys(COLONNES);
const SOURCE = { usage_jour_pages: 'pages', usage_jour_membres: 'membres', usage_jour_actions: 'actions', usage_jour_heures: 'heures', usage_jour_erreurs: 'erreurs' };

async function executerParPaquets(base, instructions) {
  for (let i = 0; i < instructions.length; i += TAILLE_LOT_SQL) await base.lot(instructions.slice(i, i + TAILLE_LOT_SQL));
}

/** Événements bruts entre deux jours civils (Paris), `fin` exclu. */
export async function evenementsBruts(base, du, finExclue, { compte } = {}) {
  return base.tous(
    `SELECT compte_id, session_id, genre, page, team_id, action, duree_ms, appareil, langue, message, cree_le FROM usage_evenements WHERE cree_le >= ? AND cree_le < ?${compte ? ' AND compte_id = ?' : ''} ORDER BY cree_le`,
    [iso(debutDuJour(du)), iso(debutDuJour(finExclue)), ...(compte ? [compte] : [])],
  );
}

/**
 * Cron : agrège les jours civils terminés (depuis plus d'une heure) pas encore agrégés. Idempotent (le jour
 * est effacé puis réécrit) ; l'état n'avance qu'une fois le jour écrit. Rend le nombre de jours agrégés.
 */
export async function agregerUsage(base, { maintenant = Date.now() } = {}) {
  const limite = jourDe(maintenant - 3_600_000);
  let debut = await lireReglage(base, 'agrege_jusqua');
  if (!debut) {
    const premier = await base.premier('SELECT MIN(cree_le) AS d FROM usage_evenements', []);
    if (!premier?.d) return 0;
    debut = jourDe(Date.parse(premier.d));
  }
  let n = 0;
  for (let jour = debut; jour < limite && n < JOURS_PAR_PASSAGE; jour = plusJours(jour, 1)) {
    const lignes = agreger(await evenementsBruts(base, jour, plusJours(jour, 1)));
    const instructions = TABLES_JOUR.map(table => ({ sql: `DELETE FROM ${table} WHERE jour = ?`, params: [jour] }));
    for (const table of TABLES_JOUR) {
      const colonnes = COLONNES[table];
      for (const l of lignes[SOURCE[table]]) instructions.push({ sql: `INSERT INTO ${table} (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`, params: colonnes.map(c => l[c]) });
    }
    instructions.push(instructionReglage('agrege_jusqua', plusJours(jour, 1), maintenant));
    await executerParPaquets(base, instructions);
    n++;
  }
  return n;
}

/** Cron : détail brut de plus de 90 jours, déjà agrégé, effacé. Rend le nombre de lignes. */
export async function purgerUsage(base, { maintenant = Date.now() } = {}) {
  const agrege = await lireReglage(base, 'agrege_jusqua');
  if (!agrege) return 0;
  const seuil = Math.min(maintenant - RETENTION_BRUT_JOURS * JOUR_MS, debutDuJour(agrege));
  const r = await base.executer('DELETE FROM usage_evenements WHERE cree_le < ?', [iso(seuil)]);
  return Number(r?.changements ?? 0);
}

// ------------------------------------------------------------------ RGPD

/** Instructions d'effacement de l'usage d'un compte (à mettre dans le lot de la suppression du compte). */
export function effacementUsage(compte) {
  return ['usage_evenements', ...TABLES_JOUR].map(table => ({ sql: `DELETE FROM ${table} WHERE compte_id = ?`, params: [compte] }));
}

/** Usage d'un compte pour son export RGPD : détail brut (90 jours) et résumé par jour et par page. */
export async function exportUsage(base, compte) {
  const brut = await base.tous('SELECT genre, page, team_id, action, duree_ms, appareil, langue, message, cree_le FROM usage_evenements WHERE compte_id = ? ORDER BY cree_le LIMIT ?', [compte, 5000]);
  const jours = await base.tous('SELECT jour, appareil, langue, sessions, vues, duree_ms, actions, erreurs FROM usage_jour_membres WHERE compte_id = ? ORDER BY jour LIMIT ?', [compte, 5000]);
  const pages = await base.tous('SELECT page, SUM(vues) AS vues, SUM(duree_ms) AS duree FROM usage_jour_pages WHERE compte_id = ? GROUP BY page ORDER BY page', [compte]);
  return {
    mention: 'Statistiques d’usage internes, visibles par l’administrateur (Fondateur) : pages ouvertes, durées, actions clés, type d’appareil, langue, erreurs techniques. Jamais de contenu ni d’adresse IP.',
    evenements: brut.map(e => ({ date: e.cree_le, genre: e.genre, page: e.page ?? null, team: e.team_id ?? null, action: e.action ?? null, dureeMs: Number(e.duree_ms), appareil: e.appareil, langue: e.langue, erreur: e.message ?? null })),
    parJour: jours.map(j => ({ jour: j.jour, appareil: j.appareil, langue: j.langue, sessions: Number(j.sessions), vues: Number(j.vues), dureeMs: Number(j.duree_ms), actions: Number(j.actions), erreurs: Number(j.erreurs) })),
    parPage: pages.map(p => ({ page: p.page, vues: Number(p.vues), dureeMs: Number(p.duree) })),
  };
}

/** Jours civils de Paris d'une date saisie (« AAAA-MM-JJ ») ; `undefined` si illisible. */
export const jourValide = texte => (typeof texte === 'string' && lireDate(texte) ? texte : undefined);
