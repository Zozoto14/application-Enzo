/**
 * Espace CM du club (carte « CM du club » en tête de la page Teams de l'Esport) : tableaux (club et teams), file « À
 * valider », calendrier éditorial, clips des joueurs, visuels (modèles, charte, éditeur ; docs/esport/visuels.md), et pour le gestionnaire (cm.gerer) : équipe et rôles
 * CM, import Trello, réglages (suggestions automatiques), journal de la section. Page « Réseaux » (comptes, bot
 * d'annonce Discord, statistiques ; docs/esport/reseaux-stats.md) pour qui voit la section CM. Drive (dossiers et fichiers du
 * club et des teams ; docs/esport/drive.md) pour qui a un droit cm.drive.*. Rubrique « Sponsors » pour qui a
 * sponsors.voir (affectation « club ») : seule visible pour un compte qui n'a QUE les Sponsors. Section « Réunions »
 * (réunions, disponibilités et rendez-vous de l'équipe CM ; docs/esport/cm-reunions.md) pour l'équipe CM et pour
 * un membre du club invité à une réunion. L'espace est réservé à l'équipe CM (GET /cm/moi : permissions du club et
 * affectations à un rôle CM) : une permission CM d'un rôle de team (Manager, joueurs) n'ouvre que l'onglet CM de la
 * team ; hors équipe CM, seulement ses réunions (invité) et les ressources partagées avec lui. Les GROUPES (Accueil CM, Contenus, DATA, Diffusion, Partenaires, Équipe,
 * Gestion) sont les entrées de la barre latérale du cadre (bloc « CM du club », comme les sections d'une team) ; chaque
 * groupe a ses sous-onglets en haut de la page (aucun s'il n'a qu'une sous-section) ; sur téléphone, un sélecteur de
 * groupe puis les sous-onglets. Tout est décidé
 * par le serveur ; l'écran n'affiche que ce que la réponse permet.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ, Interrupteur } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport, DetailTeam, TeamListee } from '../../client';
import { apiCm, PORTEE_CLUB, voitDrive, type ApiCm, type CarteTransverse, type EntreeJournalCm, type ListeTableaux, type MoiCm, type ReglagesCm, type TeamCm } from '../../cm/api';
import { phraseJournalCm } from '../../cm/libelles';
import { CLES_RESEAUX, RESEAUX } from '../../cm/reseaux';
import { trCm, trnCm, type CleCm } from '../../i18n/cm';
import { tr } from '../../i18n';
import { EntreeLaterale, PageEsport, SiBarreEtendue, useBlocLateral } from '../CadreEsport';
import { PastilleRole, Retours, styles, useAgir } from '../commun';
import { Badge, COULEUR_CM_CLUB, Carte, Compteur, ESP, EtatVide, Grille, MenuActions, Onglets, Squelette, SqueletteCartes, TitreCarte, Volet, attenue, couleurTeam, texte, type ActionSecondaire } from '../design';
import { Aide, BadgeStatut, FUSEAU_CLUB, PALETTE, PastilleReseau, Teinte, nomTableau, quand, useEtatCm } from './commun';
import { couleurUrgence } from '../../cm/urgence';
import { CompteurUrgence, FiltreUrgenceCm, LegendeUrgence, PastilleUrgence, passeFiltreUrgence, type FiltreUrgence } from './Drapeau';
import { Tableau } from './Tableau';
import { Calendrier } from './Calendrier';
import { GalerieClips } from './Clips';
import { ImportTrello } from './ImportTrello';
import { RolesCm } from './RolesCm';
import { EspaceSponsors } from '../sponsors/EspaceSponsors';
import { EspaceReseaux } from './reseaux/EspaceReseaux';
import { Visuels } from './visuels/Visuels';
import { trVi } from '../../i18n/visuels';
import { Drive } from './drive/Drive';
import { Ressources } from './liens/Ressources';
import { Reunions } from './reunions/Reunions';
import { trRe } from '../../i18n/reunions';
import { useNouveautesDrive } from '../../cm/nouveautesDrive';
import { apiReunions, plusJours, type Reunion } from '../../cm/reunions';
import { entreesTeamCm, groupeSectionTeam, type EntreeTeamCm, type OngletTeamCm, type SectionsTeam } from './SectionsTeamCm';

type OngletBase = 'accueil' | 'tableaux' | 'valider' | 'calendrier' | 'clips' | 'visuels' | 'reunions' | 'drive' | 'ressources' | 'reseaux' | 'sponsors' | 'equipe' | 'import' | 'reglages' | 'journal';
/** Section de l'espace, ou section du CM du club (la team) : « team:membres », « team:module:planning »… */
export type OngletCm = OngletBase | OngletTeamCm;
export type GroupeCmId = 'accueil' | 'contenus' | 'data' | 'diffusion' | 'partenaires' | 'equipe' | 'gestion';

/** Pictogrammes des groupes dans la barre latérale (colonne d'icônes quand elle est réduite). */
const GLYPHES_GROUPES: Record<GroupeCmId, string> = {
  accueil: 'accueil',
  contenus: 'grille',
  data: 'graphique',
  diffusion: 'megaphone',
  partenaires: 'partenaires',
  equipe: 'membres',
  gestion: 'reglages',
};

/** Groupe de chaque section (sous-onglet). */
export const GROUPE_DE_ONGLET: Record<OngletBase, GroupeCmId> = {
  accueil: 'accueil',
  tableaux: 'contenus',
  valider: 'contenus',
  calendrier: 'contenus',
  clips: 'data',
  visuels: 'data',
  drive: 'data',
  ressources: 'data',
  reseaux: 'diffusion',
  sponsors: 'partenaires',
  reunions: 'equipe',
  equipe: 'equipe',
  import: 'gestion',
  reglages: 'gestion',
  journal: 'gestion',
};

/** Groupe d'une section (sections de la team : voir SectionsTeamCm.tsx). */
export function groupeDeOnglet(id: OngletCm): GroupeCmId {
  return id.startsWith('team:') ? groupeSectionTeam(id.slice('team:'.length)) : GROUPE_DE_ONGLET[id as OngletBase];
}

/** Sous-section (sous-onglet) d'un groupe. */
export interface EntreeCm {
  id: OngletCm;
  libelle: string;
  /** Compteur (posts à valider, nouveautés du Drive, ressources partagées non ouvertes) affiché sur le sous-onglet. */
  compteur?: number;
}
export interface GroupeCm {
  id: GroupeCmId;
  libelle: string;
  glyphe: string;
  entrees: EntreeCm[];
  /** Somme des compteurs des sous-sections (bulle de l'entrée de la barre latérale). */
  compteur?: number;
}

/**
 * Groupes de l'espace CM selon les droits : Accueil CM, Contenus, DATA, Diffusion, Partenaires, Équipe, Gestion.
 * Chaque groupe porte ses sous-sections (mêmes conditions qu'avant pour chacune) ; un groupe sans sous-section visible
 * n'apparaît pas. L'accueil (vue d'ensemble) est proposé à qui voit les contenus ; sans lui, l'espace s'ouvre sur le Drive, les Sponsors ou les réunions.
 */
