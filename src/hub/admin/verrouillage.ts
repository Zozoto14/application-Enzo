/**
 * Verrouillage du panneau d'Administration, en données pures.
 *
 *  - après `verrouMinutes` sans activité, le panneau se couvre et redemande
 *    mot de passe + code TOTP (mêmes vérifications, mêmes temporisations
 *    qu'au déverrouillage de l'app : voir `Session.verifierIdentite`) ;
 *  - les actions sensibles (régénérer des identifiants, supprimer un compte,
 *    désactiver le verrouillage…) exigent une vérification datant de moins
 *    de `confianceMinutes`.
 *
 * Rien n'est gardé du mot de passe : seulement l'heure de la dernière
 * vérification réussie, en mémoire.
 */

export interface EtatVerrouPanel {
  derniereActivite: number;
  /** Dernière vérification d'identité réussie (ms), absente au départ. */
  derniereVerification?: number;
  verrouille: boolean;
}

export function etatInitial(maintenant: number): EtatVerrouPanel {
  return { derniereActivite: maintenant, verrouille: false };
}

/** Vrai quand le délai d'inactivité est dépassé (0 minute : jamais). */
export function doitVerrouiller(etat: EtatVerrouPanel, maintenant: number, verrouMinutes: number): boolean {
  return !etat.verrouille && verrouMinutes > 0 && maintenant - etat.derniereActivite >= verrouMinutes * 60_000;
}

export function noterActivite(etat: EtatVerrouPanel, maintenant: number): EtatVerrouPanel {
  return etat.verrouille ? etat : { ...etat, derniereActivite: maintenant };
}

export function verrouiller(etat: EtatVerrouPanel): EtatVerrouPanel {
  return { ...etat, verrouille: true };
}

/** Après une vérification réussie : déverrouille et ouvre la fenêtre de confiance. */
export function apresVerification(etat: EtatVerrouPanel, maintenant: number): EtatVerrouPanel {
  return { derniereActivite: maintenant, derniereVerification: maintenant, verrouille: false };
}

/** Une action sensible peut-elle se passer d'une nouvelle vérification ? */
export function confianceValide(etat: EtatVerrouPanel, maintenant: number, confianceMinutes: number): boolean {
  return etat.derniereVerification !== undefined && maintenant - etat.derniereVerification < confianceMinutes * 60_000;
}
