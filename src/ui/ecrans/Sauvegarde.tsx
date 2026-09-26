/**
 * Sauvegarde et restauration.
 *
 * Deux gestes aux conséquences très différentes, et l'écran le montre : créer
 * une sauvegarde ne coûte rien, en restaurer une **efface tout le contenu
 * actuel**. D'où la confirmation explicite avant restauration, et le rappel
 * de ce que l'archive contient — obtenu de son en-tête, sans déchiffrement.
 */

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { Actions, Alerte, Bouton, Carte, Champ, SousTitre, Titre, usePalette } from '../composants';
import { Explication } from '../indicateurs';
import { ESPACEMENT, palettePour, stylesPartages } from '../theme';
import type { SauvegardeSurDisque } from '../../sauvegarde/fichiers';

export interface SauvegardeProps {
  /** Faux si le module de fichiers n'est pas dans le binaire. */
  disponible: boolean;
  /** Dossier où sont rangées les sauvegardes (ordinateur). */
  emplacement?: string;
  onOuvrirDossier?(): void;
  sauvegardes: readonly SauvegardeSurDisque[];
  onCreer(motDePasse: string): void;
  onRestaurer(chemin: string, motDePasse: string): void;
  /** Reprend les nouveautés de l'archive sans rien effacer. */
  onFusionner?(chemin: string, motDePasse: string): void;
  onSupprimer?(chemin: string): void;
  onRetour(): void;
  message?: string;
  erreur?: string;
  enCours?: boolean;
}

const LONGUEUR_MINIMALE = 12;

