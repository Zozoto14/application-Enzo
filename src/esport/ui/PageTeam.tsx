/**
 * Page d'une team. Les modules activés sont rangés en cinq sections :
 *
 *  - Accueil ;
 *  - Agenda : Planning, Disponibilités, Présence ;
 *  - Jeu : Strats, Playbook, Review vidéo, Scouting ;
 *  - Équipe : Résumés, Objectifs et tâches, Membres et rôles ;
 *  - Réglages : Paramètres, Discord, Journal.
 *
 * Une section n'apparaît que si elle contient au moins un écran ouvert au
 * rôle ; dans une section, des sous-onglets (seulement les modules activés et
 * permis). PC : sections dans la barre latérale, sous l'Esport, avec le logo,
 * le nom et le sélecteur de team ; fil d'Ariane en haut de page. iPhone :
 * en-tête « ‹ Teams », logo et sélecteur ; sections dans la barre basse.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import type { ContexteHub } from '../../hub/types';
import { BarreOnglets } from '../../ui/mobile/BarreOnglets';
import { CATALOGUE, MENTION_DONNEES, nomModule, type ClientEsport, type DetailTeam, type Notifications, type TeamListee } from '../client';
import { dateCourte, phraseNotification } from '../libelles';
import type { SaisieEvenement } from '../planning/api';
import { AccueilPhase3 } from './AccueilPhase3';
import { CadreEsport, EntreeLaterale, type OngletEsport } from './CadreEsport';
import { Journal } from './Journal';
import { StatsTeam } from './StatsTeam';
import { MembresRoles } from './MembresRoles';
import { SectionObjectifs } from './Objectifs';
import { SectionResumes } from './Resumes';
import { ECRANS_MODULES, moduleAccessible } from './modules';
import { AccueilPlanning, ReglagesPlanning } from './planning/AccueilPlanning';
import { BoutonConfirme, Panneau, PastilleRole, Retours, TitreSection, styles, useAgir } from './commun';
import { CodeAffiche } from './CodeLiaison';
import { apiMonDiscord, type CodeLiaison, type MonDiscord } from '../discord/api';
import { AvatarTeam, Badge, Carte, ESP, EtatVide, LARGEUR_CONTENU, MenuActions, Onglets, Squelette, TitreCarte, TYPO, attenue as styleAttenue, couleurTeam, texte as styleTexte, titre as styleTitreEsport, type EtatPresse } from './design';

export type SectionTeam = 'accueil' | 'membres' | 'journal' | 'parametres' | `module:${string}`;
export type GroupeTeam = 'accueil' | 'agenda' | 'jeu' | 'equipe' | 'reglages';

/** Modules déjà disponibles (les autres activés apparaissent « bientôt »). */
const MODULES_DISPONIBLES = new Set(['meeting_summaries', 'goals_tasks']);

/** Les cinq sections d'une team, et l'ordre de leurs sous-onglets. */
export const GROUPES_TEAM: ReadonlyArray<{ id: GroupeTeam; libelle: string; glyphe: string; description: string; sections: readonly SectionTeam[] }> = [
  { id: 'accueil', libelle: 'Accueil', glyphe: '⌂', description: 'Accueil de la team', sections: ['accueil'] },
  { id: 'agenda', libelle: 'Agenda', glyphe: '◷', description: 'Agenda : planning, disponibilités, présence', sections: ['module:planning', 'module:availability', 'module:attendance'] },
  { id: 'jeu', libelle: 'Jeu', glyphe: '◎', description: 'Jeu : strats, playbook, review vidéo, scouting', sections: ['module:strat_editor', 'module:playbook', 'module:video_review', 'module:scouting'] },
  { id: 'equipe', libelle: 'Équipe', glyphe: '⚑', description: 'Équipe : résumés, objectifs et tâches, membres', sections: ['module:meeting_summaries', 'module:goals_tasks', 'membres'] },
  { id: 'reglages', libelle: 'Réglages', glyphe: '⚙︎', description: 'Réglages : paramètres, Discord, journal', sections: ['parametres', 'module:discord', 'journal'] },
];

/** Libellés courts des sous-onglets (iPhone) ; le nom complet reste le nom accessible. */
const COURTS: Record<string, string> = {
  'module:availability': 'Dispos',
  'module:video_review': 'Review',
  'module:goals_tasks': 'Objectifs',
  membres: 'Membres',
};

