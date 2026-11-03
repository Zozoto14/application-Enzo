/** Briques communes du trombinoscope : pastilles des réseaux, photo d'un joueur (ou ses initiales), puces des badges. */

import React from 'react';
import { Image, Text, View } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { badgesVisibles, libelleBadge, type BadgeAffiche, type ReseauTrombi } from '../../trombi/api';
import { trTb, trnTb } from '../../i18n/trombi';
import { TYPO, initiales } from '../design';
import { Glyphe } from '../../../ui/icones';

/** Pastille d'un réseau (lettre ou glyphe, couleur du réseau). */
export const RESEAUX_AFFICHES: Record<ReseauTrombi, { nom: string; glyphe: string; couleur: string }> = {
  x: { nom: 'X', glyphe: '𝕏', couleur: '#0f1419' },
  instagram: { nom: 'Instagram', glyphe: '◎', couleur: '#d62976' },
  tiktok: { nom: 'TikTok', glyphe: '♪', couleur: '#111111' },
  twitch: { nom: 'Twitch', glyphe: '◆', couleur: '#9146ff' },
  youtube: { nom: 'YouTube', glyphe: '▶︎', couleur: '#ff0000' },
  autre: { nom: '', glyphe: '↗︎', couleur: '#5b6475' },
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
      <Glyphe valeur={r.glyphe} style={{ color: '#ffffff', fontSize: Math.round(taille * 0.5), fontWeight: '700' }} />
    </View>
  );
}

/**
 * Puce d'un badge (migration 0032) : couleur du badge en fond léger, bordure et pastille (ou icône / emoji), nom
 * et team éventuelle (« Capitaine · Team Alpha »). Le texte reste à la couleur du thème : lisible en clair et sombre.
 */
export function PuceBadge({ theme, badge, testID }: { theme: ThemeHub; badge: Pick<BadgeAffiche, 'nom' | 'couleur' | 'icone' | 'teamNom'>; testID?: string }) {
  const c = badge.couleur;
  return (
    <View
      testID={testID}
      accessibilityLabel={libelleBadge(badge)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        alignSelf: 'flex-start',
        maxWidth: '100%',
        paddingHorizontal: 9,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: teinteTransparente(c, theme.sombre ? 0.26 : 0.16),
        borderWidth: 1,
        borderColor: teinteTransparente(c, 0.7),
      }}>
      {badge.icone ? <Text style={{ fontSize: TYPO.legende, color: c }}>{badge.icone}</Text> : <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c }} />}
      <Text style={{ color: theme.texte, fontSize: TYPO.legende, fontWeight: '700', flexShrink: 1, ...police(theme.policeTexte) }} numberOfLines={1}>
        {badge.teamNom ? `${badge.nom} · ${badge.teamNom}` : badge.nom}
      </Text>
    </View>
  );
}

/** Puces des badges d'un membre : toutes, ou les `max` premières et « +N ». */
export function PucesBadges({ theme, badges, max, testID }: { theme: ThemeHub; badges: readonly BadgeAffiche[]; max?: number; testID?: string }) {
  if (!badges.length) return null;
  const { visibles, reste } = max ? badgesVisibles(badges, max) : { visibles: badges, reste: 0 };
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }} testID={testID}>
      {visibles.map(b => (
        <PuceBadge key={`${b.id}-${b.teamId ?? 'club'}`} theme={theme} badge={b} testID={testID ? `${testID}-${b.id}` : undefined} />
      ))}
      {reste ? (
        <View accessibilityLabel={trnTb('badges.autres', reste)} style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: theme.ligne }} testID={testID ? `${testID}-plus` : undefined}>
          <Text style={{ color: theme.attenue, fontSize: TYPO.legende, fontWeight: '700' }}>{`+${reste}`}</Text>
        </View>
      ) : null}
    </View>
  );
}
