/**
 * Module « Plan de match » : la préparation d'un match pour toute la team.
 *
 *  - Liste : plans à venir d'abord, puis passés ; filtres par statut, adversaire et map ; modèles (staff).
 *  - Page d'un plan (PagePlan) : résumé, « Mon rôle », veto, une section par map, checklist.
 *  - Éditeur (EditeurPlan), corbeille de 30 jours.
 *
 * Droits (vérifiés par le serveur) : plans.voir (plans prêts et joués), plans.editer (tout). Contenu tactique : rien
 * ne part vers une IA, et l'annonce Discord facultative ne porte que l'adversaire et la date.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { BoutonHub } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { Icone } from '../../../ui/icones';
import { SelecteurRepliable } from '../../../ui/selecteurs/SelecteurRepliable';
import { dateCourte } from '../../libelles';
import { trPm, trnPm, type ClePm } from '../../i18n/plans';
import { demanderLineup } from '../../lineups/intention';
import { apiPlans, type ApiPlans, type FiltresPlans, type Plan, type PlanCorbeille, type ResumePlan, type StatutPlan } from '../../plans/api';
import { prendrePlanDemande } from '../../plans/intention';
import { aVenir, facettesPlans, filtrerPlans, trierPlans, type OptionFiltre } from '../../plans/logique';
import { modeleDuJeu } from '../../strats/modeles';
import { useTempsReel } from '../../tempsReel/hooks';
import { Retours, useAgir } from '../commun';
import { Badge, Carte, ESP, EnTetePage, EtatVide, SqueletteCartes, attenue, rayonCarte, texte } from '../design';
import { useDefilementEcran } from '../lineups/defilement';
import { GrilleEgale, PastillesFiltre } from '../lineups/Filtres';
import type { PropsModule } from '../modules';
import { useCible } from '../notifications/Cible';
import { MentionRiot, demanderStrat, useAssetsTeam } from '../strats/commun';
import { BadgeStatut, quandPlan } from './blocs';
import { EditeurPlan } from './EditeurPlan';
import { PagePlan } from './PagePlan';

const PASTILLES_MAX = 8;

/** Carte d'un plan dans la liste : l'adversaire d'abord, puis la date, les maps et l'avancement. */
export function CarteResumePlan({ theme, plan, onOuvrir, action }: { theme: ThemeHub; plan: ResumePlan; onOuvrir(): void; action?: React.ReactNode }) {
  const quand = quandPlan(plan);
  return (
    <View testID={`esport-plan-carte-${plan.id}`} style={{ height: '100%', borderRadius: Math.min(rayonCarte(theme), 14), borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface, overflow: 'hidden' }}>
      <Pressable testID={`esport-plan-ouvrir-${plan.id}`} accessibilityRole="button" accessibilityLabel={trPm('liste.ouvrir', { titre: plan.titre })} onPress={onOuvrir} style={(e: { pressed: boolean; hovered?: boolean }) => ({ flex: 1, padding: ESP.m, gap: ESP.xs, opacity: e.pressed ? 0.85 : 1 })}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, flexWrap: 'wrap' }}>
          <BadgeStatut theme={theme} statut={plan.statut} />
          {plan.format ? <Badge theme={theme} texte={trPm(`format.${plan.format}` as ClePm)} /> : null}
          {plan.evenement ? <Icone nom="calendrier" taille={14} couleur={theme.attenue} /> : null}
        </View>
        <Text numberOfLines={2} style={{ ...texte(theme, 17), fontWeight: '800' }}>
          {plan.adversaire?.nom ? trPm('contre', { nom: plan.adversaire.nom }).replace(/^./, c => c.toUpperCase()) : plan.titre}
        </Text>
        {plan.adversaire?.nom ? (
          <Text numberOfLines={1} style={attenue(theme, 12)}>
            {plan.titre}
          </Text>
        ) : null}
        <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{quand ?? (plan.estModele ? '' : trPm('sans_date'))}</Text>
        <View style={{ flex: 1 }} />
        <Text numberOfLines={1} style={attenue(theme, 12)}>
          {[plan.cartes.length ? plan.cartes.slice(0, 5).join(' · ') : trnPm('liste.cartes', 0), plan.checklist.total ? trPm('liste.checklist', plan.checklist) : null].filter(Boolean).join('  ·  ')}
        </Text>
      </Pressable>
      {action ? <View style={{ paddingHorizontal: ESP.m, paddingBottom: ESP.m, flexDirection: 'row' }}>{action}</View> : null}
    </View>
  );
}