/** Groupe d'une section (une section inconnue va dans « Équipe »). */
export function groupeDe(section: SectionTeam): GroupeTeam {
  return GROUPES_TEAM.find(g => g.sections.includes(section))?.id ?? 'equipe';
}

/** Entrées de la barre : le cœur, puis les modules ACTIVÉS (Journal ouvert ; les autres « bientôt »). */
export function entreesBarre(detail: DetailTeam): Array<{ id: SectionTeam; libelle: string; bientot?: boolean }> {
  const actifs = new Set(detail.modules.filter(m => m.active).map(m => m.cle));
  const peut = (p: string) => detail.moi.permissions.includes(p);
  const entrees: Array<{ id: SectionTeam; libelle: string; bientot?: boolean }> = [{ id: 'accueil', libelle: 'Accueil' }];
  for (const m of CATALOGUE.modules) {
    if (!actifs.has(m.cle) || m.cle === 'activity_log') continue;
    const livre = Boolean(ECRANS_MODULES[m.cle]);
    if (livre && !moduleAccessible(m.cle, detail.moi.permissions)) continue;
    entrees.push({ id: `module:${m.cle}`, libelle: m.nom, bientot: !livre && !MODULES_DISPONIBLES.has(m.cle) });
  }
  if (peut('members.view') || peut('members.invite') || peut('roles.manage')) entrees.push({ id: 'membres', libelle: 'Membres et rôles' });
  if (actifs.has('activity_log') && peut('activity_log.view')) entrees.push({ id: 'journal', libelle: 'Journal' });
  entrees.push({ id: 'parametres', libelle: 'Paramètres' });
  return entrees;
}

export interface SectionNav {
  id: GroupeTeam;
  libelle: string;
  glyphe: string;
  description: string;
  entrees: Array<{ id: SectionTeam; libelle: string; court: string; bientot?: boolean }>;
}

/** Sections visibles de la team (non vides), avec leurs sous-onglets dans l'ordre. */
export function sectionsTeam(detail: DetailTeam): SectionNav[] {
  const entrees = entreesBarre(detail);
  return GROUPES_TEAM.map(g => ({
    id: g.id,
    libelle: g.libelle,
    glyphe: g.glyphe,
    description: g.description,
    entrees: entrees
      .filter(e => groupeDe(e.id) === g.id)
      .sort((a, b) => {
        const ia = g.sections.indexOf(a.id);
        const ib = g.sections.indexOf(b.id);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      })
      .map(e => ({ ...e, court: COURTS[e.id] ?? e.libelle })),
  })).filter(g => g.entrees.length > 0);
}

