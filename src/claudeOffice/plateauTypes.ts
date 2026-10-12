/**
 * Propriétés du plateau de la scène (v4) : communes à la version web
 * (`PlateauScene.web.tsx`) et native (`PlateauScene.tsx`).
 */

import type { ThemeHub } from '../hub/themes';
import type { Agent } from './logiqueBureau';
import type { Relecture, VitesseRelecture } from './logiqueRelecture';
import type { SousAgent } from './sousAgentsScene';
import type { Zone } from './zones';

export interface CommandesRelecture {
  r: Relecture;
  /** Activité par tranche de la journée (barres derrière le curseur). */
  densite: readonly number[];
  onLecture(lecture: boolean): void;
  onVitesse(v: VitesseRelecture): void;
  onAller(t: number): void;
  onQuitter(): void;
}

export interface PropsPlateau {
  agents: readonly Agent[];
  theme: ThemeHub;
  reduit: boolean;
  demo?: boolean;
  charge?: boolean;
  maintenant: number;
  estompes?: ReadonlySet<string>;
  /** Agent dont le détail est ouvert (repère au-dessus de lui). */
  choisi?: string;
  /** Ouvrir le panneau Détail d'un agent. */
  onDetail(cle: string): void;
  /** Largeur disponible (px), hors plein écran. */
  largeur: number;
  /** Relecture en cours (curseur temporel) ; absente : en direct. */
  relecture?: CommandesRelecture;
  /** Démarrer la relecture de la journée ; absent : pas de bouton. */
  onRelecture?(): void;
  /** Clé de la scène : la changer la remet en place d'un coup (démo, saut dans la relecture). */
  cleScene?: string;
  horloge?: () => number;
  /** Nombre d'agents qui attendent ta réponse (pastille en plein écran). */
  attendent?: readonly Agent[];
  /** Sous-agents (contrat du module de données) : ceux de l'instant affiché. */
  sousAgents?: readonly SousAgent[];
  /** États de départ (tests, rendu statique). */
  initial?: { apercu?: string; sousAgent?: string; zone?: Zone; immersif?: boolean; ambiance?: boolean; minicarte?: boolean; suivi?: string };
}
