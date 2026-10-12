/**
 * Claude Office v4 : NOTE libre attachée à une session (« à vérifier », « bug
 * corrigé »…), visible et modifiable dans le Détail d'un agent et l'Historique.
 * Rangée sur l'appareil (equipe.ts, clé `claude-office.notes`), jamais envoyée.
 * Intégration : une ligne `<NoteSession theme session projet />` là où l'on veut la voir.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { ThemeHub } from '../hub/themes';
import { MAX_NOTE, magasinEnDemo, modifierNote, noteDe, useMagasinSuivi } from './equipe';
import { Bouton, TAILLE } from './uiOffice';

export function NoteSession({ theme, session, projet, compact }: { theme: ThemeHub; session: string; projet?: string; compact?: boolean }) {
  useMagasinSuivi();
  const note = noteDe(session);
  const [edition, setEdition] = useState<string>();
  const id = session.slice(0, 12);
  const a = { color: theme.attenue, fontSize: TAILLE, lineHeight: 21 };
  if (edition !== undefined) {
    return (
      <View style={styles.bloc} testID={`note-edition-${id}`}>
        <TextInput
          value={edition}
          onChangeText={t => setEdition(t.slice(0, MAX_NOTE))}
          multiline
          autoFocus
          placeholder="Ta note : « à vérifier », « bug corrigé »…"
          placeholderTextColor={theme.attenue}
          accessibilityLabel={`Note de la session ${session.slice(0, 8)}`}
          style={[styles.champ, { color: theme.texte, borderColor: theme.ligne, backgroundColor: theme.fond }]}
          testID={`note-champ-${id}`}
        />
        <View style={styles.boutons}>
          <Bouton theme={theme} variante="plein" compact titre="Enregistrer" onPress={() => { modifierNote(session, edition, projet); setEdition(undefined); }} testID={`note-enregistrer-${id}`} />
          <Bouton theme={theme} compact titre="Annuler" onPress={() => setEdition(undefined)} testID={`note-annuler-${id}`} />
          {note ? <Bouton theme={theme} variante="danger" compact titre="Supprimer" onPress={() => { modifierNote(session, '', projet); setEdition(undefined); }} testID={`note-supprimer-${id}`} /> : null}
        </View>
        <Text style={a}>{magasinEnDemo() ? 'Démo : la note n’est pas enregistrée.' : 'Gardée sur cet appareil seulement.'}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.ligne, compact ? null : styles.bloc]} testID={`note-${id}`}>
      {note ? (
        <Text style={[styles.texte, { color: theme.texte, borderLeftColor: theme.accent }]} selectable testID={`note-texte-${id}`}>
          <Text style={{ fontWeight: '700' }}>Note : </Text>{note.texte}
        </Text>
      ) : null}
      <Bouton
        theme={theme}
        variante="discret"
        compact
        titre={note ? 'Modifier la note' : 'Ajouter une note'}
        libelle={`${note ? 'Modifier' : 'Ajouter'} la note de la session ${session.slice(0, 8)}`}
        onPress={() => setEdition(note?.texte ?? '')}
        testID={`note-modifier-${id}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bloc: { gap: 6 },
  ligne: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  texte: { fontSize: TAILLE, lineHeight: 21, borderLeftWidth: 3, paddingLeft: 8, flexShrink: 1, flexBasis: 220, flexGrow: 1 },
  champ: { borderWidth: 1, borderRadius: 10, padding: 10, minHeight: 88, fontSize: 16, textAlignVertical: 'top' },
  boutons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
