/**
 * Bibliothèque sur téléphone : statistiques en tuiles (2 colonnes), répartition par statut, rangée
 * « Reprendre », filtres de statut en puces défilantes de 44 px, affiches à 2 colonnes, historique en
 * cellules, et import / export dans une feuille basse. Animés | Films : le sélecteur segmenté du haut.
 */

import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { police, teinteTransparente } from '../../../hub/themes';
import { ChampMobile } from '../../../ui/mobile/ChampMobile';
import { FeuilleBasse } from '../../../ui/mobile/FeuilleBasse';
import { CONTROLE, ESPACE, TEXTE, rayonCarte, rayonControle } from '../../../ui/mobile/jetons';
import { Cellule, GroupeCellules } from '../../../ui/mobile/ListeCellules';
import type { Entree, EvenementHistorique, Statut } from '../../moteur/bibliotheque';
import { useTsuzuku, type Chargement } from '../contexte';
import { Grille, RangeeReprendre } from '../listes';
import { Avis, Etat, EtatVide, LIBELLE_STATUT, Titre, couleurStatut, type ElementCarte } from '../ui';

export interface BibliothequeMobileProps {
  titre: string;
  tuiles: ReadonlyArray<readonly [string, string, string]>;
  repartition: ReadonlyArray<readonly [Statut, number]> | null;
  reprendre: Entree[];
  onLire(e: Entree): void;
  onglets: ReadonlyArray<readonly [string, string, number]>;
  onglet: string;
  onOnglet(cle: string): void;
  chargement: Pick<Chargement<unknown>, 'enCours' | 'erreur' | 'recharger'> & { aDonnees: boolean };
  elements: ElementCarte[];
  vide: { titre: string; texte: string; icone: string } | null;
  historique: EvenementHistorique[];
  estAdmin: boolean;
  onExporter(): void;
  onImporter(): void;
  exportTexte?: string;
  avis?: { texte: string; genre: 'ok' | 'critique' };
}

