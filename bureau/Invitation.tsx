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
import { ChampMotDePasse, SaisieNouveauMotDePasse, useLangueSaisie } from '../src/ui/motDePasse/SaisieMotDePasse';
import { texteEcran, type LangueSaisie } from '../src/ui/motDePasse/textes';
import { ESPACEMENT, RAYON, stylesPartages } from '../src/ui/theme';
import { evaluerMotDePasse, formeCanonique, type PolitiqueMdp } from '../src/profils/invitation';
import { useMobile } from '../src/ui/mobile/useMobile';
import { Icone } from '../src/ui/icones';

function message(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}

export { ChampMotDePasse };

export interface InfosInvitation {
  prenom: string;
  fondateur?: string;
  expire: string;
  /** Politique du mot de passe réglée par le Fondateur (absente : règles de base). */
  politique?: PolitiqueMdp;
  /** Langue de l'invitation (« fr » ou « en ») ; absente : celle du compte, puis de l'appareil. */
  langue?: LangueSaisie;
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
  const l = useLangueSaisie(infos?.langue);
  const evaluation = evaluerMotDePasse(mdp, infos?.prenom ?? '', infos?.politique);
  const pret = Boolean(infos) && evaluation.valide && formeCanonique(confirmation) === formeCanonique(mdp) && (!autreCompteIci || remplacer) && !enCours;
  const valider = () => {
    if (!pret) return;
    setErreur(undefined);
    setEnCours(true);
    onAccepter(mdp)
      .catch(e => setErreur(message(e)))
      .finally(() => setEnCours(false));
  };
  const jour = infos ? new Date(infos.expire).toLocaleDateString(l === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palette.fond }]}
      contentContainerStyle={[stylesPartages.contenu, stylesPartages.accueil, { paddingVertical: ESPACEMENT.xl, gap: ESPACEMENT.m }]}
      keyboardShouldPersistTaps="handled"
      testID="invitation-ecran">
      <Titre>{infos ? texteEcran(l, 'inv.bienvenue', { prenom: infos.prenom }) : texteEcran(l, 'inv.titre')}</Titre>
      {chargement && !infos ? (
        <View style={{ alignItems: 'center', gap: ESPACEMENT.s }}>
          <ActivityIndicator color={palette.accent} />
          <SousTitre>{texteEcran(l, 'inv.verification')}</SousTitre>
        </View>
      ) : null}
      {infos ? (
        <>
          <SousTitre>
            {infos.fondateur ? texteEcran(l, 'inv.intro.avec', { fondateur: infos.fondateur }) : texteEcran(l, 'inv.intro.sans')} {texteEcran(l, 'inv.intro.suite', { jour })}
          </SousTitre>
          <View style={[styles.cadre, { borderColor: palette.accent, backgroundColor: palette.surface }]}>
            <Text style={{ color: palette.texteSecondaire }}>{texteEcran(l, 'inv.identifiant')}</Text>
            <Text style={{ color: palette.texte, fontWeight: '800', fontSize: 22 }} testID="invitation-identifiant" selectable>
              {infos.prenom}
            </Text>
            <Text style={{ color: palette.texteSecondaire, fontSize: 13 }}>{texteEcran(l, 'inv.identifiant.note')}</Text>
            {/* Gestionnaire de mots de passe : l'identifiant accompagne le nouveau mot de passe. */}
            <TextInput value={infos.prenom} editable={false} autoComplete="username" textContentType="username" style={{ height: 1, width: 1, opacity: 0, padding: 0 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="invitation-identifiant-cache" />
            <SaisieNouveauMotDePasse
              profil="ami"
              valeur={mdp}
              onChanger={setMdp}
              confirmation={confirmation}
              onChangerConfirmation={setConfirmation}
              etiquette={texteEcran(l, 'inv.mdp')}
              etiquetteConfirmation={texteEcran(l, 'inv.confirmation')}
              identifiant={infos.prenom}
              politique={infos.politique}
              langue={l}
              desactive={enCours}
              onValider={valider}
              testIDs={{ mdp: 'invitation-mdp', confirmation: 'invitation-mdp-confirmation' }}
              prefixe="invitation"
            />
            {autreCompteIci ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: remplacer }}
                onPress={() => setRemplacer(v => !v)}
                testID="invitation-remplacer"
                style={{ flexDirection: 'row', gap: ESPACEMENT.s, alignItems: 'center', minHeight: 44 }}>
                <Text style={{ fontSize: 20 }}>{remplacer ? '☑︎' : '☐'}</Text>
                <Text style={{ color: palette.texte, flex: 1 }}>
                  {texteEcran(l, 'inv.remplacer')}
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
                <SousTitre>{texteEcran(l, 'inv.creation')}</SousTitre>
              </View>
            ) : (
              <Bouton pleineLargeur titre={texteEcran(l, 'inv.valider')} desactive={!pret} onPress={valider} testID="invitation-valider" />
            )}
          </View>
        </>
      ) : affichee ? (
        <View testID="invitation-erreur">
          <Alerte message={affichee} />
        </View>
      ) : null}
      <Bouton titre={texteEcran(l, 'inv.accueil')} variante="discret" onPress={onAccueil} testID="invitation-accueil" />
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
  const ls = useLangueSaisie();
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
        <Text style={{ color: palette.texte, fontWeight: '800', fontSize: 18 }}><Icone nom="cle" /> Se connecter</Text>
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
            <Text style={{ color: palette.texte, fontWeight: '700' }}>{texteEcran(ls, 'secours.titre')}</Text>
            <Text style={secondaire}>{texteEcran(ls, 'secours.intro')}</Text>
            <Champ etiquette={texteEcran(ls, 'secours.code')} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} spellCheck={false} testID="connexion-secours-code" />
            <SaisieNouveauMotDePasse
              profil="ami"
              valeur={nouveau}
              onChanger={setNouveau}
              confirmation={confirmation}
              onChangerConfirmation={setConfirmation}
              etiquette={texteEcran(ls, 'secours.mdp')}
              etiquetteConfirmation={texteEcran(ls, 'secours.confirmation')}
              identifiant={identifiant}
              langue={ls}
              desactive={enCours}
              testIDs={{ mdp: 'connexion-secours-mdp', confirmation: 'connexion-secours-confirmation' }}
              prefixe="connexion-secours"
            />
            <Bouton
              pleineLargeur
              titre={texteEcran(ls, 'secours.valider')}
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
        <Text style={{ color: palette.texte, fontWeight: '700', fontSize: 16 }}>✉︎ J’ai reçu une invitation</Text>
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
