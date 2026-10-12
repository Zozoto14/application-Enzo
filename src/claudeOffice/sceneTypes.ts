/**
 * Propriétés communes aux deux versions de la scène « open space » de Claude
 * Office : SVG animé sur le web et le PC (`SceneOpenSpace.web.tsx`), vues
 * simplifiées ailleurs (`SceneOpenSpace.tsx`).
 */

import type React from 'react';
import type { ThemeHub } from '../hub/themes';
import type { Agent } from './logiqueBureau';
import type { SousAgentVisible } from './sousAgentsScene';
import type { Zone } from './zones';

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
  /** Agents estompés (filtre par projet : « mettre en avant » un autre projet). */
  estompes?: ReadonlySet<string>;
  /** Horloge de l'animation en secondes (tests) ; sinon performance.now(). */
  horloge?: () => number;
  /**
   * Plateau v4 (web) : la scène remplit son cadre, la caméra (viewBox du SVG,
   * transformée du calque) est réglée de l'extérieur, sans nouveau rendu.
   */
  remplir?: boolean;
  refSvg?: React.Ref<SVGSVGElement>;
  refCalque?: React.Ref<HTMLDivElement>;
  /** Positions (repère de la scène) de chaque personnage : pieds et haut de la tête, tenues à jour. */
  positions?: React.MutableRefObject<Map<string, PositionPerso>>;
  /** Agent survolé (anneau léger au sol) et zone survolée (sol souligné). */
  survole?: string;
  zoneSurvolee?: Zone;
  /** Cibles accessibles (boutons ≥ 44 px au-dessus des personnages, zones au sol) : le plateau gère toucher et survol. */
  cibles?: CiblesScene;
  /** Sous-agents à dessiner (petits personnages), ceux qui ne tiennent pas (« +N »), et le compteur par parent. */
  sousAgents?: readonly SousAgentVisible[];
  sousAgentsEnPlus?: number;
  sousAgentsParParent?: ReadonlyMap<string, number>;
}

export interface PositionPerso {
  x: number;
  y: number;
  haut: number;
}

export interface CiblesScene {
  /** Libellé lu par les lecteurs d'écran pour un agent. */
  libelle(a: Agent): string;
  /** Identifiant de la description (carte) de l'agent en aperçu, pour aria-describedby. */
  decrit?: { cle: string; id: string };
  onFocus(cle: string | undefined): void;
  /** Activation au clavier (Entrée, Espace). */
  onActiver(cle: string): void;
}

/** Proportions de la scène (largeur / hauteur), pour réserver sa place. */
export { HAUTEUR_SCENE, LARGEUR_SCENE } from './logiqueScene';
