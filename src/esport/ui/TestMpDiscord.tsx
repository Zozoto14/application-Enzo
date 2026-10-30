/**
 * « Tester les MP » (Réglages › Discord, réservé à discord.manage) : un message privé de test du bot aux membres
 * choisis (par défaut : moi), avec le résultat par membre (reçu, ou la cause et l'action à faire), puis la
 * simulation d'une relance sur un événement à venir (qui reçoit un MP, qui est cité dans le salon, qui est déjà
 * pingé) et l'envoi d'une relance de test à un seul membre. Rien n'est enregistré côté Discord ni côté planning.
 */

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub } from '../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../hub/themes';
import type { ClientEsport } from '../client';
import { apiDiscord, MOTIFS_TEST_MP, type EtatTestMp, type ResultatMembreTestMp, type SimulationRelance } from '../discord/api';
import { dateCourte } from '../libelles';
import { tr, trn } from '../i18n';
import { Choix, Intertitre, Panneau, Retours, styles, useAgir } from './commun';

const motifConnu = (m: string | null | undefined) => (m && (MOTIFS_TEST_MP as readonly string[]).includes(m) ? m : 'refuse');

/** Cause d'un échec (texte sans point final). */
const cause = (m: string | null | undefined): string => tr(`discord.testmp.motif.${m === 'option_coupee' ? m : motifConnu(m)}` as 'discord.testmp.motif.refuse');
const action = (m: string | null | undefined): string => tr(`discord.testmp.action.${motifConnu(m)}` as 'discord.testmp.action.refuse');

function ResultatsTest({ theme, resultats }: { theme: ThemeHub; resultats: ResultatMembreTestMp[] }) {
  return (
    <View style={{ gap: 6 }} testID="esport-discord-testmp-resultats">
      <Text style={{ color: theme.texte, fontWeight: '700', fontSize: 13, ...police(theme.policeTexte) }}>{tr('discord.testmp.resultats')}</Text>
      {resultats.map(r => (
        <View key={r.compte} style={{ gap: 2 }} testID={`esport-discord-testmp-resultat-${r.compte}`}>
          <Text style={{ color: r.ok ? theme.texte : theme.critique, fontSize: 13, ...police(theme.policeTexte) }}>{r.ok ? tr('discord.testmp.ok', { pseudo: r.pseudo }) : tr('discord.testmp.ko', { pseudo: r.pseudo, cause: cause(r.motif) })}</Text>
          {r.ok ? null : <Text style={{ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) }}>{tr('discord.testmp.action', { action: action(r.motif) })}</Text>}
        </View>
      ))}
    </View>
  );
}