export function groupesCm({ voirCm, drive, sponsors, reunions, gerer, aValider, nouveautesDrive, commentairesNonLus, ressourcesNouvelles, ressources = voirCm, team = [] }: { voirCm: boolean; drive: boolean; sponsors: boolean; reunions: boolean; gerer: boolean; aValider?: number; nouveautesDrive?: number; commentairesNonLus?: number; /** Ressources partagées avec le compte, pas encore ouvertes (migration 0048). */ ressourcesNouvelles?: number; /** DATA › Ressources : l'équipe CM, ou un compte avec qui une ressource est partagée (celles-là seulement). */ ressources?: boolean; /** Sections du CM du club, la team (membres, planning, dispos, paramètres…) : SectionsTeamCm.tsx. */ team?: EntreeTeamCm[] }): GroupeCm[] {
  const e = (id: OngletCm, libelle: string, compteur?: number): EntreeCm => ({ id, libelle, compteur: compteur || undefined });
  const deTeam = (g: GroupeCmId) => team.filter(t => t.groupe === g).map(t => e(t.id, t.libelle));
  const membresTeam = deTeam('equipe').filter(t => t.id === 'team:membres');
  const agendaTeam = deTeam('equipe').filter(t => t.id !== 'team:membres');
  const brut: Array<{ id: GroupeCmId; libelle: string; entrees: EntreeCm[] }> = [
    { id: 'accueil', libelle: trCm('espace.g.accueil'), entrees: voirCm ? [e('accueil', trCm('espace.g.accueil'))] : [] },
    { id: 'contenus', libelle: trCm('espace.g.contenus'), entrees: voirCm ? [e('tableaux', trCm('espace.tableaux'), commentairesNonLus), e('valider', trCm('espace.valider'), aValider), e('calendrier', trCm('espace.calendrier'))] : [] },
    { id: 'data', libelle: trCm('espace.g.data'), entrees: [...(voirCm ? [e('clips', trCm('espace.clips')), e('visuels', trVi('espace.titre'))] : []), ...(drive ? [e('drive', trCm('espace.drive'), nouveautesDrive)] : []), ...(ressources ? [e('ressources', trCm('espace.ressources'), ressourcesNouvelles)] : []), ...deTeam('data')] },
    { id: 'diffusion', libelle: trCm('espace.g.diffusion'), entrees: voirCm ? [e('reseaux', trCm('espace.reseaux'))] : [] },
    { id: 'partenaires', libelle: trCm('espace.g.partenaires'), entrees: sponsors ? [e('sponsors', trCm('espace.sponsors'))] : [] },
    // Équipe CM = les membres de la team ; les rôles CM (affectations) deviennent « Rôles CM » quand la team est là.
    { id: 'equipe', libelle: trCm('espace.g.equipe'), entrees: [...membresTeam, ...(reunions ? [e('reunions', trRe('onglet'))] : []), ...agendaTeam, ...(gerer ? [e('equipe', membresTeam.length ? tr('teamCm.roles_cm') : trCm('espace.equipe'))] : [])] },
    { id: 'gestion', libelle: trCm('espace.g.gestion'), entrees: [...deTeam('gestion'), ...(gerer ? [e('import', trCm('espace.import')), e('reglages', trCm('espace.reglages')), e('journal', trCm('espace.journal'))] : [])] },
  ];
  return brut
    .filter(g => g.entrees.length > 0)
    .map(g => ({ ...g, glyphe: GLYPHES_GROUPES[g.id], compteur: g.entrees.reduce((s, x) => s + (x.compteur ?? 0), 0) || undefined }));
}

/** Rôle CM affiché dans le bloc de la barre latérale : le plus haut niveau de permission CM du compte. */
function roleCm(moi: MoiCm, fondateur: boolean | undefined, voirCm: boolean): string {
  if (fondateur) return tr('pageTeam.super_admin');
  const a = (p: string) => moi.club.some(x => x === p) || moi.teams.some(t => t.permissions.some(x => x === p));
  if (moi.gerer) return trCm('espace.role_gerer');
  if (a('cm.valider')) return trCm('espace.role_valider');
  if (a('cm.editer')) return trCm('espace.role_editer');
  return voirCm ? trCm('espace.role_lecture') : trCm('espace.role_partiel');
}

/** Bloc de la barre latérale : pastille « CM », titre, rôle, « ⇄ Changer », un groupe par entrée (comme les sections d'une team). */
function BlocLateralCm({ theme, groupes, actif, onChoisir, role, destinations }: { theme: ThemeHub; groupes: GroupeCm[]; actif?: GroupeCmId; onChoisir(g: GroupeCm): void; role: string; destinations: ActionSecondaire[] }) {
  const rayon = theme.id === 'terminal' ? 0 : Math.round(40 * 0.28);
  return (
    <View style={{ gap: ESP.xs }} testID="esport-cm-barre">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, paddingHorizontal: ESP.xs, paddingBottom: ESP.xs }}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="esport-cm-pastille" style={{ width: 40, height: 40, borderRadius: rayon, backgroundColor: COULEUR_CM_CLUB, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800' }}>CM</Text>
        </View>
        <SiBarreEtendue>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={{ ...texte(theme, 16), fontWeight: '800' }} numberOfLines={2} accessibilityRole="header">
              {tr('cm.club_titre')}
            </Text>
            <PastilleRole theme={theme} nom={role} couleur={COULEUR_CM_CLUB} testID="esport-cm-role" />
          </View>
        </SiBarreEtendue>
      </View>
      {destinations.length ? (
        <SiBarreEtendue>
          <View style={{ paddingHorizontal: ESP.xxs, paddingBottom: ESP.xs }}>
            <MenuActions theme={theme} testID="esport-cm-changer" libelle={trCm('espace.changer_libelle')} titreBouton={trCm('espace.changer')} actions={destinations} />
          </View>
        </SiBarreEtendue>
      ) : null}
      <View accessibilityRole="tablist" accessibilityLabel={trCm('espace.sections_de')} style={{ gap: ESP.xxs }} testID="esport-cm-onglets">
        {groupes.map(g => (
          <EntreeLaterale
            key={g.id}
            theme={theme}
            libelle={g.libelle}
            glyphe={g.glyphe}
            description={g.compteur ? `${g.libelle} (${g.compteur})` : g.libelle}
            choisi={g.id === actif}
            compteur={g.compteur}
            onPress={() => onChoisir(g)}
            testID={`esport-cm-groupe-${g.id}`}
          />
        ))}
      </View>
    </View>
  );
}

