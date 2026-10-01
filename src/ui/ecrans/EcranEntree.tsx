/**
 * Gabarit des écrans d'entrée (accueil du site, premier lancement, déverrouillage, mot de passe oublié,
 * connexion par prénom, liaison).
 *
 *  - Bureau / tablette : exactement l'ancien rendu (colonne étroite centrée, tout dans le défilement,
 *    bouton principal à sa place dans le flux).
 *  - Téléphone : formulaire pleine page (`EcranMobile`), zone de sécurité, et le bouton principal
 *    COLLÉ en bas, au-dessus du clavier ; les actions secondaires restent dans le flux, sous le
 *    formulaire.
 */

import React from 'react';
import { ScrollView, type StyleProp, type ViewStyle } from 'react-native';
import { EcranMobile } from '../mobile/EcranMobile';
import { useMobile } from '../mobile/useMobile';
import { palettePour, stylesPartages } from '../theme';

export function EcranEntree({
  children,
  pied,
  apresPied,
  testID,
  styleBureau,
  styleContenuBureau,
  centre = true,
}: {
  children: React.ReactNode;
  /** Action principale (un bouton, ou un indicateur d'attente). */
  pied?: React.ReactNode;
  /** Actions secondaires, sous l'action principale. */
  apresPied?: React.ReactNode;
  testID?: string;
  /** Styles de l'ancien rendu, conservés tels quels. */
  styleBureau?: StyleProp<ViewStyle>;
  styleContenuBureau?: StyleProp<ViewStyle>;
  centre?: boolean;
}) {
  if (useMobile()) {
    return (
      <EcranMobile testID={testID} pied={pied} centre={centre}>
        {children}
        {apresPied}
      </EcranMobile>
    );
  }
  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palettePour().fond }, styleBureau]}
      contentContainerStyle={styleContenuBureau}
      keyboardShouldPersistTaps="handled"
      testID={testID}>
      {children}
      {pied}
      {apresPied}
    </ScrollView>
  );
}
