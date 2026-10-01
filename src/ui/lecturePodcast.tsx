/**
 * La lecture du podcast côté interface : les crochets pour s'y abonner, et
 * le lecteur flottant qui la suit d'écran en écran.
 */

import React, { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable, Text } from './mobile/adaptatif';
import { lecturePartagee, type EtatLecture, type Lecture } from '../podcast/lecture';
import { usePalette } from './composants';
import { ESPACEMENT, RAYON } from './theme';

export function useLecture(): Lecture {
  return lecturePartagee();
}

export function useEtatLecture(): EtatLecture {
  const lecture = lecturePartagee();
  return useSyncExternalStore(lecture.abonner, lecture.etat, lecture.etat);
}

/**
 * Petit lecteur posé en bas de l'écran pendant qu'un épisode joue ailleurs
 * que sur la page Podcast : chapitre en cours, pause, arrêt, retour à la page.
 */
export function LecteurFlottant({ onOuvrir }: { onOuvrir(): void }) {
  const palette = usePalette();
  const lecture = useLecture();
  const { etat, episode, file, courante } = useEtatLecture();
  if (etat === 'arret' || !episode) {
    return null;
  }
  const chapitre = episode.chapitres[file[courante]?.chapitre ?? 0]?.titre;
  const progression = file.length > 0 ? ((courante + 1) / file.length) * 100 : 0;

  return (
    <View
      testID="lecteur-flottant"
      style={[styles.lecteur, { backgroundColor: palette.surface, borderColor: palette.bordure }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={etat === 'lecture' ? 'Pause' : 'Reprendre'}
        onPress={() => lecture.basculer()}
        style={[styles.rond, { backgroundColor: palette.accentPlein }]}>
        <Text style={{ color: palette.surAccent, fontWeight: '900', fontSize: 14 }}>{etat === 'lecture' ? '❚❚' : '▶'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Ouvrir le podcast" onPress={onOuvrir} style={styles.texte}>
        <Text style={{ color: palette.texte, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>
          {episode.titre}
        </Text>
        <Text style={{ color: palette.texteSecondaire, fontSize: 12 }} numberOfLines={1}>
          {etat === 'pause' ? 'En pause · ' : ''}
          {chapitre}
        </Text>
        <View style={[styles.barre, { backgroundColor: palette.bordure }]}>
          <View style={{ width: `${progression}%`, height: 3, borderRadius: 2, backgroundColor: palette.accent }} />
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Chapitre suivant"
        onPress={() => lecture.chapitreSuivant(1)}
        style={[styles.petit, { borderColor: palette.bordure }]}>
        <Text style={{ color: palette.texte, fontSize: 14 }}>⏭</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Arrêter le podcast"
        onPress={() => lecture.arreter()}
        style={[styles.petit, { borderColor: palette.bordure }]}>
        <Text style={{ color: palette.texte, fontSize: 14 }}>■</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  lecteur: {
    position: 'absolute',
    right: ESPACEMENT.m,
    bottom: ESPACEMENT.m,
    width: 380,
    maxWidth: '92%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: ESPACEMENT.s,
    padding: ESPACEMENT.s + 2,
    borderRadius: RAYON.l,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    zIndex: 50,
  },
  rond: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  texte: { flex: 1, gap: 2, minHeight: 44, justifyContent: 'center' },
  barre: { height: 3, borderRadius: 2, marginTop: 4, overflow: 'hidden' },
  petit: { width: 44, height: 44, borderRadius: RAYON.s, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
