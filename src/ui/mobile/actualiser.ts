/**
 * Tirer pour actualiser, sur le web (le `RefreshControl` de React Native ne fait rien dans un navigateur).
 * Au natif, `RefreshControl` fait le travail : ce hook ne sert que sur le web.
 *
 * Usage : `const tirer = useTirerPourActualiser(onActualiser)` ; poser `tirer.surDefilement` sur le
 * `onScroll` du `ScrollView`, `tirer.poignees` sur la vue qui l'enveloppe, et afficher `tirer.tirage`
 * (hauteur de l'indicateur, en px).
 */

import { useRef, useState } from 'react';
import { Platform } from 'react-native';

export const SEUIL_TIRAGE = 64;

/** Vrai quand un tirage de `dy` px, démarré en haut de la liste, déclenche l'actualisation (testé). */
export function tirageSuffisant(dy: number, haut: boolean): boolean {
  return haut && dy >= SEUIL_TIRAGE;
}

export function useTirerPourActualiser(onActualiser?: () => void) {
  const [tirage, setTirage] = useState(0);
  const depart = useRef<number | undefined>(undefined);
  const haut = useRef(true);
  const actif = Platform.OS === 'web' && Boolean(onActualiser);

  return {
    tirage,
    surDefilement: (evenement: { nativeEvent: { contentOffset: { y: number } } }) => {
      haut.current = evenement.nativeEvent.contentOffset.y <= 0;
    },
    poignees: actif
      ? {
          onTouchStart: (e: { nativeEvent: { touches: ArrayLike<{ pageY: number }> } }) => {
            depart.current = haut.current ? e.nativeEvent.touches[0]?.pageY : undefined;
          },
          onTouchMove: (e: { nativeEvent: { touches: ArrayLike<{ pageY: number }> } }) => {
            if (depart.current === undefined) return;
            const dy = (e.nativeEvent.touches[0]?.pageY ?? depart.current) - depart.current;
            setTirage(dy > 0 ? Math.min(dy * 0.5, SEUIL_TIRAGE + 16) : 0);
          },
          onTouchEnd: () => {
            if (depart.current !== undefined && tirageSuffisant(tirage * 2, haut.current)) {
              onActualiser?.();
            }
            depart.current = undefined;
            setTirage(0);
          },
        }
      : {},
  };
}
