/**
 * Diagnostic : un bouton teste tous les services dont l'application dépend,
 * et le rapport se copie pour être transmis.
 */

import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../mobile/adaptatif';
import { executerDiagnostic, rapportTexte, type Test, type Verification } from '../../diagnostic/verifications';
import { Bouton, SousTitre, usePalette } from '../composants';
import { CarteSection } from '../elements';
import { ESPACEMENT, RAYON, palettePour, stylesPartages, POLICE_TITRE } from '../theme';

export interface DiagnosticProps {
  tests: readonly Test[];
  /** Horodatage lisible du rapport. */
  maintenant?: () => string;
}

const ICONES = { ok: '✅', echec: '❌', absent: '➖' } as const;

export function Diagnostic({ tests, maintenant = () => new Date().toLocaleString('fr-FR') }: DiagnosticProps) {
  const palette = usePalette();
  const [resultats, setResultats] = useState<Map<string, Verification>>(new Map());
  const [enCours, setEnCours] = useState(false);
  const [rapport, setRapport] = useState<string | undefined>();

  const lancer = () => {
    setEnCours(true);
    setRapport(undefined);
    setResultats(new Map());
    void executerDiagnostic(tests, verification =>
      setResultats(precedents => new Map(precedents).set(verification.cle, verification)),
    ).then(verifications => {
      setEnCours(false);
      setRapport(rapportTexte(verifications, maintenant()));
    });
  };

  const echecs = [...resultats.values()].filter(verification => verification.statut === 'echec').length;

  return (
    <View style={[stylesPartages.ecran, { backgroundColor: palettePour().fond }]}>
      <ScrollView contentContainerStyle={styles.page}>
        <Text {...POLICE_TITRE} style={[styles.titre, { color: palette.texte }]} accessibilityRole="header">
          Diagnostic
        </Text>
        <SousTitre>
          Teste pour de vrai chaque service de l’application : cours, screener, presse, voix, notifications,
          sauvegardes, mises à jour. Une notification de test s’affichera.
        </SousTitre>
        <View style={{ alignSelf: 'flex-start' }}>
          <Bouton titre={enCours ? 'Test en cours…' : 'Lancer le diagnostic'} desactive={enCours} onPress={lancer} testID="lancer-diagnostic" />
        </View>

        <CarteSection
          titre="Résultats"
          actions={
            rapport ? (
              <Text style={{ color: echecs ? palette.danger : palette.hausse, fontWeight: '700' }}>
                {echecs ? `${echecs} problème${echecs > 1 ? 's' : ''}` : 'Tout fonctionne'}
              </Text>
            ) : undefined
          }>
          {tests.map(test => {
            const resultat = resultats.get(test.cle);
            return (
              <View key={test.cle} style={[styles.ligne, { borderColor: palette.bordure }]} testID={`diagnostic-${test.cle}`}>
                <View style={styles.icone}>
                  {resultat ? (
                    <Text style={{ fontSize: 18 }}>{ICONES[resultat.statut]}</Text>
                  ) : enCours ? (
                    <ActivityIndicator color={palette.accent} />
                  ) : (
                    <Text style={{ color: palette.texteSecondaire, fontSize: 18 }}>·</Text>
                  )}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: palette.texte, fontWeight: '600' }}>{test.libelle}</Text>
                  {resultat ? (
                    <Text style={{ color: resultat.statut === 'echec' ? palette.danger : palette.texteSecondaire, fontSize: 13 }}>
                      {resultat.detail}
                    </Text>
                  ) : null}
                </View>
                {resultat && resultat.statut !== 'absent' ? (
                  <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>{(resultat.dureeMs / 1000).toFixed(1)} s</Text>
                ) : null}
              </View>
            );
          })}
        </CarteSection>

        {rapport ? (
          <CarteSection titre="Rapport à copier">
            <SousTitre>Sélectionnez le texte ci-dessous et copiez-le pour me l’envoyer en cas de souci.</SousTitre>
            <TextInput
              value={rapport}
              editable={false}
              multiline
              selectTextOnFocus
              style={[styles.rapport, { color: palette.texte, borderColor: palette.bordure, backgroundColor: palette.surfaceHaute }]}
              testID="rapport-diagnostic"
            />
          </CarteSection>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: ESPACEMENT.m + 4, gap: ESPACEMENT.m },
  titre: { fontSize: 26, fontWeight: '800' },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: ESPACEMENT.m, paddingVertical: ESPACEMENT.s + 2, borderTopWidth: StyleSheet.hairlineWidth },
  icone: { width: 28, alignItems: 'center' },
  rapport: { borderWidth: 1, borderRadius: RAYON.s, padding: ESPACEMENT.m, minHeight: 180, fontFamily: 'monospace', fontSize: 12 },
});
