/**
 * Bouton principal pleine largeur (48 px), et son pied collant.
 *
 * Règle : UNE action principale par écran. Elle vit dans `PiedCollant`, en bas de l'écran, au-dessus
 * de la barre d'accueil et — dans `EcranMobile` — au-dessus du clavier. Les actions secondaires sont
 * des boutons `discret` (contour) ou des cellules.
 */

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { police, type ThemeHub } from '../../hub/themes';
import { CONTROLE, ESPACE, GOUTTIERE, TEXTE, rayonControle, themeActif } from './jetons';
import { margesSecurite } from './ZoneSecurite';

export function BoutonPrincipal({
  theme: themeDonne,
  titre,
  onPress,
  variante = 'plein',
  desactive = false,
  enCours = false,
  testID,
  libelle,
}: {
  theme?: ThemeHub;
  titre: string;
  onPress(): void;
  variante?: 'plein' | 'discret' | 'danger';
  desactive?: boolean;
  /** Indicateur d'attente à la place du texte (le bouton reste annoncé). */
  enCours?: boolean;
  testID?: string;
  libelle?: string;
}) {
  const theme = themeActif(themeDonne);
  const plein = variante === 'plein';
  const couleurTexte = plein ? theme.surAccent : variante === 'danger' ? theme.critique : theme.accent;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle ?? titre}
      accessibilityState={{ disabled: desactive || enCours, busy: enCours }}
      disabled={desactive || enCours}
      onPress={onPress}
      style={({ pressed }) => [
        styles.bouton,
        {
          borderRadius: rayonControle(theme),
          backgroundColor: plein ? theme.accent : 'transparent',
          borderColor: plein ? theme.accent : variante === 'danger' ? theme.critique : theme.ligne,
          opacity: desactive ? 0.45 : pressed ? 0.85 : 1,
        },
      ]}>
      {enCours ? <ActivityIndicator color={couleurTexte} /> : null}
      <Text style={{ color: couleurTexte, fontSize: TEXTE.corps, fontWeight: '700', textAlign: 'center', ...police(theme.policeTexte) }} numberOfLines={2}>
        {titre}
      </Text>
    </Pressable>
  );
}

/** Barre collée en bas de l'écran : bouton principal (et, au plus, une action secondaire). */
export function PiedCollant({ theme: themeDonne, children, testID = 'pied-collant' }: { theme?: ThemeHub; children: React.ReactNode; testID?: string }) {
  const theme = themeActif(themeDonne);
  return (
    <View testID={testID} style={[styles.pied, margesSecurite(['bas'], { bas: ESPACE.s }), { backgroundColor: theme.fond, borderTopColor: theme.ligne }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bouton: {
    minHeight: CONTROLE.hauteur,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: ESPACE.xs,
    paddingHorizontal: ESPACE.m,
    paddingVertical: ESPACE.xs,
    alignSelf: 'stretch',
  },
  pied: { paddingHorizontal: GOUTTIERE, paddingTop: ESPACE.s, gap: ESPACE.xs, borderTopWidth: StyleSheet.hairlineWidth },
});
