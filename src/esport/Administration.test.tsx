/**
 * Administration de l'Esport : une entrée de navigation (PC et téléphone) qui regroupe Statistiques, Jeux, Rôles et
 * permissions et Devblog, chacun selon sa permission. Les Tickets ont leur propre entrée (hors de l'Administration),
 * avec la pastille des tickets non lus, relue en temps réel ; anciennes vues redirigées (Administration › Tickets
 * comprise) ; plus de carte « Notifications » sur la page Teams ni sur l'accueil d'une team.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { REGISTRE } from '../hub/registre';
import { themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { oublierSessions, type ClientEsport } from './client';
import { definirLangue } from './i18n';
import { navEsport, navMobile } from './ui/CadreEsport';
import { aAdministration, sousOngletsAdmin } from './ui/administration/PageAdministration';
import { Esport, fabrique, normaliserVue } from './ui/RacineEsport';

// Temps réel : les abonnements des écrans sont gardés ici ; `annoncer(sujet)` simule un message du serveur.
const abonnes: Array<{ sujets: unknown; rappel(): void }> = [];
jest.mock('./tempsReel/hooks', () => {
  const reel = jest.requireActual('./tempsReel/hooks');
  return {
    ...reel,
    useTempsReel: (_client: unknown, sujets: unknown, rappel: () => void, options?: { actif?: boolean }) => {
      const ReactReel = jest.requireActual('react');
      const ref = ReactReel.useRef(rappel);
      ref.current = rappel;
      ReactReel.useEffect(() => {
        if (options?.actif === false) return undefined;
        const a = { sujets, rappel: () => ref.current() };
        abonnes.push(a);
        return () => {
          abonnes.splice(abonnes.indexOf(a), 1);
        };
      }, [options?.actif]);
      return 'direct';
    },
  };
});
const annoncer = (sujet: string) => {
  for (const a of [...abonnes]) {
    const s = a.sujets;
    if (s === sujet || (Array.isArray(s) && s.includes(sujet)) || (typeof s === 'function' && (s as (x: string) => boolean)(sujet))) a.rappel();
  }
};

const theme = themeHub('nuit');
const relaisReel = fabrique.relais;
const clientReel = fabrique.client;
afterEach(() => {
  fabrique.relais = relaisReel;
  fabrique.client = clientReel;
  oublierSessions();
  definirLangue('fr');
});

type Droits = { superAdmin?: boolean; jeux?: boolean; stats?: boolean; roles?: boolean; devblog?: boolean; tickets?: 'voir' | 'configurer' | null };

function fauxClient(d: Droits, etat = { nonLus: 1 }) {
  const moi = {
    compte: d.superAdmin ? 'principal' : 'lea12345',
    superAdmin: Boolean(d.superAdmin),
    profil: { pseudo: d.superAdmin ? 'Fondateur' : 'Léa', riotId: null, discord: null },
    peutCreerTeam: Boolean(d.superAdmin),
    peutGererJeux: Boolean(d.superAdmin || d.jeux),
    peutVoirStatistiques: Boolean(d.stats),
    peutGererRoles: Boolean(d.roles),
    peutGererDevblog: Boolean(d.devblog),
  };
  const requete = jest.fn(async (chemin: string) => {
    if (chemin === '/tickets/moi') {
      if (!d.tickets) throw Object.assign(new Error('404'), { status: 404 });
      return { voir: d.tickets === 'voir', repondre: d.tickets === 'voir', gerer: false, configurer: d.tickets === 'configurer', actif: true };
    }
    if (chemin === '/tickets/compteur') return { nonLus: etat.nonLus, ouverts: 3 };
    if (chemin === '/tickets/etat') return { actif: true, connexion: { mode: 'direct', depuis: null } };
    if (chemin.startsWith('/tickets/preferences')) return { mpNouveau: true, mpMessage: true };
    if (chemin.startsWith('/tickets')) return { tickets: [], categories: [], droits: { repondre: true, gerer: false, configurer: false } };
    if (chemin.startsWith('/roles-permissions')) return { moi: { fondateur: true, permissions: [] }, globaux: { roles: [], permissions: [], reservees: [] }, cm: { permissions: [] }, modele: { roles: [], permissions: [], modifiable: true }, teams: [], comptes: [] };
    if (chemin.startsWith('/devblog')) return { entrees: [], gestion: true };
    if (chemin.startsWith('/cm/moi')) return { espace: false, club: [], teams: [] };
    throw Object.assign(new Error(`non prévu : ${chemin}`), { status: 404 });
  });
  const client = {
    config: { adresse: 'https://esport.test', jetonRelais: 'x' },
    ouvrir: async () => moi,
    moi: async () => moi,
    teams: async () => [],
    tableau: async () => ({ genereLe: '', teams: [], global: { resumesARediger: 0, evenementsSemaine: [], alertes: [] } }),
    notifications: jest.fn(async () => ({ nonLues: 1, noms: {}, liste: [{ id: 'n1', type: 'ticket.created', lue: false, date: '2026-11-05T10:00:00.000Z', team: null, charge: {} }] })),
    boiteResumes: async () => ({ depots: [], teams: [], types: [], deposants: [], attente: 0, nouveaux: 0, total: 0 }),
    requete,
  } as unknown as ClientEsport;
  return { client, requete };
}

async function monter(client: ClientEsport, mode: 'large' | 'telephone' = 'large') {
  fabrique.relais = () => ({ relais: 'https://relais.appdashboard.fr', jeton: 'jeton' });
  fabrique.client = () => client;
  return await render(
    <ModeAffichageForce mode={mode}>
      <Esport contexte={{}} theme={theme} registre={REGISTRE} onRetour={() => undefined} />
    </ModeAffichageForce>,
  );
}

test('navigation : entrées « Tickets » et « Administration » selon les droits ; cinq au plus, toutes dans la barre du téléphone', () => {
  expect(navEsport(false, false).map(n => n.cle)).toEqual(['dashboard', 'teams', 'membres']);
  expect(navEsport(true, false).map(n => n.cle)).toEqual(['dashboard', 'teams', 'membres', 'administration']);
  expect(navEsport(false, true).map(n => n.cle)).toEqual(['dashboard', 'teams', 'membres', 'tickets']);
  expect(navEsport(true, true).map(n => n.cle)).toEqual(['dashboard', 'teams', 'membres', 'tickets', 'administration']);
  expect(navMobile(true, true).barre.map(n => n.cle)).toEqual(['dashboard', 'teams', 'membres', 'tickets', 'administration']);
  expect(navMobile(true, true).plus).toEqual([]);
  expect(aAdministration({})).toBe(false);
  expect(aAdministration({ devblog: true })).toBe(true);
  expect(sousOngletsAdmin({ roles: true, jeux: true, statistiques: false })).toEqual(['jeux', 'roles']);
});

test('anciennes vues : Statistiques, Jeux, Membres › Rôles et permissions mènent à l’Administration ; Administration › Tickets à « Tickets »', () => {
  expect(normaliserVue({ v: 'tickets' })).toEqual({ v: 'tickets' });
  expect(normaliserVue({ v: 'administration', sous: 'tickets' })).toEqual({ v: 'tickets' });
  expect(normaliserVue({ v: 'statistiques' })).toEqual({ v: 'administration', sous: 'statistiques' });
  expect(normaliserVue({ v: 'jeux' })).toEqual({ v: 'administration', sous: 'jeux' });
  expect(normaliserVue({ v: 'membres', sous: 'roles' })).toEqual({ v: 'administration', sous: 'roles' });
  expect(normaliserVue({ v: 'membres', sous: 'tous' })).toEqual({ v: 'membres', sous: 'tous' });
});

test('visibles selon les permissions (PC et téléphone) : Tickets seul, Administration seule, aucune', async () => {
  for (const mode of ['large', 'telephone'] as const) {
    const r1 = await monter(fauxClient({}).client, mode);
    await screen.findByTestId('esport-nav-membres');
    expect(screen.queryByTestId('esport-nav-administration')).toBeNull();
    expect(screen.queryByTestId('esport-nav-tickets')).toBeNull();
    await r1.unmount();
    const r2 = await monter(fauxClient({ roles: true }).client, mode);
    expect(await screen.findByTestId('esport-nav-administration')).toBeTruthy();
    expect(screen.queryByTestId('esport-nav-tickets')).toBeNull();
    expect(screen.queryByTestId('esport-nav-jeux')).toBeNull();
    expect(screen.queryByTestId('esport-nav-statistiques')).toBeNull();
    await r2.unmount();
    const r3 = await monter(fauxClient({ tickets: 'voir' }).client, mode);
    expect(await screen.findByTestId('esport-nav-tickets')).toBeTruthy();
    expect(screen.queryByTestId('esport-nav-administration')).toBeNull();
    expect(screen.queryByTestId('esport-nav-plus')).toBeNull();
    await r3.unmount();
  }
});

test('téléphone : Fondateur avec les tickets, cinq entrées dans la barre du bas, pas de « Plus »', async () => {
  await monter(fauxClient({ superAdmin: true, tickets: 'configurer' }).client, 'telephone');
  expect(await screen.findByTestId('esport-nav-tickets')).toBeTruthy();
  expect(screen.getByTestId('esport-nav-administration')).toBeTruthy();
  expect(screen.queryByTestId('esport-nav-plus')).toBeNull();
});

test('entrée « Tickets » : sous-onglets des tickets ; l’Administration n’a plus de sous-onglet Tickets', async () => {
  const r1 = await monter(fauxClient({ jeux: true, roles: true, tickets: 'voir' }).client);
  await fireEvent.press(await screen.findByTestId('esport-nav-tickets'));
  expect(await screen.findByTestId('esport-tickets')).toBeTruthy();
  expect(screen.queryByTestId('esport-administration')).toBeNull();
  await fireEvent.press(screen.getByTestId('esport-nav-administration'));
  expect(await screen.findByTestId('esport-admin-onglet-jeux')).toBeTruthy();
  expect(screen.getByTestId('esport-admin-onglet-roles')).toBeTruthy();
  expect(screen.queryByTestId('esport-admin-onglet-tickets')).toBeNull();
  expect(screen.queryByTestId('esport-admin-onglet-statistiques')).toBeNull();
  expect(screen.queryByTestId('esport-admin-onglet-devblog')).toBeNull();
  expect(screen.queryByTestId('esport-tickets')).toBeNull();
  await r1.unmount();
  await monter(fauxClient({ roles: true }).client);
  await fireEvent.press(await screen.findByTestId('esport-nav-administration'));
  expect(await screen.findByTestId('esport-roles-permissions')).toBeTruthy();
  expect(screen.queryByTestId('esport-admin-onglets')).toBeNull();
});

test('pastille des tickets non lus sur l’entrée « Tickets » (pas sur l’Administration), relue en temps réel', async () => {
  const etat = { nonLus: 1 };
  const { client } = fauxClient({ tickets: 'voir', roles: true }, etat);
  await monter(client);
  // Barre étendue : le compteur (Compteur, comme les commentaires non lus du CM) à côté du libellé.
  await waitFor(() => expect(screen.getByTestId('esport-nav-tickets')).toHaveTextContent(/1/));
  expect(screen.getByTestId('esport-nav-administration')).not.toHaveTextContent(/1/);
  etat.nonLus = 4;
  await act(async () => {
    annoncer('tickets');
    await new Promise<void>(r => setTimeout(r, 0));
  });
  await waitFor(() => expect(screen.getByTestId('esport-nav-tickets')).toHaveTextContent(/4/));
  expect(screen.getByTestId('esport-nav-administration')).not.toHaveTextContent(/4/);
  etat.nonLus = 0;
  await act(async () => {
    annoncer('tickets');
    await new Promise<void>(r => setTimeout(r, 0));
  });
  await waitFor(() => expect(screen.getByTestId('esport-nav-tickets')).not.toHaveTextContent(/4/));
});

test('téléphone : pastille sur l’entrée « Tickets » de la barre du bas', async () => {
  const { client } = fauxClient({ tickets: 'voir', roles: true }, { nonLus: 2 });
  await monter(client, 'telephone');
  await waitFor(() => expect(screen.getByTestId('esport-nav-tickets')).toHaveTextContent(/2/));
  expect(screen.getByTestId('esport-nav-administration')).not.toHaveTextContent(/2/);
});

test('configuration des tickets seule : entrée « Tickets » sans compteur (il ne compte que les tickets visibles)', async () => {
  const { client, requete } = fauxClient({ tickets: 'configurer' }, { nonLus: 5 });
  await monter(client);
  await screen.findByTestId('esport-nav-tickets');
  expect(requete.mock.calls.some(c => c[0] === '/tickets/compteur')).toBe(false);
  expect(screen.getByTestId('esport-nav-tickets')).not.toHaveTextContent(/5/);
});

test('page Teams : plus de carte « Notifications » (la cloche reste)', async () => {
  const { client } = fauxClient({});
  await monter(client);
  await fireEvent.press(await screen.findByTestId('esport-nav-teams'));
  await screen.findByTestId('esport-teams');
  expect(screen.queryByTestId('esport-notifications')).toBeNull();
  expect(screen.queryByTestId('esport-notifications-centre')).toBeNull();
  expect(screen.getAllByTestId('esport-cloche').length).toBeGreaterThan(0);
});
