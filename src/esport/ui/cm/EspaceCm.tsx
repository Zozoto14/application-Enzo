/**
 * Espace CM du club (carte « CM du club » en tête de la page Teams de l'Esport) : tableaux (club et teams), file « À
 * valider », calendrier éditorial, clips des joueurs, visuels (modèles, charte, éditeur ; docs/esport/visuels.md), et pour le gestionnaire (cm.gerer) : équipe et rôles
 * CM, import Trello, réglages (suggestions automatiques), journal de la section. Page « Réseaux » (comptes, bot
 * d'annonce Discord, statistiques ; docs/esport/reseaux-stats.md) pour qui voit la section CM. Drive (dossiers et fichiers du
 * club et des teams ; docs/esport/drive.md) pour qui a un droit cm.drive.*. Rubrique « Sponsors » pour qui a
 * sponsors.voir (affectation « club ») : seule visible pour un compte qui n'a QUE les Sponsors. Section « Réunions »
 * (réunions, disponibilités et rendez-vous de l'équipe CM ; docs/esport/cm-reunions.md) pour l'équipe CM et pour
 * un membre du club invité à une réunion. Les sections sont rangées dans la barre latérale du cadre (bloc « CM du club »,
 * comme les sections d'une team) ; sur téléphone, un sélecteur de section en haut de page. Tout est décidé
 * par le serveur ; l'écran n'affiche que ce que la réponse permet.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ, Interrupteur } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport, TeamListee } from '../../client';
import { apiCm, PORTEE_CLUB, voitDrive, type ApiCm, type CarteTransverse, type EntreeJournalCm, type ListeTableaux, type MoiCm, type ReglagesCm, type TeamCm } from '../../cm/api';
import { phraseJournalCm } from '../../cm/libelles';
import { CLES_RESEAUX, RESEAUX } from '../../cm/reseaux';
import { trCm, trnCm, type CleCm } from '../../i18n/cm';
import { tr } from '../../i18n';
import { EntreeLaterale, PageEsport, SiBarreEtendue, SiBarreReduite, useBlocLateral } from '../CadreEsport';
import { PastilleRole, Retours, styles, useAgir } from '../commun';
import { Badge, COULEUR_CM_CLUB, Carte, ESP, EtatVide, Grille, MenuActions, SqueletteCartes, TitreCarte, Volet, attenue, texte, type ActionSecondaire } from '../design';
import { Aide, BadgeStatut, FUSEAU_CLUB, PALETTE, PastilleReseau, Teinte, nomTableau, quand, useEtatCm } from './commun';
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
import { Reunions } from './reunions/Reunions';
import { trRe } from '../../i18n/reunions';
import { useNouveautesDrive } from '../../cm/nouveautesDrive';

export type OngletCm = 'tableaux' | 'valider' | 'calendrier' | 'clips' | 'visuels' | 'reunions' | 'drive' | 'reseaux' | 'sponsors' | 'equipe' | 'import' | 'reglages' | 'journal';

/** Pictogrammes des sections dans la barre latérale (colonne d'icônes quand elle est réduite). */
const GLYPHES_CM: Record<OngletCm, string> = {
  tableaux: '▦',
  valider: '✓',
  calendrier: '▤',
  clips: '▶',
  visuels: '◩',
  drive: '☁',
  reseaux: '◉',
  sponsors: '★',
  reunions: '◷',
  equipe: '☺',
  import: '⇩',
  reglages: '⚙︎',
  journal: '≡',
};

export interface EntreeCm {
  id: OngletCm;
  libelle: string;
  glyphe: string;
  /** Compteur (posts à valider, nouveautés du Drive). */
  compteur?: number;
}
export interface GroupeCm {
  id: string;
  libelle: string;
  entrees: EntreeCm[];
}

/**
 * Sections de l'espace CM rangées par groupe, selon les droits (mêmes conditions qu'avant dans la rangée d'onglets) :
 * Contenus, Médias, Diffusion, Partenaires, Équipe, Gestion. Un groupe sans section n'apparaît pas.
 */
