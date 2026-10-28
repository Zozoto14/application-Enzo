/**
 * L'espace CM du club est rangé dans Teams : plus d'entrée « CM » dans la navigation principale (PC et
 * téléphone), une carte « CM du club » en tête de la page Teams (selon les droits de GET /cm/moi), l'entrée
 * « Teams » surlignée dans l'espace CM, retour vers Teams, raccourci vers le Drive (Fondateur : tout).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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
    if (c === '/cm/etat') return { versions: {}, aValider: 0 } as R;
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
    expect(screen.getByTestId('esport-teams-cm-contenu')).toHaveTextContent('Tableaux, posts à valider, calendrier, clips, visuels, réseaux · Drive · Sponsors');
    // Une seule entrée vers le CM sur la page (plus de bouton de repli dans l'en-tête de Teams).
    expect(screen.getAllByText('Ouvrir l’espace CM')).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('esport-teams-cm-ouvrir'));
    expect(await screen.findByTestId('esport-cm')).toBeTruthy();
    expect(selectionne('esport-nav-teams')).toBe(true);
    // Le Drive est un onglet de l'espace CM du Fondateur.
    expect(screen.getByTestId('esport-cm-onglet-drive')).toBeTruthy();
    expect(screen.getByTestId('esport-cm-onglet-sponsors')).toBeTruthy();
    expect(selectionne('esport-cm-onglet-tableaux')).toBe(true);
    // Retour vers Teams.
    await fireEvent.press(screen.getByTestId('esport-cm-retour'));
    expect(await screen.findByTestId('esport-teams')).toBeTruthy();
    // Raccourci « Drive » : l'espace CM s'ouvre sur le Drive.
    await fireEvent.press(screen.getByTestId('esport-teams-cm-drive'));
    await screen.findByTestId('esport-cm');
    expect(selectionne('esport-cm-onglet-drive')).toBe(true);
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
    expect(screen.getByText('✎ Club CM')).toBeTruthy();
    expect(screen.getByTestId('esport-teams-cm-contenu')).toHaveTextContent('Drive');
    expect(screen.queryByTestId('esport-teams-cm-drive')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-teams-cm-ouvrir'));
    await screen.findByTestId('esport-cm');
    expect(selectionne('esport-cm-onglet-drive')).toBe(true);
    expect(screen.queryByTestId('esport-cm-onglet-tableaux')).toBeNull();
  });

  it('Sponsors seulement (sponsors.voir) : la carte annonce les Sponsors', async () => {
    await monter({ espace: true, sponsors: ['sponsors.voir'], club: [], teams: [], gerer: false }, { superAdmin: false });
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await screen.findByTestId('esport-teams-cm');
    expect(screen.getByTestId('esport-teams-cm-contenu')).toHaveTextContent('Sponsors');
  });
});
