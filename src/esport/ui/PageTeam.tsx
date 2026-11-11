/**
 * Page d'une team. Les modules activés sont rangés en six sections :
 *
 *  - Accueil ;
 *  - Agenda : Planning, Disponibilités, Présence ;
 *  - Jeu : Strats, Playbook, Ressources, Review vidéo, Scouting ;
 *  - Compétition : Tournois, Résultats (sur petite largeur : rangés dans Agenda,
 *    la barre basse reste à cinq sections) ;
 *  - Équipe : Résumés, Objectifs et tâches, Suivi joueurs, Membres et rôles ;
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
import { apiJeux } from '../jeux/api';
import { oublierProfilsTeams } from '../jeux/profil';
import { CATALOGUE, mentionDonnees, nomModule, type ClientEsport, type DetailTeam, type TeamListee, nomRole, nomJeu, descriptionModule } from '../client';
import type { SaisieEvenement } from '../planning/api';
import { AccueilPhase3 } from './AccueilPhase3';
import { AccueilCompetition } from './AccueilCompetition';
import { MonSuivi } from './MonSuivi';
import { CadreEsport, EntreeLaterale, SiBarreEtendue, type OngletEsport } from './CadreEsport';
import { Journal } from './Journal';
import { StatsTeam } from './StatsTeam';
import { MembresRoles } from './MembresRoles';
import { SectionObjectifs } from './Objectifs';
import { SectionResumes } from './Resumes';
import { ECRANS_MODULES, moduleAccessible } from './modules';
import { AccueilPlanning, ReglagesPlanning } from './planning/AccueilPlanning';
import { EspaceTeam } from './medias/Espace';
import { ReglagesTranscriptionTeam } from './medias/TranscriptionServeur';
import { BoutonConfirme, Choix, Panneau, PastilleRole, Retours, TitreSection, styles, useAgir } from './commun';
import { CodeAffiche } from './CodeLiaison';
import { apiMonDiscord, type CodeLiaison, type MonDiscord } from '../discord/api';
import { AvatarTeam, Badge, COULEUR_CM_CLUB, Carte, ESP, EtatVide, LARGEUR_CONTENU, MenuActions, Onglets, Squelette, TitreCarte, TYPO, attenue as styleAttenue, couleurTeam, texte as styleTexte, titre as styleTitreEsport, type EtatPresse } from './design';
import { NOM_LANGUE, definirLangue, tr, trn, useLangue, type Langue } from '../i18n';
import { ChoixLangue } from './ChoixLangue';
import { ReglageRecapCourriel } from './DiscordId';
import { noterPage, pageDeSection } from '../usage';
import { MaFicheTrombi } from './differe';
import { apiTrombi } from '../trombi/api';
import { trTb } from '../i18n/trombi';
import { ZoneEcriture } from './ecriture/ZoneEcriture';

export type SectionTeam = 'accueil' | 'membres' | 'journal' | 'parametres' | `module:${string}`;
export type GroupeTeam = 'accueil' | 'agenda' | 'jeu' | 'competition' | 'equipe' | 'reglages';

/** Modules déjà disponibles (les autres activés apparaissent « bientôt »). */
const MODULES_DISPONIBLES = new Set(['meeting_summaries', 'goals_tasks']);

