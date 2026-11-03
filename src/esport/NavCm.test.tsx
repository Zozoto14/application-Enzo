/**
 * L'espace CM du club est rangé dans Teams : plus d'entrée « CM » dans la navigation principale (PC et
 * téléphone), une carte « CM du club » en tête de la page Teams (selon les droits de GET /cm/moi), l'entrée
 * « Teams » surlignée dans l'espace CM, retour vers Teams, raccourci vers le Drive (Fondateur : tout).
 */

import React from 'react';
import { Dimensions } from 'react-native';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { REGISTRE } from '../hub/registre';
import { themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { oublierSessions, type ClientEsport, type Moi, type TeamListee } from './client';
import type { MoiCm } from './cm/api';
import { definirLangue } from './i18n';
import { navEsport, NAV_ESPORT } from './ui/CadreEsport';
import { Esport, fabrique, ongletDeVue } from './ui/RacineEsport';
import { CadreEsport } from './ui/CadreEsport';
import { EspaceCm } from './ui/cm/EspaceCm';

const theme = themeHub('nuit');
const relaisReel = fabrique.relais;
const clientReel = fabrique.client;

afterEach(() => {
  fabrique.relais = relaisReel;
  fabrique.client = clientReel;
  oublierSessions();
  definirLangue('fr');
});

const DRIVE = ['cm.drive.envoyer', 'cm.drive.gerer', 'cm.drive.voir'] as const;
/** Ce que GET /cm/moi rend au Fondateur (super admin : toutes les permissions CM, Drive compris). */
const MOI_FONDATEUR: MoiCm = {
  espace: true,
  sponsors: ['sponsors.gerer', 'sponsors.voir'],
  club: ['cm.clips.proposer', 'cm.deposer', ...DRIVE, 'cm.editer', 'cm.gerer', 'cm.valider', 'cm.voir'],
  teams: [],
  gerer: true,
};
const MOI_SANS_CM: MoiCm = { espace: false, sponsors: [], club: [], teams: [], gerer: false };

const quota = { utilise: 0, enCours: 0, limite: 20_000, pourcent: 0, alerte: false, fichierMax: 1024, zipMax: 1024 };
const droits = { voir: true, envoyer: true, gerer: true, depot: false };

const equipe = (id: string, nom: string, slug: string): TeamListee => ({ id, nom, slug, jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false, membres: 3, modules: [], role: null, suspendu: false });
const FAUCONS = equipe('t1', 'Faucons', 'faucons');
const ACADEMIE = equipe('t2', 'Académie', 'academie');

function fauxClient(moiCm: MoiCm, superAdmin: boolean, langue: 'fr' | 'en', equipes: TeamListee[] = []) {
  const appels: string[] = [];
  const moi: Moi = { compte: superAdmin ? 'principal' : 'lea12345', superAdmin, profil: { pseudo: 'Léa', riotId: null, discord: null }, peutCreerTeam: superAdmin, peutGererJeux: superAdmin, langue } as Moi;
  const requete = async <R,>(chemin: string): Promise<R> => {
    appels.push(chemin);
    const c = chemin.split('?')[0];
    if (c === '/cm/moi') return moiCm as R;
    if (c === '/cm/tableaux') return { tableaux: [], portees: [] } as R;
    if (c === '/cm/etat') return { versions: {}, aValider: moiCm.gerer ? 3 : 0 } as R;
    if (c === '/cm/a-valider') return { cartes: moiCm.gerer ? [{ id: 'c1', titre: 'Annonce du match', tableauId: 'tb1', tableau: { id: 'tb1', nom: 'Contenus', cleDefaut: null, portee: 'club', team: null }, listeId: 'l1', teamId: null, team: null, statut: 'a_valider', post: true, reseaux: [], datePublication: null, soumisPar: null, soumisLe: null, origine: 'manuel', version: 1, droits: { valider: true, editer: true } }] : [], noms: {} } as R;
    if (c === '/cm/calendrier') return { cartes: moiCm.gerer ? [{ id: 'c2', titre: 'Résultat de la finale', tableauId: 'tb1', reseaux: [], post: true, statut: 'valide', datePublication: new Date(Date.now() + 2 * 86_400_000).toISOString(), archive: false }] : [] } as R;
    if (c === '/cm/reunions') return { reunions: moiCm.gerer ? [{ id: 'r1', cle: 'k', titre: 'Point hebdo CM', statut: 'active', debut: new Date(Date.now() + 86_400_000).toISOString(), fin: new Date(Date.now() + 90_000_000).toISOString() }] : [], noms: {}, droits: { voir: true, gerer: true } } as R;
    if (c === '/cm/reglages') return { suggestions: { actif: true, types: { tournoi: true, j1: true, jourj: true, resultat: true, final: true }, reseaux: [], hashtags: '' } } as R;
    if (c === '/cm/clips') return { clips: [], noms: {} } as R;
    if (c === '/cm/journal') return { entrees: [], noms: {} } as R;
    if (c === '/cm/drive/portees') return { portees: [{ portee: 'club', team: null, droits }], quota, reglages: { rangementVisuels: true, rangementClips: true } } as R;
    if (c === '/cm/drive') return { portee: 'club', team: null, droits, dossier: null, chemin: [], dossiers: [], fichiers: [], noms: {}, tronque: false, quota } as R;
    if (c === '/cm/drive/filtres') return { tags: [], auteurs: [], genres: [] } as R;
    return { ok: true } as R;
  };
  const client = {
    config: { adresse: 'https://esport.test', jetonRelais: 'x' },
    ouvrir: async () => moi,
    moi: async () => moi,
    teams: async () => equipes,
    team: async (id: string) => ({ team: equipes.find(t => t.id === id) ?? equipes[0], modules: [], membres: 3, moi: { membreId: null, role: null, permissions: [], superAdmin: true } }),
    notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
    boiteResumes: async () => ({ attente: 0, nouveaux: 0, teams: [] }),
    tableau: async () => ({ genereLe: '', teams: [], global: { resumesARediger: 0, evenementsSemaine: [], alertes: [] } }),
    requete,
  } as unknown as ClientEsport;
  return { client, appels };
}

async function monter(moiCm: MoiCm, { superAdmin = true, mode = 'large' as 'large' | 'telephone', langue = 'fr' as 'fr' | 'en', equipes = [] as TeamListee[] } = {}) {
  const { client, appels } = fauxClient(moiCm, superAdmin, langue, equipes);
  // L'Esport choisit sa mise en page d'après la largeur de la fenêtre : PC 1440 × 900, iPhone 390 × 844.
  Dimensions.set({ window: mode === 'large' ? { width: 1440, height: 900, scale: 1, fontScale: 1 } : { width: 390, height: 844, scale: 3, fontScale: 1 } });
  fabrique.relais = () => ({ relais: 'https://relais.appdashboard.fr', jeton: 'x'.repeat(20) });
  fabrique.client = () => client;
  await render(
    <ModeAffichageForce mode={mode}>
      <Esport contexte={{}} theme={theme} registre={REGISTRE} onRetour={() => undefined} />
    </ModeAffichageForce>,
  );
  await screen.findByTestId('esport-dashboard');
  await waitFor(() => expect(appels).toContain('/cm/moi'));
  return appels;
}

const selectionne = (id: string) => screen.getByTestId(id).props.accessibilityState?.selected;
/** Téléphone : les sections sont dans le menu du sélecteur de section ; PC : dans la barre latérale. */
const ouvrirSection = async (mode: 'large' | 'telephone') => {
  if (mode === 'telephone') await fireEvent.press(screen.getByTestId('esport-cm-sections'));
};
const fermerSections = async (mode: 'large' | 'telephone') => {
  if (mode === 'telephone') await fireEvent.press(screen.getByTestId('esport-cm-groupe-accueil'));
};

describe('CM rangé dans Teams', () => {
  it('navigation principale : plus aucune entrée « CM », cinq entrées au plus (tiennent dans la barre du bas)', () => {
    expect(NAV_ESPORT.map(n => n.cle)).not.toContain('cm');
    expect(navEsport(true, true).map(n => n.cle)).toEqual(['dashboard', 'teams', 'membres', 'jeux', 'statistiques']);
    expect(navEsport(false, false).map(n => n.cle)).toEqual(['dashboard', 'teams', 'membres']);
    // L'espace CM (et l'ancienne vue « cm ») surligne « Teams ».
    expect(ongletDeVue('cm')).toBe('teams');
    expect(ongletDeVue('boite')).toBe('teams');
    expect(ongletDeVue('membres')).toBe('membres');
  });

  it.each(['large', 'telephone'] as const)('Fondateur (%s) : carte « CM du club » en tête de Teams, Drive visible, « Teams » surligné dans l’espace CM', async mode => {
    const appels = await monter(MOI_FONDATEUR, { mode });
    expect(screen.queryByTestId('esport-nav-cm')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    const carte = await screen.findByTestId('esport-teams-cm');
    expect(carte).toBeTruthy();
    expect(screen.getByTestId('esport-teams-cm-contenu')).toHaveTextContent('ContenusPosts à valider (3)DriveSponsors');
    // Tuile au gabarit des cartes de team : pastille « CM », titre, ligne secondaire, lien en bas.
    expect(screen.getByText('CM', { hidden: true })).toBeTruthy();
    expect(screen.getByText('CM du club')).toBeTruthy();
    expect(screen.getByText('Espace club · 3 sections')).toBeTruthy();
    // Première de la grille des teams.
    expect(within(screen.getByTestId('esport-liste-teams')).getByTestId('esport-teams-cm')).toBeTruthy();
    // Une seule entrée vers le CM sur la page (plus de bouton de repli dans l'en-tête de Teams).
    expect(screen.getAllByText('Ouvrir l’espace CM ›')).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('esport-teams-cm-ouvrir'));
    expect(await screen.findByTestId('esport-cm')).toBeTruthy();
    // PC : le bloc « CM du club » prend la place de la team dans la barre latérale (« Teams » n'est plus surligné,
    // comme dans une team) ; téléphone : « Teams » reste surligné dans la barre du bas.
    expect(selectionne('esport-nav-teams')).toBe(mode === 'telephone');
    // Le Drive (groupe Médias) et les Sponsors (groupe Partenaires) sont dans l'espace CM du Fondateur ; il s'ouvre sur l'Accueil CM.
    await ouvrirSection(mode);
    expect(screen.getByTestId('esport-cm-groupe-medias')).toBeTruthy();
    expect(screen.getByTestId('esport-cm-groupe-partenaires')).toBeTruthy();
    if (mode === 'large') expect(selectionne('esport-cm-groupe-accueil')).toBe(true);
    await fermerSections(mode);
    expect(await screen.findByTestId('esport-cm-accueil')).toBeTruthy();
    // Retour vers Teams.
    await fireEvent.press(screen.getByTestId('esport-cm-retour'));
    expect(await screen.findByTestId('esport-teams')).toBeTruthy();
    // Raccourci « Drive » : l'espace CM s'ouvre sur le Drive.
    await fireEvent.press(screen.getByTestId('esport-teams-cm-drive'));
    await screen.findByTestId('esport-cm');
    // Lien profond : bon groupe (Médias) et bon sous-onglet (Drive), sur PC comme sur téléphone.
    expect(selectionne('esport-cm-onglet-drive')).toBe(true);
    if (mode === 'large') expect(selectionne('esport-cm-groupe-medias')).toBe(true);
    else expect(screen.getByTestId('esport-cm-sections')).toHaveTextContent('Médias ▾');
    await waitFor(() => expect(appels).toContain('/cm/drive/portees'));
  });

  it('sans droit CM (ni cm.voir, ni sponsors.voir, ni cm.drive.*) : pas de carte', async () => {
    await monter(MOI_SANS_CM, { superAdmin: false });
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await screen.findByTestId('esport-teams');
    expect(screen.queryByTestId('esport-teams-cm')).toBeNull();
    expect(screen.queryByTestId('esport-nav-cm')).toBeNull();
  });

  it('Drive seulement (cm.drive.voir) : la carte n’annonce que le Drive et ouvre directement sur lui (EN)', async () => {
    await monter({ espace: true, sponsors: [], club: ['cm.drive.voir'], teams: [], gerer: false }, { superAdmin: false, langue: 'en' });
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await screen.findByTestId('esport-teams-cm');
    expect(screen.queryByTestId('esport-teams-cm-a-valider')).toBeNull();
    expect(screen.getByText('Club CM')).toBeTruthy();
    expect(screen.getByText('Club space · 1 section')).toBeTruthy();
    expect(screen.getByTestId('esport-teams-cm-contenu')).toHaveTextContent('Drive');
    expect(screen.queryByTestId('esport-teams-cm-drive')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-teams-cm-ouvrir'));
    await screen.findByTestId('esport-cm');
    expect(selectionne('esport-cm-groupe-medias')).toBe(true);
    // Un groupe à une seule sous-section : pas de rangée de sous-onglets.
    expect(screen.queryByTestId('esport-cm-sous-onglets')).toBeNull();
    expect(screen.queryByTestId('esport-cm-groupe-contenus')).toBeNull();
    expect(screen.getByTestId('esport-cm-fil')).toHaveTextContent('Teams›Club CM›Media›Drive');
  });

  it('Sponsors seulement (sponsors.voir) : la carte annonce les Sponsors', async () => {
    await monter({ espace: true, sponsors: ['sponsors.voir'], club: [], teams: [], gerer: false }, { superAdmin: false });
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await screen.findByTestId('esport-teams-cm');
    expect(screen.getByTestId('esport-teams-cm-contenu')).toHaveTextContent('Sponsors');
  });

  it('PC : seuls les groupes sont dans la barre latérale ; sous-onglets en haut de page, compteurs sur le groupe et le sous-onglet, fil d’Ariane, barre réduite', async () => {
    const appels = await monter(MOI_FONDATEUR);
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await fireEvent.press(await screen.findByTestId('esport-teams-cm-ouvrir'));
    await screen.findByTestId('esport-cm');
    // Bloc de contexte : pastille CM, titre, rôle, « ⇄ Changer ».
    expect(screen.getByTestId('esport-cm-pastille', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getAllByText('CM du club')).toHaveLength(2); // barre latérale + fil d’Ariane
    expect(screen.getByTestId('esport-cm-role')).toHaveTextContent('Super admin');
    expect(screen.getByTestId('esport-cm-changer')).toHaveTextContent('⇄ Changer');
    // La barre ne garde que les groupes (comme les sections d'une team) ; l'Accueil CM est ouvert d'abord.
    const groupes = ['accueil', 'contenus', 'medias', 'diffusion', 'partenaires', 'equipe', 'gestion'];
    const barre = within(screen.getByTestId('esport-barre-laterale'));
    for (const g of groupes) expect(barre.getByTestId(`esport-cm-groupe-${g}`)).toBeTruthy();
    for (const id of ['tableaux', 'valider', 'calendrier', 'clips', 'visuels', 'drive', 'reunions', 'equipe', 'import', 'reglages', 'journal']) expect(screen.queryByTestId(`esport-cm-onglet-${id}`)).toBeNull();
    expect(selectionne('esport-cm-groupe-accueil')).toBe(true);
    expect(await screen.findByTestId('esport-cm-accueil')).toBeTruthy();
    expect(screen.queryByTestId('esport-cm-sous-onglets')).toBeNull();
    expect(screen.getByTestId('esport-cm-fil')).toHaveTextContent('Teams›CM du club›Accueil CM');
    // Compteur des posts à valider (/cm/etat : 3) remonté sur le groupe Contenus (somme), et sur l'Accueil.
    await waitFor(() => expect(screen.getByTestId('esport-cm-groupe-contenus').props.accessibilityLabel).toBe('Contenus (3)'));
    expect(screen.getByTestId('esport-cm-groupe-medias').props.accessibilityLabel).toBe('Médias');
    await waitFor(() => expect(screen.getByTestId('esport-cm-accueil-valider-n')).toHaveTextContent('3'));
    // Contenus : sous-onglets Tableaux | À valider | Calendrier en haut de la page, pastille sur « À valider ».
    await fireEvent.press(screen.getByTestId('esport-cm-groupe-contenus'));
    expect(await screen.findByTestId('esport-cm-sous-onglets')).toBeTruthy();
    expect(within(screen.getByTestId('esport-cm-sous-onglets')).getAllByRole('tab').map(t => t.props.accessibilityLabel)).toEqual(['Tableaux', 'À valider (3)', 'Calendrier']);
    expect(selectionne('esport-cm-groupe-contenus')).toBe(true);
    expect(selectionne('esport-cm-onglet-tableaux')).toBe(true);
    expect(screen.getByTestId('esport-cm-fil')).toHaveTextContent('Teams›CM du club›Contenus›Tableaux');
    expect(await screen.findByTestId('esport-cm-tableaux')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-cm-onglet-valider'));
    expect(await screen.findByTestId('esport-cm-valider')).toBeTruthy();
    expect(selectionne('esport-cm-onglet-valider')).toBe(true);
    expect(selectionne('esport-cm-onglet-tableaux')).toBe(false);
    expect(screen.getByTestId('esport-cm-fil-section')).toHaveTextContent('À valider');
    // Un autre groupe, puis retour : on retrouve la dernière sous-section ouverte du groupe.
    await fireEvent.press(screen.getByTestId('esport-cm-groupe-gestion'));
    expect(await screen.findByTestId('esport-cm-sous-onglets')).toBeTruthy();
    expect(within(screen.getByTestId('esport-cm-sous-onglets')).getAllByRole('tab').map(t => t.props.accessibilityLabel)).toEqual(['Import Trello', 'Réglages', 'Journal']);
    await fireEvent.press(screen.getByTestId('esport-cm-onglet-reglages'));
    expect(await screen.findByTestId('esport-cm-reglages')).toBeTruthy();
    expect(appels).toContain('/cm/reglages');
    await fireEvent.press(screen.getByTestId('esport-cm-groupe-contenus'));
    expect(await screen.findByTestId('esport-cm-valider')).toBeTruthy();
    // Médias : Clips | Visuels | Drive.
    await fireEvent.press(screen.getByTestId('esport-cm-groupe-medias'));
    expect(within(screen.getByTestId('esport-cm-sous-onglets')).getAllByRole('tab').map(t => t.props.accessibilityLabel)).toEqual(['Clips', 'Visuels', 'Drive']);
    await fireEvent.press(screen.getByTestId('esport-cm-groupe-gestion'));
    // Barre réduite : icônes seules (libellés de groupe masqués), les groupes restent accessibles et nommés.
    await fireEvent.press(screen.getByTestId('esport-barre-bascule'));
    expect(screen.queryByText('Contenus')).toBeNull();
    expect(screen.queryByTestId('esport-cm-changer')).toBeNull();
    expect(screen.getByTestId('esport-cm-groupe-gestion').props.accessibilityLabel).toBe('Gestion');
    expect(selectionne('esport-cm-groupe-gestion')).toBe(true);
    await fireEvent.press(screen.getByTestId('esport-cm-onglet-journal'));
    expect(await screen.findByTestId('esport-cm-journal')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-barre-bascule'));
    // Retour vers Teams par le fil d'Ariane : le bloc quitte la barre.
    await fireEvent.press(screen.getByTestId('esport-cm-retour'));
    await screen.findByTestId('esport-teams');
    expect(screen.queryByTestId('esport-cm-barre')).toBeNull();
    expect(selectionne('esport-nav-teams')).toBe(true);
  });

  it('Accueil CM : à valider, prochaines publications, nouveautés Drive, prochaines réunions, avec accès direct aux sous-sections', async () => {
    await monter({ ...MOI_FONDATEUR, reunions: { voir: true, gerer: true, invite: false } });
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await fireEvent.press(await screen.findByTestId('esport-teams-cm-ouvrir'));
    expect(await screen.findByTestId('esport-cm-accueil')).toBeTruthy();
    expect(await screen.findByText('Annonce du match')).toBeTruthy();
    expect(await screen.findByText('Résultat de la finale')).toBeTruthy();
    expect(await screen.findByText('Point hebdo CM')).toBeTruthy();
    expect(screen.getByTestId('esport-cm-accueil-drive')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-cm-accueil-valider-voir'));
    expect(await screen.findByTestId('esport-cm-valider')).toBeTruthy();
    expect(selectionne('esport-cm-groupe-contenus')).toBe(true);
    expect(selectionne('esport-cm-onglet-valider')).toBe(true);
    await fireEvent.press(screen.getByTestId('esport-cm-groupe-accueil'));
    await fireEvent.press(await screen.findByTestId('esport-cm-accueil-drive-voir'));
    expect(selectionne('esport-cm-onglet-drive')).toBe(true);
    expect(selectionne('esport-cm-groupe-medias')).toBe(true);
  });

  it('liens profonds : le bon groupe et le bon sous-onglet (raccourci Drive de la tuile, notification vers « À valider »)', async () => {
    await monter(MOI_FONDATEUR);
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await fireEvent.press(await screen.findByTestId('esport-teams-cm-drive'));
    await screen.findByTestId('esport-cm');
    expect(selectionne('esport-cm-groupe-medias')).toBe(true);
    expect(selectionne('esport-cm-onglet-drive')).toBe(true);
    expect(screen.getByTestId('esport-cm-fil')).toHaveTextContent('Teams›CM du club›Médias›Drive');
    // Onglet inconnu ou non permis : retour à l'accueil du CM.
    for (const onglet of ['valider', 'journal'] as const) {
      const { unmount } = await render(
        <ModeAffichageForce mode="large">
          <CadreEsport theme={theme} large onglet="teams" onOnglet={() => undefined}>
            <EspaceCm theme={theme} client={fauxClient(MOI_FONDATEUR, true, 'fr').client} large moi={MOI_FONDATEUR} ongletInitial={onglet} />
          </CadreEsport>
        </ModeAffichageForce>,
      );
      expect(selectionne('esport-cm-onglet-' + onglet)).toBe(true);
      expect(selectionne(`esport-cm-groupe-${onglet === 'valider' ? 'contenus' : 'gestion'}`)).toBe(true);
      await unmount();
    }
  });

  it('permissions : seuls les groupes et sous-onglets permis sont listés (gestion réservée à cm.gerer), en anglais', async () => {
    await monter({ espace: true, sponsors: ['sponsors.voir'], club: ['cm.voir', 'cm.editer', 'cm.drive.voir'], teams: [], gerer: false, reunions: { voir: true, gerer: false, invite: false } }, { superAdmin: false, langue: 'en' });
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await fireEvent.press(await screen.findByTestId('esport-teams-cm-ouvrir'));
    await screen.findByTestId('esport-cm');
    for (const g of ['accueil', 'contenus', 'medias', 'diffusion', 'partenaires', 'equipe']) expect(screen.getByTestId(`esport-cm-groupe-${g}`)).toBeTruthy();
    expect(screen.queryByTestId('esport-cm-groupe-gestion')).toBeNull();
    expect(screen.getByTestId('esport-cm-role')).toHaveTextContent('CM editor');
    expect(screen.getAllByText('CM home').length).toBeGreaterThan(0);
    expect(screen.getByText('Partners')).toBeTruthy();
    expect(screen.getByTestId('esport-cm-fil')).toHaveTextContent('Teams›Club CM›CM home');
    // Équipe : Réunions seul (« Équipe CM » est réservé à cm.gerer).
    expect(screen.queryByTestId('esport-cm-onglet-equipe')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-cm-groupe-medias'));
    expect(within(screen.getByTestId('esport-cm-sous-onglets')).getAllByRole('tab').map(t => t.props.accessibilityLabel)).toEqual(['Clips', 'Visuals', 'Drive']);
    await fireEvent.press(screen.getByTestId('esport-cm-groupe-contenus'));
    expect(screen.getByTestId('esport-cm-fil')).toHaveTextContent('Teams›Club CM›Content›Boards');
  });

  it('téléphone : pas de barre latérale ni de nouvelle entrée en bas ; sélecteur de groupe puis sous-onglets en haut de page', async () => {
    await monter(MOI_FONDATEUR, { mode: 'telephone' });
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await fireEvent.press(await screen.findByTestId('esport-teams-cm-ouvrir'));
    await screen.findByTestId('esport-cm');
    expect(screen.queryByTestId('esport-barre-laterale')).toBeNull();
    expect(screen.queryByTestId('esport-cm-barre')).toBeNull();
    expect(screen.queryByTestId('esport-nav-cm')).toBeNull();
    expect(screen.getByTestId('esport-cm-sections')).toHaveTextContent('Accueil CM ▾');
    expect(screen.queryByTestId('esport-cm-sous-onglets')).toBeNull();
    // Groupe Contenus : ses sous-onglets s'affichent sous le sélecteur, la bulle est sur le groupe.
    await fireEvent.press(screen.getByTestId('esport-cm-sections'));
    expect(screen.getByText('Contenus (3)')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-cm-groupe-contenus'));
    expect(screen.getByTestId('esport-cm-sections')).toHaveTextContent('Contenus ▾');
    expect(await screen.findByTestId('esport-cm-sous-onglets')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-cm-onglet-calendrier'));
    expect(selectionne('esport-cm-onglet-calendrier')).toBe(true);
    expect(await screen.findByTestId('esport-cm-calendrier')).toBeTruthy();
  });

  it.each(['large', 'telephone'] as const)('« ⇄ Changer de team » dans une team propose « CM du club » en tête (pastille CM), puis « ⇄ Changer » du CM propose Teams et toutes les teams (%s)', async mode => {
    await monter(MOI_FONDATEUR, { mode, equipes: [FAUCONS, ACADEMIE] });
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await fireEvent.press(await screen.findByTestId('esport-team-faucons'));
    await screen.findByTestId('esport-team');
    // Sens team → CM : « CM du club » en tête, pastille CM rose, puis les autres teams.
    await fireEvent.press(await screen.findByTestId('esport-changer-team'));
    const menu = await screen.findByTestId('esport-changer-team-liste');
    expect(within(menu).getAllByRole('menuitem').map(i => i.props.testID)).toEqual(['esport-changer-cm', 'esport-changer-team-academie']);
    expect(within(screen.getByTestId('esport-changer-cm')).getByText('CM du club')).toBeTruthy();
    expect(within(screen.getByTestId('esport-changer-cm')).getByText('CM', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('esport-changer-cm-pastille', { includeHiddenElements: true })).toHaveStyle({ backgroundColor: '#D6409F' });
    await fireEvent.press(screen.getByTestId('esport-changer-cm'));
    expect(await screen.findByTestId('esport-cm')).toBeTruthy();
    // Sens CM → team : Teams puis chaque team, même rendu (pastille de la couleur de la team).
    await fireEvent.press(screen.getByTestId('esport-cm-changer'));
    const menuCm = await screen.findByTestId('esport-cm-changer-liste');
    expect(within(menuCm).getAllByRole('menuitem').map(i => i.props.testID)).toEqual(['esport-cm-changer-teams', 'esport-cm-changer-faucons', 'esport-cm-changer-academie']);
    expect(screen.getByTestId('esport-cm-changer-academie-pastille', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-cm-changer-academie'));
    expect(await screen.findByTestId('esport-team')).toBeTruthy();
    expect(screen.getAllByText('Académie').length).toBeGreaterThan(0);
  });

  it('sélecteur d’une team : « CM du club » seulement pour qui a accès (mêmes conditions que la tuile), même sans autre team', async () => {
    // Sans droit CM et sans autre team : pas de sélecteur du tout.
    await monter(MOI_SANS_CM, { superAdmin: false, equipes: [FAUCONS, ACADEMIE] });
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await fireEvent.press(await screen.findByTestId('esport-team-faucons'));
    await screen.findByTestId('esport-team');
    await fireEvent.press(await screen.findByTestId('esport-changer-team'));
    expect(screen.queryByTestId('esport-changer-cm')).toBeNull();
    expect(screen.getByTestId('esport-changer-team-academie')).toBeTruthy();
  });

  it('sélecteur d’une team : accès Drive seul → « CM du club » proposé ; une seule team → le CM reste proposé (EN)', async () => {
    await monter({ espace: true, sponsors: [], club: ['cm.drive.voir'], teams: [], gerer: false }, { superAdmin: false, langue: 'en', equipes: [FAUCONS] });
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await fireEvent.press(await screen.findByTestId('esport-team-faucons'));
    await screen.findByTestId('esport-team');
    await fireEvent.press(await screen.findByTestId('esport-changer-team'));
    const menu = await screen.findByTestId('esport-changer-team-liste');
    expect(within(menu).getAllByRole('menuitem').map(i => i.props.testID)).toEqual(['esport-changer-cm']);
    expect(within(menu).getByText('Club CM')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-changer-cm'));
    expect(await screen.findByTestId('esport-cm')).toBeTruthy();
    expect(selectionne('esport-cm-groupe-medias')).toBe(true);
  });
});
