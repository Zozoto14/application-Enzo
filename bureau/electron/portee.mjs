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
export function fichierAutorise(nom, porteeCourante) {
  if (porteeCourante === undefined || porteeCourante === 'principal' || nom === 'profils') return true;
  return nom === `coffre-${porteeCourante}` || nom === `portefeuille-${porteeCourante}`;
}

/** Passer d'un compte à un autre sans le quitter : seul l'administrateur le peut. */
export function changementPermis(porteeCourante, cible) {
  return porteeCourante === undefined || porteeCourante === 'principal' || porteeCourante === cible;
}
