/**
 * Route `POST /tsuzuku/requete` du relais : lecture des pages des SOURCES de
 * Tsuzuku pour le SITE WEB (navigateur).
 *
 * Le navigateur ne peut pas lire une page d'un autre site (CORS) ; l'app PC le
 * fait par son processus principal (bureau/electron/tsuzuku.mjs), le site le
 * fait ici. Les règles de ce module sont celles du PC, PORTÉES en `fetch` :
 *
 *  - réservée au jeton MAÎTRE (compte Fondateur historique, celui qui a déployé
 *    le relais). Un jeton de profil — ami, gestionnaire, administrateur, autre
 *    Fondateur — reçoit 403 : le relais ne connaît pas d'autre liste de
 *    Fondateurs (`/rangs` ne porte que des délégations) ;
 *  - http(s) seulement, sans identifiants, ports 80/443/8080/8443 ;
 *  - aucune IP écrite en dur (privée, boucle locale, lien local, métadonnées
 *    cloud, IPv4 mappée en IPv6, notations décimale/octale/hexa que `URL`
 *    normalise) ; ni `localhost`, ni `.local`/`.internal`/`.lan`/…, ni nom sans
 *    point, ni le relais lui-même ;
 *  - le NOM est résolu (DNS sur HTTPS) avant l'appel : s'il pointe vers une
 *    adresse non publique, refus. LIMITE : un Worker n'a pas la main sur la
 *    connexion ; l'adresse vérifiée n'est donc pas forcément celle qui sert
 *    (« DNS rebinding » possible entre les deux). Le réseau de Cloudflare
 *    n'atteint de toute façon ni le réseau local de l'utilisateur ni ses
 *    propres adresses internes ;
 *  - les redirections ne sont PAS suivies (`redirect: 'manual'`) : la réponse
 *    3xx est rendue au site, dont le moteur revérifie chaque saut (5 au plus) ;
 *  - aucun cookie : aucun n'est envoyé (en-têtes sortants en liste blanche),
 *    aucun Set-Cookie n'est rendu (sa présence seule est signalée par
 *    `x-tsuzuku-cookie: 1`, comme sur le PC) ;
 *  - délai 15 s, réponse bornée (2 Mo : au-delà, elle est TRONQUÉE et le dit),
 *    requête bornée (corps JSON 96 Kio, corps sortant 64 Kio) ;
 *  - débit limité par jeton (60 requêtes par minute par défaut, compteur en
 *    mémoire du Worker : rien n'est écrit dans la boîte KV) ;
 *  - CORS restreint aux origines du site (`ORIGINES_SITE`), réponses
 *    `Cache-Control: no-store`, erreurs uniformes `{ erreur, code }` sans
 *    détail interne ; le journal ne garde que l'hôte, le statut et la durée.
 *
 * Aucune dépendance au runtime : testable sous Node (`tsuzuku.test.mjs`).
 */

export const CHEMIN_TSUZUKU = '/tsuzuku/requete';
export const PORTS_AUTORISES = [80, 443, 8080, 8443];
export const LONGUEUR_MAX_URL = 2048;
export const DELAI_MS = 15_000;
export const TAILLE_MAX_REPONSE = 2 * 1024 * 1024;
export const TAILLE_MAX_REQUETE = 96 * 1024;
export const CORPS_SORTANT_MAX = 64 * 1024;
export const LIMITE_PAR_MINUTE = 60;
const FENETRE_MS = 60_000;
const DOH = 'https://cloudflare-dns.com/dns-query';

/** En-têtes que le site peut faire envoyer (rien d'autre : ni Cookie, ni Authorization, ni Origin). */
export const ENTETES_SORTANTS = ['accept', 'accept-language', 'content-type', 'referer', 'user-agent', 'x-requested-with'];
/** En-têtes de la réponse rendus au site (le moteur s'en sert : type, redirection, pare-feu). */
export const ENTETES_RENDUS = ['content-type', 'content-language', 'location', 'retry-after', 'server', 'cf-mitigated', 'last-modified'];

