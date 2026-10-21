/**
 * Migration du compte du Fondateur vers la connexion par identifiant + mot de passe (relais
 * version 9, docs/connexion-amis.md). À la première ouverture de l'app à jour (qui a déjà les
 * clés), on lui demande un identifiant (son prénom, par exemple) et un mot de passe :
 *
 *  1. son identité est revérifiée (mot de passe actuel, et le code à six chiffres s'il en a un) ;
 *  2. son coffre est rescellé par le nouveau mot de passe (forme canonique), le code à six chiffres
 *     n'est plus demandé, et dix NOUVEAUX codes de récupération sont tirés (à noter) ;
 *  3. son accès par identifiant (et l'accès de secours par les codes) est publié sur le serveur,
 *     son coffre téléversé ; le thème du compte devient visible à l'écran de connexion.
 *
 * Ensuite, sur n'importe quel navigateur : identifiant + mot de passe. Plus de code de liaison.
 */

import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Alerte, Bouton, Champ, SousTitre, Titre, usePalette } from '../src/ui/composants';
import { ESPACEMENT, RAYON, stylesPartages } from '../src/ui/theme';
import { evaluerMotDePasse, formeCanonique } from '../src/profils/invitation';
import { ChampMotDePasse } from './Invitation';

export interface ResultatMigration {
  identifiant: string;
  codes: string[];
}

