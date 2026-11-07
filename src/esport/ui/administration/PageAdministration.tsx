/**
 * Page « Administration » de l'Esport : une seule entrée de navigation (barre latérale sur PC, barre du bas sur
 * téléphone) pour les pages d'administration du club, rangées en sous-onglets :
 *  - « Statistiques » (statistiques d'usage : Fondateur, ou statistiques.voir) ;
 *  - « Jeux » (profils de jeu, assistant IA : Fondateur, ou jeux.gerer) ;
 *  - « Rôles et permissions » (Fondateur, ou roles.gerer) ;
 *  - « Bot Esport HQ » (tous les réglages du bot Discord réunis : Fondateur, ou tickets.configurer ; chaque section
 *    garde ses contrôles côté serveur et mène aux pages qui gardent les réglages) ;
 *  - « Devblog » (brouillons, éditeur, publication automatique : Fondateur, ou devblog.gerer ; la lecture des
 *    devblogs reste pour tous via « Nouveautés » du Dashboard).
 * Un sous-onglet n'apparaît qu'avec sa permission (le serveur contrôle chaque requête, comme avant). Les Tickets
 * Discord ont leur propre entrée « Tickets » de la navigation (avec la pastille des tickets non lus), hors de
 * l'Administration. Les anciennes vues (« statistiques », « jeux », Membres › Rôles et permissions) mènent ici, et
 * Administration › Tickets mène à l'entrée « Tickets » : voir `normaliserVue` dans RacineEsport.tsx.
 */

import React, { useState } from 'react';
import { View } from 'react-native';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { tr } from '../../i18n';
import { ESP, LARGEUR_CONTENU, Onglets } from '../design';
import { Jeux, PageBot, PageDevblog, RolesPermissions, Statistiques } from '../differe';
import type { NavigationBot } from '../bot/PageBot';

export type SousOngletAdmin = 'statistiques' | 'jeux' | 'roles' | 'bot' | 'devblog';

/** Ce que le compte peut ouvrir dans l'Administration (d'après GET /moi). */
export type DroitsAdministration = Partial<Record<SousOngletAdmin, boolean>>;

const ORDRE: readonly SousOngletAdmin[] = ['statistiques', 'jeux', 'roles', 'bot', 'devblog'];

const LIBELLES: Record<SousOngletAdmin, { libelle(): string; description(): string }> = {
  statistiques: { libelle: () => tr('administration.onglet_statistiques'), description: () => tr('administration.onglet_statistiques_description') },
  jeux: { libelle: () => tr('administration.onglet_jeux'), description: () => tr('administration.onglet_jeux_description') },
  roles: { libelle: () => tr('administration.onglet_roles'), description: () => tr('administration.onglet_roles_description') },
  bot: { libelle: () => tr('administration.onglet_bot'), description: () => tr('administration.onglet_bot_description') },
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
  fondateur,
  ongletInitial,
  onExporter,
  navigationBot,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  large: boolean;
  droits: DroitsAdministration;
  /** Fondateur : Administration de l'IA dans « Jeux ». */
  fondateur: boolean;
  ongletInitial?: SousOngletAdmin;
  onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>;
  /** Bot Esport HQ : liens vers les pages qui gardent les réglages (Tickets › Configuration, Discord d'une team). */
  navigationBot?: NavigationBot;
}) {
  const permis = sousOngletsAdmin(droits);
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
        {onglet === 'statistiques' ? (
          <Statistiques theme={theme} client={client} large={large} onExporter={onExporter} />
        ) : onglet === 'jeux' ? (
          <Jeux theme={theme} client={client} large={large} fondateur={fondateur} />
        ) : onglet === 'roles' ? (
          <RolesPermissions theme={theme} client={client} large={large} />
        ) : onglet === 'bot' ? (
          <PageBot theme={theme} client={client} large={large} navigation={navigationBot} />
        ) : onglet === 'devblog' ? (
          <PageDevblog theme={theme} client={client} large={large} />
        ) : null}
      </View>
    </View>
  );
}
