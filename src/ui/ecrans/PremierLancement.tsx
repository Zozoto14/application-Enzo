/**
 * Premier lancement : création du coffre, puis remise des secrets.
 *
 * L'écran est en deux temps, et le second est le plus important de toute
 * l'application : les codes de récupération et le secret TOTP n'y sont montrés
 * **qu'une seule fois**. Le coffre n'en garde que la forme chiffrée, et rien ne
 * permettra de les retrouver ensuite.
 *
 * D'où le verrou de sortie : tant que la case de confirmation n'est pas cochée,
 * le bouton reste inactif. Un utilisateur qui passe trop vite perd l'accès à
 * ses données le jour où il oublie son mot de passe.
 */

import React, { useState } from 'react';
import { StyleSheet, Switch, Text, View, useColorScheme } from 'react-native';
import { FeuilleBasse } from '../mobile/FeuilleBasse';
import { Cellule, GroupeCellules } from '../mobile/ListeCellules';
import { useMobile } from '../mobile/useMobile';
import { EcranEntree } from './EcranEntree';
import { Alerte, Bouton, Carte, Champ, SousTitre, Titre, usePalette } from '../composants';
import { ESPACEMENT, RAYON, palettePour, stylesPartages } from '../theme';
import { LierCompte, type OptionsLier } from './LierCompte';

export interface SecretsInitiaux {
  codesRecuperation: string[];
  secretTotp: string;
  uriTotp: string;
}

export interface PremierLancementProps {
  onCreer(motDePasse: string): void;
  /** Renseigné une fois le coffre créé : l'écran passe alors en remise des secrets. */
  secrets?: SecretsInitiaux;
  onTermine?: () => void;
  enCours?: boolean;
  erreur?: string;
  /** Lier à un compte existant (PC) au lieu d'en créer un. */
  lier?: OptionsLier;
}

/** Longueur minimale exigée. Le mot de passe est censé venir d'un gestionnaire. */
export const LONGUEUR_MINIMALE_MOT_DE_PASSE = 12;

export function PremierLancement({
  onCreer,
  secrets,
  onTermine,
  enCours = false,
  erreur,
  lier,
}: PremierLancementProps) {
  const sombre = useColorScheme() === 'dark';
  const fond = { backgroundColor: palettePour(sombre).fond };

  if (secrets) {
    return (
      <RemiseDesSecrets secrets={secrets} onTermine={onTermine} style={fond} />
    );
  }
  return <Creation onCreer={onCreer} enCours={enCours} erreur={erreur} style={fond} lier={lier} />;
}

function Creation({
  onCreer,
  enCours,
  erreur,
  style,
  lier,
}: {
  onCreer(motDePasse: string): void;
  enCours: boolean;
  erreur?: string;
  style: object;
  lier?: OptionsLier;
}) {
  const [motDePasse, setMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const tropCourt = motDePasse.length < LONGUEUR_MINIMALE_MOT_DE_PASSE;
  const discordant = confirmation.length > 0 && confirmation !== motDePasse;
  const valide = !tropCourt && !discordant && confirmation === motDePasse;

  const mobile = useMobile();
  const [lierOuvert, setLierOuvert] = useState(false);
  const creer = () => {
    if (valide && !enCours) {
      onCreer(motDePasse);
    }
  };
  return (
    <EcranEntree
      styleBureau={style}
      styleContenuBureau={[stylesPartages.contenu, stylesPartages.accueil, { paddingVertical: ESPACEMENT.xl }]}
      pied={
        <Bouton
          pleineLargeur
          titre={enCours ? 'Création en cours…' : 'Créer le coffre'}
          testID="bouton-creer"
          desactive={!valide || enCours}
          onPress={() => onCreer(motDePasse)}
        />
      }>
      {lier && mobile ? (
        // Téléphone : la liaison est une entrée qui ouvre une feuille basse ; l'écran garde une seule action principale.
        <>
          <GroupeCellules>
            <Cellule
              titre="Déjà un compte ailleurs ?"
              sousTitre="Relier cet appareil avec un code de liaison (AB1.…)."
              glyphe="🔗"
              chevron
              onPress={() => setLierOuvert(true)}
              testID="ouvrir-lier-compte"
            />
          </GroupeCellules>
          <FeuilleBasse visible={lierOuvert} titre="Relier cet appareil" onFermer={() => setLierOuvert(false)} testID="feuille-lier-compte">
            <LierCompte {...lier} />
          </FeuilleBasse>
        </>
      ) : lier ? (
        <>
          <LierCompte {...lier} />
          <Text style={{ color: palettePour().texteSecondaire, textAlign: 'center' }}>— ou, nouveau compte sur cet appareil —</Text>
        </>
      ) : null}
      <Titre>Protéger vos données</Titre>
      <SousTitre>
        Ce mot de passe chiffre l'intégralité de votre portefeuille sur cet
        appareil. Utilisez un mot de passe long, généré par votre gestionnaire.
      </SousTitre>

      <Champ
        etiquette="Mot de passe"
        value={motDePasse}
        onChangeText={setMotDePasse}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!enCours}
        textContentType="newPassword"
        autoComplete="new-password"
        nature="nouveauMotDePasse"
        indication={`${LONGUEUR_MINIMALE_MOT_DE_PASSE} caractères au minimum, sans maximum. Un mot de passe de 128 caractères généré par votre gestionnaire convient parfaitement : il se colle, il ne se tape pas.`}
      />

      <Champ
        etiquette="Confirmation"
        value={confirmation}
        onChangeText={setConfirmation}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!enCours}
        textContentType="newPassword"
        autoComplete="new-password"
        nature="nouveauMotDePasse"
        enterKeyHint="done"
        onSubmitEditing={creer}
      />

      {discordant ? <Alerte message="Les deux saisies diffèrent." /> : null}
      {erreur ? <Alerte message={erreur} /> : null}
    </EcranEntree>
  );
}

