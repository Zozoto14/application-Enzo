/**
 * Page « Membres » de l'Esport : deux sous-onglets.
 *  - « Trombinoscope » (affiché en premier) : les fiches des joueurs pour le CM et le staff (photo, teams et
 *    jeu, postes, elo, palmarès, anciennes structures, réseaux) ; voir Trombinoscope.tsx ;
 *  - « Tous les membres » : la liste de tous les comptes, création, invitations, rôles (MembresGlobal.tsx, inchangée).
 *  - « Rôles et permissions » (Fondateur, ou permission du club roles.gerer, migration 0033) : RolesPermissions.tsx.
 * Sur téléphone, rien de nouveau dans la barre du bas : ce sont des onglets de la page Membres.
 */

import React, { useState } from 'react';
import { View } from 'react-native';
import type { ThemeHub } from '../../../hub/themes';
import type { AppHub, ContexteHub } from '../../../hub/types';
import type { ClientEsport } from '../../client';
import { trTb } from '../../i18n/trombi';
import { ESP, LARGEUR_CONTENU, Onglets } from '../design';
import { MembresGlobal } from '../MembresGlobal';
import { RolesPermissions, Trombinoscope } from '../differe';
import { trRp } from '../../i18n/roles';

export type SousOngletMembres = 'trombi' | 'tous' | 'roles';

export function PageMembres({
  theme,
  client,
  contexte,
  registre,
  large,
  ongletInitial = 'trombi',
  onOuvrirTeam,
  onOuvrirApp,
  onExporter,
  rolesPermissions = false,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  contexte: ContexteHub;
  registre: readonly AppHub[];
  large: boolean;
  ongletInitial?: SousOngletMembres;
  onOuvrirTeam(teamId: string): void;
  onOuvrirApp?(id: string): void;
  onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>;
  /** Onglet « Rôles et permissions » : Fondateur, ou permission du club roles.gerer. */
  rolesPermissions?: boolean;
}) {
  const [choix, setOnglet] = useState<SousOngletMembres>(ongletInitial);
  const onglet: SousOngletMembres = choix === 'roles' && !rolesPermissions ? 'trombi' : choix;
  return (
    <View style={{ flex: 1 }} testID="esport-membres">
      <View style={{ paddingHorizontal: large ? ESP.xxl : ESP.m, paddingTop: large ? ESP.l : ESP.s, maxWidth: LARGEUR_CONTENU + 2 * ESP.xxl, width: '100%', alignSelf: 'center' }}>
        <Onglets
          theme={theme}
          entrees={[
            { id: 'trombi', libelle: trTb('onglet.trombi'), description: trTb('onglet.trombi_description') },
            { id: 'tous', libelle: trTb('onglet.tous'), description: trTb('onglet.tous_description') },
            ...(rolesPermissions ? [{ id: 'roles', libelle: trRp('onglet.roles'), description: trRp('onglet.roles_description') }] : []),
          ]}
          actif={onglet}
          onChoisir={id => setOnglet(id as SousOngletMembres)}
          prefixe="esport-membres-onglet"
          testID="esport-membres-onglets"
          // Trois onglets sur téléphone : la rangée défile (libellés entiers) plutôt que de couper « Rôles et permissions ».
          pleineLargeur={!large && !rolesPermissions}
          defilant={!large && rolesPermissions}
        />
      </View>
      <View style={{ flex: 1 }}>
        {onglet === 'trombi' ? (
          <Trombinoscope theme={theme} client={client} large={large} onExporter={onExporter} />
        ) : onglet === 'roles' ? (
          <RolesPermissions theme={theme} client={client} large={large} />
        ) : (
          <MembresGlobal theme={theme} client={client} contexte={contexte} registre={registre} large={large} onOuvrirTeam={onOuvrirTeam} onOuvrirApp={onOuvrirApp} />
        )}
      </View>
    </View>
  );
}