const SUFFIXES_LOCAUX = [
  '.local', '.localdomain', '.lan', '.internal', '.intranet', '.home', '.corp', '.private', '.localhost',
  '.home.arpa', '.arpa', '.test', '.invalid', '.onion', '.example',
];
const NOMS_INTERDITS = new Set(['localhost', 'metadata', 'metadata.google.internal', 'instance-data', 'wpad', 'ip6-localhost', 'ip6-loopback', 'broadcasthost']);

export class RefusTsuzuku extends Error {
  constructor(message, code, statut) {
    super(message);
    this.code = code;
    this.statut = statut;
  }
}
const refus = (message, code = 'adresse', statut = 400) => new RefusTsuzuku(message, code, statut);

// ------------------------------------------------------------------ IP privées (même table que le PC)

function ipv4EnNombre(texte) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(texte);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.some(v => v > 255) ? null : ((o[0] * 256 + o[1]) * 256 + o[2]) * 256 + o[3];
}

const PLAGES_V4_PRIVEES = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => [ipv4EnNombre(base), bits]);

function ipv4Privee(valeur) {
  return PLAGES_V4_PRIVEES.some(([base, bits]) => {
    const taille = 2 ** (32 - bits);
    return Math.floor(valeur / taille) === Math.floor(base / taille);
  });
}

