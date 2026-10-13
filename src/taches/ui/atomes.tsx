/**
 * Petits éléments d'interface de Tâches, accordés au thème du hub (8 thèmes,
 * clair et sombre). Textes de 15 px au moins ; cibles de 44 px au moins sur
 * téléphone (et pour tout ce qu'on touche du doigt).
 */

import React, { useEffect, useRef } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { ecouterTouche } from '../../hub/web';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import { FeuilleBasse, useMobile } from '../../ui/mobile';
import { LIBELLES_PRIORITE, type Priorite } from '../modele';

export const T = { petit: 15, corps: 15, fort: 16, titre: 20, grand: 26 } as const;

export function couleurPriorite(p: Priorite, theme: ThemeHub): string {
  switch (p) {
    case 'urgente':
      return theme.critique;
    case 'haute':
      return theme.alerte;
    case 'normale':
      return theme.accent;
    default:
      return theme.attenue;
  }
}

export const texteDe = (theme: ThemeHub, taille: number = T.corps) => ({ color: theme.texte, fontSize: taille, ...police(theme.policeTexte) });
export const attenueDe = (theme: ThemeHub, taille: number = T.petit) => ({ color: theme.attenue, fontSize: taille, ...police(theme.policeTexte) });
export const titreDe = (theme: ThemeHub, taille: number = T.titre) => ({
  color: theme.texte,
  fontSize: taille,
  fontWeight: theme.poidsTitre,
  textTransform: theme.majuscules ? ('uppercase' as const) : ('none' as const),
  ...police(theme.policeTitre),
});

export function Bouton({
  theme,
  titre,
  onPress,
  testID,
  libelle,
  variante = 'normal',
  desactive,
  compact,
  style,
}: {
  theme: ThemeHub;
  titre: string;
  onPress(): void;
  testID?: string;
  libelle?: string;
  variante?: 'plein' | 'normal' | 'discret' | 'danger';
  desactive?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const plein = variante === 'plein';
  // Téléphone : jamais sous 44 px.
  const mobile = useMobile();
  const serre = compact && !mobile;
  const couleur = variante === 'danger' ? theme.critique : plein ? theme.surAccent : variante === 'discret' ? theme.attenue : theme.texte;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle ?? titre}
      accessibilityState={{ disabled: Boolean(desactive) }}
      disabled={desactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.bouton,
        serre && styles.boutonCompact,
        {
          backgroundColor: plein ? theme.accent : variante === 'discret' ? 'transparent' : pressed ? theme.ligne : teinteTransparente(theme.sombre ? '#FFFFFF' : '#000000', 0.05),
          borderColor: plein || variante === 'discret' ? 'transparent' : theme.ligne,
          borderRadius: Math.min(theme.rayonMoyen, 10),
          opacity: desactive ? 0.45 : pressed && plein ? 0.85 : 1,
        },
        style,
      ]}>
      <Text numberOfLines={1} style={{ color: couleur, fontSize: T.corps, fontWeight: '600', ...police(theme.policeTexte) }}>
        {titre}
      </Text>
    </Pressable>
  );
}

/** Pastille (statut, étiquette, priorité). Touchable si `onPress`. */
export function Puce({
  theme,
  texte,
  couleur,
  onPress,
  testID,
  libelle,
  actif,
  plein,
  grand,
}: {
  theme: ThemeHub;
  texte: string;
  couleur?: string;
  onPress?(): void;
  testID?: string;
  libelle?: string;
  actif?: boolean;
  plein?: boolean;
  grand?: boolean;
}) {
  const c = couleur ?? theme.attenue;
  const mobile = useMobile();
  const large = grand || (mobile && Boolean(onPress));
  const contenu = (
    <Text numberOfLines={1} style={{ color: plein ? theme.surAccent : theme.sombre ? c : theme.texte, fontSize: T.petit, fontWeight: '600', ...police(theme.policeTexte) }}>
      {texte}
    </Text>
  );
  const style = [
    styles.puce,
    large && styles.puceGrande,
    {
      backgroundColor: plein ? c : teinteTransparente(c, actif ? 0.32 : 0.14),
      borderColor: actif ? c : teinteTransparente(c, 0.45),
      borderRadius: theme.id === 'terminal' ? 0 : 999,
    },
  ];
  if (!onPress) {
    return (
      <View testID={testID} style={style} accessibilityLabel={libelle}>
        {contenu}
      </View>
    );
  }
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={libelle ?? texte} accessibilityState={{ selected: Boolean(actif) }} onPress={onPress} hitSlop={large ? 0 : 6} style={({ pressed }) => [style, pressed && { opacity: 0.75 }]}>
      {contenu}
    </Pressable>
  );
}

