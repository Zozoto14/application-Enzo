/**
 * Liste de surveillance.
 *
 * Une valeur suivie n'est pas une position : elle n'entre dans aucun total.
 * L'écran vit donc à part du portefeuille, et marque explicitement celles que
 * vous détenez aussi, pour que la confusion soit impossible.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import type { VueWatchlist } from '../vues/watchlist';
import { Actions, Bouton, Carte, Champ, SousTitre, Titre, Variation, usePalette } from '../composants';
import { Segments } from '../elements';
import { FilTheses, type ChargerTheses } from '../theses';
import { ESPACEMENT, RAYON, palettePour, stylesPartages } from '../theme';

export interface WatchlistProps {
  vue: VueWatchlist;
  onAjouter(titreId: string): void;
  onRetirer(titreId: string): void;
  onChangerSeuil(titreId: string, champ: 'haut' | 'bas', valeur: string): void;
  onCreerTitre?(): void;
  /** Mène à l'écran Recherche, pour trouver une nouvelle valeur. */
  onRechercher?(): void;
  chargerTheses?: ChargerTheses;
  onRetour(): void;
}

export function Watchlist({
  vue,
  onAjouter,
  onRetirer,
  onChangerSeuil,
  onCreerTitre,
  onRechercher,
  chargerTheses,
  onRetour,
}: WatchlistProps) {
  const sombre = useColorScheme() === 'dark';
  const palette = usePalette();
  const [onglet, setOnglet] = useState<'suivi' | 'theses' | 'actualites'>('suivi');
  const valeurs = useMemo(
    () => vue.lignes.map(ligne => ({ nom: ligne.nom, symbole: ligne.ticker || undefined })),
    [vue.lignes],
  );

  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palettePour(sombre).fond }]}
      contentContainerStyle={[stylesPartages.contenu, stylesPartages.formulaire, { paddingTop: ESPACEMENT.l }]}
      keyboardShouldPersistTaps="handled">
      <Titre>Surveillance</Titre>
      <SousTitre>
        Des valeurs que vous suivez sans les détenir. Elles n’entrent dans aucun
        total du portefeuille, et vous pouvez leur fixer des seuils d’alerte
        avant même de les acheter.
      </SousTitre>

      <View style={styles.barreOnglets}>
        <Segments<'suivi' | 'theses' | 'actualites'>
          options={['suivi', 'theses', 'actualites']}
          actif={onglet}
          onChoisir={setOnglet}
          libelle={option => (option === 'suivi' ? 'Suivi' : option === 'theses' ? 'Thèses' : 'Actualités')}
          prefixeTest="onglet-surveillance"
        />
        {onRechercher ? (
          <Bouton titre="⌕ Rechercher une valeur" variante="discret" onPress={onRechercher} testID="bouton-vers-recherche" />
        ) : null}
      </View>

      {onglet !== 'suivi' ? (
        <Carte>
          {vue.lignes.length === 0 ? (
            <Text style={{ color: palette.texteSecondaire }}>
              Surveillez d’abord une valeur : ses thèses et son actualité s’afficheront ici.
            </Text>
          ) : chargerTheses ? (
            <FilTheses valeurs={valeurs} chargerTheses={chargerTheses} mode={onglet} testID={`fil-${onglet}`} />
          ) : (
            <Text style={{ color: palette.texteSecondaire }}>
              Les thèses et actualités se lisent dans l’application de bureau.
            </Text>
          )}
        </Carte>
      ) : null}

      {onglet === 'suivi' && vue.message ? (
        <Carte>
          <Text style={{ color: palette.texte }}>{vue.message}</Text>
          {onCreerTitre && vue.candidats.length === 0 ? (
            <Bouton
              titre="Créer une valeur"
              testID="bouton-creer-titre-watchlist"
              variante="discret"
              onPress={onCreerTitre}
            />
          ) : null}
        </Carte>
      ) : null}

      {onglet !== 'suivi' ? null : vue.lignes.map(ligne => (
        <Carte key={ligne.titreId}>
          <View style={stylesPartages.ligne}>
            <Text style={styles.nom} numberOfLines={1}>
              <Text style={{ color: palette.texte }}>{ligne.nom}</Text>
            </Text>
            {ligne.cours ? (
              <Text style={{ color: palette.texte, fontWeight: '600', fontSize: 17 }}>
                {ligne.cours}
              </Text>
            ) : null}
          </View>

          <View style={styles.etiquettes}>
            {ligne.ticker ? <SousTitre>{ligne.ticker}</SousTitre> : null}
            {ligne.detenue ? (
              <View style={[styles.pastille, { borderColor: palette.bordure }]}>
                <Text style={{ fontSize: 11, color: palette.texteSecondaire }}>
                  Aussi détenue
                </Text>
              </View>
            ) : null}
            {ligne.seuilAtteint ? (
              <View style={[styles.pastille, { borderColor: palette.danger }]}>
                <Text style={{ fontSize: 11, color: palette.danger }}>Seuil franchi</Text>
              </View>
            ) : null}
          </View>

          {ligne.ecart ? (
            <Variation
              valeur={`${ligne.ecart} (${ligne.ecartPourcent}) depuis l’ajout`}
              tendance={ligne.tendance}
              taille={14}
            />
          ) : null}
          <SousTitre>{ligne.depuis}</SousTitre>
          {ligne.motifEcart ? <SousTitre>{ligne.motifEcart}</SousTitre> : null}
          {ligne.note ? <SousTitre>{ligne.note}</SousTitre> : null}

          <View style={styles.paire}>
            <View style={styles.moitie}>
              <Champ
                etiquette="Seuil bas"
                testID={`surveillance-bas-${ligne.titreId}`}
                value={ligne.seuilBas}
                onChangeText={valeur => onChangerSeuil(ligne.titreId, 'bas', valeur)}
                keyboardType="decimal-pad"
                placeholder="—"
              />
            </View>
            <View style={styles.moitie}>
              <Champ
                etiquette="Seuil haut"
                testID={`surveillance-haut-${ligne.titreId}`}
                value={ligne.seuilHaut}
                onChangeText={valeur => onChangerSeuil(ligne.titreId, 'haut', valeur)}
                keyboardType="decimal-pad"
                placeholder="—"
              />
            </View>
          </View>

          <Bouton
            titre="Ne plus surveiller"
            testID={`retirer-${ligne.titreId}`}
            variante="discret"
            onPress={() => onRetirer(ligne.titreId)}
          />
        </Carte>
      ))}

      {onglet === 'suivi' && vue.candidats.length > 0 ? (
        <Carte>
          <Text style={[styles.sectionTitre, { color: palette.texte }]}>Ajouter</Text>
          <SousTitre>
            Le cours du jour est figé au moment de l’ajout : c’est lui qui sert
            de point de comparaison ensuite.
          </SousTitre>
          <View style={styles.choix}>
            {vue.candidats.map(candidat => (
              <Pressable
                key={candidat.titreId}
                testID={`surveiller-${candidat.titreId}`}
                accessibilityRole="button"
                onPress={() => onAjouter(candidat.titreId)}
                style={[styles.puce, { borderColor: palette.accent }]}>
                <Text style={{ fontSize: 13, color: palette.accent }}>
                  {candidat.nom}
                  {candidat.detenue ? ' · détenue' : ''}
                </Text>
              </Pressable>
            ))}
          </View>
          {onCreerTitre ? (
            <Bouton
              titre="Créer une valeur"
              testID="bouton-creer-titre-watchlist"
              variante="discret"
              onPress={onCreerTitre}
            />
          ) : null}
        </Carte>
      ) : null}

      <Actions>
        <Bouton titre="Retour" variante="discret" onPress={onRetour} />
      </Actions>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sectionTitre: { fontSize: 17, fontWeight: '700' },
  barreOnglets: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: ESPACEMENT.s },
  nom: { fontSize: 16, fontWeight: '600', flex: 1, marginRight: ESPACEMENT.s },
  etiquettes: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ESPACEMENT.s },
  pastille: {
    borderWidth: 1,
    borderRadius: RAYON.s,
    paddingHorizontal: ESPACEMENT.s,
    paddingVertical: 2,
  },
  paire: { flexDirection: 'row', gap: ESPACEMENT.m },
  moitie: { flex: 1, minWidth: 110 },
  choix: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.s },
  puce: {
    borderWidth: 1,
    borderRadius: RAYON.l,
    paddingHorizontal: ESPACEMENT.m,
    paddingVertical: ESPACEMENT.s,
  },
});