export function groupesCm({ voirCm, drive, sponsors, reunions, gerer, aValider, nouveautesDrive }: { voirCm: boolean; drive: boolean; sponsors: boolean; reunions: boolean; gerer: boolean; aValider?: number; nouveautesDrive?: number }): GroupeCm[] {
  const e = (id: OngletCm, libelle: string, compteur?: number): EntreeCm => ({ id, libelle, glyphe: GLYPHES_CM[id], compteur: compteur || undefined });
  return (
    [
      { id: 'contenus', libelle: trCm('espace.g.contenus'), entrees: voirCm ? [e('tableaux', trCm('espace.tableaux')), e('valider', trCm('espace.valider'), aValider), e('calendrier', trCm('espace.calendrier'))] : [] },
      { id: 'medias', libelle: trCm('espace.g.medias'), entrees: [...(voirCm ? [e('clips', trCm('espace.clips')), e('visuels', trVi('espace.titre'))] : []), ...(drive ? [e('drive', trCm('espace.drive'), nouveautesDrive)] : [])] },
      { id: 'diffusion', libelle: trCm('espace.g.diffusion'), entrees: voirCm ? [e('reseaux', trCm('espace.reseaux'))] : [] },
      { id: 'partenaires', libelle: trCm('espace.g.partenaires'), entrees: sponsors ? [e('sponsors', trCm('espace.sponsors'))] : [] },
      { id: 'equipe', libelle: trCm('espace.g.equipe'), entrees: [...(reunions ? [e('reunions', trRe('onglet'))] : []), ...(gerer ? [e('equipe', trCm('espace.equipe'))] : [])] },
      { id: 'gestion', libelle: trCm('espace.g.gestion'), entrees: gerer ? [e('import', trCm('espace.import')), e('reglages', trCm('espace.reglages')), e('journal', trCm('espace.journal'))] : [] },
    ] as GroupeCm[]
  ).filter(g => g.entrees.length > 0);
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

/** Bloc de la barre latérale : pastille « CM », titre, rôle, « ⇄ Changer », sections par groupe. */
function BlocLateralCm({ theme, groupes, actif, onChoisir, role, destinations }: { theme: ThemeHub; groupes: GroupeCm[]; actif: OngletCm; onChoisir(id: OngletCm): void; role: string; destinations: ActionSecondaire[] }) {
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
        {groupes.map((g, i) => (
          <View key={g.id} style={{ gap: ESP.xxs }} testID={`esport-cm-groupe-${g.id}`}>
            <SiBarreEtendue>
              <Text style={{ ...attenue(theme, 11), fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: ESP.s, paddingTop: i ? ESP.xs : 0 }} accessibilityRole="header">
                {g.libelle}
              </Text>
            </SiBarreEtendue>
            {i > 0 ? <SiBarreReduite><View style={{ height: 1, backgroundColor: theme.ligne, marginVertical: ESP.xxs, marginHorizontal: ESP.xs }} /></SiBarreReduite> : null}
            {g.entrees.map(en => (
              <EntreeLaterale
                key={en.id}
                theme={theme}
                libelle={en.libelle}
                glyphe={en.glyphe}
                description={en.compteur ? `${en.libelle} (${en.compteur})` : en.libelle}
                choisi={en.id === actif}
                compteur={en.compteur}
                onPress={() => onChoisir(en.id)}
                testID={`esport-cm-onglet-${en.id}`}
              />
            ))}
          </View>
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
}) {
  const api = useMemo(() => apiCm(client), [client]);
  // Rubrique Sponsors (migration 0024) : permissions du club, indépendantes de la section CM.
  const voirCm = moi.club.includes('cm.voir') || moi.teams.some(t => t.permissions.includes('cm.voir'));
  const sponsors = Boolean(moi.sponsors?.includes('sponsors.voir'));
  // Drive (migration 0027) : du club ou d'une team, pour qui y a un droit (un compte peut n'avoir QUE le Drive).
  const drive = voitDrive(moi.club) || moi.teams.some(t => voitDrive(t.permissions));
  // Réunions de l'équipe CM (migration 0039) : l'équipe CM, et tout membre du club invité à une réunion.
  const reunions = Boolean(moi.reunions?.voir || moi.reunions?.invite);
  const [onglet, setOnglet] = useState<OngletCm>(() => {
    const permis: Partial<Record<OngletCm, boolean>> = { drive, sponsors, reunions, equipe: moi.gerer, import: moi.gerer, reglages: moi.gerer, journal: moi.gerer };
    if (ongletInitial && (permis[ongletInitial] ?? voirCm)) return ongletInitial;
    return voirCm ? 'tableaux' : drive ? 'drive' : sponsors ? 'sponsors' : reunions ? 'reunions' : 'tableaux';
  });
  const [ouvert, setOuvert] = useState<string | undefined>();
  const { etat } = useEtatCm(api, voirCm);
  // Pastille du Drive : nouveautés (fichiers, dossiers, versions ajoutés par d'autres) dans tous les Drive visibles.
  const nouveautesDrive = useNouveautesDrive(client, undefined, drive);
  const teams: TeamCm[] = moi.teams;
  // « ⇄ Changer » : Teams, puis chaque team (comme le sélecteur d'une team).
  const [mesTeams, setMesTeams] = useState<TeamListee[]>([]);
  useEffect(() => {
    if (!onOuvrirTeam) return;
    let vivant = true;
    void Promise.resolve()
      .then(() => client.teams())
      .then(l => vivant && setMesTeams(l), () => undefined);
    return () => {
      vivant = false;
    };
  }, [client, onOuvrirTeam]);
  const groupes = groupesCm({ voirCm, drive, sponsors, reunions, gerer: moi.gerer, aValider: etat?.aValider, nouveautesDrive });
  const toutes = groupes.flatMap(g => g.entrees);
  const courante = toutes.find(e => e.id === onglet);
  const choisir = (id: OngletCm) => {
    if (id === 'tableaux') setOuvert(undefined);
    setOnglet(id);
  };
  const destinations: ActionSecondaire[] = [
    ...(onQuitter ? [{ titre: tr('dashboard.teams'), onPress: onQuitter, testID: 'esport-cm-changer-teams' }] : []),
    ...mesTeams.filter(t => !t.suspendu).map(t => ({ titre: t.nom, onPress: () => onOuvrirTeam?.(t.id), testID: `esport-cm-changer-${t.slug}` })),
  ];
  const role = roleCm(moi, fondateur, voirCm);
  // PC : sections dans la barre latérale du cadre (sous l'Esport), comme les sections d'une team.
  useBlocLateral(<BlocLateralCm theme={theme} groupes={groupes} actif={onglet} onChoisir={choisir} role={role} destinations={destinations} />, large);
  return (
    <PageEsport large={large} testID="esport-cm" largeur={1600}>
      {large ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xxs, flexWrap: 'wrap' }} accessibilityRole="navigation" aria-label={tr('pageTeam.fil_d_ariane')} testID="esport-cm-fil">
          {onQuitter ? (
            <>
              <Pressable testID="esport-cm-retour" accessibilityRole="link" onPress={onQuitter} style={{ minHeight: 32, justifyContent: 'center' }}>
                <Text style={{ ...texte(theme, 14), color: theme.accent, fontWeight: '600' }}>{tr('dashboard.teams')}</Text>
              </Pressable>
              <Text style={attenue(theme, 14)}>›</Text>
            </>
          ) : null}
          <Text style={{ ...texte(theme, 14), fontWeight: '600' }}>{tr('cm.club_titre')}</Text>
          {courante ? (
            <>
              <Text style={attenue(theme, 14)}>›</Text>
              <Text style={attenue(theme, 14)} testID="esport-cm-fil-section">{courante.libelle}</Text>
            </>
          ) : null}
        </View>
      ) : (
        // Téléphone : pas de nouvelle section dans la barre du bas ; retour et sélecteur de section en haut de page.
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
          </View>
          <MenuActions
            theme={theme}
            testID="esport-cm-sections"
            libelle={trCm('espace.sections_de')}
            titreBouton={`${courante?.libelle ?? trCm('espace.titre')} ▾`}
            actions={toutes.map(en => ({ titre: en.compteur ? `${en.libelle} (${en.compteur})` : en.libelle, onPress: () => choisir(en.id), testID: `esport-cm-onglet-${en.id}` }))}
          />
        </View>
      )}
      {onglet === 'sponsors' && sponsors ? (
        <EspaceSponsors
          theme={theme}
          client={client}
          large={large}
          gerer={Boolean(moi.sponsors?.includes('sponsors.gerer'))}
          teams={teams.map(t => ({ id: t.id, nom: t.nom ?? '' }))}
          onExporter={onExporter}
          onOuvrirTableau={id => {
            setOuvert(id);
            setOnglet('tableaux');
          }}
        />
      ) : null}
      {onglet === 'tableaux' && voirCm ? (
        ouvert ? (
          <Tableau theme={theme} api={api} id={ouvert} large={large} teams={teams} versionServeur={etat?.versions[ouvert]} onRetour={() => setOuvert(undefined)} />
        ) : (
          <ListeTableauxCm theme={theme} api={api} large={large} onOuvrir={setOuvert} />
        )
      ) : null}
      {onglet === 'valider' ? <FileValidation theme={theme} api={api} large={large} version={etat?.aValider} onOuvrir={id => { setOuvert(id); setOnglet('tableaux'); }} /> : null}
      {onglet === 'calendrier' ? <Calendrier theme={theme} api={api} large={large} creerPost={moi.club.includes('cm.editer') || moi.teams.some(t => t.permissions.includes('cm.editer'))} onOuvrirTableau={id => { setOuvert(id); setOnglet('tableaux'); }} /> : null}
      {onglet === 'clips' ? <GalerieClips theme={theme} api={api} large={large} teams={teams} /> : null}
      {onglet === 'reseaux' && voirCm ? <EspaceReseaux theme={theme} client={client} large={large} onExporter={onExporter} /> : null}
      {onglet === 'visuels' && voirCm ? <Visuels theme={theme} apiCm={api} large={large} moi={moi} /> : null}
      {onglet === 'reunions' && reunions ? <Reunions theme={theme} client={client} large={large} onExporter={onExporter} /> : null}
      {onglet === 'drive' && drive ? (
        <Drive
          theme={theme}
          client={client}
          large={large}
          onOuvrirTableau={
            voirCm
              ? id => {
                  setOuvert(id);
                  setOnglet('tableaux');
                }
              : undefined
          }
        />
      ) : null}
      {onglet === 'equipe' && moi.gerer ? <RolesCm theme={theme} api={api} large={large} /> : null}
      {onglet === 'import' && moi.gerer ? <ImportTrello theme={theme} api={api} large={large} onOuvrir={id => { setOuvert(id); setOnglet('tableaux'); }} /> : null}
      {onglet === 'reglages' && moi.gerer ? <Reglages theme={theme} api={api} /> : null}
      {onglet === 'journal' && moi.gerer ? <JournalCm theme={theme} api={api} /> : null}
    </PageEsport>
  );
}

