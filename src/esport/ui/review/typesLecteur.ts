/**
 * Contrat du lecteur vidéo de la review, commun à la version web (site, app PC :
 * API YouTube IFrame, `Lecteur.web.tsx`) et à la version native (iOS, sans
 * WebView : lecture dans YouTube, `Lecteur.tsx`).
 */

import type React from 'react';
import type { ThemeHub } from '../../../hub/themes';

export interface CommandeLecteur {
  /** Temps courant, en secondes (0 si le lecteur n'est pas intégré). */
  temps(): number;
  /** Durée de la vidéo, en secondes (0 tant qu'inconnue). */
  duree(): number;
  /** Saute à un instant (iOS natif : ouvre YouTube à cet instant). */
  aller(secondes: number): void;
  /** Vitesse de lecture. */
  vitesse(v: number): void;
  lire(): void;
  pause(): void;
}

export type EtatLecteur = 'chargement' | 'pret' | 'lecture' | 'pause' | 'fin' | 'erreur';

export interface PropsLecteur {
  theme: ThemeHub;
  videoId: string;
  /** Position de départ, en secondes. */
  depart?: number;
  large: boolean;
  /** Commandes du lecteur, dès qu'il est prêt (`undefined` quand il disparaît). */
  onPret(commande: CommandeLecteur | undefined): void;
  onEtat?(etat: EtatLecteur): void;
  /**
   * Calque posé PAR-DESSUS la vidéo (dessin) : même cadre 16:9 que le lecteur.
   * Il laisse passer les clics vers la vidéo, sauf là où il les demande
   * (`pointer-events: auto`). Ignoré sur l'app iOS native.
   */
  calque?: React.ReactNode;
}

export const VITESSES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
