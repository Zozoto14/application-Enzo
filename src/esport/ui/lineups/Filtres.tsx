/**
 * Filtres rapides et grille des lineups.
 *
 *  - PastillesFiltre : un groupe de pastilles (« Agent : Tous, Omen, Sova… ») avec, au besoin, un visuel (portrait,
 *    icône de capacité) et le nombre de lineups ; serrées à la souris (`dense`), 44 px au doigt.
 *  - GrilleEgale : colonnes de même largeur, dernière ligne comprise (les cartes ne s'étirent pas quand elles sont
 *    moins nombreuses).
 */

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { ESP, attenue, texte } from '../design';

export interface OptionPastille {
  id: string;
  nom: string;
  /** Nombre de lineups (affiché en petit). */
  n?: number;
  visuel?: React.ReactNode;
}

export function PastillesFiltre({
  theme,
  libelle,
  valeur,
  options,
  tout,
  dense = false,
  onChoisir,
  testID,
}: {
  theme: ThemeHub;
  libelle: string;
  valeur: string;
  options: readonly OptionPastille[];
  /** Nom du choix « tout » (« Tous », « Toutes »). */
  tout: string;
  dense?: boolean;
  onChoisir(id: string): void;
  testID: string;
}) {
  const hauteur = dense ? 32 : 44;
  const taille = dense ? 13 : 14;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={libelle} style={{ flexDirection: 'row', alignItems: 'center', gap: dense ? 4 : 6, flexWrap: 'wrap', maxWidth: '100%' }}>
      <Text style={{ ...attenue(theme, 11), fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginRight: 4 }}>{libelle}</Text>
      {[{ id: '', nom: tout } as OptionPastille, ...options].map(o => {
        const actif = o.id === valeur;
        return (
          <Pressable
            key={o.id || '*'}
            testID={`${testID}-${o.id || 'defaut'}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: actif }}
            accessibilityLabel={`${libelle} : ${o.nom}`}
            onPress={() => onChoisir(o.id)}
            style={(e: { pressed: boolean; hovered?: boolean }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              minHeight: hauteur,
              paddingLeft: o.visuel ? (dense ? 5 : 8) : dense ? 10 : 12,
              paddingRight: dense ? 10 : 12,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: actif ? theme.accent : e.hovered ? theme.attenue : theme.ligne,
              backgroundColor: actif ? teinteTransparente(theme.accent, 0.2) : 'transparent',
              opacity: e.pressed ? 0.8 : 1,
            })}>
            {o.visuel}
            <Text style={{ ...texte(theme, taille), fontWeight: actif ? '700' : '500' }}>{o.nom}</Text>
            {o.n !== undefined ? <Text style={attenue(theme, 11)}>{o.n}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Nombre de colonnes d'une grille de `largeur` pixels dont les cartes font au moins `min` pixels. */
export function colonnesGrille(largeur: number, min: number, gap: number): number {
  if (!(largeur > 0)) return 1;
  return Math.max(1, Math.floor((largeur + gap) / (min + gap)));
}

export function GrilleEgale({ children, min, gap = ESP.m, testID }: { children: React.ReactNode; min: number; gap?: number; testID?: string }) {
  const [largeur, setLargeur] = useState(0);
  const colonnes = colonnesGrille(largeur, min, gap);
  // Avant la première mesure : cartes fluides (une image plus tard, elles prennent leur largeur exacte).
  const cote = largeur > 0 ? Math.floor((largeur - gap * (colonnes - 1)) / colonnes) : undefined;
  return (
    <View testID={testID} onLayout={e => setLargeur(Math.floor(e.nativeEvent.layout.width))} style={{ flexDirection: 'row', flexWrap: 'wrap', gap, alignItems: 'stretch' }}>
      {React.Children.map(children, c => (c ? <View style={cote ? { width: cote } : { flexGrow: 1, flexBasis: min, minWidth: 0 }}>{c}</View> : null))}
    </View>
  );
}
