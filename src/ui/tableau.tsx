/**
 * Tableau de données : en-têtes triables, lignes cliquables, pied de totaux.
 *
 * Sur un écran étroit, il défile horizontalement plutôt que de tasser ses
 * colonnes : un tableau de positions illisible n'aide personne.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { usePalette } from './composants';
import { ESPACEMENT } from './theme';
import type { Palette } from './theme';

export interface Colonne<T> {
  cle: string;
  titre: string;
  /** Largeur minimale, en points. */
  largeur: number;
  /** Part de la place restante. 0 : largeur fixe. */
  extensible?: number;
  alignement?: 'gauche' | 'droite' | 'centre';
  rendu(ligne: T): React.ReactNode;
  /** Valeur de tri ; sans elle, la colonne ne se trie pas. */
  tri?(ligne: T): number | string | null;
}

export interface TableauProps<T> {
  colonnes: readonly Colonne<T>[];
  lignes: readonly T[];
  cle(ligne: T): string;
  onPressLigne?(ligne: T): void;
  pied?: React.ReactNode;
  vide?: string;
  testID?: string;
}

export function Tableau<T>({ colonnes, lignes, cle, onPressLigne, pied, vide, testID }: TableauProps<T>) {
  const palette = usePalette();
  const [tri, setTri] = useState<{ cle: string; sens: 1 | -1 } | null>(null);

  const colonneTri = tri ? colonnes.find(colonne => colonne.cle === tri.cle) : undefined;
  const triees =
    colonneTri?.tri && tri
      ? [...lignes].sort((a, b) => {
          const va = colonneTri.tri!(a);
          const vb = colonneTri.tri!(b);
          if (va === vb) return 0;
          if (va === null) return 1;
          if (vb === null) return -1;
          return (va < vb ? -1 : 1) * tri.sens;
        })
      : lignes;

  const largeurMinimale = colonnes.reduce((somme, colonne) => somme + colonne.largeur, 0);
  const style = (colonne: Colonne<T>) => ({
    minWidth: colonne.largeur,
    flexBasis: colonne.largeur,
    flexGrow: colonne.extensible ?? 0,
    flexShrink: 0,
    alignItems:
      colonne.alignement === 'droite'
        ? ('flex-end' as const)
        : colonne.alignement === 'centre'
          ? ('center' as const)
          : ('flex-start' as const),
  });

  return (
    <ScrollView horizontal testID={testID} contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ minWidth: largeurMinimale, flexGrow: 1 }}>
        <View style={[styles.ligne, styles.entete, { borderBottomColor: palette.bordure }]}>
          {colonnes.map(colonne => {
            const actif = tri?.cle === colonne.cle;
            return (
              <Pressable
                key={colonne.cle}
                accessibilityRole={colonne.tri ? 'button' : undefined}
                disabled={!colonne.tri}
                onPress={() =>
                  setTri(precedent =>
                    precedent?.cle === colonne.cle
                      ? precedent.sens === -1
                        ? { cle: colonne.cle, sens: 1 }
                        : null
                      : { cle: colonne.cle, sens: -1 },
                  )
                }
                style={[styles.cellule, style(colonne)]}>
                <Text style={[styles.titre, { color: actif ? palette.accent : palette.texte }]} numberOfLines={1}>
                  {colonne.titre}
                  {actif ? (tri?.sens === -1 ? ' ↓' : ' ↑') : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {triees.length === 0 && vide ? (
          <Text style={[styles.vide, { color: palette.texteSecondaire }]}>{vide}</Text>
        ) : null}

        {triees.map((ligne, index) => (
          <Pressable
            key={`${cle(ligne)}-${index}`}
            disabled={!onPressLigne}
            accessibilityRole={onPressLigne ? 'button' : undefined}
            onPress={() => onPressLigne?.(ligne)}
            style={({ pressed }) => [
              styles.ligne,
              { borderBottomColor: palette.bordure, backgroundColor: pressed ? palette.surfaceHaute : 'transparent' },
            ]}>
            {colonnes.map(colonne => (
              <View key={colonne.cle} style={[styles.cellule, style(colonne)]}>
                {colonne.rendu(ligne)}
              </View>
            ))}
          </Pressable>
        ))}

        {pied ? <View style={[styles.pied, { borderTopColor: palette.bordure }]}>{pied}</View> : null}
      </View>
    </ScrollView>
  );
}

/** Texte de cellule standard. */
export function Cellule({
  children,
  couleur,
  gras,
  petit,
}: {
  children: React.ReactNode;
  couleur?: string;
  gras?: boolean;
  petit?: boolean;
}) {
  const palette = usePalette();
  return (
    <Text
      numberOfLines={1}
      style={{
        color: couleur ?? palette.texte,
        fontSize: petit ? 11 : 12.5,
        fontWeight: gras ? '700' : '500',
      }}>
      {children}
    </Text>
  );
}

/**
 * Couleur de fond d'une cellule de carte de chaleur : verte en hausse, rouge
 * en baisse, d'autant plus soutenue que l'écart est grand.
 */
export function couleurChaleur(palette: Palette, valeur: number | null, echelle: number): string {
  if (valeur === null || !Number.isFinite(valeur) || echelle <= 0) {
    return 'transparent';
  }
  const intensite = Math.min(1, Math.abs(valeur) / echelle);
  const alpha = (0.12 + intensite * 0.5).toFixed(2);
  return valeur >= 0 ? `rgba(52, 199, 123, ${alpha})` : `rgba(240, 82, 82, ${alpha})`;
}

const styles = StyleSheet.create({
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    minHeight: 46,
  },
  entete: { minHeight: 38 },
  cellule: { paddingHorizontal: ESPACEMENT.s, justifyContent: 'center' },
  titre: { fontSize: 12, fontWeight: '700' },
  vide: { padding: ESPACEMENT.m, fontSize: 13 },
  pied: {
    borderTopWidth: 1,
    paddingVertical: ESPACEMENT.s + 2,
    paddingHorizontal: ESPACEMENT.s,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ESPACEMENT.m,
  },
});
