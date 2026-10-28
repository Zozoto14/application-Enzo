/**
 * Aperçu d'un fichier du Drive sur l'app native (iPhone, iPad, sans lecteur intégré) : vignette d'une image,
 * sinon un bouton qui ouvre le fichier dans le lecteur du système (lien signé). Version web : `ApercuDrive.web.tsx`.
 */

import React from 'react';
import { Image, Linking, Text, View } from 'react-native';
import { BoutonHub } from '../../../../hub/admin/ui/commun';
import type { PropsApercuDrive } from './typesDrive';
import { trDr } from '../../../i18n/drive';
import { ESP, attenue } from '../../design';

export type { PropsApercuDrive } from './typesDrive';

export function ApercuDrive({ theme, fichier, obtenirUrl }: PropsApercuDrive) {
  return (
    <View style={{ gap: ESP.xs }} testID="esport-drive-apercu">
      {fichier.vignette && fichier.meta.format !== 'svg' ? <Image source={{ uri: fichier.vignette }} resizeMode="contain" style={{ width: '100%', height: 220, borderRadius: 10 }} accessibilityLabel={fichier.nom} /> : null}
      {!fichier.vignette ? <Text style={attenue(theme)}>{trDr('apercu.indisponible')}</Text> : null}
      <BoutonHub theme={theme} titre={trDr('apercu.ouvrir')} onPress={() => void obtenirUrl().then(u => Linking.openURL(u), () => undefined)} testID="esport-drive-apercu-ouvrir" />
    </View>
  );
}
