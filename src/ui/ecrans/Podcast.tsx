/**
 * Le podcast quotidien : un point bourse sur vos valeurs, lu à voix haute.
 *
 * L'épisode est écrit à partir du portefeuille et des actualités, puis lu
 * par une voix de Windows. On peut sauter d'un chapitre à l'autre, changer
 * la vitesse et la voix, et suivre le texte pendant la lecture.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Bouton, usePalette } from '../composants';
import { CarteSection, Rangee, Segments, Selecteur, Vide } from '../elements';
import { ESPACEMENT, RAYON, palettePour, stylesPartages } from '../theme';
import { phrases, type Episode } from '../../podcast/episode';
import { creerLecteur, type PhraseALire } from '../../podcast/lecteur';

type Vitesse = '0,9×' | '1×' | '1,15×' | '1,3×';
const VITESSES: Record<Vitesse, number> = { '0,9×': 0.9, '1×': 1, '1,15×': 1.15, '1,3×': 1.3 };

interface PhraseDeChapitre extends PhraseALire {
  chapitre: number;
}

export interface PodcastProps {
  episode?: Episode;
  chargement?: boolean;
  etape?: string;
  erreur?: string;
  onGenerer(): void;
}

export function Podcast({ episode, chargement, etape, erreur, onGenerer }: PodcastProps) {
  const palette = usePalette();
  const lecteur = useMemo(() => creerLecteur(), []);
  const [etat, setEtat] = useState<'arret' | 'lecture' | 'pause'>('arret');
  const [courante, setCourante] = useState(0);
  const [vitesse, setVitesse] = useState<Vitesse>('1×');
  const [voix, setVoix] = useState(lecteur.voix());
  const [voixChoisie, setVoixChoisie] = useState<string | undefined>();

  useEffect(() => lecteur.surChangementVoix(() => setVoix(lecteur.voix())), [lecteur]);
  // Quitter l'écran arrête la lecture.
  useEffect(() => () => lecteur.arreter(), [lecteur]);

  const file: PhraseDeChapitre[] = useMemo(
    () =>
      (episode?.chapitres ?? []).flatMap((chapitre, rang) =>
        chapitre.segments.flatMap(segment =>
          phrases(segment.texte).map(texte => ({ texte, langue: segment.langue, chapitre: rang })),
        ),
      ),
    [episode],
  );

  // Nouvel épisode : on repart du début.
  useEffect(() => {
    lecteur.arreter();
    setEtat('arret');
    setCourante(0);
  }, [episode, lecteur]);

  const lireDepuis = (index: number, vitesseLecture = VITESSES[vitesse], voixLecture = voixChoisie) => {
    setCourante(index);
    setEtat('lecture');
    lecteur.lire(file, index, { vitesse: vitesseLecture, voixFrancaise: voixLecture }, {
      surPhrase: setCourante,
      surFin: () => {
        setEtat('arret');
        setCourante(0);
      },
    });
  };

  const basculer = () => {
    if (etat === 'lecture') {
      lecteur.pause();
      setEtat('pause');
    } else if (etat === 'pause') {
      lecteur.reprendre();
      setEtat('lecture');
    } else {
      lireDepuis(courante);
    }
  };

  const chapitreCourant = file[courante]?.chapitre ?? 0;
  const debutChapitre = (rang: number) => Math.max(0, file.findIndex(phrase => phrase.chapitre === rang));
  const allerAuChapitre = (rang: number) => {
    const index = debutChapitre(rang);
    if (etat === 'arret') {
      setCourante(index);
    } else {
      lireDepuis(index);
    }
  };

  return (
    <View style={[stylesPartages.ecran, { backgroundColor: palettePour().fond }]}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={{ gap: 4 }}>
          <Text style={[styles.titre, { color: palette.texte }]} accessibilityRole="header">
            Podcast
          </Text>
          <Text style={{ color: palette.texteSecondaire }}>
            Votre point bourse du jour : portefeuille, actualités de vos valeurs, agenda et un sujet à comprendre.
          </Text>
        </View>

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
              <Bouton titre="Préparer l’épisode du jour" onPress={onGenerer} testID="bouton-generer-podcast" />
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
                    onPress={() => {
                      lecteur.arreter();
                      setEtat('arret');
                    }}
                    style={[styles.petitBouton, { borderColor: palette.bordure }]}>
                    <Text style={{ color: palette.texte, fontSize: 16 }}>■</Text>
                  </Pressable>
                </View>
              </View>
              <View style={[styles.reglages, { zIndex: 20 }]}>
                <Segments<Vitesse>
                  options={Object.keys(VITESSES) as Vitesse[]}
                  actif={vitesse}
                  onChoisir={valeur => {
                    setVitesse(valeur);
                    if (etat === 'lecture') {
                      lireDepuis(courante, VITESSES[valeur]);
                    }
                  }}
                />
                {voix.length > 0 ? (
                  <Selecteur
                    etiquette="Voix"
                    valeur={voixChoisie ?? voix[0].id}
                    options={voix.map(element => ({ valeur: element.id, libelle: element.nom }))}
                    onChoisir={valeur => {
                      setVoixChoisie(valeur);
                      if (etat === 'lecture') {
                        lireDepuis(courante, VITESSES[vitesse], valeur);
                      }
                    }}
                    largeur={280}
                  />
                ) : null}
                <Pressable accessibilityRole="button" onPress={onGenerer} style={[styles.petitBouton, { borderColor: palette.bordure, paddingHorizontal: 12 }]}>
                  <Text style={{ color: palette.texte, fontSize: 13 }}>Régénérer</Text>
                </Pressable>
              </View>
              {!lecteur.disponible ? (
                <Vide>La lecture à voix haute est disponible sur l’ordinateur. Le texte de l’épisode est ci-dessous.</Vide>
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
                              onPress={() => (etat === 'arret' ? setCourante(index) : lireDepuis(index))}
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
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: ESPACEMENT.m + 4, gap: ESPACEMENT.m },
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
