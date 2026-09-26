/**
 * Onglet Impôts : situation fiscale de chaque compte, plus-values réalisées,
 * et rapport annuel.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Champ, SousTitre, usePalette } from '../../composants';
import { CarteSection, Metrique, Rangee, Selecteur, Signe } from '../../elements';
import { simulerVente, type LigneVendable } from '../../vues/simulationVente';
import { Explication, Jauge } from '../../indicateurs';
import { Barres } from '../../graphiques/Graphiques';
import { ESPACEMENT, RAYON } from '../../theme';
import type { VueImpots } from '../../vues/onglets';

function euros(valeur: number): string {
  return `${valeur.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`;
}

export function OngletImpots({
  vue,
  ventes,
  aujourdhui,
  annees,
  onGenerer,
  message,
}: {
  vue: VueImpots;
  ventes?: readonly LigneVendable[];
  aujourdhui?: string;
  annees?: readonly number[];
  onGenerer?(annee: number): void;
  message?: string;
}) {
  const palette = usePalette();

  return (
    <>
      {ventes && ventes.length > 0 && aujourdhui ? <SimulateurVente lignes={ventes} aujourdhui={aujourdhui} /> : null}
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
  champs: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.m },
  champ: { flexGrow: 1, flexBasis: 160 },
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

const lire = (texte: string) => Number(texte.replace(/\s/g, '').replace(',', '.'));
const eurosPrecis = (valeur: number) =>
  `${valeur.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
const dateFr = (iso: string) => iso.split('-').reverse().join('/');

/** Combien d'impôt si je vends cette ligne, et si je retire l'argent du PEA. */
function SimulateurVente({ lignes, aujourdhui }: { lignes: readonly LigneVendable[]; aujourdhui: string }) {
  const palette = usePalette();
  const [cle, setCle] = useState(lignes[0].cle);
  const ligne = lignes.find(element => element.cle === cle) ?? lignes[0];
  const [quantite, setQuantite] = useState(String(ligne.quantite).replace('.', ','));
  const [prix, setPrix] = useState(ligne.cours ? String(ligne.cours).replace('.', ',') : '');
  const [frais, setFrais] = useState('0');

  const choisir = (nouvelle: string) => {
    const suivante = lignes.find(element => element.cle === nouvelle)!;
    setCle(nouvelle);
    setQuantite(String(suivante.quantite).replace('.', ','));
    setPrix(suivante.cours ? String(suivante.cours).replace('.', ',') : '');
  };

  const q = lire(quantite);
  const p = lire(prix);
  const valide = q > 0 && q <= ligne.quantite + 1e-9 && p > 0;
  const resultat = valide
    ? simulerVente({
        enveloppe: ligne.enveloppe,
        dateOuverture: ligne.dateOuverture,
        aujourdhui,
        quantite: q,
        prixVente: p,
        pru: ligne.pru,
        frais: lire(frais) || 0,
        valeurPlan: ligne.valeurPlan,
        versementsPlan: ligne.versementsPlan,
      })
    : undefined;

  return (
    <CarteSection titre="Simulateur de vente" testID="simulateur-vente">
      <Selecteur
        etiquette="Ligne à vendre"
        valeur={ligne.cle}
        options={lignes.map(element => ({ valeur: element.cle, libelle: element.libelle }))}
        onChoisir={choisir}
        largeur={320}
        testID="choix-ligne-vente"
      />
      <View style={styles.champs}>
        <View style={styles.champ}>
          <Champ etiquette={`Quantité (sur ${ligne.quantite.toLocaleString('fr-FR')})`} value={quantite} onChangeText={setQuantite} keyboardType="decimal-pad" testID="champ-quantite-vente" />
        </View>
        <View style={styles.champ}>
          <Champ etiquette="Prix de vente" value={prix} onChangeText={setPrix} keyboardType="decimal-pad" testID="champ-prix-vente" />
        </View>
        <View style={styles.champ}>
          <Champ etiquette="Frais de courtage" value={frais} onChangeText={setFrais} keyboardType="decimal-pad" />
        </View>
      </View>

      {!resultat ? (
        <SousTitre>Indiquez une quantité (au plus celle détenue) et un prix de vente.</SousTitre>
      ) : (
        <View style={{ gap: ESPACEMENT.s }} testID="resultat-vente">
          <View style={styles.champs}>
            <Metrique libelle="Vous recevez" valeur={eurosPrecis(resultat.produit)} />
            <Metrique
              libelle={resultat.plusValue >= 0 ? 'Plus-value' : 'Moins-value'}
              valeur={eurosPrecis(resultat.plusValue)}
              tendance={resultat.plusValue >= 0 ? 'hausse' : 'baisse'}
            />
            <Metrique libelle="Impôt de la vente" valeur={eurosPrecis(resultat.impotVente)} tendance={resultat.impotVente > 0 ? 'baisse' : undefined} />
            <Metrique libelle="Net" valeur={eurosPrecis(resultat.netVente)} />
          </View>
          <Text style={{ color: palette.texte, lineHeight: 21 }}>{resultat.explication}</Text>
          {resultat.retrait ? (
            <Text style={{ color: palette.texte, lineHeight: 21 }} testID="retrait-pea">
              Si vous retirez ces {eurosPrecis(resultat.produit)} du PEA : {eurosPrecis(resultat.retrait.partGain)} de gain
              retiré, {eurosPrecis(resultat.retrait.impot)} d’impôt ({Math.round(resultat.retrait.taux * 1000) / 10} %), il
              vous reste {eurosPrecis(resultat.retrait.net)}.
              {resultat.retrait.clotureLePlan ? ' ⚠️ Et le PEA serait clôturé.' : ''}
            </Text>
          ) : null}
          {resultat.cinqAns ? (
            <Text style={{ color: resultat.cinqAns.atteint ? palette.hausse : palette.texteSecondaire }} testID="cinq-ans-pea">
              {resultat.cinqAns.atteint
                ? `✅ Votre PEA a passé ses 5 ans le ${dateFr(resultat.cinqAns.date)}.`
                : `⏳ Votre PEA aura 5 ans le ${dateFr(resultat.cinqAns.date)}, dans ${resultat.cinqAns.joursRestants} jours.`}
            </Text>
          ) : null}
          <SousTitre>Estimation au prélèvement forfaitaire unique, hors cas particuliers : ce n’est pas un avis fiscal.</SousTitre>
        </View>
      )}
    </CarteSection>
  );
}
