/**
 * Pictogramme d'une donnée de l'interface (onglet, état vide, chiffre clé, ligne de menu…) : un nom d'icône
 * (« cloche », « membres »…) se dessine avec `Icone` ; tout autre texte (« ⌂ », « ◆ », « ? », une initiale) reste
 * un texte. Ainsi les tables de glyphes existantes passent aux icônes sans changer leur forme.
 */

import React from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { Icone } from './Icone';
import { estNomIcone } from './traces';

export function Glyphe({
  valeur,
  taille,
  couleur,
  libelle,
  style,
  testID,
}: {
  valeur: string;
  /** Taille du texte équivalent, en pixels (à défaut, `fontSize` du style) : l'icône est un peu plus grande (1,15 ×) pour peser autant. */
  taille?: number;
  /** Couleur (à défaut, `color` du style ; sinon celle du texte autour). */
  couleur?: string;
  /** Glyphe seul (sans texte à côté) : son nom accessible. */
  libelle?: string;
  /** Style du texte ; pour une icône, seuls sa taille de police et sa couleur comptent. */
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  if (estNomIcone(valeur)) {
    const plat = StyleSheet.flatten(style) ?? {};
    const t = taille ?? (typeof plat.fontSize === 'number' ? plat.fontSize : undefined);
    const c = couleur ?? (typeof plat.color === 'string' ? plat.color : undefined);
    return <Icone nom={valeur} taille={t !== undefined ? Math.round(t * 1.15) : undefined} couleur={c} libelle={libelle} testID={testID} />;
  }
  return (
    <Text
      testID={testID}
      accessibilityLabel={libelle}
      accessibilityElementsHidden={!libelle}
      importantForAccessibility={libelle ? 'yes' : 'no-hide-descendants'}
      style={[taille !== undefined && { fontSize: taille }, couleur !== undefined && { color: couleur }, style]}>
      {valeur}
    </Text>
  );
}