/** Les six sections d'une team, et l'ordre de leurs sous-onglets. */
export const GROUPES_TEAM: ReadonlyArray<{ id: GroupeTeam; libelle: string; glyphe: string; description: string; sections: readonly SectionTeam[] }> = [
  { id: 'accueil', get libelle() {
      return tr('pageTeam.accueil');
    }, glyphe: 'accueil', get description() {
      return tr('pageTeam.accueil_de_la_team');
    }, sections: ['accueil'] },
  { id: 'agenda', get libelle() {
      return tr('pageTeam.agenda');
    }, glyphe: 'calendrier', get description() {
      return tr('pageTeam.agenda_planning_disponibilites');
    }, sections: ['module:planning', 'module:availability', 'module:attendance'] },
  { id: 'jeu', get libelle() {
      return tr('assistant.jeu');
    }, glyphe: 'viseur', get description() {
      return tr('pageTeam.jeu_strats_playbook_review');
    }, sections: ['module:strat_editor', 'module:playbook', 'module:resources', 'module:video_review', 'module:scouting'] },
  { id: 'competition', get libelle() {
      return tr('pageTeam.competition');
    }, glyphe: 'trophee', get description() {
      return tr('pageTeam.competition_description');
    }, sections: ['module:tournois', 'module:resultats'] },
  { id: 'equipe', get libelle() {
      return tr('pageTeam.equipe');
    }, glyphe: 'drapeau', get description() {
      return tr('pageTeam.equipe_resumes_objectifs_et');
    }, sections: ['module:meeting_summaries', 'module:goals_tasks', 'module:player_notes', 'module:cm', 'membres'] },
  { id: 'reglages', get libelle() {
      return tr('pageTeam.reglages');
    }, glyphe: 'reglages', get description() {
      return tr('pageTeam.reglages_parametres_discord_jo');
    }, sections: ['parametres', 'module:discord', 'journal'] },
];

/** Libellés courts des sous-onglets (iPhone) ; le nom complet reste le nom accessible. */
const COURTS: Record<string, string> = {
  get 'module:availability'() {
      return tr('pageTeam.dispos');
    },
  get 'module:video_review'() {
      return tr('review.review.review');
    },
  get 'module:goals_tasks'() {
      return tr('objectifs.objectifs');
    },
  get membres() {
      return tr('dashboard.membres');
    },
  get 'module:player_notes'() {
      return tr('suivi.court');
    },
};

/** Sections de la section « Compétition » repliées dans « Agenda » sur petite largeur (la barre basse ne porte que cinq sections). */
const COMPETITION_MOBILE: readonly SectionTeam[] = ['module:tournois', 'module:resultats'];

/** Groupe d'une section (une section inconnue va dans « Équipe »). Sur petite largeur (`large` faux), Tournois et Résultats sont dans « Agenda ». */
export function groupeDe(section: SectionTeam, large = true): GroupeTeam {
  if (!large && COMPETITION_MOBILE.includes(section)) return 'agenda';
  return GROUPES_TEAM.find(g => g.sections.includes(section))?.id ?? 'equipe';
}

