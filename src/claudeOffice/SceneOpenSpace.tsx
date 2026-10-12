/**
 * Claude Office, scène « open space » hors du web (application native) :
 * version simplifiée en vues, sans SVG ni marche : une case par zone
 * thématique (mêmes zones, couleurs et gadgets que la scène isométrique du
 * web, `SceneOpenSpace.web.tsx`), avec les personnages qui s'y trouvent.
 * Décorative : la liste des agents (Bureau.tsx) porte l'information.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { activiteAgent, apparence, ICONES_ACTIVITE, TEINTES_ACTIVITE } from './logiqueScene';
import { ORDRE_ZONES, ZONES } from './zones';
import type { PropsScene } from './sceneTypes';

export function SceneOpenSpace({ agents, theme, reduit, largeur, choisi, onChoisir, demo, estompes }: PropsScene) {
  const sombre = theme.sombre;
  const largeurCase = Math.max(140, (largeur - 32) / 2 - 4);
  return (
    <View
      style={[styles.piece, { width: largeur, backgroundColor: sombre ? '#3A2E25' : '#E3C9A2' }]}
      testID={reduit ? 'scene-fixe' : 'scene-animee'}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {demo ? <Text style={styles.demo} testID="scene-demo">DÉMO</Text> : null}
      <View style={styles.zones}>
        {ORDRE_ZONES.map(z => {
          const ici = agents.filter(a => a.zone === z);
          return (
            <View key={z} style={[styles.zone, { width: largeurCase, borderColor: ZONES[z].teinte, backgroundColor: sombre ? '#262B38' : '#FBF7F0' }]}>
              <Text style={{ color: ZONES[z].teinte, fontWeight: '800', fontSize: 15 }} numberOfLines={1}>{`${ZONES[z].icone} ${ZONES[z].nom}${ici.length ? ` · ${ici.length}` : ''}`}</Text>
              <View style={styles.persos}>
                {ici.map(agent => {
                  const activite = activiteAgent(agent);
                  const ap = apparence(agent);
                  return (
                    <Pressable key={agent.cle} onPress={() => onChoisir(agent.cle)} style={[styles.perso, { borderColor: agent.cle === choisi ? theme.accent : 'transparent', opacity: estompes?.has(agent.cle) ? 0.3 : agent.fige ? 0.55 : 1 }]}>
                      <View style={[styles.tete, { backgroundColor: ap.peau, borderTopColor: ap.cheveux }]} />
                      <View style={[styles.corps, { backgroundColor: ap.haut }]} />
                      <Text style={[styles.icone, { color: TEINTES_ACTIVITE[activite] }]}>{ICONES_ACTIVITE[activite]}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  piece: { borderRadius: 10, overflow: 'hidden', alignSelf: 'center', padding: 12 },
  demo: { alignSelf: 'flex-end', color: '#FFFFFF', backgroundColor: '#E0803A', fontWeight: '800', paddingHorizontal: 10, borderRadius: 10, overflow: 'hidden', marginBottom: 8 },
  zones: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  zone: { borderWidth: 2, borderRadius: 10, padding: 8, minHeight: 84, gap: 6 },
  persos: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  perso: { width: 44, height: 44, alignItems: 'center', justifyContent: 'flex-end', borderWidth: 2, borderRadius: 8 },
  tete: { width: 14, height: 14, borderRadius: 7, borderTopWidth: 4 },
  corps: { width: 18, height: 10, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  icone: { position: 'absolute', top: 0, right: 2, fontSize: 12, fontWeight: '700' },
});
