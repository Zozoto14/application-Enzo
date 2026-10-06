/**
 * Page de formulaire : sur téléphone, un écran pleine page (`EcranMobile`, une colonne, bouton
 * principal collé en bas, au-dessus du clavier) ; ailleurs, la page défilante habituelle, inchangée.
 */

import React from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';
import { palettePour, stylesPartages, ESPACEMENT } from '../theme';
import { useColorScheme } from 'react-native';
import { EcranMobile } from './EcranMobile';
import { useMobile } from './useMobile';

export function PageFormulaire({
  children,
  pied,
  onRetour,
  testID,
}: {
  children: React.ReactNode;
  /** Téléphone : action principale (et une secondaire) collées en bas. */
  pied?: React.ReactNode;
  onRetour?(): void;
  testID?: string;
}) {
  const mobile = useMobile();
  const sombre = useColorScheme() === 'dark';
  if (mobile) {
    return (
      <EcranMobile pied={pied} onRetour={onRetour} testID={testID}>
        {children}
      </EcranMobile>
    );
  }
  const proprietes: ScrollViewProps = {
    style: [stylesPartages.ecran, { backgroundColor: palettePour(sombre).fond }],
    contentContainerStyle: [stylesPartages.contenu, stylesPartages.formulaire, { paddingTop: ESPACEMENT.l }],
    keyboardShouldPersistTaps: 'handled',
  };
  return (
    <ScrollView testID={testID} {...proprietes}>
      {children}
    </ScrollView>
  );
}