export function PageTeam({
  theme,
  client,
  teamId,
  large,
  sectionInitiale = 'accueil',
  onQuitter,
  onExporter,
  onMembresGlobal,
  onNaviguer,
  onChangerTeam,
  pseudo,
  contexte,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  teamId: string;
  large: boolean;
  sectionInitiale?: SectionTeam;
  onQuitter(): void;
  onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>;
  /** Page « Membres » de premier niveau (inviter, ajouter un compte existant). */
  onMembresGlobal?(): void;
  /** Navigation de premier niveau (barre latérale, PC). Défaut : retour aux teams. */
  onNaviguer?(o: OngletEsport): void;
  /** Sélecteur rapide : ouvrir une autre team, sur la même section si elle y existe. */
  onChangerTeam?(id: string, section: SectionTeam): void;
  pseudo?: string;
  /** Contexte du hub (comptes du hub à ajouter à la team depuis « Membres et rôles »). */
  contexte?: ContexteHub;
}) {
  const [detail, setDetail] = useState<DetailTeam | undefined>();
  const [section, setSection] = useState<SectionTeam>(sectionInitiale);
  const [derniers, setDerniers] = useState<Partial<Record<GroupeTeam, SectionTeam>>>({});
  const [teams, setTeams] = useState<TeamListee[] | undefined>();
  const [brouillon, setBrouillon] = useState<{ n: number; b?: Partial<SaisieEvenement>; reviewId?: string }>({ n: 0 });
  const aller = useCallback((s: SectionTeam, b?: Partial<SaisieEvenement>, reviewId?: string) => {
    setBrouillon(x => ({ n: x.n + 1, b, reviewId }));
    setSection(s);
    setDerniers(d => ({ ...d, [groupeDe(s)]: s }));
  }, []);
  const { erreur, agir } = useAgir();

  const recharger = useCallback(async () => setDetail(await client.team(teamId)), [client, teamId]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);
  useEffect(() => {
    if (!onChangerTeam) return;
    Promise.resolve()
      .then(() => client.teams())
      .then(setTeams, () => undefined);
  }, [client, onChangerTeam]);
  const sections = useMemo(() => (detail ? sectionsTeam(detail) : []), [detail]);
  const naviguer = (o: OngletEsport) => (onNaviguer ? onNaviguer(o) : onQuitter());

  if (!detail) {
    return (
      <CadreEsport theme={theme} large={large} onglet="teams" onOnglet={naviguer} pseudo={pseudo}>
        <View style={{ padding: large ? ESP.xxl : ESP.m, gap: ESP.m }} testID="esport-team-chargement">
          {erreur ? <Retours theme={theme} erreur={erreur} prefixe="esport-team" /> : <Squelette theme={theme} lignes={4} hauteur={18} />}
          <BoutonHub theme={theme} titre="← Teams" onPress={onQuitter} testID="esport-team-retour" />
        </View>
      </CadreEsport>
    );
  }
  const toutes = sections.flatMap(g => g.entrees);
  const active: SectionTeam = toutes.some(e => e.id === section) ? section : 'accueil';
  const groupe = sections.find(g => g.entrees.some(e => e.id === active)) ?? sections[0];
  const ouvrirGroupe = (g: SectionNav) => {
    const memo = derniers[g.id];
    aller(memo && g.entrees.some(e => e.id === memo) ? memo : g.entrees[0].id);
  };
  const autres = (teams ?? []).filter(t => t.id !== detail.team.id && !t.suspendu);
  const selecteur =
    onChangerTeam && autres.length ? (
      <MenuActions
        theme={theme}
        testID="esport-changer-team"
        libelle="Changer de team"
        titreBouton={large ? '⇄ Changer de team' : '⇄'}
        actions={autres.map(t => ({ titre: t.nom, onPress: () => onChangerTeam(t.id, active), testID: `esport-changer-team-${t.slug}` }))}
      />
    ) : null;
  const couleur = couleurTeam(detail.team.slug);
  const jeu = CATALOGUE.jeux.find(j => j.cle === detail.team.jeu)?.nom ?? detail.team.jeu;

  let contenu: React.ReactNode;
  if (active === 'membres') contenu = <MembresRoles theme={theme} client={client} detail={detail} large={large} onExporter={onExporter} onMembresGlobal={onMembresGlobal} contexte={contexte} />;
  else if (active === 'journal') contenu = <Journal theme={theme} client={client} detail={detail} onExporter={onExporter} />;
  else if (active === 'parametres') contenu = <Parametres theme={theme} client={client} detail={detail} large={large} onChange={recharger} onSupprimee={onQuitter} onExporter={onExporter} />;
  else if (active === 'module:meeting_summaries') contenu = <SectionResumes theme={theme} client={client} detail={detail} large={large} />;
  else if (active === 'module:goals_tasks') contenu = <SectionObjectifs theme={theme} client={client} detail={detail} large={large} onExporter={onExporter} />;
  else if (active.startsWith('module:') && ECRANS_MODULES[active.slice('module:'.length)]) {
    const Ecran = ECRANS_MODULES[active.slice('module:'.length)];
    contenu = <Ecran key={`${active}-${brouillon.n}`} theme={theme} client={client} detail={detail} large={large} onAller={aller} brouillon={brouillon.b} reviewId={brouillon.reviewId} onExporter={onExporter} />;
  } else if (active.startsWith('module:')) {
    const cle = active.slice('module:'.length);
    const module = CATALOGUE.modules.find(m => m.cle === cle);
    contenu = (
      <Carte theme={theme} testID={`esport-bientot-${cle}`}>
        <EtatVide theme={theme} glyphe="◔" titre={`${module?.nom ?? cle} : bientôt disponible`} texte={`${module?.description ?? ''} Ce module est activé pour la team : il arrivera dans une prochaine version (étape ${module?.phase} du plan).`} />
      </Carte>
    );
  } else contenu = <AccueilTeam theme={theme} client={client} detail={detail} large={large} onAller={aller} />;

  const sousOnglets =
    groupe && groupe.entrees.length > 1 ? (
      <Onglets
        theme={theme}
        prefixe="esport-onglet"
        testID="esport-sous-onglets"
        actif={active}
        pleineLargeur={!large}
        onChoisir={id => aller(id as SectionTeam)}
        entrees={groupe.entrees.map(e => ({ id: e.id, libelle: large ? e.libelle : e.court, description: e.libelle, bientot: e.bientot }))}
      />
    ) : null;

  // ---------------------------------------------------------------- PC : barre latérale
  const blocTeam = (
    <View style={{ gap: ESP.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, paddingHorizontal: ESP.xs, paddingBottom: ESP.xs }}>
        <AvatarTeam theme={theme} team={detail.team} taille={40} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={{ ...styleTexte(theme, 16), fontWeight: '800' }} numberOfLines={2}>
            {detail.team.nom}
          </Text>
          {detail.moi.role ? <PastilleRole theme={theme} nom={detail.moi.role.nom} couleur={detail.moi.role.couleur} /> : <Text style={styleAttenue(theme, 12)}>Super admin</Text>}
        </View>
      </View>
      {selecteur ? <View style={{ paddingHorizontal: ESP.xxs, paddingBottom: ESP.xs }}>{selecteur}</View> : null}
      <View testID="esport-barre" accessibilityRole="tablist" accessibilityLabel={`Sections de ${detail.team.nom}`} style={{ gap: ESP.xxs }}>
        {sections.map(g => (
          <EntreeLaterale
            key={g.id}
            theme={theme}
            libelle={g.libelle}
            glyphe={g.glyphe}
            description={g.description}
            choisi={g.id === groupe?.id}
            onPress={() => ouvrirGroupe(g)}
            testID={`esport-section-${g.id}`}
          />
        ))}
      </View>
    </View>
  );

  // ---------------------------------------------------------------- iPhone : en-tête et barre basse
  const enTeteMobile = (
    <View style={{ borderBottomWidth: 1, borderBottomColor: theme.ligne, backgroundColor: theme.surface }}>
      <View style={{ height: 3, backgroundColor: couleur }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, paddingHorizontal: ESP.xs, paddingVertical: ESP.xxs }}>
        <Pressable
          testID="esport-team-retour"
          accessibilityRole="button"
          accessibilityLabel="Retour aux teams"
          onPress={onQuitter}
          style={{ minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: ESP.xxs }}>
          <Text style={{ color: theme.accent, fontSize: 26, lineHeight: 28, marginTop: -2 }}>‹</Text>
          <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '600', ...police(theme.policeTexte) }}>Teams</Text>
        </Pressable>
        <AvatarTeam theme={theme} team={detail.team} taille={32} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ ...styleTexte(theme, 16), fontWeight: '800' }} numberOfLines={1}>
            {detail.team.nom}
          </Text>
          <Text style={styleAttenue(theme)} numberOfLines={1}>
            {`${groupe?.libelle ?? 'Accueil'} · ${detail.moi.role?.nom ?? 'Super admin'}`}
          </Text>
        </View>
        {selecteur}
      </View>
      {sousOnglets ? <View style={{ paddingHorizontal: ESP.xs }}>{sousOnglets}</View> : null}
    </View>
  );
  const barreBasse = (
    <View testID="esport-barre">
      <BarreOnglets theme={theme} testID="esport-section" actif={groupe?.id} onChoisir={c => ouvrirGroupe(sections.find(g => g.id === c) ?? sections[0])} entrees={sections.map(g => ({ cle: g.id, libelle: g.libelle, glyphe: g.glyphe, description: g.description }))} />
    </View>
  );

  return (
    <CadreEsport theme={theme} large={large} onglet="teams" onOnglet={naviguer} pseudo={pseudo} blocTeam={blocTeam} enTeteMobile={enTeteMobile} barreBasse={barreBasse}>
      <View style={{ flex: 1 }} testID="esport-team">
        {large ? <View style={{ height: 4, backgroundColor: couleur }} /> : null}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: large ? ESP.xxl : ESP.m, paddingTop: large ? ESP.l : ESP.m, paddingBottom: ESP.xxxl, gap: large ? ESP.l : ESP.m, maxWidth: LARGEUR_CONTENU + 2 * ESP.xxl, width: '100%', alignSelf: 'center' }}>
          {large ? (
            <View style={{ gap: ESP.s }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xxs, flexWrap: 'wrap' }} accessibilityRole="navigation" aria-label="Fil d’Ariane">
                <Pressable testID="esport-team-retour" accessibilityRole="link" onPress={onQuitter} style={{ minHeight: 32, justifyContent: 'center' }}>
                  <Text style={{ ...styleTexte(theme, 14), color: theme.accent, fontWeight: '600' }}>Teams</Text>
                </Pressable>
                <Text style={styleAttenue(theme, 14)}>›</Text>
                <Text style={{ ...styleTexte(theme, 14), fontWeight: '600' }}>{detail.team.nom}</Text>
                <Text style={styleAttenue(theme, 14)}>›</Text>
                <Text style={styleAttenue(theme, 14)}>{groupe?.libelle}</Text>
                <View style={{ flex: 1 }} />
                <Text style={styleAttenue(theme, 14)}>{`${jeu} · ${detail.membres} membre${detail.membres > 1 ? 's' : ''}`}</Text>
              </View>
              {sousOnglets}
            </View>
          ) : null}
          <View style={{ gap: large ? ESP.l : ESP.m }} testID={`esport-contenu-${active.replace(':', '-')}`}>
            {contenu}
          </View>
        </ScrollView>
      </View>
    </CadreEsport>
  );
}

