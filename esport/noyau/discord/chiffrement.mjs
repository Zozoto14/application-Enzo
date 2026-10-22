/**
 * Secret du webhook Discord d'une team : validation de l'adresse, chiffrement
 * au repos (AES-GCM 256) et masquage. WebCrypto uniquement (Node 22).
 *
 * Choix de clé (documenté dans docs/esport/discord.md) : la clé AES est
 * DÉRIVÉE par HKDF-SHA-256 d'un secret du serveur, avec un contexte dédié
 * (`info`). Par défaut ce secret est `CLE_ESPORT` (aucun nouveau secret à
 * gérer) ; un secret séparé `CLE_DISCORD`, s'il existe, a la priorité (il
 * permet de changer `CLE_ESPORT` sans perdre les webhooks). Le contexte HKDF
 * rend la clé AES sans rapport avec la clé HMAC des sessions, même secret.
 * L'identifiant de la team est une donnée authentifiée (AAD) : un chiffré
 * copié d'une team à l'autre ne se déchiffre pas.
 *
 * Format stocké : `dw1.<iv base64url>.<chiffré+tag base64url>`.
 */

import { base64url, depuisBase64url, echec } from '../outils.mjs';

const encodeur = new TextEncoder();
const decodeur = new TextDecoder();
const VERSION = 'dw1';
const INFO_HKDF = 'applibourse-esport/discord-webhook/aes-gcm/v1';
const SEL_HKDF = 'applibourse-esport';

/** discord.com ou discordapp.com (+ canary / ptb), identifiant numérique, jeton. Pas de paramètres d'adresse. */
const MOTIF_WEBHOOK = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/(?:v\d{1,2}\/)?webhooks\/(\d{5,25})\/([A-Za-z0-9_-]{10,200})$/;

/** Adresse de webhook validée (texte propre) ; lève une erreur 400 sinon, sans jamais citer la saisie. */
export function validerUrlWebhook(saisie) {
  const texte = typeof saisie === 'string' ? saisie.trim() : '';
  if (!MOTIF_WEBHOOK.test(texte) || texte.length > 400) {
    throw echec(400, 'webhook-url', 'Adresse de webhook invalide : elle doit commencer par https://discord.com/api/webhooks/ (ou discordapp.com) et être copiée en entier depuis Discord.');
  }
  return texte;
}

/** Affichage masqué : « …/abcd » (les 4 derniers caractères du jeton). */
export function masquerWebhook(urlOuFin) {
  const fin = MOTIF_WEBHOOK.exec(urlOuFin)?.[2]?.slice(-4) ?? String(urlOuFin).slice(-4);
  return `…/${fin}`;
}

export const finDeWebhook = url => MOTIF_WEBHOOK.exec(url)?.[2]?.slice(-4) ?? '';

async function cleAes(secret, usage) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw echec(503, 'non-configure', 'Le serveur Esport n’a pas de clé pour chiffrer les webhooks (CLE_ESPORT ou CLE_DISCORD, 32 caractères au moins).');
  }
  const graine = await globalThis.crypto.subtle.importKey('raw', encodeur.encode(secret), 'HKDF', false, ['deriveKey']);
  return globalThis.crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encodeur.encode(SEL_HKDF), info: encodeur.encode(INFO_HKDF) },
    graine,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  );
}

const donneeAssociee = teamId => encodeur.encode(`discord-webhook:${teamId}`);

export async function chiffrerWebhook(secret, teamId, url) {
  const cle = await cleAes(secret, ['encrypt']);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const chiffre = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: donneeAssociee(teamId) }, cle, encodeur.encode(url));
  return `${VERSION}.${base64url(iv)}.${base64url(chiffre)}`;
}

/** Adresse en clair, ou `undefined` si le chiffré est altéré, d'une autre team ou chiffré avec une autre clé. */
export async function dechiffrerWebhook(secret, teamId, stocke) {
  const [version, iv, chiffre, reste] = String(stocke ?? '').split('.');
  if (version !== VERSION || !iv || !chiffre || reste !== undefined) return undefined;
  const cle = await cleAes(secret, ['decrypt']);
  try {
    const clair = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: depuisBase64url(iv), additionalData: donneeAssociee(teamId) }, cle, depuisBase64url(chiffre));
    const url = decodeur.decode(clair);
    return MOTIF_WEBHOOK.test(url) ? url : undefined;
  } catch {
    return undefined;
  }
}
