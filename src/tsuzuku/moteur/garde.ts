/**
 * Garde des adresses : validation et protection anti-SSRF.
 *
 * Deux niveaux, comme dans l'ancien serveur :
 * - toute adresse acceptee est du http(s) ordinaire, sans identifiants ;
 * - avant tout appel reseau du moteur, l'hote doit etre public : ni
 *   localhost, ni reseau prive, ni lien local (metadonnees cloud), ni nom
 *   de reseau local (.local, .internal, .lan...), ni port exotique. La
 *   verification est refaite a chaque redirection (voir reseau.ts).
 *
 * Sur un appareil, le risque n'est pas celui d'un serveur partage, mais une
 * source mal intentionnee pourrait sinon faire sonder la box ou le NAS du
 * foyer par l'application. Les IP ecrites en decimal (2130706433), octal
 * (0177.0.0.1), hexadecimal (0x7f000001) ou IPv6 (::ffff:7f00:1) sont
 * ramenees a leur forme canonique avant d'etre jugees.
 */

import { adresseEnTexte, analyserAdresse, analyserIpv4, analyserIpv6, type Adresse } from './adresse';
import { echec } from './erreurs';

export const LONGUEUR_MAX_URL = 2048;
export const PORTS_PAR_DEFAUT: readonly number[] = [80, 443, 8080, 8443];

/** Resolution DNS facultative (Electron : dns.lookup) ; renvoie des IP texte. */
export type ResolveurDns = (hote: string) => Promise<string[]>;

export interface OptionsGarde {
  /** Ports explicites acceptes (80/443 implicites toujours acceptes). */
  portsAutorises?: readonly number[];
  /** Si fourni, l'hote est resolu et chaque IP obtenue doit etre publique. */
  resoudre?: ResolveurDns;
}

const NOMS_LOCAUX = ['localhost', 'localdomain', 'local', 'internal', 'intranet', 'lan', 'home', 'corp', 'home.arpa', 'test', 'invalid', 'onion'];
const NOMS_EXACTS = new Set(['metadata', 'metadata.google.internal', 'instance-data', 'wpad', 'ip6-localhost', 'ip6-loopback', 'broadcasthost']);

/** Analyse une adresse et refuse tout ce qui n'est pas du http(s) ordinaire. */
export function analyserUrlHttp(brut: unknown, base?: string | null): Adresse {
  const texte = String(brut ?? '').trim();
  if (!texte) {
    throw echec('Adresse vide', 'adresse');
  }
  if (texte.length > LONGUEUR_MAX_URL) {
    throw echec('Adresse trop longue', 'adresse');
  }
  const a = analyserAdresse(texte, base);
  if (!a) {
    throw echec('URL invalide', 'adresse');
  }
  if (a.schema !== 'http' && a.schema !== 'https') {
    throw echec('Seuls http et https sont acceptes', 'adresse');
  }
  if (a.identifiants) {
    throw echec("Les identifiants dans l'adresse ne sont pas acceptes", 'adresse');
  }
  if (!a.hote) {
    throw echec('URL invalide', 'adresse');
  }
  return a;
}

