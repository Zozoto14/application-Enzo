/**
 * Portefeuille, en onglets.
 *
 * Reprend l'organisation éprouvée des outils du domaine : un résumé, puis un
 * onglet par question qu'on se pose réellement — que vaut mon portefeuille,
 * comment se comporte-t-il, d'où vient l'argent, ce que je devrai à l'impôt.
 *
 * Chaque chiffre porte son explication. C'est le point qui distingue cet
 * écran d'un tableau de nombres : un TWR sans explication se confond avec un
 * TRI, et une plus-value latente se prend pour un gain acquis.
 */

import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  Bouton,
  Carte,
  LARGEUR_MULTICOLONNE,
  SousTitre,
  Variation,
  usePalette,
} from '../composants';
import {
  BoutonOutil,
  CarteSection,
  Pastille,
  Rangee,
  Segments,
  Selecteur,
  Signe,
  Vide,
  type OptionSelecteur,
} from '../elements';
import { Donut, GraphiqueLignes } from '../graphiques/Graphiques';
import { Explication, Indicateur, IndicateurMesure, Jauge } from '../indicateurs';
import { ESPACEMENT, RAYON, palettePour, stylesPartages } from '../theme';
import { PERIODES, type Periode } from '../../core/performance/cumul';
import type { VueDashboard } from '../vues/dashboard';
import type { VueComparaison } from '../vues/comparaison';
import type { VueDividendes } from '../vues/dividendes';
import type { VueFlux, VueImpots, VuePerformance } from '../vues/onglets';
import type { VueRisque } from '../vues/risque';
import { courbePerformance, type LigneClassement, type VueResume } from '../vues/resume';

export type OngletPortefeuille =
  | 'resume'
  | 'positions'
  | 'performances'
  | 'dividendes'
  | 'risque'
  | 'flux'
  | 'impots';

const ONGLETS: Array<{ cle: OngletPortefeuille; libelle: string }> = [
  { cle: 'resume', libelle: 'Résumé' },
  { cle: 'positions', libelle: 'Positions' },
  { cle: 'risque', libelle: 'Risque' },
  { cle: 'performances', libelle: 'Performances' },
  { cle: 'dividendes', libelle: 'Dividendes' },
  { cle: 'flux', libelle: 'Flux' },
  { cle: 'impots', libelle: 'Impôts' },
];

/** Valeur du sélecteur de compte qui désigne l'ensemble des comptes. */
export const TOUS_LES_COMPTES = 'tous';
/** Valeur du sélecteur de référence qui retire toute comparaison. */
export const AUCUN_INDICE = 'aucun';

export interface PortefeuilleProps {
  dashboard: VueDashboard;
  resume?: VueResume;
  performance: VuePerformance;
  comparaison: VueComparaison;
  dividendes: VueDividendes;
  risque: VueRisque;
  flux: VueFlux;
  impots: VueImpots;
  /** Date du jour, qui fixe le début des périodes YTD, 1A… */
  aujourdhui?: string;
  onglet?: OngletPortefeuille;
  onChangerOnglet?(onglet: OngletPortefeuille): void;
  /** Comptes proposés au filtre, hors « Tous ». */
  optionsComptes?: readonly OptionSelecteur[];
  compteActif?: string;
  onChoisirCompte?(compteId: string): void;
  /** Indices proposés comme référence de performance. */
  optionsIndices?: readonly OptionSelecteur[];
  indiceActif?: string;
  onChoisirIndice?(indiceId: string): void;
  onChargerHistorique?(): void;
  chargementHistorique?: boolean;
  messageHistorique?: string;
  onOuvrirTitre?(titreId: string): void;
  onCreerCompte?(): void;
  onAjouterTransaction?(): void;
  onImporter?(): void;
  onReglages?(): void;
  onSauvegarder?(): void;
  onNotifications?(): void;
  onProjection?(): void;
  onWatchlist?(): void;
  onComparer?(): void;
  onChoisirReference?(titreId: string): void;
  /** Années pour lesquelles un rapport annuel a du sens. */
  anneesRapport?: readonly number[];
  onGenererRapport?(annee: number): void;
  messageRapport?: string;
  onRafraichirCours?(): void;
  messageCours?: string;
  rafraichissementEnCours?: boolean;
  onVerrouiller?(): void;
}

