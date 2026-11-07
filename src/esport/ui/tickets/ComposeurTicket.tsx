/**
 * Zone de réponse d'un ticket (Tickets › un ticket › réponse ou note interne) : GRANDE et multiligne, sur toute la
 * largeur. Hauteur de départ : 6 lignes sur ordinateur, 5 sur téléphone ; elle grandit avec le texte jusqu'à la moitié
 * de la hauteur de l'écran, puis défile ; poignée de redimensionnement sur le web (une hauteur tirée à la main est
 * gardée). Entrée : nouvelle ligne ; Ctrl+Entrée (Cmd+Entrée sur Mac) : envoyer (rappel affiché sous le champ, web et
 * clavier physique). Compteur de caractères près de la limite.
 */

import React, { useLayoutEffect, useRef, useState } from 'react';
import { Platform, Text, TextInput, useWindowDimensions, View, type TextInputKeyPressEvent } from 'react-native';
import { police, type ThemeHub } from '../../../hub/themes';
import { useMobile } from '../../../ui/mobile/useMobile';
import { trTk } from '../../i18n/tickets';
import { ESP, attenue } from '../design';

export const HAUTEUR_LIGNE_COMPOSEUR = 22;
const MARGE = 20;
/** Lignes visibles au départ (ordinateur, téléphone). */
export const LIGNES_COMPOSEUR = { ordinateur: 6, telephone: 5 } as const;

type NoeudTexte = { style?: { height: string }; scrollHeight?: number; offsetHeight?: number };

/** Hauteurs mini et maxi de la zone (px) pour une hauteur d'écran. */
export function bornesComposeur(mobile: boolean, hauteurEcran: number): { min: number; max: number } {
  const min = (mobile ? LIGNES_COMPOSEUR.telephone : LIGNES_COMPOSEUR.ordinateur) * HAUTEUR_LIGNE_COMPOSEUR + MARGE;
  return { min, max: Math.max(min, Math.round(hauteurEcran * 0.5)) };
}

/** La touche est-elle « envoyer » (Ctrl+Entrée ou Cmd+Entrée) ? */
export function estRaccourciEnvoi(e: { key?: string; ctrlKey?: boolean; metaKey?: boolean }): boolean {
  return e.key === 'Enter' && Boolean(e.ctrlKey || e.metaKey);
}

export function ComposeurTicket({
  theme,
  libelle,
  valeur,
  onChanger,
  onEnvoyer,
  maxLength,
  placeholder,
  testID,
}: {
  theme: ThemeHub;
  libelle: string;
  valeur: string;
  onChanger(v: string): void;
  /** Ctrl/Cmd+Entrée (ignoré si le message est vide). */
  onEnvoyer(): void;
  maxLength: number;
  placeholder?: string;
  testID: string;
}) {
  const mobile = useMobile();
  const { height: hauteurEcran } = useWindowDimensions();
  const web = Platform.OS === 'web';
  const champ = useRef<React.ComponentRef<typeof TextInput>>(null);
  const minManuel = useRef(0);
  const derniere = useRef(0);
  const { min, max } = bornesComposeur(mobile, hauteurEcran);
  const [hauteur, setHauteur] = useState(min);
  const hauteurChamp = Math.max(min, Math.min(max, hauteur));

  // Web : la hauteur suit le contenu (mesure du textarea) ; une poignée tirée plus haut par l'utilisateur est gardée.
  useLayoutEffect(() => {
    if (!web) return;
    const n = champ.current as unknown as NoeudTexte | null;
    if (!n?.style || typeof n.scrollHeight !== 'number') return;
    const actuelle = n.offsetHeight ?? 0;
    if (derniere.current && actuelle > derniere.current + 4) minManuel.current = actuelle;
    n.style.height = '0px';
    const contenu = (n.scrollHeight ?? 0) + 2;
    n.style.height = `${actuelle}px`;
    const cible = Math.max(Math.max(min, Math.min(max, contenu)), Math.min(max, minManuel.current));
    derniere.current = cible;
    setHauteur(cible);
  }, [valeur, web, min, max]);

  const touche = (e: TextInputKeyPressEvent) => {
    const ne = e.nativeEvent as unknown as { key?: string; ctrlKey?: boolean; metaKey?: boolean };
    if (!estRaccourciEnvoi(ne)) return;
    e.preventDefault?.();
    if (valeur.trim()) onEnvoyer();
  };

  const proche = valeur.length >= maxLength * 0.8;
  return (
    <View style={{ gap: 4, width: '100%' }}>
      <Text style={{ color: theme.texte, fontWeight: '600', fontSize: 13, ...police(theme.policeTexte) }}>{libelle}</Text>
      <TextInput
        ref={champ}
        testID={testID}
        accessibilityLabel={libelle}
        accessibilityHint={trTk('vue.message_aide_clavier')}
        value={valeur}
        onChangeText={onChanger}
        onKeyPress={touche}
        onContentSizeChange={
          web
            ? undefined
            : e => {
                const h = e.nativeEvent.contentSize.height + MARGE;
                setHauteur(prev => (Math.abs(prev - h) > 1 ? h : prev));
              }
        }
        placeholder={placeholder}
        placeholderTextColor={theme.attenue}
        autoCapitalize="sentences"
        multiline
        blurOnSubmit={false}
        scrollEnabled={hauteurChamp >= max}
        maxLength={maxLength}
        style={[
          {
            width: '100%',
            color: theme.texte,
            backgroundColor: theme.fond,
            borderColor: theme.ligne,
            borderWidth: 1,
            borderRadius: Math.min(theme.rayonMoyen, 10),
            fontSize: 15,
            lineHeight: HAUTEUR_LIGNE_COMPOSEUR,
            paddingVertical: 10,
            paddingHorizontal: 12,
            textAlignVertical: 'top',
            height: hauteurChamp,
            minHeight: min,
            maxHeight: max,
            ...police(theme.policeTexte),
          },
          // Poignée de redimensionnement (navigateur).
          web ? ({ resize: 'vertical' } as object) : null,
        ]}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: ESP.xs, flexWrap: 'wrap' }}>
        {web || !mobile ? (
          <Text style={attenue(theme, 12)} testID={`${testID}-raccourci`}>
            {trTk('vue.message_aide_clavier')}
          </Text>
        ) : (
          <View />
        )}
        {proche ? (
          <Text testID={`${testID}-compteur`} accessibilityLiveRegion="polite" style={{ fontSize: 12, color: valeur.length >= maxLength * 0.95 ? theme.critique : theme.attenue, ...police(theme.policeTexte) }}>
            {`${valeur.length} / ${maxLength}`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
