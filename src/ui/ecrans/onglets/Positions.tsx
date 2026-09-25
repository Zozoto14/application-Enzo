/**
 * Onglet Positions : ce que contient le portefeuille, et comment c'est réparti.
 */

import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { usePalette } from '../../composants';
import { CarteSection, Metrique, Rangee, Selecteur, Signe, Vide } from '../../elements';
import { Barres, Donut, GraphiqueLignes, Treemap } from '../../graphiques/Graphiques';
import { Cellule, Tableau, type Colonne } from '../../tableau';
import { ESPACEMENT } from '../../theme';
import type { VueDashboard } from '../../vues/dashboard';
import { construirePositions, type EntreesAnalyse, type LigneTitre } from '../../vues/analyses';

type Critere = 'positions' | 'secteurs' | 'zones' | 'comptes';

const CRITERES = [
  { valeur: 'positions', libelle: 'Positions' },
  { valeur: 'secteurs', libelle: 'Secteurs' },
  { valeur: 'zones', libelle: 'Zones' },
  { valeur: 'comptes', libelle: 'Comptes' },
];

const euros = (valeur: number) =>
  `${valeur.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const pourcent = (valeur: number) =>
  `${valeur.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;

export function OngletPositions({
  dashboard,
  analyse,
  onOuvrirTitre,
}: {
  dashboard: VueDashboard;
  analyse?: EntreesAnalyse;
  onOuvrirTitre?(titreId: string): void;
}) {
  const palette = usePalette();
  const [critere, setCritere] = useState<Critere>('positions');
  const vue = useMemo(() => (analyse ? construirePositions(analyse) : undefined), [analyse]);

  if (dashboard.positions.length === 0 || !vue) {
    return (
      <CarteSection>
        <Vide>Aucune position à afficher.</Vide>
      </CarteSection>
    );
  }

  const couleurTuile = (latentPct: number) => {
    const intensite = Math.min(1, Math.abs(latentPct) / 25);
    return latentPct >= 0
      ? `rgba(40, 170, 105, ${(0.45 + intensite * 0.55).toFixed(2)})`
      : `rgba(220, 70, 70, ${(0.45 + intensite * 0.55).toFixed(2)})`;
  };

  const colonnes: Colonne<LigneTitre>[] = [
    {
      cle: 'nom',
      titre: 'Nom',
      largeur: 220,
      extensible: 2,
      tri: ligne => ligne.nom,
      rendu: ligne => (
        <View style={styles.nom}>
          <View style={[styles.logo, { backgroundColor: palette.surfaceHaute, borderColor: palette.bordure }]}>
            <Text style={{ color: palette.texte, fontSize: 9, fontWeight: '800' }}>
              {(ligne.symbole || ligne.nom).slice(0, 4).toUpperCase()}
            </Text>
          </View>
          <View style={{ flexShrink: 1 }}>
            <Cellule gras>{ligne.nom}</Cellule>
            {ligne.symbole ? <Cellule petit couleur={palette.accent}>{ligne.symbole}</Cellule> : null}
          </View>
        </View>
      ),
    },
    {
      cle: 'statut',
      titre: 'Statut',
      largeur: 80,
      rendu: () => (
        <View style={[styles.statut, { backgroundColor: palette.hausseFond }]}>
          <Text style={{ color: palette.hausse, fontSize: 11, fontWeight: '700' }}>Ouverte</Text>
        </View>
      ),
    },
    { cle: 'compte', titre: 'Compte', largeur: 110, rendu: ligne => <Cellule>{ligne.compte}</Cellule>, tri: l => l.compte },
    { cle: 'qte', titre: 'Qté', largeur: 60, alignement: 'droite', rendu: l => <Cellule>{l.quantite}</Cellule> },
    { cle: 'pru', titre: 'PRU', largeur: 90, alignement: 'droite', rendu: l => <Cellule>{l.pru}</Cellule> },
    { cle: 'cout', titre: 'Coût', largeur: 100, alignement: 'droite', rendu: l => <Cellule>{l.cout}</Cellule> },
    { cle: 'prix', titre: 'Prix', largeur: 90, alignement: 'droite', rendu: l => <Cellule>{l.cours}</Cellule> },
    {
      cle: 'jour',
      titre: 'Var. jour',
      largeur: 80,
      alignement: 'droite',
      rendu: l =>
        l.variationJour ? (
          <Signe texte={l.variationJour.texte} tendance={l.variationJour.tendance} taille={12} />
        ) : (
          <Cellule couleur={palette.texteSecondaire}>—</Cellule>
        ),
    },
    {
      cle: 'total',
      titre: 'Total',
      largeur: 110,
      alignement: 'droite',
      tri: l => l.brut.valeur,
      rendu: l => <Cellule gras>{l.valeur}</Cellule>,
    },
    {
      cle: 'poids',
      titre: '% du portef.',
      largeur: 90,
      alignement: 'droite',
      tri: l => l.brut.poids,
      rendu: l => <Cellule>{l.poids}</Cellule>,
    },
    {
      cle: 'latent',
      titre: '+/- latent',
      largeur: 100,
      alignement: 'droite',
      tri: l => l.brut.latent,
      rendu: l => <Signe texte={l.latent.texte} tendance={l.latent.tendance} taille={12} />,
    },
    {
      cle: 'latentPct',
      titre: '% latent',
      largeur: 80,
      alignement: 'droite',
      tri: l => l.brut.latentPct,
      rendu: l => <Signe texte={l.latentPct.texte} tendance={l.latentPct.tendance} taille={12} />,
    },
  ];

  return (
    <>
      <Rangee>
        <CarteSection
          titre="Répartition du portefeuille"
          actions={
            <Selecteur
              etiquette="Graphique"
              valeur={critere}
              options={CRITERES}
              onChoisir={valeur => setCritere(valeur as Critere)}
              largeur={150}
              testID="selecteur-repartition"
            />
          }>
          <Donut
            parts={vue.repartition[critere].map(part => ({ libelle: part.libelle, valeur: part.valeur, detail: part.detail }))}
            formater={euros}
            hauteur={280}
          />
        </CarteSection>
        <CarteSection titre="Statistiques">
          <View style={styles.grilleMetriques}>
            {vue.statistiques.map(statistique => (
              <Metrique
                key={statistique.libelle}
                libelle={statistique.libelle}
                valeur={statistique.valeur}
                tendance={statistique.tendance}
              />
            ))}
          </View>
        </CarteSection>
      </Rangee>

      <CarteSection titre="Répartition dans le temps">
        {vue.poidsDansLeTemps.length > 0 ? (
          <GraphiqueLignes
            series={vue.poidsDansLeTemps.map((serie, index) => ({
              nom: serie.nom,
              couleur: palette.series[index % palette.series.length],
              points: serie.points,
            }))}
            formater={pourcent}
            hauteur={260}
            etiquettesFinales={false}
            legende={vue.poidsDansLeTemps.map((serie, index) => ({
              couleur: palette.series[index % palette.series.length],
              texte: serie.nom,
            }))}
          />
        ) : (
          <Vide>L’évolution des poids se trace dès que l’historique des cours est chargé.</Vide>
        )}
      </CarteSection>

      <Rangee>
        <CarteSection titre="Distribution des performances">
          <Barres
            barres={vue.distribution.map(barre => ({
              libelle: barre.libelle,
              valeur: barre.valeur,
              couleur: barre.valeur >= 0 ? palette.hausse : palette.baisse,
              detail: barre.texte,
            }))}
            formater={pourcent}
            hauteur={260}
            valeursVisibles
          />
        </CarteSection>
        <CarteSection titre="Plus-values & poids">
          <Treemap
            tuiles={vue.tuiles.map(tuile => ({
              libelle: tuile.libelle,
              valeur: tuile.poids,
              couleur: couleurTuile(tuile.latentPct),
              lignes: tuile.lignes,
            }))}
            hauteur={260}
          />
        </CarteSection>
      </Rangee>

      <CarteSection titre="Titres" actions={<Text style={{ color: palette.texteSecondaire }}>{vue.nombreLignes}</Text>}>
        <Tableau
          colonnes={colonnes}
          lignes={vue.lignes}
          cle={ligne => `${ligne.titreId}-${ligne.compte}`}
          onPressLigne={onOuvrirTitre ? ligne => onOuvrirTitre(ligne.titreId) : undefined}
          testID="tableau-titres"
          pied={
            <>
              <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
                Lignes : <Text style={{ color: palette.texte, fontWeight: '700' }}>{vue.pied.lignes}</Text>
              </Text>
              <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
                Latent : <Signe texte={vue.pied.latent.texte} tendance={vue.pied.latent.tendance} taille={12} />
              </Text>
              <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
                Réalisé : <Signe texte={vue.pied.realise.texte} tendance={vue.pied.realise.tendance} taille={12} />
              </Text>
              <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
                Dividendes (net) : <Text style={{ color: palette.texte, fontWeight: '700' }}>{vue.pied.dividendes}</Text>
              </Text>
              <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
                Total Return :{' '}
                <Signe texte={vue.pied.totalReturn.texte} tendance={vue.pied.totalReturn.tendance} taille={12} />
              </Text>
            </>
          }
        />
      </CarteSection>
    </>
  );
}

const styles = StyleSheet.create({
  nom: { flexDirection: 'row', alignItems: 'center', gap: ESPACEMENT.s },
  logo: {
    width: 30,
    height: 30,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statut: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  grilleMetriques: { flexDirection: 'row', flexWrap: 'wrap', rowGap: ESPACEMENT.m, columnGap: ESPACEMENT.l },
});
