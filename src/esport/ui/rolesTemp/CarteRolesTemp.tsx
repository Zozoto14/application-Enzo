/**
 * Administration › Bot Esport HQ › Fonctionnalités › Rôles temporaires (carte du registre src/esport/ui/bot/sections.ts) :
 * vue d'ensemble des teams (rôle, durée, personnes qui l'ont) avec accès à leurs réglages (page de la team › Discord),
 * et commandes /role-temp (activées ou non, réservées à des rôles Discord du serveur du club).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Interrupteur } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { trRt, type CleRt } from '../../i18n/rolesTemp';
import { apiRolesTempClub, type CommandesRolesTemp, type ConfigRolesTempClub, type ServeurRolesTemp } from '../../rolesTemp/api';
import { Intertitre, Panneau, Retours, styles, useAgir } from '../commun';
import { ESP, Squelette, attenue, texte } from '../design';
import { ChoixMultiple } from '../tickets/ConfigTickets';
import type { ContexteBot } from '../bot/sections';
import { dureeH } from './outils';

export function ReglagesRolesTempClub(ctx: ContexteBot) {
  return <CarteRolesTemp theme={ctx.theme} client={ctx.client} ouvrirTeam={ctx.ouvrirTeam} />;
}

export function CarteRolesTemp({ theme, client, ouvrirTeam }: { theme: ThemeHub; client: ClientEsport; ouvrirTeam?(teamId: string, section?: string): void }) {
  const api = useMemo(() => apiRolesTempClub(client), [client]);
  const [conf, setConf] = useState<ConfigRolesTempClub | undefined>();
  const [cmd, setCmd] = useState<CommandesRolesTemp>({});
  const [serveur, setServeur] = useState<ServeurRolesTemp | undefined>();
  const { erreur, avis, agir, enCours } = useAgir();
  const recevoir = useCallback((c: ConfigRolesTempClub) => {
    setConf(c);
    setCmd(c.commandes);
  }, []);
  useEffect(() => {
    void agir('charger', async () => {
      recevoir(await api.config());
      setServeur(await api.discord().catch(() => undefined));
    });
  }, [agir, api, recevoir]);
  if (!conf) return <Squelette theme={theme} lignes={4} testID="esport-rtc-chargement" />;
  const roles = (serveur?.roles ?? []).map(x => ({ id: x.id, nom: x.nom, couleur: x.couleur }));
  return (
    <View style={{ gap: ESP.m }} testID="esport-rtc">
      <Text style={attenue(theme)}>{trRt('club_aide')}</Text>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-rtc" />
      <Panneau theme={theme} testID="esport-rtc-teams">
        <Intertitre theme={theme}>{trRt('club_teams')}</Intertitre>
        {!conf.equipes.length ? <Text style={attenue(theme)}>{trRt('club_vide')}</Text> : null}
        {conf.equipes.map(e => (
          <View key={e.id} style={[styles.ligne, { justifyContent: 'space-between' }]} testID={`esport-rtc-equipe-${e.id}`}>
            <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trRt('club_ligne', { nom: e.nom, etat: e.actif ? trRt('club_actif', { role: e.roleNom, duree: dureeH(e.dureeDefautH), n: e.actifs }) : trRt('club_inactif') })}</Text>
            {ouvrirTeam ? <BoutonHub theme={theme} titre={trRt('club_regler')} onPress={() => ouvrirTeam(e.id, 'module:discord')} testID={`esport-rtc-regler-${e.id}`} /> : null}
          </View>
        ))}
      </Panneau>
      <Panneau theme={theme} testID="esport-rtc-commandes">
        <Intertitre theme={theme}>{trRt('club_commandes')}</Intertitre>
        <Text style={attenue(theme)}>{trRt('club_commandes_aide')}</Text>
        {conf.choix.commandes.map(nom => (
          <View key={nom} style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-rtc-cmd-${nom}`}>
            <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
              <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trRt(`cmd.${nom}` as CleRt)}</Text>
              <Interrupteur theme={theme} libelle={trRt(`cmd.${nom}` as CleRt)} valeur={cmd[nom]?.actif !== false} onChanger={actif => setCmd({ ...cmd, [nom]: { roles: cmd[nom]?.roles ?? [], actif } })} testID={`esport-rtc-cmd-${nom}-actif`} />
            </View>
            {roles.length && cmd[nom]?.actif !== false ? <ChoixMultiple theme={theme} libelle={trRt('commande_roles')} valeurs={cmd[nom]?.roles ?? []} options={roles} onChanger={x => setCmd({ ...cmd, [nom]: { actif: true, roles: x } })} max={conf.choix.limites.roles} testID={`esport-rtc-cmd-${nom}-roles`} /> : null}
          </View>
        ))}
        <BoutonHub theme={theme} variante="plein" titre={trRt('enregistrer')} onPress={() => void agir('commandes', async () => (recevoir(await api.changerCommandes(cmd)), trRt('commandes_enregistrees')))} desactive={enCours === 'commandes'} testID="esport-rtc-cmd-enregistrer" />
      </Panneau>
    </View>
  );
}
