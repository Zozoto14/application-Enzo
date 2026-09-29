/**
 * « Qui utilise AppliBourse ? » — affiché au démarrage dès qu'il y a plus
 * d'un profil sur l'appareil. Chacun ouvre ensuite son propre portefeuille
 * avec son propre mot de passe.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SousTitre, Titre, usePalette } from '../composants';
import { ESPACEMENT, RAYON, stylesPartages } from '../theme';
import type { Profil } from '../../profils/profils';

export function ChoixProfil({ profils, onChoisir }: { profils: readonly Profil[]; onChoisir(id: string): void }) {
  const palette = usePalette();
  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palette.fond }]}
      contentContainerStyle={[stylesPartages.contenu, stylesPartages.accueil, { paddingVertical: ESPACEMENT.xl, gap: ESPACEMENT.m }]}>
      <Titre>Qui utilise AppliBourse ?</Titre>
      <SousTitre>Chaque profil a son propre portefeuille, son mot de passe et son code d’authentification.</SousTitre>
      <View style={styles.grille}>
        {profils.map(profil => (
          <Pressable
            key={profil.id}
            accessibilityRole="button"
            accessibilityLabel={`Ouvrir le profil ${profil.nom}`}
            onPress={() => onChoisir(profil.id)}
            testID={`profil-${profil.id}`}
            style={({ pressed }) => [
              styles.carte,
              { backgroundColor: palette.surface, borderColor: pressed ? palette.accent : palette.bordure },
            ]}>
            <View style={[styles.avatar, { backgroundColor: profil.admin ? palette.accent : palette.surfaceHaute }]}>
              <Text style={{ color: profil.admin ? '#fff' : palette.texte, fontSize: 28, fontWeight: '800' }}>
                {profil.nom.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <Text style={{ color: palette.texte, fontWeight: '700', fontSize: 16 }} numberOfLines={1}>
              {profil.nom}
            </Text>
            <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>{profil.admin ? 'Administrateur' : 'Profil'}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grille: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.m, justifyContent: 'center' },
  carte: { width: 150, alignItems: 'center', gap: ESPACEMENT.s, padding: ESPACEMENT.m, borderWidth: 1.5, borderRadius: RAYON.l },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
