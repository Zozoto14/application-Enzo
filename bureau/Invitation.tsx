/**
 * Écrans de connexion d'un ami sur le site (voir docs/connexion-amis.md) :
 *
 *  - `EcranInvitation` : l'ami a ouvert son lien d'invitation ; il voit son
 *    identifiant et choisit SON mot de passe (règles claires, indicateur de
 *    force, afficher/masquer, compatible gestionnaire de mots de passe) ;
 *  - `BlocConnexion` : sur un appareil neuf, « Se connecter » (identifiant +
 *    mot de passe) et « J'ai une invitation » (coller le lien ou taper le
 *    code court).
 *
 * Les champs n'ont ni majuscule automatique, ni correction, ni vérification
 * orthographique ; les erreurs disent la cause exacte et quoi faire.
 */

import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alerte, Bouton, Champ, SousTitre, Titre, usePalette } from '../src/ui/composants';
import { ESPACEMENT, RAYON, stylesPartages } from '../src/ui/theme';
import { LONGUEUR_MIN_AMI, evaluerMotDePasse, formeCanonique } from '../src/profils/invitation';

function message(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}

/** Saisie d'un mot de passe, avec « Afficher / Masquer ». */
export function ChampMotDePasse({
  etiquette,
  valeur,
  onChanger,
  nouveau = false,
  indication,
  onValider,
  testID,
  desactive = false,
}: {
  etiquette: string;
  valeur: string;
  onChanger(v: string): void;
  nouveau?: boolean;
  indication?: string;
  onValider?(): void;
  testID: string;
  desactive?: boolean;
}) {
  const palette = usePalette();
  const [visible, setVisible] = useState(false);
  return (
    <View style={{ gap: 4 }}>
      <Champ
        etiquette={etiquette}
        value={valeur}
        onChangeText={onChanger}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete={nouveau ? 'new-password' : 'current-password'}
        textContentType={nouveau ? 'newPassword' : 'password'}
        nature={nouveau ? 'nouveauMotDePasse' : 'motDePasse'}
        enterKeyHint={onValider ? 'go' : 'next'}
        onSubmitEditing={onValider}
        editable={!desactive}
        indication={indication}
        testID={testID}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
        onPress={() => setVisible(v => !v)}
        testID={`${testID}-afficher`}
        style={{ alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 4, minHeight: 36 }}>
        <Text style={{ color: palette.accent, fontWeight: '600' }}>{visible ? '🙈 Masquer' : '👁 Afficher'}</Text>
      </Pressable>
    </View>
  );
}

