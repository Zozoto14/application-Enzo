/**
 * Validation en deux étapes (A2F, code TOTP à six chiffres) de la connexion par identifiant
 * (relais version 10, docs/connexion-amis.md).
 *
 * Le code est vérifié PAR LE SERVEUR, avant de remettre quoi que ce soit (charge scellée, session) :
 * `POST /acces/<h>/ouvrir` avec une preuve juste rend 403 `a2f-requis` tant que le code manque, puis
 * 403 `a2f-code` s'il est faux ou déjà servi. Les codes de récupération (`/acces/<h>/secours`) restent
 * une autre porte, sans code à six chiffres.
 *
 *  - Secret TOTP stocké CHIFFRÉ (AES-256-GCM) par une clé du serveur : `CLE_A2F` (relais.env) si elle
 *    existe, sinon tirée du jeton maître (HMAC) ; lié au compte (données associées). Jamais rendu.
 *  - Fenêtre de ±1 pas de 30 s ; anti-rejeu : un code (un pas) ne sert qu'une fois, et jamais un pas
 *    plus ancien que le dernier accepté ; 5 essais libres puis attente doublée (30 s → 15 min).
 *  - `GET /v10/a2f/<compte>` : `{ active }` ; `PUT` (ou `POST`) `{ secret, code }` : active (le code prouve que
 *    l'application d'authentification est bien enrôlée) ; `DELETE` `{ code }` : désactive. Le compte
 *    lui-même (Fondateur : jeton maître ou sa session ; ami : son jeton de profil). Le jeton maître
 *    peut aussi retirer l'A2F d'un ami (téléphone perdu), sans code.
 *
 * Clés de la boîte : `a2f:<compte>` (secret chiffré, dernier pas servi), `limite:a2f:<compte>`.
 */

const encodeur = new TextEncoder();
const PAS_S = 30;
const ESSAIS_LIBRES = 5;
const ATTENTE_MAX_S = 900;
const MOTIF_COMPTE = /^(principal|[a-z0-9]{6,16})$/;
const MOTIF_SECRET = /^[A-Z2-7]{16,64}$/;

const hexa = octets => [...new Uint8Array(octets)].map(o => o.toString(16).padStart(2, '0')).join('');
const deHexa = t => Uint8Array.from(t.match(/../g) ?? [], o => Number.parseInt(o, 16));

export function depuisBase32(texte) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const propre = String(texte).toUpperCase().replace(/[\s=-]+/g, '');
  const octets = [];
  let tampon = 0;
  let bits = 0;
  for (const c of propre) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error('Secret illisible.');
    tampon = (tampon << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      octets.push((tampon >> bits) & 0xff);
    }
  }
  return Uint8Array.from(octets);
}

async function cleServeur(env) {
  const materiau = typeof env.CLE_A2F === 'string' && env.CLE_A2F.length >= 32 ? env.CLE_A2F : env.JETON;
  const hmac = await crypto.subtle.importKey('raw', encodeur.encode(String(materiau)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const octets = await crypto.subtle.sign('HMAC', hmac, encodeur.encode('applibourse-a2f-cle-v1'));
  return crypto.subtle.importKey('raw', octets, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function scellerSecret(env, compte, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chiffre = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encodeur.encode(`a2f|${compte}`) }, await cleServeur(env), depuisBase32(secret));
  return { iv: hexa(iv), c: hexa(chiffre) };
}

async function ouvrirSecret(env, compte, depot) {
  const clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deHexa(depot.iv), additionalData: encodeur.encode(`a2f|${compte}`) }, await cleServeur(env), deHexa(depot.c));
  return new Uint8Array(clair);
}

async function hotp(secret, compteur) {
  const cle = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const tampon = new Uint8Array(8);
  let reste = BigInt(compteur);
  for (let i = 7; i >= 0; i--) {
    tampon[i] = Number(reste & 0xffn);
    reste >>= 8n;
  }
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', cle, tampon));
  const o = h[h.length - 1] & 0x0f;
  const binaire = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(binaire % 1_000_000).padStart(6, '0');
}

/**
 * Pas (compteur TOTP) qui valide `code` dans la fenêtre ±1, plus récent que `dernier` ; sinon -1.
 * Toutes les fenêtres sont calculées (durée constante).
 */
export async function pasValide(secret, code, maintenant, dernier = -1) {
  const saisi = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(saisi)) return -1;
  const courant = Math.floor(maintenant / 1000 / PAS_S);
  let trouve = -1;
  for (const pas of [courant - 1, courant, courant + 1]) {
    const attendu = await hotp(secret, pas);
    let d = 0;
    for (let i = 0; i < 6; i++) d |= attendu.charCodeAt(i) ^ saisi.charCodeAt(i);
    if (d === 0 && pas > dernier && trouve < 0) trouve = pas;
  }
  return trouve;
}

