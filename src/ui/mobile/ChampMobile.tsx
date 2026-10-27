/**
 * Champ de saisie du mode téléphone : libellé au-dessus, aide et erreur en dessous, 48 px de haut,
 * texte de 17 px (pas de zoom iOS), et surtout le BON clavier.
 *
 * `nature` choisit d'un coup ce que le clavier et le gestionnaire de mots de passe doivent savoir :
 * `inputMode`, `autoComplete`, `textContentType` (iOS), `enterKeyHint`, majuscules, correction.
 * Toutes les props de `TextInput` restent possibles et l'emportent sur ces préréglages.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { police, type ThemeHub } from '../../hub/themes';
import { CONTROLE, ESPACE, TEXTE, rayonControle, themeActif } from './jetons';

export type NatureChamp =
  | 'texte'
  | 'prenom'
  | 'identifiant'
  | 'motDePasse'
  | 'nouveauMotDePasse'
  | 'codeTotp'
  | 'codeLiaison'
  | 'codeRecuperation'
  | 'recherche'
  | 'email'
  | 'url'
  | 'nombre'
  | 'decimal'
  | 'multiligne';

/** Préréglages clavier de chaque nature (exportés pour les tests). */
export function prereglagesClavier(nature: NatureChamp): Partial<TextInputProps> {
  switch (nature) {
    case 'prenom':
      return { inputMode: 'text', autoComplete: 'given-name', textContentType: 'givenName', autoCapitalize: 'words', autoCorrect: false, enterKeyHint: 'next' };
    case 'identifiant':
      return { inputMode: 'text', autoComplete: 'username', textContentType: 'username', autoCapitalize: 'none', autoCorrect: false, enterKeyHint: 'next' };
    case 'motDePasse':
      return { secureTextEntry: true, autoComplete: 'current-password', textContentType: 'password', autoCapitalize: 'none', autoCorrect: false, enterKeyHint: 'next' };
    case 'nouveauMotDePasse':
      return { secureTextEntry: true, autoComplete: 'new-password', textContentType: 'newPassword', autoCapitalize: 'none', autoCorrect: false, enterKeyHint: 'next' };
    case 'codeTotp':
      return { inputMode: 'numeric', keyboardType: 'number-pad', autoComplete: 'one-time-code', textContentType: 'oneTimeCode', maxLength: 6, autoCorrect: false, enterKeyHint: 'go' };
    case 'codeLiaison':
    case 'codeRecuperation':
      return { inputMode: 'text', autoComplete: 'off', autoCapitalize: nature === 'codeRecuperation' ? 'characters' : 'none', autoCorrect: false, spellCheck: false, enterKeyHint: 'go' };
    case 'recherche':
      return { inputMode: 'search', autoComplete: 'off', autoCapitalize: 'none', autoCorrect: false, enterKeyHint: 'search' };
    case 'email':
      return { inputMode: 'email', keyboardType: 'email-address', autoComplete: 'email', textContentType: 'emailAddress', autoCapitalize: 'none', autoCorrect: false, enterKeyHint: 'next' };
    case 'url':
      return { inputMode: 'url', keyboardType: 'url', autoComplete: 'url', autoCapitalize: 'none', autoCorrect: false, enterKeyHint: 'go' };
    case 'nombre':
      return { inputMode: 'numeric', keyboardType: 'number-pad', autoComplete: 'off', enterKeyHint: 'next' };
    case 'decimal':
      return { inputMode: 'decimal', keyboardType: 'decimal-pad', autoComplete: 'off', enterKeyHint: 'next' };
    case 'multiligne':
      return { inputMode: 'text', autoComplete: 'off', multiline: true, enterKeyHint: 'enter', textAlignVertical: 'top' };
    default:
      return { inputMode: 'text', autoComplete: 'off', enterKeyHint: 'next' };
  }
}

export interface ChampMobileProps extends TextInputProps {
  etiquette: string;
  /** Aide sous le champ. */
  indication?: string;
  /** Erreur sous le champ (annoncée). */
  erreur?: string;
  nature?: NatureChamp;
  theme?: ThemeHub;
  /** Faux : pas de bouton « Afficher » dans le champ (l'écran fournit le sien, commun à plusieurs champs). */
  boutonVoir?: boolean;
}

export function ChampMobile({ etiquette, indication, erreur, nature = 'texte', theme: themeDonne, style, testID, boutonVoir = true, ...reste }: ChampMobileProps) {
  const theme = themeActif(themeDonne);
  const prereglages = prereglagesClavier(nature);
  const secret = Boolean(reste.secureTextEntry ?? prereglages.secureTextEntry);
  const [visible, setVisible] = useState(false);
  const multiligne = Boolean(reste.multiline ?? prereglages.multiline);
  return (
    <View style={styles.champ}>
      <Text style={[styles.etiquette, { color: theme.texte, ...police(theme.policeTexte) }]}>{etiquette}</Text>
      <View style={[styles.cadre, { backgroundColor: theme.surface, borderColor: erreur ? theme.critique : theme.ligne, borderRadius: rayonControle(theme) === 999 ? 24 : rayonControle(theme) }]}>
        <TextInput
          accessibilityLabel={etiquette}
          placeholderTextColor={theme.attenue}
          testID={testID}
          {...prereglages}
          {...reste}
          secureTextEntry={secret && !visible}
          style={[
            styles.saisie,
            multiligne && styles.multiligne,
            { color: theme.texte, ...police(theme.policeTexte) },
            { outlineStyle: 'none' } as object,
            style,
          ]}
        />
        {secret && boutonVoir ? (
          <Pressable
            testID={testID ? `${testID}-voir` : undefined}
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            onPress={() => setVisible(v => !v)}
            style={styles.voir}>
            <Text style={{ color: theme.accent, fontSize: TEXTE.legende, fontWeight: '600', ...police(theme.policeTexte) }}>{visible ? 'Masquer' : 'Afficher'}</Text>
          </Pressable>
        ) : null}
      </View>
      {erreur ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.aide, { color: theme.critique, ...police(theme.policeTexte) }]}>
          {erreur}
        </Text>
      ) : indication ? (
        <Text style={[styles.aide, { color: theme.attenue, ...police(theme.policeTexte) }]}>{indication}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  champ: { gap: ESPACE.xxs + 2 },
  etiquette: { fontSize: TEXTE.legende, fontWeight: '600' },
  cadre: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, minHeight: CONTROLE.hauteur },
  saisie: { flex: 1, minHeight: CONTROLE.hauteur, fontSize: TEXTE.champ, paddingHorizontal: ESPACE.s + 2, paddingVertical: ESPACE.xs },
  multiligne: { minHeight: 120, paddingTop: ESPACE.s },
  voir: { minHeight: CONTROLE.cible, minWidth: 72, alignItems: 'center', justifyContent: 'center', paddingHorizontal: ESPACE.xs },
  aide: { fontSize: TEXTE.legende, lineHeight: 21 },
});
