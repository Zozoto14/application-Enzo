/**
 * Transport HTTP du MOTEUR LOCAL (llama-server sur http://127.0.0.1:<port>), à la place du `fetch` global.
 *
 * Pourquoi : le `fetch` de Node (undici) abandonne une requête après 300 s sans en-têtes de réponse
 * (`headersTimeout`) ou 300 s sans données (`bodyTimeout`), quoi qu'indique l'AbortSignal. Or llama-server,
 * sans streaming, n'envoie ses en-têtes qu'à la FIN de la génération : un brouillon (jusqu'à 4096 jetons
 * à ~6 jetons/s, plus la lecture d'un long prompt) dure 5 à 15 minutes. Le `fetch` global échouait donc à
 * 300 s (« fetch failed », cause UND_ERR_HEADERS_TIMEOUT), vu comme « Service d'IA injoignable ».
 *
 * Ici : `node:http`, sans agent partagé (aucun délai de socket), 127.0.0.1 seulement. Le SEUL délai est
 * celui de l'appelant (AbortSignal : IA_LOCALE_DELAI_MIN). `delaiEntetesMs` (facultatif, tests) borne
 * l'attente des en-têtes, comme undici, avec le même code d'erreur (UND_ERR_HEADERS_TIMEOUT).
 *
 * Rend une `Response` (même contrat que fetch) : le connecteur ne change pas.
 */

import http from 'node:http';
import { Readable } from 'node:stream';

const SANS_CORPS = new Set([204, 205, 304]);

/** Erreur au format de fetch (TypeError « fetch failed » + `cause.code`), pour un diagnostic uniforme. */
function erreurFetch(cause) {
  return new TypeError('fetch failed', { cause });
}

export function creerFetchLocal({ delaiEntetesMs = null } = {}) {
  return function fetchLocal(url, init = {}) {
    return new Promise((ok, ko) => {
      let u;
      try {
        u = new URL(url);
      } catch (e) {
        ko(erreurFetch(e));
        return;
      }
      // Moteur local seulement : jamais une autre adresse par ce chemin.
      if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || u.username || u.password) {
        ko(erreurFetch(Object.assign(new Error('adresse refusée (moteur local seulement)'), { code: 'ADRESSE_REFUSEE' })));
        return;
      }
      const signal = init.signal ?? null;
      if (signal?.aborted) {
        ko(signal.reason ?? new DOMException('This operation was aborted', 'AbortError'));
        return;
      }
      const corps = init.body === undefined || init.body === null ? null : Buffer.from(String(init.body), 'utf8');
      const entetes = { ...(init.headers ?? {}) };
      if (corps) entetes['Content-Length'] = String(corps.length);
      let fini = false;
      let minuteur = null;
      const surAbandon = () => {
        req.destroy();
        terminer(() => ko(signal.reason ?? new DOMException('This operation was aborted', 'AbortError')));
      };
      const terminer = action => {
        if (fini) return;
        fini = true;
        clearTimeout(minuteur);
        action();
      };
      // `agent: false` : socket dédiée, sans le délai d'inactivité de l'agent global.
      const req = http.request({ host: '127.0.0.1', port: Number(u.port) || 80, path: `${u.pathname}${u.search}`, method: init.method ?? 'GET', headers: entetes, agent: false }, res => {
        terminer(() => {
          const statut = res.statusCode ?? 0;
          if (statut < 200 || statut > 599) {
            res.resume();
            ko(erreurFetch(Object.assign(new Error(`statut ${statut}`), { code: 'STATUT_INVALIDE' })));
            return;
          }
          const sansCorps = SANS_CORPS.has(statut);
          if (sansCorps) res.resume();
          const type = res.headers['content-type'];
          // Abandon pendant la lecture du corps : le flux se termine en erreur (lecture bornée → réponse illisible).
          if (signal) {
            const coupure = () => res.destroy(signal.reason ?? new Error('abandon'));
            signal.addEventListener('abort', coupure, { once: true });
            res.once('close', () => signal.removeEventListener('abort', coupure));
          }
          ok(new Response(sansCorps ? null : Readable.toWeb(res), { status: statut, headers: typeof type === 'string' ? { 'Content-Type': type } : {} }));
        });
        signal?.removeEventListener('abort', surAbandon);
      });
      req.on('error', e => {
        signal?.removeEventListener('abort', surAbandon);
        terminer(() => ko(erreurFetch(e)));
      });
      signal?.addEventListener('abort', surAbandon, { once: true });
      if (Number.isFinite(delaiEntetesMs) && delaiEntetesMs > 0) {
        minuteur = setTimeout(() => {
          req.destroy();
          signal?.removeEventListener('abort', surAbandon);
          terminer(() => ko(erreurFetch(Object.assign(new Error('Headers Timeout Error'), { code: 'UND_ERR_HEADERS_TIMEOUT' }))));
        }, delaiEntetesMs);
      }
      req.end(corps ?? undefined);
    });
  };
}

/** Transport par défaut du connecteur local : aucun délai autre que celui de l'appelant. */
export const fetchLocal = creerFetchLocal();
