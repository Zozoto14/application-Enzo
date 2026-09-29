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
  return [porteeCourante, ...etendues].some(id => nom === `coffre-${id}` || nom === `portefeuille-${id}`);
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

/** Passer d'un compte à un autre sans le quitter : seul l'administrateur le peut. */
export function changementPermis(porteeCourante, cible) {
  return porteeCourante === undefined || porteeCourante === 'principal' || porteeCourante === cible;
}
