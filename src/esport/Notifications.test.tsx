/**
 * Centre de notifications (docs/esport/notifications.md) : cloche et compteur dans l'en-tête (téléphone : pas
 * d'entrée dans la barre du bas), page regroupée par jour, lien direct (marque lue), « Tout marquer comme lu »,
 * filtres envoyés au serveur, préférences enregistrées sur le compte ; logique pure (phrases, dates, groupes).
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { REGISTRE } from '../hub/registre';
import { themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { oublierSessions, type ClientEsport } from './client';
import { Esport, fabrique } from './ui/RacineEsport';
import { definirLangue } from './i18n';
import { signalerNotifications, type NotificationCentre } from './notifications/api';
import { bornesPeriode, dateRelative, grouperParJour, pastille, phraseCentre, titreJour } from './notifications/logique';

const theme = themeHub('nuit');
const relaisReel = fabrique.relais;
const clientReel = fabrique.client;

afterEach(() => {
  fabrique.relais = relaisReel;
  fabrique.client = clientReel;
  oublierSessions();
  definirLangue('fr');
});

const MAINTENANT = Date.now();
const il = (ms: number) => new Date(MAINTENANT - ms).toISOString();

const N1: NotificationCentre = {
  id: 'ev-1',
  source: 'fil',
  type: 'event.created',
  evenement: 'event.created',
  categorie: 'planning',
  team: { id: 'team-a', nom: 'Team Alpha' },
  acteur: 'coach123',
  entite: { type: 'evenement', id: 'e1' },
  lien: { vue: 'devblog' },
  charge: { titre: 'Scrim vs Nova', type: 'scrim' },
  lue: false,
  date: il(5 * 60_000),
};
const N2: NotificationCentre = {
  id: 'ev-2:lea12345',
  source: 'perso',
  type: 'tache-assignee',
  evenement: 'task.assigned',
  categorie: 'objectifs',
  team: { id: 'team-a', nom: 'Team Alpha' },
  acteur: 'coach123',
  entite: null,
  lien: null,
  charge: { membre: 'coach123', titre: 'Revoir la VOD' },
  lue: true,
  date: il(3 * 86_400_000),
};

function fauxClient(requete: jest.Mock): ClientEsport {
  const compte = { compte: 'lea12345', superAdmin: false, profil: { pseudo: 'Léa', riotId: null, discord: null }, peutCreerTeam: false };
  return {
    config: { adresse: 'https://esport.test', jetonRelais: 'x' },
    ouvrir: async () => compte,
    moi: async () => compte,
    teams: async () => [],
    tableau: async () => ({ genereLe: '', teams: [], global: { resumesARediger: 0, evenementsSemaine: [], alertes: [] } }),
    notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
    boiteResumes: async () => ({ teams: [], attente: 0, nouveaux: 0 }),
    requete,
  } as unknown as ClientEsport;
}

function serveurFaux() {
  let nonLues = 2;
  let prefs = { masquees: [] as string[], silencieuses: [] as string[], teams: [] as string[], categories: [] };
  return jest.fn(async (chemin: string, methode = 'GET', corps?: { ids?: string[]; tout?: boolean; masquees?: string[] }) => {
    if (chemin === '/notifications/compteur') return { nonLues };
    if (chemin.startsWith('/notifications/centre') && methode === 'GET') {
      return { liste: [N1, N2], noms: { coach123: 'Zed' }, suite: null, nonLues, categories: [], teams: [{ id: 'team-a', nom: 'Team Alpha' }, { id: 'team-b', nom: 'Team Bravo' }] };
    }
    if (chemin === '/notifications/centre/lues') {
      nonLues = corps?.tout ? 0 : nonLues - (corps?.ids?.length ?? 0);
      return { nonLues };
    }
    if (chemin === '/notifications/preferences' && methode === 'GET') return prefs;
    if (chemin === '/notifications/preferences' && methode === 'PUT') {
      prefs = { ...prefs, masquees: corps?.masquees ?? prefs.masquees };
      return prefs;
    }
    if (chemin === '/devblog/nouveautes') return { entree: null };
    if (chemin === '/devblog') return { entrees: [], gestion: false };
    if (/^\/cm\//.test(chemin)) throw new Error('pas de CM');
    return { ok: true };
  });
}

async function monter(client: ClientEsport, mode: 'large' | 'telephone' = 'large') {
  fabrique.relais = () => ({ relais: 'https://relais.appdashboard.fr', jeton: `p1.lea12345.${'a'.repeat(64)}` });
  fabrique.client = () => client;
  return render(
    <ModeAffichageForce mode={mode}>
      <Esport contexte={{ profil: { id: 'lea12345', nom: 'Léa', admin: false, creeLe: '', apps: ['esport'] } }} theme={theme} registre={REGISTRE} onRetour={() => undefined} />
    </ModeAffichageForce>,
  );
}

describe('logique', () => {
  it('phrases (fil : celle du journal ; personnelle ; repli), dates relatives, groupes par jour, période, pastille', () => {
    expect(phraseCentre(N1, { coach123: 'Zed' })).toContain('Scrim vs Nova');
    expect(phraseCentre(N2, { coach123: 'Zed' })).toContain('Revoir la VOD');
    expect(phraseCentre({ ...N1, type: 'inconnu.truc', evenement: 'inconnu.truc', categorie: 'systeme' }, { coach123: 'Zed' })).toBe('Zed : Système');
    expect(phraseCentre({ ...N1, type: 'devblog.publie', categorie: 'devblog', charge: { titre: 'v2' } }, {})).toBe('Nouveau devblog publié : v2');
    expect(dateRelative(il(10_000), MAINTENANT)).toBe('À l’instant');
    expect(dateRelative(il(5 * 60_000), MAINTENANT)).toBe('il y a 5 min');
    expect(dateRelative(il(2 * 86_400_000), MAINTENANT)).toBe('il y a 2 jours');
    const g = grouperParJour([N1, N2]);
    expect(g).toHaveLength(2);
    expect(titreJour(g[0].jour, MAINTENANT)).toBe('Aujourd’hui');
    expect(bornesPeriode('tout')).toEqual({});
    expect(bornesPeriode('jour', Date.parse('2026-11-03T12:00:00Z'))).toEqual({ du: '2026-11-03' });
    expect(pastille(0)).toBeUndefined();
    expect(pastille(12)).toBe('9+');
    definirLangue('en');
    expect(dateRelative(il(5 * 60_000), MAINTENANT)).toBe('5 min ago');
  });
});

describe('centre de notifications', () => {
  it('cloche + compteur dans l’en-tête ; page groupée par jour ; ouvrir marque lue et mène à l’élément', async () => {
    const requete = serveurFaux();
    await monter(fauxClient(requete));
    await waitFor(() => expect(screen.getByTestId('esport-cloche-pastille')).toBeTruthy());
    expect(screen.getByLabelText('Notifications : 2 non lues')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-cloche'));
    });
    expect(await screen.findByTestId('esport-notifications-page')).toBeTruthy();
    expect(await screen.findByText('Aujourd’hui')).toBeTruthy();
    expect(screen.getByTestId('esport-notif-ev-1')).toBeTruthy();
    expect(screen.getByTestId('esport-notif-ev-2:lea12345')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-notif-ev-1-ouvrir'));
    });
    expect(requete).toHaveBeenCalledWith('/notifications/centre/lues', 'POST', { ids: ['ev-1'] });
    // Lien direct : l'écran de l'élément (ici le devblog).
    await waitFor(() => expect(screen.queryByTestId('esport-notifications-page')).toBeNull());
  });

  it('filtres envoyés au serveur, préférences enregistrées sur le compte, tout marquer lu', async () => {
    const requete = serveurFaux();
    await monter(fauxClient(requete));
    await act(async () => {
      fireEvent.press(await screen.findByTestId('esport-cloche'));
    });
    await screen.findByTestId('esport-notif-ev-1');
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-notifs-filtres'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-notifs-cat-planning'));
    });
    await waitFor(() => expect(requete.mock.calls.some(c => String(c[0]).includes('categories=planning'))).toBe(true));
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-notifs-team-team-b'));
    });
    await waitFor(() => expect(requete.mock.calls.some(c => String(c[0]).includes('team=team-b'))).toBe(true));
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-notifs-non-lues'));
    });
    await waitFor(() => expect(requete.mock.calls.some(c => String(c[0]).includes('nonLues=1'))).toBe(true));
    // Préférences : ne plus suivre le planning (enregistré sur le serveur).
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-notifs-prefs'));
    });
    await act(async () => {
      fireEvent.press(await screen.findByTestId('esport-notifs-suivre-planning'));
    });
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/notifications/preferences', 'PUT', { masquees: ['planning'], silencieuses: undefined, teams: undefined }));
    expect(await screen.findByText('Préférences enregistrées.')).toBeTruthy();
    // Tout marquer comme lu : la pastille disparaît.
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-notifs-tout-lu'));
    });
    expect(requete).toHaveBeenCalledWith('/notifications/centre/lues', 'POST', { tout: true });
    await waitFor(() => expect(screen.queryByTestId('esport-cloche-pastille')).toBeNull());
  });

  it('téléphone : la cloche est dans l’en-tête, la barre du bas ne gagne pas d’entrée ; signal temps réel', async () => {
    const requete = serveurFaux();
    await monter(fauxClient(requete), 'telephone');
    expect(await screen.findByTestId('esport-cloche')).toBeTruthy();
    expect(screen.queryByTestId('esport-nav-notifications')).toBeNull();
    await act(async () => {
      signalerNotifications(7);
    });
    expect(screen.getByLabelText('Notifications : 7 non lues')).toBeTruthy();
  });
});
