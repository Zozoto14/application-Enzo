/**
 * Chargement à la demande d'un écran (React.lazy + Suspense), avec un indicateur accessible traduit. Le mécanisme
 * (une seconde tentative si l'import échoue, réseau instable) est celui du hub : src/ui/differe.tsx.
 */

import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { tr } from '../i18n';
import { differe as differeHub } from '../../ui/differe';

function Attente() {
  return (
    <View style={{ padding: 24, alignItems: 'center' }} accessibilityLabel={tr('attente.chargement')} accessibilityRole="progressbar">
      <ActivityIndicator />
    </View>
  );
}

export function differe<P extends object>(charger: () => Promise<React.ComponentType<P>>): (props: P) => React.ReactElement {
  return differeHub(charger, { attente: <Attente /> });
}
