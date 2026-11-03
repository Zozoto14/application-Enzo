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
import { oublierSessions, type ClientEsport, type Moi } from './client';
import type { MoiCm } from './cm/api';
import { definirLangue } from './i18n';
import { navEsport, NAV_ESPORT } from './ui/CadreEsport';
import { Esport, fabrique, ongletDeVue } from './ui/RacineEsport';

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

function fauxClient(moiCm: MoiCm, superAdmin: boolean, langue: 'fr' | 'en') {
  const appels: string[] = [];
  const moi: Moi = { compte: superAdmin ? 'principal' : 'lea12345', superAdmin, profil: { pseudo: 'Léa', riotId: null, discord: null }, peutCreerTeam: superAdmin, peutGererJeux: superAdmin, langue } as Moi;
  const requete = async <R,>(chemin: string): Promise<R> => {
    appels.push(chemin);
    const c = chemin.split('?')[0];
    if (c === '/cm/moi') return moiCm as R;
    if (c === '/cm/tableaux') return { tableaux: [], portees: [] } as R;
    if (c === '/cm/etat') return { versions: {}, aValider: moiCm.gerer ? 3 : 0 } as R;
    if (c === '/cm/a-valider') return { cartes: [], noms: {} } as R;
    if (c === '/cm/reglages') return { suggestions: { actif: true, types: { tournoi: true, j1: true, jourj: true, resultat: true, final: true }, reseaux: [], hashtags: '' } } as R;
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
    teams: async () => [],
    notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
    boiteResumes: async () => ({ attente: 0, nouveaux: 0, teams: [] }),
    tableau: async () => ({ genereLe: '', teams: [], global: { resumesARediger: 0, evenementsSemaine: [], alertes: [] } }),
    requete,
  } as unknown as ClientEsport;
  return { client, appels };
}

