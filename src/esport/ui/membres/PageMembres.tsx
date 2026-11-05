/**
 * Page « Membres » de l'Esport : deux sous-onglets.
 *  - « Trombinoscope » (affiché en premier) : les fiches des joueurs pour le CM et le staff (photo, teams et
 *    jeu, postes, elo, palmarès, anciennes structures, réseaux) ; voir Trombinoscope.tsx ;
 *  - « Tous les membres » : la liste de tous les comptes, création, invitations, rôles (MembresGlobal.tsx, inchangée).
 * « Rôles et permissions » est dans l'Administration (ui/administration/PageAdministration.tsx) ; l'ancien lien
 * Membres › Rôles et permissions y mène (normaliserVue, RacineEsport.tsx).
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
import { Trombinoscope } from '../differe';

export type SousOngletMembres = 'trombi' | 'tous';

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
}) {
  const [onglet, setOnglet] = useState<SousOngletMembres>(ongletInitial);
  return (
    <View style={{ flex: 1 }} testID="esport-membres">
      <View style={{ paddingHorizontal: large ? ESP.xxl : ESP.m, paddingTop: large ? ESP.l : ESP.s, maxWidth: LARGEUR_CONTENU + 2 * ESP.xxl, width: '100%', alignSelf: 'center' }}>
        <Onglets
          theme={theme}
          entrees={[
            { id: 'trombi', libelle: trTb('onglet.trombi'), description: trTb('onglet.trombi_description') },
            { id: 'tous', libelle: trTb('onglet.tous'), description: trTb('onglet.tous_description') },
          ]}
          actif={onglet}
          onChoisir={id => setOnglet(id as SousOngletMembres)}
          prefixe="esport-membres-onglet"
          testID="esport-membres-onglets"
          pleineLargeur={!large}
        />
      </View>
      <View style={{ flex: 1 }}>
        {onglet === 'trombi' ? (
          <Trombinoscope theme={theme} client={client} large={large} onExporter={onExporter} />
        ) : (
          <MembresGlobal theme={theme} client={client} contexte={contexte} registre={registre} large={large} onOuvrirTeam={onOuvrirTeam} onOuvrirApp={onOuvrirApp} />
        )}
      </View>
    </View>
  );
}