function RemiseDesSecrets({
  secrets,
  onTermine,
  style,
}: {
  secrets: SecretsInitiaux;
  onTermine?: () => void;
  style: object;
}) {
  const [confirme, setConfirme] = useState(false);
  const palette = usePalette();
  const mobile = useMobile();

  return (
    <EcranEntree
      styleBureau={style}
      styleContenuBureau={[stylesPartages.contenu, stylesPartages.accueil, { paddingVertical: ESPACEMENT.xl }]}
      centre={false}
      pied={
        <Bouton
          pleineLargeur
          titre="Continuer"
          testID="bouton-continuer"
          desactive={!confirme}
          onPress={() => onTermine?.()}
        />
      }>
      <Titre>À noter maintenant</Titre>
      <SousTitre>
        Ces informations ne seront plus jamais affichées. Notez-les hors ligne,
        sur papier, et rangez-les en lieu sûr.
      </SousTitre>

      <Carte>
        <Text style={[styles.sectionTitre, { color: palette.texte }]}>
          Codes de récupération
        </Text>
        <SousTitre>
          Chacun ouvre vos données une seule fois si vous perdez votre mot de
          passe. Sans eux, un oubli est définitif.
        </SousTitre>
        <View style={styles.grilleCodes}>
          {secrets.codesRecuperation.map(code => (
            <Text
              key={code}
              selectable
              style={[
                styles.code,
                { color: palette.texte, borderColor: palette.bordure },
              ]}>
              {code}
            </Text>
          ))}
        </View>
      </Carte>

      <Carte>
        <Text style={[styles.sectionTitre, { color: palette.texte }]}>
          Code d'authentification
        </Text>
        <SousTitre>
          Ajoutez cette clé à votre application d'authentification. Elle sera
          demandée à chaque ouverture, en plus du mot de passe.
        </SousTitre>
        <Text
          selectable
          style={[styles.code, { color: palette.texte, borderColor: palette.bordure }]}>
          {secrets.secretTotp}
        </Text>
      </Carte>

      {mobile ? (
        <GroupeCellules>
          <Cellule titre="J'ai noté ces codes hors ligne." interrupteur={{ valeur: confirme, onChanger: setConfirme }} testID="interrupteur-codes-notes" />
        </GroupeCellules>
      ) : (
        <View style={[stylesPartages.ligne, { gap: ESPACEMENT.m }]}>
          <Text style={{ color: palette.texte, flex: 1 }}>
            J'ai noté ces codes hors ligne.
          </Text>
          <Switch
            value={confirme}
            onValueChange={setConfirme}
            accessibilityLabel="J'ai noté ces codes hors ligne"
          />
        </View>
      )}
    </EcranEntree>
  );
}

const styles = StyleSheet.create({
  sectionTitre: { fontSize: 17, fontWeight: '700' },
  grilleCodes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ESPACEMENT.s,
  },
  code: {
    fontFamily: 'Courier',
    fontSize: 15,
    letterSpacing: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RAYON.s,
    paddingVertical: ESPACEMENT.xs,
    paddingHorizontal: ESPACEMENT.s,
  },
});
