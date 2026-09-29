/**
 * Onglet Flux : l'argent qui entre et sort du portefeuille, séparé de sa
 * performance.
 */

import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SousTitre, usePalette } from '../../composants';
import { CarteSection, Metrique, Rangee, Selecteur, Signe, Vide } from '../../elements';
import { Barres, Donut, GraphiqueLignes } from '../../graphiques/Graphiques';
import { Cellule, Tableau, type Colonne } from '../../tableau';
import { ESPACEMENT } from '../../theme';
import type { Compte, Transaction } from '../../../core/domain/types';
import { construireFluxAvance } from '../../vues/analyses';
import type { MouvementFlux, VueFlux } from '../../vues/onglets';

const euros = (valeur: number) =>
  `${valeur.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const eurosCourts = (valeur: number) =>
  Math.abs(valeur) >= 1000
    ? `${(valeur / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k`
    : valeur.toLocaleString('fr-FR', { maximumFractionDigits: 0 });

export function OngletFlux({
  vue,
  transactions,
  comptes,
  aujourdhui,
}: {
  vue: VueFlux;
  transactions?: readonly Transaction[];
  comptes?: readonly Compte[];
  aujourdhui: string;
}) {
  const palette = usePalette();
  const [annee, setAnnee] = useState<string | undefined>();
  const avance = useMemo(
    () => (transactions && comptes ? construireFluxAvance(transactions, comptes, annee, aujourdhui) : undefined),
    [transactions, comptes, annee, aujourdhui],
  );

  if (vue.aucunMouvement) {
    return (
      <CarteSection>
        <Text style={{ color: palette.texte }}>Aucun mouvement enregistré.</Text>
        <SousTitre>Les versements et retraits saisis apparaîtront ici, séparés de la performance.</SousTitre>
      </CarteSection>
    );
  }

  const colonnes: Colonne<MouvementFlux>[] = [
    { cle: 'date', titre: 'Date', largeur: 110, rendu: m => <Cellule>{m.date}</Cellule> },
    {
      cle: 'type',
      titre: 'Type',
      largeur: 100,
      rendu: m => (
        <View
          style={[
            styles.badge,
            { backgroundColor: m.tendance === 'hausse' ? palette.hausseFond : palette.baisseFond },
          ]}>
          <Text
            style={{
              color: m.tendance === 'hausse' ? palette.hausse : palette.baisse,
              fontSize: 11,
              fontWeight: '700',
            }}>
            {m.type}
          </Text>
        </View>
      ),
    },
    { cle: 'compte', titre: 'Compte', largeur: 160, extensible: 1, rendu: m => <Cellule>{m.compte}</Cellule> },
    {
      cle: 'flux',
      titre: 'Flux',
      largeur: 140,
      alignement: 'droite',
      rendu: m => <Signe texte={m.montant} tendance={m.tendance} taille={12.5} />,
    },
  ];

  return (
    <>
      {avance ? (
        <>
          <Rangee>
            <CarteSection
              titre="Flux par mois"
              poids={1.2}
              actions={
                avance.annees.length > 0 ? (
                  <Selecteur
                    etiquette="Année"
                    valeur={annee ?? avance.annees[0]}
                    options={avance.annees.map(valeur => ({ valeur, libelle: valeur }))}
                    onChoisir={setAnnee}
                    largeur={110}
                  />
                ) : null
              }>
              <Barres
                barres={avance.parMois.map(mois => ({
                  libelle: mois.libelle,
                  valeur: mois.valeur,
                  negatif: mois.negatif,
                  detail: mois.detail,
                }))}
                formater={eurosCourts}
                hauteur={260}
                valeursVisibles
                repere={
                  avance.moyenneMensuelle
                    ? { valeur: avance.moyenneMensuelle.valeur, libelle: avance.moyenneMensuelle.texte }
                    : undefined
                }
                legende={[
                  { couleur: palette.accent, texte: 'Dépôts' },
                  { couleur: palette.baisse, texte: 'Retraits' },
                ]}
              />
            </CarteSection>
            <CarteSection titre="Flux par années">
              <Barres
                barres={avance.parAnnee.map(ligne => ({
                  libelle: ligne.libelle,
                  valeur: ligne.valeur,
                  negatif: ligne.negatif,
                  detail: ligne.detail,
                }))}
                formater={eurosCourts}
                hauteur={260}
                valeursVisibles
                legende={[
                  { couleur: palette.accent, texte: 'Dépôts' },
                  { couleur: palette.baisse, texte: 'Retraits' },
                ]}
              />
            </CarteSection>
          </Rangee>

          <Rangee>
            <CarteSection titre="Flux par comptes">
              <Donut
                parts={avance.parCompte.map(part => ({ libelle: part.libelle, valeur: part.valeur, detail: part.detail }))}
                formater={euros}
                hauteur={avance.parCompte.length > 1 ? 260 : 210}
              />
            </CarteSection>
            <CarteSection titre="Évolution cumulée">
              {avance.cumul.length > 1 ? (
                <GraphiqueLignes
                  series={[{ nom: 'Versements nets cumulés', couleur: palette.series[0], points: avance.cumul, aire: true }]}
                  formater={eurosCourts}
                  hauteur={260}
                />
              ) : (
                <Vide>Un seul mouvement : la courbe se trace à partir du second.</Vide>
              )}
            </CarteSection>
          </Rangee>
        </>
      ) : null}

      <Rangee>
        <CarteSection titre="En résumé" explication="fluxExterne">
          <View style={styles.grille}>
            <Metrique libelle="Flux net" valeur={vue.fluxNet} tendance={vue.tendanceNet} />
            <Metrique libelle="Versements" valeur={vue.versementsTotal} />
            <Metrique libelle="Retraits" valeur={vue.retraitsTotal} />
            <Metrique libelle="Versement mensuel moyen" valeur={vue.moyenneMensuelle} />
          </View>
        </CarteSection>
        <CarteSection
          titre="Historique des flux"
          poids={2}
          actions={
            <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
              {vue.mouvements.length} mouvement(s) · Flux net :{' '}
              <Signe texte={vue.fluxNet} tendance={vue.tendanceNet} taille={12} />
            </Text>
          }>
          <Tableau
            colonnes={colonnes}
            lignes={vue.mouvements}
            cle={mouvement => `${mouvement.date}-${mouvement.compte}-${mouvement.montant}-${mouvement.type}`}
          />
        </CarteSection>
      </Rangee>
    </>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  grille: { flexDirection: 'row', flexWrap: 'wrap', rowGap: ESPACEMENT.m, columnGap: ESPACEMENT.l },
});
