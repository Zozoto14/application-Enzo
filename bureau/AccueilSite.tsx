/**
 * Premier lancement sur un navigateur (site, téléphone) : on SE CONNECTE avec son identifiant et
 * son mot de passe — le Fondateur comme ses amis (relais version 9). Plus de code de liaison :
 * « J'ai reçu une invitation » reste pour la première connexion d'un invité, « Mot de passe
 * oublié » ouvre le compte avec un code de récupération. Créer un nouveau coffre ne vient
 * qu'en dernier, avec un avertissement.
 *
 * Deuxième écran (`RemplacerDonnees`) : ce navigateur contient déjà un coffre (créé ici
 * autrefois) et l'on se connecte à un autre compte. On propose d'abord d'en télécharger une
 * sauvegarde, puis de remplacer les données du navigateur — jamais sans confirmation.
 */

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Alerte, Bouton, SousTitre, Titre, usePalette } from '../src/ui/composants';
import { ESPACEMENT, RAYON, stylesPartages } from '../src/ui/theme';
import { BoutonPrincipal } from '../src/ui/mobile/BoutonPrincipal';
import { EcranMobile } from '../src/ui/mobile/EcranMobile';
import { FeuilleBasse } from '../src/ui/mobile/FeuilleBasse';
import { Cellule, GroupeCellules } from '../src/ui/mobile/ListeCellules';
import { useMobile } from '../src/ui/mobile/useMobile';
import { BlocConnexion } from './Invitation';

/** Connexion (identifiant + mot de passe, pour tous), mot de passe oublié, invitation collée. */
export interface OptionsConnexionAccueil {
  relaisConnu: boolean;
  identifiantInitial?: string;
  onConnexion(identifiant: string, motDePasse: string): Promise<void>;
  onInvitation(texte: string): Promise<void>;
  /** « Mot de passe oublié » : identifiant, un code de récupération et le nouveau mot de passe. */
  onSecours?(identifiant: string, code: string, nouveau: string): Promise<void>;
  /** L'identifiant tapé change : l'hôte applique le style de ce compte (nom du thème seulement). */
  onIdentifiant?(identifiant: string): void;
}

function message(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}

export function AccueilSite({ erreur: erreurInitiale, onCreer, connexion }: { erreur?: string; onCreer(): void; connexion: OptionsConnexionAccueil }) {
  const palette = usePalette();
  const [creer, setCreer] = useState(false);
  const mobile = useMobile();
  const avertissement = (
    <Text style={{ color: palette.danger, fontSize: mobile ? 16 : undefined, lineHeight: mobile ? 23 : undefined }} testID="accueil-avertissement">
      ⚠️ Ce coffre sera NEUF et indépendant : il ne contiendra aucune de vos données, et il ne s’ouvrira pas avec votre identifiant. Si vous avez déjà un
      compte, connectez-vous plutôt.
    </Text>
  );

  if (mobile) {
    return (
      <EcranMobile testID="accueil-site">
        <Titre>Bienvenue sur AppDashboard</Titre>
        <SousTitre>Connecte-toi avec ton identifiant et ton mot de passe, ou ouvre ton invitation.</SousTitre>
        <BlocConnexion {...connexion} />
        {erreurInitiale ? <Alerte message={erreurInitiale} /> : null}
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
          {avertissement}
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
      <SousTitre>Connecte-toi avec ton identifiant et ton mot de passe : tes apps et tes données sont sur le serveur, chiffrées.</SousTitre>
      <BlocConnexion {...connexion} />
      {erreurInitiale ? <Alerte message={erreurInitiale} /> : null}
      <View style={[styles.cadre, { borderColor: palette.bordure }]}>
        {creer ? (
          <>
            <Text style={{ color: palette.texte, fontWeight: '700' }}>Créer un nouveau coffre ?</Text>
            {avertissement}
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
          L’ancien coffre et tout ce qu’il contient sont effacés de ce navigateur ; votre compte s’ouvre ensuite avec votre identifiant et votre mot de
          passe.
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
