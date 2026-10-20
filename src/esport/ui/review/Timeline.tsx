/**
 * Timeline sous le lecteur : une piste, les repères colorés par catégorie
 * (un clic saute au repère), les durées en barres, la tête de lecture. Un clic
 * sur la piste saute à l'instant correspondant.
 */

import React, { useState } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent, type GestureResponderEvent } from 'react-native';
import { police, type ThemeHub } from '../../../hub/themes';
import type { Repere } from '../../review/api';
import { categorie, formatTemps, positionPourcent } from '../../review/libelles';

export function Timeline({
  theme,
  reperes,
  total,
  temps,
  actifId,
  onAller,
  onChoisir,
}: {
  theme: ThemeHub;
  reperes: readonly Repere[];
  /** Durée de la vidéo, en secondes. */
  total: number;
  temps: number;
  actifId?: string;
  onAller(secondes: number): void;
  onChoisir(repere: Repere): void;
}) {
  const [largeur, setLargeur] = useState(0);
  const surPiste = (e: GestureResponderEvent) => {
    const ne = e.nativeEvent as { locationX?: number; clientX?: number };
    const cadre = (e.currentTarget as unknown as { getBoundingClientRect?: () => { left: number; width: number } }).getBoundingClientRect?.();
    let x = ne.locationX;
    let l = largeur;
    // Web : la position vient du navigateur (clientX) plus fiablement que de locationX.
    if (cadre && cadre.width > 0 && typeof ne.clientX === 'number') {
      x = ne.clientX - cadre.left;
      l = cadre.width;
    }
    if (l > 0 && typeof x === 'number' && !Number.isNaN(x)) onAller(Math.max(0, Math.min(1, x / l)) * total);
  };
  return (
    <View testID="esport-timeline" accessibilityLabel={`Timeline : ${reperes.length} repère(s) sur ${formatTemps(total)}`} style={{ gap: 4 }}>
      <View style={{ height: 40, justifyContent: 'center' }} onLayout={(e: LayoutChangeEvent) => setLargeur(e.nativeEvent.layout.width)}>
        <Pressable
          testID="esport-timeline-piste"
          accessibilityRole="adjustable"
          accessibilityLabel="Piste de la vidéo : appuyer pour sauter à cet instant"
          onPress={surPiste}
          style={{ position: 'absolute', left: 0, right: 0, top: 4, height: 32, justifyContent: 'center' }}>
          <View pointerEvents="none" style={{ height: 12, borderRadius: 6, backgroundColor: theme.ligne }} />
        </Pressable>
        {/* Durées */}
        {reperes
          .filter(r => r.fin !== null && total > 0)
          .map(r => (
            <View
              key={`d-${r.id}`}
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 17,
                height: 6,
                left: `${positionPourcent(r.debut, total)}%`,
                width: `${Math.max(0.5, positionPourcent((r.fin ?? r.debut) - r.debut, total))}%`,
                backgroundColor: categorie(r.categorie).couleur,
                opacity: 0.55,
                borderRadius: 3,
              }}
            />
          ))}
        {/* Tête de lecture */}
        <View pointerEvents="none" testID="esport-timeline-tete" style={{ position: 'absolute', top: 6, bottom: 6, width: 2, left: `${positionPourcent(temps, total)}%`, backgroundColor: theme.texte }} />
        {/* Repères */}
        {reperes.map(r => {
          const c = categorie(r.categorie);
          const actif = r.id === actifId;
          return (
            <Pressable
              key={r.id}
              testID={`esport-timeline-repere-${r.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${c.nom} à ${formatTemps(r.debut)} : ${r.titre}`}
              onPress={() => {
                onChoisir(r);
                onAller(r.debut);
              }}
              hitSlop={10}
              style={{
                position: 'absolute',
                top: actif ? 7 : 10,
                left: `${positionPourcent(r.debut, total)}%`,
                marginLeft: actif ? -13 : -10,
                width: actif ? 26 : 20,
                height: actif ? 26 : 20,
                borderRadius: 13,
                backgroundColor: c.couleur,
                borderWidth: actif ? 3 : 2,
                borderColor: actif ? theme.texte : theme.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Text style={{ color: '#fff', fontSize: actif ? 12 : 10, fontWeight: '800' }} accessibilityElementsHidden importantForAccessibility="no">
                {c.glyphe}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeChiffres) }}>{formatTemps(temps)}</Text>
        <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeChiffres) }}>{formatTemps(total)}</Text>
      </View>
    </View>
  );
}
