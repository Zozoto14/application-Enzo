/**
 * Claude Office v4 : portrait d'agent hors du web (application native), en
 * simples vues ; l'accessoire est rappelé par un petit signe. Version SVG :
 * `AvatarAgent.web.tsx`.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PropsAvatar } from './avatarTypes';

const SIGNES: Record<string, string> = { lunettes: '◎', casque: '∩', bonnet: '▲', noeud: '⋈', echarpe: '≈', couronne: '♛', casquette: '◒', fleur: '✿' };

export function AvatarAgent({ apparence, accessoire, taille = 48, favori, testID }: PropsAvatar) {
  return (
    <View testID={testID} style={[styles.cadre, { width: taille, height: taille, borderRadius: taille / 2, backgroundColor: apparence.haut }]} aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={[styles.tete, { width: taille * 0.42, height: taille * 0.42, borderRadius: taille * 0.21, backgroundColor: apparence.peau, borderTopColor: apparence.cheveux }]} />
      {accessoire && SIGNES[accessoire] ? <Text style={styles.signe}>{SIGNES[accessoire]}</Text> : null}
      {favori ? <Text style={styles.favori}>★</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cadre: { alignItems: 'center', justifyContent: 'flex-end', overflow: 'visible' },
  tete: { borderTopWidth: 5, marginBottom: '18%' },
  signe: { position: 'absolute', top: -2, left: -2, fontSize: 15, color: '#1F2430' },
  favori: { position: 'absolute', top: -4, right: -4, fontSize: 15, color: '#F2C14E' },
});
