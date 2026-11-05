/**
 * Page « Statistiques » (Fondateur) : sous-onglet de l'Administration pour le Fondateur seulement (PC et iPhone),
 * vue d'ensemble, pages les plus et les moins utilisées, utilisateurs et fiche, activité, export CSV ; la
 * collecte d'usage branchée sur la navigation (lot au départ avec keepalive) ; le client (envoi keepalive).
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { REGISTRE } from '../hub/registre';
import { themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { clientEsport, oublierSessions, type ClientEsport, type StatistiquesUsage } from './client';
import { Esport, fabrique } from './ui/RacineEsport';
import { Statistiques } from './ui/Statistiques';
import { definirLangue } from './i18n';

const theme = themeHub('nuit');
const relaisReel = fabrique.relais;
const clientReel = fabrique.client;

afterEach(() => {
  fabrique.relais = relaisReel;
  fabrique.client = clientReel;
  oublierSessions();
  definirLangue('fr');
});

const jours = ['2026-10-18', '2026-10-19', '2026-10-20'];
export const DONNEES: StatistiquesUsage = {
  genereLe: '2026-10-20T10:00:00.000Z',
  fuseau: 'Europe/Paris',
  periode: { du: '2026-10-18', au: '2026-10-20', jours: 3, precedente: { du: '2026-10-15', au: '2026-10-17' } },
  filtres: { team: null, role: null, appareil: null, absents: 14 },
  collecte: { actif: true, debut: '2026-10-19', agregeJusqua: '2026-10-20' },
  historique: { reconstitue: true, du: '2026-10-18', au: '2026-10-18' },
  choix: { teams: [{ id: 't1', nom: 'Faucons', slug: 'faucons' }], roles: ['proprietaire', 'joueur'], appareils: ['pc', 'tablette', 'telephone', 'app_pc', 'discord'], pages: ['esport.dashboard', 'team.agenda.planning', 'team.jeu.strat_editor', 'team.jeu.resources'] },
  apercu: {
    actifsJour: 2,
    actifsSemaine: 2,
    actifsMois: 3,
    periode: { actifs: 2, sessions: 4, vues: 9, dureeMs: 600_000, dureeMoyenneMs: 150_000, actions: 3, inscriptions: 1, invitationsAcceptees: 1 },
    precedente: { actifs: 1, sessions: 4, vues: 3, dureeMs: 100_000, dureeMoyenneMs: 25_000, actions: 0, inscriptions: 0, invitationsAcceptees: 0 },
  },
  utilisateurs: [
    { compte: 'lea12345', pseudo: 'Léa', teams: [{ id: 't1', nom: 'Faucons', role: 'Joueur', cle: 'joueur', statut: 'actif' }], statut: 'actif', inscritLe: '2026-10-01T10:00:00.000Z', derniereActivite: '2026-10-20T09:00:00.000Z', source: 'mesure', jamaisConnecte: false, inactif: false, inactifJours: 0, sessions: 3, dureeMs: 500_000, vues: 7, actions: 2, appareil: 'pc', pagesPreferees: [{ page: 'team.agenda.planning', vues: 5 }] },
    { compte: 'kai12345', pseudo: 'Kai', teams: [], statut: 'invite', inscritLe: '2026-10-02T10:00:00.000Z', derniereActivite: null, source: null, jamaisConnecte: true, inactif: true, inactifJours: null, sessions: 0, dureeMs: 0, vues: 0, actions: 0, appareil: null, pagesPreferees: [] },
  ],
  pages: {
    classement: [
      { page: 'team.agenda.planning', module: 'planning', vues: 6, visiteurs: 2, dureeMs: 400_000, dureeMoyenneMs: 66_000 },
      { page: 'esport.dashboard', module: null, vues: 2, visiteurs: 2, dureeMs: 60_000, dureeMoyenneMs: 30_000 },
      { page: 'team.jeu.resources', module: 'resources', vues: 1, visiteurs: 1, dureeMs: 4_000, dureeMoyenneMs: 4_000 },
    ],
    jamais: ['team.jeu.strat_editor'],
    nonUtilises: [{ team: { id: 't1', nom: 'Faucons', slug: 'faucons' }, modules: ['strat_editor'] }],
  },
  activite: {
    chaleur: Array.from({ length: 7 }, (_, j) => Array.from({ length: 24 }, (_, h) => (j === 1 && h === 12 ? 9 : 0))),
    quotidien: jours.map((jour, i) => ({ jour, actifs: i + 1, vues: i * 3, sessions: i * 2, actions: 1, reconstitue: i === 0 })),
    appareils: [{ appareil: 'pc', visiteurs: 2, sessions: 3, vues: 8, dureeMs: 500_000 }, { appareil: 'telephone', visiteurs: 1, sessions: 1, vues: 1, dureeMs: 100_000 }],
    langues: [{ langue: 'fr', visiteurs: 2, sessions: 4 }],
  },
  teams: [{ id: 't1', nom: 'Faucons', slug: 'faucons', membres: 4, visiteurs: 2, adoption: 50, vues: 7, dureeMs: 404_000, actions: 3, actionsReconstituees: 1 }],
  fonctions: [
    { fonction: 'rsvp', n: 2, reconstitue: 0, utilisateurs: 2, actions: { rsvp: 2 } },
    { fonction: 'planning', n: 0, reconstitue: 1, utilisateurs: 1, actions: {} },
    { fonction: 'bot', n: 0, reconstitue: 0, utilisateurs: 0, actions: {} },
  ],
  erreurs: [{ empreinte: 'abcd1234', message: 'TypeError: x is undefined', page: 'team.jeu.resources', n: 3, utilisateurs: 2, appareils: ['pc'], derniere: '2026-10-20' }],
};

const MOI = (superAdmin: boolean) => ({ compte: superAdmin ? 'principal' : 'own12345', superAdmin, profil: { pseudo: superAdmin ? 'Fondateur' : 'Olga', riotId: null, discord: null }, peutCreerTeam: superAdmin });

function fauxClient(superAdmin: boolean, surcharges: Partial<ClientEsport> = {}): ClientEsport {
  return {
    config: { adresse: 'https://esport.test', jetonRelais: 'x' },
    ouvrir: async () => MOI(superAdmin),
    moi: async () => MOI(superAdmin),
    teams: async () => [],
    tableau: async () => ({ genereLe: '', teams: [], global: { resumesARediger: 0, evenementsSemaine: [], alertes: [] } }),
    notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
    boiteResumes: async () => ({ depots: [], teams: [], types: [], deposants: [], attente: 0, nouveaux: 0, total: 0 }),
    requete: jest.fn(async (chemin: string, methode = 'GET', corps?: { collecte?: boolean }) => {
      if (chemin.startsWith('/statistiques/membres/')) return FICHE;
      if (chemin === '/statistiques/reglages' && methode === 'PUT') return { collecte: corps?.collecte, debut: '2026-10-19', agregeJusqua: null };
      if (chemin.startsWith('/statistiques')) return DONNEES;
      throw new Error(`non prévu : ${chemin}`);
    }),
    ...surcharges,
  } as unknown as ClientEsport;
}

const FICHE = {
      compte: 'lea12345',
      pseudo: 'Léa',
      inscritLe: '2026-10-01T10:00:00.000Z',
      premiereConnexion: '2026-10-01T11:00:00.000Z',
      statut: 'actif' as const,
      teams: [{ id: 't1', nom: 'Faucons', role: 'Joueur', statut: 'actif' }],
      periode: { du: '2026-10-18', au: '2026-10-20' },
      totaux: { sessions: 3, vues: 7, dureeMs: 500_000, actions: 2 },
      appareils: ['pc'],
      parJour: [],
      pages: [{ page: 'team.agenda.planning', vues: 5, dureeMs: 300_000 }],
      chronologie: [
        { date: '2026-10-20T09:00:00.000Z', source: 'mesure' as const, genre: 'page' as const, page: 'team.agenda.planning', team: 'Faucons', action: null, dureeMs: 60_000, appareil: 'pc', erreur: null },
        { date: '2026-10-18T09:00:00.000Z', source: 'journal' as const, genre: 'action' as const, page: null, team: 'Faucons', action: 'attendance.rsvp', dureeMs: 0, appareil: null, erreur: null },
      ],
};

/** Paramètres de la dernière requête des statistiques (hors fiche et réglages). */
const derniersFiltres = (client: ClientEsport): Record<string, string> => {
  const appels = (client.requete as jest.Mock).mock.calls.map(c => String(c[0])).filter(c => /^\/statistiques(\?|$)/.test(c));
  return Object.fromEntries(new URLSearchParams(appels[appels.length - 1]?.split('?')[1] ?? ''));
};

