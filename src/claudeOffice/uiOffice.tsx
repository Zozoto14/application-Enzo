/**
 * Claude Office : petits éléments d'interface communs aux onglets (Bureau,
 * Historique, Statistiques). Partout, PC compris : cibles de 44 px au moins
 * et textes de 15 px au moins (le site sur iPad et iPhone est l'usage
 * principal). Couleurs du thème du hub, rien de global n'est modifié.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { police, type ThemeHub } from '../hub/themes';

export const TAILLE = 15;

export function Bouton({ theme, titre, onPress, testID, libelle, variante = 'normal', desactive, couleur, compact, style }: {
  theme: ThemeHub; titre: string; onPress(): void; testID?: string; libelle?: string; variante?: 'normal' | 'plein' | 'danger' | 'discret';
  desactive?: boolean; couleur?: string; compact?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const accent = couleur ?? theme.accent;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle}
      accessibilityState={{ disabled: !!desactive }}
      disabled={desactive}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.bouton,
        compact ? styles.compact : null,
        {
          backgroundColor: variante === 'plein' ? accent : variante === 'discret' ? 'transparent' : theme.surface,
          borderColor: variante === 'plein' ? accent : variante === 'danger' ? theme.critique : hovered ? accent : variante === 'discret' ? 'transparent' : theme.ligne,
          borderRadius: Math.min(theme.rayonMoyen, 12),
          opacity: desactive ? 0.45 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      <Text style={{ color: variante === 'plein' ? theme.surAccent : variante === 'danger' ? theme.critique : variante === 'discret' ? theme.accent : theme.texte, fontWeight: '600', fontSize: TAILLE, ...police(theme.policeTexte) }}>
        {titre}
      </Text>
    </Pressable>
  );
}

/** Puce sélectionnable (filtres, bascules). */
export function Puce({ theme, titre, actif, onPress, testID, couleur, libelle }: { theme: ThemeHub; titre: string; actif: boolean; onPress(): void; testID?: string; couleur?: string; libelle?: string }) {
  const accent = couleur ?? theme.accent;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle}
      accessibilityState={{ selected: actif }}
      onPress={onPress}
      style={[styles.puce, { borderColor: actif ? accent : theme.ligne, backgroundColor: actif ? accent : theme.surface }]}
    >
      <Text style={{ color: actif ? '#FFFFFF' : theme.texte, fontSize: TAILLE, fontWeight: actif ? '700' : '500' }} numberOfLines={1}>{titre}</Text>
    </Pressable>
  );
}

/** Groupe de puces exclusives (bascule Scène / Liste, période…). */
export function Segments<T extends string>({ theme, valeurs, valeur, onChange, testID, libelle }: {
  theme: ThemeHub; valeurs: ReadonlyArray<readonly [T, string]>; valeur: T; onChange(v: T): void; testID: string; libelle: string;
}) {
  return (
    <View style={[styles.segments, { borderColor: theme.ligne, backgroundColor: theme.surface }]} accessibilityRole="radiogroup" accessibilityLabel={libelle}>
      {valeurs.map(([v, titre]) => (
        <Pressable
          key={v}
          accessibilityRole="radio"
          accessibilityState={{ checked: v === valeur }}
          onPress={() => onChange(v)}
          testID={`${testID}-${v}`}
          style={[styles.segment, { backgroundColor: v === valeur ? theme.accent : 'transparent' }]}
        >
          <Text style={{ color: v === valeur ? theme.surAccent : theme.texte, fontSize: TAILLE, fontWeight: '600' }}>{titre}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Toute la ligne (44 px au moins) est l'interrupteur. */
export function Interrupteur({ theme, libelle, aide, valeur, onChange, testID, desactive }: {
  theme: ThemeHub; libelle: string; aide?: string; valeur: boolean; onChange(v: boolean): void; testID: string; desactive?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: valeur, disabled: desactive }}
      accessibilityLabel={libelle}
      accessibilityHint={aide}
      disabled={desactive}
      onPress={() => onChange(!valeur)}
      style={[styles.interrupteur, desactive ? { opacity: 0.5 } : null]}
      testID={testID}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.texte, fontSize: TAILLE }}>{libelle}</Text>
        {aide ? <Text style={{ color: theme.attenue, fontSize: TAILLE, marginTop: 2, lineHeight: 21 }}>{aide}</Text> : null}
      </View>
      <View pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Switch value={valeur} disabled={desactive} />
      </View>
    </Pressable>
  );
}

export async function copierTexte(texte: string): Promise<boolean> {
  const presse = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard;
  try {
    if (!presse) return false;
    await presse.writeText(texte);
    return true;
  } catch {
    return false;
  }
}

/** Une commande à lancer sur le PC, sélectionnable, avec « Copier ». */
export function Commande({ theme, commande, testID }: { theme: ThemeHub; commande: string; testID?: string }) {
  const [etat, setEtat] = useState<'copie' | 'echec'>();
  return (
    <View style={[styles.commande, { borderColor: theme.ligne, backgroundColor: theme.fond }]} testID={testID}>
      <Text selectable style={{ color: theme.texte, fontFamily: 'monospace', fontSize: TAILLE, flex: 1, minWidth: 160 }}>{commande}</Text>
      <Bouton
        theme={theme}
        compact
        titre={etat === 'copie' ? 'Copié ✓' : etat === 'echec' ? 'Sélectionne le texte' : 'Copier'}
        libelle={`Copier la commande ${commande}`}
        onPress={() => void copierTexte(commande).then(ok => setEtat(ok ? 'copie' : 'echec'))}
        testID={testID ? `${testID}-copier` : undefined}
      />
    </View>
  );
}

export function Carte({ theme, titre, children, testID, bordure, style }: { theme: ThemeHub; titre?: string; children: React.ReactNode; testID?: string; bordure?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View testID={testID} style={[styles.carte, { backgroundColor: theme.surface, borderColor: bordure ?? theme.ligne, borderRadius: theme.rayonMoyen, borderWidth: bordure ? 1.5 : StyleSheet.hairlineWidth }, style]}>
      {titre ? <Text accessibilityRole="header" style={{ color: theme.texte, fontSize: 17, fontWeight: '700', ...police(theme.policeTitre) }}>{titre}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bouton: { minHeight: 44, minWidth: 44, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  compact: { paddingHorizontal: 12 },
  puce: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderWidth: 1, borderRadius: 999, justifyContent: 'center', maxWidth: '100%' },
  segments: { flexDirection: 'row', borderWidth: 1, borderRadius: 999, padding: 2, gap: 2 },
  segment: { minHeight: 44, minWidth: 64, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', alignItems: 'center' },
  interrupteur: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  commande: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, padding: 8 },
  carte: { padding: 14, gap: 10 },
});