export function EspaceCm({
  theme,
  client,
  large,
  moi,
  onExporter,
  ongletInitial,
  fondateur,
  onQuitter,
  onOuvrirTeam,
  sectionsTeam,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  large: boolean;
  moi: MoiCm;
  onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>;
  /** Onglet ouvert d'abord (raccourci « Drive » de la carte « CM du club ») ; ignoré s'il n'est pas permis. */
  ongletInitial?: OngletCm;
  /** Le compte est le Fondateur (rôle affiché dans la barre latérale). */
  fondateur?: boolean;
  /** Retour vers Teams (fil d'Ariane, « ⇄ Changer », lien de retour du téléphone). */
  onQuitter?(): void;
  /** « ⇄ Changer » : ouvre une team. */
  onOuvrirTeam?(id: string): void;
  /** Sections du CM du club, la team (Équipe CM, Planning, Dispos, Paramètres…) : fournies par RacineEsport. */
  sectionsTeam?: SectionsTeam;
}) {
  const api = useMemo(() => apiCm(client), [client]);
  // Rubrique Sponsors (migration 0024) : permissions du club, indépendantes de la section CM.
  const voirCm = moi.club.includes('cm.voir') || moi.teams.some(t => t.permissions.includes('cm.voir'));
  const sponsors = Boolean(moi.sponsors?.includes('sponsors.voir'));
  // Drive (migration 0027) : du club ou d'une team, pour qui y a un droit (un compte peut n'avoir QUE le Drive).
  const drive = voitDrive(moi.club) || moi.teams.some(t => voitDrive(t.permissions));
  // Réunions de l'équipe CM (migration 0039) : l'équipe CM, et tout membre du club invité à une réunion.
  const reunions = Boolean(moi.reunions?.voir || moi.reunions?.invite);
  // DATA › Ressources : l'équipe CM, ou un compte hors équipe avec qui une ressource est partagée (celles-là seulement).
  const ressources = voirCm || Boolean(moi.ressources);
  const accueil = voirCm;
  const [onglet, setOnglet] = useState<OngletCm>(() => {
    const permis: Partial<Record<OngletCm, boolean>> = { accueil, drive, sponsors, reunions, ressources, equipe: moi.gerer, import: moi.gerer, reglages: moi.gerer, journal: moi.gerer };
    // Section du CM du club (lien vers sa page de team) : vérifiée une fois la team lue.
    if (ongletInitial && (ongletInitial.startsWith('team:') || (permis[ongletInitial as OngletBase] ?? voirCm))) return ongletInitial;
    return accueil ? 'accueil' : drive ? 'drive' : sponsors ? 'sponsors' : reunions ? 'reunions' : ressources ? 'ressources' : 'tableaux';
  });
  // Dernière sous-section ouverte de chaque groupe (on y revient en rouvrant le groupe), comme dans une team.
  const [derniers, setDerniers] = useState<Partial<Record<GroupeCmId, OngletCm>>>({});
  // Le CM du club, la team (migrations 0068 et 0069) : ses sections dans l'espace (membres, planning, dispos…).
  const [detailTeam, setDetailTeam] = useState<DetailTeam | undefined>();
  const [ouvert, setOuvert] = useState<string | undefined>();
  // Dossier du Drive à ouvrir (depuis « où est lié » d'une ressource) ; `n` relance l'ouverture du même dossier.
  const [dossierDrive, setDossierDrive] = useState<{ portee: string; id: string; n: number } | undefined>();
  // Pastille « Nouveau » des ressources partagées : aussi pour qui n'a que des ressources partagées.
  const { etat } = useEtatCm(api, voirCm || ressources);
  // Pastille du Drive : nouveautés (fichiers, dossiers, versions ajoutés par d'autres) dans tous les Drive visibles.
  const nouveautesDrive = useNouveautesDrive(client, undefined, drive);
  const teams: TeamCm[] = moi.teams;
  // « ⇄ Changer » : Teams, puis chaque team (comme le sélecteur d'une team, qui propose aussi « CM du club »).
  const [mesTeams, setMesTeams] = useState<TeamListee[]>([]);
  useEffect(() => {
    let vivant = true;
    void Promise.resolve()
      .then(() => client.teams())
      .then(l => vivant && setMesTeams(Array.isArray(l) ? l : []), () => undefined);
    return () => {
      vivant = false;
    };
  }, [client]);
  const idTeamCm = mesTeams.find(t => t.genre === 'cm' && !t.suspendu)?.id;
  const lireTeam = useCallback(async () => {
    if (!idTeamCm || !sectionsTeam) return;
    const d = await client.team(idTeamCm);
    setDetailTeam(d);
  }, [client, idTeamCm, sectionsTeam]);
  useEffect(() => {
    void lireTeam().catch(() => undefined);
  }, [lireTeam]);
  const entreesTeam = useMemo(() => (detailTeam && sectionsTeam ? entreesTeamCm(sectionsTeam.entrees(detailTeam)) : []), [detailTeam, sectionsTeam]);
  const groupes = groupesCm({ voirCm, drive, sponsors, reunions, gerer: moi.gerer, aValider: etat?.aValider, nouveautesDrive, commentairesNonLus: etat?.nonLus?.total, ressourcesNouvelles: etat?.ressources, ressources, team: entreesTeam });
  const toutes = groupes.flatMap(g => g.entrees);
  const courante = toutes.find(e => e.id === onglet);
  const groupe = groupes.find(g => g.entrees.some(e => e.id === onglet));
  const choisir = (id: OngletCm) => {
    if (id === 'tableaux') setOuvert(undefined);
    setOnglet(id);
    setDerniers(d => ({ ...d, [groupeDeOnglet(id)]: id }));
  };
  const ouvrirGroupe = (g: GroupeCm) => {
    const memo = derniers[g.id];
    choisir(memo && g.entrees.some(e => e.id === memo) ? memo : g.entrees[0].id);
  };
  const destinations: ActionSecondaire[] = [
    ...(onQuitter ? [{ titre: tr('dashboard.teams'), onPress: onQuitter, testID: 'esport-cm-changer-teams' }] : []),
    ...mesTeams.filter(t => !t.suspendu && t.genre !== 'cm').map(t => ({ titre: t.nom, onPress: () => onOuvrirTeam?.(t.id), testID: `esport-cm-changer-${t.slug}`, pastille: { couleur: couleurTeam(t.slug) } })),
  ];
  const role = roleCm(moi, fondateur, voirCm);
  // PC : groupes dans la barre latérale du cadre (sous l'Esport), comme les sections d'une team.
  useBlocLateral(<BlocLateralCm theme={theme} groupes={groupes} actif={groupe?.id} onChoisir={ouvrirGroupe} role={role} destinations={destinations} />, large);
  // Sous-onglets en haut de la page (un groupe à une seule sous-section n'en a pas).
  const sousOnglets =
    groupe && groupe.entrees.length > 1 ? (
      <Onglets
        theme={theme}
        prefixe="esport-cm-onglet"
        testID="esport-cm-sous-onglets"
        actif={onglet}
        pleineLargeur={false}
        defilant={!large}
        onChoisir={id => choisir(id as OngletCm)}
        entrees={groupe.entrees.map(e => ({ id: e.id, libelle: e.libelle, description: e.libelle, pastille: e.compteur }))}
      />
    ) : null;
  const ouvrirDossier = (portee: string, id: string) => {
    setDossierDrive(d => ({ portee, id, n: (d?.n ?? 0) + 1 }));
    choisir('drive');
  };
  const ouvrirTableau = (id: string) => {
    setOuvert(id);
    setOnglet('tableaux');
    setDerniers(d => ({ ...d, contenus: 'tableaux' }));
  };
  // Tableau ouvert : la page prend toute la largeur (barre latérale réduite comprise) et toute la hauteur, avec des
  // marges serrées ; fil d'Ariane et sous-onglets sur une seule ligne (PC).
  const tableauOuvert = onglet === 'tableaux' && voirCm && Boolean(ouvert);
  return (
    <PageEsport large={large} testID="esport-cm" largeur={tableauOuvert ? null : 1600} serre={tableauOuvert}>
      {large ? (
        <View style={tableauOuvert ? { flexDirection: 'row', alignItems: 'center', gap: ESP.l } : { gap: ESP.s }} testID="esport-cm-entete">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xxs, flexWrap: 'wrap', flexShrink: 0 }} accessibilityRole="navigation" aria-label={tr('pageTeam.fil_d_ariane')} testID="esport-cm-fil">
            {onQuitter ? (
              <>
                <Pressable testID="esport-cm-retour" accessibilityRole="link" onPress={onQuitter} style={{ minHeight: 32, justifyContent: 'center' }}>
                  <Text style={{ ...texte(theme, 14), color: theme.accent, fontWeight: '600' }}>{tr('dashboard.teams')}</Text>
                </Pressable>
                <Text style={attenue(theme, 14)}>›</Text>
              </>
            ) : null}
            <Text style={{ ...texte(theme, 14), fontWeight: '600' }}>{tr('cm.club_titre')}</Text>
            {groupe ? (
              <>
                <Text style={attenue(theme, 14)}>›</Text>
                <Text style={attenue(theme, 14)} testID="esport-cm-fil-groupe">{groupe.libelle}</Text>
              </>
            ) : null}
            {groupe && courante && courante.libelle !== groupe.libelle ? (
              <>
                <Text style={attenue(theme, 14)}>›</Text>
                <Text style={attenue(theme, 14)} testID="esport-cm-fil-section">{courante.libelle}</Text>
              </>
            ) : null}
          </View>
          {tableauOuvert && sousOnglets ? <View style={{ flex: 1, minWidth: 0 }}>{sousOnglets}</View> : sousOnglets}
        </View>
      ) : (
        // Téléphone : pas de nouvelle section dans la barre du bas ; retour, titre, sélecteur de groupe et sous-onglets en haut de page.
        <View style={{ gap: ESP.xs }} testID="esport-cm-mobile">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs }}>
            {onQuitter ? (
              <Pressable testID="esport-cm-retour" accessibilityRole="link" accessibilityLabel={tr('pageTeam.retour_aux_teams')} onPress={onQuitter} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: theme.accent, fontSize: 26, lineHeight: 28, marginTop: -2 }}>‹</Text>
                <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '600' }}>{tr('dashboard.teams')}</Text>
              </Pressable>
            ) : null}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ ...texte(theme, 18), fontWeight: '800' }} numberOfLines={1} accessibilityRole="header">
                {tr('cm.club_titre')}
              </Text>
              <Text style={attenue(theme, 13)} numberOfLines={1}>
                {role}
              </Text>
            </View>
            {destinations.length ? <MenuActions theme={theme} testID="esport-cm-changer" libelle={trCm('espace.changer_libelle')} titreBouton="⇄" actions={destinations} /> : null}
          </View>
          <MenuActions
            theme={theme}
            testID="esport-cm-sections"
            libelle={trCm('espace.sections_de')}
            titreBouton={`${groupe?.libelle ?? trCm('espace.titre')} ▾`}
            actions={groupes.map(g => ({ titre: g.compteur ? `${g.libelle} (${g.compteur})` : g.libelle, onPress: () => ouvrirGroupe(g), testID: `esport-cm-groupe-${g.id}` }))}
          />
          {sousOnglets}
        </View>
      )}
      {onglet === 'accueil' && accueil ? <AccueilCm theme={theme} api={api} client={client} large={large} voirCm={voirCm} drive={drive} reunions={reunions} aValider={etat?.aValider} urgences={etat?.urgences} versions={etat?.versions} nouveautesDrive={nouveautesDrive} onAller={choisir} onOuvrirTableau={ouvrirTableau} /> : null}
      {onglet === 'sponsors' && sponsors ? (
        <EspaceSponsors
          theme={theme}
          client={client}
          large={large}
          gerer={Boolean(moi.sponsors?.includes('sponsors.gerer'))}
          teams={teams.map(t => ({ id: t.id, nom: t.nom ?? '' }))}
          onExporter={onExporter}
          onOuvrirTableau={ouvrirTableau}
        />
      ) : null}
      {onglet === 'tableaux' && voirCm ? (
        ouvert ? (
          <Tableau theme={theme} api={api} id={ouvert} large={large} teams={teams} versionServeur={etat?.versions[ouvert]} onRetour={() => setOuvert(undefined)} />
        ) : (
          <ListeTableauxCm theme={theme} api={api} large={large} onOuvrir={setOuvert} nonLus={etat?.nonLus?.tableaux} />
        )
      ) : null}
      {onglet === 'valider' ? <FileValidation theme={theme} api={api} large={large} version={etat?.aValider} onOuvrir={ouvrirTableau} /> : null}
      {onglet === 'calendrier' ? <Calendrier theme={theme} api={api} large={large} creerPost={moi.club.includes('cm.editer') || moi.teams.some(t => t.permissions.includes('cm.editer'))} onOuvrirTableau={ouvrirTableau} /> : null}
      {onglet === 'clips' ? <GalerieClips theme={theme} api={api} large={large} teams={teams} /> : null}
      {onglet === 'reseaux' && voirCm ? <EspaceReseaux theme={theme} client={client} large={large} onExporter={onExporter} /> : null}
      {onglet === 'visuels' && voirCm ? <Visuels theme={theme} apiCm={api} large={large} moi={moi} /> : null}
      {onglet === 'reunions' && reunions ? <Reunions theme={theme} client={client} large={large} onExporter={onExporter} /> : null}
      {onglet === 'drive' && drive ? (
        <Drive
          theme={theme}
          client={client}
          large={large}
          onOuvrirTableau={voirCm ? ouvrirTableau : undefined}
          ressources={voirCm}
          dossierInitial={dossierDrive}
        />
      ) : null}
      {onglet === 'ressources' && ressources ? <Ressources theme={theme} client={client} large={large} onOuvrirTableau={ouvrirTableau} onOuvrirDossier={drive ? ouvrirDossier : undefined} /> : null}
      {onglet === 'equipe' && moi.gerer ? <RolesCm theme={theme} api={api} large={large} /> : null}
      {onglet.startsWith('team:') && detailTeam && sectionsTeam && entreesTeam.some(x => x.id === onglet) ? (
        <sectionsTeam.Section theme={theme} client={client} detail={detailTeam} large={large} onglet={onglet as OngletTeamCm} onAller={choisir} onChange={lireTeam} onExporter={onExporter} />
      ) : null}
      {onglet === 'import' && moi.gerer ? <ImportTrello theme={theme} api={api} large={large} onOuvrir={ouvrirTableau} /> : null}
      {onglet === 'reglages' && moi.gerer ? <Reglages theme={theme} api={api} /> : null}
      {onglet === 'journal' && moi.gerer ? <JournalCm theme={theme} api={api} /> : null}
    </PageEsport>
  );
}

