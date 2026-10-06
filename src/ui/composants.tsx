/**
 * Composants de base, partagés par les écrans.
 *
 * Volontairement peu nombreux et sans dépendance : une bibliothèque de
 * composants tierce apporterait des modules natifs à compiler, pour un gain
 * faible sur quatre écrans.
 */

import React from 'react';
import { StyleSheet, View, useWindowDimensions, type TextInputProps, type ViewProps } from 'react-native';
import { Pressable, Text, TextInput } from './mobile/adaptatif';
import { ESPACEMENT, RAYON, couleurTendance, palettePour, type Palette, POLICE_TITRE } from './theme';
import type { Tendance } from './format';
import { useMobile } from './mobile/useMobile';
import { ChampMobile, type NatureChamp } from './mobile/ChampMobile';
import { ChampDate } from './mobile/ChampDate';
import { CONTROLE, TEXTE, nombres } from './mobile/jetons';

export function usePalette(): Palette {
  return palettePour();
}

export function Titre({ children }: { children: React.ReactNode }) {
  const palette = usePalette();
  const mobile = useMobile();
  return (
    <Text {...POLICE_TITRE} accessibilityRole="header" style={[styles.titre, mobile && styles.titreMobile, { color: palette.texte }]}>
      {children}
    </Text>
  );
}

export function SousTitre({ children }: { children: React.ReactNode }) {
  const palette = usePalette();
  const mobile = useMobile();
  return (
    <Text style={[styles.sousTitre, mobile && styles.sousTitreMobile, { color: palette.texteSecondaire }]}>
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
  // Pas de base flexible ici : dans une colonne, elle deviendrait une hauteur
  // minimale et creuserait un grand vide sous le contenu. Pour des cartes
  // côte à côte, voir CarteSection et Rangee.
  return (
    <View
      {...reste}
      style={[
        styles.carte,
        { backgroundColor: palette.surface, borderColor: palette.bordure },
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
        ...nombres(),
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
  /** Garde toute la largeur même sur grand écran (colonne étroite). */
  pleineLargeur?: boolean;
}

export function Bouton({
  titre,
  onPress,
  variante = 'plein',
  desactive = false,
  testID,
  pleineLargeur = false,
}: BoutonProps) {
  const palette = usePalette();
  const plein = variante === 'plein';
  // Sur grand écran, un bouton étiré sur toute la largeur se lit comme une
  // barre, pas comme un bouton : il prend la taille de son libellé.
  const large = useWindowDimensions().width >= LARGEUR_MULTICOLONNE;
  // Téléphone : 48 px, texte de 17 px.
  const mobile = useMobile();

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: desactive }}
      disabled={desactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.bouton,
        large && !pleineLargeur && styles.boutonCompact,
        mobile && styles.boutonMobile,
        {
          backgroundColor: plein ? palette.accentPlein : 'transparent',
          borderColor: plein ? palette.accentPlein : palette.bordure,
          opacity: desactive ? 0.45 : pressed ? 0.8 : 1,
        },
      ]}>
      <Text
        style={[
          styles.texteBouton,
          mobile && styles.texteBoutonMobile,
          { color: plein ? palette.surAccent : palette.accent },
        ]}>
        {titre}
      </Text>
    </Pressable>
  );
}

/**
 * Boutons d'action d'un formulaire.
 *
 * Sur grand écran, ils se rangent à droite, côte à côte, l'action principale
 * en dernier — là où l'œil finit sa lecture. Sur téléphone, ils s'empilent
 * sur toute la largeur, l'action principale en premier, sous le pouce.
 */
export function Actions({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const large = width >= LARGEUR_MULTICOLONNE;
  const boutons = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={large ? styles.actionsLarges : styles.actionsEtroites}>
      {(large ? [...boutons].reverse() : boutons).map((bouton, rang) => (
        <View key={rang} style={large ? styles.actionLarge : undefined}>
          {bouton}
        </View>
      ))}
    </View>
  );
}

/** Champs posés côte à côte sur grand écran, empilés sur téléphone. */
export function LigneChamps({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.ligneChamps}>
      {React.Children.toArray(children)
        .filter(Boolean)
        .map((champ, rang) => (
          <View key={rang} style={styles.celluleChamp}>
            {champ}
          </View>
        ))}
    </View>
  );
}

export interface ChampProps extends TextInputProps {
  etiquette: string;
  indication?: string;
  /** Clavier et remplissage automatique (téléphone) : voir `ChampMobile`. */
  nature?: NatureChamp;
}

export function Champ({ etiquette, indication, style, nature, ...reste }: ChampProps) {
  const palette = usePalette();
  // Téléphone : le champ du système de design mobile (48 px, 17 px, bon clavier).
  if (useMobile()) {
    if (nature === 'date') {
      return <ChampDate etiquette={etiquette} indication={indication} style={style} {...reste} />;
    }
    return <ChampMobile etiquette={etiquette} indication={indication} nature={nature} style={style} {...reste} />;
  }
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
  const mobile = useMobile();
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[styles.alerte, { borderColor: palette.danger }]}>
      <Text style={{ color: palette.danger, fontSize: mobile ? TEXTE.legende : undefined }}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  titre: { fontSize: 24, fontWeight: '700' },
  titreMobile: { fontSize: TEXTE.titre, lineHeight: 34 },
  sousTitre: { fontSize: 14, lineHeight: 20 },
  sousTitreMobile: { fontSize: TEXTE.legende + 1, lineHeight: 23 },
  carte: {
    borderRadius: RAYON.m,
    borderWidth: 1,
    padding: ESPACEMENT.m + 4,
    gap: ESPACEMENT.s,
  },
  bouton: {
    borderRadius: RAYON.s,
    borderWidth: 1,
    paddingVertical: ESPACEMENT.s + 2,
    paddingHorizontal: ESPACEMENT.m + 4,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boutonCompact: { alignSelf: 'flex-start', minWidth: 160 },
  texteBouton: { fontSize: 15, fontWeight: '600' },
  boutonMobile: { minHeight: CONTROLE.hauteur },
  texteBoutonMobile: { fontSize: TEXTE.corps, textAlign: 'center' },
  actionsLarges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: ESPACEMENT.s + 4,
    marginTop: ESPACEMENT.s,
  },
  actionsEtroites: { gap: ESPACEMENT.s + 4 },
  actionLarge: { minWidth: 160, alignItems: 'stretch' },
  ligneChamps: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.m },
  celluleChamp: { flexGrow: 1, flexShrink: 1, flexBasis: 240, gap: ESPACEMENT.s },
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