/** Barre de force et règles du nouveau mot de passe. */
function IndicateurForce({ motDePasse, prenom }: { motDePasse: string; prenom: string }) {
  const palette = usePalette();
  const e = evaluerMotDePasse(motDePasse, prenom);
  const couleurs = [palette.danger, '#d9822b', '#c9a227', palette.hausse, palette.hausse];
  const vide = motDePasse.length === 0;
  return (
    <View style={{ gap: 6 }} testID="invitation-force">
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {[0, 1, 2, 3].map(i => (
          <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: !vide && e.force > i ? couleurs[e.force] : palette.bordure }} />
        ))}
      </View>
      <Text style={{ color: vide ? palette.texteSecondaire : couleurs[e.force], fontWeight: '600' }} testID="invitation-force-libelle">
        {vide ? `Au moins ${LONGUEUR_MIN_AMI} caractères. Une phrase facile à retenir est idéale.` : `Force : ${e.libelle}`}
      </Text>
      {!vide && e.erreurs.length > 0 ? (
        <View testID="invitation-regles">
          {e.erreurs.map(err => (
            <Text key={err} style={{ color: palette.danger }}>
              • {err}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export interface InfosInvitation {
  prenom: string;
  fondateur?: string;
  expire: string;
}

export function EcranInvitation({
  infos,
  chargement,
  erreur: erreurInitiale,
  autreCompteIci,
  onAccepter,
  onAccueil,
}: {
  /** Absent pendant la vérification du lien. */
  infos?: InfosInvitation;
  chargement?: boolean;
  erreur?: string;
  /** Ce navigateur contient déjà un autre compte : il faut le confirmer. */
  autreCompteIci?: boolean;
  onAccepter(motDePasse: string): Promise<void>;
  onAccueil(): void;
}) {
  const palette = usePalette();
  const [mdp, setMdp] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>();
  const [remplacer, setRemplacer] = useState(false);
  const affichee = erreur ?? erreurInitiale;
  const evaluation = evaluerMotDePasse(mdp, infos?.prenom ?? '');
  const differents = confirmation.length > 0 && formeCanonique(confirmation) !== formeCanonique(mdp);
  const pret = Boolean(infos) && evaluation.valide && formeCanonique(confirmation) === formeCanonique(mdp) && (!autreCompteIci || remplacer) && !enCours;
  const valider = () => {
    if (!pret) return;
    setErreur(undefined);
    setEnCours(true);
    onAccepter(mdp)
      .catch(e => setErreur(message(e)))
      .finally(() => setEnCours(false));
  };
  const jour = infos ? new Date(infos.expire).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palette.fond }]}
      contentContainerStyle={[stylesPartages.contenu, stylesPartages.accueil, { paddingVertical: ESPACEMENT.xl, gap: ESPACEMENT.m }]}
      keyboardShouldPersistTaps="handled"
      testID="invitation-ecran">
      <Titre>{infos ? `Bienvenue, ${infos.prenom} !` : 'Invitation'}</Titre>
      {chargement && !infos ? (
        <View style={{ alignItems: 'center', gap: ESPACEMENT.s }}>
          <ActivityIndicator color={palette.accent} />
          <SousTitre>Vérification de l’invitation…</SousTitre>
        </View>
      ) : null}
      {infos ? (
        <>
          <SousTitre>
            {infos.fondateur ? `${infos.fondateur} t’invite sur AppDashboard.` : 'Tu es invité sur AppDashboard.'} Choisis ton mot de passe : c’est tout. Invitation valable
            jusqu’au {jour}, une seule fois.
          </SousTitre>
          <View style={[styles.cadre, { borderColor: palette.accent, backgroundColor: palette.surface }]}>
            <Text style={{ color: palette.texteSecondaire }}>Ton identifiant (à retenir)</Text>
            <Text style={{ color: palette.texte, fontWeight: '800', fontSize: 22 }} testID="invitation-identifiant" selectable>
              {infos.prenom}
            </Text>
            <Text style={{ color: palette.texteSecondaire, fontSize: 13 }}>Majuscules, accents et espaces n’ont pas d’importance pour l’identifiant.</Text>
            {/* Gestionnaire de mots de passe : l'identifiant accompagne le nouveau mot de passe. */}
            <TextInput value={infos.prenom} editable={false} autoComplete="username" textContentType="username" style={{ height: 1, width: 1, opacity: 0, padding: 0 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="invitation-identifiant-cache" />
            <ChampMotDePasse etiquette="Ton mot de passe" valeur={mdp} onChanger={setMdp} nouveau testID="invitation-mdp" desactive={enCours} />
            <IndicateurForce motDePasse={mdp} prenom={infos.prenom} />
            <ChampMotDePasse
              etiquette="Confirme ton mot de passe"
              valeur={confirmation}
              onChanger={setConfirmation}
              nouveau
              onValider={valider}
              testID="invitation-mdp-confirmation"
              desactive={enCours}
              indication={differents ? 'Les deux mots de passe sont différents.' : 'Les espaces au début et à la fin ne comptent pas.'}
            />
            {autreCompteIci ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: remplacer }}
                onPress={() => setRemplacer(v => !v)}
                testID="invitation-remplacer"
                style={{ flexDirection: 'row', gap: ESPACEMENT.s, alignItems: 'center', minHeight: 44 }}>
                <Text style={{ fontSize: 20 }}>{remplacer ? '☑' : '☐'}</Text>
                <Text style={{ color: palette.texte, flex: 1 }}>
                  Ce navigateur contient déjà un autre compte : il sera retiré de ce navigateur (rien n’est effacé ailleurs). Je confirme.
                </Text>
              </Pressable>
            ) : null}
            {affichee ? (
              <View testID="invitation-erreur">
                <Alerte message={affichee} />
              </View>
            ) : null}
            {enCours ? (
              <View style={{ alignItems: 'center', gap: ESPACEMENT.s }}>
                <ActivityIndicator color={palette.accent} />
                <SousTitre>Création de ton accès (chiffrement sur cet appareil)…</SousTitre>
              </View>
            ) : (
              <Bouton pleineLargeur titre="Créer mon accès" desactive={!pret} onPress={valider} testID="invitation-valider" />
            )}
          </View>
        </>
      ) : affichee ? (
        <View testID="invitation-erreur">
          <Alerte message={affichee} />
        </View>
      ) : null}
      <Bouton titre="Revenir à l’accueil" variante="discret" onPress={onAccueil} testID="invitation-accueil" />
    </ScrollView>
  );
}

