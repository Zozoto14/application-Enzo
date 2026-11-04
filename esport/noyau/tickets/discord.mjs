/**
 * Tickets : appels à l'API REST de Discord (v10) avec le jeton du bot, et calcul des permissions du bot.
 *
 * `rest()` lit la réponse (JSON), ne suit aucune redirection, borne le temps d'attente, respecte la limite de débit
 * (HTTP 429 : `retry_after`) : une attente courte (≤ 3 s) est faite une fois, au-delà l'appel échoue proprement
 * (`retryApresS`) et l'appelant réessaie plus tard (jamais de rafale). Le jeton n'est jamais journalisé.
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

/** Droits donnés dans un salon de ticket à l'auteur, aux rôles de la catégorie et aux personnes ajoutées. */
export const DROITS_PARTICIPANT = (P.VOIR_SALON | P.ENVOYER | P.HISTORIQUE | P.JOINDRE_FICHIERS | P.INTEGRER_LIENS).toString();
/** Droits du bot dans le salon (il doit pouvoir tout y faire, même si un rôle lui refuse l'accès au serveur). */
export const DROITS_BOT = (P.VOIR_SALON | P.ENVOYER | P.HISTORIQUE | P.JOINDRE_FICHIERS | P.INTEGRER_LIENS | P.GERER_SALONS).toString();

export const idDiscord = v => (typeof v === 'string' && /^\d{5,25}$/.test(v) ? v : null);

const attendre = ms => new Promise(ok => setTimeout(ok, ms).unref?.());

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
  if (r.status === 429) {
    const entete = Number(r.headers?.get?.('Retry-After'));
    const s = Math.max(Number.isFinite(entete) ? entete : 0, Number(lu?.retry_after) || 0, 0.5);
    if (s <= 3 && essai === 0) {
      await attendre(Math.ceil(s * 1000));
      return rest(fetchDiscord, jetonBot, methode, chemin, corps, { fichiers, raison, essai: 1 });
    }
    return { ok: false, statut: 429, retryApresS: Math.min(3600, Math.ceil(s)), motif: 'limite' };
  }
  if (r.status >= 200 && r.status < 300) return { ok: true, statut: r.status, corps: lu };
  return { ok: false, statut: r.status, code: Number.isInteger(lu?.code) ? lu.code : null, motif: `HTTP ${r.status}` };
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