/** Entrées de la barre : le cœur, puis les modules ACTIVÉS (Journal ouvert ; les autres « bientôt »). */
export function entreesBarre(detail: DetailTeam): Array<{ id: SectionTeam; libelle: string; bientot?: boolean }> {
  const actifs = new Set(detail.modules.filter(m => m.active).map(m => m.cle));
  const peut = (p: string) => detail.moi.permissions.includes(p);
  const entrees: Array<{ id: SectionTeam; libelle: string; bientot?: boolean }> = [{ id: 'accueil', libelle: tr('pageTeam.accueil') }];
  for (const m of CATALOGUE.modules) {
    if (!actifs.has(m.cle) || m.cle === 'activity_log') continue;
    const livre = Boolean(ECRANS_MODULES[m.cle]);
    if (livre && !moduleAccessible(m.cle, detail.moi.permissions)) continue;
    entrees.push({ id: `module:${m.cle}`, libelle: nomModule(m.cle), bientot: !livre && !MODULES_DISPONIBLES.has(m.cle) });
  }
  if (peut('members.view') || peut('members.invite') || peut('roles.manage')) entrees.push({ id: 'membres', libelle: tr('membresRoles.membres_et_roles') });
  if (actifs.has('activity_log') && peut('activity_log.view')) entrees.push({ id: 'journal', libelle: tr('journal.journal') });
  entrees.push({ id: 'parametres', libelle: tr('pageTeam.parametres') });
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
export function sectionsTeam(detail: DetailTeam, large = true): SectionNav[] {
  const entrees = entreesBarre(detail);
  return GROUPES_TEAM.filter(g => large || g.id !== 'competition').map(g => ({
    id: g.id,
    libelle: g.libelle,
    glyphe: g.glyphe,
    description: g.description,
    entrees: entrees
      .filter(e => groupeDe(e.id, large) === g.id)
      .sort((a, b) => {
        const ordre = large || g.id !== 'agenda' ? g.sections : [...g.sections, ...COMPETITION_MOBILE];
        const ia = ordre.indexOf(a.id);
        const ib = ordre.indexOf(b.id);
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
  administration,
  tickets,
  compteurTickets,
  onChangerTeam,
  onOuvrirCm,
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
  /** Au moins une permission d'administration du club : entrée « Administration » de la navigation (PC). */
  administration?: boolean;
  /** Tickets Discord (tickets.voir ou tickets.configurer) : entrée « Tickets » de la navigation (PC). */
  tickets?: boolean;
  /** Tickets non lus : pastille de l'entrée « Tickets ». */
  compteurTickets?: number;
  /** Sélecteur rapide : ouvrir une autre team, sur la même section si elle y existe. */
  onChangerTeam?(id: string, section: SectionTeam): void;
  /** Le compte a accès à l'espace CM du club (mêmes conditions que la tuile « CM du club ») : le sélecteur le propose en tête. */
  onOuvrirCm?(): void;
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
    setDerniers(d => ({ ...d, [groupeDe(s, large)]: s }));
  }, [large]);
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
  const sections = useMemo(() => (detail ? sectionsTeam(detail, large) : []), [detail, large]);
  const naviguer = (o: OngletEsport) => (onNaviguer ? onNaviguer(o) : onQuitter());
  // Statistiques d'usage : section ouverte (« team.agenda.planning »…), une fois la team chargée.
  const sectionVue: SectionTeam = sections.some(g => g.entrees.some(e => e.id === section)) ? section : 'accueil';
  const charge = Boolean(detail);
  useEffect(() => {
    if (charge) noterPage(pageDeSection(groupeDe(sectionVue), sectionVue), teamId);
  }, [charge, sectionVue, teamId]);

  if (!detail) {
    return (
      <CadreEsport theme={theme} large={large} onglet="teams" onOnglet={naviguer} pseudo={pseudo} administration={administration} tickets={tickets} compteurs={{ tickets: compteurTickets }}>
        <View style={{ padding: large ? ESP.xxl : ESP.m, gap: ESP.m }} testID="esport-team-chargement">
          {erreur ? <Retours theme={theme} erreur={erreur} prefixe="esport-team" /> : <Squelette theme={theme} lignes={4} hauteur={18} />}
          <BoutonHub theme={theme} titre={tr('pageTeam.teams')} onPress={onQuitter} testID="esport-team-retour" />
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
  // Le CM du club : par l'entrée « CM du club » (son espace), pas comme une team de plus.
  const autres = (teams ?? []).filter(t => t.id !== detail.team.id && !t.suspendu && !(onOuvrirCm && t.genre === 'cm'));
  const selecteur =
    onChangerTeam && (autres.length || onOuvrirCm) ? (
      <MenuActions
        theme={theme}
        testID="esport-changer-team"
        libelle={tr('pageTeam.changer_de_team')}
        titreBouton={large ? tr('pageTeam.changer_de_team_2') : '⇄'}
        actions={[
          ...(onOuvrirCm ? [{ titre: tr('cm.club_titre'), onPress: onOuvrirCm, testID: 'esport-changer-cm', pastille: { texte: 'CM', couleur: COULEUR_CM_CLUB } }] : []),
          ...autres.map(t => ({ titre: t.nom, onPress: () => onChangerTeam(t.id, active), testID: `esport-changer-team-${t.slug}`, pastille: { couleur: couleurTeam(t.slug) } })),
        ]}
      />
    ) : null;
  const couleur = couleurTeam(detail.team.slug);
  const jeu = nomJeu(detail.team.jeu, detail.team.jeuNom);

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
        <EtatVide theme={theme} glyphe="◔" titre={tr('pageTeam.bientot_disponible', { nom: module ? nomModule(module.cle) : cle })} texte={tr('pageTeam.module_a_venir', { description: module ? descriptionModule(module.cle) : '', phase: module?.phase ?? '?' })} />
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
        <SiBarreEtendue>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={{ ...styleTexte(theme, 16), fontWeight: '800' }} numberOfLines={2}>
              {detail.team.nom}
            </Text>
            {detail.moi.role ? <PastilleRole theme={theme} nom={nomRole(detail.moi.role.nom)} couleur={detail.moi.role.couleur} /> : <Text style={styleAttenue(theme, 12)}>{tr('pageTeam.super_admin')}</Text>}
          </View>
        </SiBarreEtendue>
      </View>
      {selecteur ? (
        <SiBarreEtendue>
          <View style={{ paddingHorizontal: ESP.xxs, paddingBottom: ESP.xs }}>{selecteur}</View>
        </SiBarreEtendue>
      ) : null}
      <View testID="esport-barre" accessibilityRole="tablist" accessibilityLabel={tr('pageTeam.sections_de', { nom: detail.team.nom })} style={{ gap: ESP.xxs }}>
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
          accessibilityLabel={tr('pageTeam.retour_aux_teams')}
          onPress={onQuitter}
          style={{ minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: ESP.xxs }}>
          <Text style={{ color: theme.accent, fontSize: 26, lineHeight: 28, marginTop: -2 }}>‹</Text>
          <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '600', ...police(theme.policeTexte) }}>{tr('dashboard.teams')}</Text>
        </Pressable>
        <AvatarTeam theme={theme} team={detail.team} taille={32} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ ...styleTexte(theme, 16), fontWeight: '800' }} numberOfLines={1}>
            {detail.team.nom}
          </Text>
          <Text style={styleAttenue(theme)} numberOfLines={1}>
            {`${groupe?.libelle ?? tr('pageTeam.accueil')} · ${detail.moi.role ? nomRole(detail.moi.role.nom) : tr('pageTeam.super_admin')}`}
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
    <CadreEsport theme={theme} large={large} onglet="teams" onOnglet={naviguer} pseudo={pseudo} administration={administration} tickets={tickets} compteurs={{ tickets: compteurTickets }} blocTeam={blocTeam} enTeteMobile={enTeteMobile} barreBasse={barreBasse}>
      <View style={{ flex: 1 }} testID="esport-team">
        {large ? <View style={{ height: 4, backgroundColor: couleur }} /> : null}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: large ? ESP.xxl : ESP.m, paddingTop: large ? ESP.l : ESP.m, paddingBottom: ESP.xxxl, gap: large ? ESP.l : ESP.m, maxWidth: LARGEUR_CONTENU + 2 * ESP.xxl, width: '100%', alignSelf: 'center' }}>
          {large ? (
            <View style={{ gap: ESP.s }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xxs, flexWrap: 'wrap' }} accessibilityRole="navigation" aria-label={tr('pageTeam.fil_d_ariane')}>
                <Pressable testID="esport-team-retour" accessibilityRole="link" onPress={onQuitter} style={{ minHeight: 32, justifyContent: 'center' }}>
                  <Text style={{ ...styleTexte(theme, 14), color: theme.accent, fontWeight: '600' }}>{tr('dashboard.teams')}</Text>
                </Pressable>
                <Text style={styleAttenue(theme, 14)}>›</Text>
                <Text style={{ ...styleTexte(theme, 14), fontWeight: '600' }}>{detail.team.nom}</Text>
                <Text style={styleAttenue(theme, 14)}>›</Text>
                <Text style={styleAttenue(theme, 14)}>{groupe?.libelle}</Text>
                <View style={{ flex: 1 }} />
                <Text style={styleAttenue(theme, 14)}>{`${jeu} · ${trn('statsTeam.membres', detail.membres)}`}</Text>
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
  const actifs = detail.modules.filter(m => m.active).map(m => m.cle);
  const jeu = nomJeu(detail.team.jeu, detail.team.jeuNom);
  const couleur = couleurTeam(detail.team.slug);
  const colonneDroite = (
    <View style={{ gap: ESP.m, flex: large ? 1 : undefined, minWidth: 0 }}>
      <Carte theme={theme} testID="esport-accueil-equipe">
        <TitreCarte theme={theme} titre={tr('objectifs.l_equipe')} droite={detail.moi.permissions.includes('members.view') ? <BoutonHub theme={theme} titre={tr('pageTeam.voir')} onPress={() => onAller('membres')} testID="esport-accueil-membres" /> : undefined} />
        <View style={{ flexDirection: 'row', gap: ESP.l, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <View style={{ gap: 2 }}>
            <Text style={{ color: theme.texte, fontSize: 30, fontWeight: '700', ...police(theme.policeChiffres) }}>{detail.membres}</Text>
            <Text style={styleAttenue(theme)}>{trn('pageTeam.mot_membre', detail.membres)}</Text>
          </View>
          <View style={{ gap: ESP.xxs, flexShrink: 1 }}>
            <Text style={styleAttenue(theme)}>{tr('pageTeam.mon_role')}</Text>
            {detail.moi.role ? <PastilleRole theme={theme} nom={nomRole(detail.moi.role.nom)} couleur={detail.moi.role.couleur} testID="esport-mon-role" /> : <Text style={styleTexte(theme)}>{tr('pageTeam.super_admin_fondateur')}</Text>}
          </View>
        </View>
        <Text style={styleAttenue(theme)} numberOfLines={3}>
          {actifs.map(nomModule).join(' · ') || tr('pageTeam.aucun_module_active')}
        </Text>
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
              {detail.team.description || `${jeu} · ${trn('statsTeam.membres', detail.membres)}`}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: ESP.xs, flexWrap: 'wrap' }}>
          <Badge theme={theme} texte={jeu} couleur={couleur} />
          <Badge theme={theme} texte={trn('statsTeam.membres', detail.membres)} />
          {detail.team.archivee ? <Badge theme={theme} ton="alerte" texte={tr('pageTeam.archivee')} /> : null}
        </View>
      </Carte>
      ) : null}
      <View style={large ? { flexDirection: 'row', gap: ESP.l, alignItems: 'flex-start' } : { gap: ESP.m }}>
        {/* Planning d'abord : sur iPhone, répondre doit se faire sans défiler. */}
        <View style={{ gap: ESP.m, flex: large ? 1.6 : undefined, minWidth: 0 }}>
          <AccueilPlanning theme={theme} client={client} detail={detail} onAller={onAller} />
          <MonSuivi theme={theme} client={client} detail={detail} />
          <AccueilCompetition theme={theme} client={client} detail={detail} onAller={onAller} />
          <AccueilPhase3 theme={theme} client={client} detail={detail} onAller={onAller} />
        </View>
        {colonneDroite}
      </View>
      <StatsTeam theme={theme} client={client} detail={detail} />
    </View>
  );
}

