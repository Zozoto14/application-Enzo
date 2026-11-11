/**
 * Validation d'un jeton du relais par le relais lui-même (route
 * `POST /jeton/verifier`, relais version 7). Le serveur Esport ne connaît pas
 * le jeton maître : il demande seulement « ce jeton est-il valable, révoqué,
 * et de quel compte ? ».
 *
 * Deux transports :
 *  - adresse publique du relais (`RELAIS_URL`, https://relais.appdashboard.fr) :
 *    le serveur o2switch ;
 *  - `liaison` : un objet `{ fetch(url, init) }` qui appelle un relais dans le
 *    même processus (serveur local de développement, tests).
 */

import { echec } from './outils.mjs';
import { preuveAdresse } from '../../relais/preuve-adresse.mjs';

const MOTIF_JETON = /^[\x21-\x7e]{16,256}$/;
const MOTIF_COMPTE = /^(principal|[a-z0-9]{6,16})$/;

/**
 * Fabrique `verifierJeton(jeton, ip)` → `{ compte, superAdmin }`, ou lève
 * (401 jeton refusé, 403 compte révoqué, 503 relais injoignable ou trop ancien).
 */
export function verificateurRelais({ liaison, adresse, fetch: requete = globalThis.fetch, cleAdresse = () => '' }) {
  const appeler = async (jeton, ip) => {
    // Adresse du navigateur : prouvée par HMAC (clé partagée avec le relais du même hébergement), sinon le relais
    // ne la croit pas. X-Forwarded-For reste pour un relais d'avant ce changement.
    const cle = typeof cleAdresse === 'function' ? cleAdresse() : cleAdresse;
    const preuve = {};
    if (ip && cle) {
      const horodatage = String(Date.now());
      preuve['X-Adresse-Navigateur'] = ip;
      preuve['X-Adresse-Horodatage'] = horodatage;
      preuve['X-Adresse-Preuve'] = await preuveAdresse(cle, ip, horodatage, jeton);
    }
    const init = {
      method: 'POST',
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json', ...(ip ? { 'X-Forwarded-For': ip } : {}), ...preuve },
      body: '{}',
    };
    if (liaison && typeof liaison.fetch === 'function') {
      return liaison.fetch('https://relais.interne/jeton/verifier', init);
    }
    if (adresse) {
      return requete(`${String(adresse).replace(/\/+$/, '')}/jeton/verifier`, init);
    }
    throw echec(503, 'relais-absent', 'Le serveur Esport n’est relié à aucun relais (variable RELAIS_URL).');
  };

  return async function verifierJeton(jeton, ip) {
    if (typeof jeton !== 'string' || !MOTIF_JETON.test(jeton)) {
      throw echec(401, 'jeton', 'Jeton du relais manquant ou illisible.');
    }
    let reponse;
    try {
      reponse = await appeler(jeton, ip);
    } catch (e) {
      if (e && e.statut) throw e;
      throw echec(503, 'relais-injoignable', 'Le relais est injoignable : réessayez dans un instant.');
    }
    if (reponse.status === 429) {
      throw echec(429, 'trop-de-tentatives', 'Trop de tentatives : réessayez plus tard.');
    }
    let lu;
    try {
      lu = await reponse.json();
    } catch {
      lu = undefined;
    }
    // Un relais d'avant la version 7 ne connaît pas la route (401 sans jeton reconnu, 404 sinon).
    if (!lu || typeof lu.valide !== 'boolean') {
      throw echec(503, 'relais-ancien', 'Le relais doit être mis à jour (version 7) pour l’Esport.');
    }
    if (!lu.valide) throw echec(401, 'jeton', 'Jeton du relais refusé.');
    if (lu.revoque) throw echec(403, 'revoque', 'Accès révoqué par l’administrateur.');
    if (typeof lu.compte !== 'string' || !MOTIF_COMPTE.test(lu.compte)) {
      throw echec(503, 'relais-illisible', 'Réponse du relais illisible.');
    }
    return { compte: lu.compte, superAdmin: lu.maitre === true };
  };
}
