/**
 * Journal d'activité de la team (plan, 7.11) : liste paginée, filtres
 * (membre, module, type d'action, période), phrases lisibles (« Max a changé
 * le rôle de Léa de Joueur à Coach »), export CSV et durée de conservation.
 * Visible avec `activity_log.view` ; rien ne s'y modifie ni ne s'y efface
 * (seule la purge de rétention, côté serveur, retire les lignes anciennes).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ, Intertitre, Panneau } from '../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../hub/themes';
import { nomModule, type ClientEsport, type DetailTeam, type FiltresJournal, type PageJournal, type ReglagesJournal } from '../client';
import { FILTRES_JOURNAL, aujourdhui, dateCourte, lireDateSaisie, phraseJournal } from '../libelles';
import { Choix, Retours, TitreSection, useAgir } from './commun';

/** Familles d'actions par module (même table que le serveur, esport/noyau/journal.mjs). */
export const ACTIONS_PAR_MODULE: Record<string, readonly string[]> = {
  coeur: ['team', 'modules', 'role', 'member', 'invitation', 'account'],
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
};

type Periode = 'tout' | '7' | '30' | '90' | 'dates';
const PERIODES: ReadonlyArray<{ id: Periode; nom: string }> = [
  { id: 'tout', nom: 'Tout' },
  { id: '7', nom: '7 jours' },
  { id: '30', nom: '30 jours' },
  { id: '90', nom: '90 jours' },
  { id: 'dates', nom: 'Dates…' },
];

/** Libellé d'une durée de conservation. */
export const libelleRetention = (jours: number): string => (jours === 0 ? 'Illimitée' : jours % 365 === 0 ? `${jours / 365} an${jours > 365 ? 's' : ''}` : `${jours} jours`);

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
      agir('Journal', async () => {
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
  const modules = [{ id: '', nom: 'Tous' }, { id: 'coeur', nom: 'Team et membres' }, ...Object.keys(ACTIONS_PAR_MODULE).filter(m => m !== 'coeur' && actifs.has(m)).map(m => ({ id: m, nom: nomModule(m) }))];
  const familles = module ? FILTRES_JOURNAL.filter(([f]) => f && (ACTIONS_PAR_MODULE[module] ?? []).includes(f)) : [];
  const membres = [{ id: '', nom: 'Tous' }, ...(page?.membres ?? []).map(m => ({ id: m.compte, nom: m.pseudo ?? (m.compte === 'principal' ? 'Fondateur' : m.compte) }))];
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };

  return (
    <View style={{ gap: 12 }} testID="esport-journal">
      <TitreSection theme={theme} titre="Journal" sous="Toutes les actions sensibles, dans l’ordre. Rien ne s’y modifie ni ne s’y efface." />
      <Panneau theme={theme} testID="esport-journal-filtres">
        <Choix theme={theme} libelle="Module" valeur={module} options={modules} onChoisir={m => {
            setModule(m);
            setAction('');
          }} testID="esport-journal-module" />
        {familles.length > 1 ? (
          <Choix theme={theme} libelle="Type d’action" valeur={action} options={[{ id: '', nom: 'Toutes' }, ...familles.map(([id, nom]) => ({ id, nom }))]} onChoisir={setAction} testID="esport-journal-action" />
        ) : null}
        {membres.length > 1 ? <Choix theme={theme} libelle="Membre" valeur={acteur} options={membres} onChoisir={setActeur} testID="esport-journal-membre" /> : null}
        <Choix theme={theme} libelle="Période" valeur={periode} options={PERIODES} onChoisir={v => setPeriode(v as Periode)} testID="esport-journal-periode" />
        {periode === 'dates' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <View style={{ flex: 1, minWidth: 140 }}>
              <Champ theme={theme} libelle="Du (JJ/MM/AAAA)" valeur={du} onChanger={setDu} maxLength={10} testID="esport-journal-du" />
            </View>
            <View style={{ flex: 1, minWidth: 140 }}>
              <Champ theme={theme} libelle="Au (JJ/MM/AAAA)" valeur={au} onChanger={setAu} maxLength={10} testID="esport-journal-au" />
            </View>
          </View>
        ) : null}
        {!bornes ? <Text style={{ color: theme.critique, fontSize: 13 }}>Dates : JJ/MM/AAAA.</Text> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {onExporter ? (
            <BoutonHub
              theme={theme}
              titre="Exporter (CSV)"
              desactive={!bornes || Boolean(enCours)}
              onPress={() =>
                void agir('Export', async () => {
                  const f = await client.exporterJournal(detail.team.id, filtres);
                  return (await onExporter(f.nom, f.contenu, 'text/csv')) ? 'Export CSV enregistré.' : undefined;
                })
              }
              testID="esport-journal-csv"
            />
          ) : null}
          {reglages ? (
            <Text style={attenue} testID="esport-journal-retention">
              Conservation : {libelleRetention(reglages.retentionJours)}
            </Text>
          ) : null}
        </View>
      </Panneau>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-journal" />
      <Panneau theme={theme}>
        {page?.entrees.length === 0 ? <Text style={attenue}>Aucune entrée.</Text> : null}
        {page?.entrees.map(e => (
          <View key={e.id} style={{ borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 6 }} testID="esport-journal-entree" accessible accessibilityLabel={`${phraseJournal(e, page.noms)}, ${dateCourte(e.date)}`}>
            <Text style={{ color: theme.texte, ...police(theme.policeTexte) }}>{phraseJournal(e, page.noms)}</Text>
            <Text style={attenue}>{dateCourte(e.date)}</Text>
          </View>
        ))}
        {page?.suite ? <BoutonHub theme={theme} titre={enCours === 'Journal' ? 'Chargement…' : 'Plus ancien'} onPress={() => void charger(page.suite ?? undefined)} testID="esport-journal-suite" /> : null}
      </Panneau>
      {reglages?.modifiable ? (
        <Panneau theme={theme} testID="esport-journal-reglages">
          <Intertitre theme={theme}>Durée de conservation</Intertitre>
          <Text style={attenue}>Les entrées plus anciennes sont effacées automatiquement (toutes les 15 minutes). Choisissez la durée la plus courte qui vous suffit.</Text>
          <Choix
            theme={theme}
            libelle="Conserver le journal"
            valeur={String(reglages.retentionJours)}
            options={reglages.choix.map(j => ({ id: String(j), nom: libelleRetention(j) }))}
            onChoisir={v =>
              void agir('Conservation', async () => {
                setReglages(await client.changerRetentionJournal(detail.team.id, Number(v)));
                return `Journal conservé : ${libelleRetention(Number(v)).toLowerCase()}.`;
              })
            }
            testID="esport-journal-conservation"
          />
        </Panneau>
      ) : null}
    </View>
  );
}
