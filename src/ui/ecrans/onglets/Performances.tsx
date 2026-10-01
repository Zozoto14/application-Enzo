/**
 * Onglet Performances : combien le portefeuille a rapporté, sur la période
 * choisie, mois par mois, et ligne par ligne face à la référence.
 */

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Pressable, Text } from '../../mobile/adaptatif';
import { SousTitre, usePalette } from '../../composants';
import {
  CarteSection,
  Metrique,
  Rangee,
  Segments,
  Selecteur,
  Signe,
  Vide,
  type OptionSelecteur,
} from '../../elements';
import { Barres, GraphiqueLignes } from '../../graphiques/Graphiques';
import { Explication, IndicateurMesure } from '../../indicateurs';
import { couleurChaleur } from '../../tableau';
import { ESPACEMENT, RAYON } from '../../theme';
import { PERIODES, type Periode } from '../../../core/performance/cumul';
import {
  construirePerformancesAvance,
  courbeAction,
  type EntreesAnalyse,
} from '../../vues/analyses';
import type { VueComparaison } from '../../vues/comparaison';
import type { VuePerformance } from '../../vues/onglets';
import type { ResultatSiIndice } from '../../vues/siIndice';
import { mesurerPeriode, periodesComparees, type ChoixPeriodes, type MesuresPeriode } from '../../vues/comparaisonPeriodes';
import { formaterMontant } from '../../format';
import { Decimal } from '../../../core/money/decimal';

