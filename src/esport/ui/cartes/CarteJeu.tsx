/**
 * Carte d'un jeu en plateau, version native (iOS) : l'image telle quelle sur le fond du thème, sans redessin (le
 * rendu composé est celui du web, CarteJeu.web.tsx) ; le contenu est posé par-dessus avec le même repère.
 */

import React, { useState } from 'react';
import { Image, Text, View, type LayoutChangeEvent } from 'react-native';
import { police } from '../../../hub/themes';
import { sourcesImage } from '../../strats/assets';
import { themeCarte } from '../../strats/plateau';
import { useSourceImage } from '../strats/imagesJeu';
import type { PropsCarteJeu } from './types';

export type { PropsCarteJeu, RepereCarteJeu } from './types';

export default function CarteJeu({ theme, carte, image, taille, themeCarte: idTheme, rotation = 0, rayon = 10, filigrane = true, children, testID = 'esport-carte-jeu', accessibilityLabel }: PropsCarteJeu) {
  const [mesure, setMesure] = useState(0);
  const cote = taille ?? mesure;
  const t = themeCarte(idTheme);
  const source = useSourceImage(image === undefined ? sourcesImage(carte?.minimap) : typeof image === 'string' ? sourcesImage(image) : sourcesImage(image ?? []));
  const px = (u: number) => (u * cote) / 1000;
  return (
    <View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? carte?.nom}
      onLayout={taille ? undefined : (e: LayoutChangeEvent) => setMesure(Math.round(e.nativeEvent.layout.width))}
      style={{ width: taille ?? '100%', height: cote || undefined, aspectRatio: taille ? undefined : 1, borderRadius: rayon, overflow: 'hidden', backgroundColor: t.fond, alignItems: 'center', justifyContent: 'center' }}>
      {source.url ? (
        <Image key={source.url} source={{ uri: source.url }} onError={source.suivante} resizeMode="contain" style={{ position: 'absolute', top: 0, left: 0, width: cote, height: cote, transform: [{ rotate: `${rotation}deg` }] }} testID={`${testID}-image`} />
      ) : filigrane && carte?.nom ? (
        <Text style={{ color: t.contour, opacity: 0.5, fontSize: Math.max(12, cote * 0.07), fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', ...police(theme.policeTitre) }} numberOfLines={1}>
          {carte.nom}
        </Text>
      ) : null}
      {cote > 0 && children ? <View style={{ position: 'absolute', top: 0, left: 0, width: cote, height: cote }}>{typeof children === 'function' ? children({ taille: cote, px }) : children}</View> : null}
    </View>
  );
}
