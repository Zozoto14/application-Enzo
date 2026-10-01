/**
 * Mot de passe oublié : reprendre la main avec un code de récupération.
 *
 * Les codes ont été donnés à la création du coffre, à noter hors ligne.
 * Chacun ne sert qu'une fois, et ouvre la base à condition de choisir
 * aussitôt un nouveau mot de passe : un code sert à retrouver l'accès, pas
 * à s'en passer. Le code à six chiffres de l'application d'authentification
 * n'est pas demandé — c'est justement le cas où on peut l'avoir perdu aussi.
 */

import React, { useState } from 'react';
import { ActivityIndicator, View, useColorScheme } from 'react-native';
import { EcranEntree } from './EcranEntree';
import { formatValide } from '../../securite/codes-recuperation';
import { Alerte, Bouton, Champ, SousTitre, Titre, usePalette } from '../composants';
import { ESPACEMENT, palettePour, stylesPartages } from '../theme';
import { LONGUEUR_MINIMALE_MOT_DE_PASSE } from './PremierLancement';

export interface RecuperationProps {
  onRecuperer(code: string, nouveauMotDePasse: string): void;
  onAnnuler(): void;
  /** Message d'échec, rédigé par la couche session. */
  erreur?: string;
  enCours?: boolean;
}

export function Recuperation({ onRecuperer, onAnnuler, erreur, enCours = false }: RecuperationProps) {
  const [code, setCode] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [probleme, setProbleme] = useState<string | undefined>();
  const palette = usePalette();
  const sombre = useColorScheme() === 'dark';

  const valider = () => {
    if (!formatValide(code)) {
      return setProbleme('Le code de récupération compte 16 caractères, en quatre groupes : XXXX-XXXX-XXXX-XXXX.');
    }
    if (motDePasse.length < LONGUEUR_MINIMALE_MOT_DE_PASSE) {
      return setProbleme(`Le nouveau mot de passe doit faire au moins ${LONGUEUR_MINIMALE_MOT_DE_PASSE} caractères.`);
    }
    if (motDePasse !== confirmation) {
      return setProbleme('Les deux mots de passe ne correspondent pas.');
    }
    setProbleme(undefined);
    onRecuperer(code, motDePasse);
  };

  return (
    <EcranEntree
      styleBureau={{ backgroundColor: palettePour(sombre).fond }}
      styleContenuBureau={[stylesPartages.contenu, stylesPartages.accueil, { paddingVertical: ESPACEMENT.xl }]}
      pied={
        enCours ? (
          <View style={{ alignItems: 'center', gap: ESPACEMENT.s }}>
            <ActivityIndicator color={palette.accent} />
            <SousTitre>Vérification du code…</SousTitre>
          </View>
        ) : (
          <Bouton titre="Retrouver l’accès" pleineLargeur testID="bouton-recuperer" onPress={valider} />
        )
      }
      apresPied={<Bouton titre="Retour" pleineLargeur variante="discret" desactive={enCours} onPress={onAnnuler} testID="bouton-retour-recuperation" />}>
      <Titre>Mot de passe oublié</Titre>
      <SousTitre>
        Saisissez l’un des codes de récupération notés à la création de l’application, puis choisissez un
        nouveau mot de passe. Chaque code ne sert qu’une fois.
      </SousTitre>

      <Champ
        etiquette="Code de récupération"
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="XXXX-XXXX-XXXX-XXXX"
        nature="codeRecuperation"
        enterKeyHint="next"
        testID="champ-code-recuperation"
        indication="Tirets, espaces et majuscules n’ont pas d’importance ; O et 0, I et 1 sont confondus exprès."
      />
      <Champ
        etiquette="Nouveau mot de passe"
        value={motDePasse}
        onChangeText={setMotDePasse}
        secureTextEntry
        autoCapitalize="none"
        nature="nouveauMotDePasse"
        autoComplete="new-password"
        testID="champ-nouveau-mot-de-passe"
        indication={`${LONGUEUR_MINIMALE_MOT_DE_PASSE} caractères au minimum.`}
      />
      <Champ
        etiquette="Confirmer le nouveau mot de passe"
        value={confirmation}
        onChangeText={setConfirmation}
        secureTextEntry
        autoCapitalize="none"
        nature="nouveauMotDePasse"
        autoComplete="new-password"
        enterKeyHint="go"
        onSubmitEditing={valider}
        testID="champ-confirmation-mot-de-passe"
      />

      {probleme ? <Alerte message={probleme} /> : erreur ? <Alerte message={erreur} /> : null}

    </EcranEntree>
  );
}