/** Variante qui ne leve pas : adresse http(s) canonique, ou null. */
export function urlHttpSure(brut: unknown, base?: string | null): string | null {
  try {
    return adresseEnTexte(analyserUrlHttp(brut, base));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Plages privees
// ---------------------------------------------------------------------------

const plage = (a: number, b: number, c: number, d: number, bits: number) => ({
  base: ((a * 256 + b) * 256 + c) * 256 + d,
  taille: 2 ** (32 - bits),
});

const PLAGES_V4 = [
  plage(0, 0, 0, 0, 8), // « ce reseau », 0.0.0.0
  plage(10, 0, 0, 0, 8),
  plage(100, 64, 0, 0, 10), // CGNAT
  plage(127, 0, 0, 0, 8),
  plage(169, 254, 0, 0, 16), // lien local : metadonnees cloud (169.254.169.254)
  plage(172, 16, 0, 0, 12),
  plage(192, 0, 0, 0, 24),
  plage(192, 0, 2, 0, 24), // documentation
  plage(192, 88, 99, 0, 24), // 6to4 relais
  plage(192, 168, 0, 0, 16),
  plage(198, 18, 0, 0, 15), // bancs d'essai
  plage(198, 51, 100, 0, 24),
  plage(203, 0, 113, 0, 24),
  plage(224, 0, 0, 0, 3), // multicast, reserve, diffusion
];

export function ipv4EstPrivee(valeur: number): boolean {
  return PLAGES_V4.some(p => valeur >= p.base && valeur < p.base + p.taille);
}

const v4DepuisMots = (hi: number, lo: number) => hi * 65536 + lo;

export function ipv6EstPrivee(m: number[]): boolean {
  const zeros = (n: number) => m.slice(0, n).every(x => x === 0);
  if (zeros(8)) {
    return true; // ::
  }
  if (zeros(7) && m[7] === 1) {
    return true; // ::1
  }
  // IPv4 encapsulee (::ffff:a.b.c.d), compatible (::a.b.c.d), traduite (::ffff:0:a.b.c.d)
  if (zeros(5) && (m[5] === 0xffff || m[5] === 0)) {
    return ipv4EstPrivee(v4DepuisMots(m[6], m[7]));
  }
  if (zeros(4) && m[4] === 0xffff && m[5] === 0) {
    return ipv4EstPrivee(v4DepuisMots(m[6], m[7]));
  }
  // NAT64 (64:ff9b::/96 et 64:ff9b:1::/48) : l'IPv4 vise est dans les derniers mots.
  if (m[0] === 0x64 && m[1] === 0xff9b) {
    return m[2] === 1 || ipv4EstPrivee(v4DepuisMots(m[6], m[7]));
  }
  // 6to4 (2002::/16) : l'IPv4 est dans les mots 1 et 2.
  if (m[0] === 0x2002) {
    return ipv4EstPrivee(v4DepuisMots(m[1], m[2]));
  }
  // Teredo (2001:0::/32) et documentation (2001:db8::/32).
  if (m[0] === 0x2001 && (m[1] === 0 || m[1] === 0xdb8)) {
    return true;
  }
  const premier = m[0];
  return (
    (premier & 0xfe00) === 0xfc00 || // fc00::/7 adresses uniques locales
    (premier & 0xffc0) === 0xfe80 || // fe80::/10 lien local
    (premier & 0xffc0) === 0xfec0 || // fec0::/10 site local (obsolete)
    (premier & 0xff00) === 0xff00 || // ff00::/8 multicast
    premier === 0x100 // 100::/64 trou noir
  );
}

/**
 * Une IP (texte, v4 sous toute forme ou v6 avec ou sans crochets) est-elle
 * privee ? Une valeur qui n'est pas une IP est jugee privee par prudence.
 */
export function estAdressePrivee(ip: string): boolean {
  const v = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (v.includes(':')) {
    const mots = analyserIpv6(v);
    return mots ? ipv6EstPrivee(mots) : true;
  }
  const v4 = analyserIpv4(v);
  return v4 === null ? true : ipv4EstPrivee(v4);
}

/** Nom d'hote designant manifestement le reseau local. */
export function estNomLocal(hote: string): boolean {
  const h = hote.toLowerCase().replace(/\.+$/, '');
  if (!h || NOMS_EXACTS.has(h)) {
    return true;
  }
  // Un nom sans point (« nas », « box ») ne peut viser que le reseau local.
  if (!h.includes('.')) {
    return true;
  }
  return NOMS_LOCAUX.some(s => h === s || h.endsWith(`.${s}`));
}

function jugerHote(a: Adresse, options: OptionsGarde): void {
  if (a.typeHote === 'ipv4' || a.typeHote === 'ipv6') {
    if (estAdressePrivee(a.hote)) {
      throw echec('Cette adresse pointe vers le reseau local', 'garde');
    }
  } else if (estNomLocal(a.hote)) {
    throw echec('Les adresses locales ne sont pas autorisees', 'garde');
  }
  if (a.port) {
    const ports = options.portsAutorises ?? PORTS_PAR_DEFAUT;
    if (!ports.includes(Number(a.port))) {
      throw echec(`Port ${a.port} non autorise`, 'garde');
    }
  }
}

/**
 * Verification synchrone (sans DNS) : schema, identifiants, hote et port.
 * Renvoie l'adresse canonique.
 */
export function verifierUrlPubliqueSync(brut: unknown, options: OptionsGarde = {}, base?: string | null): string {
  const a = analyserUrlHttp(brut, base);
  jugerHote(a, options);
  return adresseEnTexte(a);
}

/**
 * Verification complete : la version synchrone, puis, si un resolveur est
 * fourni, chaque IP de l'hote doit etre publique (un nom public peut
 * resoudre vers 10.0.0.5).
 */
export async function verifierUrlPublique(brut: unknown, options: OptionsGarde = {}, base?: string | null): Promise<string> {
  const texte = verifierUrlPubliqueSync(brut, options, base);
  const a = analyserUrlHttp(texte);
  if (options.resoudre && a.typeHote === 'nom') {
    let ips: string[];
    try {
      ips = await options.resoudre(a.hote);
    } catch {
      throw echec(`Nom de domaine introuvable : ${a.hote}`, 'garde');
    }
    if (!ips.length || ips.some(estAdressePrivee)) {
      throw echec('Cette adresse pointe vers le reseau local', 'garde');
    }
  }
  return texte;
}

// ---------------------------------------------------------------------------
// Nature d'une adresse de lecture
// ---------------------------------------------------------------------------

export type TypeMedia = 'hls' | 'video' | 'iframe';

const EXT_VIDEO = /\.(mp4|m4v|webm|ogv|ogg|mov)$/i;
const EXT_HLS = /\.m3u8$/i;

/** Fichier HLS, fichier video direct, ou page/embed a afficher en iframe. */
export function classerMedia(brut: unknown): TypeMedia {
  const a = analyserUrlHttp(brut);
  if (EXT_HLS.test(a.chemin)) {
    return 'hls';
  }
  if (EXT_VIDEO.test(a.chemin)) {
    return 'video';
  }
  return 'iframe';
}
