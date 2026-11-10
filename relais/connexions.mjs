/**
 * Connexions des comptes : limites de débit PAR ADRESSE IP partagées entre processus, et journal
 * des dernières tentatives de connexion (diagnostic du Fondateur, docs/diagnostic-comptes.md).
 *
 * Pourquoi dans la boîte (PostgreSQL) et plus en mémoire : chez o2switch, Passenger (ou LiteSpeed)
 * peut faire tourner PLUSIEURS processus du relais et les arrête quand ils sont inactifs. Une limite
 * gardée en mémoire bloquait une adresse dans un processus et pas dans l'autre (« des fois ça marche,
 * des fois non »), et le Fondateur ne pouvait pas la lever. Ici, tous les processus lisent la même
 * ligne `limite:ip:<empreinte>` (durée de vie bornée) ; « Débloquer » l'efface.
 *
 * Adresses partagées : les membres d'un club sur le même Wi-Fi (ou la même antenne 4G, CGNAT)
 * arrivent avec UNE adresse. Le seuil par adresse est donc large (30 échecs libres, attente plafonnée
 * à 5 min) ; la vraie protection contre la force brute est la limite PAR IDENTIFIANT (5 essais libres,
 * puis attente doublée). Une adresse inconnue ou interne (proxy de l'hébergeur qui n'a pas transmis
 * X-Forwarded-For : 127.0.0.1, 10.x…) n'est JAMAIS limitée : sinon TOUS les comptes partageraient un
 * seul compteur, et une poignée de fautes de frappe bloquerait tout le monde.
 *
 * Journal : `journal-connexion:<compte>` (ou `journal-connexion:h:<empreinte de l'identifiant>` pour un
 * identifiant inconnu), 30 dernières tentatives, 90 jours : date, issue (code), adresse MASQUÉE (dernier
 * octet à zéro) et une empreinte de l'adresse (HMAC par le jeton maître, pour « Débloquer »). Jamais de
 * mot de passe, de preuve, de jeton ni d'adresse e-mail. Chaque tentative est aussi écrite, en une
 * ligne, dans le journal du serveur (`[relais] connexion …`), pour `grep` depuis le terminal cPanel.
 */

export const ESSAIS_LIBRES_IP = 30;
export const ATTENTE_MAX_IP_S = 300;
/** Un quart d'heure sans échec depuis une adresse : on repart de zéro. */
export const OUBLI_IP_MS = 15 * 60_000;
export const PREFIXE_LIMITE_IP = 'limite:ip:';
export const PREFIXE_JOURNAL = 'journal-connexion:';
export const CLE_INCONNUS = `${PREFIXE_JOURNAL}~inconnus`;
export const TAILLE_JOURNAL = 30;
const DUREE_JOURNAL_S = 90 * 86_400;

/** Codes d'issue d'une tentative (les libellés sont dans l'app : src/hub/admin/diagnostic.ts). */
export const ISSUES = [
  'succes',
  'succes-secours',
  'mauvais-mot-de-passe',
  'compte-introuvable',
  'verrouille',
  'adresse-limitee',
  'revoque',
  'a2f-requis',
  'a2f-code',
  'invitation-expiree',
  'invitation-utilisee',
  'invitation-revoquee',
  'invitation-inconnue',
  'invitation-ouverte',
  'jeton-refuse',
  'erreur-serveur',
  'debloque',
];

const encodeur = new TextEncoder();
const hexa = octets => [...new Uint8Array(octets)].map(o => o.toString(16).padStart(2, '0')).join('');

/** Adresse inconnue, de bouclage ou privée : celle d'un intermédiaire, pas d'un appareil. */
export function adresseInterne(ip) {
  const a = String(ip ?? '').trim().toLowerCase().replace(/^::ffff:/, '');
  if (!a || a === 'inconnue' || a === 'unknown' || a === 'localhost') return true;
  if (a === '::1' || a.startsWith('127.') || a.startsWith('10.') || a.startsWith('192.168.') || a.startsWith('169.254.')) return true;
  const m = /^172\.(\d+)\./.exec(a);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(a) || a.startsWith('fe80:')) return true;
  return false;
}

