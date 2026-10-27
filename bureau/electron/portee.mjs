/**
 * Portée des fichiers selon le compte ouvert (voir `principal.mjs`).
 * Module sans Electron, pour être testé seul.
 */

export const MOTIF_PROFIL = /^(principal|[a-z0-9]{6,16})$/;

/**
 * Un compte ami n'atteint que ses fichiers et la liste des profils ;
 * l'administrateur et l'écran de connexion (aucun compte ouvert) atteignent
 * la liste fermée entière.
 */
export function fichierAutorise(nom, porteeCourante, etendues = []) {
  if (porteeCourante === undefined || porteeCourante === 'principal' || nom === 'profils') return true;
  if ([porteeCourante, ...etendues].some(id => nom === `coffre-${id}` || nom === `portefeuille-${id}` || nom === `ecarte-portefeuille-${id}`)) return true;
  // Caches de synchronisation : ceux du compte ouvert seulement (jamais ceux d'un compte géré).
  return nom === `synchro-entrant-${porteeCourante}` || nom === `synchro-sortant-${porteeCourante}`;
}

/**
 * Fichiers d'un profil d'ami : même liste fermée, suffixée d'un identifiant
 * court fait de lettres et de chiffres seulement — pas de « ../ » possible.
 */
export function fichierDeProfil(nom) {
  const trouve = /^(portefeuille|coffre|synchro-entrant|synchro-sortant|ecarte-portefeuille)-([a-z0-9]{6,16})$/.exec(String(nom));
  if (!trouve) return undefined;
  if (trouve[1] === 'ecarte-portefeuille') return `portefeuille-${trouve[2]}.ecarte.ab`;
  return trouve[1] === 'portefeuille' ? `portefeuille-${trouve[2]}.ab` : `${trouve[1]}-${trouve[2]}.json`;
}

/** Nombre maximal de comptes qu'un gestionnaire peut ajouter à sa portée pendant une session. */
export const MAX_ETENDUES = 16;

/**
 * Un gestionnaire (un ami à l'Administration limitée) crée ou régénère le
 * compte des amis qu'il gère : il demande à ajouter leurs fichiers à sa
 * portée. Refusé à l'administrateur (déjà tout) et à l'écran de connexion,
 * pour lui-même, pour `principal`, et au-delà de `MAX_ETENDUES`.
 *
 * Limite assumée : le processus principal ne connaît pas les rôles, il ne
 * peut donc pas vérifier que l'appelant est vraiment gestionnaire. C'est la
 * logique de l'app qui l'exige (`admin/roles.ts`) ; la barrière qui protège
 * le contenu des comptes reste cryptographique (chaque coffre a sa clé).
 */
export function extensionPermise(porteeCourante, id, etendues = []) {
  return (
    porteeCourante !== undefined &&
    porteeCourante !== 'principal' &&
    MOTIF_PROFIL.test(id) &&
    id !== 'principal' &&
    id !== porteeCourante &&
    (etendues.includes(id) || etendues.length < MAX_ETENDUES)
  );
}

/**
 * Passer d'un compte à un autre sans le quitter : le compte historique, ou un
 * titulaire (Administrateur, Fondateur) vers un compte qu'il a ajouté à sa
 * portée (séquestre d'un rang inférieur). Jamais vers `principal`.
 */
export function changementPermis(porteeCourante, cible, etendues = []) {
  return porteeCourante === undefined || porteeCourante === 'principal' || porteeCourante === cible || (cible !== 'principal' && etendues.includes(cible));
}
