/**
 * Présence : mes réponses à venir (RSVP rapide), présences à marquer (staff),
 * statistiques par joueur, par type d'événement et par période, export CSV.
 *
 * Taux = (présent + en retard) / (marqués − excusés) ; un excusé ne compte ni
 * pour ni contre, un événement non marqué n'entre pas dans le taux.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Segments } from '../../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { apiPlanning, type CompteurPresence, type Occurrence, type StatsPresence, type TypeEvenement } from '../../planning/api';
import { TYPES_EVENEMENT, ajouterJours, aujourdhui, dateCourteJour, pourcentage, typeEvenement } from '../../planning/libelles';
import { Retours, TitreSection, styles, useAgir, Intertitre, Panneau } from '../commun';
import type { PropsModule } from '../modules';
import { CarteOccurrence, Pastille } from './commun';
import { ListePresence } from './ListePresence';

type Periode = '30' | '90' | '365';
const PERIODES: ReadonlyArray<readonly [Periode, string]> = [
  ['30', '30 jours'],
  ['90', '3 mois'],
  ['365', '12 mois'],
];

export function Presence({ theme, client, detail, large, onExporter }: PropsModule) {
  const api = useMemo(() => apiPlanning(client, detail.team.id), [client, detail.team.id]);
  const fuseau = detail.team.fuseau;
  const peut = (p: string) => detail.moi.permissions.includes(p);
  const [periode, setPeriode] = useState<Periode>('90');
  const [granularite, setGranularite] = useState<'mois' | 'semaine'>('mois');
  const [types, setTypes] = useState<TypeEvenement[]>([]);
  const [stats, setStats] = useState<StatsPresence | undefined>();
  const [aVenir, setAVenir] = useState<Occurrence[]>([]);
  const [passees, setPassees] = useState<Occurrence[]>([]);
  const [ouverte, setOuverte] = useState<string | undefined>();
  const { erreur, avis, agir } = useAgir();
  const auj = aujourdhui(fuseau);
  // La période inclut la semaine à venir : réponses déjà données (et présences marquées d'avance).
  const fin = ajouterJours(auj, 8);
  const debut = ajouterJours(auj, 1 - Number(periode));

  const charger = useCallback(async () => {
    setStats(await api.stats({ debut, fin, types, granularite, fuseau }));
  }, [api, debut, fin, types, granularite, fuseau]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  useEffect(() => {
    if (!peut('planning.view')) return;
    api.liste({ debut: ajouterJours(auj, -14), fin: ajouterJours(auj, 15), fuseau }).then(
      l => {
        setAVenir(l.occurrences.filter(o => !o.termine && o.concerneMoi && l.droits.rsvp));
        setPassees(l.occurrences.filter(o => o.termine).reverse());
      },
      () => undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, auj, fuseau]);

  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  return (
    <View style={{ gap: 16 }} testID="esport-presence">
      <TitreSection theme={theme} titre="Présence" sous="Réponses des joueurs, présence réelle marquée par le staff, et taux de présence." />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-presence-page" />

      {aVenir.length ? (
        <View style={{ gap: 8 }} testID="esport-presence-a-venir">
          <Intertitre theme={theme}>Mes prochaines réponses</Intertitre>
          {aVenir.slice(0, 6).map(o => (
            <CarteOccurrence
              key={`${o.evenementId}-${o.cle}`}
              theme={theme}
              o={o}
              onRepondre={async r => {
                await api.repondre(o.evenementId, o.cle, r);
              }}
              testID={`esport-presence-occ-${o.jour}`}
            />
          ))}
        </View>
      ) : null}

      {peut('attendance.mark') && passees.length ? (
        <Panneau theme={theme} testID="esport-presence-a-marquer">
          <Intertitre theme={theme}>Marquer la présence (14 derniers jours)</Intertitre>
          {passees.slice(0, 10).map(o => {
            const id = `${o.evenementId}-${o.cle}`;
            return (
              <View key={id} style={{ gap: 6 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: ouverte === id }}
                  onPress={() => setOuverte(ouverte === id ? undefined : id)}
                  testID={`esport-a-marquer-${o.jour}`}
                  style={[styles.ligne, { justifyContent: 'space-between', paddingVertical: 6, minHeight: 44, borderTopWidth: 1, borderTopColor: theme.ligne }]}>
                  <Text style={{ flex: 1, color: theme.texte, ...police(theme.policeTexte) }}>
                    <Text style={{ color: typeEvenement(o.type).couleur }}>● </Text>
                    {dateCourteJour(o.jour)} {o.heureDebut} · {o.titre}
                  </Text>
                  <Text style={attenue}>{ouverte === id ? 'Fermer' : 'Marquer'}</Text>
                </Pressable>
                {ouverte === id ? <ListePresence theme={theme} api={api} evenementId={o.evenementId} cle={o.cle} marquer onMarque={() => void charger()} /> : null}
              </View>
            );
          })}
        </Panneau>
      ) : null}

      <Panneau theme={theme} testID="esport-presence-stats">
        <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Intertitre theme={theme}>{stats?.tout ? 'Statistiques de la team' : 'Mes statistiques'}</Intertitre>
          {peut('attendance.view_all') && onExporter ? (
            <BoutonHub
              theme={theme}
              titre="Exporter (CSV)"
              onPress={() =>
                void agir('Export', async () => {
                  const f = await api.exportCsv({ debut, fin });
                  return (await onExporter(f.nom, f.contenu, 'text/csv')) ? 'Export CSV enregistré.' : undefined;
                })
              }
              testID="esport-presence-csv"
            />
          ) : null}
        </View>
        <View style={styles.ligne}>
          <Segments theme={theme} libelle="Période" valeur={periode} options={PERIODES} onChoisir={v => setPeriode(v as Periode)} testID="esport-presence-periode" />
          <Segments theme={theme} libelle="Regrouper" valeur={granularite} options={[['mois', 'Par mois'], ['semaine', 'Par semaine']]} onChoisir={v => setGranularite(v === 'semaine' ? 'semaine' : 'mois')} testID="esport-presence-granularite" />
        </View>
        <View style={styles.ligne}>
          {TYPES_EVENEMENT.map(t => (
            <Pastille
              key={t.cle}
              theme={theme}
              actif={types.includes(t.cle)}
              libelle={t.nom}
              couleur={t.couleur}
              role="checkbox"
              onPress={() => setTypes(l => (l.includes(t.cle) ? l.filter(x => x !== t.cle) : [...l, t.cle]))}
              testID={`esport-presence-type-${t.cle}`}
            />
          ))}
        </View>
        {stats ? (
          <>
            <Text style={{ color: theme.texte, fontSize: 28, fontWeight: '800', ...police(theme.policeChiffres) }} testID="esport-presence-taux-global">
              {pourcentage(stats.global.taux)}
            </Text>
            <Text style={attenue}>
              Taux de présence · {stats.global.marques} présence(s) marquée(s) · ponctualité {pourcentage(stats.global.ponctualite)} · réponses {pourcentage(stats.global.tauxReponse)}
            </Text>
            <Intertitre theme={theme}>Par joueur</Intertitre>
            {stats.joueurs.length === 0 ? <Text style={attenue}>Aucune présence sur la période.</Text> : null}
            {stats.joueurs.map(j => (
              <LigneStat key={j.compte} theme={theme} nom={stats.noms[j.compte] ?? j.compte} c={j} large={large} testID={`esport-stat-joueur-${j.compte}`} />
            ))}
            <Intertitre theme={theme}>Par type d’événement</Intertitre>
            {stats.parType.map(t => (
              <LigneStat key={t.type} theme={theme} nom={typeEvenement(t.type).nom} couleur={typeEvenement(t.type).couleur} c={t} large={large} testID={`esport-stat-type-${t.type}`} />
            ))}
            <Intertitre theme={theme}>Par période</Intertitre>
            {stats.parPeriode.map(p => (
              <LigneStat key={p.periode} theme={theme} nom={p.periode} c={p} large={large} testID={`esport-stat-periode-${p.periode}`} />
            ))}
          </>
        ) : null}
      </Panneau>
    </View>
  );
}

function LigneStat({ theme, nom, c, couleur, large, testID }: { theme: ThemeHub; nom: string; c: CompteurPresence; couleur?: string; large: boolean; testID: string }) {
  const barre = couleur ?? (c.taux === null ? theme.attenue : c.taux >= 0.8 ? theme.ok : c.taux >= 0.5 ? theme.alerte : theme.critique);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  return (
    <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 6 }} testID={testID}>
      <View style={[styles.ligne, { justifyContent: 'space-between', flexWrap: 'nowrap' }]}>
        <Text style={{ flex: 1, color: theme.texte, fontWeight: '600', ...police(theme.policeTexte) }} numberOfLines={1}>
          {nom}
        </Text>
        <Text style={{ color: theme.texte, fontWeight: '800', ...police(theme.policeChiffres) }} testID={`${testID}-taux`}>
          {pourcentage(c.taux)}
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: teinteTransparente(theme.attenue, 0.18), overflow: 'hidden' }}>
        <View style={{ width: `${Math.round((c.taux ?? 0) * 100)}%`, height: 6, backgroundColor: barre }} />
      </View>
      <Text style={attenue}>
        {c.present} présent · {c.retard} retard · {c.absent} absent · {c.excuse} excusé
        {large ? ` · ${c.evenements - c.marques} non marqué · réponses ${pourcentage(c.tauxReponse)}` : ''}
      </Text>
    </View>
  );
}
