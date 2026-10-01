/**
 * En-tête compact d'un écran de téléphone : retour (à gauche), titre, une ou deux actions (à droite),
 * et la zone de sécurité du haut. 52 px de haut, chaque bouton fait 44 × 44 px au moins.
 *
 * Une seule ligne, jamais de retour à la ligne : le titre se tronque, les actions ne bougent pas.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { police, type ThemeHub } from '../../hub/themes';
import { CONTROLE, EXEMPTE_TEXTE, GOUTTIERE, TEXTE, themeActif } from './jetons';
import { margesSecurite } from './ZoneSecurite';

export interface ActionEnTete {
  /** Pictogramme ou mot court. */
  titre: string;
  /** Nom accessible (obligatoire quand `titre` est un pictogramme). */
  libelle: string;
  onPress(): void;
  testID?: string;
  /** Pastille (nombre, point) posée sur l'action. */
  pastille?: string;
}

export function BoutonIcone({
  theme: themeDonne,
  titre,
  libelle,
  onPress,
  testID,
  pastille,
  actif = false,
}: ActionEnTete & { theme?: ThemeHub; actif?: boolean }) {
  const theme = themeActif(themeDonne);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.icone, { backgroundColor: pressed || actif ? theme.surface : 'transparent', borderRadius: Math.min(theme.rayonMoyen, 12) }]}>
      <Text style={{ color: actif ? theme.accent : theme.texte, fontSize: 20, fontWeight: '600', ...police(theme.policeTexte) }}>{titre}</Text>
      {pastille ? (
        // Pastille de compteur : seule exception admise à la taille minimale du texte.
        <View style={[styles.pastille, { backgroundColor: theme.accent }]} {...EXEMPTE_TEXTE}>
          <Text style={{ color: theme.surAccent, fontSize: 12, fontWeight: '800' }}>{pastille}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function EnTeteMobile({
  theme: themeDonne,
  titre,
  surTitre,
  onRetour,
  libelleRetour = 'Retour',
  actions = [],
  gauche,
  droite,
  testID = 'entete-mobile',
  testIDRetour,
}: {
  theme?: ThemeHub;
  titre: string;
  /** Petit libellé au-dessus du titre (nom de l'app, de la section parente). */
  surTitre?: string;
  onRetour?(): void;
  libelleRetour?: string;
  actions?: readonly ActionEnTete[];
  /** Élément libre à gauche (logo) quand il n'y a pas de retour. */
  gauche?: React.ReactNode;
  /** Élément libre à droite, avant les actions (pastille de synchro). */
  droite?: React.ReactNode;
  testID?: string;
  /** testID du bouton retour (défaut : `${testID}-retour`). */
  testIDRetour?: string;
}) {
  const theme = themeActif(themeDonne);
  return (
    <View
      testID={testID}
      style={[styles.entete, margesSecurite(['haut'], { haut: 0 }), { backgroundColor: theme.fond, borderBottomColor: theme.ligne }]}>
      <View style={styles.ligne}>
        {onRetour ? (
          <Pressable
            testID={testIDRetour ?? `${testID}-retour`}
            accessibilityRole="button"
            accessibilityLabel={libelleRetour}
            onPress={onRetour}
            hitSlop={4}
            style={({ pressed }) => [styles.retour, { opacity: pressed ? 0.6 : 1 }]}>
            <Text style={{ color: theme.accent, fontSize: 26, lineHeight: 28, marginTop: -2 }}>‹</Text>
            <Text numberOfLines={1} style={{ color: theme.accent, fontSize: TEXTE.corps, fontWeight: '500', maxWidth: 110, ...police(theme.policeTexte) }}>
              {libelleRetour}
            </Text>
          </Pressable>
        ) : gauche ? (
          gauche
        ) : null}
        <View style={styles.titres}>
          {surTitre ? (
            <Text numberOfLines={1} style={{ color: theme.attenue, fontSize: TEXTE.legende, fontWeight: '500', ...police(theme.policeTexte) }} accessibilityElementsHidden>
              {surTitre}
            </Text>
          ) : null}
          <Text
            numberOfLines={1}
            accessibilityRole="header"
            style={{
              color: theme.texte,
              fontSize: TEXTE.entete + 1,
              fontWeight: theme.poidsTitre === '400' ? '600' : theme.poidsTitre,
              textTransform: theme.majuscules ? 'uppercase' : 'none',
              ...police(theme.policeTitre),
            }}>
            {titre}
          </Text>
        </View>
        {droite}
        {actions.map(action => (
          <BoutonIcone key={action.testID ?? action.libelle} theme={theme} {...action} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  entete: { borderBottomWidth: StyleSheet.hairlineWidth },
  ligne: { minHeight: CONTROLE.entete, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: GOUTTIERE - 8 },
  retour: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: CONTROLE.cible, minWidth: CONTROLE.cible, paddingHorizontal: 6 },
  titres: { flex: 1, minWidth: 0, paddingHorizontal: 6 },
  icone: { minWidth: CONTROLE.cible, minHeight: CONTROLE.cible, alignItems: 'center', justifyContent: 'center' },
  pastille: { position: 'absolute', top: 4, right: 2, minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
});