export function Sauvegarde({
  disponible,
  emplacement,
  onOuvrirDossier,
  sauvegardes,
  onCreer,
  onRestaurer,
  onFusionner,
  onSupprimer,
  onRetour,
  message,
  erreur,
  enCours = false,
}: SauvegardeProps) {
  const sombre = useColorScheme() === 'dark';
  const palette = usePalette();

  const [motDePasse, setMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [motDePasseRestauration, setMotDePasseRestauration] = useState('');
  const [aRestaurer, setARestaurer] = useState<SauvegardeSurDisque | undefined>();
  const [aFusionner, setAFusionner] = useState<SauvegardeSurDisque | undefined>();

  const tropCourt = motDePasse.length < LONGUEUR_MINIMALE;
  const discordant = confirmation.length > 0 && confirmation !== motDePasse;
  const peutCreer = !tropCourt && !discordant && confirmation === motDePasse;

  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palettePour(sombre).fond }]}
      contentContainerStyle={[stylesPartages.contenu, stylesPartages.formulaire, { paddingTop: ESPACEMENT.l }]}
      keyboardShouldPersistTaps="handled">
      <Titre>Sauvegarde</Titre>

      {!disponible ? (
        <Carte>
          <Text style={{ color: palette.danger, fontWeight: '600' }}>
            Indisponible sur cette version
          </Text>
          <SousTitre>
            Le module d'accès aux fichiers n'est pas présent dans l'application.
            La sauvegarde exige un nouveau build.
          </SousTitre>
        </Carte>
      ) : null}

      {disponible && emplacement ? (
        <Carte>
          <SousTitre>Vos sauvegardes chiffrées sont rangées dans :</SousTitre>
          <Text selectable style={{ color: palette.texte, fontWeight: '600' }} testID="emplacement-sauvegardes">
            {emplacement}
          </Text>
          <SousTitre>
            Copiez-les sur une clé USB ou laissez OneDrive les synchroniser : une sauvegarde qui reste sur le
            même disque ne protège pas d’une panne de l’ordinateur.
          </SousTitre>
          {onOuvrirDossier ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <Bouton titre="Ouvrir le dossier" variante="discret" onPress={onOuvrirDossier} />
            </View>
          ) : null}
        </Carte>
      ) : null}

      {message ? (
        <Carte>
          <Text accessibilityLiveRegion="polite" style={{ color: palette.texte }}>
            {message}
          </Text>
        </Carte>
      ) : null}

      {erreur ? <Alerte message={erreur} /> : null}

      {/* --- Création --- */}
      <Carte>
        <View style={styles.enTete}>
          <Text style={[styles.sectionTitre, { color: palette.texte }]}>
            Créer une sauvegarde
          </Text>
        </View>
        <SousTitre>
          Vos codes de récupération protègent votre clé, pas vos données. Sans
          sauvegarde, un téléphone perdu emporte tout le portefeuille avec lui.
        </SousTitre>

        <Champ
          etiquette="Mot de passe de la sauvegarde"
          value={motDePasse}
          onChangeText={setMotDePasse}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={disponible && !enCours}
          textContentType="newPassword"
          indication="Il peut différer de celui de l'application. Une sauvegarde doit rester lisible même après un changement de mot de passe."
        />

        <Champ
          etiquette="Confirmation"
          value={confirmation}
          onChangeText={setConfirmation}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={disponible && !enCours}
          textContentType="newPassword"
        />

        {discordant ? <Alerte message="Les deux saisies diffèrent." /> : null}

        <Bouton
          titre={enCours ? 'Chiffrement en cours…' : 'Créer la sauvegarde'}
          testID="bouton-creer-sauvegarde"
          desactive={!disponible || !peutCreer || enCours}
          onPress={() => onCreer(motDePasse)}
        />
      </Carte>

      {/* --- Restauration --- */}
      <Carte>
        <Text style={[styles.sectionTitre, { color: palette.texte }]}>
          Sauvegardes disponibles
        </Text>

        {sauvegardes.length === 0 ? (
          <SousTitre>
            Aucune sauvegarde pour l'instant. Elles seront rangées dans les
            documents de l'application, d'où vous pourrez les copier ailleurs.
          </SousTitre>
        ) : (
          sauvegardes.map(sauvegarde => (
            <View
              key={sauvegarde.chemin}
              style={[styles.ligne, { borderColor: palette.bordure }]}>
              <Text style={{ color: palette.texte }}>{sauvegarde.description}</Text>
              <SousTitre>{sauvegarde.nom}</SousTitre>
              <View style={styles.actions}>
                {onFusionner ? (
                  <Bouton
                    titre="Fusionner"
                    testID={`fusionner-${sauvegarde.nom}`}
                    variante="discret"
                    desactive={enCours}
                    onPress={() => {
                      setAFusionner(sauvegarde);
                      setMotDePasseRestauration('');
                    }}
                  />
                ) : null}
                <Bouton
                  titre="Restaurer"
                  testID={`restaurer-${sauvegarde.nom}`}
                  variante="discret"
                  desactive={enCours}
                  onPress={() => {
                    setARestaurer(sauvegarde);
                    setMotDePasseRestauration('');
                  }}
                />
                {onSupprimer ? (
                  <Bouton
                    titre="Supprimer"
                    variante="discret"
                    desactive={enCours}
                    onPress={() => onSupprimer(sauvegarde.chemin)}
                  />
                ) : null}
              </View>
            </View>
          ))
        )}
      </Carte>

      {/* --- Confirmation de fusion --- */}
      {aFusionner && onFusionner ? (
        <Carte>
          <Text style={{ color: palette.texte, fontWeight: '700' }}>
            Fusionner ajoute, sans rien effacer
          </Text>
          <SousTitre>{aFusionner.description}</SousTitre>
          <SousTitre>
            Les opérations, comptes et valeurs que vous n’avez pas encore sont
            repris. Rien de local n’est supprimé ni remplacé. Si un compte a été
            renommé des deux côtés, votre version est gardée et l’écart vous est
            signalé.
          </SousTitre>
          <SousTitre>
            Les réglages et l’historique des cours ne sont pas repris : ils
            appartiennent à l’appareil, pas au portefeuille.
          </SousTitre>

          <Champ
            etiquette="Mot de passe de cette sauvegarde"
            value={motDePasseRestauration}
            onChangeText={setMotDePasseRestauration}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!enCours}
            textContentType="password"
          />

          <Bouton
            titre="Reprendre les nouveautés"
            testID="bouton-confirmer-fusion"
            desactive={motDePasseRestauration.length === 0 || enCours}
            onPress={() => onFusionner(aFusionner.chemin, motDePasseRestauration)}
          />
          <Bouton
            titre="Annuler"
            variante="discret"
            onPress={() => setAFusionner(undefined)}
          />
        </Carte>
      ) : null}

      {/* --- Confirmation de restauration --- */}
      {aRestaurer ? (
        <Carte>
          <View style={styles.enTete}>
            <Text style={{ color: palette.danger, fontWeight: '700' }}>
              Restaurer efface tout le contenu actuel
            </Text>
            <Explication cle="coursInconnu" />
          </View>
          <SousTitre>{aRestaurer.description}</SousTitre>
          <SousTitre>
            Vos comptes, opérations et cours actuels seront remplacés par ceux de
            cette sauvegarde. Créez-en une avant, si vous avez un doute.
          </SousTitre>

          <Champ
            etiquette="Mot de passe de cette sauvegarde"
            value={motDePasseRestauration}
            onChangeText={setMotDePasseRestauration}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!enCours}
            textContentType="password"
          />

          <Bouton
            titre="Remplacer mes données"
            testID="bouton-confirmer-restauration"
            desactive={motDePasseRestauration.length === 0 || enCours}
            onPress={() => onRestaurer(aRestaurer.chemin, motDePasseRestauration)}
          />
          <Bouton
            titre="Annuler"
            variante="discret"
            onPress={() => setARestaurer(undefined)}
          />
        </Carte>
      ) : null}

      <Actions>
        <Bouton titre="Retour" variante="discret" onPress={onRetour} />
      </Actions>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  enTete: { flexDirection: 'row', alignItems: 'center', gap: ESPACEMENT.s },
  sectionTitre: { fontSize: 17, fontWeight: '700' },
  ligne: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: ESPACEMENT.s,
    gap: ESPACEMENT.xs,
  },
  actions: { flexDirection: 'row', gap: ESPACEMENT.s },
});
