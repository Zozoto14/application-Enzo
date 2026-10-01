/**
 * Pied de page de toutes les pages de Tsuzuku : mention sobre et honnête sur
 * la nature du service et la responsabilité de chacun (droit d'auteur).
 *
 * Volontairement, elle n'affirme PAS que le service est légal, ni que « ne
 * rien télécharger » protège juridiquement : elle décrit ce que fait l'app et
 * rappelle la règle. « En savoir plus » ouvre les documents légaux
 * (Paramètres › À propos, où l'hôte range conditions et mentions).
 */

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { police, type ThemeHub } from '../../hub/themes';
import { ct, tt } from '../../ui/mobile/jetons';
import { modeTelephoneCourant } from '../../ui/mobile/useMobile';

export const MENTION_TSUZUKU =
  'Tsuzuku n’héberge ni ne télécharge aucun contenu : il affiche des contenus fournis par des sources ajoutées par l’administrateur. Chacun est responsable de n’utiliser que des sources dont il a le droit de consulter les contenus (droit d’auteur).';

export function PiedTsuzuku({ theme, onEnSavoirPlus }: { theme: ThemeHub; onEnSavoirPlus?(): void }) {
  const texte = { color: theme.attenue, fontSize: tt(12), lineHeight: modeTelephoneCourant() ? 22 : 18, ...police(theme.policeTexte) };
  return (
    <View testID="tsuzuku-pied" accessibilityRole="summary" style={{ marginTop: 24, paddingTop: 14, borderTopWidth: 1, borderTopColor: theme.ligne, gap: 6 }}>
      <Text style={texte} testID="tsuzuku-mention">
        {MENTION_TSUZUKU}
      </Text>
      {onEnSavoirPlus ? (
        <Pressable onPress={onEnSavoirPlus} accessibilityRole="link" accessibilityLabel="En savoir plus : conditions d’utilisation et mentions légales" testID="tsuzuku-mention-plus" style={{ alignSelf: 'flex-start', minHeight: ct(32), justifyContent: 'center' }}>
          <Text style={[texte, { color: theme.accent, textDecorationLine: 'underline', fontWeight: '600' }]}>En savoir plus</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