/** « Se connecter » (identifiant + mot de passe) et « J'ai une invitation ». */
export function BlocConnexion({
  relaisConnu,
  identifiantInitial,
  onConnexion,
  onInvitation,
}: {
  /** Faux : ce navigateur ne sait pas où est le serveur (message précis à l'envoi). */
  relaisConnu: boolean;
  identifiantInitial?: string;
  onConnexion(identifiant: string, motDePasse: string): Promise<void>;
  onInvitation(texte: string): Promise<void>;
}) {
  const palette = usePalette();
  const [identifiant, setIdentifiant] = useState(identifiantInitial ?? '');
  const [mdp, setMdp] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>();
  const [invitation, setInvitation] = useState('');
  const [erreurInvitation, setErreurInvitation] = useState<string | undefined>();
  const [ouvrant, setOuvrant] = useState(false);
  const connecter = () => {
    if (!identifiant.trim() || !mdp || enCours) return;
    setErreur(undefined);
    setEnCours(true);
    onConnexion(identifiant, mdp)
      .catch(e => setErreur(message(e)))
      .finally(() => setEnCours(false));
  };
  const ouvrir = () => {
    if (!invitation.trim() || ouvrant) return;
    setErreurInvitation(undefined);
    setOuvrant(true);
    onInvitation(invitation)
      .catch(e => setErreurInvitation(message(e)))
      .finally(() => setOuvrant(false));
  };
  return (
    <>
      <View style={[styles.cadre, { borderColor: palette.accent, backgroundColor: palette.surface }]} testID="connexion-identifiant">
        <Text style={{ color: palette.texte, fontWeight: '800', fontSize: 18 }}>🔑 Se connecter</Text>
        <Text style={{ color: palette.texteSecondaire }}>
          Ton identifiant (ton prénom) et le mot de passe que tu as choisi.{relaisConnu ? '' : ' Première fois ? Ouvre plutôt le lien d’invitation reçu.'}
        </Text>
        <Champ
          etiquette="Identifiant (prénom)"
          value={identifiant}
          onChangeText={setIdentifiant}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="username"
          textContentType="username"
          nature="identifiant"
          maxLength={40}
          testID="connexion-id-identifiant"
        />
        <ChampMotDePasse etiquette="Mot de passe" valeur={mdp} onChanger={setMdp} onValider={connecter} testID="connexion-id-mdp" desactive={enCours} />
        {erreur ? (
          <View testID="connexion-id-erreur">
            <Alerte message={erreur} />
          </View>
        ) : null}
        {enCours ? (
          <View style={{ alignItems: 'center', gap: ESPACEMENT.s }}>
            <ActivityIndicator color={palette.accent} />
            <SousTitre>Connexion…</SousTitre>
          </View>
        ) : (
          <Bouton pleineLargeur titre="Se connecter" desactive={!identifiant.trim() || !mdp} onPress={connecter} testID="connexion-id-valider" />
        )}
      </View>
      <View style={[styles.cadre, { borderColor: palette.bordure }]} testID="invitation-saisie-bloc">
        <Text style={{ color: palette.texte, fontWeight: '700', fontSize: 16 }}>✉️ J’ai reçu une invitation</Text>
        <Text style={{ color: palette.texteSecondaire }}>Colle le lien reçu (ou tape le code court, par exemple K7M2Q-9XH4T).</Text>
        <Champ
          etiquette="Lien ou code d’invitation"
          value={invitation}
          onChangeText={setInvitation}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          nature="codeLiaison"
          onSubmitEditing={ouvrir}
          testID="invitation-saisie"
        />
        {erreurInvitation ? (
          <View testID="invitation-saisie-erreur">
            <Alerte message={erreurInvitation} />
          </View>
        ) : null}
        <Bouton titre={ouvrant ? 'Vérification…' : 'Ouvrir l’invitation'} variante="discret" desactive={!invitation.trim() || ouvrant} onPress={ouvrir} testID="invitation-ouvrir" />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  cadre: { borderWidth: 1.5, borderRadius: RAYON.m, padding: ESPACEMENT.m, gap: ESPACEMENT.s, width: '100%', maxWidth: 560 },
});