function AccueilTeam({ theme, client, detail, large, onAller }: { theme: ThemeHub; client: ClientEsport; detail: DetailTeam; large: boolean; onAller(s: SectionTeam, b?: Partial<SaisieEvenement>): void }) {
  const [notifs, setNotifs] = useState<Notifications | undefined>();
  useEffect(() => {
    client.notifications().then(setNotifs, () => undefined);
  }, [client]);
  const actifs = detail.modules.filter(m => m.active).map(m => m.cle);
  const miennes = notifs?.liste.filter(n => n.team?.id === detail.team.id).slice(0, 5) ?? [];
  const jeu = CATALOGUE.jeux.find(j => j.cle === detail.team.jeu)?.nom ?? detail.team.jeu;
  const couleur = couleurTeam(detail.team.slug);
  const colonneDroite = (
    <View style={{ gap: ESP.m, flex: large ? 1 : undefined, minWidth: 0 }}>
      <Carte theme={theme} testID="esport-accueil-equipe">
        <TitreCarte theme={theme} titre="L’équipe" droite={detail.moi.permissions.includes('members.view') ? <BoutonHub theme={theme} titre="Voir" onPress={() => onAller('membres')} testID="esport-accueil-membres" /> : undefined} />
        <View style={{ flexDirection: 'row', gap: ESP.l, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <View style={{ gap: 2 }}>
            <Text style={{ color: theme.texte, fontSize: 30, fontWeight: '700', ...police(theme.policeChiffres) }}>{detail.membres}</Text>
            <Text style={styleAttenue(theme)}>{`membre${detail.membres > 1 ? 's' : ''}`}</Text>
          </View>
          <View style={{ gap: ESP.xxs, flexShrink: 1 }}>
            <Text style={styleAttenue(theme)}>Mon rôle</Text>
            {detail.moi.role ? <PastilleRole theme={theme} nom={detail.moi.role.nom} couleur={detail.moi.role.couleur} testID="esport-mon-role" /> : <Text style={styleTexte(theme)}>Super admin (Fondateur)</Text>}
          </View>
        </View>
        <Text style={styleAttenue(theme)} numberOfLines={3}>
          {actifs.map(nomModule).join(' · ') || 'Aucun module activé'}
        </Text>
      </Carte>
      <Carte theme={theme} testID="esport-accueil-notifications">
        <TitreCarte theme={theme} titre="Notifications" />
        {miennes.length === 0 ? <Text style={styleAttenue(theme, TYPO.texte)}>Rien de nouveau.</Text> : null}
        {miennes.map(n => (
          <View key={n.id} style={{ flexDirection: 'row', gap: ESP.xs, alignItems: 'flex-start' }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: n.lue ? theme.ligne : theme.accent }} />
            <Text style={{ ...styleTexte(theme), flex: 1, fontWeight: n.lue ? '400' : '700' }}>
              {phraseNotification(n, notifs?.noms ?? {})} <Text style={styleAttenue(theme)}>· {dateCourte(n.date)}</Text>
            </Text>
          </View>
        ))}
      </Carte>
    </View>
  );
  return (
    <View style={{ gap: large ? ESP.xl : ESP.m }} testID="esport-accueil-team">
      {/* iPhone : l'en-tête montre déjà la team ; les prochains événements passent en premier. */}
      {large ? (
      <Carte theme={theme} accent={couleur} style={{ paddingTop: ESP.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.m }}>
          <AvatarTeam theme={theme} team={detail.team} taille={large ? 64 : 48} />
          <View style={{ flex: 1, minWidth: 0, gap: ESP.xxs }}>
            <Text accessibilityRole="header" style={styleTitreEsport(theme, large ? TYPO.titrePage : TYPO.titrePageMobile)} numberOfLines={2}>
              {detail.team.nom}
            </Text>
            <Text style={styleAttenue(theme, TYPO.sousTitre)} numberOfLines={3}>
              {detail.team.description || `${jeu} · ${detail.membres} membre(s)`}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: ESP.xs, flexWrap: 'wrap' }}>
          <Badge theme={theme} texte={jeu} couleur={couleur} />
          <Badge theme={theme} texte={`${detail.membres} membre${detail.membres > 1 ? 's' : ''}`} />
          {detail.team.archivee ? <Badge theme={theme} ton="alerte" texte="Archivée" /> : null}
        </View>
      </Carte>
      ) : null}
      <View style={large ? { flexDirection: 'row', gap: ESP.l, alignItems: 'flex-start' } : { gap: ESP.m }}>
        {/* Planning d'abord : sur iPhone, répondre doit se faire sans défiler. */}
        <View style={{ gap: ESP.m, flex: large ? 1.6 : undefined, minWidth: 0 }}>
          <AccueilPlanning theme={theme} client={client} detail={detail} onAller={onAller} />
          <AccueilPhase3 theme={theme} client={client} detail={detail} onAller={onAller} />
        </View>
        {colonneDroite}
      </View>
      <StatsTeam theme={theme} client={client} detail={detail} />
    </View>
  );
}

