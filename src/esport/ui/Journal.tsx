/**
 * Journal d'activité de la team (plan, 7.11) : liste paginée, filtres
 * (membre, module, type d'action, période), phrases lisibles (« Max a changé
 * le rôle de Léa de Joueur à Coach »), export CSV et durée de conservation.
 * Visible avec `activity_log.view` ; rien ne s'y modifie ni ne s'y efface
 * (seule la purge de rétention, côté serveur, retire les lignes anciennes).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub } from '../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../hub/themes';
import { nomModule, type ClientEsport, type DetailTeam, type FiltresJournal, type PageJournal, type ReglagesJournal } from '../client';
import { filtresJournal, aujourdhui, dateCourte, lireDateSaisie, phraseJournal } from '../libelles';
import { Choix, Retours, TitreSection, useAgir, Intertitre, Panneau } from './commun';
import { tr, trn } from '../i18n';
import { ChampPeriode } from '../../ui/dates';

/** Familles d'actions par module (même table que le serveur, esport/noyau/journal.mjs). */
export const ACTIONS_PAR_MODULE: Record<string, readonly string[]> = {
  coeur: ['team', 'modules', 'role', 'member', 'invitation', 'account', 'media'],
  planning: ['event', 'ical'],
  availability: ['availability'],
  attendance: ['attendance'],
  meeting_summaries: ['meeting', 'meeting_type'],
  goals_tasks: ['goal', 'task'],
  discord: ['discord'],
  video_review: ['review'],
  scouting: ['opponent'],
  strat_editor: ['strat'],
  playbook: ['playbook'],
  lineups: ['lineup'],
  plans_match: ['plan_match'],
};

type Periode = 'tout' | '7' | '30' | '90' | 'dates';
const PERIODES: ReadonlyArray<{ id: Periode; nom: string }> = [
  { id: 'tout', get nom() {
      return tr('strats.playbook.tout');
    } },
  { id: '7', get nom() {
      return tr('journal.7_jours');
    } },
  { id: '30', get nom() {
      return tr('journal.30_jours');
    } },
  { id: '90', get nom() {
      return tr('journal.90_jours');
    } },
  { id: 'dates', get nom() {
      return tr('journal.dates');
    } },
];

/** Libellé d'une durée de conservation. */
export const libelleRetention = (jours: number): string => (jours === 0 ? tr('journal.illimitee') : jours % 365 === 0 ? trn('journal.annees', jours / 365) : trn('journal.jours', jours));

/** Période choisie → bornes (AAAA-MM-JJ) ; `undefined` si les dates saisies sont illisibles. */
export function bornesPeriode(periode: Periode, du: string, au: string, maintenant: number = Date.now()): { du?: string; au?: string } | undefined {
  if (periode === 'tout') return {};
  if (periode === 'dates') {
    const d = du.trim() ? lireDateSaisie(du) : undefined;
    const f = au.trim() ? lireDateSaisie(au) : undefined;
    if ((du.trim() && !d) || (au.trim() && !f)) return undefined;
    return { du: d, au: f };
  }
  return { du: aujourdhui(maintenant - (Number(periode) - 1) * 86_400_000), au: aujourdhui(maintenant) };
}

