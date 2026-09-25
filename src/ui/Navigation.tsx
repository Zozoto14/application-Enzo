/**
 * Barre de navigation latérale, présente sur tous les écrans une fois
 * l'application déverrouillée.
 *
 * Sur un grand écran, chaque destination est à un clic, où que l'on soit :
 * plus besoin de revenir au portefeuille pour aller ailleurs. Sur un
 * téléphone, la place manque : la barre disparaît et chaque écran garde son
 * bouton de retour.
 */

import React, { createContext, useContext } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { usePalette } from './composants';
import { ESPACEMENT, RAYON } from './theme';

export interface Destination {
  cle: string;
  libelle: string;
  /** Pictogramme simple : aucune police d'icônes à embarquer. */
  glyphe: string;
}

/** En dessous, pas de barre latérale : la place manque. */
export const LARGEUR_NAVIGATION = 900;
/** Au-dessus, la barre affiche les libellés à côté des pictogrammes. */
const LARGEUR_LIBELLES = 1180;

/** Vrai sous une Coque qui affiche la navigation (barre latérale ou bandeau). */
const NavigationPresente = createContext(false);

/**
 * Vrai quand la navigation de la Coque est affichée : les écrans n'ont alors
 * pas à répéter ses destinations dans leur propre barre d'outils.
 */
export function useNavigationLaterale(): boolean {
  return useContext(NavigationPresente);
}

export function Coque({
  destinations,
  actif,
  onNaviguer,
  onVerrouiller,
  children,
}: {
  destinations: readonly Destination[];
  actif: string;
  onNaviguer(cle: string): void;
  onVerrouiller?(): void;
  children: React.ReactNode;
}) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  if (destinations.length === 0) {
    return <>{children}</>;
  }
  if (width < LARGEUR_NAVIGATION) {
    // Tablette, téléphone, petite fenêtre : la barre latérale n'a pas la
    // place. Les mêmes destinations passent en bandeau défilant, en haut.
    return (
      <NavigationPresente.Provider value>
      <View style={[styles.colonne, { backgroundColor: palette.fond }]}>
        <View style={[styles.bandeau, { backgroundColor: palette.surface, borderBottomColor: palette.bordure }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.liensBandeau}>
            {destinations.map(destination => (
              <Lien
                key={destination.cle}
                destination={destination}
                actif={actif}
                libelles
                compact
                onPress={() => onNaviguer(destination.cle)}
              />
            ))}
            {onVerrouiller ? (
              <Lien
                destination={{ cle: 'verrouiller', libelle: 'Verrouiller', glyphe: '⏻' }}
                actif={actif}
                libelles
                compact
                onPress={onVerrouiller}
              />
            ) : null}
          </ScrollView>
        </View>
        <View style={styles.contenu}>{children}</View>
      </View>
      </NavigationPresente.Provider>
    );
  }
  const libelles = width >= LARGEUR_LIBELLES;

  return (
    <NavigationPresente.Provider value>
    <View style={[styles.rangee, { backgroundColor: palette.fond }]}>
      <View
        accessibilityRole="tablist"
        style={[
          styles.barre,
          {
            width: libelles ? 216 : 92,
            backgroundColor: palette.surface,
            borderRightColor: palette.bordure,
          },
        ]}
      >
        <Text
          style={[
            styles.marque,
            { color: palette.texte },
            !libelles && { textAlign: 'center' },
          ]}
        >
          {libelles ? (
            <>
              Appli<Text style={{ color: palette.accent }}>Bourse</Text>
            </>
          ) : (
            <Text style={{ color: palette.accent }}>AB</Text>
          )}
        </Text>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.liens}
        >
          {destinations.map(destination => (
            <Lien
              key={destination.cle}
              destination={destination}
              actif={actif}
              libelles={libelles}
              onPress={() => onNaviguer(destination.cle)}
            />
          ))}
        </ScrollView>
        {onVerrouiller ? (
          <View style={[styles.pied, { borderTopColor: palette.bordure }]}>
            <Lien
              destination={{
                cle: 'verrouiller',
                libelle: 'Verrouiller',
                glyphe: '⏻',
              }}
              actif={actif}
              libelles={libelles}
              onPress={onVerrouiller}
            />
          </View>
        ) : null}
      </View>
      <View style={styles.contenu}>{children}</View>
    </View>
    </NavigationPresente.Provider>
  );
}

function Lien({
  destination,
  onPress,
  actif,
  libelles,
  compact = false,
}: {
  destination: Destination;
  onPress(): void;
  actif: string;
  libelles: boolean;
  /** Pastille du bandeau horizontal. */
  compact?: boolean;
}) {
  const palette = usePalette();
  const selectionne = destination.cle === actif;
  return (
    <Pressable
      testID={`nav-${destination.cle}`}
      accessibilityRole="tab"
      accessibilityLabel={destination.libelle}
      accessibilityState={{ selected: selectionne }}
      onPress={onPress}
      style={({
        pressed,
        hovered,
      }: {
        pressed: boolean;
        hovered?: boolean;
      }) => [
        styles.lien,
        libelles ? styles.lienLarge : styles.lienEtroit,
        compact && styles.lienCompact,
        {
          backgroundColor: selectionne
            ? palette.accentFond
            : pressed || hovered
            ? palette.surfaceHaute
            : 'transparent',
        },
      ]}
    >
      <Text
        style={[
          styles.glyphe,
          { color: selectionne ? palette.accent : palette.texteSecondaire },
        ]}
      >
        {destination.glyphe}
      </Text>
      {libelles ? (
        <Text
          numberOfLines={1}
          style={{
            color: selectionne ? palette.accent : palette.texte,
            fontWeight: selectionne ? '700' : '500',
            fontSize: 14,
            flexShrink: 1,
          }}
        >
          {destination.libelle}
        </Text>
      ) : (
        <Text
          numberOfLines={1}
          style={[
            styles.petitLibelle,
            { color: selectionne ? palette.accent : palette.texteSecondaire },
          ]}
        >
          {destination.libelle}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rangee: { flex: 1, flexDirection: 'row' },
  barre: {
    borderRightWidth: 1,
    paddingVertical: ESPACEMENT.m,
    paddingHorizontal: ESPACEMENT.s,
    gap: ESPACEMENT.m,
  },
  marque: { fontSize: 19, fontWeight: '800', paddingHorizontal: ESPACEMENT.s },
  liens: { gap: 2 },
  lien: { borderRadius: RAYON.s, minHeight: 44 },
  lienLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ESPACEMENT.m - 4,
    paddingHorizontal: ESPACEMENT.m - 4,
  },
  lienEtroit: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 2,
  },
  glyphe: { fontSize: 18, width: 22, textAlign: 'center' },
  petitLibelle: { fontSize: 10.5 },
  pied: { borderTopWidth: 1, paddingTop: ESPACEMENT.s },
  contenu: { flex: 1 },
  colonne: { flex: 1 },
  bandeau: { borderBottomWidth: 1, paddingVertical: 6 },
  liensBandeau: { paddingHorizontal: ESPACEMENT.s, gap: 4, alignItems: 'center' },
  lienCompact: { minHeight: 38, paddingHorizontal: ESPACEMENT.s + 2, gap: 6 },
});