// ------------------------------------------------------------------ Accueil CM

/** Vue d'ensemble : posts à valider, prochaines publications, nouveautés du Drive, prochaines réunions (selon les droits). */
function AccueilCm({ theme, api, client, large, voirCm, drive, reunions, aValider, urgences, versions, nouveautesDrive, onAller, onOuvrirTableau }: { theme: ThemeHub; api: ApiCm; client: ClientEsport; large: boolean; voirCm: boolean; drive: boolean; reunions: boolean; aValider?: number; urgences?: number; versions?: Record<string, number>; nouveautesDrive: number; onAller(o: OngletCm): void; onOuvrirTableau(id: string): void }) {
  const [attente, setAttente] = useState<CarteTransverse[] | undefined>();
  const [publications, setPublications] = useState<CarteTransverse[] | undefined>();
  const [prochaines, setProchaines] = useState<Reunion[] | undefined>();
  // Urgences (cartes critiques et urgentes) : relues quand leur nombre ou une version de tableau change (temps réel).
  const [cartesUrgentes, setCartesUrgentes] = useState<CarteTransverse[] | undefined>();
  const signatureUrgences = urgences ?? -1;
  // Cartes terminées par semaine (colonnes de fin) : relues quand un tableau change (temps réel).
  const [terminees, setTerminees] = useState<Array<{ debut: string; n: number }> | undefined>();
  const signatureVersions = versions ? Object.values(versions).reduce((a, b) => a + b, 0) : -1;
  useEffect(() => {
    if (!voirCm) return;
    let vivant = true;
    void Promise.resolve()
      .then(() => api.terminees(8))
      .then(r => vivant && setTerminees(r?.semaines ?? []), () => vivant && setTerminees([]));
    return () => {
      vivant = false;
    };
  }, [api, voirCm, signatureVersions]);
  useEffect(() => {
    if (!voirCm) return;
    let vivant = true;
    void Promise.resolve()
      .then(() => api.urgences())
      .then(r => vivant && setCartesUrgentes(r?.cartes ?? []), () => vivant && setCartesUrgentes([]));
    return () => {
      vivant = false;
    };
  }, [api, voirCm, signatureUrgences]);
  useEffect(() => {
    let vivant = true;
    const jour = new Date().toISOString().slice(0, 10);
    const maintenant = Date.now();
    if (voirCm) {
      void Promise.resolve()
        .then(() => api.aValider())
        .then(r => vivant && setAttente(r?.cartes ?? []), () => vivant && setAttente([]));
      void Promise.resolve()
        .then(() => api.calendrier(jour, plusJours(jour, 30)))
        .then(
          r =>
            vivant &&
            setPublications(
              (r?.cartes ?? [])
                .filter(c => c.datePublication && !c.archive && Date.parse(c.datePublication) >= maintenant - 3_600_000)
                .sort((a, b) => Date.parse(a.datePublication ?? '') - Date.parse(b.datePublication ?? '')),
            ),
          () => vivant && setPublications([]),
        );
    }
    if (reunions) {
      void Promise.resolve()
        .then(() => apiReunions(client).agenda(plusJours(jour, -1), plusJours(jour, 14)))
        .then(
          r => vivant && setProchaines((r?.reunions ?? []).filter(x => x.statut === 'active' && Date.parse(x.fin) >= maintenant).sort((a, b) => Date.parse(a.debut) - Date.parse(b.debut))),
          () => vivant && setProchaines([]),
        );
    }
    return () => {
      vivant = false;
    };
  }, [api, client, voirCm, reunions]);
  const ligne = (cle: string, titre: string, sous: string | undefined, onPress?: () => void) => (
    <Pressable key={cle} accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} disabled={!onPress} testID={`esport-cm-accueil-ligne-${cle}`} style={{ minHeight: 36, justifyContent: 'center', gap: 2 }}>
      <Text style={{ ...texte(theme, 15), fontWeight: '600' }} numberOfLines={1}>
        {titre}
      </Text>
      {sous ? <Text style={attenue(theme, 13)} numberOfLines={1}>{sous}</Text> : null}
    </Pressable>
  );
  const carte = (id: string, titre: string, bouton: { titre: string; onPress(): void }, corps: React.ReactNode) => (
    <Carte theme={theme} testID={`esport-cm-accueil-${id}`}>
      <TitreCarte theme={theme} titre={titre} droite={<BoutonHub theme={theme} titre={bouton.titre} onPress={bouton.onPress} testID={`esport-cm-accueil-${id}-voir`} />} />
      {corps}
    </Carte>
  );
  const vide = (texteVide: string) => <Text style={attenue(theme, 14)}>{texteVide}</Text>;
  return (
    <View style={{ gap: ESP.m }} testID="esport-cm-accueil">
      <Grille min={large ? 340 : 280}>
        {voirCm
          ? carte(
              'valider',
              trCm('accueil.valider'),
              { titre: trCm('accueil.voir'), onPress: () => onAller('valider') },
              <>
                <Text style={{ ...texte(theme, 28), fontWeight: '800' }} testID="esport-cm-accueil-valider-n">
                  {aValider ?? attente?.length ?? 0}
                </Text>
                {attente && !attente.length ? vide(trCm('accueil.rien_valider')) : null}
                {attente?.slice(0, 3).map(c => ligne(c.id, c.titre, c.tableau ? nomTableau(c.tableau) : undefined, () => onOuvrirTableau(c.tableauId)))}
              </>,
            )
          : null}
        {voirCm
          ? carte(
              'urgences',
              trCm('urgence.accueil'),
              { titre: trCm('accueil.voir'), onPress: () => onAller('tableaux') },
              <>
                <Text style={{ ...texte(theme, 28), fontWeight: '800' }} testID="esport-cm-accueil-urgences-n" accessibilityLabel={trnCm('urgence.accueil_n', urgences ?? cartesUrgentes?.length ?? 0)}>
                  {urgences ?? cartesUrgentes?.length ?? 0}
                </Text>
                {cartesUrgentes && !cartesUrgentes.length ? vide(trCm('urgence.accueil_vide')) : null}
                {!cartesUrgentes ? <Squelette theme={theme} lignes={2} hauteur={16} /> : null}
                {cartesUrgentes?.slice(0, 5).map(c => (
                  <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, borderLeftWidth: 6, borderLeftColor: c.urgence ? couleurUrgence(c.urgence, theme.sombre) : 'transparent', paddingLeft: ESP.xs }}>
                    {c.urgence ? <PastilleUrgence theme={theme} niveau={c.urgence} /> : null}
                    <View style={{ flex: 1, minWidth: 0 }}>{ligne(c.id, c.titre, c.tableau ? nomTableau(c.tableau) : undefined, () => onOuvrirTableau(c.tableauId))}</View>
                  </View>
                ))}
                <LegendeUrgence theme={theme} testID="esport-cm-accueil-urgences-legende" />
              </>,
            )
          : null}
        {voirCm
          ? carte(
              'terminees',
              trCm('accueil.terminees'),
              { titre: trCm('accueil.voir'), onPress: () => onAller('tableaux') },
              <>
                <Text style={{ ...texte(theme, 28), fontWeight: '800' }} testID="esport-cm-accueil-terminees-n" accessibilityLabel={trnCm('accueil.terminees_n', terminees?.[terminees.length - 1]?.n ?? 0)}>
                  {terminees?.[terminees.length - 1]?.n ?? 0}
                </Text>
                {!terminees ? <Squelette theme={theme} lignes={2} hauteur={16} /> : null}
                {terminees && !terminees.some(x => x.n) ? vide(trCm('accueil.terminees_vide')) : null}
                {terminees?.some(x => x.n) ? (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 44 }} testID="esport-cm-accueil-terminees-barres">
                    {terminees.map((x, i) => {
                      const max = Math.max(1, ...terminees.map(y => y.n));
                      return (
                        <View
                          key={x.debut}
                          accessible
                          accessibilityLabel={trCm('accueil.terminees_semaine', { date: x.debut, n: x.n })}
                          style={{ flex: 1, minWidth: 6, height: Math.max(3, Math.round((x.n / max) * 40)), borderRadius: 2, backgroundColor: i === terminees.length - 1 ? theme.ok : theme.attenue, opacity: x.n ? 1 : 0.25 }}
                          testID={`esport-cm-accueil-terminees-${x.debut}`}
                        />
                      );
                    })}
                  </View>
                ) : null}
                {terminees && terminees.length > 1 && terminees.slice(0, -1).some(x => x.n) ? <Text style={attenue(theme, 13)}>{trCm('accueil.terminees_avant', { liste: terminees.slice(-4, -1).map(x => x.n).join(' · ') })}</Text> : null}
              </>,
            )
          : null}
        {voirCm
          ? carte(
              'publications',
              trCm('accueil.publications'),
              { titre: trCm('accueil.voir_calendrier'), onPress: () => onAller('calendrier') },
              <>
                {publications && !publications.length ? vide(trCm('accueil.rien_publication')) : null}
                {!publications ? <Squelette theme={theme} lignes={2} hauteur={16} /> : null}
                {publications?.slice(0, 5).map(c => ligne(c.id, c.titre, quand(c.datePublication), () => onOuvrirTableau(c.tableauId)))}
              </>,
            )
          : null}
        {drive
          ? carte(
              'drive',
              trCm('accueil.drive'),
              { titre: trCm('accueil.ouvrir_drive'), onPress: () => onAller('drive') },
              <Text style={nouveautesDrive ? { ...texte(theme, 15), fontWeight: '700' } : attenue(theme, 14)} testID="esport-cm-accueil-drive-n">
                {nouveautesDrive ? trnCm('accueil.drive_n', nouveautesDrive) : trCm('accueil.rien_drive')}
              </Text>,
            )
          : null}
        {reunions
          ? carte(
              'reunions',
              trCm('accueil.reunions'),
              { titre: trCm('accueil.voir'), onPress: () => onAller('reunions') },
              <>
                {prochaines && !prochaines.length ? vide(trCm('accueil.rien_reunion')) : null}
                {!prochaines ? <Squelette theme={theme} lignes={2} hauteur={16} /> : null}
                {prochaines?.slice(0, 4).map(r => ligne(`${r.id}-${r.cle}`, r.titre, quand(r.debut), () => onAller('reunions')))}
              </>,
            )
          : null}
      </Grille>
    </View>
  );
}

