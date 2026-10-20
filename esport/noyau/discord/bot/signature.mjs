/**
 * Vérification des requêtes d'interactions de Discord : signature Ed25519 de
 * `X-Signature-Timestamp + corps brut`, avec la clé publique de l'application
 * (DISCORD_PUBLIC_KEY, 64 caractères hexadécimaux). WebCrypto uniquement
 * (Workers et Node 22) : aucune dépendance.
 *
 * En plus de la signature, l'horodatage doit être récent (5 minutes, dans les
 * deux sens) : une requête signée rejouée plus tard est refusée.
 */

export const FENETRE_HORODATAGE_S = 300;
const MOTIF_CLE = /^[0-9a-f]{64}$/i;
const MOTIF_SIGNATURE = /^[0-9a-f]{128}$/i;
const encodeur = new TextEncoder();
const cache = new Map();

const octetsHexa = hexa => Uint8Array.from(hexa.match(/../g).map(o => Number.parseInt(o, 16)));

async function importer(cleHexa) {
  if (cache.has(cleHexa)) return cache.get(cleHexa);
  const brute = octetsHexa(cleHexa);
  let cle;
  try {
    cle = await globalThis.crypto.subtle.importKey('raw', brute, { name: 'Ed25519' }, false, ['verify']);
  } catch {
    // Anciens runtimes Cloudflare : nom propriétaire de l'algorithme.
    cle = await globalThis.crypto.subtle.importKey('raw', brute, { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }, false, ['verify']);
  }
  cache.set(cleHexa, cle);
  return cle;
}

/**
 * Rend `{ ok: true }` ou `{ ok: false, motif }`. `maintenant` en ms.
 * Ne lève jamais : une clé ou une signature illisible est un refus.
 */
export async function verifierSignature({ clePublique, signature, horodatage, corps, maintenant = Date.now() }) {
  if (typeof clePublique !== 'string' || !MOTIF_CLE.test(clePublique)) return { ok: false, motif: 'cle-absente' };
  if (typeof signature !== 'string' || !MOTIF_SIGNATURE.test(signature)) return { ok: false, motif: 'signature' };
  if (typeof horodatage !== 'string' || !/^\d{1,12}$/.test(horodatage)) return { ok: false, motif: 'horodatage' };
  if (Math.abs(maintenant / 1000 - Number(horodatage)) > FENETRE_HORODATAGE_S) return { ok: false, motif: 'horodatage' };
  try {
    const cle = await importer(clePublique.toLowerCase());
    const algo = cle.algorithm?.name === 'NODE-ED25519' ? { name: 'NODE-ED25519' } : { name: 'Ed25519' };
    const valide = await globalThis.crypto.subtle.verify(algo, cle, octetsHexa(signature), encodeur.encode(`${horodatage}${corps}`));
    return valide ? { ok: true } : { ok: false, motif: 'signature' };
  } catch {
    return { ok: false, motif: 'signature' };
  }
}