async function monter(client: ClientEsport, mode: 'large' | 'telephone' = 'large', contexte = {}) {
  fabrique.relais = () => ({ relais: 'https://relais.appdashboard.fr', jeton: 'jeton' });
  fabrique.client = () => client;
  return await render(
    <ModeAffichageForce mode={mode}>
      <Esport contexte={contexte} theme={theme} registre={REGISTRE} onRetour={() => undefined} />
    </ModeAffichageForce>,
  );
}

test('navigation : « Statistiques » dans l’Administration, pour le Fondateur seulement', async () => {
  for (const mode of ['large', 'telephone'] as const) {
    const r1 = await monter(fauxClient(false), mode);
    await screen.findByTestId('esport-nav-membres');
    expect(screen.queryByTestId('esport-nav-administration')).toBeNull();
    await r1.unmount();
    const r2 = await monter(fauxClient(true), mode);
    await screen.findByTestId('esport-nav-membres');
    expect(screen.getByTestId('esport-nav-administration')).toBeTruthy();
    await r2.unmount();
  }
  await monter(fauxClient(true));
  await fireEvent.press(await screen.findByTestId('esport-nav-administration'));
  await fireEvent.press(await screen.findByTestId('esport-admin-onglet-statistiques'));
  expect(await screen.findByTestId('esport-statistiques')).toBeTruthy();
  expect(await screen.findByTestId('esport-stats-valeur-periode')).toBeTruthy();
});

