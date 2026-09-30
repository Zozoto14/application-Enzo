/**
 * Le podcast quotidien : un point bourse sur vos valeurs, lu à voix haute.
 *
 * L'épisode est écrit à partir du portefeuille et des actualités, puis lu
 * par une voix de Windows. On peut sauter d'un chapitre à l'autre, changer
 * la vitesse et la voix, et suivre le texte pendant la lecture.
 */

import React, { useEffect } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Bouton, usePalette } from '../composants';
import { CarteSection, Rangee, Segments, Selecteur, Vide } from '../elements';
import { ESPACEMENT, RAYON, palettePour, stylesPartages, POLICE_TITRE } from '../theme';
import type { Episode } from '../../podcast/episode';
import { useEtatLecture, useLecture } from '../lecturePodcast';
import { voixEffective } from '../../podcast/lecture';
import type { StatutSource } from '../../podcast/medias';

type Vitesse = '0,9×' | '1×' | '1,15×' | '1,3×';
const VITESSES: Record<Vitesse, number> = { '0,9×': 0.9, '1×': 1, '1,15×': 1.15, '1,3×': 1.3 };

export interface PodcastProps {
  episode?: Episode;
  chargement?: boolean;
  etape?: string;
  erreur?: string;
  /** Durée visée, en minutes. */
  minutes?: number;
  /** Ouvre Paramètres › Portefeuille, où se règle la préparation automatique. */
  onOuvrirParametres?(): void;
  onGenerer(minutes?: number): void;
}

type Format = 'Flash 2 min' | '5 min' | '10 min' | '15 min';
const FORMATS: Record<Format, number> = { 'Flash 2 min': 2, '5 min': 5, '10 min': 10, '15 min': 15 };

