/**
 * « Mention sponsor » d'une carte post CM : les partenaires actifs mis en avant par le post (nom seulement,
 * `GET /sponsors/mentionnables`, ouvert à qui prépare des contenus). Une fois publié, le post compte pour leurs
 * contreparties « Posts CM publiés ». Rien ne s'affiche s'il n'y a aucun partenaire (ou un serveur ancien).
 */

import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import type { LiensCarte } from '../../cm/api';
import { apiSponsors } from '../../sponsors/api';
import { trCm } from '../../i18n/cm';
import { styles } from '../commun';
import { ESP, attenue, texte } from '../design';

export function MentionsSponsors({ theme, client, liens, noms, editer, onChanger }: { theme: ThemeHub; client: ClientEsport; liens: LiensCarte; noms: Array<{ id: string; nom: string }>; editer: boolean; onChanger(l: LiensCarte): void }) {
  const [partenaires, setPartenaires] = useState<Array<{ id: string; nom: string }> | undefined>();
  useEffect(() => {
    if (!editer) return;
    let vivant = true;
    apiSponsors(client)
      .mentionnables()
      .then(r => vivant && setPartenaires(r.partenaires))
      .catch(() => vivant && setPartenaires([]));
    return () => {
      vivant = false;
    };
  }, [client, editer]);
  const choisis = liens.sponsors ?? [];
  if (!editer) {
    if (!noms.length) return null;
    return <Text style={texte(theme, 13)} testID="esport-cm-lien-sponsors">{`${trCm('lien.sponsors')} : ${noms.map(n => n.nom).join(', ')}`}</Text>;
  }
  const liste = [...(partenaires ?? []), ...noms.filter(n => !(partenaires ?? []).some(p => p.id === n.id))];
  if (!liste.length) return null;
  return (
    <View style={{ gap: ESP.xxs }} testID="esport-cm-lien-sponsors">
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trCm('lien.sponsors')}</Text>
      <Text style={attenue(theme)}>{trCm('lien.sponsors_aide')}</Text>
      <View style={[styles.ligne, { gap: ESP.xs }]} accessibilityLabel={trCm('lien.sponsors')}>
        {liste.map(p => {
          const actif = choisis.includes(p.id);
          return (
            <Pressable
              key={p.id}
              testID={`esport-cm-lien-sponsor-${p.id}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: actif }}
              accessibilityLabel={p.nom}
              onPress={() => {
                const suite = actif ? choisis.filter(x => x !== p.id) : [...choisis, p.id];
                const reste: LiensCarte = { ...liens };
                delete reste.sponsors;
                onChanger(suite.length ? { ...reste, sponsors: suite } : reste);
              }}
              style={[styles.choix, { borderColor: actif ? theme.accent : theme.ligne, borderRadius: 10, backgroundColor: actif ? teinteTransparente(theme.accent, 0.15) : theme.surface }]}>
              <Text style={texte(theme, 13)}>{`${actif ? '✓ ' : ''}${p.nom}`}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
