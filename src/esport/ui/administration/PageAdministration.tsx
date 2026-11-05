/**
 * Page « Administration » de l'Esport : une seule entrée de navigation (barre latérale sur PC, barre du bas sur
 * téléphone) pour les pages d'administration du club, rangées en sous-onglets :
 *  - « Tickets » (Tickets Discord : tickets, statistiques, configuration ; tickets.voir ou tickets.configurer) ;
 *  - « Statistiques » (statistiques d'usage : Fondateur, ou statistiques.voir) ;
 *  - « Jeux » (profils de jeu, assistant IA : Fondateur, ou jeux.gerer) ;
 *  - « Rôles et permissions » (Fondateur, ou roles.gerer) ;
 *  - « Devblog » (brouillons, éditeur, publication automatique : Fondateur, ou devblog.gerer ; la lecture des
 *    devblogs reste pour tous via « Nouveautés » du Dashboard).
 * Un sous-onglet n'apparaît qu'avec sa permission (le serveur contrôle chaque requête, comme avant). Pastille rouge
 * du sous-onglet « Tickets » (et de l'entrée « Administration ») : tickets ouverts avec du nouveau pour le compte.
 * Les anciennes vues (« tickets », « statistiques », « jeux », Membres › Rôles et permissions) mènent ici : voir
 * `normaliserVue` dans RacineEsport.tsx.
 */

import React, { useState } from 'react';
import { View } from 'react-native';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import type { MoiTickets } from '../../tickets/api';
import { tr } from '../../i18n';
import { ESP, LARGEUR_CONTENU, Onglets } from '../design';
import { Jeux, PageDevblog, PageTickets, RolesPermissions, Statistiques } from '../differe';

export type SousOngletAdmin = 'tickets' | 'statistiques' | 'jeux' | 'roles' | 'devblog';

/** Ce que le compte peut ouvrir dans l'Administration (d'après GET /moi et GET /tickets/moi). */
export type DroitsAdministration = Partial<Record<SousOngletAdmin, boolean>>;

const ORDRE: readonly SousOngletAdmin[] = ['tickets', 'statistiques', 'jeux', 'roles', 'devblog'];

const LIBELLES: Record<SousOngletAdmin, { libelle(): string; description(): string }> = {
  tickets: { libelle: () => tr('administration.onglet_tickets'), description: () => tr('administration.onglet_tickets_description') },
  statistiques: { libelle: () => tr('administration.onglet_statistiques'), description: () => tr('administration.onglet_statistiques_description') },
  jeux: { libelle: () => tr('administration.onglet_jeux'), description: () => tr('administration.onglet_jeux_description') },
  roles: { libelle: () => tr('administration.onglet_roles'), description: () => tr('administration.onglet_roles_description') },
  devblog: { libelle: () => tr('administration.onglet_devblog'), description: () => tr('administration.onglet_devblog_description') },
};

/** Sous-onglets permis, dans l'ordre d'affichage. */
export const sousOngletsAdmin = (droits: DroitsAdministration): SousOngletAdmin[] => ORDRE.filter(o => Boolean(droits[o]));

/** L'entrée « Administration » n'apparaît qu'avec au moins une des permissions de ses sous-onglets. */
export const aAdministration = (droits: DroitsAdministration): boolean => sousOngletsAdmin(droits).length > 0;

export function PageAdministration({
  theme,
  client,
  large,
  droits,
  moiTickets,
  fondateur,
  nonLusTickets = 0,
  ongletInitial,
  onExporter,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  large: boolean;
  droits: DroitsAdministration;
  moiTickets?: MoiTickets;
  /** Fondateur : Administration de l'IA dans « Jeux ». */
  fondateur: boolean;
  /** Tickets ouverts avec du nouveau (pastille du sous-onglet « Tickets »). */
  nonLusTickets?: number;
  ongletInitial?: SousOngletAdmin;
  onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>;
}) {
  const permis = sousOngletsAdmin({ ...droits, tickets: Boolean(droits.tickets && moiTickets) });
  const [choix, setChoix] = useState<SousOngletAdmin | undefined>(ongletInitial);
  const onglet: SousOngletAdmin | undefined = choix && permis.includes(choix) ? choix : permis[0];
  return (
    <View style={{ flex: 1 }} testID="esport-administration">
      {permis.length > 1 ? (
        <View style={{ paddingHorizontal: large ? ESP.xxl : ESP.m, paddingTop: large ? ESP.l : ESP.s, maxWidth: LARGEUR_CONTENU + 2 * ESP.xxl, width: '100%', alignSelf: 'center' }}>
          <Onglets
            theme={theme}
            entrees={permis.map(o => ({
              id: o,
              libelle: LIBELLES[o].libelle(),
              description: LIBELLES[o].description(),
              pastille: o === 'tickets' && nonLusTickets > 0 ? nonLusTickets : undefined,
            }))}
            actif={onglet ?? ''}
            onChoisir={id => setChoix(id as SousOngletAdmin)}
            prefixe="esport-admin-onglet"
            testID="esport-admin-onglets"
            // Téléphone : la rangée défile (libellés entiers) plutôt que de couper « Rôles et permissions ».
            defilant={!large}
          />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        {onglet === 'tickets' && moiTickets ? (
          <PageTickets theme={theme} client={client} large={large} moi={moiTickets} onExporter={onExporter} />
        ) : onglet === 'statistiques' ? (
          <Statistiques theme={theme} client={client} large={large} onExporter={onExporter} />
        ) : onglet === 'jeux' ? (
          <Jeux theme={theme} client={client} large={large} fondateur={fondateur} />
        ) : onglet === 'roles' ? (
          <RolesPermissions theme={theme} client={client} large={large} />
        ) : onglet === 'devblog' ? (
          <PageDevblog theme={theme} client={client} large={large} />
        ) : null}
      </View>
    </View>
  );
}
