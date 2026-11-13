/**
 * Bloc « Lineups liés » d'une strat (liste des strats) : les lineups rattachés à la strat, avec leur étape ; lier un
 * lineup de la team (ceux de la même map d'abord), le détacher, ouvrir sa fiche dans l'onglet Lineups.
 *
 * Lecture : `GET /teams/:t/strats/:id/lineups` (la même que l'éditeur de strats peut utiliser).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { Icone } from '../../../ui/icones';
import { SelecteurRepliable } from '../../../ui/selecteurs/SelecteurRepliable';
import type { ClientEsport } from '../../client';
import { trLu } from '../../i18n/lineups';
import { apiLineups, type DroitsLineups, type Lineup } from '../../lineups/api';
import { demanderLineup } from '../../lineups/intention';
import type { Assets } from '../../strats/assets';
import { useTempsReel } from '../../tempsReel/hooks';
import { Retours, useAgir } from '../commun';
import { ESP, attenue, texte } from '../design';
import { LigneLineup } from './Lineups';

export function LineupsLies({ theme, client, teamId, strat, assets, onOuvrirLineups }: { theme: ThemeHub; client: ClientEsport; teamId: string; strat: { id: string; titre: string; carte: { cle: string } }; assets: Assets | undefined; /** Aller à l'onglet Lineups (la fiche demandée s'y ouvre). */ onOuvrirLineups(): void }) {
  const api = useMemo(() => apiLineups(client), [client]);
  const [lies, setLies] = useState<Lineup[] | undefined>();
  const [droits, setDroits] = useState<DroitsLineups>({ proposer: false, gerer: false, lier: false });
  const [ajout, setAjout] = useState(false);
  const [tous, setTous] = useState<Lineup[] | undefined>();
  const [choix, setChoix] = useState<string | undefined>();
  const [etape, setEtape] = useState('');
  const { enCours, erreur, agir } = useAgir();
  const charger = useCallback(async () => {
    const r = await api.deStrat(teamId, strat.id);
    setLies(r.lineups);
    setDroits(r.droits);
  }, [api, teamId, strat.id]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  useTempsReel(client, [`team:${teamId}:lineups`], () => void charger().catch(() => undefined));
  useEffect(() => {
    if (!ajout || tous) return;
    let vivant = true;
    api.liste(teamId).then(l => vivant && setTous(l.lineups), () => vivant && setTous([]));
    return () => {
      vivant = false;
    };
  }, [ajout, tous, api, teamId]);

  const dejaLies = new Set((lies ?? []).map(l => l.id));
  // Les lineups de la map de la strat d'abord.
  const options = (tous ?? [])
    .filter(l => !dejaLies.has(l.id))
    .sort((a, b) => Number(b.carte.cle === strat.carte.cle) - Number(a.carte.cle === strat.carte.cle) || a.titre.localeCompare(b.titre))
    .map(l => ({ id: l.id, nom: l.titre, detail: [l.carte.nom, l.capacite?.nom].filter(Boolean).join(' · '), groupe: l.carte.nom }));
  const ouvrir = (id: string) => {
    demanderLineup(id);
    onOuvrirLineups();
  };
  return (
    <View testID={`esport-strat-lineups-${strat.id}`} style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }}>
      <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{trLu('lies.titre')}</Text>
      {lies?.length === 0 ? <Text style={attenue(theme, 12)}>{trLu('lies.aucun')}</Text> : null}
      {lies?.map(l => (
        <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <LigneLineup theme={theme} lineup={l} assets={assets} onPress={() => ouvrir(l.id)} testID={`esport-strat-lineup-${l.id}`} />
          </View>
          {l.etape ? <Text style={attenue(theme, 12)}>{trLu('strats.etape', { n: l.etape })}</Text> : null}
          {droits.lier ? (
            <Pressable
              testID={`esport-strat-lineup-detacher-${l.id}`}
              accessibilityRole="button"
              accessibilityLabel={trLu('lies.detacher', { titre: l.titre })}
              disabled={Boolean(enCours)}
              onPress={() =>
                void agir('lien', async () => {
                  await api.delierStrat(teamId, l.id, strat.id);
                  await charger();
                })
              }
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Icone nom="croix" taille={16} couleur={theme.attenue} />
            </Pressable>
          ) : null}
        </View>
      ))}
      {droits.lier && !ajout ? (
        <View style={{ flexDirection: 'row' }}>
          <BoutonHub theme={theme} titre={trLu('lies.ajouter')} icone="lien" onPress={() => setAjout(true)} testID={`esport-strat-lineups-ajouter-${strat.id}`} />
        </View>
      ) : null}
      {droits.lier && ajout ? (
        <View style={{ gap: ESP.xs }}>
          <SelecteurRepliable theme={theme} libelle={trLu('lies.choisir')} options={options} valeur={choix} onChoisir={setChoix} ouvertParDefaut testID={`esport-strat-lineups-choix-${strat.id}`} />
          <View style={{ flexDirection: 'row', gap: ESP.xs, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Champ theme={theme} libelle={trLu('strats.etape.champ')} valeur={etape} onChanger={v => setEtape(v.replace(/\D/g, '').slice(0, 2))} clavier="number-pad" maxLength={2} style={{ width: 140 }} testID={`esport-strat-lineups-etape-${strat.id}`} />
            <BoutonHub
              theme={theme}
              titre={trLu('strats.lier.ok')}
              variante="plein"
              desactive={!choix || Boolean(enCours)}
              onPress={() =>
                void agir('lien', async () => {
                  const n = Number(etape);
                  await api.lierStrat(teamId, choix as string, strat.id, etape && n >= 1 && n <= 20 ? n : null);
                  setChoix(undefined);
                  setEtape('');
                  setAjout(false);
                  await charger();
                })
              }
              testID={`esport-strat-lineups-lier-${strat.id}`}
            />
            <BoutonHub theme={theme} titre={trLu('fermer')} onPress={() => setAjout(false)} testID={`esport-strat-lineups-fermer-${strat.id}`} />
          </View>
        </View>
      ) : null}
      <Retours theme={theme} erreur={erreur} prefixe="esport-strat-lineups" />
    </View>
  );
}
