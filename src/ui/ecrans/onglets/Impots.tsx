/**
 * Onglet Impôts : situation fiscale de chaque compte, plus-values réalisées,
 * et rapport annuel.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SousTitre, usePalette } from '../../composants';
import { CarteSection, Rangee, Signe } from '../../elements';
import { Explication, Jauge } from '../../indicateurs';
import { Barres } from '../../graphiques/Graphiques';
import { ESPACEMENT, RAYON } from '../../theme';
import type { VueImpots } from '../../vues/onglets';

function euros(valeur: number): string {
  return `${valeur.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`;
}

export function OngletImpots({
  vue,
  annees,
  onGenerer,
  message,
}: {
  vue: VueImpots;
  annees?: readonly number[];
  onGenerer?(annee: number): void;
  message?: string;
}) {
  const palette = usePalette();

  return (
    <>
      {vue.rappelFinAnnee ? (
        <CarteSection titre="Rappel de fin d'année" explication="moinsValueReportable">
          <SousTitre>{vue.rappelFinAnnee}</SousTitre>
        </CarteSection>
      ) : null}

      <Rangee>
        {vue.comptes.map(compte => (
          <CarteSection key={compte.nom} titre={compte.nom} explication={compte.venteImposable ? 'pfu' : 'impotPEA'}>
            <SousTitre>{compte.situationFiscale}</SousTitre>

            {compte.plafond ? (
              <View style={{ gap: ESPACEMENT.xs }}>
                <View style={styles.ligneEnTete}>
                  <SousTitre>Plafond de versement</SousTitre>
                  <Explication cle="plafondPEA" />
                </View>
                <Jauge
                  fraction={compte.plafond.fraction}
                  tendance={compte.plafond.depassement ? 'baisse' : undefined}
                />
                <View style={styles.ligne}>
                  <SousTitre>
                    {compte.plafond.verse} sur {compte.plafond.plafond}
                  </SousTitre>
                  <SousTitre>{compte.plafond.restant} restants</SousTitre>
                </View>
                {compte.plafond.depassement ? (
                  <Text style={{ color: palette.danger }}>Dépassement de {compte.plafond.depassement}.</Text>
                ) : null}
              </View>
            ) : null}

            {compte.anciennete ? (
              <View style={styles.ligneEnTete}>
                <SousTitre>Antériorité : {compte.anciennete}</SousTitre>
                <Explication cle="anterioritePEA" />
              </View>
            ) : null}
          </CarteSection>
        ))}
      </Rangee>

      {vue.comptes.some(compte => compte.sortie) ? (
        <Rangee>
          {vue.comptes.map(compte =>
            compte.sortie ? (
              <CarteSection
                key={`sortie-${compte.nom}`}
                titre={`Si vous sortiez aujourd’hui · ${compte.nom}`}
                testID={`sortie-${compte.nom}`}>
                <SousTitre>{compte.sortie.explication}</SousTitre>
                <Barres
                  barres={[
                    {
                      libelle: 'Gain',
                      valeur: compte.sortie.gain,
                      couleur: compte.sortie.gain >= 0 ? palette.hausse : palette.baisse,
                    },
                    {
                      libelle: `Impôts (${compte.sortie.taux})`,
                      valeur: compte.sortie.impot,
                      couleur: palette.baisse,
                    },
                    { libelle: 'Net en poche', valeur: compte.sortie.net, couleur: palette.series[0] },
                  ]}
                  formater={euros}
                  hauteur={200}
                  valeursVisibles
                />
                <SousTitre>Estimation indicative, hors frais et moins-values reportables.</SousTitre>
              </CarteSection>
            ) : null,
          )}
        </Rangee>
      ) : null}

      <Rangee>
        <CarteSection titre="Plus-values réalisées" explication="plusValueRealisee">
          {vue.aucuneCession ? (
            <SousTitre>Aucune vente enregistrée. Les plus-values apparaîtront ici, année par année.</SousTitre>
          ) : (
            vue.annees.map(ligne => (
              <View key={ligne.annee} style={[styles.position, { borderColor: palette.bordure }]}>
                <View style={styles.ligne}>
                  <Text style={{ color: palette.texte }}>{ligne.annee}</Text>
                  <Signe texte={ligne.plusValue} tendance={ligne.tendance} taille={15} />
                </View>
                <SousTitre>
                  {ligne.impotEstime ? `Impôt estimé : ${ligne.impotEstime}` : 'Aucun impôt dû sur ces cessions.'}
                </SousTitre>
              </View>
            ))
          )}
        </CarteSection>

        {onGenerer ? (
          <CarteSection titre="Rapport annuel">
            <SousTitre>
              Un document complet pour l’année : cessions, dividendes, frais, positions au 31 décembre,
              et les montants à reporter sur la déclaration.
            </SousTitre>

            {annees && annees.length > 0 ? (
              <View style={styles.choix}>
                {annees.map(annee => (
                  <Pressable
                    key={annee}
                    testID={`rapport-${annee}`}
                    accessibilityRole="button"
                    onPress={() => onGenerer(annee)}
                    style={[styles.puce, { borderColor: palette.accent }]}>
                    <Text style={{ fontSize: 13, color: palette.accent, fontWeight: '700' }}>{annee}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <SousTitre>Aucune opération enregistrée : il n’y a encore aucune année à rapporter.</SousTitre>
            )}

            {message ? (
              <Text accessibilityLiveRegion="polite" style={{ color: palette.texte }}>
                {message}
              </Text>
            ) : null}
          </CarteSection>
        ) : null}
      </Rangee>
    </>
  );
}

const styles = StyleSheet.create({
  ligne: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ESPACEMENT.s },
  ligneEnTete: { flexDirection: 'row', alignItems: 'center', gap: ESPACEMENT.s },
  position: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: ESPACEMENT.s, gap: ESPACEMENT.xs },
  choix: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.s },
  puce: {
    borderWidth: 1,
    borderRadius: RAYON.l,
    paddingHorizontal: ESPACEMENT.m,
    paddingVertical: ESPACEMENT.s,
    minHeight: 36,
    justifyContent: 'center',
  },
});