async function monter(moiCm: MoiCm, { superAdmin = true, mode = 'large' as 'large' | 'telephone', langue = 'fr' as 'fr' | 'en' } = {}) {
  const { client, appels } = fauxClient(moiCm, superAdmin, langue);
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
  if (mode === 'telephone') await fireEvent.press(screen.getByTestId('esport-cm-onglet-tableaux'));
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
    // Le Drive est une section de l'espace CM du Fondateur.
    await ouvrirSection(mode);
    expect(screen.getByTestId('esport-cm-onglet-drive')).toBeTruthy();
    expect(screen.getByTestId('esport-cm-onglet-sponsors')).toBeTruthy();
    if (mode === 'large') expect(selectionne('esport-cm-onglet-tableaux')).toBe(true);
    await fermerSections(mode);
    // Retour vers Teams.
    await fireEvent.press(screen.getByTestId('esport-cm-retour'));
    expect(await screen.findByTestId('esport-teams')).toBeTruthy();
    // Raccourci « Drive » : l'espace CM s'ouvre sur le Drive.
    await fireEvent.press(screen.getByTestId('esport-teams-cm-drive'));
    await screen.findByTestId('esport-cm');
    if (mode === 'large') expect(selectionne('esport-cm-onglet-drive')).toBe(true);
    else expect(screen.getByTestId('esport-cm-sections')).toHaveTextContent('Drive ▾');
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
    expect(selectionne('esport-cm-onglet-drive')).toBe(true);
    expect(screen.queryByTestId('esport-cm-onglet-tableaux')).toBeNull();
    expect(screen.getByTestId('esport-cm-fil-section')).toHaveTextContent('Drive');
  });

  it('Sponsors seulement (sponsors.voir) : la carte annonce les Sponsors', async () => {
    await monter({ espace: true, sponsors: ['sponsors.voir'], club: [], teams: [], gerer: false }, { superAdmin: false });
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await screen.findByTestId('esport-teams-cm');
    expect(screen.getByTestId('esport-teams-cm-contenu')).toHaveTextContent('Sponsors');
  });

  it('PC : sections du CM rangées par groupe dans la barre latérale, compteurs, navigation, fil d’Ariane, barre réduite', async () => {
    const appels = await monter(MOI_FONDATEUR);
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await fireEvent.press(await screen.findByTestId('esport-teams-cm-ouvrir'));
    await screen.findByTestId('esport-cm');
    // Bloc de contexte : pastille CM, titre, rôle, « ⇄ Changer ».
    expect(screen.getByTestId('esport-cm-pastille', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getAllByText('CM du club')).toHaveLength(2); // barre latérale + fil d’Ariane
    expect(screen.getByTestId('esport-cm-role')).toHaveTextContent('Super admin');
    expect(screen.getByTestId('esport-cm-changer')).toHaveTextContent('⇄ Changer');
    // Plus de rangée d'onglets en haut de la page : les sections sont dans la barre (cadre), groupées.
    const groupes = ['contenus', 'medias', 'diffusion', 'partenaires', 'equipe', 'gestion'];
    for (const g of groupes) expect(screen.getByTestId(`esport-cm-groupe-${g}`)).toBeTruthy();
    expect(within(screen.getByTestId('esport-barre-laterale')).getByTestId('esport-cm-onglet-journal')).toBeTruthy();
    expect(within(screen.getByTestId('esport-cm-groupe-contenus')).getByTestId('esport-cm-onglet-valider')).toBeTruthy();
    expect(within(screen.getByTestId('esport-cm-groupe-medias')).getByTestId('esport-cm-onglet-drive')).toBeTruthy();
    expect(within(screen.getByTestId('esport-cm-groupe-equipe')).getByTestId('esport-cm-onglet-equipe')).toBeTruthy();
    // Compteur des posts à valider (/cm/etat : 3).
    await waitFor(() => expect(screen.getByTestId('esport-cm-onglet-valider').props.accessibilityLabel).toBe('À valider (3)'));
    // Fil d'Ariane « Teams › CM du club › Tableaux ».
    expect(screen.getByTestId('esport-cm-fil')).toHaveTextContent('Teams›CM du club›Tableaux');
    // Navigation par la barre : section affichée, entrée surlignée, fil mis à jour.
    await fireEvent.press(screen.getByTestId('esport-cm-onglet-valider'));
    expect(await screen.findByTestId('esport-cm-valider')).toBeTruthy();
    expect(selectionne('esport-cm-onglet-valider')).toBe(true);
    expect(selectionne('esport-cm-onglet-tableaux')).toBe(false);
    expect(screen.getByTestId('esport-cm-fil-section')).toHaveTextContent('À valider');
    await fireEvent.press(screen.getByTestId('esport-cm-onglet-reglages'));
    expect(await screen.findByTestId('esport-cm-reglages')).toBeTruthy();
    expect(appels).toContain('/cm/reglages');
    // Barre réduite : icônes seules (libellés de groupe masqués), les sections restent accessibles et nommées.
    await fireEvent.press(screen.getByTestId('esport-barre-bascule'));
    expect(screen.queryByText('Contenus')).toBeNull();
    expect(screen.queryByTestId('esport-cm-changer')).toBeNull();
    expect(screen.getByTestId('esport-cm-onglet-journal').props.accessibilityLabel).toBe('Journal');
    expect(selectionne('esport-cm-onglet-reglages')).toBe(true);
    await fireEvent.press(screen.getByTestId('esport-cm-onglet-journal'));
    expect(await screen.findByTestId('esport-cm-journal')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-barre-bascule'));
    // Retour vers Teams par le fil d'Ariane : le bloc quitte la barre.
    await fireEvent.press(screen.getByTestId('esport-cm-retour'));
    await screen.findByTestId('esport-teams');
    expect(screen.queryByTestId('esport-cm-barre')).toBeNull();
    expect(selectionne('esport-nav-teams')).toBe(true);
  });

  it('permissions : seules les sections permises sont listées (gestion réservée à cm.gerer), en anglais', async () => {
    await monter({ espace: true, sponsors: ['sponsors.voir'], club: ['cm.voir', 'cm.editer', 'cm.drive.voir'], teams: [], gerer: false, reunions: { voir: true, gerer: false, invite: false } }, { superAdmin: false, langue: 'en' });
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await fireEvent.press(await screen.findByTestId('esport-teams-cm-ouvrir'));
    await screen.findByTestId('esport-cm');
    for (const id of ['tableaux', 'valider', 'calendrier', 'clips', 'visuels', 'drive', 'reseaux', 'sponsors', 'reunions']) expect(screen.getByTestId(`esport-cm-onglet-${id}`)).toBeTruthy();
    for (const id of ['equipe', 'import', 'reglages', 'journal']) expect(screen.queryByTestId(`esport-cm-onglet-${id}`)).toBeNull();
    expect(screen.queryByTestId('esport-cm-groupe-gestion')).toBeNull();
    expect(screen.getByTestId('esport-cm-role')).toHaveTextContent('CM editor');
    expect(screen.getByText('Content')).toBeTruthy();
    expect(screen.getByTestId('esport-cm-fil')).toHaveTextContent('Teams›Club CM›Boards');
  });

  it('téléphone : pas de barre latérale ni de nouvelle entrée en bas ; sélecteur de section en haut de page', async () => {
    await monter(MOI_FONDATEUR, { mode: 'telephone' });
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await fireEvent.press(await screen.findByTestId('esport-teams-cm-ouvrir'));
    await screen.findByTestId('esport-cm');
    expect(screen.queryByTestId('esport-barre-laterale')).toBeNull();
    expect(screen.queryByTestId('esport-cm-barre')).toBeNull();
    expect(screen.queryByTestId('esport-nav-cm')).toBeNull();
    expect(screen.getByTestId('esport-cm-sections')).toHaveTextContent('Tableaux ▾');
    await fireEvent.press(screen.getByTestId('esport-cm-sections'));
    await fireEvent.press(screen.getByTestId('esport-cm-onglet-calendrier'));
    expect(screen.getByTestId('esport-cm-sections')).toHaveTextContent('Calendrier ▾');
    expect(await screen.findByTestId('esport-cm-calendrier')).toBeTruthy();
  });
});
