/**
 * Outils communs du serveur Esport, sans dépendance au runtime :
 * WebCrypto (`globalThis.crypto`), Request et Response existent aussi sous
 * Node 22, où tournent les tests et le serveur local.
 */

const encodeur = new TextEncoder();

/** Erreur métier : un statut HTTP, un code stable (pour l'app et les tests) et un message lisible. */
export class ErreurEsport extends Error {
  constructor(statut, code, message) {
    super(message);
    this.statut = statut;
    this.code = code;
  }
}

export const echec = (statut, code, message) => new ErreurEsport(statut, code, message);

/** Identifiant UUID v4, en texte (compatible SQLite et Postgres). */
export function nouvelId() {
  return globalThis.crypto.randomUUID();
}

/** Date ISO 8601 en UTC. */
export function iso(ms) {
  return new Date(ms).toISOString();
}

export function hexa(octets) {
  return [...new Uint8Array(octets)].map(o => o.toString(16).padStart(2, '0')).join('');
}

export function base64url(octets) {
  let binaire = '';
  for (const o of new Uint8Array(octets)) binaire += String.fromCharCode(o);
  return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function depuisBase64url(texte) {
  const b64 = texte.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((texte.length + 3) % 4);
  const binaire = atob(b64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}

export async function sha256Hex(texte) {
  return hexa(await globalThis.crypto.subtle.digest('SHA-256', encodeur.encode(texte)));
}

/** Octets aléatoires en base64url (jetons d'invitation). */
export function aleatoire(octets = 24) {
  const tampon = new Uint8Array(octets);
  globalThis.crypto.getRandomValues(tampon);
  return base64url(tampon);
}

/** Comparaison en temps constant. */
export function egal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Texte saisi : sans caractères de contrôle, espaces resserrés, tronqué. */
export function texteNettoye(valeur, max) {
  return String(valeur ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Texte multiligne (description) : contrôles retirés sauf retours à la ligne. */
export function texteLong(valeur, max) {
  return String(valeur ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, max);
}

/** Slug d'URL à partir d'un nom (« Les Faucons » → « les-faucons »). */
export function slugDe(nom) {
  const s = String(nom ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'team';
}

/** Lit un JSON stocké en texte, avec une valeur de repli. */
export function jsonOu(texte, repli) {
  if (typeof texte !== 'string' || !texte) return repli;
  try {
    return JSON.parse(texte);
  } catch {
    return repli;
  }
}