test('page : vue d’ensemble et tendance, pages les plus et les moins utilisées, jamais ouvertes, modules non utilisés', async () => {
  const client = fauxClient(true);
  await render(
    <ModeAffichageForce mode="large">
      <Statistiques theme={theme} client={client} large maintenant={() => Date.parse('2026-10-20T10:00:00.000Z')} />
    </ModeAffichageForce>,
  );
  expect((await screen.findByTestId('esport-stats-valeur-periode')).props.children).toBe('2');
  expect(screen.getByText('+100 % par rapport à la période précédente')).toBeTruthy();
  expect(screen.getByTestId('esport-stats-valeur-duree').props.children).toBe('3 min');
  expect(screen.getByTestId('esport-stats-reconstitue')).toBeTruthy();
  expect(derniersFiltres(client)).toMatchObject({ du: '2026-09-21', au: '2026-10-20', absents: '14' });
  await fireEvent.press(screen.getByTestId('esport-stats-onglet-pages'));
  expect(await screen.findByTestId('esport-stats-plus-team.agenda.planning')).toBeTruthy();
  expect(screen.getByTestId('esport-stats-moins-team.jeu.resources')).toBeTruthy();
  expect(screen.getAllByText('Agenda › Planning').length).toBeGreaterThan(0);
  expect(screen.getByTestId('esport-stats-jamais-team.jeu.strat_editor')).toBeTruthy();
  expect(screen.getByTestId('esport-stats-non-utilise-faucons-strat_editor')).toBeTruthy();
  // Période « 7 jours » et filtre appareil : nouvelle requête.
  await fireEvent.press(screen.getByTestId('esport-stats-periode-7'));
  await waitFor(() => expect(derniersFiltres(client)).toMatchObject({ du: '2026-10-14', au: '2026-10-20' }));
  await fireEvent.press(screen.getByTestId('esport-stats-filtres'));
  await fireEvent.press(await screen.findByTestId('esport-stats-appareil-telephone'));
  await waitFor(() => expect(derniersFiltres(client)).toMatchObject({ appareil: 'telephone' }));
});