/** Adresse lisible mais pas identifiante : IPv4 sans son dernier octet, IPv6 réduite à ses 3 premiers groupes. */
export function masquerIp(ip) {
  const a = String(ip ?? '').trim().replace(/^::ffff:/i, '');
  if (!a || a === 'inconnue') return 'inconnue';
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.x`;
  if (a.includes(':')) return `${a.split(':').slice(0, 3).join(':')}:…`;
  return 'inconnue';
}

/** Empreinte d'une adresse (HMAC par le jeton maître) : clé de la limite, jamais l'adresse en clair. */
export async function empreinteIp(jetonMaitre, ip) {
  const cle = await crypto.subtle.importKey('raw', encodeur.encode(String(jetonMaitre || 'relais')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hexa(await crypto.subtle.sign('HMAC', cle, encodeur.encode(`applibourse-ip-v1|${String(ip).trim().toLowerCase()}`))).slice(0, 32);
}

/** Délai à attendre (secondes) après `echecs` échecs, au-delà de `libres` essais. */
export function attenteApres(echecs, libres, max, base = 30) {
  if (echecs < libres) return 0;
  return Math.min(max, base * 2 ** (echecs - libres));
}

async function lireJson(boite, cle) {
  try {
    const brut = await boite.get(cle);
    return brut ? JSON.parse(brut) : undefined;
  } catch {
    return undefined;
  }
}

/** Repli sans boîte (tests anciens) : en mémoire de ce processus. */
const memoire = new Map();
const boiteMemoire = {
  async get(cle) {
    const v = memoire.get(cle);
    return v && (!v.fin || v.fin > Date.now()) ? v.valeur : null;
  },
  async put(cle, valeur, o = {}) {
    if (memoire.size > 5000) memoire.clear();
    memoire.set(cle, { valeur, fin: o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0 });
  },
  async delete(cle) {
    memoire.delete(cle);
  },
};
const boiteDe = env => env?.BOITE ?? boiteMemoire;

/** Secondes à attendre pour cette adresse (0 : libre). Une adresse interne n'est jamais limitée. */
export async function attenteIp(env, ip, maintenant = Date.now()) {
  if (adresseInterne(ip)) return 0;
  const l = await lireJson(boiteDe(env), `${PREFIXE_LIMITE_IP}${await empreinteIp(env?.JETON, ip)}`);
  return l && Number(l.jusqua) > maintenant ? Math.ceil((Number(l.jusqua) - maintenant) / 1000) : 0;
}

/** Compte un échec pour cette adresse (rien pour une adresse interne). */
export async function echecIp(env, ip, maintenant = Date.now()) {
  if (adresseInterne(ip)) return;
  const boite = boiteDe(env);
  const cle = `${PREFIXE_LIMITE_IP}${await empreinteIp(env?.JETON, ip)}`;
  const l = (await lireJson(boite, cle)) ?? { echecs: 0, jusqua: 0 };
  if (l.dernier && maintenant - Number(l.dernier) > OUBLI_IP_MS) l.echecs = 0;
  l.echecs = Number(l.echecs || 0) + 1;
  l.dernier = maintenant;
  const attente = attenteApres(l.echecs, ESSAIS_LIBRES_IP, ATTENTE_MAX_IP_S, 5);
  l.jusqua = attente > 0 ? maintenant + attente * 1000 : 0;
  await boite.put(cle, JSON.stringify(l), { expirationTtl: Math.ceil(OUBLI_IP_MS / 1000) + ATTENTE_MAX_IP_S });
}

/** Lève la limite d'une adresse, désignée par son empreinte. */
export async function leverLimiteIp(env, empreinte) {
  if (!/^[0-9a-f]{32}$/.test(empreinte ?? '')) return false;
  const boite = boiteDe(env);
  const cle = `${PREFIXE_LIMITE_IP}${empreinte}`;
  const l = await lireJson(boite, cle);
  if (!l) return false;
  await boite.delete(cle);
  return true;
}

export async function etatLimiteIp(env, empreinte, maintenant = Date.now()) {
  const l = await lireJson(boiteDe(env), `${PREFIXE_LIMITE_IP}${empreinte}`);
  return l ? { echecs: Number(l.echecs) || 0, jusqua: Number(l.jusqua) > maintenant ? Number(l.jusqua) : 0 } : undefined;
}

/**
 * Note une tentative. `qui` : identifiant du compte, ou `h:<empreinte>` pour un identifiant inconnu.
 * Ne lève jamais (un journal plein ou une boîte en panne n'empêchent pas une connexion).
 */
export async function noterTentative(env, qui, issue, ip, maintenant = Date.now(), journal = console) {
  const masquee = masquerIp(ip);
  const lisible = qui.startsWith('h:') ? `identifiant ${qui.slice(2, 10)}…` : `compte ${qui}`;
  try {
    journal.log?.(`[relais] connexion ${lisible} : ${issue} (adresse ${masquee})`);
  } catch {
    // journal indisponible
  }
  try {
    const boite = boiteDe(env);
    const entree = { le: maintenant, issue, ip: masquee, ...(adresseInterne(ip) ? {} : { ipH: await empreinteIp(env?.JETON, ip) }) };
    const cle = `${PREFIXE_JOURNAL}${qui}`;
    const liste = (await lireJson(boite, cle)) ?? [];
    await boite.put(cle, JSON.stringify([entree, ...(Array.isArray(liste) ? liste : [])].slice(0, TAILLE_JOURNAL)), { expirationTtl: DUREE_JOURNAL_S });
    if (issue === 'compte-introuvable') {
      const inconnus = (await lireJson(boite, CLE_INCONNUS)) ?? [];
      await boite.put(CLE_INCONNUS, JSON.stringify([{ le: maintenant, h: qui.slice(2, 10), ip: masquee }, ...(Array.isArray(inconnus) ? inconnus : [])].slice(0, TAILLE_JOURNAL)), {
        expirationTtl: DUREE_JOURNAL_S,
      });
    }
  } catch {
    // Boîte indisponible : la ligne du journal du serveur suffit.
  }
}

export async function lireTentatives(env, qui) {
  const liste = await lireJson(boiteDe(env), `${PREFIXE_JOURNAL}${qui}`);
  return Array.isArray(liste) ? liste.filter(e => e && typeof e.le === 'number' && typeof e.issue === 'string') : [];
}

export async function lireInconnus(env) {
  const liste = await lireJson(boiteDe(env), CLE_INCONNUS);
  return Array.isArray(liste) ? liste : [];
}

/** Pour les tests : vide le repli en mémoire. */
export function oublierMemoire() {
  memoire.clear();
}
