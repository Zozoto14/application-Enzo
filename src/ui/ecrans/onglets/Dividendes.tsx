/**
 * Onglet Dividendes : ce que les lignes rapportent, mois par mois et valeur
 * par valeur.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SousTitre, usePalette } from '../../composants';
import { CarteSection, Metrique, Rangee, Signe } from '../../elements';
import { Barres, Donut } from '../../graphiques/Graphiques';
import { IndicateurMesure, Jauge } from '../../indicateurs';
import { Cellule, Tableau, type Colonne } from '../../tableau';
import { ESPACEMENT } from '../../theme';
import type { LigneDividende, LigneTitreDividendes, VueDividendes } from '../../vues/dividendes';

const euros = (valeur: number) =>
  `${valeur.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export function OngletDividendes({ vue }: { vue: VueDividendes }) {
  const palette = usePalette();

  if (vue.aucunDividende) {
    return (
      <CarteSection>
        <Text style={{ color: palette.texte }}>Aucun dividende encaissé.</Text>
        <SousTitre>
          Les dividendes saisis ou importés apparaîtront ici, avec ce qu’ils rapportent rapporté à ce
          que vos lignes ont coûté.
        </SousTitre>
      </CarteSection>
    );
  }

  const colonnesTitres: Colonne<LigneTitreDividendes>[] = [
    { cle: 'nom', titre: 'Valeur', largeur: 200, extensible: 2, rendu: l => <Cellule gras>{l.nom}</Cellule> },
    { cle: 'total', titre: 'Total perçu', largeur: 110, alignement: 'droite', rendu: l => <Cellule>{l.total}</Cellule> },
    { cle: 'part', titre: 'Part', largeur: 80, alignement: 'droite', rendu: l => <Cellule>{l.part}</Cellule> },
    { cle: '12m', titre: 'Douze mois', largeur: 110, alignement: 'droite', rendu: l => <Cellule>{l.douzeMois}</Cellule> },
    {
      cle: 'rpr',
      titre: 'Sur revient',
      largeur: 100,
      alignement: 'droite',
      rendu: l => <Cellule>{l.rendementSurRevient ?? '—'}</Cellule>,
    },
    {
      cle: 'rc',
      titre: 'Courant',
      largeur: 90,
      alignement: 'droite',
      rendu: l => <Cellule>{l.rendementCourant ?? '—'}</Cellule>,
    },
  ];

  const colonnesDerniers: Colonne<LigneDividende>[] = [
    { cle: 'date', titre: 'Date', largeur: 100, rendu: l => <Cellule>{l.date}</Cellule> },
    { cle: 'titre', titre: 'Valeur', largeur: 180, extensible: 2, rendu: l => <Cellule gras>{l.titre}</Cellule> },
    { cle: 'compte', titre: 'Compte', largeur: 130, rendu: l => <Cellule>{l.compte}</Cellule> },
    {
      cle: 'retenue',
      titre: 'Retenue',
      largeur: 100,
      alignement: 'droite',
      rendu: l => <Cellule couleur={palette.texteSecondaire}>{l.retenue ?? '—'}</Cellule>,
    },
    {
      cle: 'net',
      titre: 'Net',
      largeur: 110,
      alignement: 'droite',
      rendu: l => <Signe texte={l.net} tendance="hausse" taille={12.5} />,
    },
  ];

  return (
    <>
      <Rangee>
        <CarteSection titre="Encaissé sur douze mois" explication="rendementDividende">
          <Text style={[styles.grand, { color: palette.texte }]}>{vue.douzeMois}</Text>
          <View style={styles.grille}>
            <Metrique libelle="Depuis le début" valeur={vue.total} />
            <Metrique libelle="Moyenne mensuelle" valeur={vue.moyenneMensuelle} />
            {vue.retenueTotale ? <Metrique libelle="Retenue à la source" valeur={vue.retenueTotale} /> : null}
          </View>
        </CarteSection>
        <CarteSection titre="Rendements">
          <SousTitre>
            Le premier dit ce que vos lignes vous rapportent ; le second, ce qu’elles rapporteraient à qui
            les achèterait aujourd’hui.
          </SousTitre>
          <View style={styles.paire}>
            <IndicateurMesure
              etiquette="Sur prix de revient"
              mesure={vue.rendementSurRevient}
              explication="rendementDividende"
            />
            <IndicateurMesure etiquette="Courant" mesure={vue.rendementCourant} explication="rendementCourant" />
          </View>
        </CarteSection>
      </Rangee>

      <Rangee>
        <CarteSection titre="Les douze derniers mois" poids={1.5}>
          <Barres
            barres={vue.parMois.map(mois => ({ libelle: mois.mois, valeur: mois.valeur, detail: mois.total }))}
            formater={euros}
            hauteur={240}
            valeursVisibles
          />
        </CarteSection>
        <CarteSection titre="Par valeur">
          <Donut
            parts={vue.parTitre.map(ligne => ({ libelle: ligne.nom, valeur: Number(ligne.fraction.toFixed(6)), detail: ligne.total }))}
            formater={() => ''}
            hauteur={240}
          />
        </CarteSection>
      </Rangee>

      <Rangee>
        <CarteSection titre="Par année">
          {vue.parAnnee.map(ligne => (
            <View key={ligne.annee} style={{ gap: ESPACEMENT.xs }}>
              <View style={styles.ligne}>
                <Text style={{ color: palette.texte }}>{ligne.annee}</Text>
                <Text style={{ color: palette.texte, fontWeight: '600' }}>{ligne.total}</Text>
              </View>
              <Jauge fraction={ligne.fraction} />
              {ligne.evolution ? (
                <Signe texte={`${ligne.evolution} sur l’année précédente`} tendance={ligne.tendance} taille={12} gras={false} />
              ) : null}
            </View>
          ))}
        </CarteSection>
        <CarteSection titre="Détail par valeur" poids={2}>
          <Tableau colonnes={colonnesTitres} lignes={vue.parTitre} cle={l => l.titreId} />
          {vue.parTitre.some(l => l.motifRendement) ? (
            <SousTitre>{vue.parTitre.find(l => l.motifRendement)?.motifRendement}</SousTitre>
          ) : null}
        </CarteSection>
      </Rangee>

      <CarteSection titre="Historique des dividendes">
        <Tableau colonnes={colonnesDerniers} lignes={vue.derniers} cle={l => `${l.date}-${l.titre}`} />
      </CarteSection>
    </>
  );
}

const styles = StyleSheet.create({
  grand: { fontSize: 26, fontWeight: '800' },
  grille: { flexDirection: 'row', flexWrap: 'wrap', rowGap: ESPACEMENT.m, columnGap: ESPACEMENT.l },
  paire: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.m },
  ligne: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
