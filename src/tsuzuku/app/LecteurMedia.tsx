/**
 * Lecture d'un lecteur (version téléphone). En attendant la WebView (phase P4),
 * l'iPhone/iPad ouvre le lien dans Safari. La version web et Electron est
 * `LecteurMedia.web.tsx` (iframe cloisonné, vidéo directe, HLS).
 */

import React from 'react';
import { Text, View } from 'react-native';
import { BoutonPrincipal } from '../../ui/mobile/BoutonPrincipal';
import { useTsuzuku } from './contexte';
import { ouvrirExterne } from './externe';
import type { PropsMedia } from './typesMedia';
import { Bouton, styleAttenue } from './ui';

export function LecteurMedia({ lecteur, titre }: PropsMedia) {
  const { theme, mobile } = useTsuzuku();
  if (mobile) {
    return (
      <View style={{ gap: 12, padding: 16 }} testID="lecteur-safari">
        <Text style={styleAttenue(theme, 16)}>Le lecteur intégré arrive bientôt sur téléphone : « {titre} » s’ouvre pour l’instant dans Safari.</Text>
        <BoutonPrincipal theme={theme} titre="Ouvrir dans Safari" onPress={() => void ouvrirExterne(lecteur.url)} testID="lecteur-ouvrir-safari" />
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }} testID="lecteur-safari">
      <Text style={styleAttenue(theme, 14)}>Le lecteur intégré arrive bientôt sur téléphone : « {titre} » s’ouvre pour l’instant dans Safari.</Text>
      <Bouton titre="Ouvrir dans Safari" variante="plein" onPress={() => void ouvrirExterne(lecteur.url)} testID="lecteur-ouvrir-safari" style={{ alignSelf: 'flex-start' }} />
    </View>
  );
}
