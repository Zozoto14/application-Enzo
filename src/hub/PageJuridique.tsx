/**
 * Documents légaux : Conditions d'utilisation, Politique de confidentialité,
 * Cookies et stockage local, Mentions légales.
 *
 * Lisibles par tout le monde, avant comme après la connexion (pied de page de
 * l'écran de connexion, Paramètres › À propos). Un Fondateur peut les modifier
 * (le texte est synchronisé avec l'annuaire des comptes) ou revenir au modèle.
 * `AcceptationJuridique` est l'écran « J'ai lu et j'accepte » de la première
 * connexion, redemandé quand la version change.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  AVERTISSEMENT_JURIDIQUE,
  DOCUMENTS,
  TAILLE_MAX_DOCUMENT,
  blocsDuTexte,
  estModifie,
  modifierDocument,
  retablirModele,
  texteDuDocument,
  type DocsJuridiques,
  type IdDocument,
} from '../juridique/modele';
import { BoutonHub } from './Hub';
import { police, type ThemeHub } from './themes';
import { ecouterTouche } from './web';

function TexteDocument({ theme, texte }: { theme: ThemeHub; texte: string }) {
  const corps = { color: theme.texte, fontSize: 14, lineHeight: 21, ...police(theme.policeTexte) };
  return (
    <View style={{ gap: 10 }} testID="juridique-texte">
      {blocsDuTexte(texte).map((bloc, i) =>
        bloc.genre === 'titre' ? (
          <Text key={i} accessibilityRole="header" style={{ color: theme.texte, fontSize: 16, fontWeight: '700', marginTop: 6, ...police(theme.policeTitre) }}>
            {bloc.texte}
          </Text>
        ) : bloc.genre === 'puces' ? (
          <View key={i} style={{ gap: 4, paddingLeft: 6 }}>
            {bloc.elements.map((element, j) => (
              <Text key={j} style={corps}>
                {'•  '}
                {element}
              </Text>
            ))}
          </View>
        ) : (
          <Text key={i} style={corps}>
            {bloc.texte}
          </Text>
        ),
      )}
    </View>
  );
}

function Avertissement({ theme }: { theme: ThemeHub }) {
  return (
    <Text style={{ color: theme.attenue, fontSize: 12, lineHeight: 17, fontStyle: 'italic', ...police(theme.policeTexte) }} testID="juridique-avertissement">
      {AVERTISSEMENT_JURIDIQUE}
    </Text>
  );
}

export interface PropsPageJuridique {
  theme: ThemeHub;
  /** Textes modifiés par un Fondateur (absent : modèle). */
  docs?: DocsJuridiques;
  /** Document ouvert au départ. */
  idInitial?: IdDocument;
  actif?: boolean;
  /** Présent pour un Fondateur : enregistre les textes (synchronisés). */
  onEnregistrer?(docs: DocsJuridiques): Promise<void>;
  /** Nom du Fondateur, inscrit avec la modification. */
  nomEditeur?: string;
  maintenant?(): Date;
  onFermer(): void;
}

