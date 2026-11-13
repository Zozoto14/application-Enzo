/**
 * Vidéo courte d'un lineup, app iPhone : pas de lecteur intégré, la vidéo s'ouvre par le système (lien signé).
 * Site et app PC : lecteur intégré (`LecteurVideoLineup.web.tsx`).
 */

import React from 'react';
import { Linking, View } from 'react-native';
import { BoutonHub } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { trLu } from '../../i18n/lineups';

export function LecteurVideoLineup({ theme, url, testID = 'esport-lineup-video' }: { theme: ThemeHub; url: string; titre: string; testID?: string }) {
  return (
    <View testID={testID} style={{ alignItems: 'flex-start' }}>
      <BoutonHub theme={theme} titre={trLu('video.ouvrir')} icone="lecture" onPress={() => void Linking.openURL(url).catch(() => undefined)} testID={`${testID}-ouvrir`} />
    </View>
  );
}
