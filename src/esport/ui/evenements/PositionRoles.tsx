/**
 * Choix du rôle repère d'un événement (Administration › Événements › Rôles Discord) : « placer les nouveaux rôles
 * juste en dessous du rôle… ». Les rôles du serveur sont listés dans l'ordre de la hiérarchie (le plus haut d'abord,
 * comme dans Paramètres du serveur › Rôles) ; ceux qui ne sont pas SOUS le rôle du bot (le sien compris) sont grisés
 * et expliqués : le bot ne peut placer des rôles que sous son propre rôle. Le serveur revérifie à l'enregistrement.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { Avis, BoutonHub } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { trEv } from '../../i18n/evenements';
import type { RolesServeur } from '../../evenements/api';
import { ESP, attenue } from '../design';
import { SelecteurRepliable } from '../../../ui/selecteurs/SelecteurRepliable';

/** « Tout en bas » de la hiérarchie (pas de rôle repère). */
const BAS = 'bas';

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
  return (
    <View
      style={{ gap: ESP.xs }}
      testID="esport-ev-position"
    >
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
        <SelecteurRepliable
          theme={theme}
          nature="role"
          libelle={trEv('position')}
          valeur={valeur ?? BAS}
          options={[
            ...serveur.roles.map(r => ({
              id: r.id,
              nom: r.nom,
              couleur: r.couleur,
              desactive: !r.utilisable,
              detail: r.bot ? trEv('position_bot') : !r.utilisable ? trEv('position_au_dessus') : undefined,
            })),
            { id: BAS, nom: trEv('position_bas') },
          ]}
          onChoisir={id => onChoisir(id === BAS ? null : id)}
          testID="esport-ev-position"
        />
      )}
    </View>
  );
}
