/** Paramètres › Sécurité : verrouillage automatique de l'application (réglage de cet appareil). */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DELAIS_VERROU_MINUTES, DELAI_PRESENCE_SECONDES, libelleDelaiVerrou } from '../securite/verrouAuto';
import { police, type ThemeHub } from './themes';

export function ReglageVerrouAuto({ theme, minutes, onChoisir }: { theme: ThemeHub; minutes: number; onChoisir(minutes: number): void }) {
  const rayon = Math.min(theme.rayonMoyen, 10);
  const attenue = { color: theme.attenue, fontSize: 13, lineHeight: 19, ...police(theme.policeTexte) };
  return (
    <View style={{ gap: 10 }} testID="parametres-verrou-auto">
      <Text style={attenue}>
        {minutes === 0
          ? 'Le verrouillage automatique est désactivé : l’application reste ouverte tant que la fenêtre l’est.'
          : `Après ${libelleDelaiVerrou(minutes)} sans toucher l’écran, la souris ni le clavier, l’application se verrouille et redemande votre mot de passe et votre code.`}{' '}
        Pendant la lecture d’un film ou d’un épisode, elle demande d’abord « Êtes-vous toujours là ? » ({DELAI_PRESENCE_SECONDES} secondes pour répondre). Réglage propre à cet appareil.
      </Text>
      <View style={[styles.segments, { borderColor: theme.ligne, borderRadius: rayon }]} accessibilityRole="radiogroup" accessibilityLabel="Verrouiller après">
        {DELAIS_VERROU_MINUTES.map(valeur => {
          const actif = valeur === minutes;
          return (
            <Pressable
              key={valeur}
              testID={`verrou-auto-${valeur}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: actif }}
              aria-checked={actif}
              accessibilityLabel={`Verrouiller après : ${libelleDelaiVerrou(valeur)}`}
              onPress={() => onChoisir(valeur)}
              style={[styles.segment, { backgroundColor: actif ? theme.accent : 'transparent' }]}>
              <Text style={{ color: actif ? theme.surAccent : theme.texte, fontWeight: '600', fontSize: 13, ...police(theme.policeTexte) }}>{libelleDelaiVerrou(valeur)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  segments: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, overflow: 'hidden', alignSelf: 'flex-start' },
  segment: { paddingVertical: 8, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center' },
});