function Parametres({
  theme,
  client,
  detail,
  large,
  onChange,
  onSupprimee,
  onExporter,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  detail: DetailTeam;
  large: boolean;
  onChange(): Promise<void>;
  onSupprimee(): void;
  onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>;
}) {
  const [nom, setNom] = useState(detail.team.nom);
  const [description, setDescription] = useState(detail.team.description);
  const { enCours, erreur, avis, agir } = useAgir();
  const peut = (p: string) => detail.moi.permissions.includes(p);
  const gerer = peut('modules.manage');
  // Modules rangés par section (comme la navigation de la team).
  const parGroupe = GROUPES_TEAM.filter(g => g.id !== 'accueil').map(g => ({
    ...g,
    modules: CATALOGUE.modules.filter(m => groupeDe(m.cle === 'activity_log' ? 'journal' : `module:${m.cle}`) === g.id),
  }));
  const gauche = (
    <View style={{ gap: ESP.m, flex: large ? 1 : undefined, minWidth: 0 }}>
      {peut('team.manage') ? (
        <Panneau theme={theme}>
          <TitreCarte theme={theme} titre="La team" sous="Nom et description, visibles de tous les membres." />
          <Champ theme={theme} libelle="Nom" valeur={nom} onChanger={setNom} maxLength={60} testID="esport-parametres-nom" />
          <Champ theme={theme} libelle="Description" valeur={description} onChanger={setDescription} maxLength={500} multiligne testID="esport-parametres-description" />
          <View style={{ alignSelf: 'flex-start' }}>
            <BoutonHub
              theme={theme}
              titre="Enregistrer"
              variante="plein"
              desactive={Boolean(enCours)}
              onPress={() =>
                void agir('Team', async () => {
                  await client.modifierTeam(detail.team.id, { nom: nom.trim(), description });
                  await onChange();
                  return 'Team enregistrée.';
                })
              }
              testID="esport-parametres-enregistrer"
            />
          </View>
        </Panneau>
      ) : null}
      <Panneau theme={theme} testID="esport-parametres-modules">
        <TitreCarte
          theme={theme}
          titre="Modules"
          sous={gerer ? 'Désactiver un module le cache (et ferme ses routes) sans rien effacer : le réactiver rend tout.' : 'Seul le Propriétaire active ou désactive les modules.'}
        />
        {parGroupe.map(g => (
          <View key={g.id} style={{ gap: ESP.xxs }}>
            <Text style={{ ...styleAttenue(theme, 12), fontWeight: '700', letterSpacing: 1 }}>{g.libelle.toUpperCase()}</Text>
            {g.modules.map(m => {
              const actif = detail.modules.some(x => x.cle === m.cle && x.active);
              const bientot = m.cle !== 'activity_log' && !ECRANS_MODULES[m.cle] && !MODULES_DISPONIBLES.has(m.cle);
              return (
                <Pressable
                  key={m.cle}
                  testID={gerer ? `esport-parametres-module-${m.cle}` : undefined}
                  accessibilityRole={gerer ? 'checkbox' : undefined}
                  accessibilityState={gerer ? { checked: actif } : undefined}
                  accessibilityLabel={m.nom}
                  disabled={!gerer}
                  onPress={() =>
                    void agir('Modules', async () => {
                      await client.changerModules(detail.team.id, { [m.cle]: !actif });
                      await onChange();
                      return `${m.nom} ${!actif ? 'activé' : 'désactivé'}.`;
                    })
                  }
                  style={(etat: EtatPresse) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: ESP.s,
                    minHeight: 44,
                    paddingHorizontal: ESP.xs,
                    borderRadius: 8,
                    backgroundColor: gerer && etat.hovered ? teinteTransparente(theme.accent, 0.08) : 'transparent',
                  })}>
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: theme.id === 'terminal' ? 0 : 6,
                      borderWidth: 2,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderColor: actif ? theme.accent : theme.attenue,
                      backgroundColor: actif ? theme.accent : 'transparent',
                      opacity: gerer ? 1 : 0.6,
                    }}>
                    <Text style={{ color: theme.surAccent, fontSize: 13, fontWeight: '800' }}>{actif ? '✓' : ''}</Text>
                  </View>
                  <Text style={{ ...styleTexte(theme), flex: 1 }}>
                    {m.nom}
                    {bientot ? <Text style={styleAttenue(theme)}> · bientôt</Text> : null}
                  </Text>
                  <Text style={styleAttenue(theme)}>{actif ? 'Activé' : 'Désactivé'}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </Panneau>
    </View>
  );
  const droite = (
    <View style={{ gap: ESP.m, flex: large ? 1 : undefined, minWidth: 0 }}>
      <ReglagesPlanning theme={theme} client={client} detail={detail} onChange={onChange} />
      <MonProfil theme={theme} client={client} onExporter={onExporter} />
      {peut('team.delete') ? (
        <Panneau theme={theme} style={{ borderColor: teinteTransparente(theme.critique, 0.5) }}>
          <TitreCarte theme={theme} titre="Zone sensible" sous="La suppression est définitive : planning, résumés, strats et journal de la team." />
          <BoutonConfirme
            theme={theme}
            titre="Supprimer la team"
            confirmation={`Oui, supprimer « ${detail.team.nom} »`}
            onConfirme={() =>
              void agir('Suppression', async () => {
                await client.supprimerTeam(detail.team.id);
                onSupprimee();
              })
            }
            testID="esport-parametres-supprimer"
          />
        </Panneau>
      ) : null}
    </View>
  );
  return (
    <View style={{ gap: ESP.l }} testID="esport-parametres">
      <TitreSection theme={theme} titre="Paramètres" sous="La team, ses modules, le planning et votre profil." />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-parametres" />
      <View style={large ? { flexDirection: 'row', gap: ESP.l, alignItems: 'flex-start' } : { gap: ESP.m }}>
        {gauche}
        {droite}
      </View>
    </View>
  );
}

/**
 * « Lier mon Discord » : un code à usage unique (10 min) à taper dans Discord
 * (/lier code:XXXX) ; le bot pourra alors me mentionner quand je suis convoqué.
 * Délier à tout moment. Rien ne s'affiche si le serveur ne connaît pas le bot.
 */
export function LierDiscord({ theme, client }: { theme: ThemeHub; client: ClientEsport }) {
  const api = React.useMemo(() => apiMonDiscord(client), [client]);
  const [etat, setEtat] = useState<MonDiscord | undefined>();
  const [code, setCode] = useState<CodeLiaison | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();
  const recharger = React.useCallback(async () => {
    setEtat(await Promise.resolve().then(() => api.etat()).catch(() => undefined));
  }, [api]);
  useEffect(() => {
    void recharger();
  }, [recharger]);
  if (!etat || (!etat.botDisponible && !etat.lie)) return null;
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  return (
    <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 10 }} testID="esport-lier-discord">
      <Text style={{ color: theme.texte, fontWeight: '700', ...police(theme.policeTexte) }}>Bot Discord</Text>
      {etat.lie ? (
        <Text style={{ color: theme.texte, ...police(theme.policeTexte) }} testID="esport-lier-discord-etat">
          ✓ Discord lié{etat.discordNom ? ` : ${etat.discordNom}` : ''}. Le bot vous mentionne quand vous êtes convoqué.
        </Text>
      ) : (
        <Text style={attenue}>Liez votre compte Discord : le bot vous mentionnera pour vos scrims et matchs, et vous répondrez d’un clic.</Text>
      )}
      {code && !etat.lie ? <CodeAffiche theme={theme} code={code} testID="esport-lier-discord-code" /> : null}
      <View style={styles.ligne}>
        <BoutonHub
          theme={theme}
          titre={etat.lie ? 'Lier un autre compte Discord' : 'Lier mon Discord'}
          variante={etat.lie ? undefined : 'plein'}
          desactive={Boolean(enCours) || !etat.botDisponible}
          onPress={() =>
            void agir('Code', async () => {
              setCode(await api.code());
              setEtat({ ...etat, lie: false });
              return 'Tapez la commande affichée dans le serveur Discord de la team.';
            })
          }
          testID="esport-lier-discord-bouton"
        />
        {etat.lie ? (
          <BoutonHub
            theme={theme}
            titre="Délier mon Discord"
            desactive={Boolean(enCours)}
            onPress={() =>
              void agir('Délier', async () => {
                await api.delier();
                await recharger();
                return 'Discord délié.';
              })
            }
            testID="esport-lier-discord-delier"
          />
        ) : (
          <BoutonHub theme={theme} titre="J’ai tapé le code" desactive={Boolean(enCours) || !code} onPress={() => void agir('', recharger)} testID="esport-lier-discord-verifier" />
        )}
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-lier-discord" />
    </View>
  );
}

/** Profil Esport, mention des données, export et suppression (RGPD). */
export function MonProfil({ theme, client, onExporter, onSupprime }: { theme: ThemeHub; client: ClientEsport; onExporter?(nom: string, contenu: string): Promise<boolean>; onSupprime?(): void }) {
  const [profil, setProfil] = useState<{ pseudo: string; riotId: string; discord: string } | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();
  useEffect(() => {
    client.moi().then(m => setProfil({ pseudo: m.profil?.pseudo ?? '', riotId: m.profil?.riotId ?? '', discord: m.profil?.discord ?? '' }), () => undefined);
  }, [client]);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  if (!profil) return null;
  return (
    <Panneau theme={theme} testID="esport-mon-profil">
      <TitreCarte theme={theme} titre="Mon profil Esport" sous="Ce que voient vos coéquipiers." />
      <Champ theme={theme} libelle="Pseudo (obligatoire)" valeur={profil.pseudo} onChanger={pseudo => setProfil({ ...profil, pseudo })} maxLength={24} testID="esport-profil-pseudo" />
      <Champ theme={theme} libelle="Riot ID (facultatif, Pseudo#TAG)" valeur={profil.riotId} onChanger={riotId => setProfil({ ...profil, riotId })} maxLength={22} testID="esport-profil-riot" />
      <Champ theme={theme} libelle="Discord (facultatif)" valeur={profil.discord} onChanger={discord => setProfil({ ...profil, discord })} maxLength={32} testID="esport-profil-discord" />
      <LierDiscord theme={theme} client={client} />
      <View style={styles.ligne}>
        <BoutonHub
          theme={theme}
          titre="Enregistrer le profil"
          variante="plein"
          desactive={Boolean(enCours)}
          onPress={() =>
            void agir('Profil', async () => {
              await client.majProfil({ pseudo: profil.pseudo.trim(), riotId: profil.riotId.trim() || undefined, discord: profil.discord.trim() || undefined });
              return 'Profil enregistré.';
            })
          }
          testID="esport-profil-enregistrer"
        />
        {onExporter ? (
          <BoutonHub
            theme={theme}
            titre="Exporter mes données"
            onPress={() =>
              void agir('Export', async () => {
                const donnees = await client.exporterMesDonnees();
                const ok = await onExporter('esport-mes-donnees.json', JSON.stringify(donnees, null, 2));
                return ok ? 'Export enregistré.' : undefined;
              })
            }
            testID="esport-profil-exporter"
          />
        ) : null}
        <BoutonConfirme
          theme={theme}
          titre="Supprimer mes données Esport"
          confirmation="Oui, tout supprimer"
          onConfirme={() =>
            void agir('Suppression', async () => {
              await client.supprimerMesDonnees();
              onSupprime?.();
              return 'Vos données Esport sont supprimées.';
            })
          }
          testID="esport-profil-supprimer"
        />
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-profil" />
      <Text style={attenue} testID="esport-mention">
        {MENTION_DONNEES}
      </Text>
    </Panneau>
  );
}
