/**
 * Page « Tickets » de l'Esport (docs/esport/tickets.md) : les tickets Discord (tickets.voir, par catégorie), et la
 * Configuration (Fondateur, tickets.configurer). En tête : l'état de la connexion Discord (en direct, secours, hors
 * ligne). Tout est contrôlé par le serveur ; un onglet n'apparaît que si la permission est là.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { trTk } from '../../i18n/tickets';
import { apiTickets, type Connexion, type MoiTickets } from '../../tickets/api';
import { PageEsport } from '../CadreEsport';
import { EnTetePage, Onglets, Squelette } from '../design';
import { ConfigTickets, PastilleConnexion } from './ConfigTickets';
import { ListeTickets, StatsTicketsPage } from './TicketsStaff';

type OngletTk = 'tickets' | 'stats' | 'config';

export function PageTickets({ theme, client, large, moi, onExporter }: { theme: ThemeHub; client: ClientEsport; large: boolean; moi: MoiTickets; onExporter?(nom: string, contenu: string, type?: string): Promise<boolean> }) {
  const api = useMemo(() => apiTickets(client), [client]);
  const [onglet, setOnglet] = useState<OngletTk>(moi.voir ? 'tickets' : 'config');
  const [etat, setEtat] = useState<{ actif: boolean; connexion: Connexion } | undefined>();
  const relireEtat = useCallback(() => {
    api
      .etat()
      .then(setEtat)
      .catch(() => undefined);
  }, [api]);
  useEffect(() => {
    relireEtat();
    // L'état de la connexion change rarement : relu toutes les minutes tant que la page est ouverte.
    const id = setInterval(relireEtat, 60_000);
    return () => clearInterval(id);
  }, [relireEtat]);
  const entrees = [...(moi.voir ? [{ id: 'tickets', libelle: trTk('onglet_tickets') }] : []), ...(moi.gerer ? [{ id: 'stats', libelle: trTk('onglet_stats') }] : []), ...(moi.configurer ? [{ id: 'config', libelle: trTk('onglet_config') }] : [])];
  return (
    <PageEsport large={large} testID="esport-tickets">
      <EnTetePage theme={theme} large={large} titre={trTk('titre')} sous={trTk('sous')} />
      <View style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>{etat ? <PastilleConnexion theme={theme} connexion={etat.connexion} actif={etat.actif} /> : <Squelette theme={theme} lignes={1} />}</View>
      {entrees.length > 1 ? <Onglets theme={theme} prefixe="esport-tk-onglet" testID="esport-tk-onglets" actif={onglet} onChoisir={id => setOnglet(id as OngletTk)} entrees={entrees} /> : null}
      {onglet === 'config' && moi.configurer ? <ConfigTickets theme={theme} client={client} large={large} /> : null}
      {onglet === 'tickets' && moi.voir ? <ListeTickets theme={theme} client={client} large={large} onExporter={onExporter} /> : null}
      {onglet === 'stats' && moi.gerer ? <StatsTicketsPage theme={theme} client={client} /> : null}
    </PageEsport>
  );
}
