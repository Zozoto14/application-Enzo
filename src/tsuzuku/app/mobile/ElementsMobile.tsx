/**
 * Éléments de Tsuzuku pour le téléphone : affiches à 2 colonnes, rangées qui défilent avec inertie
 * et indicateur, tuiles « Reprendre », sélecteur Animés | Films, champ de recherche.
 *
 * Mesures : texte 15 px au minimum, zones tactiles 44 px au minimum, 16 px de marge latérale. Les
 * badges (« Déjà vu », « Vu ailleurs ») restent sur l'affiche ; le statut (« En cours »…) passe
 * sous le titre, en texte, pour ne jamais se chevaucher sur une affiche de 170 px.
 */

import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { Entree } from '../../moteur/bibliotheque';
import { CONTROLE, ESPACE, TEXTE, rayonCarte, rayonControle } from '../../../ui/mobile/jetons';
import { useTsuzuku } from '../contexte';
import { LIBELLE_MODE, themeDuMode, type Mode } from '../themeTsuzuku';
import { styleTitre, type ElementCarte } from '../ui';

const ECART = 12;
const LARGEUR_RANGEE = 140;

function Pastille({ fond, children, testID }: { fond: string; children: React.ReactNode; testID?: string }) {
  return (
    <View testID={testID} style={[st.pastille, { backgroundColor: fond }]}>
      {children}
    </View>
  );
}

/** Texte lisible sur `fond` (noir ou blanc, selon la luminance). */
function surFond(fond: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(fond);
  if (!m) return '#FFFFFF';
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#0B0F17' : '#FFFFFF';
}

