/**
 * Recherche : trouver une entreprise, la mettre en surveillance, et lire ce
 * qu'on en dit — thèses d'investisseurs et actualités.
 */

import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { CandidatSymbole } from '../../cours/symboles';
import { Alerte, SousTitre, usePalette } from '../composants';
import { CarteSection, Rangee, Segments, Vide } from '../elements';
import { FilTheses, type ChargerTheses } from '../theses';
import { ESPACEMENT, RAYON, palettePour, stylesPartages, POLICE_TITRE } from '../theme';

export interface RechercheProps {
  onRechercher(texte: string): Promise<CandidatSymbole[]>;
  /** Symboles déjà en surveillance. */
  surveilles: ReadonlySet<string>;
  onSurveiller(candidat: CandidatSymbole): void;
  onOuvrirFiche(symbole: string): void;
  chargerTheses?: ChargerTheses;
}

const TYPES: Record<string, string> = {
  EQUITY: 'Action',
  ETF: 'ETF',
  MUTUALFUND: 'Fonds',
  INDEX: 'Indice',
  CRYPTOCURRENCY: 'Crypto',
  FUTURE: 'Contrat à terme',
  CURRENCY: 'Devise',
};

export function Recherche({ onRechercher, surveilles, onSurveiller, onOuvrirFiche, chargerTheses }: RechercheProps) {
  const palette = usePalette();
  const [texte, setTexte] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>();
  const [resultats, setResultats] = useState<CandidatSymbole[] | undefined>();
  const [choisi, setChoisi] = useState<CandidatSymbole | undefined>();
  const [onglet, setOnglet] = useState<'theses' | 'actualites'>('theses');

  const lancer = () => {
    const terme = texte.trim();
    if (!terme) return;
    setEnCours(true);
    setErreur(undefined);
    onRechercher(terme)
      .then(candidats => {
        setResultats(candidats);
        setChoisi(candidats[0]);
      })
      .catch((e: unknown) => setErreur(e instanceof Error ? e.message : String(e)))
      .finally(() => setEnCours(false));
  };

  return (
    <View style={[stylesPartages.ecran, { backgroundColor: palettePour().fond }]}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text {...POLICE_TITRE} style={[styles.titre, { color: palette.texte }]} accessibilityRole="header">
          Recherche
        </Text>

        <View style={[styles.barre, { backgroundColor: palette.surface, borderColor: palette.bordure }]}>
          <Text style={{ color: palette.texteSecondaire, fontSize: 18 }}>⌕</Text>
          <TextInput
            value={texte}
            onChangeText={setTexte}
            onSubmitEditing={lancer}
            placeholder="Rechercher une action, un ETF… (nom, ticker ou ISIN)"
            placeholderTextColor={palette.texteSecondaire}
            returnKeyType="search"
            autoCorrect={false}
            style={[styles.saisie, { color: palette.texte }]}
            testID="champ-recherche-action"
            accessibilityLabel="Rechercher une action"
          />
          <Pressable
            accessibilityRole="button"
            onPress={lancer}
            testID="bouton-rechercher-action"
            style={[styles.bouton, { backgroundColor: palette.accentPlein }]}>
            <Text style={{ color: palette.surAccent, fontWeight: '700' }}>Rechercher</Text>
          </Pressable>
        </View>

        {erreur ? <Alerte message={`La recherche n’a pas abouti : ${erreur}`} /> : null}

        {enCours ? (
          <View style={styles.centre}>
            <ActivityIndicator color={palette.accent} />
          </View>
        ) : resultats === undefined ? (
          <SousTitre>
            Cherchez une entreprise pour l’ajouter à votre Surveillance, ouvrir sa fiche, et lire les thèses et
            l’actualité qui la concernent.
          </SousTitre>
        ) : resultats.length === 0 ? (
          <Vide>Aucun résultat pour « {texte.trim()} ». Essayez le nom complet ou le ticker.</Vide>
        ) : (
          <Rangee>
            <CarteSection titre={`${resultats.length} résultat${resultats.length > 1 ? 's' : ''}`}>
              {resultats.map(candidat => {
                const selectionne = choisi?.symbole === candidat.symbole;
                const suivi = surveilles.has(candidat.symbole);
                return (
                  <Pressable
                    key={candidat.symbole}
                    onPress={() => setChoisi(candidat)}
                    testID={`resultat-${candidat.symbole}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectionne }}
                    style={[
                      styles.resultat,
                      { borderColor: palette.bordure, backgroundColor: selectionne ? palette.accentFond : 'transparent' },
                    ]}>
                    <View style={{ flex: 1, minWidth: 150 }}>
                      <Text style={{ color: selectionne ? palette.accent : palette.texte, fontWeight: '700' }} numberOfLines={1}>
                        {candidat.nom}
                      </Text>
                      <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
                        {[candidat.symbole, candidat.place, candidat.type ? TYPES[candidat.type] ?? candidat.type : undefined, candidat.devise]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                    <View style={styles.actions}>
                      <Pressable
                        accessibilityRole="button"
                        disabled={suivi}
                        onPress={() => onSurveiller(candidat)}
                        testID={`surveiller-${candidat.symbole}`}
                        style={[styles.petit, { borderColor: suivi ? palette.bordure : palette.accent }]}>
                        <Text style={{ color: suivi ? palette.texteSecondaire : palette.accent, fontWeight: '600', fontSize: 13 }}>
                          {suivi ? '★ Surveillée' : '☆ Surveiller'}
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => onOuvrirFiche(candidat.symbole)}
                        testID={`fiche-${candidat.symbole}`}
                        style={[styles.petit, { borderColor: palette.bordure }]}>
                        <Text style={{ color: palette.texte, fontWeight: '600', fontSize: 13 }}>Fiche</Text>
                      </Pressable>
                    </View>
                  </Pressable>
                );
              })}
            </CarteSection>

            {choisi ? (
              <CarteSection titre={choisi.nom} poids={1.6} testID="panneau-theses">
                <Segments<'theses' | 'actualites'>
                  options={['theses', 'actualites']}
                  actif={onglet}
                  onChoisir={setOnglet}
                  libelle={option => (option === 'theses' ? 'Thèses' : 'Actualités')}
                  prefixeTest="onglet-recherche"
                />
                {chargerTheses ? (
                  <FilTheses
                    valeurs={[{ nom: choisi.nom, symbole: choisi.symbole }]}
                    chargerTheses={chargerTheses}
                    mode={onglet}
                  />
                ) : (
                  <Vide>Les thèses et actualités se lisent dans l’application de bureau.</Vide>
                )}
              </CarteSection>
            ) : null}
          </Rangee>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: ESPACEMENT.m + 4, gap: ESPACEMENT.m },
  titre: { fontSize: 26, fontWeight: '800' },
  barre: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ESPACEMENT.s,
    borderWidth: 1,
    borderRadius: 999,
    paddingLeft: ESPACEMENT.m,
    padding: 4,
    maxWidth: 760,
  },
  saisie: { flex: 1, fontSize: 15, paddingVertical: ESPACEMENT.s, minWidth: 0 },
  bouton: { borderRadius: 999, paddingHorizontal: ESPACEMENT.m, paddingVertical: ESPACEMENT.s + 2 },
  centre: { alignItems: 'center', paddingVertical: ESPACEMENT.l },
  resultat: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: ESPACEMENT.s,
    padding: ESPACEMENT.s,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderRadius: RAYON.s,
  },
  actions: { flexDirection: 'row', gap: ESPACEMENT.s },
  petit: { borderWidth: 1, borderRadius: RAYON.s, paddingHorizontal: ESPACEMENT.s + 2, paddingVertical: 6 },
});
