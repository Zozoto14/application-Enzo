/**
 * Aperçu d'un lien web (titre, description, image) récupéré PAR LE SERVEUR, avec une protection
 * contre la falsification de requêtes côté serveur (SSRF). Cœur portable : aucune dépendance au
 * runtime ; le téléchargement est injecté (`telecharger`), la résolution DNS aussi (`resoudre`).
 *
 * Barrières, cumulées :
 *  1. adresse : http(s) seulement, ports 80 / 443 seulement, aucun identifiant dans l'adresse ;
 *  2. hôte : jamais une IP privée, locale, réservée ou de lien local (IPv4 et IPv6, y compris
 *     ::ffff:127.0.0.1, NAT64, 169.254.169.254…), ni « localhost », ni un nom sans point, ni
 *     `.local`, `.internal`, `.lan`, `.home.arpa` ; les formes numériques détournées (2130706433,
 *     0x7f.1, 017700000001) sont normalisées par l'analyseur d'URL puis refusées ;
 *  3. résolution DNS (si `resoudre` est fourni) : TOUTES les adresses du nom doivent être publiques.
 *     Sur le serveur Node, le téléchargeur vérifie en plus l'adresse AU MOMENT DE LA CONNEXION
 *     (adaptateurs/apercuNode.mjs) : un nom qui change d'adresse entre-temps (rebinding) est refusé ;
 *  4. redirections suivies À LA MAIN (3 au plus), chacune revérifiée comme ci-dessus ;
 *  5. délai court (4 s en tout), taille lue bornée (512 Ko), HTML seulement ; rien n'est exécuté.
 *
 * L'image de l'aperçu n'est qu'une ADRESSE (https seulement, mêmes règles d'hôte) : le serveur ne la
 * télécharge pas.
 */

import { echec, texteNettoye } from '../outils.mjs';

export const DELAI_APERCU_MS = 4000;
export const TAILLE_MAX_APERCU = 512 * 1024;
export const REDIRECTIONS_MAX = 3;
const AGENT = 'AppDashboardEsport/1.0 (apercu de lien)';

// ------------------------------------------------------------------ Adresses IP

/** a.b.c.d → entier non signé, ou null. */
function ipv4EnEntier(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some(x => x > 255)) return null;
  return ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3];
}

const PLAGES_V4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].map(([debut, bits]) => [ipv4EnEntier(debut), bits]);

/** IPv4 privée, locale, réservée, de documentation ou multicast ? */
export function ipv4Interdite(ip) {
  const n = ipv4EnEntier(ip);
  if (n === null) return true;
  return PLAGES_V4.some(([debut, bits]) => {
    const masque = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & masque) >>> 0) === ((debut & masque) >>> 0);
  });
}

