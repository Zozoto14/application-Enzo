/**
 * Barre de navigation basse : 3 à 5 entrées, pictogramme + libellé, sous le pouce.
 *
 * Toujours visible en bas de l'écran, au-dessus de la barre d'accueil de l'iPhone (zone de sécurité).
 * L'entrée active est marquée par la couleur ET par la graisse du libellé (jamais par la couleur seule),
 * et annoncée (`tab`, `selected`). Chaque entrée occupe une part égale de la largeur, 58 px de haut.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { police, type ThemeHub } from '../../hub/themes';
import { CONTROLE, EXEMPTE_TEXTE, TEXTE, themeActif } from './jetons';
import { margesSecurite } from './ZoneSecurite';
import { Glyphe } from '../icones';

export interface EntreeOnglet {
  cle: string;
  libelle: string;
  /** Pictogramme texte (aucune police d'icônes embarquée). */
  glyphe: string;
  /** Nom accessible, si le libellé ne suffit pas. */
  description?: string;
  /** Pastille : point (« • ») ou nombre. */
  pastille?: string;
  /** Couleur de la pastille (état de synchro…) ; l'accent à défaut. */
  couleurPastille?: string;
}

export const MAX_ONGLETS = 5;

export function BarreOnglets({
  theme: themeDonne,
  entrees,
  actif,
  onChoisir,
  testID = 'barre-basse',
}: {
  theme?: ThemeHub;
  entrees: readonly EntreeOnglet[];
  /** Clé de l'entrée active ; aucune si l'écran courant n'en dépend pas. */
  actif?: string;
  onChoisir(cle: string): void;
  testID?: string;
}) {
  const theme = themeActif(themeDonne);
  const visibles = entrees.slice(0, MAX_ONGLETS);
  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      accessibilityLabel="Navigation principale"
      style={[styles.barre, margesSecurite(['bas']), { backgroundColor: theme.surface, borderTopColor: theme.ligne }]}>
      {visibles.map(entree => {
        const choisi = entree.cle === actif;
        const couleur = choisi ? theme.accent : theme.attenue;
        return (
          <Pressable
            key={entree.cle}
            testID={`${testID}-${entree.cle}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: choisi }}
            aria-selected={choisi}
            accessibilityLabel={entree.description ?? entree.libelle}
            onPress={() => onChoisir(entree.cle)}
            style={({ pressed }) => [styles.entree, { opacity: pressed ? 0.6 : 1 }]}>
            <View>
              <Glyphe valeur={entree.glyphe} style={[styles.glyphe, { color: couleur }]} />
              {entree.pastille !== undefined ? (
                <View style={[styles.pastille, entree.pastille && entree.pastille !== '•' ? styles.pastilleNombre : null, { backgroundColor: entree.couleurPastille ?? theme.accent, borderColor: theme.surface }]} {...EXEMPTE_TEXTE}>
                  {entree.pastille && entree.pastille !== '•' ? <Text style={{ color: theme.surAccent, fontSize: 11, fontWeight: '800' }}>{entree.pastille}</Text> : null}
                </View>
              ) : null}
            </View>
            <Text
              numberOfLines={1}
              style={{ color: couleur, fontSize: TEXTE.legende, fontWeight: choisi ? '700' : '500', ...police(theme.policeTexte) }}>
              {entree.libelle}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  barre: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  entree: { flex: 1, minHeight: CONTROLE.barreBasse, alignItems: 'center', justifyContent: 'center', gap: 2, paddingTop: 6, paddingBottom: 4 },
  glyphe: { fontSize: 21, lineHeight: 24, textAlign: 'center' },
  pastille: { position: 'absolute', top: -2, right: -10, minWidth: 12, height: 12, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  // Pastille chiffrée : assez grande pour lire le nombre (11 px).
  pastilleNombre: { top: -6, right: -16, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 3 },
});