export function Journal({
  theme,
  client,
  detail,
  onExporter,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  detail: DetailTeam;
  onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>;
}) {
  const [module, setModule] = useState('');
  const [action, setAction] = useState('');
  const [acteur, setActeur] = useState('');
  const [periode, setPeriode] = useState<Periode>('tout');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [page, setPage] = useState<PageJournal | undefined>();
  const [reglages, setReglages] = useState<ReglagesJournal | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();
  const bornes = bornesPeriode(periode, du, au);
  const filtres: Omit<FiltresJournal, 'avant' | 'limite'> = {
    module: module || undefined,
    action: action || undefined,
    acteur: acteur || undefined,
    du: bornes?.du,
    au: bornes?.au,
  };
  const cle = JSON.stringify(filtres);

  const charger = useCallback(
    (avant?: string) =>
      agir('journal', async () => {
        const p = await client.journal(detail.team.id, { ...(JSON.parse(cle) as FiltresJournal), avant, limite: 50 });
        setPage(prec => (avant && prec ? { ...p, entrees: [...prec.entrees, ...p.entrees], noms: { ...prec.noms, ...p.noms } } : p));
      }),
    [agir, client, detail.team.id, cle],
  );
  useEffect(() => {
    if (bornes) void charger();
    // `bornes` dérive de `cle` : recharger quand les filtres changent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charger]);
  useEffect(() => {
    Promise.resolve()
      .then(() => client.reglagesJournal(detail.team.id))
      .then(setReglages, () => undefined);
  }, [client, detail.team.id]);

  const actifs = new Set(detail.modules.filter(m => m.active).map(m => m.cle));
  const modules = [{ id: '', nom: tr('journal.tous') }, { id: 'coeur', nom: tr('journal.team_et_membres') }, ...Object.keys(ACTIONS_PAR_MODULE).filter(m => m !== 'coeur' && actifs.has(m)).map(m => ({ id: m, nom: nomModule(m) }))];
  const familles = module ? filtresJournal().filter(([f]) => f && (ACTIONS_PAR_MODULE[module] ?? []).includes(f)) : [];
  const membres = [{ id: '', nom: tr('journal.tous') }, ...(page?.membres ?? []).map(m => ({ id: m.compte, nom: m.pseudo ?? (m.compte === 'principal' ? tr('dashboard.fondateur') : m.compte) }))];
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };

  return (
    <View style={{ gap: 12 }} testID="esport-journal">
      <TitreSection theme={theme} titre={tr('journal.journal')} sous={tr('journal.toutes_les_actions_sensibles')} />
      <Panneau theme={theme} testID="esport-journal-filtres">
        <Choix theme={theme} libelle={tr('journal.module')} valeur={module} options={modules} onChoisir={m => {
            setModule(m);
            setAction('');
          }} testID="esport-journal-module" />
        {familles.length > 1 ? (
          <Choix theme={theme} libelle={tr('journal.type_d_action')} valeur={action} options={[{ id: '', nom: tr('journal.toutes') }, ...familles.map(([id, nom]) => ({ id, nom }))]} onChoisir={setAction} testID="esport-journal-action" />
        ) : null}
        {membres.length > 1 ? <Choix theme={theme} libelle={tr('journal.membre')} valeur={acteur} options={membres} onChoisir={setActeur} testID="esport-journal-membre" /> : null}
        <Choix theme={theme} libelle={tr('journal.periode')} valeur={periode} options={PERIODES} onChoisir={v => setPeriode(v as Periode)} testID="esport-journal-periode" />
        {periode === 'dates' ? (
          <ChampPeriode theme={theme} format="fr" libelleDu={tr('journal.du_jj_mm_aaaa')} libelleAu={tr('journal.au_jj_mm_aaaa')} du={du} au={au} onDu={setDu} onAu={setAu} testIDDu="esport-journal-du" testIDAu="esport-journal-au" />
        ) : null}
        {!bornes ? <Text style={{ color: theme.critique, fontSize: 13 }}>{tr('journal.dates_jj_mm_aaaa')}</Text> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {onExporter ? (
            <BoutonHub
              theme={theme}
              titre={tr('journal.exporter_csv')}
              desactive={!bornes || Boolean(enCours)}
              onPress={() =>
                void agir('export', async () => {
                  const f = await client.exporterJournal(detail.team.id, filtres);
                  return (await onExporter(f.nom, f.contenu, 'text/csv')) ? tr('journal.export_csv_enregistre') : undefined;
                })
              }
              testID="esport-journal-csv"
            />
          ) : null}
          {reglages ? (
            <Text style={attenue} testID="esport-journal-retention">
              {tr('journal.conservation', { v: libelleRetention(reglages.retentionJours) })}</Text>
          ) : null}
        </View>
      </Panneau>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-journal" />
      <Panneau theme={theme}>
        {page?.entrees.length === 0 ? <Text style={attenue}>{tr('journal.aucune_entree')}</Text> : null}
        {page?.entrees.map(e => (
          <View key={e.id} style={{ borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 6 }} testID="esport-journal-entree" accessible accessibilityLabel={`${phraseJournal(e, page.noms)}, ${dateCourte(e.date)}`}>
            <Text style={{ color: theme.texte, ...police(theme.policeTexte) }}>{phraseJournal(e, page.noms)}</Text>
            <Text style={attenue}>{dateCourte(e.date)}</Text>
          </View>
        ))}
        {page?.suite ? <BoutonHub theme={theme} titre={enCours === 'journal' ? tr('journal.chargement') : tr('journal.plus_ancien')} onPress={() => void charger(page.suite ?? undefined)} testID="esport-journal-suite" /> : null}
      </Panneau>
      {reglages?.modifiable ? (
        <Panneau theme={theme} testID="esport-journal-reglages">
          <Intertitre theme={theme}>{tr('journal.duree_de_conservation')}</Intertitre>
          <Text style={attenue}>{tr('journal.les_entrees_plus_anciennes')}</Text>
          <Choix
            theme={theme}
            libelle={tr('journal.conserver_le_journal')}
            valeur={String(reglages.retentionJours)}
            options={reglages.choix.map(j => ({ id: String(j), nom: libelleRetention(j) }))}
            onChoisir={v =>
              void agir('conservation', async () => {
                setReglages(await client.changerRetentionJournal(detail.team.id, Number(v)));
                return tr('journal.journal_conserve', { v: libelleRetention(Number(v)).toLowerCase() });
              })
            }
            testID="esport-journal-conservation"
          />
        </Panneau>
      ) : null}
    </View>
  );
}
