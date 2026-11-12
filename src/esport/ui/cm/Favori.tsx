/**
 * Étoile « favori » d'une carte CM (migration 0074) : personnelle (chaque compte a ses favoris), sur la tuile du tableau,
 * dans la fiche de la carte et dans le To do du Dashboard. Icône monochrome (jamais un emoji) ; interrupteur accessible.
 */

import React from 'react';
import { Pressable } from 'react-native';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { Icone } from '../../../ui/icones';
import { trCm } from '../../i18n/cm';
import type { EtatPresse } from '../design';

/** Couleur de l'étoile pleine (or lisible en thème clair comme sombre). */
export const couleurFavori = (theme: ThemeHub): string => (theme.sombre ? '#f5c542' : '#b7791f');

export function EtoileFavori({ theme, favori, titre, onBasculer, taille = 16, desactive = false, testID }: { theme: ThemeHub; favori: boolean; titre: string; onBasculer(): void; taille?: number; desactive?: boolean; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: favori, disabled: desactive }}
      accessibilityLabel={trCm('favori.libelle', { titre })}
      accessibilityHint={favori ? trCm('favori.retirer') : trCm('favori.ajouter')}
      disabled={desactive}
      onPress={onBasculer}
      hitSlop={8}
      style={(e: EtatPresse) => ({
        minWidth: 28,
        minHeight: 28,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
        backgroundColor: e.hovered || e.focused ? teinteTransparente(couleurFavori(theme), 0.16) : 'transparent',
        opacity: desactive ? 0.5 : 1,
      })}>
      <Icone nom="etoile" taille={taille} couleur={favori ? couleurFavori(theme) : theme.attenue} />
    </Pressable>
  );
}
