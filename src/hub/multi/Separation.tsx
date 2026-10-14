/**
 * Séparation redimensionnable du côte à côte : on la glisse (souris, doigt,
 * stylet), ou on la règle au clavier (flèches : 5 %, Origine / Fin : bornes,
 * Entrée : moitié-moitié) une fois qu'elle a le focus.
 */

import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, View, type DimensionValue } from 'react-native';
import { teinteTransparente, type ThemeHub } from '../themes';
import { RATIO_DEFAUT, RATIO_MAX, RATIO_MIN } from './onglets';

/** Largeur de la zone de prise, en pixels (la moitié de chaque côté de la limite). */
export const LARGEUR_SEPARATION = 10;

export function Separation({
  theme,
  ratio,
  largeurScene,
  onRatio,
  libelle,
}: {
  theme: ThemeHub;
  ratio: number;
  largeurScene: number;
  onRatio(ratio: number): void;
  libelle: string;
}) {
  const [actif, setActif] = useState(false);
  const depart = useRef(ratio);
  const courant = useRef({ ratio, largeurScene, onRatio });
  courant.current = { ratio, largeurScene, onRatio };
  const glisser = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          depart.current = courant.current.ratio;
          setActif(true);
        },
        onPanResponderMove: (_e, geste) => {
          const { largeurScene: largeur, onRatio: changer } = courant.current;
          if (largeur > 0) {
            changer(depart.current + geste.dx / largeur);
          }
        },
        onPanResponderRelease: () => setActif(false),
        onPanResponderTerminate: () => setActif(false),
      }),
    [],
  );
  const clavier = (e: { nativeEvent?: { key?: string }; key?: string; preventDefault?(): void }) => {
    const touche = e.nativeEvent?.key ?? e.key;
    const suivant =
      touche === 'ArrowLeft' ? ratio - 0.05 : touche === 'ArrowRight' ? ratio + 0.05 : touche === 'Home' ? RATIO_MIN : touche === 'End' ? RATIO_MAX : touche === 'Enter' ? RATIO_DEFAUT : undefined;
    if (suivant !== undefined) {
      e.preventDefault?.();
      onRatio(suivant);
    }
  };
  const proprietesWeb =
    Platform.OS === 'web'
      ? ({ onKeyDown: clavier, focusable: true, tabIndex: 0, role: 'separator', 'aria-orientation': 'vertical', 'aria-valuenow': Math.round(ratio * 100), 'aria-valuemin': Math.round(RATIO_MIN * 100), 'aria-valuemax': Math.round(RATIO_MAX * 100) } as object)
      : {};
  return (
    <View
      {...glisser.panHandlers}
      {...proprietesWeb}
      testID="onglets-separation"
      accessibilityLabel={libelle}
      accessibilityHint="Glissez pour redimensionner ; au clavier : flèches gauche et droite."
      style={[
        styles.zone,
        { left: `${ratio * 100}%` as DimensionValue },
        Platform.OS === 'web' ? ({ cursor: 'col-resize', touchAction: 'none' } as object) : null,
      ]}>
      <View style={[styles.trait, { backgroundColor: actif ? theme.accent : theme.ligne }]} />
      <View style={[styles.poignee, { backgroundColor: actif ? theme.accent : teinteTransparente(theme.texte, 0.35), borderRadius: 3 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  zone: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: LARGEUR_SEPARATION,
    marginLeft: -LARGEUR_SEPARATION / 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  trait: { position: 'absolute', top: 0, bottom: 0, width: 1 },
  poignee: { width: 4, height: 40 },
});
