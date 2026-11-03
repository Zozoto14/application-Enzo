/**
 * Journal des décisions : chaque achat et chaque vente, la raison qu'on
 * s'était donnée, et ce qui s'est passé depuis.
 */

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Bouton, SousTitre, usePalette } from '../composants';
import { CarteSection, Metrique, Segments, Vide } from '../elements';
import { ESPACEMENT, RAYON, palettePour, stylesPartages, POLICE_TITRE } from '../theme';
import type { LigneJournal, VueJournal } from '../vues/journal';
import { Icone } from '../icones';

export interface JournalProps {
  vue: VueJournal;
  onNoter(transactionId: string, note: string): void;
}

type Filtre = 'tout' | 'ACHAT' | 'VENTE';
const dateFr = (iso: string) => iso.split('-').reverse().join('/');
const nombre = (valeur: number) => valeur.toLocaleString('fr-FR', { maximumFractionDigits: 2 });

export function Journal({ vue, onNoter }: JournalProps) {
  const palette = usePalette();
  const [filtre, setFiltre] = useState<Filtre>('tout');
  const lignes = vue.lignes.filter(ligne => filtre === 'tout' || ligne.type === filtre);

  return (
    <View style={[stylesPartages.ecran, { backgroundColor: palettePour().fond }]}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text {...POLICE_TITRE} style={[styles.titre, { color: palette.texte }]} accessibilityRole="header">
          Journal des décisions
        </Text>
        <SousTitre>
          Chaque achat et chaque vente avec la raison que vous vous étiez donnée, et ce qui s’est passé depuis.
          Pour une vente, une baisse ensuite est une bonne nouvelle : vous l’avez évitée.
        </SousTitre>

        {vue.tauxReussite !== undefined ? (
          <CarteSection titre="Bilan">
            <View style={styles.bilan}>
              <Metrique
                libelle="Décisions gagnantes"
                valeur={`${Math.round(vue.tauxReussite)} %`}
                tendance={vue.tauxReussite >= 50 ? 'hausse' : 'baisse'}
              />
              <Metrique libelle="Décisions jugées" valeur={String(vue.decisionsJugees)} />
            </View>
          </CarteSection>
        ) : null}

        <Segments<Filtre>
          options={['tout', 'ACHAT', 'VENTE']}
          actif={filtre}
          onChoisir={setFiltre}
          libelle={option => (option === 'tout' ? 'Tout' : option === 'ACHAT' ? 'Achats' : 'Ventes')}
          prefixeTest="filtre-journal"
        />

        {lignes.length === 0 ? <Vide>Aucune décision enregistrée pour l’instant.</Vide> : null}
        {lignes.map(ligne => (
          <Decision key={ligne.transactionId} ligne={ligne} onNoter={onNoter} />
        ))}
      </ScrollView>
    </View>
  );
}

function Decision({ ligne, onNoter }: { ligne: LigneJournal; onNoter(transactionId: string, note: string): void }) {
  const palette = usePalette();
  const [edition, setEdition] = useState(false);
  const [note, setNote] = useState(ligne.note ?? '');
  const couleur =
    ligne.verdict === 'bon' ? palette.hausse : ligne.verdict === 'mauvais' ? palette.baisse : palette.texteSecondaire;
  return (
    <View style={[styles.decision, { backgroundColor: palette.surface, borderColor: palette.bordure, borderLeftColor: couleur }]} testID={`decision-${ligne.transactionId}`}>
      <View style={styles.entete}>
        <Text style={{ color: ligne.type === 'ACHAT' ? palette.accent : palette.texte, fontWeight: '800' }}>
          {ligne.type === 'ACHAT' ? 'Achat' : 'Vente'}
        </Text>
        <Text style={{ color: palette.texte, fontWeight: '700', flex: 1 }} numberOfLines={1}>
          {ligne.nom}
        </Text>
        <Text style={{ color: palette.texteSecondaire }}>{dateFr(ligne.date)}</Text>
      </View>
      <Text style={{ color: palette.texteSecondaire, fontSize: 13 }}>
        {nombre(ligne.quantite)} × {nombre(ligne.prix)}
        {ligne.coursActuel !== undefined ? ` · cours actuel ${nombre(ligne.coursActuel)}` : ''}
      </Text>
      <Text style={{ color: couleur, fontWeight: '600' }}>
        {ligne.verdict === 'bon' ? <><Icone nom="valide" libelle="Bonne décision" /> </> : ligne.verdict === 'mauvais' ? <><Icone nom="erreur" libelle="Mauvaise décision" /> </> : null}
        {ligne.phrase}
      </Text>

      {edition ? (
        <View style={{ gap: ESPACEMENT.s }}>
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            placeholder="Pourquoi cette décision ?"
            placeholderTextColor={palette.texteSecondaire}
            style={[styles.saisie, { color: palette.texte, borderColor: palette.bordure, backgroundColor: palette.surfaceHaute }]}
            testID={`note-${ligne.transactionId}`}
          />
          <View style={{ flexDirection: 'row', gap: ESPACEMENT.s }}>
            <Bouton
              titre="Enregistrer"
              onPress={() => {
                onNoter(ligne.transactionId, note.trim());
                setEdition(false);
              }}
              testID={`enregistrer-note-${ligne.transactionId}`}
            />
            <Bouton titre="Annuler" variante="discret" onPress={() => setEdition(false)} />
          </View>
        </View>
      ) : (
        <>
          {ligne.note ? (
            <Text style={{ color: palette.texte, fontStyle: 'italic' }}>« {ligne.note} »</Text>
          ) : ligne.these ? (
            <Text style={{ color: palette.texte, fontStyle: 'italic' }}>Thèse du carnet : « {ligne.these} »</Text>
          ) : null}
          <View style={{ alignSelf: 'flex-start' }}>
            <Bouton
              titre={ligne.note ? 'Modifier la raison' : 'Noter la raison'}
              variante="discret"
              onPress={() => setEdition(true)}
              testID={`noter-${ligne.transactionId}`}
            />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: ESPACEMENT.m + 4, gap: ESPACEMENT.m },
  titre: { fontSize: 26, fontWeight: '800' },
  bilan: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.l },
  decision: { borderWidth: 1, borderLeftWidth: 4, borderRadius: RAYON.m, padding: ESPACEMENT.m, gap: ESPACEMENT.xs },
  entete: { flexDirection: 'row', alignItems: 'center', gap: ESPACEMENT.s },
  saisie: { borderWidth: 1, borderRadius: RAYON.s, padding: ESPACEMENT.s, minHeight: 70, textAlignVertical: 'top' },
});
