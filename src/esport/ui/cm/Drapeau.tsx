/**
 * Drapeau d'urgence d'une carte (docs/esport/cm.md, « Urgences ») : icône drapeau monochrome colorée par niveau
 * (couleurs de contraste AA en thème clair et sombre), et sélecteur rapide à cinq choix (aucun, faible, moyen, urgent,
 * critique). La couleur n'est jamais seule : chaque niveau a son libellé (lecteurs d'écran, infobulle, sélecteur).
 */

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Segments } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { Urgence } from '../../cm/api';
import { NIVEAUX_URGENCE, cleLibelleUrgence, couleurUrgence } from '../../cm/urgence';
import { trCm } from '../../i18n/cm';
import { Icone } from '../../../ui/icones';
import { ESP, texte, type EtatPresse } from '../design';

export const libelleUrgence = (n: Urgence | null | undefined): string => (n ? trCm(cleLibelleUrgence(n)) : trCm('urgence.aucune'));

/** Drapeau seul (décoratif : le libellé est porté par le parent, ou par `libelle` quand il est isolé). */
export function Drapeau({ theme, niveau, taille = 15, libelle, testID }: { theme: ThemeHub; niveau: Urgence; taille?: number; libelle?: boolean; testID?: string }) {
  return (
    <View testID={testID} style={{ width: taille + 2, height: taille + 2, alignItems: 'center', justifyContent: 'center' }} {...({ title: trCm('urgence.carte', { niveau: libelleUrgence(niveau) }) } as object)}>
      <Icone nom="drapeau" taille={taille} couleur={couleurUrgence(niveau, theme.sombre)} libelle={libelle ? trCm('urgence.carte', { niveau: libelleUrgence(niveau) }) : undefined} />
    </View>
  );
}

/** Sélecteur rapide du niveau (fiche de la carte, volet du menu ⋯). `editer` faux : lecture seule du niveau actuel. */
export function SelecteurUrgence({ theme, valeur, editer, onChoisir, testID = 'esport-cm-urgence' }: { theme: ThemeHub; valeur: Urgence | null | undefined; editer: boolean; onChoisir(n: Urgence | null): void; testID?: string }) {
  const options: Array<Urgence | null> = [null, ...NIVEAUX_URGENCE];
  if (!editer && !valeur) return null;
  return (
    <View style={{ gap: ESP.xs }} testID={testID}>
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trCm('urgence.regler')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }} accessibilityRole="radiogroup" accessibilityLabel={trCm('urgence.regler')}>
        {options.map(n => {
          if (!editer && n !== (valeur ?? null)) return null;
          const actif = (valeur ?? null) === n;
          const couleur = n ? couleurUrgence(n, theme.sombre) : theme.attenue;
          return (
            <Pressable
              key={n ?? 'aucune'}
              disabled={!editer}
              testID={`${testID}-${n ?? 'aucune'}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: actif, disabled: !editer }}
              accessibilityLabel={libelleUrgence(n)}
              onPress={() => onChoisir(n)}
              style={(e: EtatPresse) => ({
                minHeight: 44,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 12,
                borderRadius: 10,
                borderWidth: actif ? 2 : 1,
                borderColor: actif ? couleur : theme.ligne,
                backgroundColor: actif ? teinteTransparente(couleur, 0.14) : e.hovered || e.focused ? teinteTransparente(theme.attenue, 0.12) : theme.surface,
              })}>
              {n ? <Icone nom="drapeau" taille={16} couleur={couleur} /> : null}
              <Text style={{ ...texte(theme, 13), fontWeight: actif ? '700' : '500' }}>{libelleUrgence(n)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Valeur d'un filtre d'urgence à choix unique ('' : toutes). */
export type FiltreUrgence = Urgence | 'aucune' | '';

/** La carte passe-t-elle le filtre d'urgence ? */
export const passeFiltreUrgence = (filtre: FiltreUrgence, urgence: Urgence | null | undefined): boolean => !filtre || (urgence ?? 'aucune') === filtre;

/** Filtre par niveau (À valider, calendrier éditorial) : un seul niveau à la fois. */
export function FiltreUrgenceCm({ theme, valeur, onChoisir, testID }: { theme: ThemeHub; valeur: FiltreUrgence; onChoisir(v: FiltreUrgence): void; testID: string }) {
  return (
    <Segments
      theme={theme}
      libelle={trCm('urgence.filtre')}
      valeur={valeur}
      options={[
        ['', trCm('filtres.echeance.toutes')],
        ...([...NIVEAUX_URGENCE].reverse().map(n => [n, libelleUrgence(n)]) as Array<[FiltreUrgence, string]>),
        ['aucune', trCm('urgence.filtre_aucune')],
      ]}
      onChoisir={v => onChoisir(v as FiltreUrgence)}
      testID={testID}
    />
  );
}