async function lire(env, cle) {
  try {
    const brut = await env.BOITE.get(cle);
    return brut ? JSON.parse(brut) : undefined;
  } catch {
    return undefined;
  }
}

export const lireA2f = (env, compte) => lire(env, `a2f:${compte}`);

const attenteApres = echecs => (echecs < ESSAIS_LIBRES ? 0 : Math.min(ATTENTE_MAX_S, 30 * 2 ** (echecs - ESSAIS_LIBRES)));

/**
 * Vérifie le code de la connexion (preuve du mot de passe déjà juste). Rend `{ ok: true }` (le pas est
 * alors consommé) ou `{ ok: false, statut, corps }` : code manquant, faux ou rejoué, trop d'essais.
 */
export async function verifierCodeConnexion(env, compte, depot, code, maintenant = Date.now()) {
  const limite = (await lire(env, `limite:a2f:${compte}`)) ?? { echecs: 0, jusqua: 0 };
  if (limite.jusqua > maintenant) {
    const attente = Math.ceil((limite.jusqua - maintenant) / 1000);
    return { ok: false, statut: 429, corps: { erreur: 'Trop de codes faux : réessayez plus tard.', motif: 'trop-de-tentatives', attente }, attente };
  }
  if (!code) return { ok: false, statut: 403, corps: { erreur: 'Code à six chiffres demandé (validation en deux étapes).', motif: 'a2f-requis' } };
  let pas = -1;
  try {
    pas = await pasValide(await ouvrirSecret(env, compte, depot), code, maintenant, Number.isSafeInteger(depot.dernier) ? depot.dernier : -1);
  } catch {
    pas = -1;
  }
  if (pas < 0) {
    const echecs = limite.echecs + 1;
    const attente = attenteApres(echecs);
    await env.BOITE.put(`limite:a2f:${compte}`, JSON.stringify({ echecs, jusqua: attente > 0 ? maintenant + attente * 1000 : 0 }), { expirationTtl: 86_400 });
    return {
      ok: false,
      statut: 403,
      corps: { erreur: 'Code à six chiffres incorrect ou déjà utilisé.', motif: 'a2f-code', ...(attente > 0 ? { attente } : { restants: Math.max(0, ESSAIS_LIBRES - echecs) }) },
    };
  }
  await env.BOITE.put(`a2f:${compte}`, JSON.stringify({ ...depot, dernier: pas }));
  if (limite.echecs > 0) await env.BOITE.delete(`limite:a2f:${compte}`);
  return { ok: true };
}

/** `/v10/a2f/<compte>` : état, activation, désactivation (voir l'en-tête). */
export async function routeA2f(requete, env, portee, compte, { reponse, erreur }) {
  if (!MOTIF_COMPTE.test(compte)) return erreur('Compte invalide.', 400);
  const sien = compte === 'principal' ? Boolean(portee.maitre) : portee.profil === compte;
  const maitrePc = Boolean(portee.maitre && !portee.session);
  if (!sien && !(portee.maitre && requete.method === 'DELETE')) return erreur('Ce compte n’est pas le vôtre.', 403);
  const depot = await lireA2f(env, compte);
  if (requete.method === 'GET') return reponse({ active: Boolean(depot) });
  let corps;
  try {
    corps = await requete.json();
  } catch {
    corps = {};
  }
  const maintenant = Date.now();
  if (requete.method === 'PUT' || requete.method === 'POST') {
    const secret = typeof corps?.secret === 'string' ? corps.secret.toUpperCase().replace(/[\s=-]+/g, '') : '';
    if (!MOTIF_SECRET.test(secret)) return erreur('Secret illisible.', 400);
    const pas = await pasValide(depuisBase32(secret), corps.code, maintenant);
    if (pas < 0) return reponse({ erreur: 'Code à six chiffres incorrect : vérifiez l’heure du téléphone et l’application d’authentification.', motif: 'a2f-code' }, 403);
    await env.BOITE.put(`a2f:${compte}`, JSON.stringify({ v: 1, ...(await scellerSecret(env, compte, secret)), dernier: pas, le: maintenant }));
    await env.BOITE.delete(`limite:a2f:${compte}`);
    return reponse({ ok: true, active: true });
  }
  if (requete.method === 'DELETE') {
    if (!depot) return reponse({ ok: true, active: false });
    // Sans code : le jeton maître (PC du Fondateur), ou le Fondateur pour le compte d'un ami (téléphone perdu).
    if (!(maitrePc || (portee.maitre && compte !== 'principal'))) {
      const v = await verifierCodeConnexion(env, compte, depot, typeof corps?.code === 'string' ? corps.code : '', maintenant);
      if (!v.ok) return reponse(v.corps, v.statut);
    }
    await env.BOITE.delete(`a2f:${compte}`);
    await env.BOITE.delete(`limite:a2f:${compte}`);
    return reponse({ ok: true, active: false });
  }
  return erreur('Méthode non autorisée.', 405);
}
