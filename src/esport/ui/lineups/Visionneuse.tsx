/**
 * Visionneuse des images d'un lineup : plein écran sur fond noir, image entière, précédente / suivante par les
 * flèches, le clavier (← → Échap, sur le site et le PC) ou un balayage du doigt (iPhone, iPad).
 */

import React, { useEffect, useRef } from 'react';
import { Image, Modal, Platform, Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import { Icone } from '../../../ui/icones';
import { trLu } from '../../i18n/lineups';

export interface ImageVisionneuse {
  id: string;
  url: string;
  /** Rôle affiché (« Position », « Visée »…). */
  titre: string;
}

/** Distance (pixels) au-delà de laquelle un glissement horizontal change d'image. */
export const SEUIL_BALAYAGE = 48;

/** Index après un balayage de `dx` pixels (vers la gauche : image suivante), borné à la liste. */
export function indexApresBalayage(index: number, dx: number, n: number): number {
  if (n <= 0) return 0;
  if (dx <= -SEUIL_BALAYAGE) return Math.min(n - 1, index + 1);
  if (dx >= SEUIL_BALAYAGE) return Math.max(0, index - 1);
  return index;
}

type Touche = { key?: string; preventDefault?(): void; stopPropagation?(): void };
type DocumentMinimal = { addEventListener(t: 'keydown', f: (e: Touche) => void, capture?: boolean): void; removeEventListener(t: 'keydown', f: (e: Touche) => void, capture?: boolean): void };

export function Visionneuse({ images, index, onIndex, onFermer, testID = 'esport-lineup-visionneuse' }: { images: readonly ImageVisionneuse[]; index: number; onIndex(i: number): void; onFermer(): void; testID?: string }) {
  const n = images.length;
  const i = Math.max(0, Math.min(n - 1, index));
  const depart = useRef<number | undefined>(undefined);
  const etat = useRef({ i, n, onIndex, onFermer });
  etat.current = { i, n, onIndex, onFermer };

  // Clavier (site, app PC) : flèches et Échap. Écoute en phase de capture, et la touche est consommée : sans cela,
  // l'Échap de l'application (« retour au Hub ») passerait avant et quitterait l'Esport au lieu de fermer l'image.
  useEffect(() => {
    const doc = (globalThis as { document?: DocumentMinimal }).document;
    if (Platform.OS !== 'web' || !doc) return undefined;
    const surTouche = (e: Touche) => {
      const c = etat.current;
      if (e.key === 'Escape') c.onFermer();
      else if (e.key === 'ArrowRight' && c.i < c.n - 1) c.onIndex(c.i + 1);
      else if (e.key === 'ArrowLeft' && c.i > 0) c.onIndex(c.i - 1);
      else return;
      e.preventDefault?.();
      e.stopPropagation?.();
    };
    doc.addEventListener('keydown', surTouche, true);
    return () => doc.removeEventListener('keydown', surTouche, true);
  }, []);

  if (n === 0) return null;
  const image = images[i];
  const x = (e: GestureResponderEvent) => {
    const ne = e.nativeEvent as unknown as { pageX?: number; changedTouches?: Array<{ pageX: number }> };
    return ne.changedTouches?.[0]?.pageX ?? ne.pageX;
  };
  const fleche = (sens: -1 | 1) => {
    const actif = sens === -1 ? i > 0 : i < n - 1;
    return (
      <Pressable
        testID={`${testID}-${sens === -1 ? 'precedente' : 'suivante'}`}
        accessibilityRole="button"
        accessibilityLabel={trLu(sens === -1 ? 'visionneuse.precedente' : 'visionneuse.suivante')}
        accessibilityState={{ disabled: !actif }}
        disabled={!actif}
        onPress={() => onIndex(i + sens)}
        style={{ position: 'absolute', top: '50%', marginTop: -28, [sens === -1 ? 'left' : 'right']: 8, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(8, 12, 17, 0.7)', opacity: actif ? 1 : 0.25 }}>
        <Icone nom={sens === -1 ? 'chevron-gauche' : 'chevron-droite'} taille={28} couleur="#FFFFFF" />
      </Pressable>
    );
  };
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onFermer}>
      <View testID={testID} accessibilityViewIsModal style={{ flex: 1, backgroundColor: 'rgba(3, 5, 8, 0.96)' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingVertical: 8, minHeight: 56 }}>
          <Text testID={`${testID}-titre`} accessibilityRole="header" style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
            {image.titre}
            <Text style={{ color: 'rgba(255, 255, 255, 0.6)', fontWeight: '500' }}>{`  ·  ${trLu('image.n', { n: i + 1, total: n })}`}</Text>
          </Text>
          <Pressable testID={`${testID}-fermer`} accessibilityRole="button" accessibilityLabel={trLu('visionneuse.fermer')} onPress={onFermer} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Icone nom="croix" taille={24} couleur="#FFFFFF" />
          </Pressable>
        </View>
        <View
          testID={`${testID}-zone`}
          style={{ flex: 1, minHeight: 0 }}
          onTouchStart={e => {
            depart.current = x(e);
          }}
          onTouchEnd={e => {
            const fin = x(e);
            if (depart.current !== undefined && fin !== undefined) {
              const suivant = indexApresBalayage(i, fin - depart.current, n);
              if (suivant !== i) onIndex(suivant);
            }
            depart.current = undefined;
          }}>
          <Image testID={`${testID}-image`} source={{ uri: image.url }} accessibilityLabel={image.titre} accessibilityIgnoresInvertColors resizeMode="contain" style={{ flex: 1, width: '100%', height: '100%' }} />
          {n > 1 ? fleche(-1) : null}
          {n > 1 ? fleche(1) : null}
        </View>
        {n > 1 ? (
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 12 }}>
            {images.map((im, k) => (
              <Pressable key={im.id} testID={`${testID}-point-${k}`} accessibilityRole="button" accessibilityLabel={`${im.titre} (${trLu('image.n', { n: k + 1, total: n })})`} accessibilityState={{ selected: k === i }} onPress={() => onIndex(k)} hitSlop={10} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: k === i ? '#FFFFFF' : 'rgba(255, 255, 255, 0.35)' }} />
            ))}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