export function TestMpDiscord({ theme, client, teamId, actif = true }: { theme: ThemeHub; client: ClientEsport; teamId: string; actif?: boolean }) {
  const api = React.useMemo(() => apiDiscord(client, teamId), [client, teamId]);
  const { enCours, erreur, avis, agir } = useAgir();
  const occupe = Boolean(enCours);
  const [etat, setEtat] = useState<EtatTestMp | undefined>();
  const [ouvert, setOuvert] = useState(false);
  const [choisis, setChoisis] = useState<string[]>([]);
  const [resultats, setResultats] = useState<ResultatMembreTestMp[] | undefined>();
  const [evenement, setEvenement] = useState<string | undefined>();
  const [simulation, setSimulation] = useState<SimulationRelance | undefined>();
  const [cible, setCible] = useState<string | undefined>();
  const [resultatsRelance, setResultatsRelance] = useState<ResultatMembreTestMp[] | undefined>();
  const attenue = { color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) };

  const charger = async () => {
    const e = await api.etatTestMp();
    setEtat(e);
    // Par défaut : moi-même (si je suis membre de la team).
    const moi = e.membres.find(m => m.compte === e.moi)?.compte;
    setChoisis(c => (c.length > 0 ? c : moi ? [moi] : []));
    setCible(c => c ?? moi ?? e.membres[0]?.compte);
    setEvenement(c => c ?? (e.evenements[0] ? `${e.evenements[0].evenementId}|${e.evenements[0].occurrence}` : undefined));
  };
  const ouvrir = () =>
    void agir('testmp-etat', async () => {
      await charger();
      setOuvert(true);
    });
  const bascule = (compte: string) => setChoisis(c => (c.includes(compte) ? c.filter(x => x !== compte) : [...c, compte]));
  const quota = etat?.quota;
  const plein = Boolean(quota && quota.restant <= 0);

  const envoyer = () =>
    void agir('testmp', async () => {
      const r = await api.testerMp(choisis);
      setResultats(r.resultats);
      setEtat(e => (e ? { ...e, quota: r.quota } : e));
      return tr('discord.testmp.envoye');
    });
  const [evId, occ] = (evenement ?? '').split('|');
  const simuler = () =>
    void agir('testmp-simu', async () => {
      setSimulation(await api.simulerRelance(evId, occ));
      setResultatsRelance(undefined);
    });
  const envoyerRelance = () =>
    void agir('testmp-relance', async () => {
      if (!cible) return;
      const r = await api.relanceTest(evId, occ, cible);
      setResultatsRelance(r.resultats);
      setEtat(e => (e ? { ...e, quota: r.quota } : e));
      return tr('discord.testmp.simu.envoyee');
    });

  return (
    <Panneau theme={theme} testID="esport-discord-testmp-panneau">
      <Intertitre theme={theme}>{tr('discord.testmp.titre')}</Intertitre>
      <Text style={attenue}>{tr('discord.testmp.aide')}</Text>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-discord-testmp" />
      {!ouvert ? (
        <View style={styles.ligne}>
          <BoutonHub theme={theme} titre={tr('discord.testmp.ouvrir')} desactive={occupe || !actif} onPress={ouvrir} testID="esport-discord-testmp-ouvrir" />
        </View>
      ) : etat ? (
        <View style={{ gap: 12 }} testID="esport-discord-testmp">
          {!etat.botConfigure || !etat.botLie ? (
            <Text style={{ color: theme.alerte, fontSize: 13 }} testID="esport-discord-testmp-bot">
              {tr('discord.mp.bot_requis')}
            </Text>
          ) : null}
          <Text style={{ color: theme.texte, fontWeight: '600', fontSize: 13, ...police(theme.policeTexte) }}>{tr('discord.testmp.membres')}</Text>
          <View style={styles.ligne} accessibilityLabel={tr('discord.testmp.membres')}>
            {etat.membres.map(m => {
              const coche = choisis.includes(m.compte);
              return (
                <Pressable
                  key={m.compte}
                  testID={`esport-discord-testmp-membre-${m.compte}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: coche }}
                  onPress={() => bascule(m.compte)}
                  style={[styles.choix, { borderColor: coche ? theme.accent : theme.ligne, backgroundColor: theme.surface, borderRadius: Math.min(theme.rayonMoyen, 10) }]}>
                  <Text style={{ color: theme.texte, fontSize: 13, fontWeight: coche ? '700' : '500', ...police(theme.policeTexte) }}>
                    {coche ? '☑ ' : '☐ '}
                    {m.compte === etat.moi ? tr('discord.testmp.moi', { pseudo: m.pseudo }) : m.pseudo}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={plein ? { color: theme.alerte, fontSize: 13 } : attenue} testID="esport-discord-testmp-quota">
            {plein ? tr('discord.testmp.quota_plein', { s: quota?.attenteS ?? 0 }) : tr('discord.testmp.quota', { restant: quota?.restant ?? 0, max: quota?.max ?? 0 })}
          </Text>
          <View style={styles.ligne}>
            <BoutonHub theme={theme} titre={trn('discord.testmp.envoyer', choisis.length)} variante="plein" desactive={occupe || choisis.length === 0 || plein} onPress={envoyer} testID="esport-discord-testmp-envoyer" />
            <BoutonHub theme={theme} titre={tr('discord.testmp.fermer')} desactive={occupe} onPress={() => setOuvert(false)} testID="esport-discord-testmp-fermer" />
          </View>
          {resultats ? <ResultatsTest theme={theme} resultats={resultats} /> : null}

          <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 12 }} testID="esport-discord-simulation">
            <Text style={{ color: theme.texte, fontWeight: '700', ...police(theme.policeTexte) }}>{tr('discord.testmp.simu.titre')}</Text>
            <Text style={attenue}>{tr('discord.testmp.simu.aide')}</Text>
            {etat.evenements.length === 0 ? (
              <Text style={attenue} testID="esport-discord-simulation-aucun">
                {tr('discord.testmp.simu.aucun')}
              </Text>
            ) : (
              <>
                <Choix
                  theme={theme}
                  libelle={tr('discord.testmp.simu.evenement')}
                  valeur={evenement}
                  options={etat.evenements.map(e => ({ id: `${e.evenementId}|${e.occurrence}`, nom: `${e.titre} · ${dateCourte(e.debut)}` }))}
                  onChoisir={v => {
                    setEvenement(v);
                    setSimulation(undefined);
                    setResultatsRelance(undefined);
                  }}
                  testID="esport-discord-simulation-evenement"
                />
                <View style={styles.ligne}>
                  <BoutonHub theme={theme} titre={tr('discord.testmp.simu.lancer')} desactive={occupe || !evenement} onPress={simuler} testID="esport-discord-simulation-lancer" />
                </View>
              </>
            )}
            {simulation ? (
              <View style={{ gap: 4 }} testID="esport-discord-simulation-resultat">
                {simulation.rien ? (
                  <Text style={attenue} testID="esport-discord-simulation-rien">
                    {tr(`discord.testmp.simu.rien.${simulation.rien}` as 'discord.testmp.simu.rien.reunion_staff')}
                  </Text>
                ) : null}
                {simulation.membres.map(m => (
                  <Text key={m.compte} style={{ color: theme.texte, fontSize: 13, ...police(theme.policeTexte) }} testID={`esport-discord-simulation-${m.compte}`}>
                    {m.voie === 'mp'
                      ? tr('discord.testmp.simu.mp', { pseudo: m.pseudo })
                      : tr(m.mention ? 'discord.testmp.simu.salon_mention' : 'discord.testmp.simu.salon', { pseudo: m.pseudo, raison: cause(m.motif) })}
                    {m.dejaPinge ? tr('discord.testmp.simu.pings_marque') : ''}
                  </Text>
                ))}
                <Text style={attenue} testID="esport-discord-simulation-deja">
                  {simulation.dejaPinges.length > 0 ? tr('discord.testmp.simu.deja', { liste: simulation.dejaPinges.map(p => p.pseudo).join(', ') }) : tr('discord.testmp.simu.personne_deja')}
                </Text>
                <Choix
                  theme={theme}
                  libelle={tr('discord.testmp.simu.destinataire')}
                  valeur={cible}
                  options={(etat.membres ?? []).map(m => ({ id: m.compte, nom: m.compte === etat.moi ? tr('discord.testmp.moi', { pseudo: m.pseudo }) : m.pseudo }))}
                  onChoisir={setCible}
                  testID="esport-discord-simulation-cible"
                />
                <View style={styles.ligne}>
                  <BoutonHub theme={theme} titre={tr('discord.testmp.simu.envoyer')} desactive={occupe || !cible || plein} onPress={envoyerRelance} testID="esport-discord-simulation-envoyer" />
                </View>
                {resultatsRelance ? <ResultatsTest theme={theme} resultats={resultatsRelance} /> : null}
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
    </Panneau>
  );
}
