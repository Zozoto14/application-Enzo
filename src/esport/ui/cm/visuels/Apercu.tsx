/**
 * Miniature d'un visuel : le rendu enregistré (lien signé) s'il existe, sinon (site et PC) un aperçu dessiné
 * à la volée depuis le document, la charte et les données ; sur l'app mobile, un cadre au bon format.
 */

import React, { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import type { ThemeHub } from '../../../../hub/themes';
import type { ApiVisuels } from '../../../cm/visuels/api';
import { rendreMiniature } from '../../../cm/visuels/generateur';
import { FORMATS, type Charte, type DocumentVisuel, type DonneesVisuel, type Langue } from '../../../cm/visuels/types';
import { attenue } from '../../design';

export function Apercu({
  theme,
  api,
  charte,
  document,
  donnees,
  langue,
  uri,
  largeur = 220,
  libelle,
  testID,
}: {
  theme: ThemeHub;
  api: ApiVisuels;
  charte: Charte;
  document: DocumentVisuel;
  donnees: DonneesVisuel;
  langue: Langue;
  uri?: string | null;
  largeur?: number;
  libelle: string;
  testID?: string;
}) {
  const [source, setSource] = useState<string | null | undefined>(uri);
  useEffect(() => {
    if (uri) {
      setSource(uri);
      return undefined;
    }
    let vivant = true;
    setSource(undefined);
    void rendreMiniature({ api, document, charte, donnees, langue }, largeur * 2).then(s => vivant && setSource(s));
    return () => {
      vivant = false;
    };
  }, [api, document, charte, donnees, langue, uri, largeur]);
  const { largeur: W, hauteur: H } = FORMATS[document.format];
  return (
    <View testID={testID} accessibilityLabel={libelle} style={{ width: largeur, aspectRatio: W / H, borderRadius: 8, overflow: 'hidden', backgroundColor: charte.couleurs.fond, borderWidth: 1, borderColor: theme.ligne, alignItems: 'center', justifyContent: 'center' }}>
      {source ? <Image source={{ uri: source }} accessibilityIgnoresInvertColors style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <Text style={{ ...attenue(theme, 12), color: charte.couleurs.primaire, textAlign: 'center', padding: 6 }}>{libelle}</Text>}
    </View>
  );
}
