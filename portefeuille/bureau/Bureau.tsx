/**
 * Coque de l'application sur poste fixe.
 *
 * Un écran de téléphone étiré dans une fenêtre de 1 400 pixels n'est pas une
 * application de bureau : c'est une colonne perdue au milieu du vide. La
 * différence tient en deux choses, et elles ne concernent que la disposition.
 *
 * **La navigation devient permanente.** Sur téléphone, on empile les écrans et
 * on revient en arrière. Sur un poste fixe, la place existe : une barre
 * latérale montre en permanence où l'on peut aller, et où l'on est.
 *
 * **Le contenu s'étale en colonnes.** Les onglets du portefeuille restent les
 * mêmes ; c'est leur mise en page qui respire.
 *
 * Rien d'autre ne change. Les écrans, les modèles de vue et le noyau sont
 * exactement ceux de l'iPhone — c'est tout l'intérêt d'avoir gardé le calcul
 * hors des composants.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { usePalette } from '../src/ui/composants';
import { ESPACEMENT, RAYON, palettePour } from '../src/ui/theme';

/** En dessous, on rend la disposition du téléphone : une seule colonne. */
export const LARGEUR_BUREAU = 900;

export interface Destination {
  cle: string;
  libelle: string;
  /** Glyphe simple : aucune police d'icônes à embarquer. */
  glyphe: string;
}

export interface BureauProps {
  destinations: readonly Destination[];
  actif: string;
  onNaviguer(cle: string): void;
  /** Bandeau optionnel, affiché en tête du contenu. */
  bandeau?: React.ReactNode;
  children: React.ReactNode;
  /** Nom de l'utilisateur ou de la base ouverte, affiché en pied de barre. */
  pied?: string;
}

export function Bureau({
  destinations,
  actif,
  onNaviguer,
  bandeau,
  children,
  pied,
}: BureauProps) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const large = width >= LARGEUR_BUREAU;

  if (!large) {
    // Fenêtre étroite : la disposition du téléphone est la bonne, et elle
    // existe déjà. On ne maintient pas deux mises en page pour rien.
    return <View style={styles.pleinEcran}>{children}</View>;
  }

  return (
    <View style={[styles.pleinEcran, styles.rangee, { backgroundColor: palette.fond }]}>
      <View style={[styles.barre, { backgroundColor: palette.surface, borderColor: palette.bordure }]}>
        <Text style={[styles.marque, { color: palette.accent }]}>AB</Text>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.liens}>
          {destinations.map(destination => {
            const selectionne = destination.cle === actif;
            return (
              <Pressable
                key={destination.cle}
                testID={`aller-${destination.cle}`}
                accessibilityRole="tab"
                accessibilityState={{ selected: selectionne }}
                onPress={() => onNaviguer(destination.cle)}
                style={[
                  styles.lien,
                  selectionne && { backgroundColor: palette.fond },
                ]}>
                <Text
                  style={[
                    styles.glyphe,
                    { color: selectionne ? palette.accent : palette.texteSecondaire },
                  ]}>
                  {destination.glyphe}
                </Text>
                <Text
                  style={[
                    styles.libelle,
                    {
                      color: selectionne ? palette.accent : palette.texteSecondaire,
                      fontWeight: selectionne ? '700' : '500',
                    },
                  ]}
                  numberOfLines={1}>
                  {destination.libelle}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {pied ? (
          <Text style={[styles.pied, { color: palette.texteSecondaire }]} numberOfLines={1}>
            {pied}
          </Text>
        ) : null}
      </View>

      <View style={styles.colonne}>
        {bandeau}
        <View style={styles.contenu}>{children}</View>
      </View>
    </View>
  );
}

/**
 * Grille qui s'adapte à la largeur disponible.
 *
 * Les cartes gardent une largeur minimale lisible et se replacent d'elles-mêmes
 * en une, deux ou trois colonnes. C'est ce qui évite d'écrire une mise en page
 * par taille de fenêtre.
 */
export function Grille({
  children,
  minimum = 340,
}: {
  children: React.ReactNode;
  minimum?: number;
}) {
  return (
    <View style={styles.grille}>
      {React.Children.map(children, enfant =>
        enfant ? (
          <View style={[styles.cellule, { minWidth: minimum }]}>{enfant}</View>
        ) : null,
      )}
    </View>
  );
}

/** Applique le thème sombre au document, pour que la fenêtre entière suive. */
export function useFondDocument(sombre: boolean) {
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    document.body.style.backgroundColor = palettePour(sombre).fond;
    document.body.style.colorScheme = sombre ? 'dark' : 'light';
  }, [sombre]);
}

/** Mémorise la destination courante, pour ne pas repartir de l'accueil. */
export function useDestination(defaut: string): [string, (cle: string) => void] {
  const [actif, setActif] = useState(defaut);
  return [actif, setActif];
}

const styles = StyleSheet.create({
  pleinEcran: { flex: 1, height: '100%' },
  rangee: { flexDirection: 'row' },
  barre: {
    width: 104,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingVertical: ESPACEMENT.m,
    alignItems: 'center',
    gap: ESPACEMENT.m,
  },
  marque: { fontSize: 18, fontWeight: '800', letterSpacing: 1 },
  liens: { gap: ESPACEMENT.xs, paddingHorizontal: ESPACEMENT.s, width: '100%' },
  lien: {
    paddingVertical: ESPACEMENT.s,
    paddingHorizontal: ESPACEMENT.xs,
    borderRadius: RAYON.m,
    alignItems: 'center',
    gap: 2,
  },
  glyphe: { fontSize: 18 },
  libelle: { fontSize: 11, textAlign: 'center' },
  pied: { fontSize: 11, paddingHorizontal: ESPACEMENT.s },
  colonne: { flex: 1, height: '100%' },
  contenu: { flex: 1 },
  grille: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ESPACEMENT.m,
    padding: ESPACEMENT.m,
  },
  cellule: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
});
