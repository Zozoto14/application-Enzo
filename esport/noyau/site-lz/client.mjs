/**
 * Accès à l'API du site LigneZero (lz.appdashboard.fr, dépôt site-ligne-zero), hébergé sur le même compte o2switch.
 * Clé : CLE_SERVICE de ~/.lignezero/api.env (créée par le déploiement du site, jamais recopiée à la main), ou
 * LZ_API_URL / LZ_CLE dans esport.env pour un autre hébergement. Requêtes au format de l'API du site (POST /api/rest).
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { echec } from '../outils.mjs';

export function configSite(env = process.env, lire = chemin => readFileSync(chemin, 'utf8')) {
  let cle = env.LZ_CLE || '';
  let url = env.LZ_API_URL || '';
  if (!cle || !url) {
    try {
      const v = Object.fromEntries(
        lire(env.LZ_ENV || join(homedir(), '.lignezero', 'api.env'))
          .split(/\r?\n/)
          .map(l => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l))
          .filter(Boolean)
          .map(m => [m[1], m[2].replace(/^(['"])(.*)\1$/, '$2')]),
      );
      cle ||= v.CLE_SERVICE || '';
      url ||= v.URL_API || (v.URL_SITE ? `${v.URL_SITE.replace(/\/$/, '')}/api` : '');
    } catch {
      /* pas de site sur cet hébergement */
    }
  }
  return { url: (url || 'https://lz.appdashboard.fr/api').replace(/\/$/, ''), cle };
}

export function clientSite({ url, cle }, fetchSite = (...a) => globalThis.fetch(...a)) {
  async function rq(corps) {
    if (!cle) throw echec(503, 'site-non-configure', 'Site LigneZero introuvable sur cet hébergement (clé de service absente).');
    let r;
    try {
      r = await fetchSite(`${url}/rest`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cle}`, 'content-type': 'application/json' },
        body: JSON.stringify(corps),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw echec(502, 'site-injoignable', 'Le site LigneZero ne répond pas.');
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw echec(502, 'site-refus', `Site LigneZero : ${j?.error?.message ?? `erreur ${r.status}`}`);
    return j.data;
  }
  const eq = (col, val) => ({ col, op: 'eq', val });
  return {
    configure: Boolean(cle),
    lister: (table, filters = [], order = []) => rq({ table, action: 'select', columns: '*', filters, order }),
    inserer: (table, rows) => rq({ table, action: 'insert', rows, returning: true }),
    modifier: (table, id, values) => rq({ table, action: 'update', values, filters: [eq('id', id)], returning: true }),
    supprimer: (table, id) => rq({ table, action: 'delete', filters: [eq('id', id)] }),
    supprimerOu: (table, col, val) => rq({ table, action: 'delete', filters: [eq(col, val)] }),
  };
}
