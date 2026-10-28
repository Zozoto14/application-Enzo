/** Briques communes du trombinoscope : pastilles des réseaux, photo d'un joueur (ou ses initiales). */

import React from 'react';
import { Image, Text, View } from 'react-native';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { ReseauTrombi } from '../../trombi/api';
import { trTb } from '../../i18n/trombi';
import { initiales } from '../design';

/** Pastille d'un réseau (lettre ou glyphe, couleur du réseau). */
export const RESEAUX_AFFICHES: Record<ReseauTrombi, { nom: string; glyphe: string; couleur: string }> = {
  x: { nom: 'X', glyphe: '𝕏', couleur: '#0f1419' },
  instagram: { nom: 'Instagram', glyphe: '◎', couleur: '#d62976' },
  tiktok: { nom: 'TikTok', glyphe: '♪', couleur: '#111111' },
  twitch: { nom: 'Twitch', glyphe: '◆', couleur: '#9146ff' },
  youtube: { nom: 'YouTube', glyphe: '▶', couleur: '#ff0000' },
  autre: { nom: '', glyphe: '↗', couleur: '#5b6475' },
};

/** Photo carrée, ou initiales sur la couleur de la team. */
export function PhotoJoueur({ theme, url, pseudo, couleur, taille, testID }: { theme: ThemeHub; url: string | null; pseudo: string; couleur: string; taille?: number; testID?: string }) {
  const style = { width: taille ?? '100%', aspectRatio: 1, borderRadius: Math.min(theme.rayonGrand, 14), overflow: 'hidden' as const, backgroundColor: teinteTransparente(couleur, 0.22) };
  if (url) return <Image source={{ uri: url }} style={style} accessibilityLabel={trTb('photo_de', { pseudo })} testID={testID} resizeMode="cover" />;
  return (
    <View style={[style, { alignItems: 'center', justifyContent: 'center' }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID={testID}>
      <Text style={{ color: couleur, fontWeight: '800', fontSize: taille ? Math.round(taille / 2.8) : 34 }}>{initiales(pseudo)}</Text>
    </View>
  );
}

export function PastilleReseau({ theme, reseau, libelle, taille = 24 }: { theme: ThemeHub; reseau: ReseauTrombi; libelle?: string; taille?: number }) {
  const r = RESEAUX_AFFICHES[reseau];
  return (
    <View
      accessibilityLabel={reseau === 'autre' ? libelle || trTb('reseau.autre') : r.nom}
      style={{ width: taille, height: taille, borderRadius: taille / 2, backgroundColor: r.couleur, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.ligne }}>
      <Text style={{ color: '#ffffff', fontSize: Math.round(taille * 0.5), fontWeight: '700' }}>{r.glyphe}</Text>
    </View>
  );
}
