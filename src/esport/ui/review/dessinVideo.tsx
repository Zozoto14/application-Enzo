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
import { tr } from '../../i18n';

export const dessinDisponible = false;
export const messageDessinNatif = (): string => tr('review.dessinVideo.dessin_disponible_sur_le');

export function ApercuDessin({ theme, dessin, cadre, testID }: PropsApercuDessin) {
  if (!dessin?.objets.length || cadre === 'calque') return null;
  return (
    <Text testID={testID} style={{ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) }}>
      {messageDessinNatif()}
    </Text>
  );
}

export function EditeurDessin(_: PropsEditeurDessin): React.ReactElement | null {
  return null;
}
