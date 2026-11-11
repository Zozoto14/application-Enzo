/**
 * Preuve de l'adresse du navigateur que le serveur Esport transmet au relais (POST /jeton/verifier) : HMAC-SHA256
 * par la clé partagée du même hébergement (~/.appdashboard/adresse-relais.cle), liée à l'adresse, à l'heure et au
 * jeton vérifié. Sans elle, le relais ne croit aucune adresse annoncée par l'appelant (X-Forwarded-For se falsifie).
 * WebCrypto seulement : utilisable par le relais (Node ou Workers) et par l'Esport.
 */

const encodeur = new TextEncoder();
const hexa = octets => [...new Uint8Array(octets)].map(o => o.toString(16).padStart(2, '0')).join('');

export async function preuveAdresse(cle, ip, horodatage, jeton) {
  const k = await crypto.subtle.importKey('raw', encodeur.encode(cle), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const empreinteJeton = hexa(await crypto.subtle.digest('SHA-256', encodeur.encode(jeton)));
  return hexa(await crypto.subtle.sign('HMAC', k, encodeur.encode(`adresse-v1|${ip}|${horodatage}|${empreinteJeton}`)));
}
