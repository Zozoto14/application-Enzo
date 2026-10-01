/**
 * Zones de sécurité : l'encoche / la Dynamic Island en haut, la barre d'accueil en bas, les coins.
 *
 *  - Sur le web (site de secours ajouté à l'écran d'accueil, barre d'état « black-translucent ») :
 *    `env(safe-area-inset-*)`, que le navigateur résout (index.html déclare `viewport-fit=cover`).
 *  - Sur l'app native : la racine (`SafeAreaView` d'App.tsx) applique déjà les marges ; on n'en
 *    rajoute pas, sinon elles seraient comptées deux fois.
 *
 * `margesSecurite(cotes)` rend le style à fusionner dans un conteneur qui a déjà son propre
 * remplissage (barre basse, en-tête) : `max(env(...), 0px)` + valeur propre.
 */

import React from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';

export type Cote = 'haut' | 'bas' | 'gauche' | 'droite';

const PROPRIETE: Record<Cote, keyof ViewStyle> = { haut: 'paddingTop', bas: 'paddingBottom', gauche: 'paddingLeft', droite: 'paddingRight' };
const ENV: Record<Cote, string> = { haut: 'top', bas: 'bottom', gauche: 'left', droite: 'right' };

/** Style de remplissage : zone de sécurité du côté demandé, plus `en_plus` px. */
export function margesSecurite(cotes: readonly Cote[], enPlus: Partial<Record<Cote, number>> = {}): ViewStyle {
  const style: Record<string, number | string> = {};
  for (const cote of cotes) {
    const base = enPlus[cote] ?? 0;
    style[PROPRIETE[cote]] = Platform.OS === 'web' ? `calc(env(safe-area-inset-${ENV[cote]}, 0px) + ${base}px)` : base;
  }
  return style as ViewStyle;
}

export function ZoneSecurite({
  cotes = ['haut', 'bas', 'gauche', 'droite'],
  style,
  children,
  testID,
}: {
  cotes?: readonly Cote[];
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  testID?: string;
}) {
  return (
    <View testID={testID} style={[margesSecurite(cotes), style]}>
      {children}
    </View>
  );
}