test('utilisateurs : recherche, inactifs, fiche avec chronologie ; activité ; export CSV ; collecte coupée', async () => {
  const client = fauxClient(true);
  const exporter = jest.fn(async () => true);
  await render(
    <ModeAffichageForce mode="telephone">
      <Statistiques theme={theme} client={client} large={false} onExporter={exporter} maintenant={() => Date.parse('2026-10-20T10:00:00.000Z')} />
    </ModeAffichageForce>,
  );
  await fireEvent.press(await screen.findByTestId('esport-stats-onglet-utilisateurs'));
  expect(await screen.findByTestId('esport-stats-utilisateurs-lea12345')).toBeTruthy();
  expect(screen.getByTestId('esport-stats-utilisateurs-kai12345')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-stats-montrer-jamais'));
  expect(screen.queryByTestId('esport-stats-utilisateurs-lea12345')).toBeNull();
  await fireEvent.press(screen.getByTestId('esport-stats-montrer-tous'));
  await fireEvent.changeText(screen.getByTestId('esport-stats-recherche'), 'lé');
  expect(screen.queryByTestId('esport-stats-utilisateurs-kai12345')).toBeNull();
  await fireEvent.press(screen.getByTestId('esport-stats-utilisateurs-csv'));
  await waitFor(() => expect(exporter).toHaveBeenCalled());
  const [nom, contenu, type] = (exporter.mock.calls[0] as unknown as [string, string, string]);
  expect(nom).toBe('statistiques-utilisateurs-2026-10-18-2026-10-20.csv');
  expect(type).toBe('text/csv');
  expect(contenu.startsWith('﻿"Membre","Teams","Statut","Dernière activité"')).toBe(true);
  expect(contenu).toContain('"Léa","Faucons (Joueur)","Actif"');
  await fireEvent.press(screen.getByTestId('esport-stats-utilisateurs-lea12345'));
  expect(await screen.findByTestId('esport-stats-fiche-resume')).toBeTruthy();
  expect(client.requete).toHaveBeenCalledWith('/statistiques/membres/lea12345?du=2026-10-18&au=2026-10-20');
  expect(screen.getByText(/Journal : attendance.rsvp/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-stats-volet-fermer'));
  // Activité : carte de chaleur (détail au toucher), appareils.
  await fireEvent.press(screen.getByTestId('esport-stats-onglet-activite'));
  await fireEvent.press(await screen.findByTestId('esport-stats-chaleur-2-12'));
  expect(screen.getByTestId('esport-stats-chaleur-detail').props.children).toBe('Mar 12 h : 9 activités');
  expect(screen.getByTestId('esport-stats-appareil-telephone')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-stats-onglet-qualite'));
  expect(await screen.findByText('TypeError: x is undefined')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-stats-onglet-fonctions'));
  expect(await screen.findByTestId('esport-stats-fonction-rsvp')).toBeTruthy();
});

test('anglais : libellés traduits', async () => {
  definirLangue('en');
  await render(
    <ModeAffichageForce mode="large">
      <Statistiques theme={theme} client={fauxClient(true)} large maintenant={() => Date.parse('2026-10-20T10:00:00.000Z')} />
    </ModeAffichageForce>,
  );
  expect(await screen.findByText('Analytics')).toBeTruthy();
  expect(screen.getByText('+100% vs previous period')).toBeTruthy();
});

test('collecte branchée : pages de premier niveau notées, lot keepalive au départ', async () => {
  jest.useFakeTimers();
  try {
    const envoyerUsage = jest.fn(async () => ({ actif: true }));
    const client = fauxClient(false, { envoyerUsage });
    const r = await monter(client);
    await fireEvent.press(await screen.findByTestId('esport-nav-teams'));
    await screen.findByTestId('esport-teams');
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    await fireEvent.press(screen.getByTestId('esport-nav-membres'));
    expect(envoyerUsage).not.toHaveBeenCalled(); // rien avant l'intervalle
    await r.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(envoyerUsage).toHaveBeenCalledTimes(1);
    const [lot, keepalive] = envoyerUsage.mock.calls[0] as unknown as [{ evenements: Array<{ g: string; p?: string; a?: string }> }, boolean];
    expect(keepalive).toBe(true);
    const pages = lot.evenements.filter(e => e.g === 'page').map(e => e.p);
    expect(pages).toEqual(expect.arrayContaining(['esport.teams']));
    expect(lot.evenements[0]).toMatchObject({ g: 'action', a: 'connexion' });
  } finally {
    jest.useRealTimers();
  }
});

test('client : lot normal par la session, lot de départ avec keepalive (sans attendre)', async () => {
  const appels: Array<{ url: string; init?: { method?: string; keepalive?: boolean; headers?: Record<string, string> } }> = [];
  const requete = jest.fn(async (url: string, init?: { method?: string; keepalive?: boolean; headers?: Record<string, string> }) => {
    appels.push({ url, init });
    if (url.endsWith('/session')) return { ok: true, status: 200, json: async () => ({ session: 'es1.s', expire: '2099-01-01T00:00:00.000Z', compte: 'x', superAdmin: false, profil: null, peutCreerTeam: false }) };
    return { ok: true, status: 200, json: async () => ({ actif: true, recus: 1 }) };
  });
  const c = clientEsport({ adresse: 'https://esport.test', jetonRelais: 'jeton-relais-0123456789' }, requete);
  expect(await c.envoyerUsage!({ evenements: [] }, true)).toBeUndefined(); // pas encore de session : rien
  expect(await c.envoyerUsage!({ evenements: [] })).toEqual({ actif: true, recus: 1 });
  await c.envoyerUsage!({ evenements: [] }, true);
  await Promise.resolve();
  const dernier = appels[appels.length - 1];
  expect(dernier.url).toBe('https://esport.test/usage');
  expect(dernier.init?.keepalive).toBe(true);
  expect(dernier.init?.headers?.Authorization).toBe('Bearer es1.s');
});
