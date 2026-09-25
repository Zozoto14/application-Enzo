/**
 * Écran de déverrouillage.
 *
 * Deux détails y comptent plus que l'apparence :
 *
 *  - **L'attente est annoncée.** La vérification enchaîne une dérivation
 *    Argon2id puis le contrôle du code TOTP, soit près d'une seconde sur
 *    l'appareil. Sans indication, cette pause passe pour un blocage.
 *
 *  - **L'erreur ne distingue pas les deux facteurs.** Le message vient tel quel
 *    de la couche session, qui répond la même chose pour un mot de passe faux
 *    et pour un code faux. L'écran ne doit surtout pas préciser davantage.
 */

import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, View, useColorScheme } from 'react-native';
import { Alerte, Bouton, Champ, SousTitre, Titre, usePalette } from '../composants';
import { ESPACEMENT, palettePour, stylesPartages } from '../theme';

export interface DeverrouillageProps {
  onDeverrouiller(motDePasse: string, codeTotp: string): void;
  onRecuperer?: () => void;
  /** Message d'échec, déjà rédigé par la couche session. */
  erreur?: string;
  /** Secondes restantes avant de pouvoir réessayer, 0 si aucune. */
  secondesAvantNouvelEssai?: number;
  enCours?: boolean;
}

export function Deverrouillage({
  onDeverrouiller,
  onRecuperer,
  erreur,
  secondesAvantNouvelEssai = 0,
  enCours = false,
}: DeverrouillageProps) {
  const [motDePasse, setMotDePasse] = useState('');
  const [code, setCode] = useState('');
  const palette = usePalette();
  const sombre = useColorScheme() === 'dark';

  const verrouille = secondesAvantNouvelEssai > 0;
  const complet = motDePasse.length > 0 && code.length > 0;

  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palettePour(sombre).fond }]}
      contentContainerStyle={[stylesPartages.contenu, { paddingTop: ESPACEMENT.xl }]}
      keyboardShouldPersistTaps="handled">
      <Titre>Déverrouiller</Titre>
      <SousTitre>
        Mot de passe et code à six chiffres sont tous deux nécessaires.
      </SousTitre>

      <Champ
        etiquette="Mot de passe"
        value={motDePasse}
        onChangeText={setMotDePasse}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!enCours && !verrouille}
        textContentType="password"
        autoComplete="current-password"
        indication="Un mot de passe long se colle depuis votre gestionnaire ; il n’a pas besoin d’être tapé."
      />

      <Champ
        etiquette="Code d'authentification"
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        maxLength={6}
        editable={!enCours && !verrouille}
        indication="Les six chiffres affichés par votre application d'authentification."
      />

      {erreur ? <Alerte message={erreur} /> : null}

      {verrouille ? (
        <Alerte
          message={`Trop de tentatives. Nouvel essai possible dans ${secondesAvantNouvelEssai} seconde${
            secondesAvantNouvelEssai > 1 ? 's' : ''
          }.`}
        />
      ) : null}

      {enCours ? (
        <View
          accessibilityLiveRegion="polite"
          style={{ alignItems: 'center', gap: ESPACEMENT.s }}>
          <ActivityIndicator color={palette.accent} />
          {/* Sans ce message, la seconde de dérivation de clé passe pour un
              plantage et l'utilisateur relance l'application. */}
          <SousTitre>Vérification en cours, cela prend un instant…</SousTitre>
        </View>
      ) : (
        <Bouton
          titre="Déverrouiller"
          testID="bouton-deverrouiller"
          desactive={!complet || verrouille}
          onPress={() => onDeverrouiller(motDePasse, code)}
        />
      )}

      {onRecuperer ? (
        <Bouton
          titre="Mot de passe oublié"
          variante="discret"
          desactive={enCours}
          onPress={onRecuperer}
        />
      ) : null}
    </ScrollView>
  );
}
