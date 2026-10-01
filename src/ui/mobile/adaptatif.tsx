/**
 * `Text`, `Pressable` et `TextInput` « adaptatifs » : mêmes composants que ceux de React Native, mais
 * en mode téléphone ils respectent les règles de lisibilité et de toucher du système de design, sans
 * avoir à retoucher chaque style d'écran :
 *
 *  - `Text` : jamais moins de 15 px (la hauteur de ligne suit) ;
 *  - `Pressable` : zone tactile d'au moins 44 × 44 px ;
 *  - `TextInput` : au moins 16 px (Safari ne zoome plus au focus) et 44 px de haut.
 *
 * En mode large (PC, tablette en paysage), ils rendent EXACTEMENT les composants de React Native :
 * rien ne change sur le bureau.
 */

import React, { createContext, useContext } from 'react';
import {
  Pressable as PressableRN,
  StyleSheet,
  Text as TexteRN,
  TextInput as SaisieRN,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { CONTROLE, TEXTE_MIN } from './jetons';
import { useMobile } from './useMobile';

/** Vrai pour un texte posé dans un autre texte : il hérite de la taille de son parent. */
const DansTexte = createContext(false);

type Modifiable<T> = { -readonly [K in keyof T]: T[K] };

/** Style d'un texte relevé à 15 px au minimum (fonction pure, testée). */
export function styleTexteMobile(style: StyleProp<TextStyle>, imbrique: boolean, minimum: number = TEXTE_MIN): TextStyle {
  const plat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const taille = plat.fontSize;
  if (taille === undefined) {
    // Sans taille, le texte hérite (texte imbriqué) ou prend la taille par défaut de React Native (14).
    return imbrique ? plat : { ...plat, fontSize: minimum };
  }
  if (taille >= minimum) {
    return plat;
  }
  const suivant: Modifiable<TextStyle> = { ...plat, fontSize: minimum };
  if (typeof plat.lineHeight === 'number') {
    suivant.lineHeight = Math.round((plat.lineHeight * minimum) / taille);
  }
  return suivant;
}

export function Text({ style, children, ...reste }: TextProps) {
  const mobile = useMobile();
  const imbrique = useContext(DansTexte);
  if (!mobile) {
    return (
      <TexteRN style={style} {...reste}>
        {children}
      </TexteRN>
    );
  }
  return (
    <TexteRN style={styleTexteMobile(style, imbrique)} {...reste}>
      <DansTexte.Provider value>{children}</DansTexte.Provider>
    </TexteRN>
  );
}

/** Style d'un élément tactile élargi à 44 px au minimum. */
export function styleCibleMobile(style: StyleProp<ViewStyle>): ViewStyle {
  const plat = (StyleSheet.flatten(style) ?? {}) as ViewStyle;
  const suivant: Modifiable<ViewStyle> = { ...plat };
  if (typeof plat.height === 'number' && plat.height < CONTROLE.cible) {
    suivant.height = CONTROLE.cible;
  }
  if (typeof plat.width === 'number' && plat.width < CONTROLE.cible) {
    suivant.width = CONTROLE.cible;
  }
  if (typeof plat.minHeight !== 'number' || plat.minHeight < CONTROLE.cible) {
    suivant.minHeight = CONTROLE.cible;
  }
  if (plat.flexGrow === undefined && plat.flex === undefined && plat.width === undefined && (typeof plat.minWidth !== 'number' || plat.minWidth < CONTROLE.cible)) {
    suivant.minWidth = CONTROLE.cible;
  }
  return suivant;
}

export function Pressable({ style, ...reste }: PressableProps) {
  const mobile = useMobile();
  if (!mobile) {
    return <PressableRN style={style} {...reste} />;
  }
  const adapte =
    typeof style === 'function'
      ? (etat: Parameters<Extract<PressableProps['style'], Function>>[0]) => styleCibleMobile(style(etat) as StyleProp<ViewStyle>)
      : styleCibleMobile(style as StyleProp<ViewStyle>);
  return <PressableRN style={adapte} {...reste} />;
}

export function TextInput({ style, ...reste }: TextInputProps) {
  const mobile = useMobile();
  if (!mobile) {
    return <SaisieRN style={style} {...reste} />;
  }
  const plat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const adapte: Modifiable<TextStyle> = { ...plat, fontSize: Math.max(plat.fontSize ?? 16, 16) };
  if (!reste.multiline && (typeof plat.minHeight !== 'number' || plat.minHeight < CONTROLE.cible)) {
    adapte.minHeight = CONTROLE.cible;
  }
  return <SaisieRN style={adapte} {...reste} />;
}
