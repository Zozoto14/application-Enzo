/**
 * Ligne discrète de l'écran de connexion : ce que la synchronisation a fait
 * avant le déverrouillage (voir sync/relais/prechargement.ts).
 *
 * Rien de propre à un compte : l'état est global à l'appareil, fait de
 * compteurs et d'une date. Le même texte s'affiche quel que soit le prénom
 * saisi (vrai compte ou leurre).
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { lireEtatDemarrage, surEtatDemarrage, textesEtatDemarrage, type EtatDemarrage } from '../sync/relais/prechargement';
import { police, type ThemeHub } from './themes';

export function LigneSynchroDemarrage({ theme }: { theme: ThemeHub }) {
  const [etat, setEtat] = useState<EtatDemarrage>(() => lireEtatDemarrage());
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const desabonner = surEtatDemarrage(suivant => {
      setEtat(suivant);
      setMaintenant(Date.now());
    });
    // « il y a X min » avance tout seul.
    const minuterie = setInterval(() => setMaintenant(Date.now()), 30_000);
    return () => {
      desabonner();
      clearInterval(minuterie);
    };
  }, []);
  const lignes = textesEtatDemarrage(etat, maintenant);
  if (lignes.length === 0) {
    return null;
  }
  return (
    <View style={styles.ligne} testID="synchro-demarrage" accessibilityRole="text" accessibilityLiveRegion="polite">
      {lignes.map(texte => (
        <Text key={texte} style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>
          {texte}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  ligne: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 2, justifyContent: 'center', paddingTop: 6, paddingHorizontal: 12 },
});
