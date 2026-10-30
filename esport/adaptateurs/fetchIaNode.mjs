/**
 * Transport HTTP des moteurs d'IA externes pour le serveur Node (o2switch) : node:https (node:http pour les
 * faux serveurs des tests), même contrat que `fetch` pour le connecteur (`creerConnecteur({ fetch })`), mais
 * avec les ÉTAPES de chaque requête mesurées et nommées :
 *
 *   dns            résolution du nom (integrate.api.nvidia.com → adresse IP)
 *   connexion      connexion TCP
 *   tls            négociation TLS (https)
 *   premier-octet  requête envoyée, attente du début de la réponse (en-têtes HTTP) : sans flux, c'est tout
 *                  le calcul du modèle
 *   lecture        lecture du corps de la réponse
 *
 * La réponse porte `etapesIa` ({ ip, famille, dnsMs, connexionMs, tlsMs, premierOctetMs, finMs, octets } :
 * durées depuis le début de la requête, `finMs` rempli quand le corps est lu) ; une erreur porte `phase`
 * (l'étape où elle s'est produite) et `etapes`. Délai de CONNEXION propre (`connexionMs`, DNS + TCP + TLS) ;
 * le reste est borné par `init.signal` (le connecteur pose le délai total et celui du premier octet).
 *
 * `ipv4: true` (IA_IPV4=oui) : connexion en IPv4 seulement (hébergeur dont l'IPv6 sortante est cassée).
 * Une connexion neuve par requête (`agent: false`) : jamais de socket keep-alive réutilisée et morte, et les
 * étapes sont toujours mesurées. Rien n'est journalisé ici (ni en-têtes, ni corps : la clé est dans les en-têtes).
 */

import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { etapesTexte } from '../noyau/ia/connecteur.mjs';

export { etapesTexte };

export const ETAPES_IA = ['dns', 'connexion', 'tls', 'premier-octet', 'lecture'];
const STATUTS_SANS_CORPS = new Set([204, 205, 304]);

/** Erreur de transport nommée par son étape. */
function erreurEtape(origine, phase, etapes, { nom, code } = {}) {
  const e = origine instanceof Error ? origine : new Error(String(origine ?? 'erreur'));
  if (nom) e.name = nom;
  if (code && !e.code) e.code = code;
  e.phase = phase;
  e.etapes = { ...etapes };
  return e;
}

/** Nom de l'erreur d'un abandon : `TimeoutError` (délai) ou `AbortError`. */
const nomAbandon = signal => (signal?.reason?.name === 'TimeoutError' ? 'TimeoutError' : 'AbortError');

/**
 * `fetch` des moteurs d'IA (voir l'en-tête). `maintenant` : horloge en ms (performance.now par défaut).
 * `init` : { method, headers (objet), body (texte), signal } ; `redirect` est ignoré (aucune redirection suivie).
 */
