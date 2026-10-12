/**
 * Claude Office, scène « open space » hors du web (application native) :
 * version simplifiée en vues, sans SVG ni marche. Mêmes postes (affectation
 * déterministe par identifiant), mêmes couleurs et gadgets que la scène
 * isométrique du web (`SceneOpenSpace.web.tsx`). Décorative : la liste des
 * agents (Bureau.tsx) porte l'information.
 */

import React, { useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { activiteAgent, apparence, attribuerPostes, ICONES_ACTIVITE, ILOTS_X, TEINTES_ACTIVITE } from './logiqueScene';
import type { PropsScene } from './sceneTypes';

export function SceneOpenSpace({ agents, theme, reduit, largeur, choisi, onChoisir, demo }: PropsScene) {
  // Postes stables tant que l'agent reste dans la liste.
  const deja = useRef(new Map<string, number>());
  const postes = useMemo(() => {
    const presents = new Set(agents.map(a => a.cle));
    const gardes = new Map([...deja.current].filter(([cle]) => presents.has(cle)));
    const res = attribuerPostes(agents.map(a => a.cle), gardes);
    deja.current = res;
    return res;
  }, [agents]);
  const parPoste = new Map([...postes].map(([cle, p]) => [p, agents.find(a => a.cle === cle)]));
  const sombre = theme.sombre;
  const largeurIlot = Math.max(96, (largeur - 32) / ILOTS_X.length);

  return (
    <View
      style={[styles.piece, { width: largeur, backgroundColor: sombre ? '#3A2E25' : '#E3C9A2' }]}
      testID={reduit ? 'scene-fixe' : 'scene-animee'}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <View style={[styles.mur, { backgroundColor: sombre ? '#2B3150' : '#F5F0E6' }]}>
        {[0, 1, 2].map(k => <View key={k} style={[styles.fenetre, { backgroundColor: sombre ? '#1B2447' : '#BFE3FF' }]} />)}
        {demo ? <Text style={styles.demo} testID="scene-demo">DÉMO</Text> : null}
      </View>
      <View style={styles.ilots}>
        {ILOTS_X.map((_, ilot) => (
          <View key={ilot} style={[styles.ilot, { width: largeurIlot, backgroundColor: sombre ? '#38415C' : '#C5D0D9' }]}>
            {[0, 1, 2, 3].map(k => {
              const index = ilot * 4 + k;
              const agent = parPoste.get(index);
              const activite = agent ? activiteAgent(agent) : undefined;
              const teinte = activite ? TEINTES_ACTIVITE[activite] : '#8E95A8';
              const ap = agent ? apparence(agent) : undefined;
              return (
                <Pressable
                  key={k}
                  onPress={agent ? () => onChoisir(agent.cle) : undefined}
                  style={[styles.poste, { borderColor: agent && agent.cle === choisi ? theme.accent : 'transparent' }]}
                >
                  <View style={[styles.ecran, { backgroundColor: activite && activite !== 'fini' ? teinte : sombre ? '#11141B' : '#2A2F3A' }]} />
                  <View style={[styles.bureau, { backgroundColor: sombre ? '#B9AF9F' : '#FBF7F0' }]} />
                  {ap && activite !== 'fini' ? (
                    <View style={[styles.perso, agent?.fige ? { opacity: 0.55 } : null]}>
                      <View style={[styles.tete, { backgroundColor: ap.peau, borderTopColor: ap.cheveux }]} />
                      <View style={[styles.corps, { backgroundColor: ap.haut }]} />
                    </View>
                  ) : null}
                  {activite ? <Text style={[styles.icone, { color: teinte }]}>{ICONES_ACTIVITE[activite]}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  piece: { borderRadius: 10, overflow: 'hidden', alignSelf: 'center' },
  mur: { height: 40, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 16, paddingBottom: 4 },
  fenetre: { width: 54, height: 24, borderRadius: 2 },
  demo: { position: 'absolute', right: 10, top: 8, color: '#FFFFFF', backgroundColor: '#E0803A', fontWeight: '800', paddingHorizontal: 10, borderRadius: 10, overflow: 'hidden' },
  ilots: { flexDirection: 'row', justifyContent: 'center', gap: 8, padding: 12 },
  ilot: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 8, padding: 4 },
  poste: { width: '50%', height: 64, alignItems: 'center', justifyContent: 'flex-end', borderWidth: 2, borderRadius: 8 },
  ecran: { position: 'absolute', top: 6, width: 26, height: 16, borderRadius: 2 },
  bureau: { width: '86%', height: 10, borderRadius: 2, marginBottom: 8 },
  perso: { position: 'absolute', bottom: 14, alignItems: 'center' },
  tete: { width: 14, height: 14, borderRadius: 7, borderTopWidth: 4 },
  corps: { width: 18, height: 10, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  icone: { position: 'absolute', top: 2, right: 4, fontSize: 12, fontWeight: '700' },
});
