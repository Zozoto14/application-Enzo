/**
 * Propriétés communes aux deux versions de la scène « open space » de Claude
 * Office : SVG animé sur le web et le PC (`SceneOpenSpace.web.tsx`), vues
 * simplifiées ailleurs (`SceneOpenSpace.tsx`).
 */

import type { ThemeHub } from '../hub/themes';
import type { Agent } from './logiqueBureau';

export interface PropsScene {
  agents: readonly Agent[];
  theme: ThemeHub;
  /** « Réduire les animations » : scène fixe, personne ne marche. */
  reduit: boolean;
  /** Largeur d'affichage de la scène (px). */
  largeur: number;
  /** Agent mis en avant (bulle complète, anneau au sol). */
  choisi?: string;
  onChoisir(cle: string): void;
  /**
   * Données lues (faux pendant le premier chargement) : tant qu'elles ne le
   * sont pas, rien n'est placé, pour que les agents déjà au travail soient
   * assis d'emblée au lieu de tous entrer par la porte.
   */
  charge?: boolean;
  /** Sessions fictives : bandeau « Démo » dans la scène. */
  demo?: boolean;
  /** Texte de la scène agrandi (téléphone, vue rapprochée). */
  texteAgrandi?: boolean;
  /** Horloge réelle (ms), pour la pendule murale. */
  maintenant: number;
  /** Horloge de l'animation en secondes (tests) ; sinon performance.now(). */
  horloge?: () => number;
}

/** Proportions de la scène (largeur / hauteur), pour réserver sa place. */
export { HAUTEUR_SCENE, LARGEUR_SCENE } from './logiqueScene';