const MOIS = ['Jan.', 'Fév.', 'Mar.', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sep.', 'Oct.', 'Nov.', 'Déc.'];

const pourcent = (valeur: number) =>
  `${valeur.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
const euros = (valeur: number) =>
  `${valeur.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €`;

type Mode = 'TWR' | 'Valeur';

export interface OngletPerformancesProps {
  vue: VuePerformance;
  siIndice?: ResultatSiIndice;
  comparaison: VueComparaison;
  analyse?: EntreesAnalyse;
  onChoisirReference?(titreId: string): void;
  optionsIndices?: readonly OptionSelecteur[];
  indiceActif?: string;
  onChoisirIndice?(indiceId: string): void;
}

export function OngletPerformances(props: OngletPerformancesProps) {
  const { vue, comparaison, analyse, onChoisirReference } = props;
  const palette = usePalette();
  const [periode, setPeriode] = useState<Periode>('MAX');
  const [mode, setMode] = useState<Mode>('TWR');
  const [classement, setClassement] = useState<'Top' | 'Flop'>('Top');
  const avance = useMemo(
    () => (analyse ? construirePerformancesAvance(analyse, periode) : undefined),
    [analyse, periode],
  );
  const [titreChoisi, setTitreChoisi] = useState<string | undefined>();
  const titreVu = titreChoisi ?? avance?.actions[0]?.titreId;
  const action = useMemo(
    () => (analyse && titreVu ? courbeAction(analyse, titreVu, periode) : undefined),
    [analyse, titreVu, periode],
  );

  // Une barre par année civile, du plus ancien au plus récent.
  const annees = avance
    ? [...avance.mensuels]
        .filter(ligne => ligne.annee_?.brut !== null && ligne.annee_?.brut !== undefined)
        .sort((a, b) => a.annee.localeCompare(b.annee))
        .map(ligne => ({
          libelle: ligne.annee,
          valeur: ligne.annee_!.brut!,
          couleur: ligne.annee_!.brut! >= 0 ? palette.hausse : palette.baisse,
          detail: ligne.annee_!.reference
            ? `${ligne.annee_!.valeur} · référence ${ligne.annee_!.reference}`
            : ligne.annee_!.valeur,
        }))
    : [];

  const echelleMois = avance
    ? Math.max(
        1,
        ...avance.mensuels.flatMap(ligne => ligne.mois.map(cellule => Math.abs(cellule?.brut ?? 0))),
      )
    : 1;

  return (
    <>
      {props.siIndice ? <SiIndice resultat={props.siIndice} /> : null}
      {analyse ? <ComparaisonPeriodes analyse={analyse} /> : null}
      {avance ? (
        <>
          <View style={styles.filtres}>
            <Segments<Periode>
              options={PERIODES}
              actif={periode}
              onChoisir={valeur => setPeriode(valeur)}
              prefixeTest="perf-periode"
            />
            {props.onChoisirIndice && props.optionsIndices ? (
              <Selecteur
                etiquette="Benchmark"
                valeur={props.indiceActif ?? 'aucun'}
                options={[...props.optionsIndices, { valeur: 'aucun', libelle: 'Aucune référence' }]}
                onChoisir={props.onChoisirIndice}
                largeur={210}
              />
            ) : null}
          </View>

          <Rangee>
            <CarteSection titre="Métriques clés" explication="twr">
              <View style={styles.grille}>
                {avance.metriques.map(metrique => (
                  <Metrique
                    key={metrique.libelle}
                    libelle={metrique.libelle}
                    valeur={metrique.valeur}
                    tendance={metrique.tendance}
                  />
                ))}
              </View>
              {annees.length > 0 ? (
                <View testID="barres-annees" style={{ marginTop: ESPACEMENT.s }}>
                  <Text style={[styles.sousTitreGraphique, { color: palette.texteSecondaire }]}>
                    Rendement par année
                  </Text>
                  <Barres
                    barres={annees}
                    formater={valeur => `${valeur.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`}
                    hauteur={150}
                    valeursVisibles
                  />
                </View>
              ) : null}
            </CarteSection>

            <CarteSection
              titre="Performance (TWR)"
              poids={1.7}
              actions={<Segments<Mode> options={['TWR', 'Valeur']} actif={mode} onChoisir={valeur => setMode(valeur)} />}>
              {mode === 'TWR' ? (
                avance.twr.length > 1 ? (
                  <GraphiqueLignes
                    series={[
                      { nom: 'Portefeuille', couleur: palette.series[0], points: avance.twr, aire: true },
                      ...(avance.twrReference.length > 1 && avance.legendeReference
                        ? [{ nom: 'Référence', couleur: palette.reference, points: avance.twrReference }]
                        : []),
                    ]}
                    formater={pourcent}
                    hauteur={300}
                    legende={[
                      { couleur: palette.series[0], texte: avance.legendeTwr },
                      ...(avance.legendeReference && avance.twrReference.length > 1
                        ? [{ couleur: palette.reference, texte: avance.legendeReference }]
                        : []),
                    ]}
                  />
                ) : (
                  <Vide>Pas assez de valorisations sur cette période pour tracer une courbe.</Vide>
                )
              ) : avance.valeur.length > 1 ? (
                <GraphiqueLignes
                  series={[
                    { nom: 'Valeur', couleur: palette.series[0], points: avance.valeur, aire: true },
                    { nom: 'Montant investi', couleur: palette.reference, points: avance.investi },
                  ]}
                  formater={euros}
                  hauteur={300}
                  legende={[
                    { couleur: palette.series[0], texte: 'Valeur du portefeuille' },
                    { couleur: palette.reference, texte: 'Montant investi (versements nets)' },
                  ]}
                />
              ) : (
                <Vide>Pas assez de valorisations sur cette période pour tracer une courbe.</Vide>
              )}
            </CarteSection>
          </Rangee>

          {avance.mensuels.length > 0 ? (
            <CarteSection titre="Rendements mensuels (TWR)">
              <ScrollView horizontal>
                <View>
                  <View style={styles.ligneMois}>
                    <View style={styles.celluleAnnee} />
                    {[...MOIS, 'Année'].map(mois => (
                      <View key={mois} style={styles.celluleMois}>
                        <Text style={[styles.enteteMois, { color: palette.texteSecondaire }]}>{mois}</Text>
                      </View>
                    ))}
                  </View>
                  {[...avance.mensuels, { annee: 'Moy.', mois: avance.moyenneMensuelle, annee_: null }].map(ligne => (
                    <View key={ligne.annee} style={styles.ligneMois}>
                      <View style={styles.celluleAnnee}>
                        <Text style={{ color: palette.texte, fontWeight: '700', fontSize: 12 }}>{ligne.annee}</Text>
                      </View>
                      {[...ligne.mois, ligne.annee_].map((cellule, index) => (
                        <View
                          key={index}
                          style={[
                            styles.celluleMois,
                            {
                              backgroundColor: couleurChaleur(palette, cellule?.brut ?? null, echelleMois),
                              borderColor: palette.bordure,
                            },
                          ]}>
                          {cellule ? (
                            <>
                              <Text
                                style={{
                                  color: (cellule.brut ?? 0) >= 0 ? palette.hausse : palette.baisse,
                                  fontSize: 11.5,
                                  fontWeight: '700',
                                }}>
                                {cellule.valeur}
                              </Text>
                              {cellule.reference ? (
                                <Text style={{ color: palette.texteSecondaire, fontSize: 9.5 }}>{cellule.reference}</Text>
                              ) : null}
                            </>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            </CarteSection>
          ) : null}

          <Rangee>
            <CarteSection
              titre="Performance des actions"
              poids={1.7}
              actions={
                avance.actions.length > 0 && titreVu ? (
                  <Selecteur
                    etiquette="Titre"
                    valeur={titreVu}
                    options={avance.actions.map(ligne => ({ valeur: ligne.titreId, libelle: ligne.nom }))}
                    onChoisir={setTitreChoisi}
                    largeur={220}
                  />
                ) : null
              }>
              {action && action.titre.length > 1 ? (
                <GraphiqueLignes
                  series={[
                    { nom: 'Titre', couleur: palette.series[0], points: action.titre, aire: true },
                    ...(action.reference.length > 1
                      ? [{ nom: 'Référence', couleur: palette.reference, points: action.reference }]
                      : []),
                  ]}
                  marqueurs={action.marqueurs}
                  formater={pourcent}
                  hauteur={280}
                  legende={[
                    { couleur: palette.series[0], texte: 'Cours du titre' },
                    ...(action.reference.length > 1 ? [{ couleur: palette.reference, texte: 'Référence' }] : []),
                    { couleur: palette.hausse, texte: 'Achats' },
                    { couleur: palette.baisse, texte: 'Ventes' },
                  ]}
                />
              ) : (
                <Vide>Aucun historique de cours pour ce titre sur la période.</Vide>
              )}
            </CarteSection>

            <CarteSection
              titre="Titres vs benchmark"
              actions={
                <Segments<'Top' | 'Flop'>
                  options={['Top', 'Flop']}
                  actif={classement}
                  onChoisir={valeur => setClassement(valeur)}
                />
              }>
              {(classement === 'Top' ? avance.titresVsReference.mieux : avance.titresVsReference.moins).length ===
              0 ? (
                <Vide>
                  {classement === 'Top'
                    ? 'Aucune ligne ne fait mieux que la référence sur la période.'
                    : 'Aucune ligne ne fait moins bien que la référence sur la période.'}
                </Vide>
              ) : (
                (classement === 'Top' ? avance.titresVsReference.mieux : avance.titresVsReference.moins).map(ligne => (
                  <View key={ligne.titreId} style={[styles.ligneTitre, { borderBottomColor: palette.bordure }]}>
                    <Text numberOfLines={1} style={{ color: palette.texte, fontWeight: '600', flex: 1 }}>
                      {ligne.nom}
                    </Text>
                    <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>{ligne.perf}</Text>
                    <Signe texte={ligne.ecart.texte} tendance={ligne.ecart.tendance} taille={13} />
                  </View>
                ))
              )}
            </CarteSection>
          </Rangee>
        </>
      ) : null}

      <Rangee>
        <CarteSection titre="Sur tout l’historique">
          {vue.messageHistorique ? (
            <>
              <Text style={{ color: palette.texte, fontWeight: '600' }}>Historique insuffisant</Text>
              <SousTitre>{vue.messageHistorique}</SousTitre>
            </>
          ) : (
            <SousTitre>
              {vue.nombrePoints} valorisations sur {Math.round(vue.jours)} jours
            </SousTitre>
          )}
          <View style={styles.paire}>
            <IndicateurMesure etiquette="TWR" mesure={vue.twr} explication="twr" />
            <IndicateurMesure etiquette="TRI" mesure={vue.tri} explication="tri" />
          </View>
          <View style={styles.paire}>
            <IndicateurMesure etiquette="Rendement annualisé" mesure={vue.rendementAnnualise} explication="cagr" />
            <IndicateurMesure etiquette="Volatilité" mesure={vue.volatilite} explication="volatilite" />
          </View>
          <View style={styles.paire}>
            <IndicateurMesure etiquette="Ratio de Sharpe" mesure={vue.sharpe} explication="sharpe" />
            <IndicateurMesure etiquette="Perte maximale" mesure={vue.perteMaximale} explication="drawdown" />
          </View>
          {vue.dateCreux ? <SousTitre>Creux atteint le {vue.dateCreux}.</SousTitre> : null}
        </CarteSection>

        <CarteSection
          titre="Face à une de vos valeurs"
          avantTitre={null}
          actions={comparaison.nom ? <Explication cle="alpha" /> : null}>
          {comparaison.nom ? (
            <>
              <View style={styles.paire}>
                <IndicateurMesure etiquette="Vous" mesure={comparaison.portefeuille} />
                <IndicateurMesure etiquette={comparaison.nom} mesure={comparaison.reference} />
              </View>
              <IndicateurMesure etiquette="Écart" mesure={comparaison.ecart} tendance={comparaison.tendanceEcart} />
              {comparaison.verdict ? <SousTitre>{comparaison.verdict}</SousTitre> : null}
              {comparaison.periode ? <SousTitre>{comparaison.periode}</SousTitre> : null}
              <View style={styles.paire}>
                <IndicateurMesure etiquette="Bêta" mesure={comparaison.beta} explication="beta" />
                <IndicateurMesure etiquette="Alpha" mesure={comparaison.alpha} explication="alpha" />
              </View>
              <IndicateurMesure
                etiquette="Corrélation à la référence"
                mesure={comparaison.correlation}
                explication="correlation"
              />
            </>
          ) : null}

          {comparaison.message ? <SousTitre>{comparaison.message}</SousTitre> : null}

          {onChoisirReference ? (
            <View style={styles.choix}>
              {comparaison.choix.map(choix => (
                <Pressable
                  key={choix.titreId}
                  testID={`reference-${choix.titreId}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: choix.retenu }}
                  onPress={() => onChoisirReference(choix.titreId)}
                  style={[
                    styles.puce,
                    {
                      borderColor: choix.retenu ? palette.accentPlein : palette.bordure,
                      backgroundColor: choix.retenu ? palette.accentPlein : 'transparent',
                    },
                  ]}>
                  <Text style={{ fontSize: 13, color: choix.retenu ? palette.surAccent : palette.texte }}>
                    {choix.nom} · {choix.releves} relevé(s)
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </CarteSection>
      </Rangee>
    </>
  );
}