/** Affiche : 2:3, badges sur l'image, titre sur 2 lignes, sous-titre, ligne d'accent. */
export function AfficheMobile({ e, largeur }: { e: ElementCarte; largeur?: number }) {
  const { theme } = useTsuzuku();
  const vu = e.statut === 'vu' || e.statut === 'vu_ailleurs';
  const ailleurs = e.statut === 'vu_ailleurs';
  const fondVu = ailleurs ? theme.teintes.admin : theme.ok;
  const rayon = Math.max(Math.min(theme.rayonMoyen, 12), 4);
  const statutTexte = e.statut && !vu && e.badge ? e.badge : undefined;
  return (
    <Pressable
      testID={`carte-${e.cle}`}
      accessibilityRole="button"
      accessibilityLabel={`${e.titre}${e.badge ? `, ${e.badge}` : ''}${e.sousTitre ? `, ${e.sousTitre}` : ''}`}
      onPress={e.onPress}
      style={({ pressed }) => [{ width: largeur ?? '100%', opacity: pressed ? 0.8 : 1, gap: 6 }]}>
      <View style={{ width: '100%', aspectRatio: 2 / 3, borderRadius: rayon, overflow: 'hidden', backgroundColor: teinteTransparente(theme.texte, 0.08), alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.ligne }}>
        {e.image ? (
          <Image source={{ uri: e.image }} accessibilityIgnoresInvertColors style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <Text numberOfLines={4} style={[styleTitre(theme, 17), { color: theme.attenue, textAlign: 'center', paddingHorizontal: 10 }]}>
            {e.titre}
          </Text>
        )}
        <View pointerEvents="none" style={[st.fondu, { height: 40, backgroundColor: 'rgba(0,0,0,0.2)' }]} />
        <View pointerEvents="none" style={[st.fondu, { height: 18, backgroundColor: 'rgba(0,0,0,0.2)' }]} />
        <View style={st.coinGauche}>
          {e.score ? (
            <Pastille fond={teinteTransparente(theme.fond, 0.9)}>
              <Text style={{ color: theme.accent, fontSize: TEXTE.legende, fontWeight: '800' }}>☆ {e.score.toFixed(1)}</Text>
            </Pastille>
          ) : null}
          {e.note ? (
            <Pastille fond={theme.accent}>
              <Text style={{ color: theme.surAccent, fontSize: TEXTE.legende, fontWeight: '800' }}>{e.note}/10</Text>
            </Pastille>
          ) : null}
        </View>
        {e.favori ? (
          <View style={st.coinDroit} accessibilityLabel="Favori">
            <Pastille fond={teinteTransparente(theme.fond, 0.9)}>
              <Text style={{ color: theme.accent, fontSize: TEXTE.legende, fontWeight: '800' }}>★</Text>
            </Pastille>
          </View>
        ) : null}
        {vu ? (
          <View style={{ position: 'absolute', left: 6, bottom: 8 }}>
            <Pastille fond={fondVu} testID="badge-deja-vu">
              <Text style={{ color: surFond(fondVu), fontSize: TEXTE.legende, fontWeight: '800', ...police(theme.policeTexte) }}>{ailleurs ? '◉ Vu ailleurs' : '✓ Déjà vu'}</Text>
            </Pastille>
          </View>
        ) : null}
        {e.progression && e.progression > 0 ? (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 5, backgroundColor: teinteTransparente('#FFFFFF', 0.3) }}>
            <View style={{ width: `${Math.min(100, Math.round(e.progression * 100))}%`, height: 5, backgroundColor: theme.accent }} />
          </View>
        ) : null}
      </View>
      <Text numberOfLines={2} style={{ color: theme.texte, fontSize: TEXTE.legende, lineHeight: 20, fontWeight: '700', ...police(theme.policeTexte) }}>
        {e.titre}
      </Text>
      {e.sousTitre ? (
        <Text numberOfLines={1} style={{ color: theme.attenue, fontSize: TEXTE.legende, ...police(theme.policeTexte) }}>
          {e.sousTitre}
        </Text>
      ) : null}
      {e.ligneAccent || statutTexte ? (
        <Text numberOfLines={1} style={{ color: theme.accent, fontSize: TEXTE.legende, fontWeight: '700', ...police(theme.policeTexte) }}>
          {e.ligneAccent ?? statutTexte}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Indicateur de position d'une rangée qui défile : une fine piste et sa poignée. */
function useDefilement() {
  const [etat, setEtat] = useState({ x: 0, contenu: 0, visible: 0 });
  return {
    etat,
    props: {
      scrollEventThrottle: 32,
      onScroll: (ev: NativeSyntheticEvent<NativeScrollEvent>) => setEtat(e => ({ ...e, x: ev.nativeEvent.contentOffset.x })),
      onContentSizeChange: (w: number) => setEtat(e => ({ ...e, contenu: w })),
      onLayout: (ev: { nativeEvent: { layout: { width: number } } }) => setEtat(e => ({ ...e, visible: ev.nativeEvent.layout.width })),
    },
  };
}

function Indicateur({ etat, theme }: { etat: { x: number; contenu: number; visible: number }; theme: ThemeHub }) {
  if (etat.contenu <= etat.visible + 1 || etat.visible <= 0) return null;
  const part = etat.visible / etat.contenu;
  const gauche = Math.min(1 - part, Math.max(0, etat.x / etat.contenu));
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={[st.piste, { backgroundColor: teinteTransparente(theme.texte, 0.12) }]} testID="rangee-indicateur">
      <View style={{ position: 'absolute', top: 0, bottom: 0, left: `${gauche * 100}%`, width: `${part * 100}%`, borderRadius: 3, backgroundColor: theme.accent }} />
    </View>
  );
}

function TitreRangee({ titre, nombre }: { titre: string; nombre?: number }) {
  const { theme } = useTsuzuku();
  return (
    <View style={st.titreRangee}>
      <View style={{ width: 4, height: 22, borderRadius: 2, backgroundColor: theme.accent }} />
      <Text accessibilityRole="header" style={[styleTitre(theme, TEXTE.section), { flexShrink: 1 }]}>
        {titre}
      </Text>
      {nombre ? <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, marginLeft: 'auto', ...police(theme.policeTexte) }}>{nombre}</Text> : null}
    </View>
  );
}

