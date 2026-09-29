/**
 * Écran de connexion, affiché au démarrage dès qu'il y a plusieurs comptes
 * sur l'appareil.
 *
 * Il ne **liste aucun compte** : chacun saisit son prénom (l'administrateur
 * peut aussi saisir « admin »), puis ouvre son coffre avec son mot de passe
 * et son code. Un prénom inconnu mène au même écran de déverrouillage qu'un
 * vrai compte (coffre leurre) : on ne peut pas deviner quels comptes existent.
 */

import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Bouton, Champ, SousTitre, Titre, usePalette } from '../composants';
import { ESPACEMENT, stylesPartages } from '../theme';

export function Connexion({ onContinuer, enCours }: { onContinuer(prenom: string): void; enCours?: boolean }) {
  const palette = usePalette();
  const [prenom, setPrenom] = useState('');
  const valider = () => {
    if (prenom.trim()) {
      onContinuer(prenom);
    }
  };
  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palette.fond }]}
      contentContainerStyle={[stylesPartages.contenu, stylesPartages.accueil, { paddingVertical: ESPACEMENT.xl, gap: ESPACEMENT.m }]}
      keyboardShouldPersistTaps="handled">
      <Titre>Connexion</Titre>
      <SousTitre>
        Chaque compte a son propre espace chiffré, son mot de passe et son code d’authentification. Saisissez votre prénom pour
        ouvrir le vôtre.
      </SousTitre>
      <View style={{ gap: ESPACEMENT.s, maxWidth: 420, width: '100%' }}>
        <Champ
          etiquette="Prénom"
          indication="Administrateur : votre prénom ou « admin »."
          value={prenom}
          onChangeText={setPrenom}
          onSubmitEditing={valider}
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="off"
          maxLength={30}
          testID="connexion-prenom"
        />
        <Bouton titre={enCours ? 'Ouverture…' : 'Continuer'} onPress={valider} desactive={enCours || !prenom.trim()} testID="connexion-continuer" />
      </View>
    </ScrollView>
  );
}
