/**
 * Code de liaison Discord affiché en grand (« Lier un serveur Discord »,
 * « Lier mon Discord ») : le code, la commande à taper et sa durée de validité.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { police, type ThemeHub } from '../../hub/themes';
import type { CodeLiaison } from '../discord/api';

/** Code de liaison affiché en grand, avec la commande à taper et sa durée de validité. */
export function CodeAffiche({ theme, code, testID }: { theme: ThemeHub; code: CodeLiaison; testID: string }) {
  const minutes = Math.max(1, Math.round((Date.parse(code.expire) - Date.now()) / 60_000));
  return (
    <View style={{ gap: 6, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.accent }} testID={testID}>
      <Text selectable style={{ color: theme.texte, fontSize: 28, fontWeight: '800', letterSpacing: 4, ...police(theme.policeTitre) }} testID={`${testID}-code`}>
        {code.code}
      </Text>
      <Text selectable style={{ color: theme.texte, ...police(theme.policeTexte) }}>
        Dans Discord, tapez : {code.commande}
      </Text>
      <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>Valable {minutes} min, une seule fois.</Text>
    </View>
  );
}