// ------------------------------------------------------------------ Tableaux

function ListeTableauxCm({ theme, api, large, onOuvrir }: { theme: ThemeHub; api: ApiCm; large: boolean; onOuvrir(id: string): void }) {
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
            <Carte key={t.id} theme={theme} dense accent={t.couleur} onPress={() => onOuvrir(t.id)} libelle={trCm('espace.ouvrir_tableau', { nom: nomTableau(t) })} testID={`esport-cm-tableau-${t.cleDefaut && !t.team ? 'club' : t.id}`}>
              <Text style={{ ...texte(theme, 16), fontWeight: '800' }} numberOfLines={2}>
                {nomTableau(t)}
              </Text>
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                <Badge theme={theme} ton={t.team ? 'neutre' : 'accent'} texte={t.team ? (t.team.nom ?? '') : trCm('portee.club')} />
                <Badge theme={theme} texte={trnCm('espace.cartes_n', t.cartes ?? 0)} />
                {t.aValider ? <Badge theme={theme} ton="alerte" texte={trnCm('espace.a_valider_n', t.aValider)} /> : null}
                {t.trello ? <Badge theme={theme} texte="Trello" /> : null}
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
      {cartes && !cartes.length ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="✓" titre={trCm('valider.vide')} texte={trCm('valider.vide_texte')} />
        </Carte>
      ) : null}
      {cartes?.map(c => (
        <Carte key={c.id} theme={theme} testID={`esport-cm-valider-${c.id}`}>
          <TitreCarte theme={theme} titre={c.titre} sous={[c.tableau ? nomTableau(c.tableau) : '', c.team?.nom ?? '', c.soumisPar ? trCm('valider.par', { qui: noms[c.soumisPar] ?? '?' }) : '', c.datePublication ? trCm('carte.publication_le', { date: quand(c.datePublication) }) : ''].filter(Boolean).join(' · ')} droite={<BadgeStatut theme={theme} statut={c.statut} />} />
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