/** IPv6 (texte, sans crochets) → 8 mots de 16 bits, ou null. */
function ipv6EnMots(ip) {
  let texte = String(ip).toLowerCase().split('%')[0];
  // Fin en IPv4 (::ffff:1.2.3.4) → deux mots.
  const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(texte);
  if (v4) {
    const n = ipv4EnEntier(v4[1]);
    if (n === null) return null;
    texte = `${texte.slice(0, -v4[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const parties = texte.split('::');
  if (parties.length > 2) return null;
  const gauche = parties[0] ? parties[0].split(':') : [];
  const droite = parties.length === 2 && parties[1] ? parties[1].split(':') : [];
  const manque = 8 - gauche.length - droite.length;
  if (parties.length === 1 && manque !== 0) return null;
  if (parties.length === 2 && manque < 1) return null;
  const mots = [...gauche, ...Array(parties.length === 2 ? manque : 0).fill('0'), ...droite];
  if (mots.length !== 8 || mots.some(m => !/^[0-9a-f]{1,4}$/.test(m))) return null;
  return mots.map(m => Number.parseInt(m, 16));
}

/** IPv6 non routable publiquement (boucle, non spécifiée, ULA, lien local, multicast, documentation) ou IPv4 interdite encapsulée ? */
export function ipv6Interdite(ip) {
  const m = ipv6EnMots(ip);
  if (!m) return true;
  const v4De = (a, b) => `${a >>> 8}.${a & 0xff}.${b >>> 8}.${b & 0xff}`;
  if (m.slice(0, 7).every(x => x === 0)) return true; // :: et ::1
  if (m.slice(0, 5).every(x => x === 0) && m[5] === 0xffff) return ipv4Interdite(v4De(m[6], m[7])); // ::ffff:a.b.c.d
  if (m.slice(0, 6).every(x => x === 0)) return true; // ::a.b.c.d (compatible, obsolète)
  if (m[0] === 0x64 && m[1] === 0xff9b) return ipv4Interdite(v4De(m[6], m[7])); // NAT64
  if ((m[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((m[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((m[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 (site local, obsolète)
  if ((m[0] & 0xff00) === 0xff00) return true; // multicast
  if (m[0] === 0x2001 && m[1] === 0x0db8) return true; // documentation
  if (m[0] === 0x2002) return ipv4Interdite(v4De(m[1], m[2])); // 6to4
  if (m[0] === 0x0100 && m[1] === 0 && m[2] === 0 && m[3] === 0) return true; // 100::/64 (rejet)
  return false;
}

export const estIpv4 = h => /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
export const estIpv6 = h => h.includes(':');

/** Une adresse IP (v4 ou v6, texte) que le serveur ne doit jamais joindre ? */
export function ipInterdite(ip) {
  const h = String(ip ?? '').replace(/^\[|\]$/g, '');
  if (estIpv4(h)) return ipv4Interdite(h);
  if (estIpv6(h)) return ipv6Interdite(h);
  return true;
}

const SUFFIXES_LOCAUX = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home', '.home.arpa', '.corp', '.localdomain'];

const refus = () => echec(400, 'apercu-adresse', 'Adresse refusée : seules les pages web publiques (http ou https) ont un aperçu.');

/**
 * Adresse saisie → URL vérifiée (barrières 1 et 2), ou erreur 400. L'analyseur WHATWG normalise
 * déjà les formes numériques d'IPv4 (« http://2130706433/ » → 127.0.0.1).
 */
export function verifierAdresse(brut) {
  const texte = String(brut ?? '').trim();
  if (!texte || texte.length > 2048) throw refus();
  let url;
  try {
    url = new URL(texte);
  } catch {
    throw refus();
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw refus();
  if (url.username || url.password) throw refus();
  if (url.port && url.port !== '80' && url.port !== '443') throw refus();
  const hote = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hote) throw refus();
  if (hote.startsWith('[') || estIpv4(hote) || estIpv6(hote)) {
    if (ipInterdite(hote)) throw refus();
    return url;
  }
  if (hote === 'localhost' || !hote.includes('.') || SUFFIXES_LOCAUX.some(s => hote.endsWith(s))) throw refus();
  if (!/^[a-z0-9.-]+$/.test(hote) || hote.split('.').some(l => !l || l.length > 63)) throw refus();
  return url;
}

/** Vrai si l'adresse passe les barrières 1 et 2 (sans lever). */
export function adresseAutorisee(brut) {
  try {
    verifierAdresse(brut);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ HTML

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };

export function decoderEntites(texte) {
  return String(texte ?? '').replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (tout, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return ENTITES[e.toLowerCase()] ?? tout;
  });
}

function attributs(balise) {
  const sortie = {};
  for (const m of balise.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    sortie[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return sortie;
}

/** Adresse d'image d'un aperçu : https seulement, hôte public ; sinon null. */
export function imageSure(brute, base) {
  try {
    const url = new URL(decoderEntites(brute).trim(), base);
    if (url.protocol !== 'https:') return null;
    verifierAdresse(url.href);
    return url.href.length <= 2000 ? url.href : null;
  } catch {
    return null;
  }
}

/** Titre, description, image et nom du site d'une page HTML (méta Open Graph, Twitter, <title>). */
export function extraireMeta(html, adresse) {
  const texte = String(html ?? '').slice(0, TAILLE_MAX_APERCU);
  const meta = {};
  for (const m of texte.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributs(m[0]);
    const cle = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase();
    if (cle && a.content !== undefined && meta[cle] === undefined) meta[cle] = a.content;
  }
  const titreBalise = /<title\b[^>]*>([\s\S]{0,1000}?)<\/title>/i.exec(texte)?.[1];
  const propre = (v, max) => {
    const t = texteNettoye(decoderEntites(v ?? ''), max);
    return t || null;
  };
  const url = new URL(adresse);
  const imageBrute = meta['og:image:secure_url'] ?? meta['og:image'] ?? meta['og:image:url'] ?? meta['twitter:image'] ?? meta['twitter:image:src'];
  return {
    titre: propre(meta['og:title'] ?? meta['twitter:title'] ?? titreBalise, 200),
    description: propre(meta['og:description'] ?? meta['twitter:description'] ?? meta.description, 400),
    image: imageBrute ? imageSure(imageBrute, url) : null,
    site: propre(meta['og:site_name'], 80) ?? url.hostname.replace(/^www\./, ''),
  };
}

// ------------------------------------------------------------------ Téléchargement

/**
 * Téléchargeur portable (fetch du runtime) : aucune redirection suivie, délai,
 * lecture bornée, HTML seulement. Rend `{ statut, type, location, corps }`.
 */
export function telechargeurFetch(fetchFn = (...a) => globalThis.fetch(...a)) {
  return async (url, { delai = DELAI_APERCU_MS, max = TAILLE_MAX_APERCU, types = /html|xml/i, agent = AGENT } = {}) => {
    const r = await fetchFn(url, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.timeout(delai),
      headers: { 'User-Agent': agent, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' },
    });
    const type = r.headers?.get?.('content-type') ?? '';
    const location = r.headers?.get?.('location') ?? null;
    let corps = '';
    if (r.status >= 200 && r.status < 300 && types.test(type) && r.body) {
      const lecteur = r.body.getReader();
      const morceaux = [];
      let total = 0;
      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        morceaux.push(value);
        total += value.length;
        if (total >= max) {
          await lecteur.cancel().catch(() => undefined);
          break;
        }
      }
      const octets = new Uint8Array(Math.min(total, max));
      let i = 0;
      for (const m of morceaux) {
        const part = m.subarray(0, Math.max(0, octets.length - i));
        octets.set(part, i);
        i += part.length;
      }
      corps = new TextDecoder('utf-8', { fatal: false }).decode(octets);
    } else {
      await r.body?.cancel?.().catch(() => undefined);
    }
    return { statut: r.status, type, location, corps };
  };
}

/**
 * Aperçu d'une adresse. Options : `telecharger(url, { delai, max })` (défaut : fetch), `resoudre(hote)`
 * → liste d'adresses IP (facultatif), `delai` (ms, pour tout le parcours), `max` (octets).
 * Rend `{ url, titre, description, image, site }` ; lève une erreur 400 / 422 / 504 sinon.
 */
export async function recupererApercu(adresse, { telecharger = telechargeurFetch(), resoudre, delai = DELAI_APERCU_MS, max = TAILLE_MAX_APERCU, maintenant = () => Date.now() } = {}) {
  let url = verifierAdresse(adresse);
  const fin = maintenant() + delai;
  for (let saut = 0; saut <= REDIRECTIONS_MAX; saut++) {
    if (resoudre) {
      let ips;
      try {
        ips = await resoudre(url.hostname.replace(/^\[|\]$/g, ''));
      } catch {
        throw echec(422, 'apercu-injoignable', 'Page injoignable : pas d’aperçu.');
      }
      if (!Array.isArray(ips) || ips.length === 0 || ips.some(ip => ipInterdite(ip))) throw refus();
    }
    const reste = fin - maintenant();
    if (reste <= 0) throw echec(504, 'apercu-delai', 'La page met trop de temps à répondre : pas d’aperçu.');
    let r;
    try {
      r = await telecharger(url.href, { delai: reste, max });
    } catch (e) {
      if (e?.code === 'apercu-adresse') throw refus();
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw echec(504, 'apercu-delai', 'La page met trop de temps à répondre : pas d’aperçu.');
      throw echec(422, 'apercu-injoignable', 'Page injoignable : pas d’aperçu.');
    }
    if (r.statut >= 300 && r.statut < 400 && r.location) {
      let suivante;
      try {
        suivante = new URL(r.location, url);
      } catch {
        throw refus();
      }
      url = verifierAdresse(suivante.href);
      continue;
    }
    if (r.statut < 200 || r.statut >= 300) throw echec(422, 'apercu-injoignable', 'Page injoignable : pas d’aperçu.');
    if (!/html|xml/i.test(r.type ?? '')) return { url: url.href, titre: null, description: null, image: null, site: url.hostname.replace(/^www\./, '') };
    return { url: url.href, ...extraireMeta(r.corps, url.href) };
  }
  throw echec(422, 'apercu-redirections', 'Trop de redirections : pas d’aperçu.');
}
