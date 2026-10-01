/**
 * Gestes du mode téléphone.
 *
 * `useBalayageRetour(onRetour)` : un balayage vers la droite qui commence au bord gauche de l'écran
 * (24 px) ramène en arrière, comme sur iOS. Les touchers ordinaires ne sont jamais capturés : le geste
 * ne se déclare qu'après 12 px de mouvement horizontal net. Sans `onRetour`, rien n'est posé.
 *
 * Le geste double toujours un bouton visible (« ‹ Retour » de l'en-tête) : il n'est jamais le seul
 * moyen de revenir.
 */

import { useMemo, useRef } from 'react';
import { PanResponder, type GestureResponderHandlers } from 'react-native';

export const BORD_BALAYAGE = 24;
export const SEUIL_BALAYAGE = 80;

/** Décision pure (testée) : ce mouvement est-il un balayage retour ? */
export function estBalayageRetour(depart: number, dx: number, dy: number): boolean {
  return depart <= BORD_BALAYAGE && dx >= SEUIL_BALAYAGE && Math.abs(dy) < dx / 2;
}

export function useBalayageRetour(onRetour?: () => void): GestureResponderHandlers | Record<string, never> {
  const rappel = useRef(onRetour);
  rappel.current = onRetour;
  const actif = Boolean(onRetour);
  return useMemo(() => {
    if (!actif) {
      return {};
    }
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => g.x0 <= BORD_BALAYAGE && g.dx > 12 && Math.abs(g.dy) < g.dx / 2,
      onPanResponderRelease: (_e, g) => {
        if (estBalayageRetour(g.x0, g.dx, g.dy)) {
          rappel.current?.();
        }
      },
      onPanResponderTerminationRequest: () => true,
    }).panHandlers;
  }, [actif]);
}
