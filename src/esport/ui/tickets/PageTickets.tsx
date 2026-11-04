/**
 * Page « Tickets » de l'Esport (docs/esport/tickets.md) : les tickets Discord (tickets.voir, par catégorie), et la
 * Configuration (Fondateur, tickets.configurer). En tête : l'état de la connexion Discord (en direct, secours, hors
 * ligne). Tout est contrôlé par le serveur ; un onglet n'apparaît que si la permission est là.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { trTk } from '../../i18n/tickets';
import { apiTickets, type Connexion, type MoiTickets } from '../../tickets/api';
import { PageEsport } from '../CadreEsport';
import { EnTetePage, ESP, Onglets, Squelette, attenue } from '../design';
import { ConfigTickets, PastilleConnexion } from './ConfigTickets';

type OngletTk = 'tickets' | 'config';

export function PageTickets({ theme, client, large, moi }: { theme: ThemeHub; client: ClientEsport; large: boolean; moi: MoiTickets }) {
  const api = useMemo(() => apiTickets(client), [client]);
  const [onglet, setOnglet] = useState<OngletTk>(moi.configurer ? 'config' : 'tickets');
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
  const entrees = moi.configurer ? [{ id: 'config', libelle: trTk('onglet_config') }] : [];
  return (
    <PageEsport large={large} testID="esport-tickets">
      <EnTetePage theme={theme} large={large} titre={trTk('titre')} sous={trTk('sous')} />
      <View style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>{etat ? <PastilleConnexion theme={theme} connexion={etat.connexion} actif={etat.actif} /> : <Squelette theme={theme} lignes={1} />}</View>
      {entrees.length > 1 ? <Onglets theme={theme} prefixe="esport-tk-onglet" testID="esport-tk-onglets" actif={onglet} onChoisir={id => setOnglet(id as OngletTk)} entrees={entrees} /> : null}
      {onglet === 'config' && moi.configurer ? <ConfigTickets theme={theme} client={client} large={large} /> : null}
      {onglet === 'tickets' && moi.voir ? (
        <View style={{ gap: ESP.s }} testID="esport-tk-liste">
          <Text style={attenue(theme)}>{trTk('sous')}</Text>
        </View>
      ) : null}
    </PageEsport>
  );
}
