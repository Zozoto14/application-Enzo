/**
 * Premier lancement sur un navigateur (site, téléphone) : on RELIE d'abord
 * son compte existant ; créer un nouveau coffre ne vient qu'en second, avec
 * un avertissement.
 *
 * Deuxième écran : ce navigateur contient déjà un coffre (créé ici
 * autrefois) et l'on relie son compte. On propose d'abord d'en télécharger
 * une sauvegarde, puis de remplacer les données du navigateur par celles du
 * compte relié — jamais sans confirmation.
 */

import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Alerte, Bouton, Champ, SousTitre, Titre, usePalette } from '../src/ui/composants';
import { ESPACEMENT, RAYON, stylesPartages } from '../src/ui/theme';
import { BoutonPrincipal } from '../src/ui/mobile/BoutonPrincipal';
import { EcranMobile } from '../src/ui/mobile/EcranMobile';
import { FeuilleBasse } from '../src/ui/mobile/FeuilleBasse';
import { Cellule, GroupeCellules } from '../src/ui/mobile/ListeCellules';
import { useMobile } from '../src/ui/mobile/useMobile';

function message(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}

export function AccueilSite({
  codeConnu,
  erreur: erreurInitiale,
  onRelier,
  onCreer,
}: {
  /** Code apporté par un lien `#liaison=` : rien à recopier. */
  codeConnu?: string;
  erreur?: string;
  onRelier(code: string): Promise<void>;
  onCreer(): void;
}) {
  const palette = usePalette();
  const [code, setCode] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>(erreurInitiale);
  const [creer, setCreer] = useState(false);
  const utilise = code.trim() || codeConnu || '';
  const mobile = useMobile();

  const relier = () => {
    setErreur(undefined);
    setEnCours(true);
    onRelier(utilise)
      .catch(e => setErreur(message(e)))
      .finally(() => setEnCours(false));
  };

  if (mobile) {
    // Téléphone : relier est l'action principale (bouton collant) ; créer un coffre neuf passe par une
    // feuille basse qui porte l'avertissement.
    return (
      <EcranMobile
        testID="accueil-site"
        pied={<BoutonPrincipal titre="Relier ce navigateur" desactive={!utilise} enCours={enCours} onPress={relier} testID="bouton-relier-accueil" />}>
        <Titre>Bienvenue sur AppDashboard</Titre>
        <SousTitre>Retrouvez votre compte : même prénom, même mot de passe et même code qu’ailleurs.</SousTitre>
        <GroupeCellules titre="J’ai déjà un compte" note="Administrateur : le code de liaison de votre PC (Paramètres › Synchronisation › Appareils liés › Relier un autre appareil). Ami : le code de connexion envoyé par l’administrateur. Il commence par AB1. et ne se saisit qu’une fois.">
          {codeConnu ? (
            <Cellule titre="Code de liaison reçu par le lien" sousTitre="Rien à recopier." glyphe="✓" teinte={palette.hausse} testID="accueil-code-connu" />
          ) : (
            <View style={{ padding: ESPACEMENT.m }}>
              <Champ etiquette="Code de liaison" placeholder="AB1.…" value={code} onChangeText={setCode} nature="codeLiaison" onSubmitEditing={relier} testID="champ-code-accueil" />
            </View>
          )}
        </GroupeCellules>
        {erreur ? <Alerte message={erreur} /> : null}
        {enCours ? <SousTitre>Recherche du compte sur le relais…</SousTitre> : null}
        <GroupeCellules>
          <Cellule titre="Je n’ai pas de compte" sousTitre="Créer un nouveau coffre sur ce navigateur." glyphe="+" chevron onPress={() => setCreer(true)} testID="accueil-creer" />
        </GroupeCellules>
        <FeuilleBasse
          visible={creer}
          titre="Créer un nouveau coffre ?"
          onFermer={() => setCreer(false)}
          testID="feuille-creer-coffre"
          pied={
            <>
              <BoutonPrincipal titre="Oui, créer un nouveau coffre" variante="danger" onPress={onCreer} testID="accueil-creer-confirmer" />
              <BoutonPrincipal titre="Annuler" variante="discret" onPress={() => setCreer(false)} />
            </>
          }>
          <Text style={{ color: palette.danger, fontSize: 16, lineHeight: 23 }} testID="accueil-avertissement">
            ⚠️ Ce coffre sera NEUF et indépendant : il ne contiendra ni votre portefeuille du PC, ni les comptes de vos amis,
            et il ne s’ouvrira pas avec les identifiants de votre PC. Si vous avez déjà un compte, reliez-le plutôt.
          </Text>
        </FeuilleBasse>
      </EcranMobile>
    );
  }

  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palette.fond }]}
      contentContainerStyle={[stylesPartages.contenu, stylesPartages.accueil, { paddingVertical: ESPACEMENT.xl, gap: ESPACEMENT.m }]}
      keyboardShouldPersistTaps="handled"
      testID="accueil-site">
      <Titre>Bienvenue sur AppDashboard</Titre>
      <SousTitre>Sur ce navigateur, rien n’est encore installé. Retrouvez votre compte, avec le même prénom, le même mot de passe et le même code qu’ailleurs.</SousTitre>

      <View style={[styles.cadre, { borderColor: palette.accent, backgroundColor: palette.surface }]}>
        <Text style={{ color: palette.texte, fontWeight: '800', fontSize: 18 }}>🔗 J’ai déjà un compte (le relier)</Text>
        <Text style={{ color: palette.texteSecondaire }}>
          Administrateur : le code de liaison de votre PC (Paramètres › Synchronisation › Appareils liés › Relier un autre appareil). Ami : le code
          de connexion que l’administrateur vous a envoyé. Il commence par AB1. et ne se saisit qu’une fois.
        </Text>
        {codeConnu ? (
          <Text style={{ color: palette.hausse, fontWeight: '600' }} testID="accueil-code-connu">
            ✅ Code de liaison reçu par le lien : rien à recopier.
          </Text>
        ) : (
          <Champ
            etiquette="Code de liaison"
            placeholder="AB1.…"
            value={code}
            onChangeText={setCode}
            autoCapitalize="none"
            autoCorrect={false}
            testID="champ-code-accueil"
          />
        )}
        {erreur ? <Alerte message={erreur} /> : null}
        {enCours ? (
          <View style={{ alignItems: 'center', gap: ESPACEMENT.s }}>
            <ActivityIndicator color={palette.accent} />
            <SousTitre>Recherche du compte sur le relais…</SousTitre>
          </View>
        ) : (
          <Bouton pleineLargeur titre="Relier ce navigateur" desactive={!utilise} onPress={relier} testID="bouton-relier-accueil" />
        )}
      </View>

      <View style={[styles.cadre, { borderColor: palette.bordure }]}>
        {creer ? (
          <>
            <Text style={{ color: palette.texte, fontWeight: '700' }}>Créer un nouveau coffre ?</Text>
            <Text style={{ color: palette.danger }} testID="accueil-avertissement">
              ⚠️ Ce coffre sera NEUF et indépendant : il ne contiendra ni votre portefeuille du PC, ni les comptes de vos amis,
              et il ne s’ouvrira pas avec les identifiants de votre PC. Si vous avez déjà un compte, reliez-le plutôt.
            </Text>
            <View style={{ flexDirection: 'row', gap: ESPACEMENT.s, flexWrap: 'wrap' }}>
              <Bouton titre="Oui, créer un nouveau coffre" variante="discret" onPress={onCreer} testID="accueil-creer-confirmer" />
              <Bouton titre="Annuler" variante="discret" onPress={() => setCreer(false)} />
            </View>
          </>
        ) : (
          <Bouton titre="Je n’ai pas de compte : créer un nouveau coffre" variante="discret" pleineLargeur onPress={() => setCreer(true)} testID="accueil-creer" />
        )}
      </View>
    </ScrollView>
  );
}

