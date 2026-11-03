/**
 * Accès restreint d'un tableau CM (docs/esport/cm.md, migration 0046), de l'écran au client HTTP :
 *  - menu ⋯ › « Accès au tableau… » seulement pour qui peut le régler ; cadenas sur un tableau restreint ;
 *  - le réglage part en POST + X-Methode: PUT (frontal o2switch) avec les personnes et rôles choisis et leur niveau ;
 *  - le tableau par défaut ne propose pas « Restreint ».
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { clientEsport, oublierSessions, type ClientEsport } from './client';
import { apiCm, type DetailTableau, type ReglageAcces } from './cm/api';
import { definirLangue } from './i18n';
import { AccesTableau } from './ui/cm/AccesTableau';
import { Tableau } from './ui/cm/Tableau';

const theme = themeHub('nuit');
const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROLE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

interface Appel {
  url: string;
  methode: string;
  xMethode?: string;
  corps?: Record<string, unknown>;
}

function fauxServeur(repondre: (a: Appel) => { status?: number; corps: unknown } | undefined) {
  const appels: Appel[] = [];
  const requete = jest.fn(async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
    const a: Appel = { url: url.replace('https://esport.test', ''), methode: init?.method ?? 'GET', xMethode: init?.headers?.['X-Methode'], corps: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined };
    appels.push(a);
    if (a.url === '/session') return { ok: true, status: 200, json: async () => ({ session: 's1', expire: '2099-01-01T00:00:00.000Z', compte: 'cm123456', superAdmin: false, profil: null, peutCreerTeam: false, fonctions: ['surcharge-methode'] }) };
    const r = repondre(a) ?? { corps: { ok: true } };
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.corps };
  });
  const client: ClientEsport = clientEsport({ adresse: 'https://esport.test', jetonRelais: 'jeton-relais-0123456789' }, requete);
  return { client, appels };
}

function tableau(acces: 'tous' | 'restreint', droitAcces: boolean): DetailTableau {
  return {
    tableau: { id: T, nom: 'Secret', cleDefaut: null, portee: 'club', team: null, couleur: '#db2777', description: '', version: 1, archive: false, trello: false, acces, majLe: '', fond: null },
    droits: { voir: true, deposer: true, editer: true, valider: true, gerer: droitAcces, commenter: true, acces: droitAcces },
    moi: 'cm123456',
    listes: [],
    etiquettes: [],
    cartes: [],
    noms: {},
    personnes: [{ compte: 'cm123456', pseudo: 'Clara' }],
  };
}

function reglage(acces: 'tous' | 'restreint', cleDefaut: string | null = null): ReglageAcces {
  return {
    tableau: { id: T, nom: 'Secret', cleDefaut, portee: 'club', creePar: 'cm123456' },
    acces,
    regles: acces === 'restreint' ? [{ genre: 'compte', cible: 'cm123456', niveau: 'modifier', nom: 'Clara' }] : [],
    effectifs: acces === 'restreint' ? [{ compte: 'cm123456', pseudo: 'Clara', niveau: 'modifier' }, { compte: 'vue12345', pseudo: 'Vera', niveau: 'voir' }] : null,
    options: {
      personnes: [
        { compte: 'cm123456', pseudo: 'Clara' },
        { compte: 'principal', pseudo: 'Fondateur' },
        { compte: 'vue12345', pseudo: 'Vera' },
      ],
      rolesCm: [{ id: ROLE, nom: 'Lecteur', couleur: '#123456' }],
      rolesClub: [],
      rolesTeam: [],
    },
    moi: 'cm123456',
  };
}

beforeEach(() => oublierSessions());
afterEach(() => definirLangue('fr'));

describe('accès restreint d’un tableau CM', () => {
  it('menu ⋯ › Accès au tableau… (droit requis) et cadenas sur un tableau restreint', async () => {
    const { client } = fauxServeur(a => (a.url.split('?')[0] === `/cm/tableaux/${T}` ? { corps: tableau('restreint', false) } : undefined));
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    expect(await screen.findByTestId('esport-cm-tableau-restreint')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-cm-tableau-menu'));
    expect(screen.queryByTestId('esport-cm-tableau-acces')).toBeNull();
  });

  it('restreindre : personnes et rôles avec leur niveau, envoyés en POST + X-Methode: PUT', async () => {
    const { client, appels } = fauxServeur(a => {
      const c = a.url.split('?')[0];
      if (c === `/cm/tableaux/${T}`) return { corps: tableau('tous', true) };
      if (c === `/cm/tableaux/${T}/acces` && a.methode === 'GET') return { corps: reglage('tous') };
      if (c === `/cm/tableaux/${T}/acces` && a.xMethode === 'PUT') return { corps: reglage('restreint') };
      return undefined;
    });
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    await fireEvent.press(await screen.findByTestId('esport-cm-tableau-menu'));
    await fireEvent.press(await screen.findByTestId('esport-cm-tableau-acces'));
    await fireEvent.press(await screen.findByTestId('esport-cm-acces-mode-restreint'));
    // Le Fondateur n'est pas proposé (il voit toujours tout).
    expect(screen.queryByTestId('esport-cm-acces-compte-principal-voir')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-cm-acces-compte-cm123456-modifier'));
    await fireEvent.press(screen.getByTestId('esport-cm-acces-compte-vue12345-voir'));
    await fireEvent.press(screen.getByTestId(`esport-cm-acces-role_cm-${ROLE}-voir`));
    await fireEvent.press(screen.getByTestId('esport-cm-acces-enregistrer'));
    await waitFor(() => expect(appels.some(a => a.xMethode === 'PUT')).toBe(true));
    const envoi = appels.find(a => a.xMethode === 'PUT')!;
    expect(envoi.methode).toBe('POST');
    expect(envoi.corps).toEqual({
      acces: 'restreint',
      regles: [
        { genre: 'compte', cible: 'cm123456', niveau: 'modifier' },
        { genre: 'compte', cible: 'vue12345', niveau: 'voir' },
        { genre: 'role_cm', cible: ROLE, niveau: 'voir' },
      ],
    });
    expect(await screen.findByTestId('esport-cm-acces-effectifs')).toBeTruthy();
    expect(screen.getByText('Accès enregistré.')).toBeTruthy();
  });

  it('tableau par défaut : « Restreint » n’est pas proposé', async () => {
    const { client } = fauxServeur(a => (a.url.split('?')[0] === `/cm/tableaux/${T}/acces` ? { corps: reglage('tous', 'contenus') } : undefined));
    await render(<AccesTableau theme={theme} api={apiCm(client)} tableauId={T} onChange={() => undefined} />);
    expect(await screen.findByTestId('esport-cm-acces-mode-tous')).toBeTruthy();
    expect(screen.queryByTestId('esport-cm-acces-mode-restreint')).toBeNull();
    expect(screen.getByText('Le tableau par défaut reste ouvert à tous ceux qui ont accès au CM.')).toBeTruthy();
  });
});