function ipv6EnGroupes(texte) {
  let t = texte.toLowerCase().split('%')[0];
  const fin4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(t);
  if (fin4) {
    const v = ipv4EnNombre(fin4[1]);
    if (v === null) return null;
    t = t.slice(0, -fin4[1].length) + ((v >>> 16) & 0xffff).toString(16) + ':' + (v & 0xffff).toString(16);
  }
  const parties = t.split('::');
  if (parties.length > 2) return null;
  const morceaux = s => (s === '' ? [] : s.split(':'));
  const debut = morceaux(parties[0]);
  const fin = parties.length === 2 ? morceaux(parties[1]) : [];
  const manque = 8 - debut.length - fin.length;
  if ((parties.length === 1 && manque !== 0) || manque < 0 || (parties.length === 2 && manque < 1)) return null;
  const tous = [...debut, ...Array(parties.length === 2 ? manque : 0).fill('0'), ...fin];
  if (tous.length !== 8 || tous.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return tous.map(g => parseInt(g, 16));
}

function ipv6Privee(g) {
  if (g.every(v => v === 0)) return true;
  if (g.slice(0, 7).every(v => v === 0) && g[7] === 1) return true;
  if (g.slice(0, 5).every(v => v === 0) && (g[5] === 0xffff || g[5] === 0)) return ipv4Privee(g[6] * 65536 + g[7]);
  if (g[0] === 0x64 && g[1] === 0xff9b) return ipv4Privee(g[6] * 65536 + g[7]);
  if (g[0] === 0x2002) return ipv4Privee(g[1] * 65536 + g[2]);
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  if ((g[0] & 0xffc0) === 0xfe80) return true;
  if ((g[0] & 0xffc0) === 0xfec0) return true;
  if ((g[0] & 0xff00) === 0xff00) return true;
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;
  return false;
}

const estIpv4 = t => ipv4EnNombre(t) !== null;
const estIpv6 = t => t.includes(':') && ipv6EnGroupes(t) !== null;

/** Vrai si l'IP (texte) n'est PAS publique, ou n'est pas une IP lisible. */
export function ipEstPrivee(ip) {
  const texte = String(ip);
  if (estIpv4(texte)) return ipv4Privee(ipv4EnNombre(texte));
  if (estIpv6(texte)) return ipv6Privee(ipv6EnGroupes(texte));
  return true;
}

// ------------------------------------------------------------------ Adresse

/**
 * Vérifie une adresse SANS réseau ; rend `{ url, hote, port }` ou lève un refus.
 * `URL` ramène déjà `http://2130706433/`, `http://0x7f.1/` ou `http://0177.0.0.1/`
 * à `127.0.0.1`, et `[::ffff:127.0.0.1]` à `[::ffff:7f00:1]`.
 */
export function verifierAdresse(brut, { hoteRelais } = {}) {
  if (typeof brut !== 'string' || brut.length === 0 || brut.length > LONGUEUR_MAX_URL) {
    throw refus('Adresse refusée.');
  }
  let url;
  try {
    url = new URL(brut);
  } catch {
    throw refus('Adresse invalide.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw refus('Seules les adresses http(s) sont permises.');
  if (url.username || url.password) throw refus('Adresse avec identifiants refusée.');
  const hote = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!hote) throw refus('Adresse sans hôte.');
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!PORTS_AUTORISES.includes(port)) throw refus(`Port ${port} refusé.`);
  if (estIpv4(hote) || estIpv6(hote) || hote.includes(':')) {
    if (ipEstPrivee(hote)) throw refus('Adresse non publique refusée.');
    throw refus('Adresse IP directe refusée : un nom de domaine est attendu.');
  }
  if (/^[0-9.]+$/.test(hote) || /^0x[0-9a-f.]+$/i.test(hote)) throw refus('Adresse numérique refusée.');
  if (NOMS_INTERDITS.has(hote) || SUFFIXES_LOCAUX.some(s => hote.endsWith(s)) || !hote.includes('.')) {
    throw refus('Nom d’hôte local refusé.');
  }
  if (hoteRelais && hote === String(hoteRelais).toLowerCase()) throw refus('Le relais ne s’appelle pas lui-même.');
  return { url, hote, port };
}

// ------------------------------------------------------------------ DNS (DNS sur HTTPS)

const cacheDns = new Map();

/** Résout A et AAAA par DNS sur HTTPS ; rend la liste des IP (vide : nom introuvable). */
export function resolveurDoh(fetchFn = (...a) => globalThis.fetch(...a)) {
  return async hote => {
    const lire = async type => {
      const r = await fetchFn(`${DOH}?name=${encodeURIComponent(hote)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
      if (!r.ok) throw new Error('dns');
      const j = await r.json();
      return (Array.isArray(j?.Answer) ? j.Answer : []).filter(a => a && (a.type === 1 || a.type === 28) && typeof a.data === 'string').map(a => a.data);
    };
    const [v4, v6] = await Promise.all([lire('A'), lire('AAAA')]);
    return [...v4, ...v6];
  };
}

/** Le nom doit résoudre, et seulement vers des adresses publiques (résultat gardé 60 s). */
export async function verifierDns(hote, resoudre, maintenant = Date.now()) {
  const garde = cacheDns.get(hote);
  if (garde && maintenant - garde.quand < 60_000) {
    if (!garde.ok) throw refus(garde.motif, 'dns', garde.statut);
    return;
  }
  let ips;
  try {
    ips = await resoudre(hote);
  } catch {
    throw refus('Vérification DNS impossible pour le moment : réessayez.', 'dns', 502);
  }
  const memoriser = (ok, motif, statut) => {
    if (cacheDns.size > 500) cacheDns.delete(cacheDns.keys().next().value);
    cacheDns.set(hote, { quand: maintenant, ok, motif, statut });
  };
  if (!Array.isArray(ips) || ips.length === 0) {
    memoriser(false, 'Nom de domaine introuvable.', 502);
    throw refus('Nom de domaine introuvable.', 'dns', 502);
  }
  if (ips.some(ip => ipEstPrivee(ip))) {
    memoriser(false, 'Le nom résout vers une adresse non publique.', 400);
    throw refus('Le nom résout vers une adresse non publique.', 'dns', 400);
  }
  memoriser(true);
}

// ------------------------------------------------------------------ Requête du site

/** Valide le corps JSON envoyé par le site (il n'est pas de confiance). */
export function validerDemande(corps, options = {}) {
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) throw refus('Requête illisible.', 'requete');
  const brute = corps.method ?? corps.methode ?? 'GET';
  const methode = brute === 'GET' || brute === 'POST' ? brute : null;
  if (!methode) throw refus('Méthode refusée (GET ou POST).', 'requete');
  const adresse = verifierAdresse(corps.url, options);
  const entetes = {};
  const source = corps.headers ?? corps.entetes;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    for (const [nom, valeur] of Object.entries(source)) {
      const cle = String(nom).toLowerCase();
      if (!ENTETES_SORTANTS.includes(cle) || typeof valeur !== 'string') continue;
      // Valeurs imprimables, sans retour à la ligne, de taille raisonnable.
      if (valeur.length > 1000 || !/^[\x20-\x7e -ÿ]*$/.test(valeur)) continue;
      if (cle === 'x-requested-with' && valeur !== 'XMLHttpRequest') continue;
      if (cle === 'referer') {
        try {
          if (!/^https?:$/.test(new URL(valeur).protocol)) continue;
        } catch {
          continue;
        }
      }
      entetes[cle] = valeur;
    }
  }
  let corpsSortant;
  if (methode === 'POST') {
    const b = corps.body ?? corps.corps ?? '';
    if (typeof b !== 'string') throw refus('Corps de requête invalide.', 'requete');
    if (new TextEncoder().encode(b).length > CORPS_SORTANT_MAX) throw refus('Corps de requête trop volumineux.', 'taille', 413);
    corpsSortant = b;
  }
  return { ...adresse, methode, entetes, corps: corpsSortant };
}

// ------------------------------------------------------------------ Corps : jeu de caractères

const ALIAS_CHARSET = { latin1: 'windows-1252', 'iso-8859-1': 'windows-1252', 'iso8859-1': 'windows-1252', 'iso_8859-1': 'windows-1252', 'us-ascii': 'windows-1252', ascii: 'windows-1252', cp1252: 'windows-1252', utf8: 'utf-8' };

/** Octets 0x80–0x9F de windows-1252 (le reste de 0x00–0xFF est l'identité). */
const CP1252 = [0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178];

function latin1(octets, debut = 0, fin = octets.length) {
  let s = '';
  for (let i = debut; i < fin; i += 8192) s += String.fromCharCode(...octets.subarray(i, Math.min(fin, i + 8192)));
  return s;
}

/** Jeu de caractères : en-tête, sinon `<meta charset>` / déclaration XML du début, sinon UTF-8. */
export function jeuDeCaracteres(typeContenu, octets) {
  let nom = /charset\s*=\s*["']?([\w.:-]+)/i.exec(String(typeContenu ?? ''))?.[1];
  if (!nom && octets) {
    const debut = latin1(octets, 0, Math.min(octets.length, 4096));
    nom = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(debut)?.[1] ?? /<\?xml[^>]+encoding\s*=\s*["']([\w.:-]+)/i.exec(debut)?.[1];
  }
  const n = String(nom ?? 'utf-8').toLowerCase();
  return ALIAS_CHARSET[n] ?? n;
}

/**
 * Décode en texte, ou rend `undefined` si le runtime ne connaît pas ce jeu de
 * caractères (le site décode alors lui-même `bodyBase64`). windows-1252 /
 * ISO-8859-1 est décodé même sans prise en charge par `TextDecoder`.
 */
export function decoderTexte(octets, charset) {
  try {
    return new TextDecoder(charset).decode(octets);
  } catch {
    if (charset === 'windows-1252') {
      // Par blocs : peu de temps de calcul (offre gratuite des Workers : ~10 ms par requête).
      const codes = new Uint16Array(octets.length);
      for (let i = 0; i < octets.length; i++) {
        const o = octets[i];
        codes[i] = o >= 0x80 && o <= 0x9f ? CP1252[o - 0x80] : o;
      }
      let texte = '';
      for (let i = 0; i < codes.length; i += 8192) texte += String.fromCharCode(...codes.subarray(i, i + 8192));
      return texte;
    }
    return undefined;
  }
}

const estTexte = type => !type || /^text\/|json|xml|javascript|ecmascript|x-www-form-urlencoded|mpegurl/i.test(type);

export function versBase64(octets) {
  return btoa(latin1(octets));
}

/** Lit un flux jusqu'à `max` octets ; au-delà, le flux est abandonné et la lecture marquée tronquée. */
export async function lireBorne(flux, max) {
  if (!flux) return { octets: new Uint8Array(0), tronque: false };
  const lecteur = flux.getReader();
  const morceaux = [];
  let total = 0;
  let tronque = false;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    const morceau = value instanceof Uint8Array ? value : new Uint8Array(value);
    if (total + morceau.length > max) {
      morceaux.push(morceau.subarray(0, max - total));
      total = max;
      tronque = true;
      await lecteur.cancel().catch(() => undefined);
      break;
    }
    morceaux.push(morceau);
    total += morceau.length;
  }
  const octets = new Uint8Array(total);
  let pos = 0;
  for (const m of morceaux) {
    octets.set(m, pos);
    pos += m.length;
  }
  return { octets, tronque };
}

// ------------------------------------------------------------------ CORS, débit, réponses

export function originesPermises(env) {
  return String(env?.ORIGINES_SITE ?? '')
    .split(/[\s,]+/)
    .map(o => o.trim().replace(/\/+$/, ''))
    .filter(o => /^https?:\/\/[^\s/]+$/.test(o));
}

function entetesCors(origine, env) {
  const permise = origine && originesPermises(env).includes(origine);
  return {
    ...(permise ? { 'Access-Control-Allow-Origin': origine } : {}),
    Vary: 'Origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

function json(corps, statut, origine, env, plus = {}) {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { ...entetesCors(origine, env), 'Content-Type': 'application/json; charset=utf-8', ...plus },
  });
}

const MESSAGES = {
  401: 'Jeton du relais manquant ou incorrect.',
  403: 'Réservé au compte Fondateur relié au relais.',
};

/** Limite de débit par jeton, en mémoire du Worker (une instance = un compteur ; rien dans KV). */
export function creerLimiteur({ limite = LIMITE_PAR_MINUTE, fenetreMs = FENETRE_MS } = {}) {
  const dates = new Map();
  return (qui, maintenant = Date.now()) => {
    const recentes = (dates.get(qui) ?? []).filter(d => maintenant - d < fenetreMs);
    if (recentes.length >= limite) {
      dates.set(qui, recentes);
      return { ok: false, attenteS: Math.max(1, Math.ceil((recentes[0] + fenetreMs - maintenant) / 1000)) };
    }
    recentes.push(maintenant);
    if (!dates.has(qui) && dates.size > 1000) dates.delete(dates.keys().next().value);
    dates.set(qui, recentes);
    return { ok: true };
  };
}

const limiteurs = new Map();
function limiteurPour(env) {
  const limite = Math.max(1, Math.min(10_000, Number(env?.LIMITE_TSUZUKU_MINUTE) || LIMITE_PAR_MINUTE));
  if (!limiteurs.has(limite)) limiteurs.set(limite, creerLimiteur({ limite }));
  return limiteurs.get(limite);
}

async function lireCorpsRequete(requete) {
  const annonce = Number(requete.headers.get('Content-Length') ?? 0);
  if (annonce > TAILLE_MAX_REQUETE) throw refus('Requête trop volumineuse.', 'taille', 413);
  const { octets, tronque } = await lireBorne(requete.body, TAILLE_MAX_REQUETE);
  if (tronque) throw refus('Requête trop volumineuse.', 'taille', 413);
  try {
    return JSON.parse(new TextDecoder().decode(octets));
  } catch {
    throw refus('Requête illisible.', 'requete');
  }
}

// ------------------------------------------------------------------ Route

/**
 * Traite `/tsuzuku/requete` (préliminaire OPTIONS compris).
 * `obtenirPortee()` rend la portée du jeton (`{ maitre }`, `{ profil }` ou rien).
 * `deps` (tests) : `fetch`, `resoudre`, `maintenant`, `journal`.
 */
export async function routeTsuzuku(requete, env, obtenirPortee, deps = {}) {
  const origine = requete.headers.get('Origin');
  const debut = Date.now();
  const journal = deps.journal ?? (ligne => console.log(ligne));
  if (requete.method === 'OPTIONS') {
    if (!origine || !originesPermises(env).includes(origine)) {
      return new Response(null, { status: 403, headers: entetesCors(undefined, env) });
    }
    return new Response(null, {
      status: 204,
      headers: {
        ...entetesCors(origine, env),
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
      },
    });
  }
  const erreur = (e, plus) => {
    const statut = e instanceof RefusTsuzuku ? e.statut : 502;
    const code = e instanceof RefusTsuzuku ? e.code : 'injoignable';
    const message = e instanceof RefusTsuzuku ? e.message : 'Le site est injoignable.';
    journal(`tsuzuku refus ${statut} ${code}`);
    return json({ erreur: message, code }, statut, origine, env, plus);
  };
  const portee = await obtenirPortee();
  if (!portee) return erreur(refus(MESSAGES[401], 'jeton', 401));
  if (requete.method !== 'POST') return erreur(refus('Méthode non autorisée.', 'methode', 405));
  if (!portee.maitre) return erreur(refus(MESSAGES[403], 'interdit', 403));
  // Un navigateur annonce son origine : seule celle du site est servie.
  if (origine && !originesPermises(env).includes(origine)) return erreur(refus('Origine non autorisée.', 'origine', 403));
  const debit = limiteurPour(env)('maitre', deps.maintenant?.() ?? Date.now());
  if (!debit.ok) {
    return erreur(refus(`Trop de requêtes vers le relais : réessayez dans ${debit.attenteS} s.`, 'debit', 429), { 'Retry-After': String(debit.attenteS) });
  }

  let demande;
  try {
    demande = validerDemande(await lireCorpsRequete(requete), { hoteRelais: new URL(requete.url).hostname });
    await verifierDns(demande.hote, deps.resoudre ?? resolveurDoh(deps.fetch), deps.maintenant?.() ?? Date.now());
  } catch (e) {
    return erreur(e);
  }

  const fetchFn = deps.fetch ?? ((...a) => globalThis.fetch(...a));
  const controleur = new AbortController();
  const delaiMs = deps.delaiMs ?? DELAI_MS;
  let expire = false;
  const minuteur = setTimeout(() => {
    expire = true;
    controleur.abort();
  }, delaiMs);
  try {
    const rep = await fetchFn(demande.url.href, {
      method: demande.methode,
      headers: demande.entetes,
      body: demande.corps,
      redirect: 'manual',
      // Pas de `credentials` : non pris en charge par fetch des Workers, qui n'a de toute façon aucun cookie.
      signal: controleur.signal,
    });
    const entetes = {};
    for (const nom of ENTETES_RENDUS) {
      const v = rep.headers.get(nom);
      if (v !== null && v !== undefined) entetes[nom] = String(v).slice(0, 2000);
    }
    // Aucun cookie rendu : sa présence seule est signalée (le moteur explique une boucle de redirections).
    if (rep.headers.get('set-cookie') !== null || (typeof rep.headers.getSetCookie === 'function' && rep.headers.getSetCookie().length)) {
      entetes['x-tsuzuku-cookie'] = '1';
    }
    const typeContenu = entetes['content-type'] ?? '';
    const sortie = { status: rep.status, headers: entetes, finalUrl: demande.url.href, contentType: typeContenu.split(';')[0].trim() || null, charset: null, tronque: false };
    if (rep.status >= 300 && rep.status < 400) {
      await rep.body?.cancel().catch(() => undefined);
      sortie.texte = '';
    } else {
      const { octets, tronque } = await lireBorne(rep.body, deps.tailleMax ?? TAILLE_MAX_REPONSE);
      sortie.tronque = tronque;
      if (tronque) entetes['x-tsuzuku-tronque'] = '1';
      if (estTexte(sortie.contentType)) {
        sortie.charset = jeuDeCaracteres(typeContenu, octets);
        const texte = decoderTexte(octets, sortie.charset);
        if (texte === undefined) sortie.bodyBase64 = versBase64(octets);
        else sortie.texte = texte;
      } else {
        sortie.bodyBase64 = versBase64(octets);
      }
    }
    journal(`tsuzuku ${demande.hote} ${rep.status} ${Date.now() - debut}ms`);
    return json(sortie, 200, origine, env);
  } catch (e) {
    if (expire) return erreur(refus(`Délai dépassé (${Math.round(delaiMs / 1000)} s).`, 'delai', 504));
    return erreur(e instanceof RefusTsuzuku ? e : refus('Le site est injoignable.', 'injoignable', 502));
  } finally {
    clearTimeout(minuteur);
  }
}
