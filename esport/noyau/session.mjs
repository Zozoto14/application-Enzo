/**
 * Session courte de l'Esport.
 *
 * L'app présente une fois son jeton du relais (jeton de profil `p1.<id>.<hmac>`
 * d'un ami, ou jeton maître du Fondateur) ; le relais le valide (route
 * `POST /jeton/verifier`, version 7). Le Worker Esport délivre alors une
 * session signée d'environ une heure :
 *
 *   es1.<charge base64url>.<HMAC-SHA256(CLE_ESPORT, charge) base64url>
 *
 * La charge ne contient que l'identifiant du compte, le drapeau super admin
 * et les dates. `CLE_ESPORT` est un secret du Worker (`wrangler secret put`),
 * jamais dans le dépôt ; le jeton maître, lui, n'est jamais copié ici.
 */

import { base64url, depuisBase64url, egal } from './outils.mjs';

export const DUREE_SESSION_MS = 60 * 60 * 1000;
const PREFIXE = 'es1.';
const encodeur = new TextEncoder();
const decodeur = new TextDecoder();

async function cleHmac(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('CLE_ESPORT absente ou trop courte (32 caractères au moins).');
  }
  return globalThis.crypto.subtle.importKey('raw', encodeur.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function signer(secret, texte) {
  return base64url(await globalThis.crypto.subtle.sign('HMAC', await cleHmac(secret), encodeur.encode(texte)));
}

/** Fabrique une session pour `compte` ; rend le jeton et sa date d'expiration (ms). */
export async function creerSession(secret, { compte, superAdmin }, maintenant, duree = DUREE_SESSION_MS) {
  const charge = { v: 1, c: compte, sa: superAdmin ? 1 : 0, iat: maintenant, exp: maintenant + duree };
  const texte = base64url(encodeur.encode(JSON.stringify(charge)));
  return { jeton: `${PREFIXE}${texte}.${await signer(secret, texte)}`, expire: charge.exp };
}

/** Vérifie une session : `{ compte, superAdmin, expire }`, ou `undefined` (signature, forme ou date). */
export async function lireSession(secret, jeton, maintenant) {
  if (typeof jeton !== 'string' || !jeton.startsWith(PREFIXE) || jeton.length > 1024) return undefined;
  const [texte, signature] = jeton.slice(PREFIXE.length).split('.');
  if (!texte || !signature) return undefined;
  if (!egal(signature, await signer(secret, texte))) return undefined;
  let charge;
  try {
    charge = JSON.parse(decodeur.decode(depuisBase64url(texte)));
  } catch {
    return undefined;
  }
  if (!charge || charge.v !== 1 || typeof charge.c !== 'string' || !Number.isFinite(charge.exp) || charge.exp <= maintenant) {
    return undefined;
  }
  return { compte: charge.c, superAdmin: charge.sa === 1, expire: charge.exp };
}
