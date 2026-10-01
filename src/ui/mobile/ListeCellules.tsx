/**
 * Listes de cellules, à la manière des Réglages de l'iPhone : ce qu'il faut à la place des tableaux
 * et des grilles de boutons sur un téléphone.
 *
 *  - `GroupeCellules` : un titre de groupe (facultatif), une carte, des séparateurs, une note ;
 *  - `Cellule` : toute la ligne est la zone tactile (48 px minimum). À droite, au choix : une valeur,
 *    un chevron (navigation vers une sous-page), un interrupteur (rôle `switch`, toute la ligne bascule),
 *    une coche (choix dans une liste, rôle `radio`).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import { CONTROLE, ESPACE, TEXTE, rayonCarte, themeActif } from './jetons';

export function GroupeCellules({
  theme: themeDonne,
  titre,
  note,
  children,
  testID,
}: {
  theme?: ThemeHub;
  titre?: string;
  /** Texte d'aide sous le groupe. */
  note?: string;
  children: React.ReactNode;
  testID?: string;
}) {
  const theme = themeActif(themeDonne);
  const enfants = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.groupe} testID={testID}>
      {titre ? (
        <Text accessibilityRole="header" style={[styles.titreGroupe, { color: theme.attenue, ...police(theme.policeTexte) }]}>
          {titre}
        </Text>
      ) : null}
      <View style={[styles.carte, { backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: rayonCarte(theme) }]}>
        {enfants.map((enfant, rang) => (
          <View key={rang}>
            {rang > 0 ? <View style={[styles.separateur, { backgroundColor: theme.ligne }]} /> : null}
            {enfant}
          </View>
        ))}
      </View>
      {note ? <Text style={[styles.note, { color: theme.attenue, ...police(theme.policeTexte) }]}>{note}</Text> : null}
    </View>
  );
}

export interface CelluleProps {
  theme?: ThemeHub;
  titre: string;
  sousTitre?: string;
  /** Pictogramme à gauche, dans une pastille teintée. */
  glyphe?: string;
  /** Teinte de la pastille du pictogramme (accent à défaut). */
  teinte?: string;
  /** Valeur affichée à droite (« Nuit », « 5 min »). */
  valeur?: string;
  /** Chevron : la cellule ouvre une sous-page. */
  chevron?: boolean;
  /** Interrupteur : la cellule bascule une option. */
  interrupteur?: { valeur: boolean; onChanger(valeur: boolean): void };
  /** Coche : la cellule est une option d'un choix unique. */
  coche?: boolean;
  /** Action destructrice (texte rouge). */
  danger?: boolean;
  desactive?: boolean;
  onPress?(): void;
  testID?: string;
  /** Élément libre à droite (pastille d'état). */
  droite?: React.ReactNode;
}

export function Cellule({ theme: themeDonne, titre, sousTitre, glyphe, teinte, valeur, chevron, interrupteur, coche, danger, desactive, onPress, testID, droite }: CelluleProps) {
  const theme = themeActif(themeDonne);
  const couleurTitre = danger ? theme.critique : theme.texte;
  const action = interrupteur ? () => interrupteur.onChanger(!interrupteur.valeur) : onPress;
  const role = interrupteur ? 'switch' : coche !== undefined ? 'radio' : action ? (chevron ? 'link' : 'button') : undefined;
  const contenu = (
    <>
      {glyphe ? (
        <View style={[styles.glyphe, { backgroundColor: teinteTransparente(teinte ?? theme.accent, 0.16), borderRadius: Math.min(theme.rayonMoyen, 10) }]}>
          <Text style={{ color: teinte ?? theme.accent, fontSize: 17, fontWeight: '700' }}>{glyphe}</Text>
        </View>
      ) : null}
      <View style={styles.textes}>
        <Text style={{ color: couleurTitre, fontSize: TEXTE.corps, fontWeight: '500', ...police(theme.policeTexte) }} numberOfLines={2}>
          {titre}
        </Text>
        {sousTitre ? (
          <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, lineHeight: 20, ...police(theme.policeTexte) }} numberOfLines={3}>
            {sousTitre}
          </Text>
        ) : null}
      </View>
      {droite}
      {valeur ? (
        <Text style={{ color: theme.attenue, fontSize: TEXTE.corps, maxWidth: '45%', ...police(theme.policeTexte) }} numberOfLines={1}>
          {valeur}
        </Text>
      ) : null}
      {interrupteur ? <Interrupteur theme={theme} valeur={interrupteur.valeur} /> : null}
      {coche ? <Text style={{ color: theme.accent, fontSize: 20, fontWeight: '700' }}>✓</Text> : null}
      {chevron ? <Text style={{ color: theme.attenue, fontSize: 24, lineHeight: 26 }}>›</Text> : null}
    </>
  );
  if (!action) {
    return (
      <View style={styles.cellule} testID={testID}>
        {contenu}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole={role as never}
      accessibilityLabel={sousTitre ? `${titre}, ${sousTitre}${valeur ? `, ${valeur}` : ''}` : valeur ? `${titre}, ${valeur}` : titre}
      accessibilityState={{ disabled: Boolean(desactive), checked: interrupteur ? interrupteur.valeur : coche }}
      aria-checked={interrupteur ? interrupteur.valeur : coche}
      disabled={desactive}
      onPress={action}
      style={({ pressed }) => [styles.cellule, { backgroundColor: pressed ? teinteTransparente(theme.sombre ? '#FFFFFF' : '#000000', 0.06) : 'transparent', opacity: desactive ? 0.45 : 1 }]}>
      {contenu}
    </Pressable>
  );
}

/** Interrupteur dessiné (la cellule entière porte le rôle `switch` et la zone tactile). */
function Interrupteur({ theme, valeur }: { theme: ThemeHub; valeur: boolean }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.piste, { backgroundColor: valeur ? theme.ok : theme.ligne, justifyContent: valeur ? 'flex-end' : 'flex-start' }]}>
      <View style={styles.bouton} />
    </View>
  );
}

const styles = StyleSheet.create({
  groupe: { gap: ESPACE.xs },
  titreGroupe: { fontSize: TEXTE.legende, fontWeight: '600', paddingHorizontal: ESPACE.xxs },
  carte: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  separateur: { height: StyleSheet.hairlineWidth, marginLeft: ESPACE.m },
  note: { fontSize: TEXTE.legende, lineHeight: 21, paddingHorizontal: ESPACE.xxs },
  cellule: { minHeight: CONTROLE.hauteur + 4, flexDirection: 'row', alignItems: 'center', gap: ESPACE.s, paddingHorizontal: ESPACE.m, paddingVertical: ESPACE.xs },
  glyphe: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  textes: { flex: 1, minWidth: 0, gap: 2 },
  piste: { width: 51, height: 31, borderRadius: 16, padding: 2, flexDirection: 'row' },
  bouton: { width: 27, height: 27, borderRadius: 14, backgroundColor: '#FFFFFF' },
});