export function creerFetchIaNode({ ipv4 = false, connexionMs = 15_000, maintenant = () => performance.now() } = {}) {
  return function fetchIaNode(url, init = {}) {
    const u = new URL(url);
    const module = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null;
    if (!module) return Promise.reject(new TypeError('Adresse non prise en charge (https seulement).'));
    const signal = init.signal ?? null;
    const t0 = maintenant();
    const depuis = () => maintenant() - t0;
    const etapes = { ip: null, famille: null, tls: u.protocol === 'https:', dnsMs: null, connexionMs: null, tlsMs: null, premierOctetMs: null, finMs: null, octets: 0 };
    // Adresse IP littérale : pas de résolution DNS.
    let phase = isIP(u.hostname.replace(/^\[|\]$/g, '')) ? 'connexion' : 'dns';
    if (phase === 'connexion') etapes.dnsMs = 0;
    return new Promise((ok, ko) => {
      if (signal?.aborted) {
        ko(erreurEtape(new Error('requête abandonnée'), phase, etapes, { nom: nomAbandon(signal) }));
        return;
      }
      let reponse = null;
      let fin = false;
      let minuterieConnexion = null;
      const nettoyer = () => {
        clearTimeout(minuterieConnexion);
        signal?.removeEventListener?.('abort', surAbandon);
      };
      const echouer = e => {
        if (fin) return;
        fin = true;
        nettoyer();
        ko(e);
      };
      const corps = typeof init.body === 'string' || init.body instanceof Uint8Array ? init.body : init.body === undefined || init.body === null ? null : String(init.body);
      const entetes = { ...(init.headers ?? {}) };
      if (corps !== null) entetes['Content-Length'] = String(Buffer.byteLength(corps));
      const req = module.request(u, { method: init.method ?? 'GET', headers: entetes, agent: false, ...(ipv4 ? { family: 4 } : {}) });
      function surAbandon() {
        const e = erreurEtape(new Error('requête abandonnée'), phase, etapes, { nom: nomAbandon(signal) });
        if (reponse) reponse.destroy(e);
        else req.destroy(e);
      }
      signal?.addEventListener?.('abort', surAbandon, { once: true });
      minuterieConnexion = setTimeout(() => {
        if (phase === 'dns' || phase === 'connexion' || phase === 'tls') req.destroy(erreurEtape(new Error(`délai de connexion dépassé (${phase})`), phase, etapes, { nom: 'TimeoutError', code: 'DELAI_CONNEXION' }));
      }, connexionMs);
      minuterieConnexion.unref?.();
      req.on('socket', s => {
        s.on('lookup', (err, adresse, famille) => {
          if (err || etapes.dnsMs !== null) return;
          etapes.dnsMs = depuis();
          if (typeof adresse === 'string') {
            etapes.ip = adresse;
            etapes.famille = famille === 6 || famille === 'IPv6' ? 6 : 4;
          }
          phase = 'connexion';
        });
        s.once('connect', () => {
          if (etapes.dnsMs === null) etapes.dnsMs = depuis();
          etapes.connexionMs = depuis();
          if (s.remoteAddress) {
            etapes.ip = s.remoteAddress;
            etapes.famille = s.remoteFamily === 'IPv6' ? 6 : 4;
          }
          phase = etapes.tls ? 'tls' : 'premier-octet';
          if (!etapes.tls) clearTimeout(minuterieConnexion);
        });
        s.once('secureConnect', () => {
          etapes.tlsMs = depuis();
          phase = 'premier-octet';
          clearTimeout(minuterieConnexion);
        });
      });
      req.on('error', e => echouer(e.phase ? e : erreurEtape(e, phase, etapes)));
      req.on('response', res => {
        reponse = res;
        etapes.premierOctetMs = depuis();
        phase = 'lecture';
        clearTimeout(minuterieConnexion);
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (Array.isArray(v)) for (const x of v) h.append(k, x);
          else if (v !== undefined) h.set(k, String(v));
        }
        let ferme = false;
        const flux = STATUTS_SANS_CORPS.has(res.statusCode) || init.method === 'HEAD'
          ? null
          : new ReadableStream({
              start(ctrl) {
                const terminer = e => {
                  if (ferme) return;
                  ferme = true;
                  nettoyer();
                  if (e) ctrl.error(e);
                  else ctrl.close();
                };
                res.on('data', m => {
                  if (ferme) return;
                  etapes.octets += m.length;
                  ctrl.enqueue(new Uint8Array(m.buffer, m.byteOffset, m.byteLength));
                });
                res.on('end', () => {
                  etapes.finMs = depuis();
                  terminer(null);
                });
                res.on('error', e => terminer(e.phase ? e : erreurEtape(e, 'lecture', etapes)));
                res.on('close', () => {
                  if (!res.complete) terminer(erreurEtape(new Error('connexion coupée pendant la lecture'), 'lecture', etapes, { code: 'ECONNRESET' }));
                });
              },
              cancel() {
                ferme = true;
                nettoyer();
                res.destroy();
              },
            });
        if (!flux) {
          etapes.finMs = depuis();
          nettoyer();
          res.resume();
        }
        fin = true;
        const r = new Response(flux, { status: res.statusCode, statusText: res.statusMessage ?? '', headers: h });
        Object.defineProperty(r, 'etapesIa', { value: etapes, enumerable: false });
        ok(r);
      });
      if (corps !== null) req.end(corps);
      else req.end();
    });
  };
}

/** Transport des moteurs d'IA du serveur, réglé par l'environnement (IA_IPV4=oui : IPv4 seulement). */
export function fetchIaDepuisEnv(env = process.env) {
  const ipv4 = ['1', 'oui', 'true', 'yes', 'on'].includes(String(env.IA_IPV4 ?? '').trim().toLowerCase());
  return creerFetchIaNode({ ipv4 });
}
