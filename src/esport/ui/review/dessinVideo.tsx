/**
 * Dessin sur la vidéo, version native (app iOS sans WebView) : le lecteur
 * n'est pas intégré, on ne peut donc ni dessiner ni superposer le dessin à la
 * vidéo. Les repères qui portent un dessin le signalent.
 * Version web (site, app PC) : `dessinVideo.web.tsx`.
 */

import React from 'react';
import { Text } from 'react-native';
import { police } from '../../../hub/themes';
import type { PropsApercuDessin, PropsEditeurDessin } from './typesDessin';

export const dessinDisponible = false;
export const MESSAGE_DESSIN_NATIF = '✏️ Dessin disponible sur le site ou le PC';

export function ApercuDessin({ theme, dessin, cadre, testID }: PropsApercuDessin) {
  if (!dessin?.objets.length || cadre === 'calque') return null;
  return (
    <Text testID={testID} style={{ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) }}>
      {MESSAGE_DESSIN_NATIF}
    </Text>
  );
}

export function EditeurDessin(_: PropsEditeurDessin): React.ReactElement | null {
  return null;
}