// ------------------------------------------------------------------ Tableaux

/** `nonLus` : commentaires non lus par tableau (état de la section, temps réel), à défaut ceux de la liste. */
function ListeTableauxCm({ theme, api, large, onOuvrir, nonLus }: { theme: ThemeHub; api: ApiCm; large: boolean; onOuvrir(id: string): void; nonLus?: Record<string, number> }) {
  const [liste, setListe] = useState<ListeTableaux | undefined>();
  const [archives, setArchives] = useState(false);
  const [nouveau, setNouveau] = useState<{ nom: string; portee: string; couleur: string; modele: 'vide' | 'contenus' } | undefined>();
  const [q, setQ] = useState('');
  const [resultats, setResultats] = useState<CarteTransverse[] | undefined>();
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => setListe(await api.tableaux(archives)), [api, archives]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  const gerables = liste?.portees.filter(p => p.permissions.includes('cm.gerer')) ?? [];
  return (
    <View style={{ gap: ESP.m }} testID="esport-cm-tableaux">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-tableaux" />
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <Champ theme={theme} libelle={trCm('espace.rechercher')} valeur={q} onChanger={setQ} maxLength={80} testID="esport-cm-recherche" style={{ flex: 1, minWidth: 220 }} />
        <BoutonHub theme={theme} titre={trCm('espace.chercher')} desactive={q.trim().length < 2} onPress={() => void agir('recherche', async () => setResultats((await api.recherche(q.trim())).cartes))} testID="esport-cm-recherche-ok" />
        {gerables.length ? <BoutonHub theme={theme} titre={trCm('espace.nouveau_tableau')} variante="plein" onPress={() => setNouveau({ nom: '', portee: gerables[0].portee, couleur: PALETTE[5][0], modele: 'contenus' })} testID="esport-cm-tableau-nouveau" /> : null}
        <BoutonHub theme={theme} titre={archives ? trCm('tableau.masquer_archives') : trCm('tableau.voir_archives')} onPress={() => setArchives(a => !a)} testID="esport-cm-tableaux-archives" />
      </View>
      {resultats ? (
        <Carte theme={theme} testID="esport-cm-recherche-resultats">
          <TitreCarte theme={theme} titre={trnCm('espace.resultats', resultats.length)} droite={<BoutonHub theme={theme} titre={trCm('c.fermer')} onPress={() => setResultats(undefined)} testID="esport-cm-recherche-fermer" />} />
          {resultats.map(c => (
            <BoutonHub key={c.id} theme={theme} titre={`${c.titre} · ${c.tableau ? nomTableau(c.tableau) : ''}`} onPress={() => onOuvrir(c.tableauId)} testID={`esport-cm-recherche-${c.id}`} />
          ))}
        </Carte>
      ) : null}
      {!liste && !erreur ? <SqueletteCartes theme={theme} n={large ? 3 : 2} large={large} /> : null}
      {liste && !liste.tableaux.length ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="▦" titre={trCm('espace.aucun_tableau')} texte={trCm('espace.aucun_tableau_texte')} />
        </Carte>
      ) : null}
      {liste?.tableaux.length ? (
        <Grille min={large ? 280 : 240} testID="esport-cm-tableaux-liste">
          {liste.tableaux.map(t => (
            <Carte key={t.id} theme={theme} dense accent={t.couleur} onPress={() => onOuvrir(t.id)} libelle={`${trCm('espace.ouvrir_tableau', { nom: nomTableau(t) })}${t.acces === 'restreint' ? ` ${trCm('acces.restreint_libelle')}` : ''}`} testID={`esport-cm-tableau-${t.cleDefaut && !t.team ? 'club' : t.id}`}>
              <Text style={{ ...texte(theme, 16), fontWeight: '800' }} numberOfLines={2}>
                {nomTableau(t)}
              </Text>
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                <Badge theme={theme} ton={t.team ? 'neutre' : 'accent'} texte={t.team ? (t.team.nom ?? '') : trCm('portee.club')} />
                <Badge theme={theme} texte={trnCm('espace.cartes_n', t.cartes ?? 0)} />
                {t.aValider ? <Badge theme={theme} ton="alerte" texte={trnCm('espace.a_valider_n', t.aValider)} /> : null}
                {t.urgences?.critique ? <CompteurUrgence theme={theme} niveau="critique" n={t.urgences.critique} libelle={trnCm('urgence.critiques_n', t.urgences.critique)} testID={`esport-cm-tableau-${t.id}-critiques`} /> : null}
                {t.urgences?.urgent ? <CompteurUrgence theme={theme} niveau="urgent" n={t.urgences.urgent} libelle={trnCm('urgence.urgentes_n', t.urgences.urgent)} testID={`esport-cm-tableau-${t.id}-urgentes`} /> : null}
                {(nonLus ? (nonLus[t.id] ?? 0) : (t.nonLus ?? 0)) ? (
                  <View accessible accessibilityLabel={trnCm('nonlus.carte_n', nonLus ? (nonLus[t.id] ?? 0) : (t.nonLus ?? 0))}>
                    <Compteur theme={theme} n={nonLus ? (nonLus[t.id] ?? 0) : (t.nonLus ?? 0)} testID={`esport-cm-tableau-${t.cleDefaut && !t.team ? 'club' : t.id}-nonlus`} />
                  </View>
                ) : null}
                {t.trello ? <Badge theme={theme} texte="Trello" /> : null}
                {t.acces === 'restreint' ? <Badge theme={theme} icone="cadenas" texte={trCm('acces.restreint_badge')} testID={`esport-cm-tableau-${t.id}-restreint`} /> : null}
                {t.archive ? <Badge theme={theme} ton="alerte" texte={trCm('c.archive')} /> : null}
              </View>
            </Carte>
          ))}
        </Grille>
      ) : null}
      {nouveau ? (
        <Volet theme={theme} visible titre={trCm('espace.nouveau_tableau')} onFermer={() => setNouveau(undefined)} testID="esport-cm-tableau-volet">
          <Champ theme={theme} libelle={trCm('c.nom')} valeur={nouveau.nom} onChanger={nom => setNouveau({ ...nouveau, nom })} maxLength={80} testID="esport-cm-tableau-nom" />
          <View style={[styles.ligne, { gap: ESP.xs }]} accessibilityRole="radiogroup" accessibilityLabel={trCm('espace.portee')}>
            {gerables.map(p => (
              <BoutonHub key={p.portee} theme={theme} titre={p.team ? (p.team.nom ?? '') : trCm('portee.club')} variante={nouveau.portee === p.portee ? 'plein' : 'normal'} onPress={() => setNouveau({ ...nouveau, portee: p.portee })} testID={`esport-cm-tableau-portee-${p.portee === PORTEE_CLUB ? 'club' : p.portee}`} />
            ))}
          </View>
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <BoutonHub theme={theme} titre={trCm('espace.modele_contenus')} variante={nouveau.modele === 'contenus' ? 'plein' : 'normal'} onPress={() => setNouveau({ ...nouveau, modele: 'contenus' })} testID="esport-cm-tableau-modele-contenus" />
            <BoutonHub theme={theme} titre={trCm('espace.modele_vide')} variante={nouveau.modele === 'vide' ? 'plein' : 'normal'} onPress={() => setNouveau({ ...nouveau, modele: 'vide' })} testID="esport-cm-tableau-modele-vide" />
          </View>
          <View style={[styles.ligne, { gap: 0 }]} accessibilityRole="radiogroup" accessibilityLabel={trCm('c.couleur')}>
            {PALETTE.map(([couleur, cle]) => (
              <Teinte key={couleur} theme={theme} couleur={couleur} choisie={nouveau.couleur === couleur} libelle={trCm(cle)} onPress={() => setNouveau({ ...nouveau, couleur })} />
            ))}
          </View>
          <BoutonHub
            theme={theme}
            titre={trCm('c.creer')}
            variante="plein"
            desactive={!nouveau.nom.trim()}
            onPress={() =>
              void agir('creer', async () => {
                const d = await api.creerTableau({ nom: nouveau.nom.trim(), portee: nouveau.portee, couleur: nouveau.couleur, modele: nouveau.modele });
                setNouveau(undefined);
                onOuvrir(d.tableau.id);
              })
            }
            testID="esport-cm-tableau-creer"
          />
        </Volet>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ À valider

function FileValidation({ theme, api, large, version, onOuvrir }: { theme: ThemeHub; api: ApiCm; large: boolean; version?: number; onOuvrir(tableauId: string): void }) {
  const [cartes, setCartes] = useState<CarteTransverse[] | undefined>();
  const [noms, setNoms] = useState<Record<string, string | null>>({});
  const [refus, setRefus] = useState<{ id: string; motif: string } | undefined>();
  const [urgence, setUrgence] = useState<FiltreUrgence>('');
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => {
    const r = await api.aValider();
    setCartes(r.cartes);
    setNoms(r.noms);
  }, [api]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger, version]);
  return (
    <View style={{ gap: ESP.m }} testID="esport-cm-valider">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-valider" />
      {cartes?.length ? <FiltreUrgenceCm theme={theme} valeur={urgence} onChoisir={setUrgence} testID="esport-cm-valider-urgence" /> : null}
      {cartes && !cartes.length ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="✓" titre={trCm('valider.vide')} texte={trCm('valider.vide_texte')} />
        </Carte>
      ) : null}
      {cartes?.filter(c => passeFiltreUrgence(urgence, c.urgence)).map(c => (
        <Carte key={c.id} theme={theme} testID={`esport-cm-valider-${c.id}`}>
          <TitreCarte theme={theme} titre={c.titre} sous={[c.tableau ? nomTableau(c.tableau) : '', c.team?.nom ?? '', c.soumisPar ? trCm('valider.par', { qui: noms[c.soumisPar] ?? '?' }) : '', c.datePublication ? trCm('carte.publication_le', { date: quand(c.datePublication) }) : ''].filter(Boolean).join(' · ')} droite={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs }}>
                {c.urgence ? <PastilleUrgence theme={theme} niveau={c.urgence} testID={`esport-cm-valider-${c.id}-urgence`} /> : null}
                <BadgeStatut theme={theme} statut={c.statut} />
              </View>
            }
          />
          {c.reseaux.map(r => (
            <View key={r} style={{ gap: 4 }}>
              <PastilleReseau theme={theme} reseau={r} />
              <View style={{ flexDirection: large ? 'row' : 'column', gap: ESP.s }}>
                {(['fr', 'en'] as const).map(l => (
                  <Text key={l} selectable style={{ ...texte(theme, 14), flex: large ? 1 : undefined }}>{`${l.toUpperCase()} · ${c.textes?.[r]?.[l] || '—'}`}</Text>
                ))}
              </View>
            </View>
          ))}
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            {c.droits.valider ? (
              <BoutonHub
                theme={theme}
                titre={trCm('circuit.valider')}
                variante="plein"
                onPress={() =>
                  void agir('valider', async () => {
                    await api.valider(c.id, { versionAttendue: c.version });
                    await charger();
                    return trCm('circuit.valide');
                  })
                }
                testID={`esport-cm-valider-${c.id}-ok`}
              />
            ) : null}
            {c.droits.valider ? <BoutonHub theme={theme} titre={trCm('circuit.refuser')} onPress={() => setRefus({ id: c.id, motif: '' })} testID={`esport-cm-valider-${c.id}-refuser`} /> : null}
            <BoutonHub theme={theme} titre={trCm('valider.ouvrir')} onPress={() => onOuvrir(c.tableauId)} testID={`esport-cm-valider-${c.id}-ouvrir`} />
          </View>
          {refus?.id === c.id ? (
            <View style={{ gap: ESP.xs }}>
              <Champ theme={theme} libelle={trCm('circuit.motif')} valeur={refus.motif} onChanger={motif => setRefus({ id: c.id, motif })} multiligne maxLength={1000} testID={`esport-cm-valider-${c.id}-motif`} />
              <BoutonHub
                theme={theme}
                titre={trCm('circuit.confirmer_refus')}
                variante="danger"
                desactive={refus.motif.trim().length < 2}
                onPress={() =>
                  void agir('refuser', async () => {
                    await api.refuser(c.id, refus.motif.trim());
                    setRefus(undefined);
                    await charger();
                  })
                }
                testID={`esport-cm-valider-${c.id}-refus-ok`}
              />
            </View>
          ) : null}
        </Carte>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ Réglages

function Reglages({ theme, api }: { theme: ThemeHub; api: ApiCm }) {
  const [r, setR] = useState<ReglagesCm | undefined>();
  const [hashtags, setHashtags] = useState('');
  const { erreur, avis, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => {
      const x = await api.reglages();
      setR(x);
      setHashtags(x.suggestions.hashtags);
    });
  }, [agir, api]);
  if (!r) return <Retours theme={theme} erreur={erreur} prefixe="esport-cm-reglages" />;
  const s = r.suggestions;
  const changer = (x: Partial<ReglagesCm['suggestions']>) => void agir('reglages', async () => setR(await api.changerReglages({ suggestions: x })));
  return (
    <Carte theme={theme} testID="esport-cm-reglages">
      <TitreCarte theme={theme} titre={trCm('reglages.suggestions')} sous={trCm('reglages.suggestions_aide')} />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-reglages" />
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={texte(theme)}>{trCm('reglages.actives')}</Text>
        <Interrupteur theme={theme} libelle={trCm('reglages.actives')} valeur={s.actif} onChanger={actif => changer({ actif })} testID="esport-cm-reglages-actif" />
      </View>
      {(['tournoi', 'j1', 'jourj', 'resultat', 'final'] as const).map(t => (
        <View key={t} style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Text style={texte(theme)}>{trCm(`reglages.type.${t}` as CleCm)}</Text>
          <Interrupteur theme={theme} libelle={trCm(`reglages.type.${t}` as CleCm)} valeur={s.types[t]} desactive={!s.actif} onChanger={v => changer({ types: { ...s.types, [t]: v } })} testID={`esport-cm-reglages-${t}`} />
        </View>
      ))}
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trCm('reglages.reseaux')}</Text>
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        {CLES_RESEAUX.map(rs => (
          <PastilleReseau key={rs} theme={theme} reseau={rs} actif={s.reseaux.includes(rs)} onPress={() => changer({ reseaux: s.reseaux.includes(rs) ? s.reseaux.filter(x => x !== rs) : [...s.reseaux, rs] })} testID={`esport-cm-reglages-reseau-${rs}`} />
        ))}
      </View>
      <Champ theme={theme} libelle={trCm('reglages.hashtags')} valeur={hashtags} onChanger={setHashtags} maxLength={200} placeholder={trCm('reglages.hashtags_exemple')} testID="esport-cm-reglages-hashtags" />
      {hashtags !== s.hashtags ? <BoutonHub theme={theme} titre={trCm('c.enregistrer')} onPress={() => changer({ hashtags })} testID="esport-cm-reglages-hashtags-ok" /> : null}
      <Aide theme={theme}>{trCm('reglages.module_aide', { reseaux: CLES_RESEAUX.map(x => RESEAUX[x].nom).join(', ') })}</Aide>
    </Carte>
  );
}