export function Podcast({
  episode,
  chargement,
  etape,
  erreur,
  minutes = 10,
  onOuvrirParametres,
  onGenerer,
}: PodcastProps) {
  const palette = usePalette();
  // La lecture est partagée par toute l'application : quitter cet écran ne
  // la coupe pas, le lecteur flottant prend le relais.
  const lecture = useLecture();
  const { lecteur } = lecture;
  const { etat, courante, file, voix, voixChoisie, avertissement, vitesse: vitesseLue } = useEtatLecture();
  const vitesse = (Object.keys(VITESSES) as Vitesse[]).find(cle => VITESSES[cle] === vitesseLue) ?? '1×';

  // Un nouvel épisode remplace l'ancien ; revenir sur l'écran ne change rien.
  useEffect(() => {
    lecture.charger(episode);
  }, [episode, lecture]);

  const basculer = () => lecture.basculer();
  const chapitreCourant = file[courante]?.chapitre ?? 0;
  const allerAuChapitre = (rang: number) => lecture.allerAuChapitre(rang);

  return (
    <View style={[stylesPartages.ecran, { backgroundColor: palettePour().fond }]}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={{ gap: 4 }}>
          <Text {...POLICE_TITRE} style={[styles.titre, { color: palette.texte }]} accessibilityRole="header">
            Podcast
          </Text>
          <Text style={{ color: palette.texteSecondaire }}>
            Votre point bourse du jour : portefeuille, actualités de vos valeurs, revue de presse, marchés et un sujet à comprendre.
          </Text>
        </View>

        <View style={styles.format}>
          <Text style={{ color: palette.texteSecondaire, fontSize: 13 }}>Durée de l’épisode</Text>
          <Segments<Format>
            options={Object.keys(FORMATS) as Format[]}
            actif={(Object.keys(FORMATS) as Format[]).find(cle => FORMATS[cle] === minutes) ?? '10 min'}
            onChoisir={valeur => {
              if (FORMATS[valeur] !== minutes && !chargement) {
                onGenerer(FORMATS[valeur]);
              }
            }}
            prefixeTest="format-podcast"
          />
        </View>

        {onOuvrirParametres ? (
          <View style={styles.format}>
            <Text style={{ color: palette.texteSecondaire, fontSize: 13, flexShrink: 1 }}>
              La préparation automatique du podcast se règle dans les Paramètres.
            </Text>
            <Bouton titre="Ouvrir les Paramètres" variante="discret" onPress={onOuvrirParametres} testID="ouvrir-parametres-podcast" />
          </View>
        ) : null}

        {chargement ? (
          <CarteSection>
            <View style={styles.centre}>
              <ActivityIndicator color={palette.accent} />
              <Text style={{ color: palette.texteSecondaire }}>{etape ?? 'Préparation de l’épisode…'}</Text>
            </View>
          </CarteSection>
        ) : null}

        {erreur ? (
          <CarteSection titre="Épisode incomplet">
            <Vide>{erreur}</Vide>
          </CarteSection>
        ) : null}

        {!episode && !chargement ? (
          <CarteSection>
            <Vide>Aucun épisode pour l’instant.</Vide>
            <View style={{ alignSelf: 'flex-start' }}>
              <Bouton titre="Préparer l’épisode du jour" onPress={() => onGenerer()} testID="bouton-generer-podcast" />
            </View>
          </CarteSection>
        ) : null}

        {episode ? (
          <>
            <CarteSection>
              <View style={styles.lecteur}>
                <Pressable
                  testID="bouton-lecture-podcast"
                  accessibilityRole="button"
                  accessibilityLabel={etat === 'lecture' ? 'Pause' : 'Lecture'}
                  disabled={!lecteur.disponible}
                  onPress={basculer}
                  style={({ pressed }) => [
                    styles.lecture,
                    { backgroundColor: palette.accentPlein, opacity: !lecteur.disponible ? 0.4 : pressed ? 0.85 : 1 },
                  ]}>
                  <Text style={{ color: palette.surAccent, fontSize: 26, fontWeight: '900' }}>
                    {etat === 'lecture' ? '❚❚' : '▶'}
                  </Text>
                </Pressable>
                <View style={{ flex: 1, minWidth: 220, gap: 4 }}>
                  <Text style={{ color: palette.texte, fontSize: 18, fontWeight: '800' }}>{episode.titre}</Text>
                  <Text style={{ color: palette.texteSecondaire }}>
                    Environ {episode.duree} minute{episode.duree > 1 ? 's' : ''} · {episode.chapitres.length} chapitres
                  </Text>
                  <Text style={{ color: palette.accent, fontWeight: '600' }}>
                    {episode.chapitres[chapitreCourant]?.titre}
                  </Text>
                  <View style={[styles.barreProgression, { backgroundColor: palette.bordure }]}>
                    <View
                      style={{
                        width: `${file.length > 0 ? ((courante + (etat === 'arret' ? 0 : 1)) / file.length) * 100 : 0}%`,
                        backgroundColor: palette.accent,
                        height: 4,
                        borderRadius: 2,
                      }}
                    />
                  </View>
                </View>
                <View style={styles.commandes}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Chapitre précédent"
                    onPress={() => allerAuChapitre(Math.max(0, chapitreCourant - 1))}
                    style={[styles.petitBouton, { borderColor: palette.bordure }]}>
                    <Text style={{ color: palette.texte, fontSize: 16 }}>⏮</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Chapitre suivant"
                    onPress={() => allerAuChapitre(Math.min(episode.chapitres.length - 1, chapitreCourant + 1))}
                    style={[styles.petitBouton, { borderColor: palette.bordure }]}>
                    <Text style={{ color: palette.texte, fontSize: 16 }}>⏭</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Arrêter"
                    onPress={() => lecture.arreter()}
                    style={[styles.petitBouton, { borderColor: palette.bordure }]}>
                    <Text style={{ color: palette.texte, fontSize: 16 }}>■</Text>
                  </Pressable>
                </View>
              </View>
              <View style={[styles.reglages, { zIndex: 20 }]}>
                <Segments<Vitesse>
                  options={Object.keys(VITESSES) as Vitesse[]}
                  actif={vitesse}
                  onChoisir={valeur => lecture.changerVitesse(VITESSES[valeur])}
                />
                {voix.length > 0 ? (
                  <Selecteur
                    etiquette="Voix"
                    valeur={voixEffective({ voix, voixChoisie }) ?? voix[0].id}
                    options={voix.map(element => ({ valeur: element.id, libelle: element.nom }))}
                    onChoisir={valeur => lecture.changerVoix(valeur)}
                    largeur={280}
                  />
                ) : null}
                <Pressable accessibilityRole="button" onPress={() => onGenerer()} style={[styles.petitBouton, { borderColor: palette.bordure, paddingHorizontal: 12 }]}>
                  <Text style={{ color: palette.texte, fontSize: 13 }}>Régénérer</Text>
                </Pressable>
              </View>
              {!lecteur.disponible ? (
                <Vide>La lecture à voix haute est disponible sur l’ordinateur. Le texte de l’épisode est ci-dessous.</Vide>
              ) : avertissement ? (
                <Vide>{avertissement}</Vide>
              ) : voix.length === 0 ? (
                <Vide>
                  Aucune voix française trouvée dans Windows : ajoutez-en une dans Paramètres › Heure et langue › Voix.
                </Vide>
              ) : null}
            </CarteSection>

            <Rangee>
              <CarteSection titre="Chapitres">
                {episode.chapitres.map((chapitre, rang) => {
                  const actif = rang === chapitreCourant;
                  return (
                    <Pressable
                      key={`${rang}-${chapitre.titre}`}
                      accessibilityRole="button"
                      onPress={() => allerAuChapitre(rang)}
                      style={[styles.chapitre, { backgroundColor: actif ? palette.accentFond : 'transparent' }]}>
                      <Text style={{ color: palette.texteSecondaire, width: 22, fontWeight: '700' }}>{rang + 1}</Text>
                      <Text style={{ color: actif ? palette.accent : palette.texte, fontWeight: actif ? '700' : '500', flex: 1 }}>
                        {chapitre.titre}
                      </Text>
                    </Pressable>
                  );
                })}
              </CarteSection>
              <CarteSection titre="Transcription" poids={2}>
                <ScrollView style={{ maxHeight: 460 }}>
                  {episode.chapitres.map((chapitre, rang) => (
                    <View key={`t-${rang}`} style={{ marginBottom: ESPACEMENT.m }}>
                      <Text style={{ color: palette.texteSecondaire, fontWeight: '800', fontSize: 12, marginBottom: 4 }}>
                        {chapitre.titre.toUpperCase()}
                      </Text>
                      <Text style={{ lineHeight: 22 }}>
                        {file
                          .map((phrase, index) => ({ phrase, index }))
                          .filter(({ phrase }) => phrase.chapitre === rang)
                          .map(({ phrase, index }) => (
                            <Text
                              key={index}
                              onPress={() => lecture.placer(index)}
                              style={{
                                color: index === courante && etat !== 'arret' ? palette.texte : palette.texteSecondaire,
                                backgroundColor: index === courante && etat !== 'arret' ? palette.accentFond : 'transparent',
                                fontStyle: phrase.langue === 'en' ? 'italic' : 'normal',
                                fontSize: 14,
                              }}>
                              {phrase.texte}{' '}
                            </Text>
                          ))}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              </CarteSection>
            </Rangee>

            {episode.sources.length > 0 ? (
              <CarteSection titre={`Sources (${episode.sources.length})`} testID="sources-podcast">
                <View style={styles.legende}>
                  {(['recoupee', 'reconnue', 'non-verifiee'] as const).map(statut => (
                    <View key={statut} style={styles.legendeLigne}>
                      <Badge statut={statut} />
                      <Text style={{ color: palette.texteSecondaire, fontSize: 12, flexShrink: 1 }}>
                        {EXPLICATIONS_STATUT[statut]}
                      </Text>
                    </View>
                  ))}
                </View>
                {episode.sources.map((source, rang) => (
                  <Pressable
                    key={`${rang}-${source.titre}`}
                    accessibilityRole={source.lien ? 'link' : undefined}
                    disabled={!source.lien}
                    onPress={() => (source.lien ? Linking.openURL(source.lien).catch(() => undefined) : undefined)}
                    style={[styles.source, { borderColor: palette.bordure }]}>
                    <Text style={{ color: palette.texteSecondaire, fontSize: 12, fontWeight: '700', minWidth: 96 }}>
                      {source.source}
                    </Text>
                    <View style={{ flex: 1, minWidth: 200, gap: 4 }}>
                      <Text style={{ color: source.lien ? palette.accent : palette.texte, fontSize: 13 }}>
                        {source.titre}
                      </Text>
                      {source.confirmations.length > 0 ? (
                        <Text style={{ color: palette.texteSecondaire, fontSize: 11 }}>
                          Aussi chez {source.confirmations.slice(0, 3).join(', ')}
                        </Text>
                      ) : null}
                    </View>
                    <Badge statut={source.statut} />
                  </Pressable>
                ))}
              </CarteSection>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const LIBELLES_STATUT: Record<StatutSource, string> = {
  recoupee: '✓✓ Recoupée',
  reconnue: '✓ Média reconnu',
  'non-verifiee': '! Non vérifiée',
};

const EXPLICATIONS_STATUT: Record<StatutSource, string> = {
  recoupee: 'au moins deux médias différents rapportent la même information',
  reconnue: 'signée par un média de presse économique établi, une seule source',
  'non-verifiee': 'site inconnu de l’application : à prendre avec prudence',
};

/** Pastille de fiabilité d'une source : ce n'est pas une vérification des faits. */
function Badge({ statut }: { statut: StatutSource }) {
  const palette = usePalette();
  const couleurs =
    statut === 'recoupee'
      ? { fond: palette.hausseFond, texte: palette.hausse }
      : statut === 'reconnue'
        ? { fond: palette.surfaceHaute, texte: palette.texte }
        : { fond: palette.baisseFond, texte: palette.baisse };
  return (
    <View
      accessibilityLabel={`Source : ${LIBELLES_STATUT[statut]}`}
      testID={`badge-${statut}`}
      style={[styles.badge, { backgroundColor: couleurs.fond }]}>
      <Text style={{ color: couleurs.texte, fontSize: 11, fontWeight: '800' }}>{LIBELLES_STATUT[statut]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  legende: { gap: 6, paddingBottom: ESPACEMENT.s },
  legendeLigne: { flexDirection: 'row', alignItems: 'center', gap: ESPACEMENT.s, flexWrap: 'wrap' },
  page: { padding: ESPACEMENT.m + 4, gap: ESPACEMENT.m },
  format: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ESPACEMENT.m },
  source: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ESPACEMENT.s,
    paddingVertical: ESPACEMENT.s,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  titre: { fontSize: 26, fontWeight: '800' },
  centre: { alignItems: 'center', gap: ESPACEMENT.s, padding: ESPACEMENT.m },
  lecteur: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ESPACEMENT.l },
  lecture: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  commandes: { flexDirection: 'row', gap: ESPACEMENT.s },
  petitBouton: { minWidth: 44, minHeight: 40, borderWidth: 1, borderRadius: RAYON.s, alignItems: 'center', justifyContent: 'center' },
  barreProgression: { height: 4, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  reglages: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ESPACEMENT.m },
  chapitre: { flexDirection: 'row', alignItems: 'center', minHeight: 40, borderRadius: RAYON.s, paddingHorizontal: ESPACEMENT.s },
});
