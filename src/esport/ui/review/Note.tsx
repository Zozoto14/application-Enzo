/**
 * Rendu d'une note de review (Markdown limité) en composants : le texte passe
 * par React (échappé), jamais par du HTML brut. Liens http(s) seulement.
 */

import React from 'react';
import { Linking, Text, View } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { analyserMarkdown, type Bloc, type Inline } from '../../review/markdown';

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

export function NoteMarkdown({ theme, source, testID }: { theme: ThemeHub; source: string; testID?: string }) {
  const blocs: Bloc[] = analyserMarkdown(source);
  if (blocs.length === 0) return null;
  const base = { color: theme.texte, fontSize: 14, lineHeight: 20, ...police(theme.policeTexte) };
  return (
    <View testID={testID} style={{ gap: 6 }}>
      {blocs.map((b, i) => {
        if (b.t === 'paragraphe') {
          return (
            <Text key={i} style={base}>
              <Segments theme={theme} liste={b.v} />
            </Text>
          );
        }
        if (b.t === 'titre') {
          return (
            <Text key={i} accessibilityRole="header" style={{ ...base, fontWeight: '800', fontSize: b.niveau === 1 ? 18 : 15 }}>
              <Segments theme={theme} liste={b.v} />
            </Text>
          );
        }
        return (
          <View key={i} style={{ gap: 2 }}>
            {b.v.map((item, j) => (
              <View key={j} style={{ flexDirection: 'row', gap: 6 }}>
                <Text style={base}>{b.ordonnee ? `${j + 1}.` : '•'}</Text>
                <Text style={[base, { flexShrink: 1 }]}>
                  <Segments theme={theme} liste={item} />
                </Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}
