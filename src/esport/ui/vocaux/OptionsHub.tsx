/**
 * Options de chaque hub des salons vocaux temporaires (docs/esport/vocaux.md, « Options de chaque hub »), communes aux
 * hubs ordinaires (Bot Esport HQ › Salons vocaux) et aux hubs d'événement (Événements › Vocaux de l'événement) :
 * placer les salons créés juste sous le hub, salons verrouillés visibles mais pas joignables, hub caché aux personnes
 * sans permission (hub ordinaire : « Rôles qui peuvent utiliser ce hub », exigés pour le cacher).
 */

import React from 'react';
import { Text, View } from 'react-native';
import { Interrupteur } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { trVc } from '../../i18n/vocaux';
import type { Hub } from '../../vocaux/api';
import { styles } from '../commun';
import { ESP, attenue, texte } from '../design';
import { ChoixMultiple } from '../tickets/ConfigTickets';
import type { OptionSelecteur } from '../../../ui/selecteurs/SelecteurRepliable';

function Option({ theme, libelle, aide, valeur, onChanger, desactive, testID }: { theme: ThemeHub; libelle: string; aide?: string; valeur: boolean; onChanger(v: boolean): void; desactive?: boolean; testID: string }) {
  return (
    <View style={{ gap: 2 }}>
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{libelle}</Text>
        <Interrupteur theme={theme} libelle={libelle} valeur={valeur} onChanger={onChanger} desactive={desactive} testID={testID} />
      </View>
      {aide ? <Text style={attenue(theme)}>{aide}</Text> : null}
    </View>
  );
}

export function OptionsHub({ theme, hub, onChanger, evenement, roles, max, testID }: { theme: ThemeHub; hub: Hub; onChanger(m: Partial<Hub>): void; evenement: boolean; roles: readonly OptionSelecteur[]; max: number; testID: string }) {
  const rolesHub = hub.rolesHub ?? [];
  const masquer = hub.masquerHub ?? evenement;
  const sansRoles = !evenement && !rolesHub.length;
  return (
    <View style={{ gap: ESP.xs }} testID={testID}>
      <Option theme={theme} libelle={trVc('opt_placer')} aide={trVc('opt_placer_aide')} valeur={hub.placerSousHub !== false} onChanger={placerSousHub => onChanger({ placerSousHub })} testID={`${testID}-placer`} />
      <Option theme={theme} libelle={trVc('opt_visible')} aide={trVc('opt_visible_aide')} valeur={hub.visibleNonJoignable === true} onChanger={visibleNonJoignable => onChanger({ visibleNonJoignable })} testID={`${testID}-visible`} />
      {evenement ? null : roles.length ? <ChoixMultiple theme={theme} libelle={trVc('opt_roles_hub')} valeurs={rolesHub} options={roles} onChanger={x => onChanger({ rolesHub: x, ...(x.length ? {} : { masquerHub: false }) })} max={max} testID={`${testID}-roles-hub`} /> : null}
      <Option theme={theme} libelle={trVc('opt_masquer')} aide={sansRoles ? trVc('opt_masquer_sans_roles') : trVc(evenement ? 'opt_masquer_aide_evenement' : 'opt_masquer_aide')} valeur={masquer && !sansRoles} desactive={sansRoles} onChanger={masquerHub => onChanger({ masquerHub })} testID={`${testID}-masquer`} />
    </View>
  );
}
