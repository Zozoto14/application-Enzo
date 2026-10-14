/** Place d'un onglet d'app dans la scène (commun au natif et au web). */

import type React from 'react';
import type { DimensionValue } from 'react-native';

/** Place d'un onglet dans la scène, en parts de la largeur (0 à 1). */
export interface Placement {
  gauche: number;
  largeur: number;
  /** Marge intérieure du côté de la séparation (px), en côte à côte. */
  marge?: { gauche?: number; droite?: number };
}

export interface PropsPanneauOnglet {
  /** Absent : l'onglet est masqué. */
  placement?: Placement;
  /** Scène qui accueille les onglets (sert à la version web). */
  scene: React.RefObject<unknown>;
  testID?: string;
  children: React.ReactNode;
}

export function stylePlacement(placement: Placement) {
  return {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    left: `${placement.gauche * 100}%` as DimensionValue,
    width: `${placement.largeur * 100}%` as DimensionValue,
    paddingLeft: placement.marge?.gauche ?? 0,
    paddingRight: placement.marge?.droite ?? 0,
  };
}

