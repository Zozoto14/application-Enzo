/**
 * Migration 0074 (docs/esport/cm.md) : To do du Dashboard (favoris, cartes assignées groupées par tableau et colonne,
 * « Terminer », réglage par compte), étoile des cartes (tuile, menu, fiche), cartes datées au calendrier du CM (liées à la
 * carte, « Nouvelle carte » datée, déplacement à heure murale constante), type de réunion Review.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { themeHub } from '../hub/themes';
import { clientEsport, nomTypeReunion, oublierSessions, type ClientEsport } from './client';
import { apiCm, type CarteDatee, type CarteResume, type CarteTodo, type DetailTableau, type ReponseCarte, type Todo } from './cm/api';
import { deplacerAuJour, finEcheance, instantMural, jourSous, saisieVersInstant } from './cm/calendrier';
import { definirLangue } from './i18n';
import { Calendrier } from './ui/cm/Calendrier';
import { Tableau } from './ui/cm/Tableau';
import { TodoDashboard, grouperTodo } from './ui/cm/TodoDashboard';

const theme = themeHub('nuit');
const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const L1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const L2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const FIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9';
const [A, B, C, D] = ['1', '2', '3', '4'].map(n => `cccccccc-cccc-4ccc-8ccc-ccccccccccc${n}`);

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

const carteTodo = (id: string, titre: string, extra: Partial<CarteTodo> = {}): CarteTodo => ({
  id, titre, tableauId: T, liste: { id: L1, nom: 'Idées', cle: null, position: 1024 }, teamId: null, urgence: null, echeance: null, echeanceFaite: false, echeanceDuree: null, terminee: false, position: 1, post: false, statut: null, version: 1, favori: false, assignee: true, terminable: true, ...extra,
});
const tableauListe = (id: string, nom: string, extra: Record<string, unknown> = {}) => ({ id, nom, cleDefaut: null, portee: 'club', team: null, couleur: '#db2777', description: '', version: 1, archive: false, trello: false, majLe: '', editer: true, colonneFin: true, ...extra });

function todoExemple(): Todo {
  return {
    reglage: { tableaux: [], assignees: true, favoris: true },
    tableaux: [tableauListe(T, 'Contenus'), tableauListe(T2, 'Vidéos', { editer: false, colonneFin: false })],
    favoris: [carteTodo(D, 'Étoilée', { favori: true, assignee: false, tableauId: T2, liste: { id: L2, nom: 'Montage', cle: null, position: 2048 }, terminable: false })],
    cartes: [
      carteTodo(A, 'Critique', { urgence: 'critique', echeance: '2026-11-10T09:00:00.000Z' }),
      carteTodo(B, 'En retard', { echeance: '2020-01-01T09:00:00.000Z', liste: { id: L2, nom: 'En cours', cle: null, position: 2048 } }),
      carteTodo(C, 'Vidéo', { tableauId: T2, liste: { id: L2, nom: 'Montage', cle: null, position: 2048 }, terminable: false }),
    ],
  };
}

beforeEach(() => {
  oublierSessions();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});
afterEach(() => {
  definirLangue('fr');
  jest.restoreAllMocks();
});

describe('outils purs', () => {
  it('heure murale du club : déplacer une carte garde l’heure, changement d’heure compris', () => {
    // 15:00 à Paris (heure d'été) le 24/10 → 15:00 à Paris (heure d'hiver) le 26/10.
    expect(deplacerAuJour('2026-10-24T13:00:00.000Z', '2026-10-26', 'Europe/Paris')).toBe('2026-10-26T14:00:00.000Z');
    expect(instantMural('2026-07-01', '00:30', 'Europe/Paris')).toBe('2026-06-30T22:30:00.000Z');
    expect(saisieVersInstant('2026-11-04 18:15', 'Europe/Paris')).toBe('2026-11-04T17:15:00.000Z');
    expect(saisieVersInstant('2026-11-04', 'Europe/Paris')).toBe('2026-11-04T11:00:00.000Z');
    expect(saisieVersInstant('', 'Europe/Paris')).toBeNull();
    expect(finEcheance('2026-11-04T17:00:00.000Z', 90)).toBe('2026-11-04T18:30:00.000Z');
    expect(finEcheance('2026-11-04T17:00:00.000Z', null)).toBeNull();
    const cases = [
      { jour: '2026-11-02', x: 0, y: 0, l: 100, h: 100 },
      { jour: '2026-11-03', x: 100, y: 0, l: 100, h: 100 },
    ];
    expect(jourSous(cases, 150, 50)).toBe('2026-11-03');
    expect(jourSous(cases, 250, 50)).toBeUndefined();
  });

  it('To do : groupes par tableau (ordre des tableaux) puis par colonne (ordre des colonnes), cartes dans l’ordre du serveur', () => {
    const t = todoExemple();
    const g = grouperTodo(t.cartes, t.tableaux);
    expect(g.map(x => x.tableauId)).toEqual([T, T2]);
    expect(g[0].colonnes.map(c => c.cartes.map(x => x.titre))).toEqual([['Critique'], ['En retard']]);
  });

  it('type de réunion « Review » : libellé FR et EN', () => {
    expect(nomTypeReunion('Review')).toBe('Review');
    definirLangue('en');
    expect(nomTypeReunion('Review')).toBe('Review');
    expect(nomTypeReunion('Hebdo')).toBe('Weekly');
  });
});

describe('To do du Dashboard', () => {
  it('favoris en tête, cartes assignées groupées ; ouvrir, terminer, retirer des favoris', async () => {
    let todo = todoExemple();
    const ouvertes: Array<{ tableauId: string; carteId: string; portee: string }> = [];
    const { client, appels } = fauxServeur(a => {
      if (a.url === '/cm/todo') return { corps: todo };
      if (a.url === `/cm/cartes/${A}/terminer`) {
        todo = { ...todo, cartes: todo.cartes.filter(c => c.id !== A) };
        return { corps: { ok: true, listeId: FIN } };
      }
      if (a.url === `/cm/cartes/${D}/favori`) {
        todo = { ...todo, favoris: [] };
        return { corps: { ok: true, favori: false } };
      }
      return undefined;
    });
    await render(<TodoDashboard theme={theme} client={client} large onOuvrirCarte={c => ouvertes.push(c)} />);
    const favoris = await screen.findByTestId('esport-todo-favoris');
    expect(within(favoris).getByText('Étoilée')).toBeTruthy();
    expect(screen.getByText('4 cartes à traiter')).toBeTruthy();
    const groupe = screen.getByTestId(`esport-todo-tableau-${T}`);
    expect(within(groupe).getAllByText(/^(Critique|En retard)$/).map(n => n.props.children)).toEqual(['Critique', 'En retard']);
    expect(screen.getByTestId(`esport-todo-tableau-${T2}`)).toBeTruthy();
    expect(screen.getByTestId(`esport-todo-carte-${B}-retard`)).toBeTruthy();
    expect(screen.getByTestId(`esport-todo-carte-${A}-urgence`)).toBeTruthy();
    // Pas de « Terminer » sans cm.editer ni colonne de fin.
    expect(screen.queryByTestId(`esport-todo-carte-${C}-terminer`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`esport-todo-carte-${C}-ouvrir`));
    expect(ouvertes).toEqual([{ tableauId: T2, carteId: C, portee: 'club' }]);
    await fireEvent.press(screen.getByTestId(`esport-todo-carte-${A}-terminer`));
    await waitFor(() => expect(screen.queryByTestId(`esport-todo-carte-${A}`)).toBeNull());
    expect(appels.some(a => a.url === `/cm/cartes/${A}/terminer`)).toBe(true);
    expect(await screen.findByText('« Critique » est terminée.')).toBeTruthy();
    // Étoile : retirée des favoris.
    const etoile = screen.getByTestId(`esport-todo-carte-${D}-favori`);
    expect(etoile.props.accessibilityState.checked).toBe(true);
    await fireEvent.press(etoile);
    await waitFor(() => expect(screen.queryByTestId('esport-todo-favoris')).toBeNull());
    expect(appels.find(a => a.url === `/cm/cartes/${D}/favori`)?.corps).toEqual({ favori: false });
  });

  it('réglage : tableaux choisis, assignées et favorites, enregistrés pour le compte', async () => {
    const { client, appels } = fauxServeur(a => (a.url === '/cm/todo' ? { corps: todoExemple() } : undefined));
    await render(<TodoDashboard theme={theme} client={client} large={false} onOuvrirCarte={() => undefined} />);
    await fireEvent.press(await screen.findByTestId('esport-todo-reglages'));
    expect(screen.getByTestId('esport-todo-reglage-tous').props.accessibilityState.checked).toBe(true);
    await fireEvent.press(screen.getByTestId(`esport-todo-reglage-tableau-${T2}`));
    expect(screen.getByTestId('esport-todo-reglage-tous').props.accessibilityState.checked).toBe(false);
    await fireEvent.press(screen.getByTestId('esport-todo-reglage-assignees'));
    await fireEvent.press(screen.getByTestId('esport-todo-reglage-ok'));
    await waitFor(() => expect(appels.some(a => a.url === '/cm/preferences/todo.dashboard')).toBe(true));
    expect(appels.find(a => a.url === '/cm/preferences/todo.dashboard')?.corps).toEqual({ valeur: { tableaux: [T2], assignees: false, favoris: true } });
  });

  it('sans tableau CM (403) : rien n’est affiché ; To do vide : message', async () => {
    const sans = fauxServeur(a => (a.url === '/cm/todo' ? { status: 403, corps: { erreur: 'Vous n’avez pas la permission de faire cela.', code: 'permission' } } : undefined));
    await render(<TodoDashboard theme={theme} client={sans.client} large onOuvrirCarte={() => undefined} />);
    await waitFor(() => expect(sans.appels.some(a => a.url === '/cm/todo')).toBe(true));
    await waitFor(() => expect(screen.queryByTestId('esport-todo')).toBeNull());
    const vide = fauxServeur(a => (a.url === '/cm/todo' ? { corps: { ...todoExemple(), favoris: [], cartes: [] } } : undefined));
    await render(<TodoDashboard theme={theme} client={vide.client} large onOuvrirCarte={() => undefined} />);
    expect(await screen.findByText('Rien à faire pour l’instant')).toBeTruthy();
  });
});

const resume = (id: string, titre: string, extra: Partial<CarteResume> = {}): CarteResume => ({
  id, listeId: L1, teamId: null, titre, description: false, position: 1, couverture: null, echeance: null, echeanceFaite: false, datePublication: null, post: false, statut: null, reseaux: [], origine: 'manuel', depotGenre: null,
  etiquettes: [], membres: [], urgence: null, commentaires: 0, checklist: { total: 0, faits: 0 }, pieces: 0, archive: false, version: 1, modifiable: true, ...extra,
});
function detail(editer = true): DetailTableau {
  return {
    tableau: { id: T, nom: 'Contenus', cleDefaut: null, portee: 'club', team: null, couleur: '#db2777', description: '', version: 3, archive: false, trello: false, majLe: '', fond: null, calendrier: true },
    droits: { voir: true, deposer: true, editer, valider: true, gerer: true, commenter: true },
    moi: 'cm123456',
    listes: [{ id: L1, nom: 'Idées', cle: null, position: 1024, archive: false }],
    etiquettes: [],
    cartes: [resume(A, 'Favorite', { favori: true }), resume(B, 'Ordinaire')],
    noms: {},
    personnes: [{ compte: 'cm123456', pseudo: 'Clara' }],
  };
}
function reponseCarte(favori: boolean): ReponseCarte {
  return {
    carte: {
      id: B, tableauId: T, listeId: L1, teamId: null, titre: 'Ordinaire', description: '', position: 1, couverture: null, echeance: '2026-11-04T17:00:00.000Z', echeanceFaite: false, echeanceDuree: 60, favori, datePublication: null, urgence: null, post: false, statut: null, reseaux: [], textes: {}, liens: {},
      publications: {}, soumisPar: null, soumisLe: null, validePar: null, valideLe: null, refusMotif: null, refusePar: null, publiePar: null, publieLe: null, origine: 'manuel', depotGenre: null, trello: false, archive: false,
      creePar: 'cm123456', creeLe: '2026-10-20T09:00:00.000Z', majLe: '', version: 1, etiquettes: [], membres: [], checklists: [], commentaires: [], pieces: [], activite: [], clips: [], resumes: {},
    },
    droits: { voir: true, deposer: true, editer: true, valider: true, gerer: true, commenter: true, modifier: true },
    noms: {},
    problemes: [],
  };
}

describe('étoile des cartes', () => {
  it('tuile : étoile sur la carte favorite (la toucher la retire) ; menu ⋯ « Ajouter aux favoris » ; lecteur aussi', async () => {
    const { client, appels } = fauxServeur(a => {
      const c = a.url.split('?')[0];
      if (c === `/cm/tableaux/${T}`) return { corps: detail(false) };
      if (c === '/cm/preferences') return { corps: { preferences: {} } };
      return undefined;
    });
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    const etoile = await screen.findByTestId(`esport-cm-carte-${A}-favori`);
    expect(etoile.props.accessibilityState.checked).toBe(true);
    expect(screen.queryByTestId(`esport-cm-carte-${B}-favori`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`esport-cm-carte-${B}-menu`));
    await fireEvent.press(await screen.findByTestId(`esport-cm-carte-${B}-favori-menu`));
    await waitFor(() => expect(appels.some(a => a.url === `/cm/cartes/${B}/favori`)).toBe(true));
    expect(appels.find(a => a.url === `/cm/cartes/${B}/favori`)?.corps).toEqual({ favori: true });
    expect(await screen.findByTestId(`esport-cm-carte-${B}-favori`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`esport-cm-carte-${A}-favori`));
    await waitFor(() => expect(appels.find(a => a.url === `/cm/cartes/${A}/favori`)?.corps).toEqual({ favori: false }));
    await waitFor(() => expect(screen.queryByTestId(`esport-cm-carte-${A}-favori`)).toBeNull());
  });

  it('fiche : étoile et durée de l’échéance au calendrier', async () => {
    let favori = false;
    const { client, appels } = fauxServeur(a => {
      const c = a.url.split('?')[0];
      if (c === `/cm/tableaux/${T}`) return { corps: detail() };
      if (c === '/cm/preferences') return { corps: { preferences: {} } };
      if (c === `/cm/cartes/${B}/favori`) {
        favori = a.corps?.favori === true;
        return { corps: { ok: true, favori } };
      }
      if (c === `/cm/cartes/${B}`) return { corps: reponseCarte(favori) };
      return undefined;
    });
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large carteInitiale={B} />);
    const etoile = await screen.findByTestId('esport-cm-fiche-favori');
    expect(etoile.props.accessibilityState.checked).toBe(false);
    await fireEvent.press(etoile);
    await waitFor(() => expect(screen.getByTestId('esport-cm-fiche-favori').props.accessibilityState.checked).toBe(true));
    expect(appels.find(a => a.url === `/cm/cartes/${B}/favori`)?.corps).toEqual({ favori: true });
    expect(screen.getByTestId('esport-cm-fiche-echeance-duree-selecteur')).toBeTruthy();
    expect(String(screen.getByTestId('esport-cm-fiche-echeance-duree-resume').props.children)).toContain('1 h');
  });
});

const datee = (id: string, titre: string, echeance: string, extra: Partial<CarteDatee> = {}): CarteDatee => ({
  id, titre, tableauId: T, tableau: { id: T, nom: 'Contenus', cleDefaut: null, portee: 'club', team: null }, listeId: L1, teamId: null, team: null, statut: null, post: false, reseaux: [], datePublication: null, urgence: null, soumisPar: null, soumisLe: null, origine: 'manuel', version: 2,
  droits: { valider: true, editer: true }, echeance, echeanceFaite: false, echeanceDuree: null, terminee: false, liste: { id: L1, nom: 'Idées', cle: null }, ...extra,
});

describe('cartes datées au calendrier', () => {
  it('la carte apparaît le jour de son échéance (heure du club, durée) ; la toucher ouvre la carte', async () => {
    const ouvertes: string[] = [];
    const { client } = fauxServeur(a => {
      const c = a.url.split('?')[0];
      if (c === '/cm/calendrier') return { corps: { cartes: [], echeances: [datee(A, 'Shooting', '2026-11-04T17:00:00.000Z', { echeanceDuree: 90, urgence: 'urgent' }), datee(B, 'Faite', '2026-11-05T08:00:00.000Z', { terminee: true })] } };
      if (c === '/cm/preferences') return { corps: { preferences: {} } };
      if (c === '/cm/calendrier/teams') return { corps: { teams: [] } };
      return undefined;
    });
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'setInterval'] });
    jest.setSystemTime(new Date('2026-11-03T10:00:00.000Z'));
    try {
      await render(<Calendrier theme={theme} api={apiCm(client)} large onOuvrirTableau={() => undefined} onOuvrirCarte={(t, id) => ouvertes.push(`${t}/${id}`)} />);
      const jour = await screen.findByTestId('esport-cm-calendrier-jour-2026-11-04');
      expect(within(jour).getByText('⚑ 18:00–19:30 · Shooting')).toBeTruthy();
      expect(within(jour).getByTestId(`esport-cm-calendrier-carte-${A}-urgence`)).toBeTruthy();
      expect(within(jour).getByTestId(`esport-cm-calendrier-carte-${A}-poignee`)).toBeTruthy();
      // Carte terminée : pas de poignée.
      expect(screen.queryByTestId(`esport-cm-calendrier-carte-${B}-poignee`)).toBeNull();
      await fireEvent.press(screen.getByTestId(`esport-cm-calendrier-carte-${A}-ouvrir`));
      expect(ouvertes).toEqual([`${T}/${A}`]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('« Nouvelle carte » : tableau et colonne par défaut, titre, échéance du jour touché (heure du club) ; la carte va au calendrier', async () => {
    let echeances: CarteDatee[] = [];
    const { client, appels } = fauxServeur(a => {
      const c = a.url.split('?')[0];
      if (c === '/cm/calendrier') return { corps: { cartes: [], echeances } };
      if (c === '/cm/preferences') return { corps: { preferences: {} } };
      if (c === '/cm/calendrier/teams') return { corps: { teams: [] } };
      if (c === '/cm/tableaux' && a.methode === 'GET') return { corps: { tableaux: [{ ...detail().tableau, droits: detail().droits }, { ...detail().tableau, id: T2, nom: 'Hors calendrier', calendrier: false, droits: detail().droits }], portees: [] } };
      if (c === `/cm/tableaux/${T}`) return { corps: { ...detail(), listes: [{ id: FIN, nom: 'Fini', cle: null, position: 1, archive: false, fin: true }, { id: L1, nom: 'Idées', cle: null, position: 1024, archive: false }] } };
      if (c === `/cm/tableaux/${T}/cartes`) {
        echeances = [datee(C, String(a.corps?.titre), String(a.corps?.echeance))];
        return { corps: { ...reponseCarte(false), carte: { ...reponseCarte(false).carte, id: C } } };
      }
      return undefined;
    });
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'setInterval'] });
    jest.setSystemTime(new Date('2026-11-03T10:00:00.000Z'));
    try {
      await render(<Calendrier theme={theme} api={apiCm(client)} large creerPost onOuvrirTableau={() => undefined} />);
      await fireEvent.press(await screen.findByTestId('esport-cm-calendrier-jour-2026-11-06-nouvelle'));
      const volet = await screen.findByTestId('esport-cm-calendrier-nouvelle-volet');
      await waitFor(() => expect(appels.some(a => a.url.split('?')[0] === `/cm/tableaux/${T}`)).toBe(true));
      await fireEvent.changeText(within(volet).getByTestId('esport-cm-calendrier-nouvelle-titre'), 'Teaser');
      await waitFor(() => expect(within(volet).getByTestId('esport-cm-calendrier-nouvelle-creer').props.accessibilityState.disabled).toBe(false));
      await fireEvent.press(within(volet).getByTestId('esport-cm-calendrier-nouvelle-creer'));
      await waitFor(() => expect(appels.some(a => a.url === `/cm/tableaux/${T}/cartes`)).toBe(true));
      // Midi à Paris le 6 novembre (heure d'hiver) ; colonne : la première qui n'est pas une colonne de fin.
      expect(appels.find(a => a.url === `/cm/tableaux/${T}/cartes`)?.corps).toEqual({ listeId: L1, titre: 'Teaser', echeance: '2026-11-06T11:00:00.000Z' });
      expect(await screen.findByText('⚑ 12:00 · Teaser')).toBeTruthy();
      expect(screen.getByText('Carte « Teaser » créée.')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});
