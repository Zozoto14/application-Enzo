/**
 * Accès réseau de Tsuzuku, côté processus principal d'Electron.
 *
 * Le moteur (src/tsuzuku/moteur) tourne dans la fenêtre et passe par une
 * interface `Reseau` : ce module en est l'implémentation pour le PC. La
 * fenêtre n'a pas le droit de joindre le réseau elle-même (CORS, cookies,
 * réseau local) ; elle demande ici, par `tsuzuku:requete`.
 *
 * **La garde anti-SSRF est refaite ICI**, indépendamment de celle du moteur :
 * un rendu compromis ne doit pas pouvoir se servir du processus principal
 * pour joindre le réseau local. Règles :
 *
 *  - http(s) seulement, pas d'identifiants dans l'adresse, ports 80/443/8080/8443 ;
 *  - l'hôte doit être PUBLIC : ni localhost, ni IP privée/lien local/métadonnées
 *    cloud, ni `.local`/`.lan`/`.internal`, ni nom sans point ;
 *  - la résolution DNS est vérifiée AU MOMENT de la connexion (`lookup` de la
 *    socket) : un nom qui pointe vers une IP privée est refusé, et l'adresse
 *    vérifiée est celle qui sert (pas de « rebinding ») ;
 *  - les redirections ne sont PAS suivies : la réponse 3xx est rendue au moteur,
 *    qui re-vérifie chaque saut en repassant par ici ;
 *  - aucun cookie (ni envoyé, ni gardé), délai et taille de réponse bornés ;
 *    la présence d'un Set-Cookie est seulement SIGNALÉE (`x-tsuzuku-cookie: 1`,
 *    sans la valeur) pour que le moteur explique une boucle de redirections ;
 *  - seuls quelques en-têtes sont transmis ;
 *  - le corps est décompressé (gzip, deflate, br : certains serveurs ignorent
 *    `accept-encoding: identity`) puis DÉCODÉ selon son jeu de caractères
 *    (en-tête `charset`, sinon `<meta charset>`, sinon UTF-8) : une page en
 *    ISO-8859-1 / windows-1252 garde ses accents.
 *
 * Aucune dépendance à Electron : testable seule (`tsuzuku.test.mjs`).
 */

import dns from 'node:dns';
import zlib from 'node:zlib';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export const PORTS_AUTORISES = [80, 443, 8080, 8443];
export const LONGUEUR_MAX_URL = 2048;
export const DELAI_MAX_MS = 30_000;
export const TAILLE_MAX_OCTETS = 16 * 1024 * 1024;
export const CORPS_MAX_OCTETS = 64 * 1024;
const ENTETES_PERMIS = new Set(['accept', 'accept-language', 'content-type', 'user-agent', 'authorization', 'referer', 'origin', 'x-requested-with']);
const SUFFIXES_LOCAUX = ['.local', '.localdomain', '.lan', '.internal', '.intranet', '.home', '.corp', '.private', '.localhost'];

// ------------------------------------------------------------------ IP privées

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

/** Huit groupes de 16 bits d'une IPv6 (ou null). */
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
  if (g.every(v => v === 0)) return true; // ::
  if (g.slice(0, 7).every(v => v === 0) && g[7] === 1) return true; // ::1
  // ::ffff:a.b.c.d (IPv4 mappée) et ::a.b.c.d (compatible) : on juge l'IPv4 dedans.
  if (g.slice(0, 5).every(v => v === 0) && (g[5] === 0xffff || g[5] === 0)) return ipv4Privee(g[6] * 65536 + g[7]);
  if (g[0] === 0x64 && g[1] === 0xff9b) return ipv4Privee(g[6] * 65536 + g[7]); // NAT64
  if (g[0] === 0x2002) return ipv4Privee(g[1] * 65536 + g[2]); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // lien local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // site local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

/** Vrai si l'adresse IP (texte) n'est PAS publique, ou n'est pas une IP lisible. */
export function ipEstPrivee(ip) {
  const texte = String(ip);
  if (net.isIPv4(texte)) return ipv4Privee(ipv4EnNombre(texte));
  if (net.isIPv6(texte)) {
    const g = ipv6EnGroupes(texte);
    return g === null ? true : ipv6Privee(g);
  }
  return true;
}

