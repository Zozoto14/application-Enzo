/**
 * Affichage d'un devblog, dans la DA du devblog Discord : titre « 🚀 … 🛠️ », phrase d'intro, sections avec leur
 * emoji et leur titre en gras, puces « Nom : description », phrase de fin. Sert à la fenêtre « Nouveautés », à
 * l'historique et à l'aperçu « comme dans l'app » de l'éditeur. Et l'aperçu « comme sur Discord » (messages
 * découpés, fil français).
 */

import React from 'react';
import { Text, View } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { ContenuDevblog } from '../../devblog/api';
import { dateLisible, segmentsLigne } from '../../devblog/rendu';
import { trDv } from '../../i18n/devblog';
import { ESP, attenue, rayonCarte, texte } from '../design';

export function VueDevblog({ theme, contenu, langue, date, version, compact, testID }: { theme: ThemeHub; contenu: ContenuDevblog; langue: 'fr' | 'en'; date: string; version?: string | null; compact?: boolean; testID?: string }) {
  const deuxPoints = langue === 'en' ? ':' : ' :';
  return (
    <View style={{ gap: compact ? ESP.s : ESP.m }} testID={testID}>
      <View style={{ gap: ESP.xxs }}>
        <Text accessibilityRole="header" style={{ ...texte(theme, compact ? 20 : 24), fontWeight: '800', ...police(theme.policeTitre) }}>
          {`🚀 ${contenu.titre || 'DEVBLOG'} 🛠️`}
        </Text>
        <Text style={attenue(theme, 13)}>{[dateLisible(date, langue), version ? trDv('version', { v: version }) : ''].filter(Boolean).join(' · ')}</Text>
      </View>
      {contenu.intro ? <Text style={{ ...texte(theme, 15), lineHeight: 22 }}>{contenu.intro}</Text> : null}
      {contenu.sections.map((s, i) => (
        <View
          key={`${i}-${s.titre}`}
          style={{ gap: ESP.xs, padding: compact ? ESP.s : ESP.m, borderRadius: rayonCarte(theme), backgroundColor: teinteTransparente(theme.accent, theme.sombre ? 0.1 : 0.06), borderWidth: 1, borderColor: teinteTransparente(theme.accent, 0.18) }}
          testID={testID ? `${testID}-section-${i}` : undefined}>
          <Text accessibilityRole="header" style={{ ...texte(theme, 16), fontWeight: '800' }}>
            {[s.emoji, s.titre].filter(Boolean).join('  ')}
          </Text>
          {s.puces.map((p, j) => (
            <View key={j} style={{ flexDirection: 'row', gap: ESP.xs, alignItems: 'flex-start' }}>
              <Text style={{ ...texte(theme, 15), color: theme.accent, lineHeight: 22 }}>•</Text>
              <Text style={{ ...texte(theme, 15), flex: 1, lineHeight: 22 }}>
                {p.nom ? <Text style={{ fontWeight: '700' }}>{`${p.nom}${deuxPoints} `}</Text> : null}
                {p.description}
              </Text>
            </View>
          ))}
        </View>
      ))}
      {contenu.conclusion ? <Text style={{ ...texte(theme, 15), lineHeight: 22 }}>{contenu.conclusion}</Text> : null}
    </View>
  );
}

/** Couleurs du thème sombre de Discord (l'aperçu ressemble au vrai message, quel que soit le thème de l'app). */
const DISCORD = { fond: '#313338', texte: '#dbdee1', attenue: '#949ba4', mention: '#c9cdfb', fondMention: 'rgba(88,101,242,0.3)', fil: '#2b2d31', avatar: '#5865f2' } as const;

function LigneDiscord({ ligne }: { ligne: string }) {
  const { petit, morceaux } = segmentsLigne(ligne);
  return (
    <Text style={{ color: petit ? DISCORD.attenue : DISCORD.texte, fontSize: petit ? 12 : 15, lineHeight: petit ? 16 : 21 }}>
      {morceaux.map((m, i) => {
        // « @here » : surligné comme une mention.
        const parts = m.texte.split(/(@here)/);
        return parts.map((p, k) =>
          p === '@here' ? (
            <Text key={`${i}-${k}`} style={{ color: DISCORD.mention, backgroundColor: DISCORD.fondMention, fontWeight: '600' }}>
              @here
            </Text>
          ) : (
            <Text key={`${i}-${k}`} style={m.gras ? { fontWeight: '700', color: '#f2f3f5' } : undefined}>
              {p}
            </Text>
          ),
        );
      })}
      {ligne === '' ? ' ' : null}
    </Text>
  );
}

function MessageDiscord({ texte: t, auteur, premier }: { texte: string; auteur: string; premier: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <View style={{ width: 40 }}>
        {premier ? (
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: DISCORD.avatar, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 18 }}>🚀</Text>
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {premier ? (
          <Text style={{ color: '#f2f3f5', fontWeight: '700', fontSize: 15, marginBottom: 2 }}>
            {auteur} <Text style={{ color: DISCORD.attenue, fontWeight: '400', fontSize: 12 }}>BOT</Text>
          </Text>
        ) : null}
        {t.split('\n').map((l, i) => (
          <LigneDiscord key={i} ligne={l} />
        ))}
      </View>
    </View>
  );
}

/** Aperçu « comme sur Discord » : messages anglais à la suite, puis le fil français. */
export function ApercuDiscord({ theme, en, fr, testID }: { theme: ThemeHub; en: string[]; fr: string[]; testID?: string }) {
  const longueur = (l: string[]) => l.reduce((n, x) => n + x.length, 0);
  return (
    <View style={{ gap: ESP.s }} testID={testID}>
      <View style={{ backgroundColor: DISCORD.fond, borderRadius: rayonCarte(theme), padding: ESP.m, gap: ESP.s }}>
        {en.map((m, i) => (
          <View key={i} style={{ gap: 4 }} testID={testID ? `${testID}-en-${i}` : undefined}>
            <MessageDiscord texte={m} auteur="Devblog" premier={i === 0} />
            {en.length > 1 ? <Text style={{ color: DISCORD.attenue, fontSize: 11, marginLeft: 52 }}>{`${i + 1}/${en.length} · ${m.length}/2000`}</Text> : null}
          </View>
        ))}
      </View>
      <Text style={attenue(theme, 12)}>{trDv('apercu_messages', { n: en.length, c: longueur(en) })}</Text>
      {fr.length ? (
        <View style={{ backgroundColor: DISCORD.fil, borderRadius: rayonCarte(theme), padding: ESP.m, gap: ESP.s, borderLeftWidth: 3, borderLeftColor: DISCORD.avatar }}>
          <Text style={{ color: '#f2f3f5', fontWeight: '700', fontSize: 13 }}>{`🧵 ${trDv('apercu_fil')}`}</Text>
          {fr.map((m, i) => (
            <View key={i} testID={testID ? `${testID}-fr-${i}` : undefined}>
              <MessageDiscord texte={m} auteur="Devblog" premier={i === 0} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