/** Rangée d'affiches : défilement horizontal avec inertie, arrêt sur chaque affiche, indicateur. */
export function RangeeMobile({ titre, elements, testID }: { titre: string; elements: ElementCarte[]; testID?: string }) {
  const { theme } = useTsuzuku();
  const defil = useDefilement();
  if (!elements.length) return null;
  return (
    <View style={{ gap: ESPACE.s }} testID={testID} accessibilityLabel={titre}>
      <TitreRangee titre={titre} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={LARGEUR_RANGEE + ECART}
        snapToAlignment="start"
        {...defil.props}
        style={st.rangeeDefil}
        contentContainerStyle={{ gap: ECART, paddingHorizontal: 16, alignItems: 'flex-start' }}>
        {elements.map(e => (
          <AfficheMobile key={e.cle} e={e} largeur={LARGEUR_RANGEE} />
        ))}
      </ScrollView>
      <Indicateur etat={defil.etat} theme={theme} />
    </View>
  );
}

/** Grille d'affiches à 2 colonnes. */
export function GrilleMobile({ elements, testID }: { elements: ElementCarte[]; testID?: string }) {
  return (
    <View style={st.grille} testID={testID}>
      {elements.map(e => (
        <View key={e.cle} style={{ width: '48%' }}>
          <AfficheMobile e={e} />
        </View>
      ))}
    </View>
  );
}

