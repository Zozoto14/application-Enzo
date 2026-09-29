/**
 * Faire passer une bulle ou une liste par-dessus les cartes voisines.
 *
 * Sur le bureau, chaque vue est son propre contexte d'empilement : un
 * élément en `zIndex: 100` reste prisonnier de sa carte, et la carte
 * suivante le recouvre. Un élément ouvert le signale donc à ses conteneurs,
 * qui se hissent au premier plan le temps qu'il reste ouvert.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

type Signal = (ouvert: boolean) => void;

export const Superposition = createContext<Signal>(() => undefined);

/**
 * Pour un conteneur : vrai tant qu'un élément ouvert se trouve dedans, et le
 * signal à transmettre à ses enfants par `Superposition.Provider`.
 */
export function useSuperposition(): [boolean, Signal] {
  const parent = useContext(Superposition);
  const [ouverts, setOuverts] = useState(0);
  const signaler = useCallback<Signal>(
    ouvert => {
      setOuverts(nombre => Math.max(0, nombre + (ouvert ? 1 : -1)));
      parent(ouvert);
    },
    [parent],
  );
  return [ouverts > 0, signaler];
}

/** Pour un élément qui s'ouvre : prévient ses conteneurs tant qu'il l'est. */
export function useSignalerOuverture(ouvert: boolean): void {
  const signaler = useContext(Superposition);
  useEffect(() => {
    if (!ouvert) {
      return;
    }
    signaler(true);
    return () => signaler(false);
  }, [ouvert, signaler]);
}