function FiltreListe({ theme, libelle, valeur, options, tout, dense, onChoisir, testID }: { theme: ThemeHub; libelle: string; valeur: string; options: readonly OptionFiltre[]; tout: string; dense: boolean; onChoisir(v: string): void; testID: string }) {
  if (options.length <= PASTILLES_MAX) return <PastillesFiltre theme={theme} libelle={libelle} valeur={valeur} tout={tout} dense={dense} options={options} onChoisir={onChoisir} testID={testID} />;
  return <SelecteurRepliable theme={theme} libelle={libelle} valeur={valeur} vide={tout} options={[{ id: '', nom: tout }, ...options.map(o => ({ id: o.id, nom: o.nom, detail: String(o.n) }))]} onChoisir={onChoisir} testID={testID} style={{ flexGrow: 1, flexBasis: 240, maxWidth: 420 }} />;
}

export function Plans({ theme, client, detail, large, onAller }: PropsModule) {
  const teamId = detail.team.id;
  const api = useMemo(() => apiPlans(client), [client]);
  const assets = useAssetsTeam(client, detail.team);
  const modele = assets?.modele ?? modeleDuJeu(null, detail.team.jeu);
  const [liste, setListe] = useState<Awaited<ReturnType<ApiPlans['liste']>> | undefined>();
  const [filtres, setFiltres] = useState<FiltresPlans>({});
  const [demande] = useState(() => prendrePlanDemande());
  const [ouvert, setOuvert] = useState<string | undefined>(demande && 'id' in demande ? demande.id : undefined);
  const [plan, setPlan] = useState<Plan | undefined>();
  const [edition, setEdition] = useState(false);
  const [corbeille, setCorbeille] = useState(false);
  const [choixModele, setChoixModele] = useState(false);
  const { enCours, erreur, avis, agir, setAvis } = useAgir();
  const { width } = useWindowDimensions();
  const maintenant = useMemo(() => Date.now(), [liste]); // eslint-disable-line react-hooks/exhaustive-deps -- relu avec la liste

  const recharger = useCallback(async () => setListe(await api.liste(teamId)), [api, teamId]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);
  // Plan ouvert : son détail (relu quand la liste change ailleurs).
  const chargerPlan = useCallback(async (id: string) => setPlan(await api.detail(teamId, id)), [api, teamId]);
  useEffect(() => {
    if (!ouvert) return setPlan(undefined);
    if (plan?.id === ouvert) return undefined;
    setPlan(undefined);
    void agir('', async () => {
      try {
        await chargerPlan(ouvert);
      } catch (e) {
        setOuvert(undefined);
        throw e;
      }
    });
    return undefined;
  }, [ouvert, plan?.id, agir, chargerPlan]);
  useTempsReel(
    client,
    [`team:${teamId}:plans_match`],
    () => {
      void recharger().catch(() => undefined);
      if (ouvert) void chargerPlan(ouvert).catch(() => undefined);
    },
    { actif: !edition },
  );
  // Lien direct d'une notification « plan prêt » : sa page s'ouvre.
  useCible('plans', c => {
    if (c.g === 'plan_match' && typeof c.plan === 'string') {
      setEdition(false);
      setCorbeille(false);
      setOuvert(c.plan);
    }
  });
  // Depuis un événement du planning : son plan s'ouvre ; s'il n'existe pas encore, le staff le crée et l'édite.
  useEffect(() => {
    if (!demande || 'id' in demande) return;
    void agir('', async () => {
      const r = await api.pourEvenement(teamId, demande.evenement, demande.occurrence);
      if (r.plan) return setOuvert(r.plan.id);
      if (!r.droits.editer) return undefined;
      const cree = await api.creer(teamId, { evenementId: demande.evenement, occurrence: demande.occurrence });
      setPlan(cree);
      setOuvert(cree.id);
      setEdition(true);
      void recharger().catch(() => undefined);
      return undefined;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule fois, à l'ouverture
  }, []);

  useDefilementEcran('esport-plans', edition ? 'edition' : ouvert ? `plan:${ouvert}` : corbeille ? 'corbeille' : 'liste');

  const droits = liste?.droits ?? { editer: false };
  const tous = useMemo(() => liste?.plans ?? [], [liste]);
  const visibles = useMemo(() => trierPlans(filtrerPlans(tous, filtres), maintenant), [tous, filtres, maintenant]);
  const fac = useMemo(() => facettesPlans(tous), [tous]);
  const creer = (depuis?: string) =>
    void agir('creation', async () => {
      const cree = await api.creer(teamId, depuis ? { depuis } : { titre: trPm('nouveau.titre_defaut') });
      setChoixModele(false);
      setPlan(cree);
      setOuvert(cree.id);
      setEdition(true);
      void recharger().catch(() => undefined);
    });
  const ouvrirStrat = (id: string) => {
    demanderStrat(id);
    onAller('module:strat_editor');
  };
  const ouvrirLineup = (id: string) => {
    demanderLineup(id);
    onAller('module:lineups');
  };
  const actif = (cle: string) => detail.modules.some(m => m.cle === cle && m.active);

  // ---------------------------------------------------------------- Éditeur
  if (edition && plan) {
    return (
      <View testID="esport-plans" style={{ gap: ESP.l }}>
        <EditeurPlan
          theme={theme}
          client={client}
          api={api}
          teamId={teamId}
          plan={plan}
          assets={assets}
          modele={plan.modele ?? modele}
          large={large}
          onAnnuler={() => setEdition(false)}
          onFini={p => {
            setPlan(p);
            setEdition(false);
            setAvis(trPm('enregistre'));
            void recharger().catch(() => undefined);
          }}
        />
      </View>
    );
  }

  // ---------------------------------------------------------------- Page d'un plan
  if (ouvert) {
    return (
      <View testID="esport-plans" style={{ gap: ESP.l }}>
        <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-plans" />
        {plan ? (
          <PagePlan
            theme={theme}
            api={api}
            teamId={teamId}
            plan={plan}
            assets={assets}
            large={large}
            onRetour={() => setOuvert(undefined)}
            onModifier={() => setEdition(true)}
            onChange={p => {
              setPlan(p);
              void recharger().catch(() => undefined);
            }}
            onSupprime={p => {
              setOuvert(undefined);
              setAvis(trPm('page.supprime', { titre: p.titre }));
              void recharger().catch(() => undefined);
            }}
            onDuplique={(copie, enModele) => {
              void recharger().catch(() => undefined);
              if (enModele) return;
              setPlan(copie);
              setOuvert(copie.id);
              setAvis(trPm('page.duplique'));
            }}
            onOuvrirStrat={actif('strat_editor') && detail.moi.permissions.includes('strats.view') ? ouvrirStrat : undefined}
            onOuvrirLineup={actif('lineups') && detail.moi.permissions.includes('lineups.voir') ? ouvrirLineup : undefined}
            onOuvrirEvenement={actif('planning') && detail.moi.permissions.includes('planning.view') ? () => onAller('module:planning') : undefined}
          />
        ) : (
          <SqueletteCartes theme={theme} n={1} large={large} />
        )}
        <MentionRiot theme={theme} jeu={assets?.jeu} />
      </View>
    );
  }

  // ---------------------------------------------------------------- Corbeille
  if (corbeille) {
    return (
      <View testID="esport-plans" style={{ gap: ESP.l }}>
        <EnTetePage theme={theme} large={large} titre={trPm('corbeille.titre')} sous={trPm('corbeille.aide')} action={<BoutonHub theme={theme} titre={trPm('retour')} onPress={() => setCorbeille(false)} testID="esport-plans-corbeille-retour" />} />
        <CorbeillePlans
          theme={theme}
          api={api}
          teamId={teamId}
          onRestaure={titre => {
            void recharger().catch(() => undefined);
            setAvis(trPm('corbeille.restaure', { titre }));
          }}
        />
        <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-plans" />
      </View>
    );
  }

  // ---------------------------------------------------------------- Liste
  const vide = Boolean(liste && tous.length === 0);
  const filtre = Boolean(filtres.statut || filtres.adversaire || filtres.carte);
  const prochains = visibles.filter(p => aVenir(p, maintenant));
  const passes = visibles.filter(p => !aVenir(p, maintenant));
  const modeles = liste?.modeles ?? [];
  const petit = !large && width < 520;
  const grille = (plans: readonly ResumePlan[]) => (
    <GrilleEgale min={petit ? 260 : 270} gap={ESP.s}>
      {plans.map(p => (
        <CarteResumePlan key={p.id} theme={theme} plan={p} onOuvrir={() => setOuvert(p.id)} />
      ))}
    </GrilleEgale>
  );
  const nouveau = droits.editer ? <BoutonHub theme={theme} titre={trPm('nouveau')} variante="plein" icone="plus" desactive={Boolean(enCours)} onPress={() => (modeles.length ? setChoixModele(o => !o) : creer())} testID="esport-plans-nouveau" /> : undefined;
  return (
    <View testID="esport-plans" style={{ gap: ESP.l }}>
      <EnTetePage theme={theme} large={large} titre={trPm('titre')} sous={large || vide ? trPm('sous') : undefined} action={nouveau} actions={[droits.editer && { titre: trPm('corbeille.ouvrir'), onPress: () => setCorbeille(true), testID: 'esport-plans-corbeille-ouvrir' }]} />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-plans" />
      {choixModele ? (
        <View testID="esport-plans-choix" style={{ gap: ESP.xs, padding: ESP.m, borderRadius: 12, borderWidth: 1, borderColor: theme.accent, backgroundColor: theme.surface }}>
          <View style={{ flexDirection: 'row', gap: ESP.xs, flexWrap: 'wrap' }}>
            <BoutonHub theme={theme} titre={trPm('nouveau.vierge')} variante="plein" desactive={Boolean(enCours)} onPress={() => creer()} testID="esport-plans-nouveau-vierge" />
            <BoutonHub theme={theme} titre={trPm('fermer')} onPress={() => setChoixModele(false)} testID="esport-plans-choix-fermer" />
          </View>
          <Text style={{ ...attenue(theme, 12), fontWeight: '700' }}>{trPm('nouveau.depuis')}</Text>
          <View style={{ flexDirection: 'row', gap: ESP.xs, flexWrap: 'wrap' }}>
            {modeles.map(m => (
              <BoutonHub key={m.id} theme={theme} titre={m.titre} desactive={Boolean(enCours)} onPress={() => creer(m.id)} testID={`esport-plans-depuis-${m.id}`} />
            ))}
          </View>
        </View>
      ) : null}
      {!liste ? <SqueletteCartes theme={theme} n={large ? 3 : 1} large={large} /> : null}
      {vide ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="drapeau" titre={trPm('vide.titre')} texte={`${trPm('vide.texte')}${droits.editer ? '' : ` ${trPm('vide.lecture')}`}`} action={droits.editer ? { titre: trPm('nouveau'), onPress: () => creer(), testID: 'esport-plans-vide-nouveau' } : undefined} testID="esport-plans-vide" />
        </Carte>
      ) : null}
      {liste && !vide ? (
        <View testID="esport-plans-filtres" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: ESP.l, rowGap: large ? ESP.xs : ESP.s }}>
          <PastillesFiltre
            theme={theme}
            dense={large}
            libelle={trPm('filtre.statut')}
            valeur={filtres.statut ?? ''}
            tout={trPm('tous')}
            options={(droits.editer ? (['brouillon', 'pret', 'joue'] as const) : (['pret', 'joue'] as const)).map(s => ({ id: s, nom: trPm(`statut.${s}s` as ClePm) }))}
            onChoisir={v => setFiltres(f => ({ ...f, statut: (v || undefined) as StatutPlan | undefined }))}
            testID="esport-plans-filtre-statut"
          />
          {fac.adversaires.length > 1 ? <FiltreListe theme={theme} dense={large} libelle={trPm('filtre.adversaire')} valeur={filtres.adversaire ?? ''} options={fac.adversaires} tout={trPm('tous')} onChoisir={v => setFiltres(f => ({ ...f, adversaire: v || undefined }))} testID="esport-plans-filtre-adversaire" /> : null}
          {fac.cartes.length > 1 ? <FiltreListe theme={theme} dense={large} libelle={trPm('filtre.carte')} valeur={filtres.carte ?? ''} options={fac.cartes} tout={trPm('toutes')} onChoisir={v => setFiltres(f => ({ ...f, carte: v || undefined }))} testID="esport-plans-filtre-carte" /> : null}
          {filtre ? (
            <Pressable testID="esport-plans-filtres-effacer" accessibilityRole="button" onPress={() => setFiltres({})} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: large ? 32 : 44 }}>
              <Icone nom="croix" taille={14} couleur={theme.accent} />
              <Text style={{ ...texte(theme, 13), fontWeight: '600', color: theme.accent }}>{trPm('filtres.effacer')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {liste && !vide && visibles.length === 0 ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="loupe" titre={trPm('vide.filtres.titre')} texte={trPm('vide.filtres.texte')} action={{ titre: trPm('filtres.effacer'), onPress: () => setFiltres({}) }} testID="esport-plans-vide-filtres" />
        </Carte>
      ) : null}
      {prochains.length ? (
        <View style={{ gap: ESP.s }} testID="esport-plans-a-venir">
          <Text accessibilityRole="header" style={{ ...texte(theme, 15), fontWeight: '800' }}>
            {trPm('liste.a_venir')}
          </Text>
          {grille(prochains)}
        </View>
      ) : null}
      {passes.length ? (
        <View style={{ gap: ESP.s }} testID="esport-plans-passes">
          <Text accessibilityRole="header" style={{ ...texte(theme, 15), fontWeight: '800' }}>
            {trPm('liste.passes')}
          </Text>
          {grille(passes)}
        </View>
      ) : null}
      {droits.editer && modeles.length ? (
        <View style={{ gap: ESP.s }} testID="esport-plans-modeles">
          <View style={{ gap: 2 }}>
            <Text accessibilityRole="header" style={{ ...texte(theme, 15), fontWeight: '800' }}>
              {trPm('liste.modeles')}
            </Text>
            <Text style={attenue(theme, 12)}>{trPm('liste.modeles.aide')}</Text>
          </View>
          <GrilleEgale min={petit ? 260 : 270} gap={ESP.s}>
            {modeles.map(m => (
              <CarteResumePlan key={m.id} theme={theme} plan={m} onOuvrir={() => setOuvert(m.id)} action={<BoutonHub theme={theme} titre={trPm('liste.utiliser')} desactive={Boolean(enCours)} onPress={() => creer(m.id)} testID={`esport-plans-utiliser-${m.id}`} />} />
            ))}
          </GrilleEgale>
        </View>
      ) : null}
      <MentionRiot theme={theme} jeu={assets?.jeu} />
    </View>
  );
}

/** Corbeille : plans supprimés depuis moins de 30 jours, restaurables. */
function CorbeillePlans({ theme, api, teamId, onRestaure }: { theme: ThemeHub; api: ApiPlans; teamId: string; onRestaure(titre: string): void }) {
  const [lignes, setLignes] = useState<PlanCorbeille[] | undefined>();
  const { enCours, erreur, agir } = useAgir();
  const charger = useCallback(async () => setLignes(await api.corbeille(teamId)), [api, teamId]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  return (
    <View style={{ gap: ESP.s }}>
      <Retours theme={theme} erreur={erreur} prefixe="esport-plans-corbeille" />
      {lignes?.length === 0 ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="corbeille" titre={trPm('corbeille.vide')} testID="esport-plans-corbeille-vide" />
        </Carte>
      ) : null}
      {lignes?.map(l => (
        <View key={l.id} testID={`esport-plans-corbeille-${l.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, flexWrap: 'wrap', padding: ESP.s, borderRadius: 12, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface }}>
          <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
            <Text style={{ ...texte(theme, 15), fontWeight: '700' }}>{l.titre}</Text>
            <Text style={attenue(theme, 12)}>{trPm('corbeille.par', { qui: l.supprimePar?.pseudo ?? trPm('inconnu'), date: dateCourte(l.supprimeLe) })}</Text>
          </View>
          <BoutonHub
            theme={theme}
            titre={trPm('corbeille.restaurer')}
            desactive={Boolean(enCours)}
            onPress={() =>
              void agir('restauration', async () => {
                await api.restaurer(teamId, l.id);
                await charger();
                onRestaure(l.titre);
              })
            }
            testID={`esport-plans-restaurer-${l.id}`}
          />
        </View>
      ))}
    </View>
  );
}