/** Case ronde « terminée ». */
export function CaseRonde({ theme, coche, couleur, onPress, libelle, testID, desactive }: { theme: ThemeHub; coche: boolean; couleur?: string; onPress(): void; libelle: string; testID?: string; desactive?: boolean }) {
  const c = couleur ?? theme.ok;
  const mobile = useMobile();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: coche, disabled: Boolean(desactive) }}
      accessibilityLabel={libelle}
      disabled={desactive}
      onPress={onPress}
      hitSlop={10}
      style={[styles.caseZone, mobile && styles.caseZoneMobile]}>
      <View style={[styles.caseRonde, { borderColor: coche ? c : theme.attenue, backgroundColor: coche ? c : 'transparent', opacity: desactive ? 0.5 : 1 }]}>
        {coche ? <Text style={{ color: theme.surAccent, fontSize: 15, fontWeight: '800', lineHeight: 17 }}>✓</Text> : null}
      </View>
    </Pressable>
  );
}

export const Champ = React.forwardRef<React.ComponentRef<typeof TextInput>, TextInputProps & { theme: ThemeHub; mobile?: boolean }>(function Champ({ theme, style, mobile, ...reste }, ref) {
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={theme.attenue}
      {...reste}
      style={[
        styles.champ,
        { minHeight: mobile ? 48 : 40, fontSize: mobile ? 17 : T.corps, color: theme.texte, backgroundColor: theme.fond, borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10), ...police(theme.policeTexte) },
        reste.multiline && { minHeight: 96, textAlignVertical: 'top', paddingTop: 10 },
        style,
      ]}
    />
  );
});

export function Libelle({ theme, children }: { theme: ThemeHub; children: string }) {
  return <Text style={[attenueDe(theme), { fontWeight: '700', letterSpacing: 0.4 }]}>{children}</Text>;
}

/**
 * Fenêtre : feuille basse sur téléphone, boîte centrée ailleurs. Échap ferme.
 */
