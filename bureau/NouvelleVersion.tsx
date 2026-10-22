/**
 * Bandeau discret « Nouvelle version — recharger » (site seulement).
 *
 * Le build publie `version.json` (servi sans cache) avec son identifiant. Au retour sur l'onglet
 * (visibilitychange), l'application le relit : s'il diffère de celui compilé dans la page, un déploiement
 * a eu lieu et la page est périmée. Rien ne se recharge sans clic.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ESPACEMENT, type Palette } from '../src/ui/theme';

/** Identifiant du serveur, ou undefined (hors ligne, fichier absent, app Electron en file://). */
export async function identifiantServeur(): Promise<string | undefined> {
  try {
    if (typeof document === 'undefined' || !/^https?:$/.test(document.location.protocol)) {
      return undefined;
    }
    const reponse = await fetch(new URL(`version.json?t=${Date.now()}`, document.baseURI).href, { cache: 'no-store' });
    if (!reponse.ok) {
      return undefined;
    }
    const donnees = (await reponse.json()) as { id?: unknown };
    return typeof donnees.id === 'string' ? donnees.id : undefined;
  } catch {
    return undefined;
  }
}

export function BandeauNouvelleVersion({ palette }: { palette: Palette }) {
  const [perimee, setPerimee] = useState(false);

  useEffect(() => {
    if (typeof __BUILD_ID__ === 'undefined' || typeof document === 'undefined') {
      return;
    }
    let vivant = true;
    const verifier = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      void identifiantServeur().then(id => {
        if (vivant && id && id !== __BUILD_ID__) {
          setPerimee(true);
        }
      });
    };
    document.addEventListener('visibilitychange', verifier);
    return () => {
      vivant = false;
      document.removeEventListener('visibilitychange', verifier);
    };
  }, []);

  if (!perimee) {
    return null;
  }
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" testID="bandeau-nouvelle-version" style={[styles.bandeau, { backgroundColor: palette.surface, borderColor: palette.accent }]}>
      <Text style={{ color: palette.texte, flex: 1, fontSize: 13 }}>Nouvelle version disponible.</Text>
      <Pressable
        accessibilityRole="button"
        testID="nouvelle-version-recharger"
        onPress={() => globalThis.location?.reload()}
        style={({ pressed }) => [styles.bouton, { borderColor: palette.bordure, opacity: pressed ? 0.8 : 1 }]}>
        <Text style={{ color: palette.texte, fontWeight: '700', fontSize: 13 }}>Nouvelle version — recharger</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bandeau: { flexDirection: 'row', alignItems: 'center', gap: ESPACEMENT.s, paddingVertical: 6, paddingHorizontal: ESPACEMENT.m, borderBottomWidth: 1, flexWrap: 'wrap' },
  bouton: { borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12, minHeight: 32, justifyContent: 'center' },
});
