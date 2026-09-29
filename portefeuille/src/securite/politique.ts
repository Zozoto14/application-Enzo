/**
 * Politique de déverrouillage.
 *
 * Deux facteurs sont exigés à l'ouverture : le mot de passe, qui seul permet
 * de reconstituer la clé de chiffrement, et le code TOTP. Face ID ne les
 * remplace pas — il ne peut pas, puisqu'il ne produit aucune clé — mais sert
 * de raccourci pour les réouvertures rapprochées, tant que la clé maîtresse
 * est encore en mémoire.
 *
 * La temporisation après échecs ne protège que l'accès par l'application : un
 * attaquant qui détient le fichier n'en subit rien. Sa vraie utilité est
 * d'empêcher quelqu'un qui a l'appareil en main d'essayer des codes à la
 * chaîne. Le coût réel d'une attaque hors ligne, lui, vient d'Argon2id.
 */

export interface PolitiqueVerrouillage {
  /** Durée pendant laquelle Face ID suffit à rouvrir, en minutes. */
  fenetreBiometrieMinutes: number;
  /** Échecs tolérés avant que la temporisation ne commence. */
  tentativesAvantTemporisation: number;
  /** Plafond de la temporisation, en secondes. */
  temporisationMaxSecondes: number;
}

export const POLITIQUE_DEFAUT: PolitiqueVerrouillage = {
  fenetreBiometrieMinutes: 15,
  tentativesAvantTemporisation: 3,
  temporisationMaxSecondes: 300,
};

export interface EtatVerrouillage {
  tentativesEchouees: number;
  /** Instant du dernier déverrouillage complet, en millisecondes. */
  derniereAuthentificationMs?: number;
  /** Instant du dernier échec, en millisecondes. */
  dernierEchecMs?: number;
}

export const ETAT_INITIAL: EtatVerrouillage = { tentativesEchouees: 0 };

/**
 * Face ID suffit-il pour cette réouverture ?
 * Uniquement si une authentification complète a eu lieu récemment et qu'aucun
 * échec n'est en cours de temporisation.
 */
export function raccourciBiometriqueAutorise(
  etat: EtatVerrouillage,
  maintenantMs: number,
  politique: PolitiqueVerrouillage = POLITIQUE_DEFAUT,
): boolean {
  if (etat.derniereAuthentificationMs === undefined) {
    return false;
  }
  if (etat.tentativesEchouees > 0) {
    return false;
  }
  const ecoule = maintenantMs - etat.derniereAuthentificationMs;
  if (ecoule < 0) {
    // Horloge reculée : on refuse plutôt que d'accorder une fenêtre infinie.
    return false;
  }
  return ecoule <= politique.fenetreBiometrieMinutes * 60_000;
}

/** Temporisation imposée après un nombre donné d'échecs, en secondes. */
export function temporisationApresEchecs(
  tentativesEchouees: number,
  politique: PolitiqueVerrouillage = POLITIQUE_DEFAUT,
): number {
  const exces = tentativesEchouees - politique.tentativesAvantTemporisation;
  if (exces <= 0) {
    return 0;
  }
  return Math.min(2 ** (exces - 1), politique.temporisationMaxSecondes);
}

export interface Verrou {
  verrouille: boolean;
  /** Secondes restantes avant de pouvoir réessayer. */
  secondesRestantes: number;
}

export function evaluerVerrou(
  etat: EtatVerrouillage,
  maintenantMs: number,
  politique: PolitiqueVerrouillage = POLITIQUE_DEFAUT,
): Verrou {
  const temporisation = temporisationApresEchecs(etat.tentativesEchouees, politique);
  if (temporisation === 0 || etat.dernierEchecMs === undefined) {
    return { verrouille: false, secondesRestantes: 0 };
  }

  const ecouleSecondes = (maintenantMs - etat.dernierEchecMs) / 1000;
  const restant = Math.ceil(temporisation - ecouleSecondes);

  return restant > 0
    ? { verrouille: true, secondesRestantes: restant }
    : { verrouille: false, secondesRestantes: 0 };
}

export function apresEchec(
  etat: EtatVerrouillage,
  maintenantMs: number,
): EtatVerrouillage {
  return {
    ...etat,
    tentativesEchouees: etat.tentativesEchouees + 1,
    dernierEchecMs: maintenantMs,
  };
}

/** Remet le compteur à zéro : un déverrouillage réussi efface les échecs. */
export function apresSucces(maintenantMs: number): EtatVerrouillage {
  return { tentativesEchouees: 0, derniereAuthentificationMs: maintenantMs };
}