export function RemplacerDonnees({
  compte,
  onExporter,
  onRemplacer,
  onAnnuler,
}: {
  /** « votre compte du PC » ou « le compte de Léa ». */
  compte: string;
  onExporter(): Promise<boolean>;
  onRemplacer(): Promise<void>;
  onAnnuler(): void;
}) {
  const palette = usePalette();
  const [exporte, setExporte] = useState(false);
  const [sansSauvegarde, setSansSauvegarde] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>();

  const agir = (action: () => Promise<unknown>) => {
    setErreur(undefined);
    setEnCours(true);
    action()
      .catch(e => setErreur(message(e)))
      .finally(() => setEnCours(false));
  };

  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palette.fond }]}
      contentContainerStyle={[stylesPartages.contenu, stylesPartages.accueil, { paddingVertical: ESPACEMENT.xl, gap: ESPACEMENT.m }]}
      testID="remplacer-donnees">
      <Titre>Ce navigateur contient déjà un coffre</Titre>
      <SousTitre>
        Il a été créé ici auparavant et ne s’ouvre pas avec les identifiants de {compte}. Pour utiliser {compte} sur ce
        navigateur, ses données remplacent celles d’ici.
      </SousTitre>
      <View style={[styles.cadre, { borderColor: palette.accent, backgroundColor: palette.surface }]}>
        <Text style={{ color: palette.texte, fontWeight: '700' }}>1. Sauvegarder l’ancien coffre (conseillé)</Text>
        <Text style={{ color: palette.texteSecondaire }}>
          Un fichier avec l’ancien coffre et ses données chiffrées, tels quels : il ne s’ouvre qu’avec l’ancien mot de passe.
        </Text>
        <Bouton
          titre={exporte ? '✅ Sauvegarde téléchargée' : 'Télécharger une sauvegarde de l’ancien coffre'}
          variante="discret"
          desactive={enCours}
          onPress={() => agir(async () => setExporte(await onExporter()))}
          testID="remplacer-exporter"
        />
        {!exporte ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESPACEMENT.s }}>
            <Switch value={sansSauvegarde} onValueChange={setSansSauvegarde} testID="remplacer-sans-sauvegarde" />
            <Text style={{ color: palette.texte, flex: 1 }}>Je n’ai pas besoin de sauvegarde</Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.cadre, { borderColor: palette.danger }]}>
        <Text style={{ color: palette.texte, fontWeight: '700' }}>2. Remplacer</Text>
        <Text style={{ color: palette.texteSecondaire }}>
          L’ancien coffre et tout ce qu’il contient sont effacés de ce navigateur ; vous vous connectez ensuite exactement comme
          sur le PC (prénom, mot de passe, code).
        </Text>
        {erreur ? <Alerte message={erreur} /> : null}
        <Bouton
          pleineLargeur
          titre={`Remplacer les données de ce navigateur par celles de ${compte}`}
          desactive={enCours || !(exporte || sansSauvegarde)}
          onPress={() => agir(onRemplacer)}
          testID="remplacer-confirmer"
        />
        <Bouton titre="Annuler (garder l’ancien coffre)" variante="discret" desactive={enCours} onPress={onAnnuler} testID="remplacer-annuler" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  cadre: { borderWidth: 1.5, borderRadius: RAYON.m, padding: ESPACEMENT.m, gap: ESPACEMENT.s, width: '100%', maxWidth: 560 },
});