export function Parametres({
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
  // Jeu de la team (profil de jeu) : profils actifs, plus celui qu'elle a (même archivé).
  const [jeu, setJeu] = useState(detail.team.jeu);
  const [jeux, setJeux] = useState<Array<{ id: string; nom: string; couleur?: string }> | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();
  useEffect(() => {
    let vivant = true;
    Promise.resolve()
      .then(() => apiJeux(client).liste())
      .then(l => {
        if (!vivant || !Array.isArray(l?.jeux)) return;
        const actifs = l.jeux.filter(j => j.statut === 'actif').map(j => ({ id: j.cle, nom: nomJeu(j.cle, j.nom), couleur: j.couleur }));
        if (!actifs.some(j => j.id === detail.team.jeu)) actifs.unshift({ id: detail.team.jeu, nom: nomJeu(detail.team.jeu, detail.team.jeuNom), couleur: detail.team.jeuCouleur ?? '#8b8b9a' });
        setJeux(actifs);
      })
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [client, detail.team.jeu, detail.team.jeuNom, detail.team.jeuCouleur]);
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
          <TitreCarte theme={theme} titre={tr('pageTeam.la_team')} sous={tr('pageTeam.nom_et_description_visibles')} />
          <Champ theme={theme} libelle={tr('pageTeam.nom')} valeur={nom} onChanger={setNom} maxLength={60} testID="esport-parametres-nom" />
          <ZoneEcriture theme={theme} champ="team.description" valeur={description} onChanger={setDescription} maxLength={500} testID="esport-parametres-description-ecriture">
            <Champ theme={theme} libelle={tr('pageTeam.description')} valeur={description} onChanger={setDescription} maxLength={500} multiligne testID="esport-parametres-description" />
          </ZoneEcriture>
          {/* Team CM : pas de profil de jeu (le serveur refuse de le changer). */}
          {jeux && jeux.length > 1 && detail.team.genre !== 'cm' ? (
            <>
              <Choix<string> theme={theme} libelle={tr('pageTeam.jeu_de_la_team')} valeur={jeu} options={jeux} onChoisir={setJeu} testID="esport-parametres-jeu" />
              {jeu !== detail.team.jeu ? <Text style={styleAttenue(theme, 12)}>{tr('pageTeam.jeu_change_aide')}</Text> : null}
            </>
          ) : null}
          <View style={{ alignSelf: 'flex-start' }}>
            <BoutonHub
              theme={theme}
              titre={tr('discord.enregistrer')}
              variante="plein"
              desactive={Boolean(enCours)}
              onPress={() =>
                void agir('team', async () => {
                  await client.modifierTeam(detail.team.id, { nom: nom.trim(), description, ...(jeu !== detail.team.jeu ? { jeu } : {}) });
                  if (jeu !== detail.team.jeu) oublierProfilsTeams();
                  await onChange();
                  return tr('pageTeam.team_enregistree');
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
          titre={tr('pageTeam.modules')}
          sous={gerer ? tr('pageTeam.desactiver_un_module_le') : tr('pageTeam.seul_le_proprietaire_active')}
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
                  accessibilityLabel={nomModule(m.cle)}
                  disabled={!gerer}
                  onPress={() =>
                    void agir('modules', async () => {
                      await client.changerModules(detail.team.id, { [m.cle]: !actif });
                      await onChange();
                      return tr(actif ? 'pageTeam.module_desactive' : 'pageTeam.module_active', { nom: nomModule(m.cle) });
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
                    {nomModule(m.cle)}
                    {bientot ? <Text style={styleAttenue(theme)}> {tr('pageTeam.bientot')}</Text> : null}
                  </Text>
                  <Text style={styleAttenue(theme)}>{actif ? tr('pageTeam.active') : tr('pageTeam.desactive_2')}</Text>
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
      {peut('team.manage') && detail.modules.some(m => m.cle === 'meeting_summaries' && m.active) ? <ReglagesTranscriptionTeam theme={theme} client={client} teamId={detail.team.id} /> : null}
      {peut('team.manage') ? <EspaceTeam theme={theme} client={client} teamId={detail.team.id} /> : null}
      <MonProfil theme={theme} client={client} onExporter={onExporter} />
      {peut('team.delete') && detail.team.genre !== 'cm' ? (
        <Panneau theme={theme} style={{ borderColor: teinteTransparente(theme.critique, 0.5) }}>
          <TitreCarte theme={theme} titre={tr('pageTeam.zone_sensible')} sous={tr('pageTeam.la_suppression_est_definitive')} />
          <BoutonConfirme
            theme={theme}
            titre={tr('pageTeam.supprimer_la_team')}
            confirmation={tr('pageTeam.oui_supprimer', { nom: detail.team.nom })}
            onConfirme={() =>
              void agir('suppression', async () => {
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
      <TitreSection theme={theme} titre={tr('pageTeam.parametres')} sous={tr('pageTeam.la_team_ses_modules')} />
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
      <Text style={{ color: theme.texte, fontWeight: '700', ...police(theme.policeTexte) }}>{tr('discord.bot_discord')}</Text>
      {etat.lie ? (
        <Text style={{ color: theme.texte, ...police(theme.policeTexte) }} testID="esport-lier-discord-etat">
          {tr('pageTeam.discord_lie', { nom: etat.discordNom ? tr('fmt.suite', { texte: etat.discordNom }) : '' })}
        </Text>
      ) : (
        <Text style={attenue}>{tr('pageTeam.liez_votre_compte_discord')}</Text>
      )}
      {code && !etat.lie ? <CodeAffiche theme={theme} code={code} testID="esport-lier-discord-code" /> : null}
      <View style={styles.ligne}>
        <BoutonHub
          theme={theme}
          titre={etat.lie ? tr('pageTeam.lier_un_autre_compte') : tr('pageTeam.lier_mon_discord')}
          variante={etat.lie ? undefined : 'plein'}
          desactive={Boolean(enCours) || !etat.botDisponible}
          onPress={() =>
            void agir('code', async () => {
              setCode(await api.code());
              setEtat({ ...etat, lie: false });
              return tr('pageTeam.tapez_la_commande_affichee');
            })
          }
          testID="esport-lier-discord-bouton"
        />
        {etat.lie ? (
          <BoutonHub
            theme={theme}
            titre={tr('pageTeam.delier_mon_discord')}
            desactive={Boolean(enCours)}
            onPress={() =>
              void agir('delier', async () => {
                await api.delier();
                await recharger();
                return tr('pageTeam.discord_delie');
              })
            }
            testID="esport-lier-discord-delier"
          />
        ) : (
          <BoutonHub theme={theme} titre={tr('pageTeam.j_ai_tape_le')} desactive={Boolean(enCours) || !code} onPress={() => void agir('', recharger)} testID="esport-lier-discord-verifier" />
        )}
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-lier-discord" />
    </View>
  );
}

/** Profil Esport, mention des données, export et suppression (RGPD). */
/**
 * « Ma fiche du trombinoscope » (Mon profil) : photo, réseaux pro, elo, palmarès, anciennes structures, postes et
 * visibilité de chaque champ — la fiche que le CM et le staff voient dans Membres › Trombinoscope.
 */
function MaFicheProfil({ theme, client }: { theme: ThemeHub; client: ClientEsport }) {
  const [ouvert, setOuvert] = useState(false);
  const api = useMemo(() => apiTrombi(client), [client]);
  return (
    <View style={{ gap: ESP.s, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.s }} testID="esport-profil-trombi">
      <TitreCarte
        theme={theme}
        titre={trTb('profil.titre')}
        sous={trTb('profil.aide')}
        droite={<BoutonHub theme={theme} titre={ouvert ? trTb('profil.fermer') : trTb('profil.ouvrir')} onPress={() => setOuvert(o => !o)} testID="esport-profil-trombi-ouvrir" />}
      />
      {ouvert ? <MaFicheTrombi theme={theme} api={api} /> : null}
    </View>
  );
}

export function MonProfil({ theme, client, onExporter, onSupprime }: { theme: ThemeHub; client: ClientEsport; onExporter?(nom: string, contenu: string): Promise<boolean>; onSupprime?(): void }) {
  const [profil, setProfil] = useState<{ pseudo: string; riotId: string; discord: string } | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();
  const langue = useLangue();
  // Langue choisie par l'utilisateur (prime) et langue définie par l'administrateur (sert tant qu'il n'a rien choisi).
  const [langues, setLangues] = useState<{ choisie: Langue | null; defaut: Langue }>({ choisie: null, defaut: 'fr' });
  useEffect(() => {
    client.moi().then(m => {
      setProfil({ pseudo: m.profil?.pseudo ?? '', riotId: m.profil?.riotId ?? '', discord: m.profil?.discord ?? '' });
      setLangues({ choisie: m.langue ?? null, defaut: m.langueDefaut ?? 'fr' });
    }, () => undefined);
  }, [client]);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  if (!profil) return null;
  return (
    <Panneau theme={theme} testID="esport-mon-profil">
      <TitreCarte theme={theme} titre={tr('pageTeam.mon_profil_esport')} sous={tr('pageTeam.ce_que_voient_vos')} />
      <Champ theme={theme} libelle={tr('pageTeam.pseudo_obligatoire')} valeur={profil.pseudo} onChanger={pseudo => setProfil({ ...profil, pseudo })} maxLength={24} testID="esport-profil-pseudo" />
      <Champ theme={theme} libelle={tr('pageTeam.riot_id_facultatif_pseudo')} valeur={profil.riotId} onChanger={riotId => setProfil({ ...profil, riotId })} maxLength={22} testID="esport-profil-riot" />
      <Champ theme={theme} libelle={tr('pageTeam.discord_facultatif')} valeur={profil.discord} onChanger={discord => setProfil({ ...profil, discord })} maxLength={32} testID="esport-profil-discord" />
      <ChoixLangue
        theme={theme}
        libelle={tr('profil.langue')}
        valeur={langue}
        onChoisir={l => {
          // Changement instantané (sans recharger), puis enregistré sur le compte : le bot Discord et les exports la connaissent.
          definirLangue(l);
          void agir('langue', async () => {
            await client.majLangue(l);
            setLangues(v => ({ ...v, choisie: l }));
            return tr('profil.langue_enregistree');
          });
        }}
        testID="esport-profil-langue"
      />
      {langues.choisie ? (
        <BoutonHub
          theme={theme}
          titre={tr('profil.langue_admin', { langue: NOM_LANGUE[langues.defaut] })}
          onPress={() =>
            void agir('langue', async () => {
              // Le choix de l'utilisateur est effacé : la langue définie par l'administrateur s'applique de nouveau.
              const m = await client.reinitialiserLangue();
              const defaut = m.langueDefaut ?? langues.defaut;
              setLangues({ choisie: null, defaut });
              definirLangue(defaut);
              return tr('profil.langue_admin_retablie', { langue: NOM_LANGUE[defaut] });
            })
          }
          testID="esport-profil-langue-admin"
        />
      ) : (
        <Text style={attenue} testID="esport-profil-langue-defaut">
          {tr('profil.langue_definie_par_admin', { langue: NOM_LANGUE[langues.defaut] })}
        </Text>
      )}
      <LierDiscord theme={theme} client={client} />
      <ReglageRecapCourriel theme={theme} client={client} />
      <MaFicheProfil theme={theme} client={client} />
      <View style={styles.ligne}>
        <BoutonHub
          theme={theme}
          titre={tr('pageTeam.enregistrer_le_profil')}
          variante="plein"
          desactive={Boolean(enCours)}
          onPress={() =>
            void agir('profil', async () => {
              await client.majProfil({ pseudo: profil.pseudo.trim(), riotId: profil.riotId.trim() || undefined, discord: profil.discord.trim() || undefined });
              return tr('pageTeam.profil_enregistre');
            })
          }
          testID="esport-profil-enregistrer"
        />
        {onExporter ? (
          <BoutonHub
            theme={theme}
            titre={tr('pageTeam.exporter_mes_donnees')}
            onPress={() =>
              void agir('export', async () => {
                const donnees = await client.exporterMesDonnees();
                const ok = await onExporter('esport-mes-donnees.json', JSON.stringify(donnees, null, 2));
                return ok ? tr('pageTeam.export_enregistre') : undefined;
              })
            }
            testID="esport-profil-exporter"
          />
        ) : null}
        <BoutonConfirme
          theme={theme}
          titre={tr('pageTeam.supprimer_mes_donnees_esport')}
          confirmation={tr('pageTeam.oui_tout_supprimer')}
          onConfirme={() =>
            void agir('suppression', async () => {
              await client.supprimerMesDonnees();
              onSupprime?.();
              return tr('pageTeam.vos_donnees_esport_sont');
            })
          }
          testID="esport-profil-supprimer"
        />
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-profil" />
      <Text style={attenue} testID="esport-mention">
        {mentionDonnees()}
      </Text>
    </Panneau>
  );
}
