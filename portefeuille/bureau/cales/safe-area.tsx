/**
 * Cale de `react-native-safe-area-context` pour le bureau.
 *
 * La bibliothèque mesure les zones qu'un téléphone rend inutilisables :
 * l'encoche, la barre d'accueil, les coins arrondis. Elle s'appuie pour cela
 * sur un module natif, et sans lui son fournisseur ne rend **rien** — écran
 * blanc, sans la moindre erreur. C'est précisément ce qui s'est produit à la
 * première tentative de rendu sur Windows.
 *
 * Une fenêtre de bureau n'a aucune de ces contraintes : les marges valent
 * zéro, et le fournisseur n'a qu'à laisser passer ses enfants. La cale dit
 * donc la vérité de la plateforme au lieu de simuler un téléphone.
 */

import React, { createContext, useContext } from 'react';
import { View, type ViewProps } from 'react-native';

export interface Marges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Cadre {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MARGES_NULLES: Marges = { top: 0, right: 0, bottom: 0, left: 0 };

const cadreCourant = (): Cadre => ({
  x: 0,
  y: 0,
  width: typeof window === 'undefined' ? 1280 : window.innerWidth,
  height: typeof window === 'undefined' ? 800 : window.innerHeight,
});

export const SafeAreaInsetsContext = createContext<Marges>(MARGES_NULLES);
export const SafeAreaFrameContext = createContext<Cadre>(cadreCourant());
export const SafeAreaContext = SafeAreaInsetsContext;

export const initialWindowMetrics = { insets: MARGES_NULLES, frame: cadreCourant() };
export const initialWindowSafeAreaInsets = MARGES_NULLES;

export function SafeAreaProvider({ children, style, ...reste }: ViewProps) {
  return (
    <SafeAreaInsetsContext.Provider value={MARGES_NULLES}>
      <View {...reste} style={[{ flex: 1 }, style]}>
        {children}
      </View>
    </SafeAreaInsetsContext.Provider>
  );
}

export function SafeAreaView({ children, style, ...reste }: ViewProps & { edges?: unknown }) {
  return (
    <View {...reste} style={[{ flex: 1 }, style]}>
      {children}
    </View>
  );
}

export function useSafeAreaInsets(): Marges {
  return useContext(SafeAreaInsetsContext);
}

export function useSafeAreaFrame(): Cadre {
  return useContext(SafeAreaFrameContext);
}

export const useSafeArea = useSafeAreaInsets;

export function SafeAreaConsumer({
  children,
}: {
  children: (marges: Marges) => React.ReactNode;
}) {
  return <>{children(useContext(SafeAreaInsetsContext))}</>;
}

export function withSafeAreaInsets<P extends object>(Composant: React.ComponentType<P>) {
  return function AvecMarges(props: P) {
    return <Composant {...props} insets={useContext(SafeAreaInsetsContext)} />;
  };
}

/** Écoute des changements de marges : rien ne bouge sur un bureau. */
export function SafeAreaListener({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}
