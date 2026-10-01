/**
 * Section repliable : pour couper un long formulaire ou un écran dense en blocs qu'on ouvre à la
 * demande. L'en-tête (48 px, toute la largeur) annonce son état (`expanded`).
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { police, type ThemeHub } from '../../hub/themes';
import { CONTROLE, ESPACE, TEXTE, rayonCarte, themeActif } from './jetons';

export function SectionRepliable({
  theme: themeDonne,
  titre,
  resume,
  ouverteParDefaut = false,
  children,
  testID,
}: {
  theme?: ThemeHub;
  titre: string;
  /** Résumé affiché sous le titre quand la section est fermée. */
  resume?: string;
  ouverteParDefaut?: boolean;
  children: React.ReactNode;
  testID?: string;
}) {
  const theme = themeActif(themeDonne);
  const [ouverte, setOuverte] = useState(ouverteParDefaut);
  return (
    <View testID={testID} style={[styles.bloc, { backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: rayonCarte(theme) }]}>
      <Pressable
        testID={testID ? `${testID}-entete` : undefined}
        accessibilityRole="button"
        accessibilityState={{ expanded: ouverte }}
        aria-expanded={ouverte}
        accessibilityLabel={titre}
        onPress={() => setOuverte(o => !o)}
        style={styles.entete}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: theme.texte, fontSize: TEXTE.corps, fontWeight: '600', ...police(theme.policeTexte) }}>{titre}</Text>
          {!ouverte && resume ? <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, ...police(theme.policeTexte) }}>{resume}</Text> : null}
        </View>
        <Text style={{ color: theme.attenue, fontSize: 18, transform: [{ rotate: ouverte ? '90deg' : '0deg' }] }}>›</Text>
      </Pressable>
      {ouverte ? <View style={styles.corps}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bloc: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  entete: { minHeight: CONTROLE.hauteur + 4, flexDirection: 'row', alignItems: 'center', gap: ESPACE.s, paddingHorizontal: ESPACE.m, paddingVertical: ESPACE.xs },
  corps: { paddingHorizontal: ESPACE.m, paddingBottom: ESPACE.m, gap: ESPACE.s },
});
