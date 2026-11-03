/**
 * Module « Objectifs et tâches » de l'Esport (phase 3) : objectifs d'équipe
 * ou de joueur avec leur progression (calculée par le serveur à partir des
 * tâches), tâches en liste ou en kanban, filtres « Mes tâches » et « En
 * retard ». Données propres à l'Esport, séparées de l'app Tâches du hub.
 *
 * Droits (vérifiés par le serveur) : goals_tasks.view|create|update|delete|
 * assign ; l'assigné fait avancer sa tâche même avec la seule lecture.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { BoutonHub, Champ, Segments } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import type { ClientEsport, DetailTeam, FiltresTaches, Membre, Objectif, Priorite, StatutTache, Tache } from '../client';
import { LIBELLES_PRIORITE, LIBELLES_STATUT_TACHE, dateJour, lireDateSaisie } from '../libelles';
import { ChampNote } from './ChampNote';
import { BoutonConfirme, Choix, PastilleRole, Retours, styles, useAgir, Intertitre, Panneau } from './commun';
import { NoteMarkdown } from './review/Note';
import { EnTetePage, EtatVide, Volet } from './design';
import { tr, trn } from '../i18n';
import { useTempsReel } from '../tempsReel/hooks';

const STATUTS: StatutTache[] = ['a_faire', 'en_cours', 'fait'];
const PRIORITES: Priorite[] = ['basse', 'normale', 'haute', 'urgente'];
type Filtre = 'toutes' | 'miennes' | 'retard';

const couleurPriorite = (theme: ThemeHub, p: Priorite) => ({ basse: theme.attenue, normale: theme.accent, haute: theme.alerte, urgente: theme.critique })[p];
const couleurStatut = (theme: ThemeHub, s: StatutTache) => ({ a_faire: theme.attenue, en_cours: theme.accent, fait: theme.ok })[s];

export function BarreProgression({ theme, pourcentage, testID }: { theme: ThemeHub; pourcentage: number; testID?: string }) {
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pourcentage }}
      style={{ height: 8, borderRadius: 4, backgroundColor: teinteTransparente(theme.attenue, 0.25), overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(100, pourcentage))}%`, height: 8, backgroundColor: pourcentage >= 100 ? theme.ok : theme.accent }} />
    </View>
  );
}

export function SectionObjectifs({
  theme,
  client,
  detail,
  large,
  onExporter,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  detail: DetailTeam;
  large: boolean;
  onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>;
}) {
  const teamId = detail.team.id;
  const [moi, setMoi] = useState<string | undefined>();
  useEffect(() => {
    client.moi().then(m => setMoi(m.compte), () => undefined);
  }, [client]);
  const peut = (p: string) => detail.moi.permissions.includes(p);
  const [objectifs, setObjectifs] = useState<Objectif[] | undefined>();
  const [taches, setTaches] = useState<Tache[] | undefined>();
  const [membres, setMembres] = useState<Membre[]>([]);
  const [filtre, setFiltre] = useState<Filtre>('toutes');
  const [vue, setVue] = useState<'liste' | 'kanban'>(large ? 'kanban' : 'liste');
  const [formulaire, setFormulaire] = useState<'objectif' | 'tache' | undefined>();
  const { erreur, avis, agir } = useAgir();

  const recharger = useCallback(async () => {
    const f: FiltresTaches = filtre === 'toutes' ? {} : { filtre };
    const [o, t] = await Promise.all([client.objectifs(teamId), client.taches(teamId, f)]);
    setObjectifs(o);
    setTaches(t.taches);
  }, [client, teamId, filtre]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);
  useTempsReel(client, `team:${teamId}:goals_tasks`, () => void recharger().catch(() => undefined));
  useEffect(() => {
    if (detail.moi.permissions.includes('members.view')) client.membres(teamId).then(m => setMembres(m.filter(x => x.statut === 'actif')), () => undefined);
  }, [client, teamId, detail]);

  const modifier = (t: Tache, champs: Parameters<ClientEsport['modifierTache']>[2], message?: string) =>
    void agir('tache', async () => {
      await client.modifierTache(teamId, t.id, champs);
      await recharger();
      return message;
    });
  const supprimer = (t: Tache) =>
    void agir('tache', async () => {
      await client.supprimerTache(teamId, t.id);
      await recharger();
      return tr('objectifs.tache_supprimee');
    });
  const peutBouger = (t: Tache) => peut('goals_tasks.update') || (Boolean(moi) && t.assigne?.compte === moi);
  const cree = async () => {
    setFormulaire(undefined);
    await recharger();
  };
  const formulaireEl =
    formulaire === 'objectif' ? (
      <Panneau theme={theme}>
        <NouvelObjectif theme={theme} client={client} teamId={teamId} membres={membres} onCree={cree} />
        <BoutonHub theme={theme} titre={tr('assistant.annuler')} onPress={() => setFormulaire(undefined)} testID="esport-objectif-annuler" />
      </Panneau>
    ) : formulaire === 'tache' ? (
      <View style={{ gap: 8 }}>
        <NouvelleTache theme={theme} client={client} teamId={teamId} membres={membres} objectifs={objectifs ?? []} moi={moi} peutAssigner={peut('goals_tasks.assign')} onCree={cree} large={false} />
        <BoutonHub theme={theme} titre={tr('assistant.annuler')} onPress={() => setFormulaire(undefined)} testID="esport-tache-annuler" />
      </View>
    ) : null;

  return (
    <View style={{ gap: 16 }} testID="esport-objectifs">
      <EnTetePage
        theme={theme}
        large={large}
        titre={tr('accueilPhase3.objectifs_et_taches')}
        sous={tr('objectifs.propres_a_la_team')}
        action={peut('goals_tasks.create') ? <BoutonHub theme={theme} titre={tr('objectifs.nouvelle_tache_2')} variante="plein" onPress={() => setFormulaire('tache')} testID="esport-tache-creer" /> : undefined}
        actions={[
          peut('goals_tasks.create') && { titre: tr('objectifs.nouvel_objectif'), onPress: () => setFormulaire('objectif'), testID: 'esport-objectif-creer' },
          onExporter && peut('goals_tasks.view') && {
            titre: tr('objectifs.exporter_les_taches_csv'),
            testID: 'esport-taches-csv',
            onPress: () =>
              void agir('export', async () => {
                const f = await client.exporterTaches(teamId, filtre === 'toutes' ? {} : { filtre });
                return (await onExporter(f.nom, f.contenu, 'text/csv')) ? tr('objectifs.export_csv_des_taches') : undefined;
              }),
          },
          onExporter && peut('goals_tasks.view') && {
            titre: tr('objectifs.exporter_les_objectifs_csv'),
            testID: 'esport-objectifs-csv',
            onPress: () =>
              void agir('export', async () => {
                const f = await client.exporterObjectifs(teamId);
                return (await onExporter(f.nom, f.contenu, 'text/csv')) ? tr('objectifs.export_csv_des_objectifs') : undefined;
              }),
          },
        ]}
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-objectifs" />
      {/* Formulaires : volet latéral sur PC, bloc en haut de page sur iPhone. */}
      {formulaire && !large ? formulaireEl : null}
      <Volet theme={theme} visible={Boolean(formulaire) && large} titre={formulaire === 'objectif' ? tr('objectifs.nouvel_objectif_2') : tr('objectifs.nouvelle_tache')} onFermer={() => setFormulaire(undefined)} testID="esport-objectifs-volet">
        {formulaireEl}
      </Volet>
      <View style={{ gap: 16 }}>
        <Panneau theme={theme} testID="esport-objectifs-liste">
          <Intertitre theme={theme}>{tr('objectifs.objectifs')}</Intertitre>
          {objectifs?.length === 0 ? (
            <EtatVide
              theme={theme}
              glyphe="⚑"
              titre={tr('objectifs.aucun_objectif_pour_l')}
              texte={tr('objectifs.un_objectif_regroupe_des')}
              action={peut('goals_tasks.create') ? { titre: tr('objectifs.nouvel_objectif'), onPress: () => setFormulaire('objectif') } : undefined}
            />
          ) : null}
          {objectifs?.map(o => (
            <View key={o.id} style={{ gap: 4, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8 }} testID={`esport-objectif-${o.id}`}>
              <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
                <Text style={{ color: theme.texte, fontWeight: '700', flexShrink: 1, ...police(theme.policeTexte) }}>{o.titre}</Text>
                <Text style={{ color: theme.texte, fontWeight: '800', ...police(theme.policeChiffres) }} testID={`esport-objectif-pourcentage-${o.id}`}>
                  {o.progression.pourcentage} %
                </Text>
              </View>
              <BarreProgression theme={theme} pourcentage={o.progression.pourcentage} testID={`esport-objectif-progression-${o.id}`} />
              <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>
                {o.proprietaire ? tr('objectifs.objectif_de', { nom: o.proprietaire.pseudo ?? '?' }) : tr('objectifs.objectif_d_equipe')} · {trn('objectifs.taches_faites', o.progression.total, { faites: o.progression.faites })}
                {o.dateCible ? tr('objectifs.pour_le', { v: dateJour(o.dateCible) }) : ''}
                {o.statut !== 'actif' ? ` · ${o.statut === 'atteint' ? 'atteint' : tr('objectifs.abandonne')}` : ''}
              </Text>
              {peut('goals_tasks.update') || peut('goals_tasks.delete') ? (
                <View style={styles.ligne}>
                  {peut('goals_tasks.update') && o.statut === 'actif' ? (
                    <BoutonHub
                      theme={theme}
                      titre={tr('objectifs.atteint')}
                      onPress={() =>
                        void agir('objectif', async () => {
                          await client.modifierObjectif(teamId, o.id, { statut: 'atteint' });
                          await recharger();
                          return tr('objectifs.objectif_atteint_bravo');
                        })
                      }
                      testID={`esport-objectif-atteint-${o.id}`}
                    />
                  ) : null}
                  {peut('goals_tasks.delete') ? (
                    <BoutonConfirme
                      theme={theme}
                      titre={tr('discord.supprimer')}
                      confirmation={tr('objectifs.oui_les_taches_restent')}
                      onConfirme={() =>
                        void agir('objectif', async () => {
                          await client.supprimerObjectif(teamId, o.id);
                          await recharger();
                          return tr('objectifs.objectif_supprime');
                        })
                      }
                      testID={`esport-objectif-supprimer-${o.id}`}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          ))}
        </Panneau>
      </View>

      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Segments
          theme={theme}
          libelle={tr('objectifs.filtre')}
          valeur={filtre}
          options={[
            ['toutes', tr('journal.toutes')],
            ['miennes', tr('objectifs.mes_taches')],
            ['retard', tr('libelles.en_retard')],
          ]}
          onChoisir={v => setFiltre(v as Filtre)}
          testID="esport-taches-filtre"
        />
        <Segments
          theme={theme}
          libelle={tr('objectifs.affichage')}
          valeur={vue}
          options={[
            ['liste', tr('objectifs.liste')],
            ['kanban', tr('objectifs.kanban')],
          ]}
          onChoisir={v => setVue(v as 'liste' | 'kanban')}
          testID="esport-taches-vue"
        />
      </View>

      {vue === 'liste' ? (
        <Panneau theme={theme} testID="esport-taches-liste">
          {taches?.length === 0 ? <EtatVide theme={theme} glyphe="☑︎" titre={tr('objectifs.aucune_tache')} texte={filtre === 'toutes' ? tr('objectifs.creez_la_premiere_tache') : tr('objectifs.rien_pour_ce_filtre')} /> : null}
          {taches?.map(t => (
            <CarteTache key={t.id} theme={theme} tache={t} peutBouger={peutBouger(t)} peutSupprimer={peut('goals_tasks.delete')} onStatut={s => modifier(t, { statut: s })} onSupprimer={() => supprimer(t)} />
          ))}
        </Panneau>
      ) : (
        <ScrollView horizontal={!large} contentContainerStyle={{ gap: 12 }} testID="esport-kanban">
          <View style={{ flexDirection: 'row', gap: 12, flex: 1, alignItems: 'flex-start' }}>
            {STATUTS.map(s => {
              const colonne = taches?.filter(t => t.statut === s) ?? [];
              return (
                <View
                  key={s}
                  testID={`esport-kanban-${s}`}
                  style={{ flex: large ? 1 : undefined, width: large ? undefined : 280, gap: 8, padding: 8, borderRadius: theme.rayonMoyen, backgroundColor: teinteTransparente(couleurStatut(theme, s), 0.1) }}>
                  <Text style={{ color: theme.texte, fontWeight: '800', ...police(theme.policeTitre) }}>
                    {LIBELLES_STATUT_TACHE[s]} · {colonne.length}
                  </Text>
                  {colonne.map(t => (
                    <CarteTache key={t.id} theme={theme} tache={t} carte peutBouger={peutBouger(t)} peutSupprimer={peut('goals_tasks.delete')} onStatut={st => modifier(t, { statut: st })} onSupprimer={() => supprimer(t)} />
                  ))}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function CarteTache({
  theme,
  tache: t,
  carte,
  peutBouger,
  peutSupprimer,
  onStatut,
  onSupprimer,
}: {
  theme: ThemeHub;
  tache: Tache;
  carte?: boolean;
  peutBouger: boolean;
  peutSupprimer: boolean;
  onStatut(s: StatutTache): void;
  onSupprimer(): void;
}) {
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const i = STATUTS.indexOf(t.statut);
  return (
    <View
      testID={`esport-tache-${t.id}`}
      style={
        carte
          ? { gap: 6, padding: 10, borderWidth: 1, borderColor: t.enRetard ? theme.critique : theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10), backgroundColor: theme.surface }
          : { gap: 6, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8 }
      }>
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ color: theme.texte, fontWeight: '700', flexShrink: 1, textDecorationLine: t.statut === 'fait' ? 'line-through' : 'none', ...police(theme.policeTexte) }}>{t.titre}</Text>
        {carte ? null : <PastilleRole theme={theme} nom={LIBELLES_STATUT_TACHE[t.statut]} couleur={couleurStatut(theme, t.statut)} testID={`esport-tache-statut-${t.id}`} />}
      </View>
      <View style={styles.ligne}>
        <PastilleRole theme={theme} nom={LIBELLES_PRIORITE[t.priorite]} couleur={couleurPriorite(theme, t.priorite)} />
        {t.echeance ? (
          <Text style={[attenue, t.enRetard ? { color: theme.critique, fontWeight: '700' } : null]} testID={t.enRetard ? `esport-tache-retard-${t.id}` : undefined}>
            {t.enRetard ? tr('objectifs.en_retard') : ''}
            {dateJour(t.echeance)}
          </Text>
        ) : null}
        <Text style={attenue}>{t.assigne ? t.assigne.pseudo ?? '?' : tr('objectifs.non_assignee')}</Text>
        {t.objectif ? <Text style={attenue}>· {t.objectif.titre}</Text> : null}
      </View>
      {t.description ? <NoteMarkdown theme={theme} source={t.description} testID={`esport-tache-description-${t.id}`} /> : null}
      {peutBouger || peutSupprimer ? (
        <View style={styles.ligne}>
          {peutBouger && i > 0 ? <BoutonHub theme={theme} titre={`← ${LIBELLES_STATUT_TACHE[STATUTS[i - 1]]}`} onPress={() => onStatut(STATUTS[i - 1])} testID={`esport-tache-${t.id}-${STATUTS[i - 1]}`} /> : null}
          {peutBouger && i < STATUTS.length - 1 ? (
            <BoutonHub theme={theme} titre={`${LIBELLES_STATUT_TACHE[STATUTS[i + 1]]} →`} variante="plein" onPress={() => onStatut(STATUTS[i + 1])} testID={`esport-tache-${t.id}-${STATUTS[i + 1]}`} />
          ) : null}
          {peutSupprimer ? <BoutonConfirme theme={theme} titre={tr('discord.supprimer')} confirmation={tr('objectifs.oui')} onConfirme={onSupprimer} testID={`esport-tache-supprimer-${t.id}`} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function NouvelObjectif({ theme, client, teamId, membres, onCree }: { theme: ThemeHub; client: ClientEsport; teamId: string; membres: Membre[]; onCree(): Promise<void> }) {
  const [titre, setTitre] = useState('');
  const [pour, setPour] = useState('');
  const [date, setDate] = useState('');
  const { enCours, erreur, avis, agir, setErreur } = useAgir();
  return (
    <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8 }} testID="esport-objectif-nouveau">
      <Champ theme={theme} libelle={tr('objectifs.nouvel_objectif_2')} valeur={titre} onChanger={setTitre} maxLength={120} testID="esport-objectif-titre" />
      <Choix theme={theme} libelle={tr('objectifs.pour')} valeur={pour} options={[{ id: '', nom: tr('objectifs.l_equipe') }, ...membres.map(m => ({ id: m.compte, nom: m.pseudo }))]} onChoisir={setPour} testID="esport-objectif-pour" />
      <Champ theme={theme} libelle={tr('objectifs.date_cible_jj_mm')} valeur={date} onChanger={setDate} maxLength={10} testID="esport-objectif-date" />
      <BoutonHub
        theme={theme}
        titre={tr('objectifs.creer_l_objectif')}
        variante="plein"
        desactive={Boolean(enCours) || titre.trim().length < 2}
        onPress={() => {
          const iso = date.trim() ? lireDateSaisie(date) : null;
          if (iso === undefined) {
            setErreur(tr('objectifs.date_cible_jj_mm_2'));
            return;
          }
          void agir('objectif', async () => {
            await client.creerObjectif(teamId, { titre: titre.trim(), proprietaire: pour || null, dateCible: iso });
            setTitre('');
            setDate('');
            await onCree();
            return tr('objectifs.objectif_cree');
          });
        }}
        testID="esport-objectif-creer"
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-objectif-nouveau" />
    </View>
  );
}

function NouvelleTache({
  theme,
  client,
  teamId,
  membres,
  objectifs,
  moi,
  peutAssigner,
  onCree,
  large,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  teamId: string;
  membres: Membre[];
  objectifs: Objectif[];
  moi: string | undefined;
  peutAssigner: boolean;
  onCree(): Promise<void>;
  large: boolean;
}) {
  const [titre, setTitre] = useState('');
  const [description, setDescription] = useState('');
  const [assigne, setAssigne] = useState('');
  const [echeance, setEcheance] = useState('');
  const [priorite, setPriorite] = useState<Priorite>('normale');
  const [objectif, setObjectif] = useState('');
  const { enCours, erreur, avis, agir, setErreur } = useAgir();
  const assignables = peutAssigner ? membres : membres.filter(m => m.compte === moi);
  return (
    <Panneau theme={theme} style={large ? { flex: 1 } : undefined} testID="esport-tache-nouvelle">
      <Intertitre theme={theme}>{tr('objectifs.nouvelle_tache')}</Intertitre>
      <Champ theme={theme} libelle={tr('objectifs.titre')} valeur={titre} onChanger={setTitre} maxLength={120} testID="esport-tache-titre" />
      <ChampNote theme={theme} libelle={tr('assistant.description_facultative')} valeur={description} onChanger={setDescription} maxLength={2000} testID="esport-tache-description" />
      <Choix theme={theme} libelle={tr('objectifs.assignee_a')} valeur={assigne} options={[{ id: '', nom: tr('planning.convocations.personne') }, ...assignables.map(m => ({ id: m.compte, nom: m.pseudo }))]} onChoisir={setAssigne} testID="esport-tache-assigne" />
      <Choix theme={theme} libelle={tr('objectifs.priorite')} valeur={priorite} options={PRIORITES.map(p => ({ id: p, nom: LIBELLES_PRIORITE[p], couleur: couleurPriorite(theme, p) }))} onChoisir={v => setPriorite(v as Priorite)} testID="esport-tache-priorite" />
      <Champ theme={theme} libelle={tr('objectifs.echeance_jj_mm_aaaa')} valeur={echeance} onChanger={setEcheance} maxLength={10} testID="esport-tache-echeance" />
      {objectifs.length > 0 ? (
        <Choix
          theme={theme}
          libelle={tr('objectifs.objectif')}
          valeur={objectif}
          options={[{ id: '', nom: tr('objectifs.aucun') }, ...objectifs.filter(o => o.statut === 'actif').map(o => ({ id: o.id, nom: o.titre }))]}
          onChoisir={setObjectif}
          testID="esport-tache-objectif"
        />
      ) : null}
      <BoutonHub
        theme={theme}
        titre={tr('objectifs.creer_la_tache')}
        variante="plein"
        desactive={Boolean(enCours) || titre.trim().length < 2}
        onPress={() => {
          const iso = echeance.trim() ? lireDateSaisie(echeance) : null;
          if (iso === undefined) {
            setErreur(tr('objectifs.echeance_jj_mm_aaaa_2'));
            return;
          }
          void agir('tache', async () => {
            await client.creerTache(teamId, { titre: titre.trim(), description: description.trim() || undefined, assigne: assigne || null, echeance: iso, priorite, objectifId: objectif || null });
            setTitre('');
            setDescription('');
            setEcheance('');
            await onCree();
            return assigne && assigne !== moi ? tr('objectifs.tache_creee_la_personne') : tr('objectifs.tache_creee');
          });
        }}
        testID="esport-tache-creer"
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-tache-nouvelle" />
    </Panneau>
  );
}