export function PageJuridique({ theme, docs, idInitial, actif = true, onEnregistrer, nomEditeur, maintenant = () => new Date(), onFermer }: PropsPageJuridique) {
  const [id, setId] = useState<IdDocument | undefined>(idInitial);
  const [edition, setEdition] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [enCours, setEnCours] = useState(false);
  // Ouvert sur un document précis (lien, écran d'acceptation) : « Retour » revient d'où l'on vient, sans passer par la liste.
  const fermer = () => (edition !== undefined ? setEdition(undefined) : id && !idInitial ? setId(undefined) : onFermer());
  useEffect(() => (actif ? ecouterTouche('Escape', fermer) : undefined)); // eslint-disable-line react-hooks/exhaustive-deps
  const titre = { color: theme.texte, fontWeight: theme.poidsTitre, textTransform: theme.majuscules ? ('uppercase' as const) : ('none' as const), ...police(theme.policeTitre) };
  const carte = [styles.carte, { backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: theme.rayonMoyen }];
  const info = id ? DOCUMENTS.find(d => d.id === id) : undefined;

  const enregistrer = async (suivant: DocsJuridiques, reussite: string) => {
    if (!onEnregistrer) return;
    setEnCours(true);
    setMessage(undefined);
    try {
      await onEnregistrer(suivant);
      setEdition(undefined);
      setMessage(reussite);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Enregistrement impossible.');
    } finally {
      setEnCours(false);
    }
  };

  return (
    <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="hub-juridique" accessibilityLabel="Documents légaux">
      <View style={styles.page}>
        <View style={styles.entete}>
          <BoutonHub theme={theme} titre="← Retour" libelle="Retour (Échap)" onPress={fermer} testID="juridique-fermer" />
          <Text style={[titre, { fontSize: 26, flex: 1 }]} accessibilityRole="header">
            {info ? info.titre : 'Informations légales'}
          </Text>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          {!info ? (
            <>
              <Avertissement theme={theme} />
              {DOCUMENTS.map(d => (
                <Pressable
                  key={d.id}
                  accessibilityRole="button"
                  accessibilityLabel={d.titre}
                  testID={`juridique-ouvrir-${d.id}`}
                  onPress={() => {
                    setMessage(undefined);
                    setId(d.id);
                  }}
                  style={carte}>
                  <Text style={[titre, { fontSize: 16 }]}>
                    {d.titre}
                    {estModifie(d.id, docs) ? '  ·  personnalisé' : ''}
                  </Text>
                  <Text style={{ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) }}>{d.resume}</Text>
                </Pressable>
              ))}
              <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>
                Une question, une demande d’accès ou de suppression de vos données ? Écrivez à l’équipe depuis la section Support.
              </Text>
            </>
          ) : edition !== undefined ? (
            <View style={carte}>
              <Text style={{ color: theme.attenue, fontSize: 13, lineHeight: 19, ...police(theme.policeTexte) }}>
                Intertitre : une ligne qui commence par « ## ». Puce : une ligne qui commence par « - ». Les paragraphes sont séparés par une ligne vide. Enregistrer demande à chacun d’accepter de nouveau les documents.
              </Text>
              <TextInput
                multiline
                value={edition}
                maxLength={TAILLE_MAX_DOCUMENT}
                onChangeText={setEdition}
                accessibilityLabel={`Texte : ${info.titre}`}
                testID="juridique-edition"
                style={[styles.champ, { color: theme.texte, borderColor: theme.ligne, backgroundColor: theme.fond, borderRadius: Math.min(theme.rayonMoyen, 10), ...police(theme.policeTexte) }]}
              />
              <View style={styles.actions}>
                <BoutonHub
                  theme={theme}
                  variante="plein"
                  titre={enCours ? 'Enregistrement…' : 'Enregistrer'}
                  onPress={() => void enregistrer(modifierDocument(docs, info.id, edition, nomEditeur, maintenant().toISOString()), 'Texte enregistré : chacun devra l’accepter de nouveau.')}
                  testID="juridique-enregistrer"
                />
                <BoutonHub theme={theme} titre="Annuler" onPress={() => setEdition(undefined)} testID="juridique-annuler" />
              </View>
            </View>
          ) : (
            <View style={carte}>
              <Avertissement theme={theme} />
              <TexteDocument theme={theme} texte={texteDuDocument(info.id, docs)} />
              {docs?.modifieLe && estModifie(info.id, docs) ? (
                <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>
                  Texte personnalisé{docs.par ? ` par ${docs.par}` : ''}, modifié le {docs.modifieLe.slice(0, 10)}.
                </Text>
              ) : null}
              {onEnregistrer ? (
                <View style={styles.actions}>
                  <BoutonHub theme={theme} titre="Modifier (Fondateur)" onPress={() => setEdition(texteDuDocument(info.id, docs))} testID="juridique-modifier" />
                  {estModifie(info.id, docs) ? (
                    <BoutonHub
                      theme={theme}
                      titre="Rétablir le modèle"
                      onPress={() => void enregistrer(retablirModele(docs, info.id, nomEditeur, maintenant().toISOString()), 'Modèle rétabli : chacun devra l’accepter de nouveau.')}
                      testID="juridique-retablir"
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          )}
          {message ? (
            <Text accessibilityLiveRegion="polite" style={{ color: theme.texte, fontSize: 13, ...police(theme.policeTexte) }} testID="juridique-message">
              {message}
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

/** Première connexion (ou version changée) : lire puis accepter. Sans acceptation, l'application reste fermée. */
export function AcceptationJuridique({
  theme,
  onAccepter,
  onLire,
  onRefuser,
  nouvelleVersion,
}: {
  theme: ThemeHub;
  onAccepter(): void;
  onLire(id: IdDocument): void;
  onRefuser(): void;
  /** Déjà accepté une version précédente : texte « ont changé ». */
  nouvelleVersion: boolean;
}) {
  const [coche, setCoche] = useState(false);
  const titre = { color: theme.texte, fontWeight: theme.poidsTitre, ...police(theme.policeTitre) };
  return (
    <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="acceptation-juridique" accessibilityLabel="Acceptation des conditions">
      <View style={styles.page}>
        <ScrollView contentContainerStyle={{ gap: 14, paddingVertical: 24 }}>
          <Text style={[titre, { fontSize: 26 }]} accessibilityRole="header">
            {nouvelleVersion ? 'Nos documents ont changé' : 'Avant de commencer'}
          </Text>
          <Text style={{ color: theme.attenue, fontSize: 14, lineHeight: 21, ...police(theme.policeTexte) }}>
            {nouvelleVersion
              ? 'Les conditions d’utilisation, la politique de confidentialité ou les mentions légales ont été mises à jour : merci de les relire avant de continuer.'
              : 'Merci de lire les documents ci-dessous. Vos données restent chiffrées sur vos appareils ; ces textes expliquent ce qui est gardé, où, et qui est contacté.'}
          </Text>
          {DOCUMENTS.map(d => (
            <Pressable
              key={d.id}
              accessibilityRole="button"
              accessibilityLabel={`Lire : ${d.titre}`}
              testID={`acceptation-lire-${d.id}`}
              onPress={() => onLire(d.id)}
              style={[styles.carte, { backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: theme.rayonMoyen }]}>
              <Text style={[titre, { fontSize: 15 }]}>{d.titre}</Text>
              <Text style={{ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) }}>{d.resume}</Text>
            </Pressable>
          ))}
          <Avertissement theme={theme} />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: coche }}
            aria-checked={coche}
            accessibilityLabel="J’ai lu et j’accepte les conditions d’utilisation et la politique de confidentialité"
            testID="acceptation-case"
            onPress={() => setCoche(c => !c)}
            style={styles.ligneCase}>
            <View style={[styles.case, { borderColor: theme.accent, backgroundColor: coche ? theme.accent : 'transparent' }]}>
              {coche ? <Text style={{ color: theme.surAccent, fontWeight: '800' }}>✓</Text> : null}
            </View>
            <Text style={{ color: theme.texte, flex: 1, fontSize: 14, ...police(theme.policeTexte) }}>
              J’ai lu et j’accepte les conditions d’utilisation et la politique de confidentialité.
            </Text>
          </Pressable>
          <View style={styles.actions}>
            <BoutonHub theme={theme} variante="plein" titre="Continuer" onPress={() => coche && onAccepter()} testID="acceptation-continuer" libelle={coche ? 'Continuer' : 'Continuer (cochez d’abord la case)'} />
            <BoutonHub theme={theme} titre="Refuser et verrouiller" onPress={onRefuser} testID="acceptation-refuser" />
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

/** Liens du pied de page de l'écran de connexion et de Paramètres › À propos. */
export function LiensJuridiques({ theme, onOuvrir }: { theme: ThemeHub; onOuvrir(id?: IdDocument): void }) {
  return (
    <View style={styles.liens} testID="liens-juridiques" accessibilityRole="menu">
      {DOCUMENTS.map(d => (
        <Pressable key={d.id} accessibilityRole="link" accessibilityLabel={d.titre} testID={`lien-juridique-${d.id}`} onPress={() => onOuvrir(d.id)} hitSlop={8}>
          <Text style={{ color: theme.attenue, fontSize: 12, textDecorationLine: 'underline', ...police(theme.policeTexte) }}>{d.titre}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1 },
  page: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 20, gap: 14 },
  entete: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  carte: { borderWidth: 1, padding: 16, gap: 8 },
  champ: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 320, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  ligneCase: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  case: { width: 24, height: 24, borderWidth: 2, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  liens: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 12 },
});