// ------------------------------------------------------------------ Adresse

/** Notations d'IPv4 que WHATWG accepte mais que `net` ne reconnaît pas (décimal, octal, hexa) : on demande à `URL`. */
function hoteNormalise(url) {
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

/**
 * Vérifie une adresse SANS réseau. Rend `{ url, hote, port, https }` ou lève.
 * `URL` normalise déjà les IPv4 décimales/octales/hexa (`http://2130706433/`
 * devient `127.0.0.1`), ce qui les ramène à la règle des IP privées.
 */
export function verifierAdresse(brut) {
  if (typeof brut !== 'string' || brut.length === 0 || brut.length > LONGUEUR_MAX_URL) {
    throw new Error('Adresse refusée.');
  }
  let url;
  try {
    url = new URL(brut);
  } catch {
    throw new Error('Adresse invalide.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Seules les adresses http(s) sont permises.');
  if (url.username || url.password) throw new Error('Adresse avec identifiants refusée.');
  const hote = hoteNormalise(url);
  if (!hote) throw new Error('Adresse sans hôte.');
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!PORTS_AUTORISES.includes(port)) throw new Error(`Port ${port} refusé.`);
  if (net.isIP(hote)) {
    if (ipEstPrivee(hote)) throw new Error('Adresse non publique refusée.');
  } else {
    if (hote === 'localhost' || SUFFIXES_LOCAUX.some(s => hote.endsWith(s)) || !hote.includes('.')) {
      throw new Error('Nom d’hôte local refusé.');
    }
    if (/^[0-9.x]+$/i.test(hote)) throw new Error('Adresse numérique refusée.');
  }
  return { url, hote, port, https: url.protocol === 'https:' };
}

// ------------------------------------------------------------------ Corps : compression et jeu de caractères

/**
 * Décompresse selon `content-encoding` (taille décompressée bornée : pas de
 * « bombe » gzip) ; un corps non compressé est rendu tel quel. Lève si la
 * taille décompressée dépasse `max`.
 */
export function decompresser(tampon, encodage, max = TAILLE_MAX_OCTETS) {
  const e = String(encodage ?? '').toLowerCase().trim();
  const options = { maxOutputLength: max + 1 };
  const borne = sortie => {
    if (sortie.length > max) throw new Error(`Réponse trop volumineuse une fois décompressée (> ${max} octets).`);
    return sortie;
  };
  const essayer = fn => {
    try {
      return borne(fn());
    } catch (erreur) {
      if (/trop volumineuse|Cannot create a Buffer larger|maxOutputLength|ERR_BUFFER_TOO_LARGE/i.test(`${erreur?.message} ${erreur?.code}`)) {
        throw new Error(`Réponse trop volumineuse une fois décompressée (> ${max} octets).`);
      }
      return null; // Annoncé compressé mais ne l'est pas : on garde les octets reçus.
    }
  };
  let sortie = null;
  if (e === 'gzip' || e === 'x-gzip') sortie = essayer(() => zlib.gunzipSync(tampon, { ...options, finishFlush: zlib.constants.Z_SYNC_FLUSH }));
  else if (e === 'deflate') sortie = essayer(() => zlib.inflateSync(tampon, options)) ?? essayer(() => zlib.inflateRawSync(tampon, options));
  else if (e === 'br') sortie = essayer(() => zlib.brotliDecompressSync(tampon, options));
  return sortie ?? tampon;
}

const ALIAS_CHARSET = { latin1: 'windows-1252', 'iso-8859-1': 'windows-1252', 'iso8859-1': 'windows-1252', 'us-ascii': 'windows-1252', ascii: 'windows-1252', utf8: 'utf-8' };

/** Jeu de caractères : en-tête Content-Type, sinon <meta charset> / http-equiv dans le début du document, sinon UTF-8. */
export function jeuDeCaracteres(typeContenu, tampon) {
  const entete = /charset\s*=\s*["']?([\w.:-]+)/i.exec(String(typeContenu ?? ''));
  let nom = entete?.[1];
  if (!nom) {
    const debut = tampon.subarray(0, 4096).toString('latin1');
    nom = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(debut)?.[1] ?? /<\?xml[^>]+encoding\s*=\s*["']([\w.:-]+)/i.exec(debut)?.[1];
  }
  const n = String(nom ?? 'utf-8').toLowerCase();
  return ALIAS_CHARSET[n] ?? n;
}

/** Décode les octets reçus en texte selon leur jeu de caractères (repli UTF-8). */
export function decoderCorps(tampon, typeContenu) {
  const nom = jeuDeCaracteres(typeContenu, tampon);
  try {
    return new TextDecoder(nom).decode(tampon);
  } catch {
    return tampon.toString('utf8');
  }
}

// ------------------------------------------------------------------ Requête

/** `lookup` de socket : refuse tout nom qui résout vers une IP non publique, et impose l'IP vérifiée. */
export function lookupPublic(resoudre = dns.lookup) {
  return (hote, options, rappel) => {
    const rappelFinal = typeof options === 'function' ? options : rappel;
    const opts = typeof options === 'function' ? {} : options ?? {};
    resoudre(hote, { ...opts, all: true, verbatim: true }, (erreur, adresses) => {
      if (erreur) return rappelFinal(erreur);
      const liste = Array.isArray(adresses) ? adresses : [{ address: adresses, family: 4 }];
      if (liste.length === 0 || liste.some(a => ipEstPrivee(a.address))) {
        return rappelFinal(new Error('Le nom résout vers une adresse non publique.'));
      }
      if (opts.all) return rappelFinal(null, liste);
      return rappelFinal(null, liste[0].address, liste[0].family);
    });
  };
}

function nettoyerEntetes(entetes) {
  const sortie = {};
  if (!entetes || typeof entetes !== 'object') return sortie;
  for (const [nom, valeur] of Object.entries(entetes)) {
    const cle = String(nom).toLowerCase();
    if (ENTETES_PERMIS.has(cle) && typeof valeur === 'string' && valeur.length < 2000 && !/[\r\n]/.test(valeur)) {
      sortie[cle] = valeur;
    }
  }
  return sortie;
}

/** Valide la forme d'une requête venue de la fenêtre (elle n'est pas de confiance). */
export function validerRequete(r) {
  if (!r || typeof r !== 'object') throw new Error('Requête invalide.');
  const methode = r.methode === 'POST' ? 'POST' : r.methode === 'GET' ? 'GET' : null;
  if (!methode) throw new Error('Méthode refusée.');
  const delaiMs = Math.min(DELAI_MAX_MS, Math.max(1000, Number(r.delaiMs) || 15_000));
  const tailleMax = Math.min(TAILLE_MAX_OCTETS, Math.max(1024, Number(r.tailleMax) || 8 * 1024 * 1024));
  let corps;
  if (methode === 'POST') {
    corps = typeof r.corps === 'string' ? r.corps : '';
    if (Buffer.byteLength(corps) > CORPS_MAX_OCTETS) throw new Error('Corps trop volumineux.');
  }
  return { adresse: verifierAdresse(r.url), methode, delaiMs, tailleMax, corps, entetes: nettoyerEntetes(r.entetes) };
}

/**
 * Exécute une requête validée. `deps.requeter` (tests) remplace `http(s).request`.
 * Rend `{ statut, entetes, corps }` ; ne suit jamais de redirection.
 */
export async function requeteTsuzuku(brute, deps = {}) {
  const r = validerRequete(brute);
  const { adresse } = r;
  const requeter = deps.requeter ?? (adresse.https ? https.request : http.request);
  return new Promise((resoudre, rejeter) => {
    let fini = false;
    const terminer = (fn, valeur) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      fn(valeur);
    };
    const options = {
      method: r.methode,
      headers: {
        // Comme un navigateur (certains pare-feu se méfient de « identity ») ; décompressé ci-dessous.
        'accept-encoding': 'gzip, deflate, br',
        ...r.entetes,
        ...(r.corps !== undefined ? { 'content-length': String(Buffer.byteLength(r.corps)) } : {}),
      },
      // Jamais de cookie, jamais de connexion réutilisée entre origines.
      agent: false,
      lookup: deps.lookup ?? lookupPublic(),
    };
    const req = requeter(adresse.url, options, reponse => {
      const entetes = {};
      for (const [nom, valeur] of Object.entries(reponse.headers)) {
        if (nom === 'set-cookie') {
          // Aucun cookie n'est gardé ni rendu : seule sa présence est signalée au moteur.
          entetes['x-tsuzuku-cookie'] = '1';
          continue;
        }
        entetes[nom.toLowerCase()] = Array.isArray(valeur) ? valeur.join(', ') : String(valeur ?? '');
      }
      const statut = reponse.statusCode ?? 0;
      if (statut >= 300 && statut < 400) {
        reponse.resume();
        return terminer(resoudre, { statut, entetes, corps: '' });
      }
      const annonce = Number(entetes['content-length']);
      if (Number.isFinite(annonce) && annonce > r.tailleMax) {
        req.destroy();
        return terminer(rejeter, new Error(`Réponse trop volumineuse (${annonce} octets).`));
      }
      const morceaux = [];
      let total = 0;
      reponse.on('data', morceau => {
        total += morceau.length;
        if (total > r.tailleMax) {
          req.destroy();
          return terminer(rejeter, new Error(`Réponse trop volumineuse (> ${r.tailleMax} octets).`));
        }
        morceaux.push(morceau);
      });
      reponse.on('end', () => {
        let brut;
        try {
          brut = decompresser(Buffer.concat(morceaux), entetes['content-encoding'], r.tailleMax);
        } catch (erreur) {
          return terminer(rejeter, erreur);
        }
        // Le corps rendu est du texte décodé : l'en-tête de compression ne le décrit plus.
        delete entetes['content-encoding'];
        delete entetes['content-length'];
        terminer(resoudre, { statut, entetes, corps: decoderCorps(brut, entetes['content-type']) });
      });
      reponse.on('error', erreur => terminer(rejeter, erreur));
    });
    const minuteur = setTimeout(() => {
      req.destroy();
      terminer(rejeter, new Error(`Délai dépassé (${r.delaiMs} ms).`));
    }, r.delaiMs);
    req.on('error', erreur => terminer(rejeter, erreur));
    if (r.corps !== undefined) req.write(r.corps);
    req.end();
  });
}

// ------------------------------------------------------------------ Lecteurs (iframe)

/**
 * Sites que la fenêtre a le droit d'afficher dans un iframe de lecteur.
 * L'interface déclare l'adresse d'un lecteur (`tsuzuku:lecteur`) ; elle
 * n'est retenue que si la garde l'accepte. Toute autre navigation de
 * sous-cadre est refusée par le processus principal.
 */
export function creerListeLecteurs({ maintenant = () => Date.now(), duree = 6 * 60 * 60 * 1000, max = 64 } = {}) {
  const autorises = new Map(); // hôte -> échéance
  const purger = () => {
    const t = maintenant();
    for (const [hote, echeance] of autorises) if (echeance < t) autorises.delete(hote);
  };
  return {
    /** Retient l'hôte d'une adresse de lecteur ; faux si la garde la refuse. */
    autoriser(adresse) {
      let a;
      try {
        a = verifierAdresse(String(adresse));
      } catch {
        return false;
      }
      purger();
      if (!autorises.has(a.hote) && autorises.size >= max) {
        autorises.delete(autorises.keys().next().value);
      }
      autorises.set(a.hote, maintenant() + duree);
      return true;
    },
    /** Vrai si un sous-cadre peut charger cette adresse. */
    sousCadreAutorise(adresse) {
      try {
        const a = verifierAdresse(String(adresse));
        purger();
        return autorises.has(a.hote);
      } catch {
        return false;
      }
    },
  };
}