// ------------------------------------------------------------------ Journal

function JournalCm({ theme, api }: { theme: ThemeHub; api: ApiCm }) {
  const [entrees, setEntrees] = useState<EntreeJournalCm[] | undefined>();
  const [noms, setNoms] = useState<Record<string, string | null>>({});
  const { erreur, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => {
      const r = await api.journal();
      setEntrees(r.entrees);
      setNoms(r.noms);
    });
  }, [agir, api]);
  return (
    <Carte theme={theme} testID="esport-cm-journal">
      <TitreCarte theme={theme} titre={trCm('espace.journal')} sous={trCm('journal.aide')} />
      <Retours theme={theme} erreur={erreur} prefixe="esport-cm-journal" />
      {entrees && !entrees.length ? <Text style={attenue(theme)}>{trCm('journal.vide')}</Text> : null}
      {entrees?.map(e => (
        <Text key={e.id} style={texte(theme, 13)}>
          {`${quand(e.date, FUSEAU_CLUB)} · ${phraseJournalCm(e.action, e.acteur ? (noms[e.acteur] ?? (e.acteur === 'principal' ? tr('jr.fondateur') : tr('jr.compte_supprime'))) : tr('jr.quelquun'), e.meta) ?? e.action}${e.team?.nom ? ` (${e.team.nom})` : ''}`}
        </Text>
      ))}
    </Carte>
  );
}
