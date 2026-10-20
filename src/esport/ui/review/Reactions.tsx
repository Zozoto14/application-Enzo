/**
 * Boutons 👍 / 👎 d'un repère ou d'un commentaire : compteurs visibles par
 * tous ; un appui choisit, change ou retire SA réaction (permission
 * video_review.react) ; la liste des personnes qui ont réagi s'affiche au
 * survol (site, app PC) ou à l'appui long (doigt), et figure dans le nom
 * accessible de chaque bouton. Cibles de 44 px.
 */

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { SANS_REACTION, type Reactions, type ValeurReaction } from '../../review/api';
import { rayonControle, type EtatPresse } from '../design';
import { tr } from '../../i18n';

const noms = (liste: Reactions['qui']['like']) => liste.map(p => p.pseudo ?? tr('resumes.compte_supprime')).join(', ');

export function BoutonsReaction({
  theme,
  reactions = SANS_REACTION,
  peutReagir,
  onReagir,
  testID,
  compact,
}: {
  theme: ThemeHub;
  reactions?: Reactions;
  peutReagir: boolean;
  onReagir(valeur: ValeurReaction | null): void;
  testID: string;
  compact?: boolean;
}) {
  const [qui, setQui] = useState(false);
  const bouton = (v: ValeurReaction, glyphe: string, nom: string) => {
    const n = reactions[v];
    const moi = reactions.moi === v;
    const personnes = noms(reactions.qui[v]);
    return (
      <Pressable
        testID={`${testID}-${v}`}
        accessibilityRole="button"
        accessibilityState={{ selected: moi, disabled: !peutReagir }}
        aria-pressed={moi}
        accessibilityLabel={`${nom} : ${n}${personnes ? ` (${personnes})` : ''}${peutReagir ? (moi ? tr('review.reactions.appuyer_pour_retirer_votre') : '') : ''}`}
        accessibilityHint={peutReagir ? undefined : tr('review.reactions.vous_ne_pouvez_pas')}
        onPress={() => (peutReagir ? onReagir(moi ? null : v) : setQui(q => !q))}
        onLongPress={() => setQui(q => !q)}
        onHoverIn={() => setQui(true)}
        onHoverOut={() => setQui(false)}
        style={(etat: EtatPresse) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          minHeight: 44,
          minWidth: compact ? 56 : 64,
          paddingHorizontal: 10,
          borderWidth: 1,
          borderRadius: rayonControle(theme) === 999 ? 22 : rayonControle(theme),
          borderColor: moi ? theme.accent : etat.hovered || etat.focused ? theme.accent : theme.ligne,
          backgroundColor: moi ? teinteTransparente(theme.accent, 0.18) : etat.pressed ? teinteTransparente(theme.attenue, 0.16) : theme.surface,
          justifyContent: 'center',
        })}>
        <Text style={{ fontSize: 16 }} accessibilityElementsHidden importantForAccessibility="no">
          {glyphe}
        </Text>
        <Text testID={`${testID}-${v}-n`} style={{ color: theme.texte, fontWeight: moi ? '800' : '600', fontSize: 14, ...police(theme.policeChiffres) }}>
          {n}
        </Text>
      </Pressable>
    );
  };
  const listeLike = noms(reactions.qui.like);
  const listeDislike = noms(reactions.qui.dislike);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }} accessibilityLabel={tr('review.reactions.reactions')}>
        {bouton('like', '👍', tr('review.reactions.j_aime'))}
        {bouton('dislike', '👎', tr('review.reactions.je_n_aime_pas'))}
      </View>
      {qui && (listeLike || listeDislike) ? (
        <Text testID={`${testID}-qui`} style={{ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) }}>
          {[listeLike ? `👍 ${listeLike}` : '', listeDislike ? `👎 ${listeDislike}` : ''].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}
