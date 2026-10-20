/**
 * Lecteur de la review sur l'app iOS native : pas de WebView, donc pas de
 * lecteur intégré. La liste des repères reste consultable (lecture seule) et
 * chaque repère ouvre la vidéo dans YouTube au bon timestamp.
 * Version web (site, app PC, API YouTube IFrame) : `Lecteur.web.tsx`.
 */

import React, { useEffect } from 'react';
import { Image, Linking, Text, View } from 'react-native';
import { BoutonHub } from '../../../hub/admin/ui/commun';
import { police } from '../../../hub/themes';
import { lienYoutubeA, miniatureYoutube } from '../../review/youtube';
import type { PropsLecteur } from './typesLecteur';

export { VITESSES } from './typesLecteur';
export const lecteurIntegre = false;

export function Lecteur({ theme, videoId, depart = 0, onPret }: PropsLecteur) {
  useEffect(() => {
    onPret({
      temps: () => 0,
      duree: () => 0,
      aller: s => void Linking.openURL(lienYoutubeA(videoId, s)),
      vitesse: () => undefined,
      lire: () => void Linking.openURL(lienYoutubeA(videoId, depart)),
      pause: () => undefined,
    });
    return () => onPret(undefined);
  }, [videoId, depart, onPret]);
  return (
    <View testID="esport-lecteur-natif" style={{ gap: 8 }}>
      <Image
        source={{ uri: miniatureYoutube(videoId) }}
        accessibilityLabel="Miniature de la vidéo"
        style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: Math.min(theme.rayonMoyen, 10), backgroundColor: theme.surface }}
      />
      <Text style={{ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) }}>
        Le lecteur intégré n’existe pas sur l’app iOS : les repères restent lisibles ici, et chacun ouvre la vidéo dans YouTube au bon moment.
      </Text>
      <BoutonHub theme={theme} titre="Ouvrir la vidéo dans YouTube" variante="plein" onPress={() => void Linking.openURL(lienYoutubeA(videoId, depart))} testID="esport-lecteur-youtube" />
    </View>
  );
}