const styles = StyleSheet.create({
  ligneComparaison: { flexDirection: 'row', alignItems: 'center', paddingVertical: ESPACEMENT.s, borderTopWidth: StyleSheet.hairlineWidth, gap: ESPACEMENT.s },
  celluleLibelle: { flex: 1.2, fontSize: 13 },
  cellule: { flex: 1, textAlign: 'right', fontSize: 13 },
  sousTitreGraphique: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  filtres: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ESPACEMENT.m, zIndex: 20 },
  grille: { flexDirection: 'row', flexWrap: 'wrap', rowGap: ESPACEMENT.m, columnGap: ESPACEMENT.l },
  paire: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.m },
  ligneMois: { flexDirection: 'row' },
  celluleAnnee: { width: 56, minHeight: 44, justifyContent: 'center' },
  celluleMois: {
    width: 74,
    minHeight: 44,
    margin: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  enteteMois: { fontSize: 11.5, fontWeight: '700' },
  ligneTitre: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ESPACEMENT.m,
    minHeight: 40,
    borderBottomWidth: 1,
  },
  choix: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.s },
  puce: {
    borderWidth: 1,
    borderRadius: RAYON.l,
    paddingHorizontal: ESPACEMENT.m,
    paddingVertical: ESPACEMENT.s,
  },
});

