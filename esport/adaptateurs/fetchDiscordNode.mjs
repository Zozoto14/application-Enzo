/**
 * Transport HTTPS de l'API REST de Discord pour le serveur Node (o2switch) : même contrat que `fetch` pour
 * `rest()` (tickets/discord.mjs), mais avec une CONNEXION PERSISTANTE (HTTP/1.1 keep-alive, `https.Agent`).
 *
 * Pourquoi : le `fetch` global de Node 22 (undici) referme une connexion inutilisée après 4 s. Entre deux arrivées
 * dans un hub vocal (souvent plusieurs minutes), chaque appel payait donc une nouvelle résolution DNS, une connexion
 * TCP et une négociation TLS avant même que Discord ne crée le salon. Ici la connexion reste ouverte (55 s sans
 * usage au plus, durée renouvelée par l'appel léger du moteur vocal toutes les 50 s : `garderChaud`).
 *
 * Utilisé par le moteur des salons vocaux (création, déplacement : le chemin critique). Corps texte (JSON) ou
 * FormData (multipart, mis en mémoire). Réponse : un objet `Response` (corps lu en entier). `init.signal` respecté.
 * Une connexion gardée que Discord a refermée entre-temps (ECONNRESET avant toute réponse) : l'appel est refait UNE
 * fois sur une connexion neuve, sauf pour POST (jamais deux créations). Rien n'est journalisé (le jeton est dans les
 * en-têtes). La réponse porte l'en-tête `x-esport-connexion` (`reutilisee` ou `neuve`), lu par les mesures du
 * moteur (rest() le rend dans `connexion`).
 */

import https from 'node:https';

const SANS_CORPS = new Set([101, 204, 205, 304]);
const RESEAU_REPRENABLE = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED']);

/** Agent persistant (un par transport). */
export function agentDiscord({ inactiviteMs = 55_000, maxConnexions = 16 } = {}) {
  return new https.Agent({ keepAlive: true, keepAliveMsecs: 15_000, maxSockets: maxConnexions, maxFreeSockets: 4, timeout: inactiviteMs, scheduling: 'lifo' });
}

async function corpsDe(init) {
  const b = init.body;
  if (b === undefined || b === null) return { octets: null, type: null };
  if (typeof b === 'string') return { octets: Buffer.from(b, 'utf8'), type: null };
  if (b instanceof Uint8Array) return { octets: Buffer.from(b), type: null };
  // FormData, Blob… : sérialisés comme le ferait fetch (frontière multipart comprise).
  const req = new Request('https://discord.com/', { method: 'POST', body: b });
  return { octets: Buffer.from(await req.arrayBuffer()), type: req.headers.get('content-type') };
}

function erreurAbandon(signal) {
  const raison = signal?.reason;
  if (raison instanceof Error) return raison;
  const e = new Error('Requête abandonnée');
  e.name = 'AbortError';
  return e;
}

/**
 * Crée le `fetch` persistant. `agent` (tests) : un agent fourni ; `module` (tests) : `node:http` pour un faux serveur.
 * L'objet rendu porte `agent` (pour vérifier la configuration) et `fermer()`.
 */
export function creerFetchDiscordNode({ agent = agentDiscord(), module = https } = {}) {
  function une(u, init, octets, typeCorps) {
    const signal = init.signal ?? null;
    return new Promise((ok, ko) => {
      if (signal?.aborted) return ko(erreurAbandon(signal));
      const entetes = { ...(init.headers ?? {}) };
      if (typeCorps && !Object.keys(entetes).some(k => k.toLowerCase() === 'content-type')) entetes['Content-Type'] = typeCorps;
      if (octets) entetes['Content-Length'] = String(octets.length);
      let repondu = false;
      const req = module.request(
        { protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: `${u.pathname}${u.search}`, method: init.method ?? 'GET', headers: entetes, agent },
        res => {
          repondu = true;
          const morceaux = [];
          res.on('data', m => morceaux.push(m));
          res.on('error', e => ko(e));
          res.on('end', () => {
            const h = new Headers();
            for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(', ') : String(v));
            h.set('x-esport-connexion', req.reusedSocket ? 'reutilisee' : 'neuve');
            const statut = res.statusCode ?? 0;
            const corps = SANS_CORPS.has(statut) ? null : Buffer.concat(morceaux);
            try {
              ok(new Response(corps, { status: statut < 200 || statut > 599 ? 502 : statut, headers: h }));
            } catch (e) {
              ko(e);
            }
          });
        },
      );
      const abandon = () => req.destroy(erreurAbandon(signal));
      signal?.addEventListener('abort', abandon, { once: true });
      req.on('close', () => signal?.removeEventListener('abort', abandon));
      req.on('error', e => {
        e.reprenable = !repondu && req.reusedSocket && RESEAU_REPRENABLE.has(e.code) && !signal?.aborted;
        ko(e);
      });
      if (octets) req.end(octets);
      else req.end();
    });
  }

  async function fetchDiscordNode(url, init = {}) {
    const u = new URL(String(url));
    const { octets, type } = await corpsDe(init);
    try {
      return await une(u, init, octets, type);
    } catch (e) {
      if (e?.reprenable && String(init.method ?? 'GET').toUpperCase() !== 'POST') return une(u, init, octets, type);
      throw e;
    }
  }
  fetchDiscordNode.agent = agent;
  fetchDiscordNode.persistant = true;
  fetchDiscordNode.fermer = () => agent.destroy();
  return fetchDiscordNode;
}