export function Dialogue({
  theme,
  visible,
  titre,
  description,
  onFermer,
  children,
  pied,
  mobile,
  testID,
  large,
}: {
  theme: ThemeHub;
  visible: boolean;
  titre: string;
  description?: string;
  onFermer(): void;
  children?: React.ReactNode;
  pied?: React.ReactNode;
  mobile: boolean;
  testID?: string;
  large?: boolean;
}) {
  const { height } = useWindowDimensions();
  const fermer = useRef(onFermer);
  fermer.current = onFermer;
  useEffect(() => (visible && !mobile ? ecouterTouche('Escape', () => fermer.current()) : undefined), [visible, mobile]);
  if (mobile) {
    return (
      <FeuilleBasse theme={theme} visible={visible} titre={titre} description={description} onFermer={onFermer} pied={pied} testID={testID}>
        {children}
      </FeuilleBasse>
    );
  }
  if (!visible) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onFermer}>
      <View style={styles.voileZone}>
        <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={onFermer} style={[StyleSheet.absoluteFill, { backgroundColor: teinteTransparente('#000000', theme.sombre ? 0.6 : 0.35) }]} />
        <View
          testID={testID}
          accessibilityViewIsModal
          role="dialog"
          aria-label={titre}
          style={[styles.dialogue, { maxWidth: large ? 640 : 480, maxHeight: height - 64, backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: Math.min(theme.rayonGrand, 18) }]}>
          <View style={styles.dialogueTete}>
            <Text accessibilityRole="header" style={[titreDe(theme, 19), { flex: 1 }]}>
              {titre}
            </Text>
            <Pressable testID={testID ? `${testID}-fermer` : undefined} accessibilityRole="button" accessibilityLabel="Fermer" onPress={onFermer} style={styles.fermer}>
              <Text style={{ color: theme.attenue, fontSize: 17, fontWeight: '700' }}>✕</Text>
            </Pressable>
          </View>
          {description ? <Text style={[attenueDe(theme), { paddingHorizontal: 20, paddingBottom: 8, lineHeight: 21 }]}>{description}</Text> : null}
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {pied ? <View style={styles.dialoguePied}>{pied}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

/** Choix dans une liste (menu) : rend des lignes cochées. */
export function Options<V extends string>({
  theme,
  options,
  valeur,
  onChoisir,
  testID,
  multiple,
}: {
  theme: ThemeHub;
  options: ReadonlyArray<{ valeur: V; texte: string; couleur?: string; detail?: string }>;
  valeur: V | readonly V[] | undefined;
  onChoisir(v: V): void;
  testID?: string;
  multiple?: boolean;
}) {
  const choisis = Array.isArray(valeur) ? valeur : valeur === undefined ? [] : [valeur];
  return (
    <View style={{ gap: 4 }} accessibilityRole={multiple ? undefined : 'radiogroup'}>
      {options.map(o => {
        const actif = choisis.includes(o.valeur);
        return (
          <Pressable
            key={o.valeur}
            testID={testID ? `${testID}-${o.valeur}` : undefined}
            accessibilityRole={multiple ? 'checkbox' : 'radio'}
            accessibilityState={multiple ? { checked: actif } : { selected: actif }}
            onPress={() => onChoisir(o.valeur)}
            style={({ pressed }) => [styles.option, { borderRadius: Math.min(theme.rayonMoyen, 10), backgroundColor: actif ? teinteTransparente(theme.accent, 0.14) : pressed ? theme.ligne : 'transparent' }]}>
            {o.couleur ? <View style={[styles.point, { backgroundColor: o.couleur }]} /> : null}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[texteDe(theme), { fontWeight: actif ? '700' : '500' }]}>{o.texte}</Text>
              {o.detail ? <Text style={attenueDe(theme)}>{o.detail}</Text> : null}
            </View>
            <Text style={{ color: theme.accent, fontSize: 17, fontWeight: '800', width: 20 }}>{actif ? '✓' : ''}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function PastillePriorite({ theme, priorite, compacte }: { theme: ThemeHub; priorite: Priorite; compacte?: boolean }) {
  const c = couleurPriorite(priorite, theme);
  return (
    <View style={styles.prio} accessibilityLabel={`Priorité ${LIBELLES_PRIORITE[priorite].toLowerCase()}`}>
      <Text style={{ color: c, fontSize: 15, fontWeight: '800' }}>⚑</Text>
      {compacte ? null : <Text style={[texteDe(theme), { color: theme.sombre ? c : theme.texte }]}>{LIBELLES_PRIORITE[priorite]}</Text>}
    </View>
  );
}

export function Avatar({ theme, nom, couleur, taille = 26 }: { theme: ThemeHub; nom: string; couleur: string; taille?: number }) {
  return (
    <View style={[styles.avatar, { width: taille, height: taille, borderRadius: taille / 2, backgroundColor: couleur }]} accessibilityLabel={nom}>
      <Text style={{ color: theme.surAccent, fontSize: 15, fontWeight: '800', lineHeight: 18 }}>{(nom.trim()[0] ?? '?').toUpperCase()}</Text>
    </View>
  );
}

export function EtatVide({ theme, titre, texte, children, testID }: { theme: ThemeHub; titre: string; texte: string; children?: React.ReactNode; testID?: string }) {
  return (
    <View testID={testID} style={[styles.vide, { borderColor: theme.ligne, borderRadius: Math.min(theme.rayonGrand, 16) }]}>
      <Text style={{ fontSize: 34 }}>☑︎</Text>
      <Text style={[titreDe(theme, 19), { textAlign: 'center' }]}>{titre}</Text>
      <Text style={[attenueDe(theme), { textAlign: 'center', lineHeight: 22, maxWidth: 520 }]}>{texte}</Text>
      {children ? <View style={styles.videActions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bouton: { minHeight: 44, minWidth: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  boutonCompact: { minHeight: 36, paddingHorizontal: 12 },
  puce: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, minHeight: 26, borderWidth: 1, maxWidth: 220 },
  puceGrande: { minHeight: 44, paddingHorizontal: 14 },
  caseZone: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  caseZoneMobile: { width: 44, height: 44 },
  caseRonde: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  champ: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  voileZone: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialogue: { width: '100%', borderWidth: 1, overflow: 'hidden' },
  dialogueTete: { flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 8, paddingTop: 10, paddingBottom: 6 },
  dialoguePied: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, padding: 16, paddingTop: 8, flexWrap: 'wrap' },
  fermer: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 12, paddingVertical: 6 },
  point: { width: 12, height: 12, borderRadius: 6 },
  prio: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  vide: { alignItems: 'center', gap: 10, padding: 28, borderWidth: 1, borderStyle: 'dashed', margin: 4 },
  videActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 6 },
});
