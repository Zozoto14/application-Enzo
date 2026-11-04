/**
 * Aperçu « comme sur Discord » d'un message du bot (panneau des tickets, message d'accueil) : la charge RÉELLE rendue
 * par le serveur (même code que la publication), dessinée avec les couleurs de Discord (sombre). Rien n'est envoyé.
 */

import React from 'react';
import { Text, View } from 'react-native';
import type { ThemeHub } from '../../../hub/themes';
import type { ChargeDiscord } from '../../tickets/api';
import { ESP } from '../design';
import { trTk } from '../../i18n/tickets';

const D = { fond: '#313338', embed: '#2b2d31', texte: '#dbdee1', attenue: '#b5bac1', titre: '#f2f3f5', primaire: '#5865f2', secondaire: '#4e5058', danger: '#da373c', succes: '#248046', citation: '#4e5058' };
const COULEURS_BOUTON: Record<number, string> = { 1: D.primaire, 2: D.secondaire, 3: D.succes, 4: D.danger };

/** Texte Discord simplifié : lignes de citation (« > ») avec leur barre, le reste tel quel. */
function TexteDiscord({ texte, taille = 14 }: { texte: string; taille?: number }) {
  const lignes = texte.split('\n');
  const blocs: Array<{ cite: boolean; lignes: string[] }> = [];
  for (const l of lignes) {
    const cite = l.startsWith('> ');
    const dernier = blocs[blocs.length - 1];
    if (dernier && dernier.cite === cite) dernier.lignes.push(cite ? l.slice(2) : l);
    else blocs.push({ cite, lignes: [cite ? l.slice(2) : l] });
  }
  return (
    <View style={{ gap: 4 }}>
      {blocs.map((b, i) =>
        b.cite ? (
          <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ width: 4, borderRadius: 2, backgroundColor: D.citation }} />
            <Text style={{ color: D.texte, fontSize: taille, flex: 1, minWidth: 0 }}>{b.lignes.join('\n')}</Text>
          </View>
        ) : (
          <Text key={i} style={{ color: D.texte, fontSize: taille }}>
            {b.lignes.join('\n')}
          </Text>
        ),
      )}
    </View>
  );
}

export function ApercuDiscord({ charge, imageUrl, testID = 'esport-tk-apercu' }: { theme?: ThemeHub; charge: ChargeDiscord; imageUrl?: string | null; testID?: string }) {
  return (
    <View testID={testID} accessibilityLabel={trTk('pan.apercu')} style={{ backgroundColor: D.fond, borderRadius: 8, padding: ESP.s, gap: ESP.xs, maxWidth: 560, width: '100%' }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: D.primaire }} />
        <Text style={{ color: D.titre, fontWeight: '700' }}>Esport HQ</Text>
        <Text style={{ color: '#fff', backgroundColor: D.primaire, fontSize: 10, fontWeight: '700', paddingHorizontal: 4, borderRadius: 3 }}>BOT</Text>
      </View>
      {charge.content ? <TexteDiscord texte={charge.content} /> : null}
      {charge.embeds.map((e, i) => (
        <View key={i} style={{ flexDirection: 'row', backgroundColor: D.embed, borderRadius: 4, overflow: 'hidden' }}>
          <View style={{ width: 4, backgroundColor: `#${(e.color ?? 0x5865f2).toString(16).padStart(6, '0')}` }} />
          <View style={{ flex: 1, minWidth: 0, padding: ESP.s, gap: ESP.xs }}>
            {e.title ? <Text style={{ color: D.titre, fontWeight: '700', fontSize: 15 }}>{e.title}</Text> : null}
            {e.description ? <TexteDiscord texte={e.description} /> : null}
            {e.fields?.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.s }}>
                {e.fields.map((f, j) => (
                  <View key={j} style={{ minWidth: f.inline ? 120 : '100%', flexShrink: 1, gap: 2 }}>
                    <Text style={{ color: D.titre, fontWeight: '700', fontSize: 13 }}>{f.name}</Text>
                    <TexteDiscord texte={f.value} taille={13} />
                  </View>
                ))}
              </View>
            ) : null}
            {e.image ? (
              <View style={{ height: 120, borderRadius: 4, backgroundColor: D.fond, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: D.attenue, fontSize: 12 }}>{imageUrl ? trTk('pan.image_choisie') : trTk('pan.image')}</Text>
              </View>
            ) : null}
          </View>
        </View>
      ))}
      {charge.components.map((rangee, i) => (
        <View key={i} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {rangee.components.map((c, j) =>
            c.type === 3 ? (
              <View key={j} style={{ width: '100%', gap: 4 }}>
                <View style={{ borderRadius: 4, backgroundColor: '#1e1f22', padding: ESP.xs, flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: D.attenue, flexShrink: 1 }} numberOfLines={1}>
                    {c.placeholder}
                  </Text>
                  <Text style={{ color: D.attenue }}>▾</Text>
                </View>
                {(c.options ?? []).map(o => (
                  <View key={o.value} style={{ paddingHorizontal: ESP.xs }}>
                    <Text style={{ color: D.texte, fontSize: 13 }}>{o.label}</Text>
                    {o.description ? <Text style={{ color: D.attenue, fontSize: 12 }}>{o.description}</Text> : null}
                  </View>
                ))}
              </View>
            ) : (
              <View key={j} style={{ backgroundColor: COULEURS_BOUTON[c.style ?? 2] ?? D.secondaire, borderRadius: 3, paddingHorizontal: 12, paddingVertical: 6, maxWidth: '100%' }}>
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }} numberOfLines={1}>
                  {c.label}
                </Text>
              </View>
            ),
          )}
        </View>
      ))}
    </View>
  );
}
