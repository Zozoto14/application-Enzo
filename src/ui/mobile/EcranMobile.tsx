/**
 * Gabarit d'un écran de téléphone : en-tête (facultatif), contenu qui défile en UNE colonne, pied
 * collant (bouton principal) qui reste au-dessus du clavier.
 *
 *  - un seul défilement vertical : jamais de défilement imbriqué dans l'écran ;
 *  - marges latérales de 16 px, contenu limité à 600 px (iPad en portrait) ;
 *  - iOS natif : `KeyboardAvoidingView` remonte le pied au-dessus du clavier ; sur le web, le
 *    viewport (`interactive-widget=resizes-content`) se redimensionne avec le clavier ;
 *  - tirer pour actualiser (`onActualiser`), quand l'écran montre des données distantes ;
 *  - balayage depuis le bord gauche = retour (`onRetour`), comme sur iOS.
 */

import React from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ThemeHub } from '../../hub/themes';
import { PiedCollant } from './BoutonPrincipal';
import { useBalayageRetour } from './gestes';
import { ESPACE, GOUTTIERE, themeActif } from './jetons';
import { margesSecurite } from './ZoneSecurite';

export function EcranMobile({
  theme: themeDonne,
  entete,
  pied,
  children,
  testID,
  onActualiser,
  actualisation = false,
  onRetour,
  centre = false,
  styleContenu,
}: {
  theme?: ThemeHub;
  /** `EnTeteMobile`, ou rien (l'écran gère alors la zone de sécurité du haut). */
  entete?: React.ReactNode;
  /** Bouton principal (et une action secondaire au plus) : posé dans un `PiedCollant`. */
  pied?: React.ReactNode;
  children: React.ReactNode;
  /** Porté par la zone qui défile. */
  testID?: string;
  onActualiser?(): void;
  actualisation?: boolean;
  onRetour?(): void;
  /** Contenu centré verticalement (écrans d'entrée courts). */
  centre?: boolean;
  styleContenu?: StyleProp<ViewStyle>;
}) {
  const theme = themeActif(themeDonne);
  const balayage = useBalayageRetour(onRetour);
  return (
    <KeyboardAvoidingView
      style={[styles.racine, { backgroundColor: theme.fond }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      {...balayage}>
      {entete}
      <ScrollView
        testID={testID}
        style={styles.defilement}
        contentContainerStyle={[
          styles.contenu,
          entete ? null : margesSecurite(['haut'], { haut: ESPACE.xl }),
          pied ? null : margesSecurite(['bas'], { bas: ESPACE.xxl }),
          centre && styles.centre,
          styleContenu,
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        refreshControl={onActualiser && Platform.OS !== 'web' ? <RefreshControl refreshing={actualisation} onRefresh={onActualiser} tintColor={theme.accent} /> : undefined}>
        <View style={styles.colonne}>{children}</View>
      </ScrollView>
      {pied ? <PiedCollant theme={theme}>{pied}</PiedCollant> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1 },
  defilement: { flex: 1 },
  contenu: { paddingHorizontal: GOUTTIERE, paddingTop: ESPACE.m, paddingBottom: ESPACE.xl, flexGrow: 1 },
  centre: { justifyContent: 'center' },
  colonne: { width: '100%', maxWidth: 600, alignSelf: 'center', gap: ESPACE.m },
});
