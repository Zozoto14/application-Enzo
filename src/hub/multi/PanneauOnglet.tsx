/**
 * Un onglet d'app (appareil natif ; le web a sa version, `PanneauOnglet.web.tsx`).
 *
 * L'app reste montée tant que son onglet est ouvert : son état survit quand on
 * passe à une autre. Masquée, elle est rendue sous `<Activity mode="hidden">` :
 * React garde son état mais suspend ses effets (minuteurs, sondages, écouteurs,
 * animations) jusqu'à son retour. Affichée, elle occupe sa place dans la scène
 * (toute la largeur, ou un côté en côte à côte).
 */

import React, { Activity } from 'react';
import { View } from 'react-native';
import { stylePlacement, type PropsPanneauOnglet } from './placement';

export { stylePlacement, type Placement, type PropsPanneauOnglet } from './placement';

export function PanneauOnglet({ placement, testID, children }: PropsPanneauOnglet) {
  const visible = Boolean(placement);
  return (
    <View testID={visible ? testID : undefined} style={placement ? stylePlacement(placement) : { display: 'none' }}>
      <Activity mode={visible ? 'visible' : 'hidden'}>{children}</Activity>
    </View>
  );
}
