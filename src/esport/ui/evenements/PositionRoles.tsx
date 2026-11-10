/**
 * Choix du rôle repère d'un événement (Administration › Événements › Rôles Discord) : « placer les nouveaux rôles
 * juste en dessous du rôle… ». Les rôles du serveur sont listés dans l'ordre de la hiérarchie (le plus haut d'abord,
 * comme dans Paramètres du serveur › Rôles) ; ceux qui ne sont pas SOUS le rôle du bot (le sien compris) sont grisés
 * et expliqués : le bot ne peut placer des rôles que sous son propre rôle. Le serveur revérifie à l'enregistrement.
 */

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Avis, BoutonHub } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { trEv } from '../../i18n/evenements';
import type { RolesServeur } from '../../evenements/api';
import { ESP, attenue, texte } from '../design';

export function PositionRoles({
  theme,
  serveur,
  valeur,
  onChoisir,
  onLire,
  lecture,
}: {
  theme: ThemeHub;
  /** Rôles du serveur (undefined : pas encore lus). */
  serveur: RolesServeur | undefined;
  valeur: string | null;
  onChoisir(id: string | null): void;
  onLire(): void;
  lecture: boolean;
}) {
  const choisi = valeur ? serveur?.roles.find(r => r.id === valeur) : undefined;
  const option = (
    id: string | null,
    nom: string,
    opts: { couleur?: string | null; desactive?: boolean; note?: string } = {},
  ) => {
    const actif = valeur === id;
    return (
      <Pressable
        key={id ?? 'bas'}
        onPress={opts.desactive ? undefined : () => onChoisir(id)}
        disabled={opts.desactive}
        accessibilityRole="radio"
        accessibilityState={{
          checked: actif,
          disabled: Boolean(opts.desactive),
        }}
        accessibilityLabel={nom}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: ESP.xs,
          paddingVertical: 6,
          paddingHorizontal: ESP.xs,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: actif ? theme.accent : theme.ligne,
          opacity: opts.desactive ? 0.5 : 1,
        }}
        testID={`esport-ev-position-${id ?? 'bas'}`}
      >
        <View
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            borderWidth: 2,
            borderColor: actif ? theme.accent : theme.attenue,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {actif ? (
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: theme.accent,
              }}
            />
          ) : null}
        </View>
        {opts.couleur ? (
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: opts.couleur,
            }}
          />
        ) : null}
        <Text
          style={{ ...texte(theme), flex: 1, minWidth: 0 }}
          numberOfLines={1}
        >
          {nom}
        </Text>
        {opts.note ? <Text style={attenue(theme)}>{opts.note}</Text> : null}
      </Pressable>
    );
  };
  return (
    <View
      style={{ gap: ESP.xs }}
      testID="esport-ev-position"
      accessibilityRole="radiogroup"
    >
      <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>
        {trEv('position')}
      </Text>
      <Text style={attenue(theme)}>{trEv('position_aide')}</Text>
      {valeur ? (
        <Text style={attenue(theme)} testID="esport-ev-position-choisi">
          {trEv('position_choisi', {
            nom: choisi?.nom ?? trEv('position_inconnu', { id: valeur }),
          })}
        </Text>
      ) : null}
      {!serveur ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <BoutonHub
            theme={theme}
            titre={trEv('position_lire')}
            onPress={onLire}
            desactive={lecture}
            testID="esport-ev-position-lire"
          />
        </View>
      ) : serveur.erreur ? (
        <Avis
          theme={theme}
          genre="alerte"
          texte={trEv('position_erreur', { erreur: serveur.erreur })}
          testID="esport-ev-position-erreur"
        />
      ) : (
        <View style={{ gap: 4 }}>
          {serveur.roles.map(r =>
            option(r.id, r.nom, {
              couleur: r.couleur,
              desactive: !r.utilisable,
              note: r.bot
                ? trEv('position_bot')
                : !r.utilisable
                ? trEv('position_au_dessus')
                : undefined,
            }),
          )}
          {option(null, trEv('position_bas'))}
        </View>
      )}
    </View>
  );
}
