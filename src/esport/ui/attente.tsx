/** Chargement à la demande d'un écran (React.lazy + Suspense), avec un indicateur accessible. */

import React, { Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';

function Attente() {
  return (
    <View style={{ padding: 24, alignItems: 'center' }} accessibilityLabel="Chargement" accessibilityRole="progressbar">
      <ActivityIndicator />
    </View>
  );
}

export function differe<P extends object>(charger: () => Promise<React.ComponentType<P>>): (props: P) => React.ReactElement {
  const Ecran = React.lazy(async () => ({ default: await charger() }));
  return function EcranDiffere(props: P) {
    return (
      <Suspense fallback={<Attente />}>
        <Ecran {...props} />
      </Suspense>
    );
  };
}
