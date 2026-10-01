/**
 * `useMobile()` : vrai en mode téléphone (voir detection.ts). Suit la rotation et le
 * redimensionnement de la fenêtre.
 *
 * Règle d'usage : un écran qui a deux mises en page ne branche JAMAIS ses hooks sur `useMobile()`.
 * Il devient une simple aiguille qui rend l'une ou l'autre version :
 *
 *     export function Hub(props) {
 *       return useMobile() ? <HubMobile {...props} /> : <HubBureau {...props} />;
 *     }
 */

import React, { createContext, useContext } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { estTelephone, modeForce, type ModeAffichage } from './detection';

const ContexteMode = createContext<ModeAffichage | undefined>(undefined);

/** Force un mode pour un sous-arbre (tests, aperçus). */
export function ModeAffichageForce({ mode, children }: { mode: ModeAffichage; children: React.ReactNode }) {
  return <ContexteMode.Provider value={mode}>{children}</ContexteMode.Provider>;
}

export function useModeAffichage(): ModeAffichage {
  const { width, height } = useWindowDimensions();
  const force = useContext(ContexteMode) ?? modeForce();
  if (force) {
    return force;
  }
  return estTelephone({ largeur: width, hauteur: height, os: Platform.OS }) ? 'telephone' : 'large';
}

export function useMobile(): boolean {
  return useModeAffichage() === 'telephone';
}
