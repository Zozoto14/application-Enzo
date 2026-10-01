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
import { Dimensions, Platform, useWindowDimensions } from 'react-native';
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

/**
 * Mode courant, lu sans hook (fenêtre actuelle). Réservé aux petites fonctions de style des contenus
 * rendus DANS une page déjà aiguillée par `useMobile()` (cartes de réglages…) : elles sont rendues à
 * nouveau avec leur parent quand la fenêtre change. Les pages, elles, utilisent `useMobile()`.
 */
export function modeTelephoneCourant(): boolean {
  const force = modeForce();
  if (force) {
    return force === 'telephone';
  }
  const { width, height } = Dimensions.get('window');
  return estTelephone({ largeur: width, hauteur: height, os: Platform.OS });
}