const eurosSi = (valeur: number) => formaterMontant(Decimal.de(valeur.toFixed(2)), { decimales: 0 });
const pourcentSi = (valeur: number | null) =>
  valeur === null ? '—' : `${valeur >= 0 ? '+' : ''}${valeur.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;

/** « Et si tout était sur le MSCI World ? » : vos choix face à un placement tout simple. */
function SiIndice({ resultat }: { resultat: ResultatSiIndice }) {
  const palette = usePalette();
  const mieux = resultat.ecart >= 0;
  return (
    <CarteSection titre="Et si tout était sur le MSCI World ?" testID="si-indice">
      <Text style={{ color: palette.texte, fontSize: 16, lineHeight: 23 }}>
        {Math.abs(resultat.ecart) < 1
          ? 'Vos choix font exactement comme le MSCI World.'
          : mieux
            ? `Vos choix vous ont rapporté ${eurosSi(resultat.ecart)} de plus que si chaque euro était allé dans un ETF MSCI World.`
            : `Un ETF MSCI World aurait rapporté ${eurosSi(-resultat.ecart)} de plus que vos choix, avec le même argent aux mêmes dates.`}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.l }}>
        <Metrique libelle="Argent investi" valeur={eurosSi(resultat.investi)} />
        <Metrique libelle="Votre portefeuille" valeur={`${eurosSi(resultat.valeurReelle)} · ${pourcentSi(resultat.performanceReelle)}`} tendance={mieux ? 'hausse' : 'baisse'} />
        <Metrique libelle="Tout en MSCI World" valeur={`${eurosSi(resultat.valeurIndice)} · ${pourcentSi(resultat.performanceIndice)}`} />
      </View>
      {resultat.courbe.length > 1 ? (
        <GraphiqueLignes
          series={[{ nom: 'Tout en MSCI World', couleur: palette.reference, points: resultat.courbe, aire: true }]}
          formater={valeur => eurosSi(valeur)}
          hauteur={180}
        />
      ) : null}
      <SousTitre>
        Chaque versement (ou, à défaut, chaque achat) est rejoué le même jour dans l’ETF CW8, au cours de clôture.
        {resultat.approximatif ? ' Certains flux précèdent l’historique chargé : leur prix est approché par le premier cours connu.' : ''}
      </SousTitre>
    </CarteSection>
  );
}

/** Cette année face à la même période l'an dernier ; trimestre ; mois. */
function ComparaisonPeriodes({ analyse }: { analyse: EntreesAnalyse }) {
  const palette = usePalette();
  const [choix, setChoix] = useState<ChoixPeriodes>('annee');
  const { actuelle, precedente } = periodesComparees(choix, analyse.aujourdhui);
  const a = mesurerPeriode(actuelle, analyse.points, analyse.transactions);
  const b = mesurerPeriode(precedente, analyse.points, analyse.transactions);
  const lignes: Array<{ libelle: string; lire(m: MesuresPeriode): number | null; format: 'pct' | 'euros' | 'nombre'; plusEstMieux?: boolean }> = [
    { libelle: 'Performance', lire: m => m.performance, format: 'pct', plusEstMieux: true },
    { libelle: 'Gain', lire: m => m.gain, format: 'euros', plusEstMieux: true },
    { libelle: 'Dividendes reçus', lire: m => m.dividendes, format: 'euros', plusEstMieux: true },
    { libelle: 'Versements nets', lire: m => m.versementsNets, format: 'euros' },
    { libelle: 'Achats', lire: m => m.achats, format: 'euros' },
    { libelle: 'Ventes', lire: m => m.ventes, format: 'euros' },
    { libelle: 'Opérations', lire: m => m.operations, format: 'nombre' },
  ];
  const texte = (valeur: number | null, format: 'pct' | 'euros' | 'nombre') =>
    valeur === null ? '—' : format === 'pct' ? pourcentSi(valeur) : format === 'euros' ? eurosSi(valeur) : String(valeur);
  return (
    <CarteSection
      titre="Comparer deux périodes"
      testID="comparaison-periodes"
      actions={
        <Segments<ChoixPeriodes>
          options={['annee', 'trimestre', 'mois']}
          actif={choix}
          onChoisir={setChoix}
          libelle={option => (option === 'annee' ? 'Année' : option === 'trimestre' ? 'Trimestre' : 'Mois')}
          prefixeTest="periodes"
        />
      }>
      <View style={[styles.ligneComparaison, { borderColor: palette.bordure }]}>
        <Text style={[styles.celluleLibelle, { color: palette.texteSecondaire }]} />
        <Text style={[styles.cellule, { color: palette.texte, fontWeight: '700' }]}>{actuelle.libelle}</Text>
        <Text style={[styles.cellule, { color: palette.texteSecondaire, fontWeight: '700' }]}>{precedente.libelle}</Text>
      </View>
      {lignes.map(ligne => {
        const va = ligne.lire(a);
        const vb = ligne.lire(b);
        const mieux = ligne.plusEstMieux && va !== null && vb !== null && va !== vb ? va > vb : undefined;
        return (
          <View key={ligne.libelle} style={[styles.ligneComparaison, { borderColor: palette.bordure }]}>
            <Text style={[styles.celluleLibelle, { color: palette.texteSecondaire }]}>{ligne.libelle}</Text>
            <Text
              style={[
                styles.cellule,
                { color: mieux === undefined ? palette.texte : mieux ? palette.hausse : palette.baisse, fontWeight: '700' },
              ]}>
              {texte(va, ligne.format)}
              {mieux === undefined ? '' : mieux ? ' ↗' : ' ↘'}
            </Text>
            <Text style={[styles.cellule, { color: palette.texteSecondaire }]}>{texte(vb, ligne.format)}</Text>
          </View>
        );
      })}
      <SousTitre>À durée égale : la période précédente s’arrête au même jour pour que la comparaison soit juste.</SousTitre>
    </CarteSection>
  );
}
