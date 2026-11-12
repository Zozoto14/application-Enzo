/**
 * Accès à l'API du site LigneZero (lz.appdashboard.fr, dépôt site-ligne-zero), hébergé sur le même compte o2switch.
 *
 * Protocole signé (site à jour, docs/securite.md) : la clé du pont CLE_PONT de ~/.lignezero/api.env (créée par le
 * déploiement du site, jamais recopiée à la main) ne voyage JAMAIS. Chaque requête porte un horodatage, un nonce
 * aléatoire et une signature HMAC-SHA256 de « méthode, chemin, horodatage, nonce, empreinte du corps » : une requête
 * interceptée ne peut être ni modifiée ni rejouée. Côté site, cette clé n'ouvre que les tournois, équipes et joueurs de
 * tournoi, et en lecture seule les matchs, lobbies, résultats et phases (salons de match) ; colonnes, filtres et
 * actions fermés.
 *
 * Compatibilité de déploiement : tant que le site n'a pas créé CLE_PONT (ancienne version), l'ancien accès par
 * « Bearer CLE_SERVICE » est utilisé ; le site le refuse à partir du 25/11/2026.
 *
 * Autre hébergement : LZ_API_URL et LZ_CLE_PONT (ou, ancien protocole, LZ_CLE) dans esport.env.
 * HTTPS obligatoire (sauf localhost, pour les essais).
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { echec } from '../outils.mjs';

export const LONGUEUR_MIN_CLE = 32;

export function configSite(env = process.env, lire = chemin => readFileSync(chemin, 'utf8')) {
  let clePont = env.LZ_CLE_PONT || '';
  let cle = env.LZ_CLE || '';
  let url = env.LZ_API_URL || '';
  if (!clePont || !url) {
    try {
      const v = Object.fromEntries(
        lire(env.LZ_ENV || join(homedir(), '.lignezero', 'api.env'))
          .split(/\r?\n/)
          .map(l => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l))
          .filter(Boolean)
          .map(m => [m[1], m[2].replace(/^(['"])(.*)\1$/, '$2')]),
      );
      clePont ||= v.CLE_PONT || '';
      // L'ancienne clé (celle du bot) ne sert plus dès que la clé du pont existe.
      if (!clePont) cle ||= v.CLE_SERVICE || '';
      url ||= v.URL_API || (v.URL_SITE ? `${v.URL_SITE.replace(/\/$/, '')}/api` : '');
    } catch {
      /* pas de site sur cet hébergement */
    }
  }
  if (clePont.length < LONGUEUR_MIN_CLE) clePont = '';
  return { url: (url || 'https://lz.appdashboard.fr/api').replace(/\/$/, ''), clePont, cle: clePont ? '' : cle };
}

/** Adresse acceptable : HTTPS, ou http://localhost pour les essais. */
export const adresseSure = url => /^https:\/\//i.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url);

/** En-têtes d'une requête signée (même calcul que api/serveur/cles.mjs du site). */
export function entetesSignes(cle, { methode = 'POST', chemin = '/rest', corps, maintenant = Date.now(), nonce = randomBytes(18).toString('base64url') }) {
  const horodatage = String(maintenant);
  const empreinte = createHash('sha256').update(corps).digest('hex');
  const signature = createHmac('sha256', cle).update(`LZ1\n${methode}\n${chemin}\n${horodatage}\n${nonce}\n${empreinte}`).digest('base64url');
  return { 'x-lz-horodatage': horodatage, 'x-lz-nonce': nonce, 'x-lz-signature': signature };
}

/** Colonnes lues sur le site : seulement celles dont le pont a besoin. */
const COLONNES = {
  tournaments: 'id,name,status,created_at',
  tournament_teams: 'id,tournament_id,name,tag',
  tournament_players: 'id,team_id,pseudo,role,is_captain,discord_id,embark_id,sort_order',
  // Salons de match (lecture seule côté site) : matchs 1v1, lobbies à N équipes, résultats, phases.
  tournament_matches: 'id,tournament_id,stage_id,bracket,round,position,group_label,team_a_id,team_b_id,score_a,score_b,winner_id,status,scheduled_at,stream_url',
  tournament_lobbies: 'id,tournament_id,round,position,label,status,scheduled_at,stream_url',
  tournament_lobby_entries: 'id,lobby_id,team_id,placement,points,dnf,sort_order',
  tournament_stages: 'id,tournament_id,kind,name,sort_order',
};

/**
 * `config` : `{ url, clePont, cle }`, ou une fonction qui la rend (relue au plus une fois par minute) : une clé créée
 * ou changée sur le site (déploiement, rotation) est prise sans redémarrer l'app.
 */
export function clientSite(config, fetchSite = (...a) => globalThis.fetch(...a), { maintenant = Date.now } = {}) {
  let lue = null;
  let le = 0;
  const conf = () => {
    if (typeof config !== 'function') return config;
    if (!lue || maintenant() - le > 60_000) {
      lue = config();
      le = maintenant();
    }
    return lue;
  };
  async function rq(d) {
    const { url, clePont = '', cle = '' } = conf();
    if (!clePont && !cle) throw echec(503, 'site-non-configure', 'Site LigneZero introuvable sur cet hébergement (clé du pont absente).');
    if (!adresseSure(url)) throw echec(503, 'site-non-https', 'Adresse du site LigneZero refusée : HTTPS obligatoire.');
    const corps = JSON.stringify(d);
    const entetes = clePont ? entetesSignes(clePont, { corps }) : { authorization: `Bearer ${cle}` };
    let r;
    try {
      r = await fetchSite(`${url}/rest`, {
        method: 'POST',
        headers: { ...entetes, 'content-type': 'application/json' },
        body: corps,
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw echec(502, 'site-injoignable', 'Le site LigneZero ne répond pas.');
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw echec(502, 'site-refus', `Site LigneZero : ${String(j?.error?.message ?? `erreur ${r.status}`).slice(0, 200)}`);
    return j.data;
  }
  const eq = (col, val) => ({ col, op: 'eq', val });
  return {
    get configure() {
      return Boolean(conf().clePont || conf().cle);
    },
    get signe() {
      return Boolean(conf().clePont);
    },
    lister: (table, filters = [], order = []) => rq({ table, action: 'select', columns: COLONNES[table] ?? '*', filters, order }),
    inserer: (table, rows) => rq({ table, action: 'insert', rows, returning: true }),
    modifier: (table, id, values) => rq({ table, action: 'update', values, filters: [eq('id', id)], returning: true }),
    supprimer: (table, id) => rq({ table, action: 'delete', filters: [eq('id', id)] }),
    supprimerOu: (table, col, val) => rq({ table, action: 'delete', filters: [eq(col, val)] }),
  };
}
