/**
 * Rendu d'une note (Markdown limité) en composants : le texte passe par React
 * (échappé), jamais par du HTML brut. Liens http(s) seulement ; couleurs
 * seulement parmi COULEURS. Titres, listes (puces, numérotées, cases avec
 * retraits), citations, blocs de code et séparateurs.
 * `onBasculerCase` rend les cases cochables (aperçu de l'éditeur) ; sans lui, elles sont en lecture seule.
 */

import React from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { analyserMarkdown, type Bloc, type Couleur, type Inline } from '../../review/markdown';
import { tr } from '../../i18n';

const TEINTES: Record<Couleur, string> = {
  rouge: '#e5484d',
  orange: '#f08a24',
  jaune: '#d9a400',
  vert: '#2fa866',
  bleu: '#3b82f6',
  violet: '#8b5cf6',
  rose: '#e255a1',
  gris: '#8b8f98',
};

/** Teinte d'une couleur de texte prédéfinie (affichée dans la barre d'outils comme dans le rendu). */
export const teinteCouleur = (c: Couleur): string => TEINTES[c];

function Segments({ theme, liste }: { theme: ThemeHub; liste: Inline[] }) {
  return (
    <>
      {liste.map((x, i) => {
        switch (x.t) {
          case 'texte':
            return <React.Fragment key={i}>{x.v}</React.Fragment>;
          case 'gras':
            return (
              <Text key={i} style={{ fontWeight: '800' }}>
                <Segments theme={theme} liste={x.v} />
              </Text>
            );
          case 'italique':
            return (
              <Text key={i} style={{ fontStyle: 'italic' }}>
                <Segments theme={theme} liste={x.v} />
              </Text>
            );
          case 'barre':
            return (
              <Text key={i} style={{ textDecorationLine: 'line-through' }}>
                <Segments theme={theme} liste={x.v} />
              </Text>
            );
          case 'surligne':
            return (
              <Text key={i} style={{ backgroundColor: 'rgba(250, 204, 21, 0.38)' }}>
                <Segments theme={theme} liste={x.v} />
              </Text>
            );
          case 'couleur':
            return (
              <Text key={i} style={{ color: TEINTES[x.c] }}>
                <Segments theme={theme} liste={x.v} />
              </Text>
            );
          case 'mention':
            return (
              <Text key={i} style={{ color: theme.accent, fontWeight: '700' }}>
                {x.v}
              </Text>
            );
          case 'code':
            return (
              <Text key={i} style={{ fontFamily: 'Menlo, Consolas, monospace', backgroundColor: teinteTransparente(theme.attenue, 0.2) }}>
                {x.v}
              </Text>
            );
          case 'lien':
            return (
              <Text key={i} accessibilityRole="link" onPress={() => void Linking.openURL(x.href)} style={{ color: theme.accent, textDecorationLine: 'underline' }}>
                <Segments theme={theme} liste={x.v} />
              </Text>
            );
        }
      })}
    </>
  );
}

export function NoteMarkdown({ theme, source, testID, onBasculerCase }: { theme: ThemeHub; source: string; testID?: string; onBasculerCase?: (ligne: number) => void }) {
  const blocs: Bloc[] = analyserMarkdown(source);
  if (blocs.length === 0) return null;
  const base = { color: theme.texte, fontSize: 14, lineHeight: 20, ...police(theme.policeTexte) };
  const mono = { fontFamily: Platform.OS === 'web' ? 'Menlo, Consolas, monospace' : Platform.OS === 'ios' ? 'Menlo' : 'monospace' };
  return (
    <View testID={testID} style={{ gap: 6 }}>
      {blocs.map((b, i) => {
        switch (b.t) {
          case 'paragraphe':
            return (
              <Text key={i} style={base}>
                <Segments theme={theme} liste={b.v} />
              </Text>
            );
          case 'titre':
            return (
              <Text key={i} accessibilityRole="header" style={{ ...base, fontWeight: '800', fontSize: b.niveau === 1 ? 20 : b.niveau === 2 ? 17 : 15, lineHeight: b.niveau === 1 ? 26 : b.niveau === 2 ? 23 : 20 }}>
                <Segments theme={theme} liste={b.v} />
              </Text>
            );
          case 'citation':
            return (
              <View key={i} style={{ borderLeftWidth: 3, borderLeftColor: theme.accent, paddingLeft: 10, opacity: 0.92 }}>
                <Text style={{ ...base, fontStyle: 'italic' }}>
                  <Segments theme={theme} liste={b.v} />
                </Text>
              </View>
            );
          case 'code':
            return (
              <ScrollView key={i} horizontal style={{ borderRadius: 6, backgroundColor: teinteTransparente(theme.attenue, 0.18) }} contentContainerStyle={{ padding: 8 }}>
                <Text selectable style={{ ...base, ...mono, fontSize: 13, lineHeight: 18 }}>
                  {b.v}
                </Text>
              </ScrollView>
            );
          case 'separateur':
            return <View key={i} accessibilityRole="none" style={{ height: 1, backgroundColor: theme.ligne, marginVertical: 4 }} />;
          case 'liste':
            return (
              <View key={i} style={{ gap: 2 }}>
                {b.items.map((it, j) => (
                  <View key={j} style={{ flexDirection: 'row', gap: 6, marginLeft: it.niveau * 18 }}>
                    {it.coche !== null ? (
                      <Pressable
                        testID={testID ? `${testID}-case-${it.ligne}` : undefined}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: it.coche, disabled: !onBasculerCase }}
                        accessibilityLabel={tr('champNote.cocher')}
                        disabled={!onBasculerCase}
                        hitSlop={8}
                        onPress={() => onBasculerCase?.(it.ligne)}
                        style={{ width: 18, height: 18, marginTop: 1, borderRadius: 4, borderWidth: 2, borderColor: it.coche ? theme.accent : theme.attenue, backgroundColor: it.coche ? theme.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                        {it.coche ? <Text style={{ color: theme.fond, fontSize: 12, fontWeight: '900', lineHeight: 14 }}>✓</Text> : null}
                      </Pressable>
                    ) : (
                      <Text style={base}>{it.ordonnee ? `${it.numero}.` : it.niveau % 2 === 0 ? '•' : '◦'}</Text>
                    )}
                    <Text style={[base, { flexShrink: 1 }, it.coche ? { opacity: 0.65, textDecorationLine: 'line-through' } : null]}>
                      <Segments theme={theme} liste={it.v} />
                    </Text>
                  </View>
                ))}
              </View>
            );
        }
      })}
    </View>
  );
}
