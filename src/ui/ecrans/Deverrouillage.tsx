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
 *    Une erreur TECHNIQUE (clé impossible à calculer) a son propre message.
 *
 *  - **Le compte à rebours avance tout seul**, et un double appui (ou Entrée
 *    puis clic) n'envoie qu'une tentative.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Text, View, useColorScheme } from 'react-native';
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
  /** Appelé quand le compte à rebours arrive à zéro (l'hôte se redessine). */
  onFinTemporisation?: () => void;
  /** Horloge de l'appareil décalée par rapport au relais (message déjà rédigé). */
  avisHorloge?: string;
  /** Texte du diagnostic (sans secret), calculé à la demande. */
  diagnostic?: () => Promise<string>;
}

/** Le code saisi ou collé, réduit à six chiffres (« 123 456 », chiffres pleine chasse). */
export function chiffresDuCode(saisi: string): string {
  return saisi.normalize('NFKC').replace(/\D/g, '').slice(0, 6);
}

/** Sans retour de l'hôte (enCours), un second appui redevient possible après ce délai. */
const ANTI_REBOND_MS = 1500;

export function Deverrouillage({
  onDeverrouiller,
  onRecuperer,
  erreur,
  secondesAvantNouvelEssai = 0,
  enCours = false,
  lier,
  message,
  suggererAutreCoffre = false,
  onFinTemporisation,
  avisHorloge,
  diagnostic,
}: DeverrouillageProps) {
  const [montrerLier, setMontrerLier] = useState(false);
  const [motDePasse, setMotDePasse] = useState('');
  const [code, setCode] = useState('');
  const palette = usePalette();
  const sombre = useColorScheme() === 'dark';

  // Compte à rebours local : sans lui, « 1 seconde » restait figé (et le
  // bouton grisé) jusqu'au prochain rendu de l'hôte.
  const [restant, setRestant] = useState(secondesAvantNouvelEssai);
  const finTempo = useRef(onFinTemporisation);
  finTempo.current = onFinTemporisation;
  useEffect(() => {
    setRestant(secondesAvantNouvelEssai);
    if (secondesAvantNouvelEssai <= 0) return undefined;
    const fin = Date.now() + secondesAvantNouvelEssai * 1000;
    const minuterie = setInterval(() => {
      const r = Math.max(0, Math.ceil((fin - Date.now()) / 1000));
      setRestant(r);
      if (r === 0) {
        clearInterval(minuterie);
        finTempo.current?.();
      }
    }, 250);
    return () => clearInterval(minuterie);
  }, [secondesAvantNouvelEssai, erreur]);

  // Double soumission : un appui est ignoré tant que le précédent n'a pas été
  // pris en charge (l'hôte passe enCours à vrai puis à faux) ; filet de 1,5 s
  // pour un hôte qui ne signale rien.
  const envoiEnCours = useRef(false);
  useEffect(() => {
    if (!enCours) envoiEnCours.current = false;
  }, [enCours, erreur]);
  const [diag, setDiag] = useState<string | undefined>();
  const [diagOuvert, setDiagOuvert] = useState(false);
  const [copie, setCopie] = useState<string | undefined>();

  const verrouille = restant > 0;
  const complet = motDePasse.length > 0 && code.length === 6;
  const espacesAutour = motDePasse.length > 0 && motDePasse !== motDePasse.trim();

  const mobile = useMobile();
  const deverrouiller = () => {
    if (!complet || enCours || verrouille || envoiEnCours.current) return;
    envoiEnCours.current = true;
    setTimeout(() => {
      envoiEnCours.current = false;
    }, ANTI_REBOND_MS);
    onDeverrouiller(motDePasse, code);
  };

  const ouvrirDiagnostic = () => {
    const ouvrir = !diagOuvert;
    setDiagOuvert(ouvrir);
    setCopie(undefined);
    if (ouvrir && diagnostic) {
      setDiag('Mesure en cours…');
      diagnostic()
        .then(setDiag)
        .catch(() => setDiag('Diagnostic indisponible.'));
    }
  };
  const copierDiagnostic = () => {
    const presse = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard;
    if (!presse || !diag) {
      setCopie('Copie impossible ici : sélectionnez le texte ci-dessus.');
      return;
    }
    presse.writeText(diag).then(
      () => setCopie('Diagnostic copié : collez-le dans votre message au support.'),
      () => setCopie('Copie impossible ici : sélectionnez le texte ci-dessus.'),
    );
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
      onPress={deverrouiller}
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
          {diagnostic ? (
            <View style={{ gap: ESPACEMENT.s, alignItems: 'center' }}>
              <Text
                accessibilityRole="button"
                accessibilityLabel="Diagnostic du déverrouillage"
                onPress={ouvrirDiagnostic}
                testID="lien-diagnostic"
                // Discret sur le bureau ; sur téléphone, cible tactile de 44 px et texte lisible.
                style={[
                  { color: palette.texteSecondaire, textDecorationLine: 'underline', fontSize: 13, padding: ESPACEMENT.s },
                  mobile ? { fontSize: TEXTE.legende, minHeight: 44, minWidth: 44, paddingVertical: 12, textAlign: 'center' } : null,
                ]}>
                Diagnostic
              </Text>
              {diagOuvert ? (
                <View style={{ gap: ESPACEMENT.s, alignSelf: 'stretch' }} testID="panneau-diagnostic">
                  <Text selectable style={{ color: palette.texte, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: mobile ? TEXTE.legende : 12 }} testID="texte-diagnostic">
                    {diag}
                  </Text>
                  <SousTitre>Aucun secret : ni mot de passe, ni code, ni identifiant de compte.</SousTitre>
                  <Bouton titre="Copier le diagnostic" variante="discret" pleineLargeur onPress={copierDiagnostic} testID="copier-diagnostic" />
                  {copie ? <SousTitre>{copie}</SousTitre> : null}
                </View>
              ) : null}
            </View>
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
        spellCheck={false}
        editable={!enCours && !verrouille}
        textContentType="password"
        autoComplete="current-password"
        nature="motDePasse"
        enterKeyHint="next"
        indication={
          espacesAutour
            ? 'Espace ou retour à la ligne au début ou à la fin : le mot de passe sera aussi essayé sans.'
            : 'Un mot de passe long se colle depuis votre gestionnaire ; il n’a pas besoin d’être tapé.'
        }
      />

      <Champ
        etiquette="Code d'authentification"
        value={code}
        onChangeText={texte => setCode(chiffresDuCode(texte))}
        keyboardType="number-pad"
        // Six chiffres gardés par chiffresDuCode : une limite à 6 tronquait « 123 456 » collé en « 123 45 ».
        maxLength={12}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'web' ? ('one-time-code' as never) : 'sms-otp'}
        nature="codeTotp"
        enterKeyHint="go"
        onSubmitEditing={deverrouiller}
        editable={!enCours && !verrouille}
        indication="Les six chiffres affichés par votre application d'authentification."
      />

      {erreur ? <Alerte message={erreur} /> : null}
      {avisHorloge ? (
        <View testID="avis-horloge">
          <Alerte message={avisHorloge} />
        </View>
      ) : null}
      {erreur && suggererAutreCoffre && lier?.codeConnu && !montrerLier ? (
        <View style={{ gap: ESPACEMENT.s }} testID="suggestion-autre-coffre">
          <Text style={{ color: palette.texte, fontWeight: '600', fontSize: mobile ? TEXTE.legende : undefined }}>
            Ce navigateur contient peut-être un autre coffre que celui de ton PC : relier mon compte.
          </Text>
          <Bouton titre="Relier mon compte" variante="discret" pleineLargeur onPress={() => setMontrerLier(true)} testID="reprendre-coffre" />
        </View>
      ) : null}

      {verrouille ? (
        <Alerte
          message={`Trop de tentatives. Nouvel essai possible dans ${restant} seconde${restant > 1 ? 's' : ''}.`}
        />
      ) : null}

    </EcranEntree>
  );
}
