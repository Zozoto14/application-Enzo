/**
 * Zone de dépôt du Drive (glisser-déposer). App native : pas de glisser-déposer, les enfants seulement.
 * Version web (site, app PC) : `ZoneDepot.web.tsx`.
 */

import React from 'react';
import { View } from 'react-native';
import type { PropsZoneDepot } from './typesDrive';

export type { PropsZoneDepot } from './typesDrive';

export function ZoneDepot({ children, testID }: PropsZoneDepot) {
  return <View testID={testID}>{children}</View>;
}
