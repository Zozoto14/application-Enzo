/**
 * Composants de base, partagés par les écrans.
 *
 * Volontairement peu nombreux et sans dépendance : une bibliothèque de
 * composants tierce apporterait des modules natifs à compiler, pour un gain
 * faible sur quatre écrans.
 */

import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions,
  type TextInputProps,
  type ViewProps,
} from 'react-native';
import { ESPACEMENT, RAYON, couleurTendance, palettePour, type Palette } from './theme';
import type { Tendance } from './format';

export function usePalette(): Palette {
  return palettePour(useColorScheme() === 'dark');
}

export function Titre({ children }: { children: React.ReactNode }) {
  const palette = usePalette();
  return <Text style={[styles.titre, { color: palette.texte }]}>{children}</Text>;
}

export function SousTitre({ children }: { children: React.ReactNode }) {
  const palette = usePalette();
  return (
    <Text style={[styles.sousTitre, { color: palette.texteSecondaire }]}>
      {children}
    </Text>
  );
}

/**
 * Largeur a partir de laquelle une carte cesse d'occuper toute la ligne.
 *
 * En dessous — un telephone — une carte par ligne est la seule disposition
 * lisible. Au-dela — iPad en paysage, fenetre de bureau — etirer une colonne
 * unique sur 1 400 pixels laisse deux tiers de vide et oblige a faire defiler
 * pour rien.
 */
export const LARGEUR_MULTICOLONNE = 900;

/** Largeur minimale d'une carte avant de repasser a la ligne. */
export const LARGEUR_CARTE = 380;

export function Carte({ style, children, ...reste }: ViewProps) {
  const palette = usePalette();
  const { width } = useWindowDimensions();

  // La carte ne decide pas de la grille : elle se declare seulement etirable
  // et donne sa largeur minimale. C'est le conteneur qui organise les lignes.
  const enGrille =
    width >= LARGEUR_MULTICOLONNE
      ? { flexGrow: 1, flexShrink: 1, flexBasis: LARGEUR_CARTE, maxWidth: '100%' as const }
      : undefined;

  return (
    <View
      {...reste}
      style={[
        styles.carte,
        { backgroundColor: palette.surface, borderColor: palette.bordure },
        enGrille,
        style,
      ]}>
      {children}
    </View>
  );
}

/** Montant signé, dont la couleur et le signe disent tous deux le sens. */
export function Variation({
  valeur,
  tendance,
  taille = 16,
}: {
  valeur: string;
  tendance: Tendance;
  taille?: number;
}) {
  const palette = usePalette();
  return (
    <Text
      style={{
        color: couleurTendance(palette, tendance),
        fontSize: taille,
        fontWeight: '600',
      }}>
      {valeur}
    </Text>
  );
}

export interface BoutonProps {
  titre: string;
  onPress: () => void;
  variante?: 'plein' | 'discret';
  desactive?: boolean;
  testID?: string;
}

export function Bouton({
  titre,
  onPress,
  variante = 'plein',
  desactive = false,
  testID,
}: BoutonProps) {
  const palette = usePalette();
  const plein = variante === 'plein';

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: desactive }}
      disabled={desactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.bouton,
        {
          backgroundColor: plein ? palette.accent : 'transparent',
          borderColor: palette.accent,
          opacity: desactive ? 0.45 : pressed ? 0.8 : 1,
        },
      ]}>
      <Text
        style={[
          styles.texteBouton,
          { color: plein ? palette.surAccent : palette.accent },
        ]}>
        {titre}
      </Text>
    </Pressable>
  );
}

export interface ChampProps extends TextInputProps {
  etiquette: string;
  indication?: string;
}

export function Champ({ etiquette, indication, style, ...reste }: ChampProps) {
  const palette = usePalette();
  return (
    <View style={styles.champ}>
      <Text style={[styles.etiquette, { color: palette.texteSecondaire }]}>
        {etiquette}
      </Text>
      <TextInput
        accessibilityLabel={etiquette}
        placeholderTextColor={palette.texteSecondaire}
        {...reste}
        style={[
          styles.saisie,
          {
            color: palette.texte,
            backgroundColor: palette.surface,
            borderColor: palette.bordure,
          },
          style,
        ]}
      />
      {indication ? (
        <Text style={[styles.indication, { color: palette.texteSecondaire }]}>
          {indication}
        </Text>
      ) : null}
    </View>
  );
}

/** Message d'erreur, annoncé aux lecteurs d'écran dès son apparition. */
export function Alerte({ message }: { message: string }) {
  const palette = usePalette();
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[styles.alerte, { borderColor: palette.danger }]}>
      <Text style={{ color: palette.danger }}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  titre: { fontSize: 24, fontWeight: '700' },
  sousTitre: { fontSize: 14, lineHeight: 20 },
  carte: {
    borderRadius: RAYON.m,
    borderWidth: StyleSheet.hairlineWidth,
    padding: ESPACEMENT.m,
    gap: ESPACEMENT.s,
  },
  bouton: {
    borderRadius: RAYON.s,
    borderWidth: 1,
    paddingVertical: ESPACEMENT.m - 4,
    paddingHorizontal: ESPACEMENT.l,
    alignItems: 'center',
  },
  texteBouton: { fontSize: 16, fontWeight: '600' },
  champ: { gap: ESPACEMENT.xs },
  etiquette: { fontSize: 13, fontWeight: '500' },
  saisie: {
    borderRadius: RAYON.s,
    borderWidth: 1,
    paddingHorizontal: ESPACEMENT.m - 4,
    paddingVertical: ESPACEMENT.m - 6,
    fontSize: 16,
  },
  indication: { fontSize: 12, lineHeight: 16 },
  alerte: {
    borderRadius: RAYON.s,
    borderWidth: 1,
    padding: ESPACEMENT.m - 4,
  },
});