export function Portefeuille(props: PortefeuilleProps) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  // Au-dela du seuil, les cartes se rangent en colonnes au lieu de s'etirer
  // sur toute la largeur. Vaut pour l'iPad en paysage comme pour le bureau.
  const grille =
    width >= LARGEUR_MULTICOLONNE
      ? ({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' } as const)
      : undefined;
  const [interne, setInterne] = useState<OngletPortefeuille>('resume');
  const actif = props.onglet ?? interne;

  const changer = (cle: OngletPortefeuille) => {
    setInterne(cle);
    props.onChangerOnglet?.(cle);
  };

  // Le Résumé gère lui-même sa disposition en rangées ; les autres onglets
  // gardent la grille de cartes qui se replient d'elles-mêmes.
  const contenuOnglet = actif === 'resume' ? styles.contenuResume : [stylesPartages.contenu, grille];

  return (
    <View style={[stylesPartages.ecran, { backgroundColor: palettePour().fond }]}>
      <ScrollView contentContainerStyle={styles.page} stickyHeaderIndices={[]}>
        <EnTete {...props} />

        <View style={[styles.barreOnglets, { borderBottomColor: palette.bordure }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.onglets}>
            {ONGLETS.map(onglet => {
              const selectionne = onglet.cle === actif;
              return (
                <Pressable
                  key={onglet.cle}
                  testID={`onglet-${onglet.cle}`}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: selectionne }}
                  onPress={() => changer(onglet.cle)}
                  style={[
                    styles.onglet,
                    selectionne && { borderBottomColor: palette.accent },
                  ]}>
                  <Text
                    style={{
                      color: selectionne ? palette.accent : palette.texte,
                      fontWeight: selectionne ? '700' : '600',
                      fontSize: 14,
                    }}>
                    {onglet.libelle}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={contenuOnglet}>
          {actif === 'resume' ? <Resume {...props} /> : null}
          {actif === 'positions' ? <Positions dashboard={props.dashboard} /> : null}
          {actif === 'performances' ? (
            <Performances
              vue={props.performance}
              comparaison={props.comparaison}
              onChoisirReference={props.onChoisirReference}
            />
          ) : null}
          {actif === 'dividendes' ? <Dividendes vue={props.dividendes} /> : null}
          {actif === 'risque' ? <Risque vue={props.risque} /> : null}
          {actif === 'flux' ? <Flux vue={props.flux} /> : null}
          {actif === 'impots' ? (
            <Impots
              vue={props.impots}
              annees={props.anneesRapport}
              onGenerer={props.onGenererRapport}
              message={props.messageRapport}
            />
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

// ------------------------------------------------------------------ En-tête

function EnTete(props: PortefeuilleProps) {
  const palette = usePalette();
  const { dashboard, resume } = props;
  const comptes: OptionSelecteur[] = [
    { valeur: TOUS_LES_COMPTES, libelle: 'Tous' },
    ...(props.optionsComptes ?? []),
  ];

  return (
    <View style={styles.enTete}>
      <View style={styles.ligneTitre}>
        <View style={{ gap: 2, flexShrink: 1 }}>
          <Text style={[styles.grandTitre, { color: palette.texte }]} accessibilityRole="header">
            Portefeuille
          </Text>
          {resume ? (
            <Text style={{ color: palette.texteSecondaire, fontSize: 13 }}>{resume.sousTitre}</Text>
          ) : null}
        </View>

        <View style={styles.commandes}>
          {resume ? (
            <Text style={{ color: palette.texteSecondaire, fontSize: 13 }}>
              Devise :{' '}
              <Text style={{ color: palette.texte, fontWeight: '700' }}>{resume.devise}</Text>
            </Text>
          ) : null}
          {props.onChoisirCompte && comptes.length > 2 ? (
            <Selecteur
              etiquette="Compte"
              valeur={props.compteActif ?? TOUS_LES_COMPTES}
              options={comptes}
              onChoisir={props.onChoisirCompte}
              testID="selecteur-compte"
            />
          ) : null}
          {props.onReglages ? (
            <Pressable
              testID="bouton-reglages"
              accessibilityRole="button"
              onPress={props.onReglages}
              style={({ pressed }) => [
                styles.parametres,
                { backgroundColor: palette.accentPlein, opacity: pressed ? 0.85 : 1 },
              ]}>
              <Text style={{ color: palette.surAccent, fontWeight: '700', fontSize: 14 }}>
                Paramètres
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.outils}>
        {props.onAjouterTransaction && !dashboard.sansCompte ? (
          <BoutonOutil
            titre="+ Nouvelle opération"
            plein
            testID="bouton-ajouter"
            onPress={props.onAjouterTransaction}
          />
        ) : null}
        {props.onCreerCompte ? (
          <BoutonOutil
            titre={dashboard.sansCompte ? '+ Créer un compte' : 'Nouveau compte'}
            plein={dashboard.sansCompte}
            testID="bouton-creer-compte-depuis-tableau"
            onPress={props.onCreerCompte}
          />
        ) : null}
        {props.onImporter && !dashboard.sansCompte ? (
          <BoutonOutil
            titre="Importer"
            testID="bouton-importer-positions"
            onPress={props.onImporter}
          />
        ) : null}
        {props.onRafraichirCours && !dashboard.sansCompte ? (
          <BoutonOutil
            titre={props.rafraichissementEnCours ? 'Récupération…' : 'Actualiser les cours'}
            testID="bouton-rafraichir-cours"
            desactive={props.rafraichissementEnCours}
            onPress={props.onRafraichirCours}
          />
        ) : null}
        {props.onWatchlist ? (
          <BoutonOutil titre="Surveillance" testID="bouton-watchlist" onPress={props.onWatchlist} />
        ) : null}
        {props.onComparer ? (
          <BoutonOutil titre="Comparateur" testID="bouton-comparateur" onPress={props.onComparer} />
        ) : null}
        {props.onProjection ? (
          <BoutonOutil titre="Projection" testID="bouton-projection" onPress={props.onProjection} />
        ) : null}
        {props.onSauvegarder ? (
          <BoutonOutil titre="Sauvegarde" testID="bouton-sauvegarde" onPress={props.onSauvegarder} />
        ) : null}
        {props.onNotifications ? (
          <BoutonOutil
            titre="Notifications"
            testID="bouton-notifications"
            onPress={props.onNotifications}
          />
        ) : null}
        {props.onVerrouiller ? (
          <BoutonOutil titre="Verrouiller" testID="bouton-verrouiller" onPress={props.onVerrouiller} />
        ) : null}
      </View>

      {props.messageCours ? (
        <Text accessibilityLiveRegion="polite" style={{ color: palette.texteSecondaire, fontSize: 13 }}>
          {props.messageCours}
        </Text>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Résumé

function Resume(props: PortefeuilleProps) {
  const palette = usePalette();
  const { dashboard, resume } = props;

  const avertissements = (
    <>
      {dashboard.sansCompte ? (
        <CarteSection titre="Aucun compte pour l'instant.">
          <Vide>
            Créez d&apos;abord un compte : c&apos;est lui qui portera vos positions et vos
            liquidités.
          </Vide>
          {props.onCreerCompte ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <Bouton titre="Créer un compte" onPress={props.onCreerCompte} />
            </View>
          ) : null}
        </CarteSection>
      ) : dashboard.portefeuilleVide ? (
        <CarteSection titre="Aucune position pour l'instant.">
          <Vide>
            Importez vos positions depuis votre courtier ou saisissez une première opération.
          </Vide>
        </CarteSection>
      ) : null}

      {dashboard.titresSansCours.length > 0 ? (
        <CarteSection>
          <View style={styles.ligneEnTete}>
            <Text style={{ color: palette.danger, fontWeight: '600' }}>
              Cours inconnu, valeurs exclues du total
            </Text>
            <Explication cle="coursInconnu" />
          </View>
          <SousTitre>{dashboard.titresSansCours.join(', ')}</SousTitre>
        </CarteSection>
      ) : null}
    </>
  );

  if (!resume) {
    // Vue minimale, quand l'assemblage ne fournit pas le résumé complet.
    return (
      <>
        <CarteSection>
          <Indicateur
            etiquette="Valeur totale"
            valeur={dashboard.valeurTotale}
            explication="valeurTotale"
            grand
          />
          <View style={styles.paire}>
            <Indicateur
              etiquette="Plus-value latente"
              valeur={dashboard.plusValueLatente}
              explication="plusValueLatente"
              tendance={dashboard.tendance}
              precision={dashboard.plusValueLatentePct}
            />
            <Indicateur etiquette="Liquidités" valeur={dashboard.cash} />
          </View>
        </CarteSection>
        {avertissements}
      </>
    );
  }

  return (
    <>
      {avertissements}

      <Rangee>
        <CarteSection titre="Valeur totale" explication="valeurTotale" testID="carte-valeur-totale">
          <View style={styles.chiffre}>
            <Text style={[styles.grandChiffre, { color: palette.texte }]}>{resume.valeurTotale}</Text>
            <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
              sur <Text style={{ color: palette.texte, fontWeight: '700' }}>{resume.investi}</Text>{' '}
              investis
            </Text>
          </View>
          <View style={styles.ligneEnTete}>
            <Pastille texte={resume.totalReturnPct.texte} tendance={resume.totalReturnPct.tendance} />
            <Text style={{ color: palette.texte, fontSize: 12 }}>Total Return</Text>
          </View>
          <View style={styles.paire}>
            <Indicateur etiquette="Liquidités" valeur={dashboard.cash} />
            <Indicateur
              etiquette="Plus-value latente"
              valeur={dashboard.plusValueLatente}
              tendance={dashboard.tendance}
            />
          </View>
        </CarteSection>

        <CarteSection titre="Total Return" explication="totalReturn" testID="carte-total-return">
          <Signe texte={resume.totalReturn.texte} tendance={resume.totalReturn.tendance} taille={26} />
          <View style={styles.ligneEnTete}>
            {resume.tri ? (
              <Pastille texte={resume.tri.texte} tendance={resume.tri.tendance} />
            ) : (
              <Pastille texte="—" tendance="neutre" />
            )}
            <Text style={{ color: palette.texte, fontSize: 12 }}>TRI (rendement annualisé)</Text>
            <Explication cle="tri" />
          </View>
          {!resume.tri && resume.motifTri ? <Vide>{resume.motifTri}</Vide> : null}
        </CarteSection>

        <CarteSection titre="Dividendes" explication="rendementCourant" testID="carte-dividendes">
          <View style={styles.chiffre}>
            <Text style={[styles.grandChiffre, { color: palette.texte }]}>{resume.dividendes}</Text>
            <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>de dividendes perçus</Text>
          </View>
          <View style={styles.ligneEnTete}>
            <Pastille texte={resume.rendementDividendes} tendance="neutre" />
            <Text style={{ color: palette.texte, fontSize: 12 }}>de rendement sur douze mois</Text>
          </View>
        </CarteSection>
      </Rangee>

      <Rangee>
        <CourbeResume {...props} resume={resume} />
        <CarteSection titre="Répartition des comptes" poids={1}>
          <Donut
            parts={resume.repartitionComptes.map(part => ({
              libelle: part.libelle,
              valeur: part.valeur,
              detail: part.texte,
            }))}
            formater={valeur =>
              `${valeur.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
            }
            hauteur={300}
            testID="donut-comptes"
          />
        </CarteSection>
      </Rangee>

      <Rangee>
        <Classement
          titre="Top 5"
          lignes={resume.top}
          vide="Aucune ligne en plus-value."
          onOuvrir={props.onOuvrirTitre}
        />
        <Classement
          titre="Flop 5"
          lignes={resume.flop}
          vide="Aucune ligne en moins-value."
          onOuvrir={props.onOuvrirTitre}
        />
      </Rangee>

      {resume.comptes.map(compte => (
        <CarteSection key={compte.compteId} testID={`carte-compte-${compte.compteId}`}>
          <View style={styles.carteCompte}>
            <View style={styles.identiteCompte}>
              <View style={styles.ligneEnTete}>
                <View style={[styles.badge, { backgroundColor: palette.accentPlein }]}>
                  <Text style={{ color: palette.surAccent, fontSize: 11, fontWeight: '800' }}>
                    {compte.type}
                  </Text>
                </View>
                <Text style={{ color: palette.texte, fontWeight: '700', fontSize: 15 }}>
                  {compte.nom}
                </Text>
              </View>
              <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
                Depuis le {compte.depuis}
              </Text>
              <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
                Frais : <Text style={{ color: palette.texte }}>{compte.frais}</Text>
              </Text>
              <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
                Solde : <Text style={{ color: palette.hausse, fontWeight: '700' }}>{compte.solde}</Text>
              </Text>
            </View>
            <View style={styles.blocCompte}>
              <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>Valeur totale</Text>
              <Text style={{ color: palette.texte, fontWeight: '800', fontSize: 16 }}>
                {compte.valeurTotale}
              </Text>
              <Text style={{ color: palette.texteSecondaire, fontSize: 11 }}>sur {compte.investi} investis</Text>
              <Pastille texte={compte.totalReturnPct.texte} tendance={compte.totalReturnPct.tendance} />
            </View>
            <View style={styles.blocCompte}>
              <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>Total Return</Text>
              <Signe texte={compte.totalReturn.texte} tendance={compte.totalReturn.tendance} taille={16} />
              {compte.tri ? (
                <View style={styles.ligneEnTete}>
                  <Pastille texte={compte.tri.texte} tendance={compte.tri.tendance} />
                  <Text style={{ color: palette.texteSecondaire, fontSize: 11 }}>TRI</Text>
                </View>
              ) : (
                <Text style={{ color: palette.texteSecondaire, fontSize: 11 }}>TRI : —</Text>
              )}
            </View>
            <View style={styles.blocCompte}>
              <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>Dividendes</Text>
              <Text style={{ color: palette.texte, fontWeight: '800', fontSize: 16 }}>
                {compte.dividendes}
              </Text>
              <Pastille texte={compte.rendementDividendes} tendance="neutre" />
            </View>
          </View>
        </CarteSection>
      ))}
    </>
  );
}

function CourbeResume(props: PortefeuilleProps & { resume: VueResume }) {
  const palette = usePalette();
  const [periode, setPeriode] = useState<Periode>('1A');
  const { resume } = props;
  const aujourdhui = props.aujourdhui ?? new Date().toISOString().slice(0, 10);
  const courbe = courbePerformance(resume, periode, aujourdhui);

  const indices: OptionSelecteur[] = [
    ...(props.optionsIndices ?? []),
    { valeur: AUCUN_INDICE, libelle: 'Aucune référence' },
  ];

  const legende = [
    {
      couleur: palette.series[0],
      texte: `Performance (${courbe.performance?.texte ?? '—'}${courbe.cagr ? ` · CAGR ${courbe.cagr}` : ''})`,
    },
    ...(resume.nomReference && courbe.reference.length > 1
      ? [
          {
            couleur: palette.reference,
            texte: `${resume.nomReference} (${courbe.performanceReference?.texte ?? '—'}${
              courbe.cagrReference ? ` · CAGR ${courbe.cagrReference}` : ''
            })`,
          },
        ]
      : []),
  ];

  return (
    <CarteSection
      titre="Performance (TWR)"
      explication="twr"
      poids={1.5}
      testID="carte-performance"
      actions={
        <>
          <Segments<Periode>
            options={PERIODES}
            actif={periode}
            onChoisir={valeur => setPeriode(valeur)}
            prefixeTest="periode"
          />
          {courbe.performance ? (
            <Pastille texte={courbe.performance.texte} tendance={courbe.performance.tendance} />
          ) : null}
          {props.onChoisirIndice ? (
            <Selecteur
              etiquette="Référence"
              valeur={props.indiceActif ?? AUCUN_INDICE}
              options={indices}
              onChoisir={props.onChoisirIndice}
              largeur={190}
              testID="selecteur-indice"
            />
          ) : null}
        </>
      }>
      {resume.sansHistorique || courbe.portefeuille.length < 2 ? (
        <View style={{ gap: ESPACEMENT.m, minHeight: 200, justifyContent: 'center' }}>
          <Vide>
            {resume.sansHistorique
              ? 'Pas encore d’historique de cours : la courbe se trace à partir des cours passés de vos valeurs.'
              : 'Pas assez de points sur cette période pour tracer une courbe. Choisissez une période plus longue.'}
          </Vide>
          {resume.sansHistorique && props.onChargerHistorique ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <Bouton
                titre={props.chargementHistorique ? 'Chargement…' : 'Charger l’historique des cours'}
                desactive={props.chargementHistorique}
                onPress={props.onChargerHistorique}
                testID="bouton-charger-historique"
              />
            </View>
          ) : null}
          {props.messageHistorique ? <Vide>{props.messageHistorique}</Vide> : null}
        </View>
      ) : (
        <GraphiqueLignes
          series={[
            { nom: 'Portefeuille', couleur: palette.series[0], points: courbe.portefeuille, aire: true },
            ...(resume.nomReference && courbe.reference.length > 1
              ? [{ nom: resume.nomReference, couleur: palette.reference, points: courbe.reference }]
              : []),
          ]}
          formater={formaterPct}
          hauteur={300}
          legende={legende}
          testID="courbe-performance"
        />
      )}
    </CarteSection>
  );
}

function formaterPct(valeur: number): string {
  return `${valeur.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}

function Classement({
  titre,
  lignes,
  vide,
  onOuvrir,
}: {
  titre: string;
  lignes: readonly LigneClassement[];
  vide: string;
  onOuvrir?(titreId: string): void;
}) {
  const palette = usePalette();
  return (
    <CarteSection titre={titre}>
      {lignes.length === 0 ? (
        <Vide>{vide}</Vide>
      ) : (
        lignes.map((ligne, index) => (
          <Pressable
            key={ligne.titreId}
            accessibilityRole={onOuvrir ? 'button' : undefined}
            disabled={!onOuvrir}
            onPress={() => onOuvrir?.(ligne.titreId)}
            style={({ pressed }) => [styles.ligneClassement, { opacity: pressed ? 0.7 : 1 }]}>
            <Text style={{ color: palette.texteSecondaire, width: 16, fontWeight: '700' }}>
              {index + 1}
            </Text>
            <View style={[styles.logo, { backgroundColor: palette.surfaceHaute, borderColor: palette.bordure }]}>
              <Text style={{ color: palette.texte, fontSize: 10, fontWeight: '800' }}>
                {(ligne.symbole || ligne.nom).slice(0, 4).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text numberOfLines={1} style={{ color: palette.texte, fontWeight: '700', fontSize: 13 }}>
                {ligne.nom}
              </Text>
              {ligne.symbole ? (
                <Text style={{ color: palette.accent, fontSize: 11 }}>{ligne.symbole}</Text>
              ) : null}
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Signe texte={ligne.variationPct.texte} tendance={ligne.variationPct.tendance} taille={13} />
              <Text style={{ color: palette.texteSecondaire, fontSize: 11 }}>{ligne.variation.texte}</Text>
            </View>
          </Pressable>
        ))
      )}
    </CarteSection>
  );
}

// --------------------------------------------------------------- Positions

function Positions({ dashboard }: { dashboard: VueDashboard }) {
  const palette = usePalette();

  if (dashboard.positions.length === 0) {
    return (
      <Carte>
        <Text style={{ color: palette.texte }}>Aucune position à afficher.</Text>
      </Carte>
    );
  }

  return (
    <>
      <Carte>
        <View style={styles.ligneEnTete}>
          <Text style={[styles.sectionTitre, { color: palette.texte }]}>
            {dashboard.positions.length} ligne(s)
          </Text>
          <Explication cle="pru" />
        </View>

        {dashboard.positions.map(position => (
          <View
            key={position.titreId}
            style={[styles.position, { borderColor: palette.bordure }]}>
            <View style={stylesPartages.ligne}>
              <Text
                style={[styles.nom, { color: palette.texte }]}
                numberOfLines={1}>
                {position.nom}
              </Text>
              <Text style={{ color: palette.texte, fontWeight: '600' }}>
                {position.valeur}
              </Text>
            </View>
            <View style={stylesPartages.ligne}>
              <SousTitre>{position.resume}</SousTitre>
              <Variation
                valeur={`${position.plusValue} (${position.plusValuePct})`}
                tendance={position.tendance}
                taille={13}
              />
            </View>
            <SousTitre>{position.compte}</SousTitre>
          </View>
        ))}
      </Carte>

      {dashboard.repartitionParCompte.length > 1 ? (
        <Carte>
          <Text style={[styles.sectionTitre, { color: palette.texte }]}>
            Répartition par compte
          </Text>
          {dashboard.repartitionParCompte.map(ligne => (
            <View key={ligne.cle} style={{ gap: ESPACEMENT.xs }}>
              <View style={stylesPartages.ligne}>
                <Text style={{ color: palette.texte }}>{ligne.cle}</Text>
                <SousTitre>
                  {ligne.valeur} · {ligne.pourcentage}
                </SousTitre>
              </View>
              <Jauge fraction={ligne.fraction} />
            </View>
          ))}
        </Carte>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------ Performances

function Performances({
  vue,
  comparaison,
  onChoisirReference,
}: {
  vue: VuePerformance;
  comparaison: VueComparaison;
  onChoisirReference?(titreId: string): void;
  /** Années pour lesquelles un rapport annuel a du sens. */
  anneesRapport?: readonly number[];
  onGenererRapport?(annee: number): void;
  messageRapport?: string;
}) {
  const palette = usePalette();

  return (
    <>
      {vue.messageHistorique ? (
        <Carte>
          <Text style={{ color: palette.texte, fontWeight: '600' }}>
            Historique insuffisant
          </Text>
          <SousTitre>{vue.messageHistorique}</SousTitre>
        </Carte>
      ) : (
        <Carte>
          <SousTitre>
            {vue.nombrePoints} valorisations sur {Math.round(vue.jours)} jours
          </SousTitre>
          <Courbe points={vue.points} />
        </Carte>
      )}

      <Carte>
        <View style={styles.paire}>
          <IndicateurMesure etiquette="TWR" mesure={vue.twr} explication="twr" />
          <IndicateurMesure etiquette="TRI" mesure={vue.tri} explication="tri" />
        </View>
        <View style={styles.paire}>
          <IndicateurMesure
            etiquette="Rendement annualisé"
            mesure={vue.rendementAnnualise}
            explication="cagr"
          />
          <IndicateurMesure
            etiquette="Volatilité"
            mesure={vue.volatilite}
            explication="volatilite"
          />
        </View>
        <View style={styles.paire}>
          <IndicateurMesure
            etiquette="Ratio de Sharpe"
            mesure={vue.sharpe}
            explication="sharpe"
          />
          <IndicateurMesure
            etiquette="Perte maximale"
            mesure={vue.perteMaximale}
            explication="drawdown"
          />
        </View>
        {vue.dateCreux ? <SousTitre>Creux atteint le {vue.dateCreux}.</SousTitre> : null}
      </Carte>

      <Carte>
        <View style={styles.ligneEnTete}>
          <Text style={[styles.sectionTitre, { color: palette.texte }]}>
            Face à une référence
          </Text>
          {comparaison.nom ? <Explication cle="alpha" /> : null}
        </View>

        {comparaison.nom ? (
          <>
            <View style={styles.paire}>
              <IndicateurMesure etiquette="Vous" mesure={comparaison.portefeuille} />
              <IndicateurMesure
                etiquette={comparaison.nom}
                mesure={comparaison.reference}
              />
            </View>
            <IndicateurMesure
              etiquette="Écart"
              mesure={comparaison.ecart}
              tendance={comparaison.tendanceEcart}
            />
            {comparaison.verdict ? <SousTitre>{comparaison.verdict}</SousTitre> : null}
            {comparaison.periode ? <SousTitre>{comparaison.periode}</SousTitre> : null}
            <View style={styles.paire}>
              <IndicateurMesure
                etiquette="Bêta"
                mesure={comparaison.beta}
                explication="beta"
              />
              <IndicateurMesure
                etiquette="Alpha"
                mesure={comparaison.alpha}
                explication="alpha"
              />
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
                    borderColor: choix.retenu ? palette.accent : palette.bordure,
                    backgroundColor: choix.retenu ? palette.accent : 'transparent',
                  },
                ]}>
                <Text
                  style={{
                    fontSize: 13,
                    color: choix.retenu ? palette.surAccent : palette.texte,
                  }}>
                  {choix.nom} · {choix.releves} relevé(s)
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </Carte>
    </>
  );
}

/** Courbe en barres : lisible sans dépendance graphique. */
function Courbe({ points }: { points: VuePerformance['points'] }) {
  const palette = usePalette();
  if (points.length === 0) {
    return null;
  }

  return (
    <View>
      <View style={styles.courbe}>
        {points.map((point, index) => (
          <View
            key={`${point.date}-${index}`}
            style={[
              styles.barre,
              {
                backgroundColor: palette.accent,
                height: 8 + point.fraction * 72,
              },
            ]}
          />
        ))}
      </View>
      <View style={stylesPartages.ligne}>
        <SousTitre>{points[0].date}</SousTitre>
        <SousTitre>{points[points.length - 1].valeur}</SousTitre>
      </View>
    </View>
  );
}

// ------------------------------------------------------------- Dividendes

function Dividendes({ vue }: { vue: VueDividendes }) {
  const palette = usePalette();

  if (vue.aucunDividende) {
    return (
      <Carte>
        <Text style={{ color: palette.texte }}>Aucun dividende encaissé.</Text>
        <SousTitre>
          Les dividendes saisis ou importés apparaîtront ici, avec ce qu’ils
          rapportent rapporté à ce que vos lignes ont coûté.
        </SousTitre>
      </Carte>
    );
  }

  return (
    <>
      <Carte>
        <Indicateur
          etiquette="Encaissé sur douze mois"
          valeur={vue.douzeMois}
          explication="rendementDividende"
          grand
        />
        <View style={styles.paire}>
          <Indicateur etiquette="Depuis le début" valeur={vue.total} />
          <Indicateur etiquette="Moyenne mensuelle" valeur={vue.moyenneMensuelle} />
        </View>
        {vue.retenueTotale ? (
          <Indicateur
            etiquette="Retenue à la source"
            valeur={vue.retenueTotale}
            explication="retenueSource"
          />
        ) : null}
      </Carte>

      <Carte>
        <Text style={[styles.sectionTitre, { color: palette.texte }]}>Rendements</Text>
        <SousTitre>
          Le premier dit ce que vos lignes vous rapportent ; le second, ce
          qu’elles rapporteraient à qui les achèterait aujourd’hui.
        </SousTitre>
        <View style={styles.paire}>
          <IndicateurMesure
            etiquette="Sur prix de revient"
            mesure={vue.rendementSurRevient}
            explication="rendementDividende"
          />
          <IndicateurMesure
            etiquette="Courant"
            mesure={vue.rendementCourant}
            explication="rendementCourant"
          />
        </View>
      </Carte>

      <Carte>
        <Text style={[styles.sectionTitre, { color: palette.texte }]}>
          Les douze derniers mois
        </Text>
        <View style={styles.courbe}>
          {vue.parMois.map((mois, index) => (
            <View
              key={`${mois.mois}-${index}`}
              testID={`mois-${index}`}
              style={[
                styles.barre,
                {
                  height: `${Math.max(2, mois.fraction * 100)}%`,
                  backgroundColor: mois.vide ? palette.bordure : palette.accent,
                },
              ]}
            />
          ))}
        </View>
        <View style={stylesPartages.ligne}>
          <SousTitre>{vue.parMois[0]?.mois}</SousTitre>
          <SousTitre>{vue.parMois[vue.parMois.length - 1]?.mois}</SousTitre>
        </View>
      </Carte>

      <Carte>
        <Text style={[styles.sectionTitre, { color: palette.texte }]}>Par année</Text>
        {vue.parAnnee.map(ligne => (
          <View key={ligne.annee} style={{ gap: ESPACEMENT.xs }}>
            <View style={stylesPartages.ligne}>
              <Text style={{ color: palette.texte }}>{ligne.annee}</Text>
              <Text style={{ color: palette.texte, fontWeight: '600' }}>
                {ligne.total}
              </Text>
            </View>
            <Jauge fraction={ligne.fraction} />
            {ligne.evolution ? (
              <Variation
                valeur={`${ligne.evolution} sur l’année précédente`}
                tendance={ligne.tendance}
                taille={13}
              />
            ) : null}
          </View>
        ))}
      </Carte>

      <Carte>
        <Text style={[styles.sectionTitre, { color: palette.texte }]}>Par valeur</Text>
        {vue.parTitre.map(ligne => (
          <View
            key={ligne.titreId}
            style={[styles.position, { borderColor: palette.bordure }]}>
            <View style={stylesPartages.ligne}>
              <Text style={styles.nom} numberOfLines={1}>
                <Text style={{ color: palette.texte }}>{ligne.nom}</Text>
              </Text>
              <Text style={{ color: palette.texte, fontWeight: '600' }}>{ligne.total}</Text>
            </View>
            <Jauge fraction={ligne.fraction} />
            <SousTitre>
              {ligne.part} du total · {ligne.douzeMois} sur douze mois
            </SousTitre>
            {ligne.rendementSurRevient ? (
              <SousTitre>
                {ligne.rendementSurRevient} sur prix de revient
                {ligne.rendementCourant ? ` · ${ligne.rendementCourant} courant` : ''}
              </SousTitre>
            ) : null}
            {ligne.motifRendement ? <SousTitre>{ligne.motifRendement}</SousTitre> : null}
          </View>
        ))}
      </Carte>

      <Carte>
        <Text style={[styles.sectionTitre, { color: palette.texte }]}>
          Derniers encaissements
        </Text>
        {vue.derniers.map((ligne, index) => (
          <View
            key={`${ligne.date}-${index}`}
            style={[styles.position, { borderColor: palette.bordure }]}>
            <View style={stylesPartages.ligne}>
              <Text style={styles.nom} numberOfLines={1}>
                <Text style={{ color: palette.texte }}>{ligne.titre}</Text>
              </Text>
              <Text style={{ color: palette.texte, fontWeight: '600' }}>{ligne.net}</Text>
            </View>
            <SousTitre>
              {ligne.date} · {ligne.compte}
              {ligne.retenue ? ` · ${ligne.retenue} retenus à la source` : ''}
            </SousTitre>
          </View>
        ))}
      </Carte>
    </>
  );
}

// ------------------------------------------------------------------ Risque

function Risque({ vue }: { vue: VueRisque }) {
  const palette = usePalette();

  if (vue.aucunePosition) {
    return (
      <Carte>
        <Text style={{ color: palette.texte }}>Aucune position à analyser.</Text>
        <SousTitre>
          La concentration se mesure dès la première ligne, sans attendre le
          moindre historique de cours.
        </SousTitre>
      </Carte>
    );
  }

  return (
    <>
      <Carte>
        <Text style={[styles.sectionTitre, { color: palette.texte }]}>
          Concentration
        </Text>
        {vue.concentration ? (
          <>
            <View style={styles.paire}>
              <Indicateur
                etiquette="Lignes équivalentes"
                valeur={vue.concentration.lignesEquivalentes}
                explication="concentration"
                grand
              />
              <Indicateur
                etiquette="Lignes détenues"
                valeur={`${vue.concentration.nombreLignes}`}
              />
            </View>
            <Jauge fraction={vue.concentration.fraction} />
            <SousTitre>{vue.concentration.verdict}</SousTitre>
            <SousTitre>
              {vue.concentration.premiereLigne} pèse {vue.concentration.premierePart}.
              Il suffit de {vue.concentration.lignesPourMoitie} ligne(s) pour
              atteindre la moitié du portefeuille.
            </SousTitre>
          </>
        ) : null}
      </Carte>

      {vue.sansCours.length > 0 ? (
        <Carte>
          <View style={styles.ligneEnTete}>
            <Text style={{ color: palette.texte, fontWeight: '600' }}>
              {vue.sansCours.length} ligne(s) exclue(s)
            </Text>
            <Explication cle="coursInconnu" />
          </View>
          <SousTitre>{vue.sansCours.join(', ')}</SousTitre>
        </Carte>
      ) : null}

      <Carte>
        <View style={styles.ligneEnTete}>
          <Text style={[styles.sectionTitre, { color: palette.texte }]}>
            D’où vient l’agitation
          </Text>
          <Explication cle="contributionRisque" />
        </View>
        {vue.contributions.length > 0 ? (
          vue.contributions.map(ligne => (
            <View
              key={ligne.titreId}
              style={[styles.position, { borderColor: palette.bordure }]}>
              <View style={stylesPartages.ligne}>
                <Text style={styles.nom} numberOfLines={1}>
                  <Text style={{ color: palette.texte }}>{ligne.nom}</Text>
                </Text>
                <Text style={{ color: palette.texte, fontWeight: '600' }}>
                  {ligne.part}
                </Text>
              </View>
              <Jauge fraction={ligne.fraction} />
              <SousTitre>
                {ligne.poids} du capital · volatilité {ligne.volatilite}
              </SousTitre>
              {ligne.disproportionnee ? (
                <SousTitre>
                  Cette ligne pèse nettement plus dans le risque que dans le
                  capital.
                </SousTitre>
              ) : null}
            </View>
          ))
        ) : (
          <SousTitre>{vue.motifContributions}</SousTitre>
        )}
      </Carte>

      <Carte>
        <View style={styles.ligneEnTete}>
          <Text style={[styles.sectionTitre, { color: palette.texte }]}>
            Vos lignes bougent-elles ensemble ?
          </Text>
          <Explication cle="correlation" />
        </View>
        {vue.motifCorrelations ? <SousTitre>{vue.motifCorrelations}</SousTitre> : null}
        {vue.correlations.map((paire, index) => (
          <View
            key={`${paire.a}-${paire.b}-${index}`}
            testID={`correlation-${index}`}
            style={[styles.position, { borderColor: palette.bordure }]}>
            <View style={stylesPartages.ligne}>
              <Text style={styles.nom} numberOfLines={1}>
                <Text style={{ color: palette.texte }}>
                  {paire.a} · {paire.b}
                </Text>
              </Text>
              <Text
                style={{
                  color:
                    paire.brute !== undefined && paire.brute >= 0.7
                      ? palette.danger
                      : palette.texte,
                  fontWeight: '600',
                }}>
                {paire.valeur ?? '—'}
              </Text>
            </View>
            {paire.commentaire ? <SousTitre>{paire.commentaire}</SousTitre> : null}
          </View>
        ))}
      </Carte>

      <Carte>
        <Text style={[styles.sectionTitre, { color: palette.texte }]}>Par secteur</Text>
        {vue.parSecteur.map(ligne => (
          <View key={ligne.cle} style={{ gap: ESPACEMENT.xs }}>
            <View style={stylesPartages.ligne}>
              <Text style={{ color: palette.texte }}>{ligne.cle}</Text>
              <Text style={{ color: palette.texte, fontWeight: '600' }}>
                {ligne.pourcentage}
              </Text>
            </View>
            <Jauge fraction={ligne.fraction} />
            <SousTitre>{ligne.valeur}</SousTitre>
          </View>
        ))}
      </Carte>

      <Carte>
        <Text style={[styles.sectionTitre, { color: palette.texte }]}>
          Par zone géographique
        </Text>
        {vue.parZone.map(ligne => (
          <View key={ligne.cle} style={{ gap: ESPACEMENT.xs }}>
            <View style={stylesPartages.ligne}>
              <Text style={{ color: palette.texte }}>{ligne.cle}</Text>
              <Text style={{ color: palette.texte, fontWeight: '600' }}>
                {ligne.pourcentage}
              </Text>
            </View>
            <Jauge fraction={ligne.fraction} />
            <SousTitre>{ligne.valeur}</SousTitre>
          </View>
        ))}
      </Carte>
    </>
  );
}

// -------------------------------------------------------------------- Flux

function Flux({ vue }: { vue: VueFlux }) {
  const palette = usePalette();

  if (vue.aucunMouvement) {
    return (
      <Carte>
        <Text style={{ color: palette.texte }}>Aucun mouvement enregistré.</Text>
        <SousTitre>
          Les versements et retraits saisis apparaîtront ici, séparés de la
          performance.
        </SousTitre>
      </Carte>
    );
  }

  return (
    <>
      <Carte>
        <View style={styles.paire}>
          <Indicateur
            etiquette="Flux net"
            valeur={vue.fluxNet}
            explication="fluxExterne"
            tendance={vue.tendanceNet}
            grand
          />
        </View>
        <View style={styles.paire}>
          <Indicateur etiquette="Versements" valeur={vue.versementsTotal} />
          <Indicateur etiquette="Retraits" valeur={vue.retraitsTotal} />
        </View>
        <Indicateur
          etiquette="Versement mensuel moyen"
          valeur={vue.moyenneMensuelle}
          explication="dca"
        />
      </Carte>

      <Carte>
        <Text style={[styles.sectionTitre, { color: palette.texte }]}>Par année</Text>
        {vue.parAnnee.map(ligne => (
          <View key={ligne.periode} style={{ gap: ESPACEMENT.xs }}>
            <View style={stylesPartages.ligne}>
              <Text style={{ color: palette.texte }}>{ligne.periode}</Text>
              <Variation valeur={ligne.net} tendance={ligne.tendance} taille={14} />
            </View>
            <Jauge fraction={ligne.fraction} />
            <SousTitre>
              {ligne.versements} versés · {ligne.retraits} retirés
            </SousTitre>
          </View>
        ))}
      </Carte>

      <Carte>
        <Text style={[styles.sectionTitre, { color: palette.texte }]}>Mouvements</Text>
        {vue.mouvements.map((mouvement, index) => (
          <View
            key={`${mouvement.date}-${index}`}
            style={[styles.position, { borderColor: palette.bordure }]}>
            <View style={stylesPartages.ligne}>
              <Text style={{ color: palette.texte }}>
                {mouvement.type} · {mouvement.date}
              </Text>
              <Variation
                valeur={mouvement.montant}
                tendance={mouvement.tendance}
                taille={14}
              />
            </View>
            <SousTitre>{mouvement.compte}</SousTitre>
          </View>
        ))}
      </Carte>
    </>
  );
}

// ------------------------------------------------------------------ Impôts

function Impots({
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
        <Carte>
          <View style={styles.ligneEnTete}>
            <Text style={{ color: palette.texte, fontWeight: '600' }}>
              Rappel de fin d'année
            </Text>
            <Explication cle="moinsValueReportable" />
          </View>
          <SousTitre>{vue.rappelFinAnnee}</SousTitre>
        </Carte>
      ) : null}

      {vue.comptes.map(compte => (
        <Carte key={compte.nom}>
          <View style={styles.ligneEnTete}>
            <Text style={[styles.sectionTitre, { color: palette.texte }]}>
              {compte.nom}
            </Text>
            <Explication cle={compte.venteImposable ? 'pfu' : 'impotPEA'} />
          </View>
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
              <View style={stylesPartages.ligne}>
                <SousTitre>
                  {compte.plafond.verse} sur {compte.plafond.plafond}
                </SousTitre>
                <SousTitre>{compte.plafond.restant} restants</SousTitre>
              </View>
              {compte.plafond.depassement ? (
                <Text style={{ color: palette.danger }}>
                  Dépassement de {compte.plafond.depassement}.
                </Text>
              ) : null}
            </View>
          ) : null}

          {compte.anciennete ? (
            <View style={styles.ligneEnTete}>
              <SousTitre>Antériorité : {compte.anciennete}</SousTitre>
              <Explication cle="anterioritePEA" />
            </View>
          ) : null}
        </Carte>
      ))}

      <Carte>
        <View style={styles.ligneEnTete}>
          <Text style={[styles.sectionTitre, { color: palette.texte }]}>
            Plus-values réalisées
          </Text>
          <Explication cle="plusValueRealisee" />
        </View>

        {vue.aucuneCession ? (
          <SousTitre>
            Aucune vente enregistrée. Les plus-values apparaîtront ici, année par
            année.
          </SousTitre>
        ) : (
          vue.annees.map(ligne => (
            <View
              key={ligne.annee}
              style={[styles.position, { borderColor: palette.bordure }]}>
              <View style={stylesPartages.ligne}>
                <Text style={{ color: palette.texte }}>{ligne.annee}</Text>
                <Variation
                  valeur={ligne.plusValue}
                  tendance={ligne.tendance}
                  taille={15}
                />
              </View>
              <SousTitre>
                {ligne.impotEstime
                  ? `Impôt estimé : ${ligne.impotEstime}`
                  : 'Aucun impôt dû sur ces cessions.'}
              </SousTitre>
            </View>
          ))
        )}
      </Carte>

      {onGenerer ? (
        <Carte>
          <Text style={[styles.sectionTitre, { color: palette.texte }]}>
            Rapport annuel
          </Text>
          <SousTitre>
            Un document complet pour l’année : cessions, dividendes, frais,
            positions au 31 décembre, et les montants à reporter sur la
            déclaration. Il s’ouvre dans Fichiers, et s’imprime en PDF depuis
            la feuille de partage.
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
                  <Text style={{ fontSize: 13, color: palette.accent }}>{annee}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <SousTitre>
              Aucune opération enregistrée : il n’y a encore aucune année à
              rapporter.
            </SousTitre>
          )}

          {message ? (
            <Text accessibilityLiveRegion="polite" style={{ color: palette.texte }}>
              {message}
            </Text>
          ) : null}
        </Carte>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  page: { paddingBottom: ESPACEMENT.xl },
  enTete: {
    paddingHorizontal: ESPACEMENT.m + 4,
    paddingTop: ESPACEMENT.m + 4,
    gap: ESPACEMENT.m,
    zIndex: 30,
  },
  ligneTitre: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: ESPACEMENT.m,
    zIndex: 30,
  },
  grandTitre: { fontSize: 26, fontWeight: '800' },
  commandes: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ESPACEMENT.m },
  parametres: {
    borderRadius: 20,
    paddingHorizontal: ESPACEMENT.m + 4,
    minHeight: 40,
    justifyContent: 'center',
  },
  outils: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.s },
  barreOnglets: {
    borderBottomWidth: 1,
    marginHorizontal: ESPACEMENT.m + 4,
    marginTop: ESPACEMENT.m,
  },
  onglets: { gap: ESPACEMENT.l, paddingRight: ESPACEMENT.m },
  onglet: {
    paddingVertical: ESPACEMENT.m - 4,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  contenuResume: { padding: ESPACEMENT.m + 4, gap: ESPACEMENT.m },
  chiffre: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: ESPACEMENT.s },
  grandChiffre: { fontSize: 26, fontWeight: '800' },
  carteCompte: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.l },
  identiteCompte: { gap: 4, minWidth: 200, flexGrow: 1, flexBasis: 200 },
  blocCompte: { gap: 4, minWidth: 150, flexGrow: 1, flexBasis: 150 },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  ligneClassement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ESPACEMENT.m - 4,
    minHeight: 44,
  },
  logo: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paire: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.m },
  ligneEnTete: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ESPACEMENT.s,
  },
  sectionTitre: { fontSize: 17, fontWeight: '700' },
  position: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: ESPACEMENT.s,
    gap: ESPACEMENT.xs,
  },
  nom: { fontSize: 15, fontWeight: '600', flex: 1, marginRight: ESPACEMENT.s },
  choix: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.s },
  puce: {
    borderWidth: 1,
    borderRadius: RAYON.l,
    paddingHorizontal: ESPACEMENT.m,
    paddingVertical: ESPACEMENT.s,
  },
  courbe: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 84,
  },
  barre: { flex: 1, borderRadius: RAYON.s, minWidth: 2 },
});
