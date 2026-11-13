/**
 * Briques de l'atelier de strats (React Native : site, app PC, testables sans canevas) : panneaux flottants
 * (« verre »), boutons à icône avec info-bulle (nom et raccourci), puces, bulles ancrées à leur bouton
 * (feuille en bas sur téléphone), lignes de menu. Icônes MONOCHROMES de l'interface (src/ui/icones) ; les
 * images du jeu (portraits, capacités) passent par `IconeAsset` (Barres.tsx).
 */

import React, { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import { Glyphe } from '../../../../ui/icones';
import { trAt } from '../../../i18n/atelier';
import type { Ancre } from './useAtelier';

/** Dimensions de l'atelier (px). */
export const DIM = { barre: 48, rail: 52, bouton: 38, dock: 70, frise: 46, etat: 28, tiroir: 348, marge: 8 } as const;

export type Format = 'telephone' | 'tablette' | 'bureau';
/** Format d'après la largeur de la fenêtre : téléphone (feuilles en bas), tablette (tiroir en feuille), bureau. */
export const formatPour = (largeur: number): Format => (largeur < 640 ? 'telephone' : largeur < 1100 ? 'tablette' : 'bureau');

/** Panneau flottant posé sur le canevas : surface presque opaque, liseré, ombre. */
export function verre(theme: ThemeHub, rayon = 12): ViewStyle {
  return {
    backgroundColor: teinteTransparente(theme.surface, 0.96),
    borderWidth: 1,
    borderColor: theme.ligne,
    borderRadius: rayon,
    ...(Platform.OS === 'web' ? ({ boxShadow: theme.sombre ? '0 8px 28px rgba(0,0,0,0.45)' : '0 8px 24px rgba(15,23,42,0.16)' } as object) : { elevation: 6 }),
  };
}

export const texteAtelier = (theme: ThemeHub, taille = 13, gras = false) => ({ color: theme.texte, fontSize: taille, fontWeight: gras ? ('700' as const) : ('500' as const), ...police(theme.policeTexte) });
export const attenueAtelier = (theme: ThemeHub, taille = 12) => ({ color: theme.attenue, fontSize: taille, ...police(theme.policeTexte) });

type EtatPresse = { pressed: boolean; hovered?: boolean; focused?: boolean };

/** Mesure d'un nœud à l'écran (ancre d'une bulle) ; repli : rien (la bulle se place au centre). */
export function mesurer(noeud: unknown, suite: (a: Ancre | undefined) => void): void {
  const n = noeud as { measureInWindow?(cb: (x: number, y: number, l: number, h: number) => void): void } | null;
  if (!n?.measureInWindow) {
    suite(undefined);
    return;
  }
  let fait = false;
  // Ouvert tout de suite, puis placé dès que le bouton est mesuré.
  suite(undefined);
  n.measureInWindow((x, y, l, h) => {
    if (fait) return;
    fait = true;
    if (Number.isFinite(x) && Number.isFinite(y) && (l > 0 || h > 0)) suite({ x, y, l, h });
  });
}

/**
 * Bouton carré à icône (ou icône et texte). Info-bulle au survol : nom et raccourci. `onAncre` : le bouton
 * ouvre une bulle et donne sa position.
 */
export function BoutonIcone({
  theme,
  icone,
  libelle,
  raccourci,
  onPress,
  onAncre,
  actif,
  desactive,
  testID,
  taille = DIM.bouton,
  bulle = 'bas',
  texte,
  danger,
  couleur,
  plein,
  enfants,
}: {
  theme: ThemeHub;
  icone?: string;
  libelle: string;
  raccourci?: string;
  onPress?(): void;
  onAncre?(a: Ancre | undefined): void;
  actif?: boolean;
  desactive?: boolean;
  testID: string;
  taille?: number;
  /** Côté de l'info-bulle ; « aucune » : pas d'info-bulle (le texte est déjà là). */
  bulle?: 'bas' | 'droite' | 'haut' | 'gauche' | 'aucune';
  texte?: string;
  danger?: boolean;
  couleur?: string;
  /** Bouton plein (action principale). */
  plein?: boolean;
  enfants?: React.ReactNode;
}) {
  const ref = useRef<React.ComponentRef<typeof Pressable>>(null);
  const [survol, setSurvol] = useState(false);
  const teinte = danger ? theme.critique : (couleur ?? theme.accent);
  const encre = plein ? theme.surAccent : danger ? theme.critique : theme.texte;
  return (
    <View style={{ position: 'relative' }}>
      <Pressable
        ref={ref}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={raccourci ? `${libelle} (${raccourci})` : libelle}
        accessibilityState={{ selected: actif, disabled: desactive }}
        disabled={desactive}
        onPress={() => {
          setSurvol(false);
          if (onAncre) mesurer(ref.current, onAncre);
          onPress?.();
        }}
        onHoverIn={() => setSurvol(true)}
        onHoverOut={() => setSurvol(false)}
        style={(etat: EtatPresse) => ({
          minWidth: taille,
          height: taille,
          paddingHorizontal: texte ? 10 : 0,
          flexDirection: 'row',
          gap: 6,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 9,
          borderWidth: 1,
          borderColor: actif ? teinte : etat.hovered || etat.focused ? theme.ligne : 'transparent',
          backgroundColor: plein ? theme.accent : actif ? teinteTransparente(teinte, 0.22) : etat.pressed ? teinteTransparente(theme.attenue, 0.22) : etat.hovered ? teinteTransparente(theme.attenue, 0.12) : 'transparent',
          opacity: desactive ? 0.38 : 1,
        })}>
        {icone ? <Glyphe valeur={icone} style={{ color: actif && !plein ? teinte : encre, fontSize: Math.round(taille * 0.44) }} /> : null}
        {enfants}
        {texte ? (
          <Text style={{ ...texteAtelier(theme, 13, true), color: encre }} numberOfLines={1}>
            {texte}
          </Text>
        ) : null}
      </Pressable>
      {survol && bulle !== 'aucune' && !desactive ? <InfoBulle theme={theme} texte={libelle} raccourci={raccourci} cote={bulle} taille={taille} /> : null}
    </View>
  );
}

function InfoBulle({ theme, texte, raccourci, cote, taille }: { theme: ThemeHub; texte: string; raccourci?: string; cote: 'bas' | 'droite' | 'haut' | 'gauche'; taille: number }) {
  const place: ViewStyle =
    cote === 'droite' ? { left: taille + 8, top: (taille - 28) / 2 } : cote === 'gauche' ? { right: taille + 8, top: (taille - 28) / 2 } : cote === 'haut' ? { bottom: taille + 6, left: 0 } : { top: taille + 6, left: 0 };
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', zIndex: 50, ...place, flexDirection: 'row', alignItems: 'center', gap: 8, height: 28, paddingHorizontal: 9, borderRadius: 7, backgroundColor: theme.sombre ? '#000000' : '#0f172a', ...(Platform.OS === 'web' ? ({ whiteSpace: 'nowrap', width: 'max-content' } as object) : { minWidth: 120 }) }}>
      <Text style={{ color: '#f8fafc', fontSize: 12, fontWeight: '600', ...police(theme.policeTexte) }} numberOfLines={1}>
        {texte}
      </Text>
      {raccourci ? (
        <View style={{ paddingHorizontal: 5, height: 18, borderRadius: 4, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' }}>
          <Text style={{ color: '#f8fafc', fontSize: 11, fontWeight: '700', ...police(theme.policeChiffres) }}>{raccourci}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function Separateur({ theme, vertical = true }: { theme: ThemeHub; vertical?: boolean }) {
  return <View style={vertical ? { width: 1, alignSelf: 'stretch', marginVertical: 8, backgroundColor: theme.ligne } : { height: 1, alignSelf: 'stretch', marginHorizontal: 6, backgroundColor: theme.ligne }} />;
}

/** Puce de choix (filtre, bascule) : texte, pastille de couleur facultative. */
export function PuceTexte({ theme, texte, actif, onPress, testID, couleur, libelle, hauteur = 30 }: { theme: ThemeHub; texte: string; actif: boolean; onPress(): void; testID: string; couleur?: string; libelle?: string; hauteur?: number }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle ?? texte}
      accessibilityState={{ selected: actif }}
      onPress={onPress}
      style={(etat: EtatPresse) => ({
        height: hauteur,
        paddingHorizontal: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: hauteur / 2,
        borderWidth: 1,
        borderColor: actif ? (couleur ?? theme.accent) : theme.ligne,
        backgroundColor: actif ? teinteTransparente(couleur ?? theme.accent, 0.22) : etat.hovered ? teinteTransparente(theme.attenue, 0.12) : 'transparent',
      })}>
      {couleur ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: couleur }} /> : null}
      <Text style={texteAtelier(theme, 12, actif)} numberOfLines={1}>
        {texte}
      </Text>
    </Pressable>
  );
}

/** Bascule à deux ou trois segments, compacte (barre du haut, options d'outil). */
export function Bascule<T extends string>({ theme, valeur, options, onChoisir, testID, libelle, hauteur = 32 }: { theme: ThemeHub; valeur: T; options: ReadonlyArray<readonly [T, string]>; onChoisir(v: T): void; testID: string; libelle: string; hauteur?: number }) {
  return (
    <View style={{ flexDirection: 'row', height: hauteur, borderRadius: 9, borderWidth: 1, borderColor: theme.ligne, overflow: 'hidden' }} accessibilityRole="radiogroup" accessibilityLabel={libelle}>
      {options.map(([cle, texte]) => {
        const actif = cle === valeur;
        return (
          <Pressable
            key={cle}
            testID={`${testID}-${cle}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: actif }}
            accessibilityLabel={`${libelle} : ${texte}`}
            onPress={() => onChoisir(cle)}
            style={{ paddingHorizontal: 11, justifyContent: 'center', backgroundColor: actif ? theme.accent : 'transparent' }}>
            <Text style={{ ...texteAtelier(theme, 12, true), color: actif ? theme.surAccent : theme.texte }} numberOfLines={1}>
              {texte}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Ligne d'un menu (bulle, menu contextuel) : icône, texte, raccourci, état coché. */
export function LigneMenu({ theme, icone, texte, raccourci, onPress, testID, danger, coche, desactive }: { theme: ThemeHub; icone?: string; texte: string; raccourci?: string; onPress(): void; testID: string; danger?: boolean; coche?: boolean; desactive?: boolean }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="menuitem"
      accessibilityState={{ disabled: desactive, checked: coche }}
      disabled={desactive}
      onPress={onPress}
      style={(etat: EtatPresse) => ({
        minHeight: 36,
        paddingHorizontal: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderRadius: 7,
        backgroundColor: etat.hovered || etat.focused ? teinteTransparente(theme.accent, 0.14) : 'transparent',
        opacity: desactive ? 0.4 : 1,
      })}>
      <View style={{ width: 18, alignItems: 'center' }}>{icone ? <Glyphe valeur={icone} style={{ color: danger ? theme.critique : theme.attenue, fontSize: 15 }} /> : null}</View>
      <Text style={{ ...texteAtelier(theme, 13), color: danger ? theme.critique : theme.texte, flex: 1 }} numberOfLines={1}>
        {texte}
      </Text>
      {coche ? <Glyphe valeur="coche" style={{ color: theme.accent, fontSize: 14 }} /> : null}
      {raccourci ? <Text style={{ ...attenueAtelier(theme, 11), ...police(theme.policeChiffres) }}>{raccourci}</Text> : null}
    </Pressable>
  );
}

/** Place d'une bulle près de son ancre, sans sortir de la fenêtre (pur, testé). */
export function placerBulle(ancre: Ancre | undefined, fenetre: { largeur: number; hauteur: number }, largeur: number, cote: 'bas' | 'droite' | 'haut' | 'point' = 'bas'): { left: number; top?: number; bottom?: number; maxHeight: number } {
  const marge = 8;
  const l = Math.min(largeur, fenetre.largeur - marge * 2);
  if (!ancre) return { left: Math.max(marge, (fenetre.largeur - l) / 2), top: Math.max(marge, fenetre.hauteur * 0.18), maxHeight: fenetre.hauteur * 0.7 };
  const borneX = (x: number) => Math.max(marge, Math.min(fenetre.largeur - l - marge, x));
  if (cote === 'droite') {
    const top = Math.max(marge, Math.min(ancre.y, fenetre.hauteur - 220));
    return { left: borneX(ancre.x + ancre.l + 8), top, maxHeight: fenetre.hauteur - top - marge };
  }
  const dessous = fenetre.hauteur - (ancre.y + ancre.h) - marge * 2;
  const dessus = ancre.y - marge * 2;
  if (cote === 'haut' || (cote !== 'point' && dessous < 220 && dessus > dessous)) return { left: borneX(ancre.x), bottom: fenetre.hauteur - ancre.y + 6, maxHeight: Math.max(120, dessus) };
  if (cote === 'point') {
    // Menu contextuel : au point cliqué, replié vers le haut ou la gauche s'il déborderait.
    const haut = ancre.y + 320 > fenetre.hauteur ? Math.max(marge, fenetre.hauteur - 320 - marge) : ancre.y;
    return { left: borneX(ancre.x), top: haut, maxHeight: fenetre.hauteur - haut - marge };
  }
  return { left: borneX(ancre.x), top: ancre.y + ancre.h + 6, maxHeight: Math.max(120, dessous) };
}

/**
 * Bulle posée au-dessus de l'atelier : fond cliquable (ferme), panneau ancré ; sur téléphone, feuille en bas.
 * Rendue par l'atelier à sa racine (pas de fenêtre modale : Échap la ferme d'abord, voir `useAtelier.echap`).
 */
export function Bulle({
  theme,
  ancre,
  fenetre,
  largeur = 280,
  cote = 'bas',
  feuille,
  titre,
  onFermer,
  children,
  testID,
  style,
}: {
  theme: ThemeHub;
  ancre?: Ancre;
  fenetre: { largeur: number; hauteur: number };
  largeur?: number;
  cote?: 'bas' | 'droite' | 'haut' | 'point';
  feuille?: boolean;
  titre?: string;
  onFermer(): void;
  children: React.ReactNode;
  testID: string;
  style?: StyleProp<ViewStyle>;
}) {
  const place = feuille ? undefined : placerBulle(ancre, fenetre, largeur, cote);
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }} pointerEvents="box-none">
      <Pressable testID={`${testID}-fond`} accessibilityRole="button" accessibilityLabel={trAt('tiroir.fermer')} onPress={onFermer} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: feuille ? 'rgba(0,0,0,0.42)' : 'transparent' }} />
      <View
        testID={testID}
        accessibilityRole="menu"
        style={[
          verre(theme, feuille ? 16 : 12),
          feuille
            ? { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: fenetre.hauteur * 0.72, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: 12 }
            : { position: 'absolute', width: Math.min(largeur, fenetre.largeur - 16), ...place },
          style,
        ]}>
        {feuille ? <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: theme.ligne, marginTop: 8 }} /> : null}
        {titre ? <Text style={{ ...texteAtelier(theme, 12, true), color: theme.attenue, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6 }}>{titre}</Text> : null}
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 6, gap: 2 }}>
          {children}
        </ScrollView>
      </View>
    </View>
  );
}

/** Intertitre discret d'une section (tiroir, bulle). */
export function TitreSection({ theme, children }: { theme: ThemeHub; children: string }) {
  return <Text style={{ ...texteAtelier(theme, 11, true), color: theme.attenue, textTransform: 'uppercase', letterSpacing: 0.7 }}>{children}</Text>;
}
