/**
 * Import d'un export de positions.
 *
 * Le contenu est **collé**, pas choisi dans un sélecteur de fichiers : celui-ci
 * demanderait un module natif de plus, pour un gain faible sur une opération
 * qu'on fait une fois. Ouvrir l'export dans un éditeur et le copier marche
 * partout, tout de suite.
 *
 * Rien n'est enregistré avant que l'aperçu n'ait été affiché. Un import de
 * portefeuille se défait mal : une étape de plus vaut mieux qu'un journal à
 * nettoyer à la main.
 */

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import type { PositionImportee } from '../../core/import/positions';
import { Alerte, Bouton, Carte, Champ, SousTitre, Titre, usePalette } from '../composants';
import { ESPACEMENT, palettePour, stylesPartages } from '../theme';
import { apercuPositions } from '../vues/import';

export interface ImportPositionsProps {
  onImporter(positions: PositionImportee[]): void;
  onAnnuler(): void;
}

export function ImportPositions({ onImporter, onAnnuler }: ImportPositionsProps) {
  const sombre = useColorScheme() === 'dark';
  const palette = usePalette();
  const [contenu, setContenu] = useState('');

  const apercu = apercuPositions(contenu);

  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palettePour(sombre).fond }]}
      contentContainerStyle={[stylesPartages.contenu, { paddingTop: ESPACEMENT.l }]}
      keyboardShouldPersistTaps="handled">
      <Titre>Importer vos positions</Titre>
      <SousTitre>
        Ouvrez l'export « positions instantanées » de votre courtier, copiez son
        contenu entier, et collez-le ci-dessous.
      </SousTitre>

      <Champ
        etiquette="Contenu du fichier"
        value={contenu}
        onChangeText={setContenu}
        multiline
        numberOfLines={6}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="name;isin;quantity;buyingPrice;…"
        style={styles.zoneTexte}
      />

      {apercu.avertissements.map(message => (
        <Alerte key={message} message={message} />
      ))}

      {apercu.lignes.length > 0 ? (
        <Carte>
          <Text style={[styles.sectionTitre, { color: palette.texte }]}>
            {apercu.lignes.length} position(s) détectée(s)
          </Text>
          {apercu.lignes.map(ligne => (
            <View key={ligne.isin} style={[styles.ligne, { borderColor: palette.bordure }]}>
              <View style={stylesPartages.ligne}>
                <Text
                  style={[styles.nom, { color: palette.texte }]}
                  numberOfLines={1}>
                  {ligne.nom}
                </Text>
                <Text style={{ color: palette.texte, fontWeight: '600' }}>
                  {ligne.coutTotal}
                </Text>
              </View>
              <SousTitre>
                {ligne.quantite} × PRU {ligne.pru}
                {ligne.approche ? ' · prix de revient approché' : ''}
              </SousTitre>
            </View>
          ))}
          <View style={[stylesPartages.ligne, { paddingTop: ESPACEMENT.s }]}>
            <Text style={{ color: palette.texte, fontWeight: '700' }}>
              Prix de revient total
            </Text>
            <Text style={{ color: palette.texte, fontWeight: '700' }}>
              {apercu.total}
            </Text>
          </View>
        </Carte>
      ) : null}

      {apercu.anomalies.length > 0 ? (
        <Carte>
          <Text style={{ color: palette.danger, fontWeight: '600' }}>
            Lignes ignorées
          </Text>
          {apercu.anomalies.map(anomalie => (
            <SousTitre key={`${anomalie.ligne}-${anomalie.message}`}>
              Ligne {anomalie.ligne} : {anomalie.message}
            </SousTitre>
          ))}
        </Carte>
      ) : null}

      <Bouton
        titre="Importer"
        testID="bouton-importer"
        desactive={!apercu.pret}
        onPress={() => onImporter(apercu.positions)}
      />
      <Bouton titre="Annuler" variante="discret" onPress={onAnnuler} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  zoneTexte: { minHeight: 120, textAlignVertical: 'top' },
  sectionTitre: { fontSize: 17, fontWeight: '700' },
  ligne: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: ESPACEMENT.s,
    gap: ESPACEMENT.xs,
  },
  nom: { fontSize: 15, fontWeight: '600', flex: 1, marginRight: ESPACEMENT.s },
});
