/**
 * Réunions de l'équipe CM : petits éléments partagés (pastille de statut, réponse, choix en boutons, dates lisibles).
 */

import React from 'react';
import { Text, View } from 'react-native';
import { BoutonHub } from '../../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../../hub/themes';
import type { Reponse, Statut } from '../../../cm/reunions';
import { formaterDate } from '../../../i18n';
import { trRe, type CleRe } from '../../../i18n/reunions';
import { attenue, Badge, ESP, texte, type Ton } from '../../design';

export const nomStatut = (s: Statut): string => trRe(`statut.${s}` as CleRe);
export const nomReponse = (r: Reponse): string => trRe(`reponse.${r}` as CleRe);
export const TON_REPONSE: Record<Reponse, Ton> = { attente: 'alerte', accepte: 'ok', peut_etre: 'neutre', refuse: 'critique', propose: 'accent' };

export function couleurStatut(theme: ThemeHub, s: Statut): string {
  return s === 'disponible' ? theme.ok : s === 'occupe' ? theme.alerte : s === 'ne_pas_deranger' ? theme.critique : theme.attenue;
}

/** Point coloré du statut du moment (comme Teams), avec son nom lisible. */
export function PastilleStatut({ theme, statut, taille = 10, testID }: { theme: ThemeHub; statut: Statut; taille?: number; testID?: string }) {
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={nomStatut(statut)}
      style={{ width: taille, height: taille, borderRadius: taille / 2, backgroundColor: couleurStatut(theme, statut), borderWidth: statut === 'absent' ? 2 : 0, borderColor: theme.attenue }}
    />
  );
}

export function BadgeReponse({ theme, reponse, testID }: { theme: ThemeHub; reponse: Reponse; testID?: string }) {
  return <Badge theme={theme} ton={TON_REPONSE[reponse]} texte={nomReponse(reponse)} testID={testID} />;
}

/** Choix exclusif en boutons (le choisi est « plein »), avec groupe radio accessible. */
export function ChoixBoutons<T extends string>({ theme, libelle, valeur, options, onChoisir, testID }: { theme: ThemeHub; libelle: string; valeur: T; options: ReadonlyArray<readonly [NoInfer<T>, string]>; onChoisir(v: NoInfer<T>): void; testID: string }) {
  return (
    <View style={{ gap: ESP.xxs }}>
      {libelle ? <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{libelle}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }} accessibilityRole="radiogroup" accessibilityLabel={libelle || undefined}>
        {options.map(([cle, t]) => (
          <BoutonHub key={cle} theme={theme} titre={t} variante={valeur === cle ? 'plein' : 'normal'} onPress={() => onChoisir(cle)} testID={`${testID}-${cle}`} />
        ))}
      </View>
    </View>
  );
}

/** « mar. 20 oct. » d'une date AAAA-MM-JJ. */
export const jourCourt = (date: string): string => formaterDate(`${date}T12:00:00Z`, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
/** « mardi 20 octobre » d'une date AAAA-MM-JJ. */
export const jourLong = (date: string): string => formaterDate(`${date}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
/** Date et heure d'un instant dans un fuseau. */
export const quandDans = (isoTexte: string, fuseau: string): string => formaterDate(isoTexte, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: fuseau });

export function Ligne({ theme, children, testID }: { theme: ThemeHub; children: string; testID?: string }) {
  return (
    <Text style={attenue(theme, 13)} testID={testID}>
      {children}
    </Text>
  );
}
