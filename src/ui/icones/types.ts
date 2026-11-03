import type { NomIcone } from './traces';

export interface ProprietesIcone {
  nom: NomIcone;
  /** Côté du carré, en pixels ; à défaut, suit la taille du texte (1,15 em) : l'icône se pose dans une phrase. */
  taille?: number;
  /** Couleur du trait ; à défaut, celle du texte autour (`currentColor`), donc celle du thème clair ou sombre. */
  couleur?: string;
  /**
   * Nom lu par les lecteurs d'écran, quand l'icône est SEULE (bouton pictogramme, pastille sans texte).
   * Absent : l'icône est décorative (un texte la suit) et reste masquée des lecteurs d'écran.
   */
  libelle?: string;
  testID?: string;
}
