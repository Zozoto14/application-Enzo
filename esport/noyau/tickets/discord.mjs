/**
 * Tickets : appels à l'API REST de Discord (v10) avec le jeton du bot, et calcul des permissions du bot.
 *
 * `rest()` lit la réponse (JSON), ne suit aucune redirection, borne le temps d'attente, respecte la limite de débit
 * (HTTP 429 : `retry_after`) : une attente courte (≤ 3 s) est faite une fois, au-delà l'appel échoue proprement
 * (`retryApresS`) et l'appelant réessaie plus tard (jamais de rafale). Le jeton n'est jamais journalisé.
 * Limites annoncées par Discord (en-têtes `X-RateLimit-Remaining` / `X-RateLimit-Reset-After`, par route et
 * paramètre majeur) : retenues en mémoire ; une route épuisée attend sa remise à zéro (≤ 3 s, sinon échec propre)
 * au lieu d'essuyer un 429. Aucune attente fixe sinon. `connexion` (transport persistant, adaptateurs/
 * fetchDiscordNode.mjs) : `reutilisee` ou `neuve`, pour les mesures.
 */

import { API_DISCORD } from '../discord/file.mjs';

const AGENT = 'DiscordBot (https://github.com/Zozoto14/application-Enzo, 1)';
const DELAI_MS = 10_000;

/** Permissions Discord (bits) utiles aux tickets. */
export const P = Object.freeze({
  ADMINISTRATEUR: 1n << 3n,
  GERER_SALONS: 1n << 4n,
  VOIR_SALON: 1n << 10n,
  ENVOYER: 1n << 11n,
  INTEGRER_LIENS: 1n << 14n,
  JOINDRE_FICHIERS: 1n << 15n,
  HISTORIQUE: 1n << 16n,
  GERER_ROLES: 1n << 28n,
  REACTIONS: 1n << 6n,
  CREER_FILS_PUBLICS: 1n << 35n,
  CREER_FILS_PRIVES: 1n << 36n,
  ENVOYER_FILS: 1n << 38n,
  // Salons vocaux temporaires (vocaux/) : se connecter, déplacer des membres (et les déconnecter).
  CONNECTER: 1n << 20n,
  DEPLACER: 1n << 24n,
});

/** Permissions demandées au bot pour les tickets (nom affiché dans l'app : clé de traduction côté app). */
export const PERMISSIONS_REQUISES = Object.freeze([
  ['voir_salons', P.VOIR_SALON],
  ['gerer_salons', P.GERER_SALONS],
  ['gerer_roles', P.GERER_ROLES],
  ['envoyer', P.ENVOYER],
  ['historique', P.HISTORIQUE],
  ['joindre', P.JOINDRE_FICHIERS],
  ['integrer', P.INTEGRER_LIENS],
]);

/** Droits donnés dans un salon de ticket ouvert à l'auteur et aux personnes ajoutées (et au staff, réglage désactivé). */
export const DROITS_PARTICIPANT = (P.VOIR_SALON | P.ENVOYER | P.HISTORIQUE | P.JOINDRE_FICHIERS | P.INTEGRER_LIENS).toString();
/**
 * « Le staff répond uniquement depuis l'AppDashboard » (Configuration › Général, activé par défaut) : les rôles Discord
 * de la catégorie LISENT le salon (voir, historique ; les boutons et les commandes slash restent utilisables,
 * « Utiliser les commandes de l'application » n'est pas refusé) mais n'y écrivent pas : envoyer des messages, écrire
 * dans les fils, créer des fils, ajouter des réactions sont refusés. L'auteur et les personnes ajoutées écrivent
 * toujours (DROITS_PARTICIPANT). `REFUS_ECRITURE_MINIMAL` : repli si Discord refuse les surcharges complètes (le bot ne
 * peut refuser que des permissions qu'il a lui-même).
 */
export const DROITS_LECTURE = (P.VOIR_SALON | P.HISTORIQUE).toString();
export const REFUS_ECRITURE = (P.ENVOYER | P.ENVOYER_FILS | P.CREER_FILS_PUBLICS | P.CREER_FILS_PRIVES | P.REACTIONS).toString();
export const REFUS_ECRITURE_MINIMAL = P.ENVOYER.toString();
/** Droits du bot dans le salon (il doit pouvoir tout y faire, même si un rôle lui refuse l'accès au serveur). */
export const DROITS_BOT = (P.VOIR_SALON | P.ENVOYER | P.HISTORIQUE | P.JOINDRE_FICHIERS | P.INTEGRER_LIENS | P.GERER_SALONS).toString();

export const idDiscord = v => (typeof v === 'string' && /^\d{5,25}$/.test(v) ? v : null);

const attendre = ms => new Promise(ok => setTimeout(ok, ms).unref?.());

/** Limites de débit connues (par route : méthode, chemin, identifiants non majeurs remplacés). */
const LIMITES = { routes: new Map(), globalJusqua: 0 };
const ATTENTE_MAX_MS = 3000;

export function cleRoute(methode, chemin) {
  const p = String(chemin).split('?')[0];
  return `${methode} ${p.replace(/\/(\d{5,25})/g, (m, _id, pos, tout) => (/\/(channels|guilds|webhooks)$/.test(tout.slice(0, pos)) ? m : '/:id'))}`;
}

/** Attente avant l'appel si la route (ou la limite globale) est épuisée : ms à attendre, ou -1 (trop long). */
function attenteLimite(cle, t) {
  const g = LIMITES.globalJusqua - t;
  const e = LIMITES.routes.get(cle);
  const r = e && e.restant <= 0 ? e.remiseLe - t : 0;
  const ms = Math.max(0, g, r);
  if (e && e.remiseLe > t) e.restant -= 1;
  return ms > ATTENTE_MAX_MS ? -1 : ms;
}