export function BibliothequeMobile(p: BibliothequeMobileProps) {
  const { theme } = useTsuzuku();
  const [sauvegarde, setSauvegarde] = useState(false);
  return (
    <View style={{ gap: ESPACE.l }} testID="tsuzuku-bibliotheque">
      <Titre taille={28}>{p.titre}</Titre>
      {p.tuiles.length ? (
        <View style={st.tuiles} testID="bibliotheque-stats" accessibilityLabel="Statistiques">
          {p.tuiles.map(([libelle, valeur, detail], i) => (
            <View key={libelle} style={[st.tuile, i === p.tuiles.length - 1 && p.tuiles.length % 2 === 1 ? { width: '100%' } : null, { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: rayonCarte(theme) }]}>
              <Text style={{ color: theme.texte, fontSize: 28, fontWeight: '800', ...police(theme.policeChiffres ?? theme.policeTitre) }}>{valeur}</Text>
              <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, fontWeight: '600', ...police(theme.policeTexte) }}>{libelle}</Text>
              {detail ? <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, ...police(theme.policeTexte) }}>{detail}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
      {p.repartition ? (
        <View style={[st.carte, { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: rayonCarte(theme) }]} testID="bibliotheque-repartition" accessibilityLabel="Répartition par statut">
          <Text accessibilityRole="header" style={{ color: theme.attenue, fontSize: TEXTE.legende, fontWeight: '700', ...police(theme.policeTexte) }}>
            Répartition
          </Text>
          <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 }}>
            {p.repartition.filter(([, n]) => n).map(([s, n]) => (
              <View key={s} style={{ flexGrow: n, backgroundColor: couleurStatut(theme, s) }} />
            ))}
          </View>
          <View style={{ gap: 6 }}>
            {p.repartition.map(([s, n]) => (
              <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: couleurStatut(theme, s) }} />
                <Text style={{ flex: 1, color: theme.texte, fontSize: TEXTE.legende, ...police(theme.policeTexte) }}>{LIBELLE_STATUT[s]}</Text>
                <Text style={{ color: theme.texte, fontSize: TEXTE.legende, fontWeight: '800', ...police(theme.policeTexte) }}>{n}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <RangeeReprendre titre="Reprendre la lecture" testID="bibliotheque-reprendre" entrees={p.reprendre} onLire={p.onLire} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} decelerationRate="fast" style={{ marginHorizontal: -16 }} contentContainerStyle={st.puces} accessibilityLabel="Statut">
        {p.onglets.map(([cle, libelle, nombre]) => {
          const actif = p.onglet === cle;
          return (
            <Pressable
              key={cle}
              testID={`onglet-${cle}`}
              accessibilityRole="button"
              accessibilityState={{ selected: actif }}
              accessibilityLabel={`${libelle} (${nombre})`}
              onPress={() => p.onOnglet(cle)}
              style={[st.puce, { borderRadius: rayonControle(theme) === 999 ? 999 : 22, backgroundColor: actif ? theme.accent : 'transparent', borderColor: actif ? theme.accent : theme.ligne }]}>
              <Text style={{ color: actif ? theme.surAccent : theme.texte, fontSize: TEXTE.corps, fontWeight: '600', ...police(theme.policeTexte) }}>
                {libelle} ({nombre})
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Etat enCours={p.chargement.enCours && !p.chargement.aDonnees} erreur={p.chargement.erreur} onRecharger={p.chargement.recharger} squelette="affiches">
        {p.vide ? (
          <EtatVide icone={p.vide.icone} titre={p.vide.titre}>
            {p.vide.texte}
          </EtatVide>
        ) : null}
        <Grille elements={p.elements} testID="bibliotheque-grille" />
      </Etat>
      {p.historique.length ? (
        <View testID="bibliotheque-historique">
          <GroupeCellules theme={theme} titre="Historique">
            {p.historique.slice(0, 8).map((h, i) => (
              <View key={`${h.animeId}-${h.episode}-${i}`} style={st.historique}>
                <View style={{ width: 36, height: 54, borderRadius: 4, overflow: 'hidden', backgroundColor: theme.fond }}>{h.image ? <Image source={{ uri: h.image }} accessibilityIgnoresInvertColors style={{ width: 36, height: 54 }} /> : null}</View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: theme.texte, fontSize: TEXTE.corps, ...police(theme.policeTexte) }}>
                    {h.title}
                  </Text>
                  <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, ...police(theme.policeTexte) }}>
                    {h.kind === 'anime' ? `Épisode ${h.episode} · ` : ''}
                    {String(h.watchedAt).slice(0, 10)}
                  </Text>
                </View>
              </View>
            ))}
          </GroupeCellules>
        </View>
      ) : null}
      <GroupeCellules theme={theme} titre="Sauvegarde">
        <Cellule theme={theme} glyphe="⇅" titre="Exporter ou importer" sousTitre="Fichier JSON de la bibliothèque" chevron onPress={() => setSauvegarde(true)} testID="bibliotheque-sauvegarde" />
      </GroupeCellules>
      {sauvegarde ? (
        <FeuilleBasse theme={theme} visible titre="Sauvegarde" onFermer={() => setSauvegarde(false)} testID="bibliotheque-feuille-sauvegarde">
          <GroupeCellules theme={theme}>
            <Cellule theme={theme} glyphe="↧" titre="Exporter (JSON)" sousTitre="Enregistre un fichier, ou l’affiche à copier" onPress={p.onExporter} testID="bibliotheque-exporter" />
            {p.estAdmin ? (
              <Cellule
                theme={theme}
                glyphe="↥"
                titre="Importer ma bibliothèque Tsuzuku"
                chevron
                onPress={() => {
                  setSauvegarde(false);
                  p.onImporter();
                }}
                testID="bibliotheque-importer"
              />
            ) : null}
          </GroupeCellules>
          {p.avis ? <Avis genre={p.avis.genre} texte={p.avis.texte} testID="bibliotheque-avis" /> : null}
          {p.exportTexte ? <ChampMobile theme={theme} etiquette="Export à copier" nature="multiligne" value={p.exportTexte} onChangeText={() => undefined} testID="bibliotheque-export-texte" /> : null}
        </FeuilleBasse>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  tuiles: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  tuile: { width: '48%', padding: 14, gap: 2, borderWidth: StyleSheet.hairlineWidth },
  carte: { padding: 16, gap: 12, borderWidth: StyleSheet.hairlineWidth },
  puces: { paddingHorizontal: 16, gap: 8 },
  puce: { minHeight: CONTROLE.cible, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  historique: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
});