export function EcranConnexionFondateur({
  identifiantInitial,
  codeDemande,
  dejaFait,
  resultat,
  onValider,
  onPlusTard,
}: {
  /** Déjà fait (mot de passe oublié, codes renouvelés) : l'écran montre directement les codes. */
  resultat?: ResultatMigration;
  identifiantInitial?: string;
  /** Le coffre demande encore le code à six chiffres (vérification d'identité). */
  codeDemande: boolean;
  /** Identifiant déjà défini : l'écran sert à le changer (ou à changer de mot de passe). */
  dejaFait?: string;
  onValider(o: { identifiant: string; motDePasseActuel: string; codeTotp: string; nouveau: string }): Promise<ResultatMigration>;
  onPlusTard(): void;
}) {
  const palette = usePalette();
  const [identifiant, setIdentifiant] = useState(dejaFait ?? identifiantInitial ?? '');
  const [actuel, setActuel] = useState('');
  const [code, setCode] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>();
  const [fait, setFait] = useState<ResultatMigration | undefined>(resultat);
  const evaluation = evaluerMotDePasse(nouveau, identifiant);
  const pret = identifiant.trim().length >= 2 && actuel.length > 0 && (!codeDemande || code.trim().length >= 6) && evaluation.valide && formeCanonique(confirmation) === formeCanonique(nouveau);

  const valider = () => {
    if (!pret || enCours) return;
    setErreur(undefined);
    setEnCours(true);
    onValider({ identifiant: identifiant.trim(), motDePasseActuel: actuel, codeTotp: code, nouveau })
      .then(setFait)
      .catch(e => setErreur(e instanceof Error ? e.message : String(e)))
      .finally(() => setEnCours(false));
  };

  if (fait) {
    return (
      <ScrollView style={[stylesPartages.ecran, { backgroundColor: palette.fond }]} contentContainerStyle={[stylesPartages.contenu, stylesPartages.accueil, { paddingVertical: ESPACEMENT.xl, gap: ESPACEMENT.m }]} testID="fondateur-connexion-faite">
        <Titre>C’est fait !</Titre>
        <SousTitre>
          Sur n’importe quel appareil ou navigateur (https://appdashboard.fr, l’iPhone…) : « Se connecter », l’identifiant « {fait.identifiant} » et ton
          nouveau mot de passe. Plus de code de liaison, plus de code à six chiffres.
        </SousTitre>
        <View style={[styles.cadre, { borderColor: palette.danger, backgroundColor: palette.surface }]}>
          <Text style={{ color: palette.texte, fontWeight: '800', fontSize: 16 }}>Tes codes de récupération (à noter maintenant, sur papier)</Text>
          <Text style={{ color: palette.texteSecondaire }}>
            Mot de passe oublié ? Sur l’écran de connexion, « Mot de passe oublié » : ton identifiant et UN de ces codes (chacun ne sert qu’une fois). Les
            anciens codes ne marchent plus.
          </Text>
          <Text selectable style={{ color: palette.texte, fontFamily: 'monospace', fontSize: 16, lineHeight: 26 }} testID="fondateur-codes">
            {fait.codes.join('\n')}
          </Text>
        </View>
        <Bouton titre="J’ai noté mes codes" onPress={onPlusTard} testID="fondateur-codes-notes" />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palette.fond }]}
      contentContainerStyle={[stylesPartages.contenu, stylesPartages.accueil, { paddingVertical: ESPACEMENT.xl, gap: ESPACEMENT.m }]}
      keyboardShouldPersistTaps="handled"
      testID="fondateur-connexion">
      <Titre>{dejaFait ? 'Identifiant et mot de passe de connexion' : 'Se connecter partout avec un identifiant'}</Titre>
      <SousTitre>
        {dejaFait
          ? 'Change ton identifiant ou ton mot de passe de connexion. Tes données ne bougent pas.'
          : 'Toutes tes données sont maintenant sur le serveur, chiffrées : choisis un identifiant (ton prénom par exemple) et un mot de passe. Ils suffiront pour te connecter sur n’importe quel navigateur — plus besoin de code de liaison.'}
      </SousTitre>
      <View style={[styles.cadre, { borderColor: palette.accent, backgroundColor: palette.surface }]}>
        <Champ
          etiquette="Identifiant"
          indication="Majuscules, accents et espaces ne comptent pas."
          value={identifiant}
          onChangeText={setIdentifiant}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="username"
          maxLength={30}
          testID="fondateur-identifiant"
        />
        <ChampMotDePasse etiquette="Mot de passe actuel (vérification)" valeur={actuel} onChanger={setActuel} testID="fondateur-mdp-actuel" desactive={enCours} />
        {codeDemande ? (
          <Champ etiquette="Code à six chiffres (une dernière fois)" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={8} testID="fondateur-totp" />
        ) : null}
        <ChampMotDePasse etiquette="Nouveau mot de passe" valeur={nouveau} onChanger={setNouveau} nouveau testID="fondateur-mdp" desactive={enCours} indication="10 caractères au moins ; une phrase facile à retenir est idéale." />
        {nouveau && !evaluation.valide ? <Text style={{ color: palette.danger }}>{evaluation.erreurs.join(' ')}</Text> : null}
        <ChampMotDePasse etiquette="Confirme le nouveau mot de passe" valeur={confirmation} onChanger={setConfirmation} nouveau onValider={valider} testID="fondateur-mdp-confirmation" desactive={enCours} />
        {erreur ? (
          <View testID="fondateur-erreur">
            <Alerte message={erreur} />
          </View>
        ) : null}
        {enCours ? (
          <View style={{ alignItems: 'center', gap: ESPACEMENT.s }}>
            <ActivityIndicator color={palette.accent} />
            <SousTitre>Chiffrement et envoi au serveur…</SousTitre>
          </View>
        ) : (
          <Bouton pleineLargeur titre={dejaFait ? 'Enregistrer' : 'Activer la connexion par identifiant'} desactive={!pret} onPress={valider} testID="fondateur-valider" />
        )}
      </View>
      <Bouton titre={dejaFait ? 'Annuler' : 'Plus tard'} variante="discret" onPress={onPlusTard} testID="fondateur-plus-tard" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  cadre: { borderWidth: 1.5, borderRadius: RAYON.m, padding: ESPACEMENT.m, gap: ESPACEMENT.s, width: '100%', maxWidth: 560 },
});
