/**
 * Graphiques de la page « Statistiques » (Fondateur), sans bibliothèque : barres horizontales, carte de
 * chaleur heure × jour et colonnes quotidiennes en vues natives (iPhone, iPad, site), courbe en SVG sur le
 * site et l'app PC (Courbe.web.tsx). Une seule teinte (l'accent du thème) dont l'intensité porte la
 * valeur : lisible en clair et en sombre dans les 8 thèmes ; chaque valeur est aussi écrite en texte
 * (jamais la couleur seule), et chaque marque a un libellé lu par les lecteurs d'écran.
 */

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { trStats, type CleStats } from '../../i18n/statistiques';
import { ESP, attenue, texte, type EtatPresse } from '../design';

export interface PointCourbe {
  jour: string;
  valeur: number;
  reconstitue?: boolean;
  /** Phrase du détail (survol, appui, lecteur d'écran). */
  detail: string;
}

/** Barre horizontale avec son libellé et sa valeur écrite. */
export function BarreH({ theme, libelle, valeur, max, texte: t, testID, onPress, discret }: { theme: ThemeHub; libelle: string; valeur: number; max: number; texte: string; testID?: string; onPress?(): void; discret?: boolean }) {
  const largeur = max > 0 && valeur > 0 ? Math.max(2, Math.round((valeur / max) * 100)) : 0;
  const contenu = (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: ESP.xs }}>
        <Text style={{ ...texte(theme, 14), flexShrink: 1 }} numberOfLines={1}>
          {libelle}
        </Text>
        <Text style={{ ...texte(theme, 13), fontWeight: '700', ...police(theme.policeChiffres), flexShrink: 0 }}>{t}</Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: teinteTransparente(theme.attenue, theme.sombre ? 0.18 : 0.12) }}>
        <View style={{ height: 8, borderRadius: 4, width: `${largeur}%`, backgroundColor: discret ? teinteTransparente(theme.accent, 0.5) : theme.accent }} />
      </View>
    </>
  );
  if (onPress) {
    return (
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${libelle} : ${t}`} onPress={onPress} style={(e: EtatPresse) => ({ gap: ESP.xxs, minHeight: 44, justifyContent: 'center', opacity: e.pressed ? 0.8 : 1 })}>
        {contenu}
      </Pressable>
    );
  }
  return (
    <View testID={testID} style={{ gap: ESP.xxs, paddingVertical: ESP.xxs }} accessible accessibilityLabel={`${libelle} : ${t}`}>
      {contenu}
    </View>
  );
}

/** Intensité d'une case (0 = vide) : une teinte, de pâle à soutenue. */
export const intensite = (theme: ThemeHub, v: number, max: number): string =>
  v <= 0 || max <= 0 ? teinteTransparente(theme.attenue, theme.sombre ? 0.12 : 0.08) : teinteTransparente(theme.accent, 0.18 + 0.82 * Math.min(1, v / max));

/** Carte de chaleur heure × jour de la semaine (lundi en haut). */
export function Chaleur({ theme, grille, large, testID = 'esport-stats-chaleur' }: { theme: ThemeHub; grille: number[][]; large: boolean; testID?: string }) {
  const [choisie, setChoisie] = useState<{ j: number; h: number } | undefined>();
  const max = Math.max(0, ...grille.flat());
  const hauteur = large ? 22 : 16;
  const detail = (j: number, h: number) => trStats('statistiques.chaleur_detail', { jour: trStats(`statistiques.jour.${j + 1}` as CleStats), heure: h, n: grille[j]?.[h] ?? 0 });
  return (
    <View style={{ gap: ESP.xs }} testID={testID}>
      <View style={{ flexDirection: 'row', paddingLeft: 36 }}>
        {Array.from({ length: 24 }, (_, h) => (
          <Text key={h} style={{ flex: 1, ...attenue(theme, 10), textAlign: 'left' }} numberOfLines={1}>
            {h % (large ? 3 : 6) === 0 ? String(h) : ''}
          </Text>
        ))}
      </View>
      {grille.map((ligne, j) => (
        <View key={j} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ width: 36, ...attenue(theme, 11) }}>{trStats(`statistiques.jour.${j + 1}` as CleStats)}</Text>
          {ligne.map((v, h) => {
            const actif = choisie?.j === j && choisie?.h === h;
            return (
              <Pressable
                key={h}
                testID={`${testID}-${j + 1}-${h}`}
                accessibilityRole="button"
                accessibilityLabel={detail(j, h)}
                onPress={() => setChoisie({ j, h })}
                onHoverIn={() => setChoisie({ j, h })}
                style={{ flex: 1, height: hauteur, padding: 1 }}>
                <View style={{ flex: 1, borderRadius: 3, backgroundColor: intensite(theme, v, max), borderWidth: actif ? 2 : 0, borderColor: theme.texte }} />
              </Pressable>
            );
          })}
        </View>
      ))}
      <Text style={attenue(theme)} testID={`${testID}-detail`} accessibilityLiveRegion="polite">
        {choisie ? detail(choisie.j, choisie.h) : trStats('statistiques.chaleur_aide')}
      </Text>
    </View>
  );
}

/** Colonnes quotidiennes (iPhone, iPad natifs) ; le site a sa courbe SVG (Courbe.web.tsx). */
export function ColonnesJour({ theme, points, testID }: { theme: ThemeHub; points: PointCourbe[]; testID: string }) {
  const [choisi, setChoisi] = useState<number | undefined>();
  const max = Math.max(1, ...points.map(p => p.valeur));
  return (
    <View style={{ gap: ESP.xs }} testID={testID}>
      <Text style={attenue(theme, 11)}>{String(max)}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 2, borderBottomWidth: 1, borderBottomColor: theme.ligne }}>
        {points.map((p, i) => (
          <Pressable key={p.jour} testID={`${testID}-${p.jour}`} accessibilityRole="button" accessibilityLabel={p.detail} onPress={() => setChoisi(i)} onHoverIn={() => setChoisi(i)} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
            <View
              style={{
                height: `${Math.round((p.valeur / max) * 100)}%`,
                minHeight: p.valeur > 0 ? 2 : 0,
                borderTopLeftRadius: 3,
                borderTopRightRadius: 3,
                backgroundColor: p.reconstitue ? teinteTransparente(theme.attenue, 0.45) : choisi === i ? theme.texte : theme.accent,
              }}
            />
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={attenue(theme, 11)}>{points[0]?.jour ?? ''}</Text>
        <Text style={attenue(theme, 11)}>{points[points.length - 1]?.jour ?? ''}</Text>
      </View>
      <Text style={attenue(theme)} testID={`${testID}-detail`} accessibilityLiveRegion="polite">
        {choisi !== undefined ? points[choisi]?.detail : ''}
      </Text>
    </View>
  );
}
