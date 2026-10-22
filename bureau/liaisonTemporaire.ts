/**
 * RETOUR TEMPORAIRE du code de liaison AB1 sur le site (accueil d'un navigateur neuf, ou lien
 * `…/#liaison=AB1.…`), pour une seule chose : qu'un Fondateur loin de son PC relie un navigateur à
 * son compte (jeton maître), le déverrouille (mot de passe + code à six chiffres) et y ACTIVE sa
 * connexion par identifiant (Paramètres › Sécurité). Voir docs/connexion-amis.md.
 *
 * Il se retire tout seul :
 *  - après `AB1_TEMPORAIRE_JUSQU_AU` (la carte et la lecture du lien disparaissent) ;
 *  - dès que le compte du Fondateur a une connexion par identifiant active : le coffre publié sous le
 *    jeton maître est alors « canonique » (`passerAConnexionParIdentifiant`). Cette vérification ne se
 *    fait qu'APRÈS avoir lu ce coffre avec le jeton du code : un visiteur anonyme n'apprend rien.
 *
 * Vérifications gardées (comme avant la version 9) : code lisible (`decoderLiaison` : https, jeton),
 * jeton MAÎTRE (un code d'ami ne sert plus : l'ami se connecte par identifiant), relais connu
 * (celui du site ou https://relais.appdashboard.fr), compte réellement trouvé sur ce relais. Un code
 * émis pour une ancienne adresse du relais (qui n'existe plus) n'est essayé QUE sur le relais du site,
 * avec le même jeton : le jeton n'est jamais envoyé à un serveur inconnu.
 */

import { decoderLiaison, normaliserAdresse, type Liaison } from '../src/sync/relais/liaison';
import { estMaitre } from '../src/sync/relais/portees';

/** Dernier jour (inclus) où le code AB1 est accepté sur le site. */
export const AB1_TEMPORAIRE_JUSQU_AU = '2026-11-30';

/** Relais du site (o2switch). */
export const RELAIS_OFFICIEL = 'https://relais.appdashboard.fr';

/** Mémoire du navigateur : connexion par identifiant constatée active, la carte ne revient plus ici. */
export const CLE_AB1_TERMINE = 'applibourse.ab1Temporaire.termine';

export function ab1TemporaireOuvert(maintenant: Date = new Date(), termineIci = false): boolean {
  if (termineIci) return false;
  return maintenant.getTime() < Date.parse(`${AB1_TEMPORAIRE_JUSQU_AU}T23:59:59.999Z`);
}

/** Adresse de relais acceptée : celle du site, ou le relais officiel. */
export function relaisAutorise(relais: string, relaisDuSite?: string): boolean {
  const r = normaliserAdresse(relais).toLowerCase();
  if (relaisDuSite && r === normaliserAdresse(relaisDuSite).toLowerCase()) return true;
  return r === RELAIS_OFFICIEL;
}

/** Code AB1 apporté par l'adresse (`#liaison=AB1.…`), s'il est lisible. */
export function codeAb1DuLien(fragment: string): string | undefined {
  try {
    const trouve = /AB1\.[A-Za-z0-9_-]+/.exec(decodeURIComponent(fragment));
    return trouve && decoderLiaison(trouve[0]) ? trouve[0] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Lit et vérifie un code AB1 administrateur. Rend les liaisons à essayer, dans l'ordre : le relais
 * du site d'abord (même jeton : les clés ont déménagé avec les données), puis celui du code s'il est
 * connu. Un code qui désigne un autre serveur (ancienne adresse) : le relais du site seulement.
 */
export function liaisonsAEssayer(code: string, relaisDuSite?: string): Liaison[] {
  const liaison = decoderLiaison(code);
  if (!liaison) throw new Error('Code de liaison illisible : il commence par AB1. (copiez-le en entier).');
  if (!estMaitre(liaison)) {
    throw new Error('Ce code n’est pas celui de l’administrateur. Ami : connecte-toi avec ton identifiant et ton mot de passe (ou ton invitation).');
  }
  const site = relaisDuSite && relaisAutorise(relaisDuSite) ? normaliserAdresse(relaisDuSite) : undefined;
  if (!relaisAutorise(liaison.relais, relaisDuSite)) {
    if (!site) throw new Error('Ce code désigne un serveur inconnu : il n’est pas accepté ici.');
    return [{ relais: site, jeton: liaison.jeton }];
  }
  const candidats: Liaison[] = [];
  if (site && site.toLowerCase() !== liaison.relais.toLowerCase()) candidats.push({ relais: site, jeton: liaison.jeton });
  candidats.push({ relais: liaison.relais, jeton: liaison.jeton });
  return candidats;
}

/** Le coffre du Fondateur publié sur le relais a-t-il déjà la connexion par identifiant ? */
export function connexionParIdentifiantActive(coffre: unknown): boolean {
  return Boolean(coffre && typeof coffre === 'object' && (coffre as { canonique?: unknown }).canonique === true);
}
