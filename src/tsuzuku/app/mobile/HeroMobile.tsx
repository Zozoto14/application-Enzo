/**
 * Bandeau « à la une » du téléphone : visuel plein cadre fondu dans le fond, étiquette, titre sur
 * deux lignes, genres, synopsis court et deux actions pleine largeur (48 px).
 */

import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { police, teinteTransparente } from '../../../hub/themes';
import { BoutonPrincipal } from '../../../ui/mobile/BoutonPrincipal';
import { TEXTE, rayonCarte } from '../../../ui/mobile/jetons';
import { useTsuzuku } from '../contexte';

export interface UneMobile {
  id: string;
  titre: string;
  image: string | null;
  banniere: string | null;
  score: number | null;
  meta: string;
  genres: string[];
  synopsis: string | null;
}

export function HeroMobile({ une, film, dejaDansBiblio, onPrincipal, onFiche, onAjouter }: { une: UneMobile; film: boolean; dejaDansBiblio: boolean; onPrincipal(): void; onFiche(): void; onAjouter(): void }) {
  const { theme } = useTsuzuku();
  const visuel = une.image || une.banniere;
  return (
    <View testID="tsuzuku-une" accessibilityLabel="À la une" style={[st.cadre, { borderRadius: rayonCarte(theme), borderColor: theme.ligne, backgroundColor: theme.surface }]}>
      {visuel ? <Image source={{ uri: visuel }} accessibilityIgnoresInvertColors style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      {/* Fondu par paliers (pas de dégradé natif) : le texte reste lisible sur n'importe quelle image, dans les 8 thèmes. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: teinteTransparente(theme.fond, 0.2) }]} />
      {['70%', '50%', '32%'].map(h => (
        <View key={h} pointerEvents="none" style={[st.palier, { height: h as `${number}%`, backgroundColor: teinteTransparente(theme.fond, 0.5) }]} />
      ))}
      <View style={st.contenu}>
        <View style={st.ligne}>
          <View style={{ backgroundColor: theme.accent, paddingHorizontal: 10, paddingVertical: 3, borderRadius: Math.min(theme.rayonMoyen, 6) }}>
            <Text style={{ color: theme.surAccent, fontSize: TEXTE.legende, fontWeight: '800', ...police(theme.policeTexte) }}>{film ? 'Film à l’affiche' : 'Animé à la une'}</Text>
          </View>
          {une.score ? <Text style={{ color: theme.accent, fontSize: TEXTE.legende, fontWeight: '800' }}>★ {une.score.toFixed(1)} / 10</Text> : null}
        </View>
        <Text accessibilityRole="header" numberOfLines={2} testID="une-titre" style={{ color: theme.texte, fontSize: 30, lineHeight: 36, fontWeight: theme.poidsTitre === '400' ? '600' : '800', letterSpacing: -0.4, ...police(theme.policeTitre) }}>
          {une.titre}
        </Text>
        {une.meta ? <Text style={{ color: theme.texte, fontSize: TEXTE.legende, fontWeight: '600', opacity: 0.9, ...police(theme.policeTexte) }}>{une.meta}</Text> : null}
        {une.genres.length ? <Text style={{ color: theme.accent, fontSize: TEXTE.legende, fontWeight: '700', ...police(theme.policeTexte) }}>{une.genres.slice(0, 4).join(' · ')}</Text> : null}
        {une.synopsis ? (
          <Text numberOfLines={3} style={{ color: theme.texte, opacity: 0.9, fontSize: 16, lineHeight: 23, ...police(theme.policeTexte) }}>
            {une.synopsis}
          </Text>
        ) : null}
        <View style={{ gap: 8, marginTop: 4 }}>
          <BoutonPrincipal theme={theme} titre={film ? '▶ Regarder' : '▶ Voir la fiche'} onPress={onPrincipal} testID="une-principal" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {film ? (
              <View style={{ flex: 1 }}>
                <BoutonPrincipal theme={theme} variante="discret" titre="Voir la fiche" onPress={onFiche} testID="une-fiche" />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              {dejaDansBiblio ? (
                <Text style={{ color: theme.texte, fontSize: TEXTE.legende, fontWeight: '700', textAlign: 'center', paddingVertical: 12, ...police(theme.policeTexte) }}>✓ Dans ta bibliothèque</Text>
              ) : (
                <BoutonPrincipal theme={theme} variante="discret" titre={film ? '+ À voir' : '+ Ma bibliothèque'} onPress={onAjouter} testID="une-ajouter" />
              )}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  cadre: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, minHeight: 470, justifyContent: 'flex-end' },
  palier: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  contenu: { padding: 16, gap: 10 },
  ligne: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
});
