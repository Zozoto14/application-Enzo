/**
 * Feuille basse (« bottom sheet ») : remplace, sur téléphone, les modales centrées, les menus
 * déroulants et les confirmations.
 *
 *  - glisse depuis le bas (sauf « réduire les animations ») ; le voile se touche pour fermer ;
 *  - poignée en haut : un glissement vers le bas ferme la feuille ;
 *  - Échap ferme (web), le bouton retour d'Android aussi (`onRequestClose`) ;
 *  - rôle `dialog` + `aria-modal`, titre annoncé, focus gardé dans la feuille (Modal) ;
 *  - jamais plus haute que 90 % de l'écran : au-delà, son contenu défile ;
 *  - la zone de sécurité du bas est respectée (barre d'accueil).
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ecouterTouche, mouvementReduit } from '../../hub/web';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import { DUREE, ESPACE, GOUTTIERE, TEXTE, rayonCarte, themeActif } from './jetons';
import { margesSecurite } from './ZoneSecurite';

export function FeuilleBasse({
  theme: themeDonne,
  visible,
  titre,
  description,
  onFermer,
  children,
  pied,
  testID = 'feuille-basse',
}: {
  theme?: ThemeHub;
  visible: boolean;
  titre: string;
  description?: string;
  onFermer(): void;
  children?: React.ReactNode;
  /** Actions collées en bas de la feuille (bouton principal). */
  pied?: React.ReactNode;
  testID?: string;
}) {
  const theme = themeActif(themeDonne);
  const { height } = useWindowDimensions();
  const reduit = mouvementReduit();
  const position = useRef(new Animated.Value(reduit ? 0 : 1)).current;
  const fermer = useRef(onFermer);
  fermer.current = onFermer;

  useEffect(() => {
    if (!visible) {
      return;
    }
    position.setValue(reduit ? 0 : 1);
    Animated.timing(position, {
      toValue: 0,
      duration: reduit ? 0 : DUREE.moyenne,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [visible, position, reduit]);

  useEffect(() => (visible ? ecouterTouche('Escape', () => fermer.current()) : undefined), [visible]);

  // Glisser la poignée vers le bas : la feuille suit le doigt, et se ferme au-delà de 80 px.
  const glisse = useRef(new Animated.Value(0)).current;
  const geste = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onStartShouldSetPanResponder: () => false,
      onPanResponderMove: (_e, g) => glisse.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 80 || g.vy > 1.2) {
          glisse.setValue(0);
          fermer.current();
        } else {
          Animated.spring(glisse, { toValue: 0, useNativeDriver: Platform.OS !== 'web' }).start();
        }
      },
    }),
  ).current;

  if (!visible) {
    return null;
  }
  const decalage = Animated.add(position.interpolate({ inputRange: [0, 1], outputRange: [0, Math.min(height, 700)] }), glisse);
  const rayon = rayonCarte(theme);
  return (
    <Modal transparent visible animationType="none" onRequestClose={onFermer} statusBarTranslucent>
      <View style={styles.racine}>
        <Pressable
          testID={`${testID}-voile`}
          accessibilityRole="button"
          accessibilityLabel="Fermer"
          onPress={onFermer}
          style={[StyleSheet.absoluteFill, { backgroundColor: teinteTransparente('#000000', theme.sombre ? 0.6 : 0.4) }]}
        />
        <Animated.View
          testID={testID}
          accessibilityViewIsModal
          aria-modal
          role="dialog"
          aria-label={titre}
          style={[
            styles.feuille,
            margesSecurite(['bas'], { bas: ESPACE.m }),
            {
              maxHeight: height * 0.9,
              backgroundColor: theme.surface,
              borderColor: theme.ligne,
              borderTopLeftRadius: rayon,
              borderTopRightRadius: rayon,
              transform: [{ translateY: decalage }],
            },
          ]}>
          <View {...geste.panHandlers} style={styles.poigneeZone} accessibilityElementsHidden>
            <View style={[styles.poignee, { backgroundColor: theme.ligne }]} />
          </View>
          <View style={styles.tete}>
            <Text
              accessibilityRole="header"
              style={{ color: theme.texte, fontSize: TEXTE.section, fontWeight: theme.poidsTitre === '400' ? '600' : theme.poidsTitre, flex: 1, ...police(theme.policeTitre) }}>
              {titre}
            </Text>
            <Pressable
              testID={`${testID}-fermer`}
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              onPress={onFermer}
              style={({ pressed }) => [styles.fermer, { backgroundColor: pressed ? theme.ligne : teinteTransparente(theme.sombre ? '#FFFFFF' : '#000000', 0.06) }]}>
              <Text style={{ color: theme.attenue, fontSize: 17, fontWeight: '700' }}>✕</Text>
            </Pressable>
          </View>
          {description ? <Text style={[styles.description, { color: theme.attenue, ...police(theme.policeTexte) }]}>{description}</Text> : null}
          <ScrollView style={styles.corps} contentContainerStyle={styles.corpsContenu} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {pied ? <View style={styles.pied}>{pied}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1, justifyContent: 'flex-end' },
  feuille: { borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0, width: '100%', maxWidth: 640, alignSelf: 'center' },
  poigneeZone: { alignItems: 'center', paddingTop: 8, paddingBottom: 4, minHeight: 24 },
  poignee: { width: 40, height: 5, borderRadius: 3 },
  tete: { flexDirection: 'row', alignItems: 'center', gap: ESPACE.xs, paddingHorizontal: GOUTTIERE, paddingBottom: ESPACE.xs },
  fermer: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  description: { fontSize: TEXTE.legende, lineHeight: 21, paddingHorizontal: GOUTTIERE, paddingBottom: ESPACE.s },
  corps: { flexGrow: 0 },
  corpsContenu: { paddingHorizontal: GOUTTIERE, paddingBottom: ESPACE.s, gap: ESPACE.s },
  pied: { paddingHorizontal: GOUTTIERE, paddingTop: ESPACE.xs, gap: ESPACE.xs },
});
