/**
 * Vidéo déposée, sur l'app iOS native (sans WebView, donc sans lecteur intégré) : la liste des repères
 * reste consultable et un bouton ouvre la vidéo dans le lecteur du système (Safari lit le MP4 H.264
 * par lien signé). Version web (lecteur maison) : `LecteurFichier.web.tsx`.
 */

import React, { useEffect } from 'react';
import { Linking, Text, View } from 'react-native';
import { BoutonHub } from '../../../hub/admin/ui/commun';
import { police } from '../../../hub/themes';
import type { PropsLecteurFichier } from './typesLecteur';
import { tr } from '../../i18n';

export { VITESSES } from './typesLecteur';

export function LecteurFichier({ theme, obtenirUrl, onPret, video }: PropsLecteurFichier) {
  useEffect(() => {
    const ouvrir = () => void obtenirUrl().then(url => Linking.openURL(url), () => undefined);
    onPret({ temps: () => 0, duree: () => 0, aller: ouvrir, vitesse: () => undefined, lire: ouvrir, pause: () => undefined });
    return () => onPret(undefined);
  }, [obtenirUrl, onPret]);
  return (
    <View testID="esport-lecteur-natif" style={{ gap: 8 }}>
      <Text style={{ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) }}>{tr('medias.lecteur.natif')}</Text>
      {video?.media?.peuCompatibleIphone ? <Text style={{ color: theme.alerte, fontSize: 12, ...police(theme.policeTexte) }}>{tr('medias.peu_compatible_iphone')}</Text> : null}
      <BoutonHub theme={theme} titre={tr('medias.lecteur.ouvrir_video')} variante="plein" onPress={() => void obtenirUrl().then(url => Linking.openURL(url), () => undefined)} testID="esport-lecteur-ouvrir" />
    </View>
  );
}
