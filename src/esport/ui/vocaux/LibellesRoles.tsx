/**
 * Libellés courts de rôles pour le nom du salon du staff d'un hub d'événement (`{role}` du modèle « {role} — {pseudo} »,
 * docs/esport/vocaux.md) : un champ par rôle choisi, l'exemple montrant le libellé dérivé (nom du rôle sans le nom de
 * l'événement ni les symboles) utilisé quand le champ est vide. Rôles autorisés en plus d'un hub (fiche de l'événement),
 * rôles du staff des salons vocaux (Bot Esport HQ).
 */

import React from 'react';
import { Text, View } from 'react-native';
import { Champ } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { trVc } from '../../i18n/vocaux';
import { etiquetteRole } from '../../evenements/etiquette';
import { ESP, attenue } from '../design';

export function LibellesRoles({ theme, ids, noms, valeurs, onChanger, nomEvenement = '', testID }: { theme: ThemeHub; ids: string[]; noms: ReadonlyArray<{ id: string; nom: string }>; valeurs: Record<string, string>; onChanger(v: Record<string, string>): void; nomEvenement?: string; testID: string }) {
  if (!ids.length) return null;
  const nom = (id: string) => noms.find(n => n.id === id)?.nom ?? id;
  return (
    <View style={{ gap: ESP.xxs }} testID={testID}>
      <Text style={attenue(theme)}>{trVc('libelles_roles')}</Text>
      {ids.map(id => (
        <Champ
          key={id}
          theme={theme}
          libelle={nom(id)}
          valeur={valeurs[id] ?? ''}
          placeholder={etiquetteRole(nom(id), nomEvenement)}
          onChanger={v => {
            const suivant = { ...valeurs };
            if (v.trim()) suivant[id] = v;
            else delete suivant[id];
            onChanger(suivant);
          }}
          maxLength={40}
          testID={`${testID}-${id}`}
        />
      ))}
    </View>
  );
}
