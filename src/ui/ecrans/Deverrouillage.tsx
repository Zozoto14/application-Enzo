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
import { ActivityIndicator, Text, View, useColorScheme } from 'react-native';
import { Alerte, Bouton, Champ, SousTitre, Titre, usePalette } from '../composants';
import { ESPACEMENT, palettePour, stylesPartages } from '../theme';
import { EcranEntree } from './EcranEntree';
import { useMobile } from '../mobile/useMobile';
import { TEXTE } from '../mobile/jetons';
import { LierCompte, type OptionsLier } from './LierCompte';

export interface DeverrouillageProps {
  onDeverrouiller(motDePasse: string, codeTotp: string): void;
  onRecuperer?: () => void;
  /** Message d'échec, déjà rédigé par la couche session. */
  erreur?: string;
  /** Secondes restantes avant de pouvoir réessayer, 0 si aucune. */
  secondesAvantNouvelEssai?: number;
  enCours?: boolean;
  /** Remplacer le compte de cet appareil par celui du PC. */
  lier?: OptionsLier;
  /** Message d'accueil, par exemple juste après une liaison. */
  message?: string;
  /**
   * Ce navigateur contient un autre coffre que celui du compte relié : après
   * un échec, proposer de reprendre celui du compte (code de liaison connu).
   */
  suggererAutreCoffre?: boolean;
}

export function Deverrouillage({
  onDeverrouiller,
  onRecuperer,
  erreur,
  secondesAvantNouvelEssai = 0,
  enCours = false,
  lier,
  message,
  suggererAutreCoffre = false,
}: DeverrouillageProps) {
  const [montrerLier, setMontrerLier] = useState(false);
  const [motDePasse, setMotDePasse] = useState('');
  const [code, setCode] = useState('');
  const palette = usePalette();
  const sombre = useColorScheme() === 'dark';

  const verrouille = secondesAvantNouvelEssai > 0;
  const complet = motDePasse.length > 0 && code.length > 0;

  const mobile = useMobile();
  const deverrouiller = () => {
    if (complet && !verrouille && !enCours) {
      onDeverrouiller(motDePasse, code);
    }
  };

  const principal = enCours ? (
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
      pleineLargeur
      testID="bouton-deverrouiller"
      desactive={!complet || verrouille}
      onPress={() => onDeverrouiller(motDePasse, code)}
    />
  );

  return (
    <EcranEntree
      styleBureau={{ backgroundColor: palettePour(sombre).fond }}
      styleContenuBureau={[stylesPartages.contenu, stylesPartages.accueil, { paddingVertical: ESPACEMENT.xl }]}
      pied={principal}
      apresPied={
        <>
          {onRecuperer ? (
            <Bouton
              titre="Mot de passe oublié"
              pleineLargeur
              variante="discret"
              desactive={enCours}
              onPress={onRecuperer}
            />
          ) : null}
          {lier ? (
            montrerLier ? (
              <LierCompte {...lier} remplace />
            ) : (
              <Bouton
                titre="Lier à mon compte (code de liaison)"
                pleineLargeur
                variante="discret"
                desactive={enCours}
                onPress={() => setMontrerLier(true)}
                testID="montrer-lier"
              />
            )
          ) : null}
        </>
      }>
      <Titre>Déverrouiller</Titre>
      <SousTitre>
        Mot de passe et code à six chiffres sont tous deux nécessaires.
      </SousTitre>
      {message ? (
        <Text style={{ color: palette.hausse, fontWeight: '600', fontSize: mobile ? TEXTE.legende : undefined }} testID="message-deverrouillage">
          {message}
        </Text>
      ) : null}

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
        nature="motDePasse"
        enterKeyHint="next"
        indication="Un mot de passe long se colle depuis votre gestionnaire ; il n’a pas besoin d’être tapé."
      />

      <Champ
        etiquette="Code d'authentification"
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        maxLength={6}
        nature="codeTotp"
        enterKeyHint="go"
        onSubmitEditing={deverrouiller}
        editable={!enCours && !verrouille}
        indication="Les six chiffres affichés par votre application d'authentification."
      />

      {erreur ? <Alerte message={erreur} /> : null}
      {erreur && suggererAutreCoffre && lier?.codeConnu && !montrerLier ? (
        <View style={{ gap: ESPACEMENT.s }} testID="suggestion-autre-coffre">
          <Text style={{ color: palette.texte, fontWeight: '600', fontSize: mobile ? TEXTE.legende : undefined }}>
            Ce navigateur contient un autre coffre : reprendre celui de ton compte ?
          </Text>
          <Bouton titre="Reprendre le coffre de mon compte" variante="discret" pleineLargeur onPress={() => setMontrerLier(true)} testID="reprendre-coffre" />
        </View>
      ) : null}

      {verrouille ? (
        <Alerte
          message={`Trop de tentatives. Nouvel essai possible dans ${secondesAvantNouvelEssai} seconde${
            secondesAvantNouvelEssai > 1 ? 's' : ''
          }.`}
        />
      ) : null}

    </EcranEntree>
  );
}