/** Tuiles « Reprendre » : affiche, épisode suivant, progression, appel à l'action (toute la tuile se touche). */
export function RangeeReprendreMobile({ titre, entrees, onLire, testID = 'rangee-reprendre' }: { titre: string; entrees: Entree[]; onLire(e: Entree): void; testID?: string }) {
  const { theme } = useTsuzuku();
  const defil = useDefilement();
  if (!entrees.length) return null;
  const largeur = 300;
  return (
    <View style={{ gap: ESPACE.s }} testID={testID} accessibilityLabel={titre}>
      <TitreRangee titre={titre} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={largeur + ECART}
        snapToAlignment="start"
        {...defil.props}
        style={st.rangeeDefil}
        contentContainerStyle={{ gap: ECART, paddingHorizontal: 16 }}>
        {entrees.map(e => {
          const film = e.kind === 'movie';
          const suivant = (e.currentEpisode || 0) + 1;
          const pct = !film && e.totalEpisodes ? Math.min(1, (e.currentEpisode || 0) / e.totalEpisodes) : 0;
          return (
            <Pressable
              key={`${e.kind}-${e.id}`}
              testID={`reprendre-${e.kind}-${e.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${film ? 'Regarder' : 'Reprendre'} ${e.title}${film ? '' : `, épisode ${suivant}`}`}
              onPress={() => onLire(e)}
              style={({ pressed }) => ({ width: largeur, flexDirection: 'row', gap: 12, padding: 10, borderRadius: rayonCarte(theme), borderWidth: StyleSheet.hairlineWidth, borderColor: theme.ligne, backgroundColor: theme.surface, opacity: pressed ? 0.8 : 1 })}>
              <View style={{ width: 80, height: 120, borderRadius: Math.min(theme.rayonMoyen, 10), overflow: 'hidden', backgroundColor: teinteTransparente(theme.texte, 0.08) }}>
                {e.image ? <Image source={{ uri: e.image }} accessibilityIgnoresInvertColors style={{ width: 80, height: 120 }} resizeMode="cover" /> : null}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={2} style={{ color: theme.texte, fontSize: TEXTE.corps, lineHeight: 22, fontWeight: '700', ...police(theme.policeTexte) }}>
                  {e.title}
                </Text>
                <Text numberOfLines={1} style={{ marginTop: 2, color: theme.accent, fontSize: TEXTE.legende, fontWeight: '700', ...police(theme.policeTexte) }}>
                  {film ? 'Prêt à regarder' : `Épisode ${suivant}${e.totalEpisodes ? ` / ${e.totalEpisodes}` : ''}`}
                </Text>
                {pct > 0 ? (
                  <View style={{ marginTop: 8, height: 5, borderRadius: 3, overflow: 'hidden', backgroundColor: teinteTransparente(theme.texte, 0.14) }}>
                    <View style={{ width: `${Math.round(pct * 100)}%`, height: 5, backgroundColor: theme.accent }} />
                  </View>
                ) : null}
                <View style={{ marginTop: 'auto', flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent }}>
                    <Text style={{ color: theme.surAccent, fontSize: TEXTE.legende, fontWeight: '800' }}>▶</Text>
                  </View>
                  <Text style={{ color: theme.texte, fontSize: TEXTE.legende, fontWeight: '800', ...police(theme.policeTexte) }}>{film ? 'Regarder' : 'Reprendre'}</Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <Indicateur etat={defil.etat} theme={theme} />
    </View>
  );
}

/** Contrôle segmenté Animés | Films : l'actif prend l'accent de son univers (jamais plus de 3 segments). */
export function SelecteurModeMobile({ mode, themeHub, onChoisir }: { mode: Mode; themeHub: ThemeHub; onChoisir(m: Mode): void }) {
  return (
    <View style={[st.segments, { backgroundColor: themeHub.surface, borderColor: themeHub.ligne, borderRadius: rayonControle(themeHub) === 999 ? 999 : rayonControle(themeHub) + 4 }]} accessibilityRole="radiogroup" accessibilityLabel="Type de contenu">
      {(['anime', 'movie'] as const).map(m => {
        const actif = m === mode;
        const t = themeDuMode(themeHub, m);
        return (
          <Pressable
            key={m}
            testID={`mode-${m}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: actif }}
            aria-checked={actif}
            accessibilityLabel={LIBELLE_MODE[m]}
            onPress={() => onChoisir(m)}
            style={[st.segment, { backgroundColor: actif ? t.accent : 'transparent', borderRadius: rayonControle(themeHub) === 999 ? 999 : rayonControle(themeHub) }]}>
            <Text style={{ color: actif ? t.surAccent : themeHub.attenue, fontWeight: actif ? '800' : '600', fontSize: TEXTE.corps, ...police(themeHub.policeTexte) }}>
              {m === 'anime' ? '✦ ' : '▤ '}
              {LIBELLE_MODE[m]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Champ de recherche : 48 px, 17 px (pas de zoom iOS), touche « Rechercher » du clavier, croix pour vider. */
export function ChampRecherche({ valeur, onChanger, onValider, libelle, placeholder, testID }: { valeur: string; onChanger(v: string): void; onValider(): void; libelle: string; placeholder: string; testID: string }) {
  const { theme } = useTsuzuku();
  return (
    <View style={[st.recherche, { backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: rayonControle(theme) === 999 ? 24 : rayonControle(theme) }]}>
      <Text accessibilityElementsHidden style={{ color: theme.attenue, fontSize: 20, paddingLeft: 14 }}>
        ⌕
      </Text>
      <TextInput
        testID={testID}
        accessibilityLabel={libelle}
        value={valeur}
        onChangeText={onChanger}
        placeholder={placeholder}
        placeholderTextColor={theme.attenue}
        inputMode="search"
        enterKeyHint="search"
        returnKeyType="search"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={onValider}
        style={[st.saisie, { color: theme.texte, ...police(theme.policeTexte) }, { outlineStyle: 'none' } as object]}
      />
      {valeur ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Effacer la recherche" onPress={() => onChanger('')} style={st.effacer} testID={`${testID}-effacer`}>
          <Text style={{ color: theme.attenue, fontSize: 18 }}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  pastille: { alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  fondu: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  coinGauche: { position: 'absolute', top: 6, left: 6, gap: 4, alignItems: 'flex-start' },
  coinDroit: { position: 'absolute', top: 6, right: 6 },
  piste: { height: 4, borderRadius: 2, marginHorizontal: 16, overflow: 'hidden' },
  rangeeDefil: { marginHorizontal: -16 },
  titreRangee: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grille: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 18 },
  segments: { flexDirection: 'row', padding: 4, gap: 4, borderWidth: StyleSheet.hairlineWidth },
  segment: { flex: 1, minHeight: CONTROLE.cible, alignItems: 'center', justifyContent: 'center' },
  recherche: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: CONTROLE.hauteur, borderWidth: 1 },
  saisie: { flex: 1, minHeight: CONTROLE.hauteur - 2, fontSize: TEXTE.champ, paddingHorizontal: 10 },
  effacer: { width: CONTROLE.cible, height: CONTROLE.cible, alignItems: 'center', justifyContent: 'center' },
});