function noterLimite(cle, r, t) {
  const restant = Number(r.headers?.get?.('X-RateLimit-Remaining'));
  const apres = Number(r.headers?.get?.('X-RateLimit-Reset-After'));
  if (r.headers?.get?.('X-RateLimit-Remaining') != null && Number.isFinite(restant) && Number.isFinite(apres)) {
    LIMITES.routes.set(cle, { restant, remiseLe: t + Math.ceil(apres * 1000) });
    if (LIMITES.routes.size > 500) LIMITES.routes.delete(LIMITES.routes.keys().next().value);
  }
}

/** Tests : limites oubliées. */
export function oublierLimites() {
  LIMITES.routes.clear();
  LIMITES.globalJusqua = 0;
}

/**
 * Appel REST. Rend `{ ok, statut, corps, retryApresS?, code? }`. `fichiers` : `[{ nom, type, octets }]` (multipart).
 */
export async function rest(fetchDiscord, jetonBot, methode, chemin, corps, { fichiers, raison, essai = 0 } = {}) {
  if (!jetonBot) return { ok: false, statut: 0, motif: 'bot-absent' };
  const multipart = Array.isArray(fichiers) && fichiers.length > 0;
  let body;
  if (multipart) {
    body = new FormData();
    body.append('payload_json', JSON.stringify({ ...(corps ?? {}), attachments: fichiers.map((f, i) => ({ id: i, filename: f.nom })) }));
    fichiers.forEach((f, i) => body.append(`files[${i}]`, new Blob([f.octets], { type: f.type }), f.nom));
  } else if (corps !== undefined) body = JSON.stringify(corps);
  const cle = cleRoute(methode, chemin);
  const attente = attenteLimite(cle, Date.now());
  if (attente < 0) {
    const e = LIMITES.routes.get(cle);
    return { ok: false, statut: 429, retryApresS: Math.max(1, Math.ceil((Math.max(LIMITES.globalJusqua, e?.remiseLe ?? 0) - Date.now()) / 1000)), motif: 'limite' };
  }
  if (attente > 0) await attendre(attente);
  let r;
  try {
    r = await fetchDiscord(`${API_DISCORD}${chemin}`, {
      method: methode,
      headers: {
        Authorization: `Bot ${jetonBot}`,
        'User-Agent': AGENT,
        ...(body !== undefined && !multipart ? { 'Content-Type': 'application/json' } : {}),
        ...(raison ? { 'X-Audit-Log-Reason': encodeURIComponent(String(raison).slice(0, 200)) } : {}),
      },
      ...(body !== undefined ? { body } : {}),
      redirect: 'manual',
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch {
    return { ok: false, statut: 0, motif: 'injoignable' };
  }
  let lu = null;
  try {
    const texte = await r.text();
    lu = texte ? JSON.parse(texte) : null;
  } catch {
    lu = null;
  }
  noterLimite(cle, r, Date.now());
  const connexion = r.headers?.get?.('x-esport-connexion') ?? undefined;
  if (r.status === 429) {
    const entete = Number(r.headers?.get?.('Retry-After'));
    const s = Math.max(Number.isFinite(entete) ? entete : 0, Number(lu?.retry_after) || 0, 0.5);
    if (lu?.global === true || r.headers?.get?.('X-RateLimit-Global')) LIMITES.globalJusqua = Date.now() + Math.ceil(s * 1000);
    if (s <= 3 && essai === 0) {
      await attendre(Math.ceil(s * 1000));
      return rest(fetchDiscord, jetonBot, methode, chemin, corps, { fichiers, raison, essai: 1 });
    }
    return { ok: false, statut: 429, retryApresS: Math.min(3600, Math.ceil(s)), motif: 'limite' };
  }
  if (r.status >= 200 && r.status < 300) return { ok: true, statut: r.status, corps: lu, ...(connexion ? { connexion } : {}) };
  return { ok: false, statut: r.status, code: Number.isInteger(lu?.code) ? lu.code : null, motif: `HTTP ${r.status}`, ...(connexion ? { connexion } : {}) };
}

/** Permissions effectives d'un membre dans le serveur (rôles), puis dans un salon (surcharges) : BigInt. */
export function permissionsMembre({ guildId, roles, membreRoles, salon, membreId }) {
  const parId = new Map((roles ?? []).map(r => [r.id, r]));
  let p = BigInt(parId.get(guildId)?.permissions ?? '0');
  for (const id of membreRoles ?? []) p |= BigInt(parId.get(id)?.permissions ?? '0');
  if (p & P.ADMINISTRATEUR) return (1n << 50n) - 1n;
  if (!salon) return p;
  const surcharges = salon.permission_overwrites ?? [];
  const appliquer = o => {
    if (!o) return;
    p &= ~BigInt(o.deny ?? '0');
    p |= BigInt(o.allow ?? '0');
  };
  appliquer(surcharges.find(o => o.id === guildId));
  let refus = 0n;
  let accord = 0n;
  for (const o of surcharges) {
    if (Number(o.type) === 0 && o.id !== guildId && (membreRoles ?? []).includes(o.id)) {
      refus |= BigInt(o.deny ?? '0');
      accord |= BigInt(o.allow ?? '0');
    }
  }
  p &= ~refus;
  p |= accord;
  appliquer(surcharges.find(o => Number(o.type) === 1 && o.id === membreId));
  return p;
}

/** Permissions requises qui manquent (clés), pour un ensemble de permissions. */
export const manquantes = p => PERMISSIONS_REQUISES.filter(([, bit]) => (p & bit) !== bit).map(([cle]) => cle);
