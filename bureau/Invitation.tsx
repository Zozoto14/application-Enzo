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
import { LIBELLES_FORCE, POLITIQUE_MDP_DEFAUT, evaluerMotDePasse, formeCanonique, type PolitiqueMdp } from '../src/profils/invitation';
import { useMobile } from '../src/ui/mobile/useMobile';

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
  // Téléphone : le champ a déjà son bouton « Afficher » (ChampMobile).
  const mobile = useMobile();
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
      {mobile ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          onPress={() => setVisible(v => !v)}
          testID={`${testID}-voir`}
          style={{ alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 4, minHeight: 36 }}>
          <Text style={{ color: palette.accent, fontWeight: '600' }}>{visible ? '🙈 Masquer' : '👁 Afficher'}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Barre de force et règles du nouveau mot de passe. */
function IndicateurForce({ motDePasse, prenom, politique = POLITIQUE_MDP_DEFAUT }: { motDePasse: string; prenom: string; politique?: PolitiqueMdp }) {
  const palette = usePalette();
  const e = evaluerMotDePasse(motDePasse, prenom, politique);
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
        {vide
          ? `Au moins ${politique.longueurMin} caractères${politique.forceMin > 1 ? `, force « ${LIBELLES_FORCE[politique.forceMin]} » au moins` : ''}. Une phrase facile à retenir est idéale.`
          : `Force : ${e.libelle}`}
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
  /** Politique du mot de passe réglée par le Fondateur (absente : règles de base). */
  politique?: PolitiqueMdp;
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
  const evaluation = evaluerMotDePasse(mdp, infos?.prenom ?? '', infos?.politique);
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
            <IndicateurForce motDePasse={mdp} prenom={infos.prenom} politique={infos.politique} />
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

/**
 * « Se connecter » (identifiant + mot de passe, pour TOUS : Fondateur compris), « Mot de passe
 * oublié » (code de récupération) et « J'ai une invitation ». Dès qu'on tape l'identifiant, l'hôte
 * applique le style de ce compte (`onIdentifiant`).
 */
export function BlocConnexion({
  relaisConnu,
  identifiantInitial,
  onConnexion,
  onInvitation,
  onSecours,
  onIdentifiant,
}: {
  /** Faux : ce navigateur ne sait pas où est le serveur (message précis à l'envoi). */
  relaisConnu: boolean;
  identifiantInitial?: string;
  /** `code` : code à six chiffres, quand le serveur l'a demandé (validation en deux étapes). */
  onConnexion(identifiant: string, motDePasse: string, code?: string): Promise<void>;
  onInvitation(texte: string): Promise<void>;
  onSecours?(identifiant: string, code: string, nouveau: string): Promise<void>;
  onIdentifiant?(identifiant: string): void;
}) {
  const palette = usePalette();
  // Téléphone : textes de 15 px au moins (lisibles sans zoom).
  const mobile = useMobile();
  const secondaire = { color: palette.texteSecondaire, ...(mobile ? { fontSize: 15, lineHeight: 21 } : {}) };
  const [identifiant, setIdentifiantBrut] = useState(identifiantInitial ?? '');
  const setIdentifiant = (v: string) => {
    setIdentifiantBrut(v);
    onIdentifiant?.(v);
  };
  React.useEffect(() => {
    if (identifiantInitial) onIdentifiant?.(identifiantInitial);
    // Une seule fois : l'identifiant retenu sur ce navigateur donne tout de suite son style.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [oubli, setOubli] = useState(false);
  const [code, setCode] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [mdp, setMdp] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>();
  const [invitation, setInvitation] = useState('');
  const [erreurInvitation, setErreurInvitation] = useState<string | undefined>();
  const [ouvrant, setOuvrant] = useState(false);
  // Validation en deux étapes : le serveur demande le code après un mot de passe juste.
  const [demandeCode, setDemandeCode] = useState(false);
  const [codeA2f, setCodeA2f] = useState('');
  const [aideAdmin, setAideAdmin] = useState(false);
  const [refuse, setRefuse] = useState(false);
  const codeValide = /^\d{6}$/.test(codeA2f.replace(/\s/g, ''));
  const connecter = () => {
    if (!identifiant.trim() || !mdp || enCours || (demandeCode && !codeValide)) return;
    setErreur(undefined);
    setEnCours(true);
    (demandeCode ? onConnexion(identifiant, mdp, codeA2f.replace(/\s/g, '')) : onConnexion(identifiant, mdp))
      .catch(e => {
        const code = (e as { code?: string })?.code;
        if (code === 'a2f-requis') {
          setDemandeCode(true);
          setCodeA2f('');
          return;
        }
        if (code === 'a2f-code') setCodeA2f('');
        setRefuse(code === 'mot-de-passe');
        setErreur(message(e));
      })
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
        <Text style={secondaire}>
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
        <ChampMotDePasse
          etiquette="Mot de passe"
          valeur={mdp}
          onChanger={v => {
            setMdp(v);
            setDemandeCode(false);
          }}
          onValider={connecter}
          testID="connexion-id-mdp"
          desactive={enCours}
        />
        {demandeCode ? (
          <View style={{ gap: ESPACEMENT.xs }} testID="connexion-id-a2f">
            <Text style={secondaire}>Validation en deux étapes : le code à six chiffres affiché par ton application d’authentification.</Text>
            <Champ
              etiquette="Code à six chiffres"
              value={codeA2f}
              onChangeText={setCodeA2f}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={7}
              autoFocus
              onSubmitEditing={connecter}
              testID="connexion-id-code"
            />
          </View>
        ) : null}
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
          <Bouton pleineLargeur titre="Se connecter" desactive={!identifiant.trim() || !mdp || (demandeCode && !codeValide)} onPress={connecter} testID="connexion-id-valider" />
        )}
        {/* Aide neutre (ne dit rien d'un compte en particulier) : le Fondateur active sa connexion par identifiant sur son PC. */}
        <Bouton titre="Administrateur : première connexion ?" variante="discret" onPress={() => setAideAdmin(a => !a)} testID="connexion-aide-admin" />
        {aideAdmin || refuse ? (
          <View style={{ gap: ESPACEMENT.xs }} testID="connexion-aide-admin-texte">
            <Text style={secondaire}>
              Administrateur (Fondateur) : ton identifiant n’existe sur le serveur qu’après l’avoir choisi sur ton PC. Tant que ce n’est pas fait, la connexion répond
              « Identifiant ou mot de passe incorrect ».
            </Text>
            <Text style={secondaire}>
              1. Sur ton PC, ouvre AppDashboard à jour et déverrouille-le comme d’habitude (mot de passe et code à six chiffres).{'\n'}2. L’écran « Se connecter
              partout avec un identifiant » s’ouvre seul (sinon : Paramètres › Sécurité › Identifiant et mot de passe de connexion) : choisis ton identifiant et
              ton mot de passe.{'\n'}3. Ici : cet identifiant, ce mot de passe, puis le code à six chiffres de ton application d’authentification.
            </Text>
          </View>
        ) : null}
        {onSecours && !oubli ? (
          <Bouton titre="Mot de passe oublié ?" variante="discret" onPress={() => setOubli(true)} testID="connexion-oubli" />
        ) : null}
        {onSecours && oubli ? (
          <View style={{ gap: ESPACEMENT.s }} testID="connexion-secours">
            <Text style={{ color: palette.texte, fontWeight: '700' }}>Mot de passe oublié</Text>
            <Text style={secondaire}>
              Ton identifiant ci-dessus, un de tes codes de récupération (notés sur papier ; chacun ne sert qu’une fois) et ton nouveau mot de passe. Ami :
              demande plutôt au Fondateur de réinitialiser ton accès.
            </Text>
            <Champ etiquette="Code de récupération" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} spellCheck={false} testID="connexion-secours-code" />
            <ChampMotDePasse etiquette="Nouveau mot de passe" valeur={nouveau} onChanger={setNouveau} nouveau testID="connexion-secours-mdp" desactive={enCours} />
            <ChampMotDePasse etiquette="Confirme le nouveau mot de passe" valeur={confirmation} onChanger={setConfirmation} nouveau testID="connexion-secours-confirmation" desactive={enCours} />
            <Bouton
              pleineLargeur
              titre="Ouvrir mon compte avec ce code"
              desactive={enCours || !identifiant.trim() || code.trim().length < 8 || !evaluerMotDePasse(nouveau, identifiant).valide || formeCanonique(confirmation) !== formeCanonique(nouveau)}
              onPress={() => {
                setErreur(undefined);
                setEnCours(true);
                onSecours(identifiant, code, nouveau)
                  .catch(e => setErreur(message(e)))
                  .finally(() => setEnCours(false));
              }}
              testID="connexion-secours-valider"
            />
          </View>
        ) : null}
      </View>
      <View style={[styles.cadre, { borderColor: palette.bordure }]} testID="invitation-saisie-bloc">
        <Text style={{ color: palette.texte, fontWeight: '700', fontSize: 16 }}>✉️ J’ai reçu une invitation</Text>
        <Text style={secondaire}>Colle le lien reçu (ou tape le code court, par exemple K7M2Q-9XH4T).</Text>
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
