/**
 * Indicateur de synchronisation : petit point coloré + pictogramme + texte
 * (l'état ne repose jamais sur la seule couleur), et le bouton « Synchroniser
 * maintenant » dans sa version détaillée (Paramètres du hub).
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BoutonHub } from './Hub';
import { resumerSynchro, type NiveauSynchro, type VueSynchroHub } from './etatSynchro';
import { police, type ThemeHub } from './themes';

export interface SynchroHub {
  vue: VueSynchroHub;
  onSynchroniser(): void;
}

function couleur(theme: ThemeHub, niveau: NiveauSynchro): string {
  return niveau === 'ok' ? theme.ok : niveau === 'erreur' ? theme.critique : niveau === 'attente' ? theme.alerte : theme.accent;
}

/** Heure courante, rafraîchie chaque 20 s pour que « il y a 2 min » avance. */
function useMaintenant(): number {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setMaintenant(Date.now()), 20_000);
    return () => clearInterval(id);
  }, []);
  return maintenant;
}

export function IndicateurSynchro({ theme, synchro, detaille = false }: { theme: ThemeHub; synchro: SynchroHub; detaille?: boolean }) {
  const maintenant = useMaintenant();
  const resume = resumerSynchro(synchro.vue, maintenant);
  const teinte = couleur(theme, resume.niveau);
  const rayon = Math.min(theme.rayonMoyen, 10);
  return (
    <View style={detaille ? { gap: 10 } : undefined}>
      <View
        testID="synchro-indicateur"
        accessible
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`Synchronisation : ${resume.libelle}`}
        // @ts-expect-error `title` n'existe que sur le web (infobulle).
        title={resume.detail}
        style={[styles.pastille, { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: detaille ? rayon : 999 }]}>
        <View style={[styles.point, { backgroundColor: teinte }]} />
        <Text style={{ color: teinte, fontWeight: '800', fontSize: 13 }}>{resume.icone}</Text>
        <Text testID="synchro-libelle" style={{ color: theme.texte, fontSize: 13, fontWeight: '600', flexShrink: 1, ...police(theme.policeTexte) }} numberOfLines={detaille ? 3 : 1}>
          {resume.libelle}
        </Text>
      </View>
      {detaille ? (
        <>
          {resume.detail ? (
            <Text testID="synchro-detail" style={{ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) }}>
              {resume.detail}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <BoutonHub
              theme={theme}
              titre={synchro.vue.enCours ? 'Synchronisation…' : 'Synchroniser maintenant'}
              desactive={synchro.vue.enCours}
              onPress={synchro.onSynchroniser}
              testID="synchro-maintenant"
            />
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pastille: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start', maxWidth: '100%' },
  point: { width: 8, height: 8, borderRadius: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
