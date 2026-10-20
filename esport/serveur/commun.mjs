/**
 * Briques communes aux serveurs Node autonomes (Esport et relais), pour un
 * hébergement hors Cloudflare (o2switch « Setup Node.js App » / Passenger, ou
 * tout serveur derrière un proxy HTTPS). Aucune dépendance.
 *
 *  - `chargerEnv(fichier)` : lit un fichier `.env` (CLE=valeur) HORS du dépôt ;
 *    les variables déjà définies (interface cPanel) gardent la priorité ;
 *  - `creerServeurHttp(traiter, options)` : pont node:http ↔ Request/Response
 *    standard (le cœur des Workers tourne tel quel), corps borné, adresse IP
 *    du client fiable (anti-usurpation de CF-Connecting-IP), en-têtes de
 *    sécurité, tâches « après la réponse » (équivalent de `ctx.waitUntil`).
 */

import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Fichier d'environnement par défaut d'une app : ~/.appdashboard/<nom>.env (hors du dépôt, hors public_html). */
export const fichierEnvParDefaut = nom => join(homedir(), '.appdashboard', `${nom}.env`);

/** Lit un fichier .env simple (CLE=valeur, # commentaires, guillemets facultatifs). Rend les clés lues. */
export function lireFichierEnv(texte) {
  const sortie = {};
  for (const brute of String(texte).split(/\r?\n/)) {
    const ligne = brute.trim();
    if (!ligne || ligne.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(ligne);
    if (!m) continue;
    let valeur = m[2].trim();
    if ((valeur.startsWith('"') && valeur.endsWith('"')) || (valeur.startsWith("'") && valeur.endsWith("'"))) valeur = valeur.slice(1, -1);
    sortie[m[1]] = valeur;
  }
  return sortie;
}

/**
 * Complète `process.env` avec le fichier (s'il existe). Une variable déjà posée (Setup Node.js App)
 * n'est jamais écrasée. Rend le chemin lu, ou null.
 */
export function chargerEnv(fichier, env = process.env) {
  if (!fichier || !existsSync(fichier)) return null;
  for (const [cle, valeur] of Object.entries(lireFichierEnv(readFileSync(fichier, 'utf8')))) {
    if (env[cle] === undefined || env[cle] === '') env[cle] = valeur;
  }
  return fichier;
}

/** Vérifie la version de Node (fetch, Request, WebCrypto globaux ; testé sous Node 22). */
export function exigerNode(minimum = 22) {
  const majeure = Number(process.versions.node.split('.')[0]);
  if (majeure < minimum) throw new Error(`Node ${minimum} ou plus est nécessaire (version actuelle : ${process.versions.node}). Choisissez-la dans « Setup Node.js App ».`);
}

const ENTETES_SECURITE_DEFAUT = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

/**
 * Adresse IP du client. Derrière le proxy de l'hébergeur (Apache + Passenger), la DERNIÈRE entrée de
 * X-Forwarded-For est celle que le proxy a vue (les précédentes viennent du client et peuvent être
 * inventées) ; sans proxy (`confianceProxy: false`), l'adresse de la connexion.
 */
export function ipClient(req, { confianceProxy = true } = {}) {
  if (confianceProxy) {
    const xff = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
  }
  return req.socket?.remoteAddress ?? '';
}

/**
 * Serveur HTTP Node autour d'un gestionnaire `traiter(requete, { attendre })` → Response.
 * Options : `urlPublique` (https://esport.appdashboard.fr : base des adresses vues par le cœur),
 * `tailleMax` (octets), `confianceProxy`, `entetes` (ajoutés s'ils manquent).
 */
export function creerServeurHttp(traiter, { urlPublique, tailleMax = 25 * 1024 * 1024, confianceProxy = true, entetes = ENTETES_SECURITE_DEFAUT, journal = console } = {}) {
  const base = urlPublique ? String(urlPublique).replace(/\/+$/, '') : undefined;
  return http.createServer(async (req, res) => {
    const enAttente = [];
    try {
      const morceaux = [];
      let taille = 0;
      for await (const m of req) {
        taille += m.length;
        if (taille > tailleMax) {
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', ...entetes });
          res.end(JSON.stringify({ erreur: 'Requête trop volumineuse.', code: 'trop-gros' }));
          req.destroy();
          return;
        }
        morceaux.push(m);
      }
      const headers = new Headers();
      for (const [nom, valeur] of Object.entries(req.headers)) {
        if (valeur === undefined) continue;
        // Jamais d'en-tête « Cloudflare » venu du client : CF-Connecting-IP est recalculé ici.
        if (nom === 'cf-connecting-ip' || nom.startsWith(':')) continue;
        headers.set(nom, Array.isArray(valeur) ? valeur.join(', ') : valeur);
      }
      const ip = ipClient(req, { confianceProxy });
      if (ip) headers.set('CF-Connecting-IP', ip);
      const origine = base ?? `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host ?? 'localhost'}`;
      const requete = new Request(`${origine}${req.url}`, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(morceaux),
      });
      const reponse = await traiter(requete, { attendre: p => enAttente.push(Promise.resolve(p).catch(e => journal.error('[serveur] tâche après réponse', e))) });
      const sortie = {};
      reponse.headers.forEach((v, k) => {
        sortie[k] = v;
      });
      for (const [k, v] of Object.entries(entetes)) if (!reponse.headers.has(k)) sortie[k] = v;
      res.writeHead(reponse.status, sortie);
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await reponse.arrayBuffer()));
    } catch (e) {
      journal.error('[serveur] erreur', e);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', ...entetes });
      res.end(JSON.stringify({ erreur: 'Erreur interne du serveur.', code: 'interne' }));
    } finally {
      await Promise.all(enAttente);
    }
  });
}

/** Écoute sur PORT (Passenger le fournit et redirige lui-même) ; rend l'adresse locale. */
export function ecouter(serveur, { port = Number(process.env.PORT) || 3000, hote } = {}) {
  return new Promise((ok, ko) => {
    serveur.once('error', ko);
    const fini = () => {
      const a = serveur.address();
      ok(typeof a === 'string' ? a : `http://127.0.0.1:${a?.port}`);
    };
    // Passenger peut fournir un chemin de socket dans PORT : listen() l'accepte tel quel.
    if (hote) serveur.listen(port, hote, fini);
    else serveur.listen(port, fini);
  });
}
