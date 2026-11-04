/**
 * Colonnes de fin et cartes terminées (docs/esport/cm.md, « Colonnes de fin ») : détection des noms, création d'une colonne
 * avec la case (cochée d'office pour « Fini »…), menu ⋯ de la colonne, bannière de proposition (cm.gerer), icône de
 * l'en-tête, carte terminée (coche, titre atténué, drapeau grisé), exclusions (compteurs d'urgence, retard), filtre
 * « Masquer les terminées », fiche (« Terminée le … par … »), phrases du journal et des notifications FR / EN.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { themeHub } from '../hub/themes';
import { clientEsport, oublierSessions, type ClientEsport } from './client';
import { apiCm, type CarteResume, type DetailTableau, type ListeCm, type ReponseCarte } from './cm/api';
import { colonnesAProposer, enRetard, estTerminee, nomColonneDeFin } from './cm/colonneFin';
import { phraseJournalCm, phraseNotificationCm } from './cm/libelles';
import { compterUrgences } from './cm/urgence';
import { definirLangue } from './i18n';
import { Tableau, carteVisible } from './ui/cm/Tableau';

const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const [L1, L2, L3] = ['1', '2', '3'].map(n => `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${n}`);
const [A, B, C] = ['1', '2', '3'].map(n => `cccccccc-cccc-4ccc-8ccc-ccccccccccc${n}`);
const FILTRES = { q: '', etiquettes: [], membres: [], echeance: 'toutes' as const, type: 'tout' as const, statut: '' as const, urgences: [] };

const resume = (id: string, titre: string, listeId: string, extra: Partial<CarteResume> = {}): CarteResume => ({
  id, listeId, teamId: null, titre, description: false, position: 1, couverture: null, echeance: null, echeanceFaite: false, datePublication: null, post: false, statut: null, reseaux: [], origine: 'manuel', depotGenre: null,
  etiquettes: [], membres: [], urgence: null, terminee: false, commentaires: 0, checklist: { total: 0, faits: 0 }, pieces: 0, archive: false, version: 1, modifiable: true, ...extra,
});
const liste = (id: string, nom: string, extra: Partial<ListeCm> = {}): ListeCm => ({ id, nom, cle: null, position: 1024, archive: false, fin: false, finIgnoree: false, ...extra });

function tableau(gerer = true, listes: ListeCm[] = [liste(L1, 'Idées'), liste(L2, 'Terminé', { fin: true, position: 2048 })]): DetailTableau {
  return {
    tableau: { id: T, nom: 'Contenus', cleDefaut: null, portee: 'club', team: null, couleur: '#db2777', description: '', version: 3, archive: false, trello: false, majLe: '', fond: null },
    droits: { voir: true, deposer: true, editer: true, valider: true, gerer, commenter: true },
    moi: 'cm123456',
    listes,
    etiquettes: [],
    cartes: [
      resume(A, 'Carte ouverte', L1, { urgence: 'critique' }),
      resume(B, 'Carte close', L2, { terminee: true, termineeLe: '2026-10-30T10:00:00.000Z', urgence: 'critique', echeance: '2020-01-01T10:00:00.000Z' }),
      resume(C, 'Autre ouverte', L1, { echeance: '2020-01-01T10:00:00.000Z' }),
    ],
    noms: {},
    personnes: [{ compte: 'cm123456', pseudo: 'Clara' }],
  };
}

function reponseCarte(): ReponseCarte {
  return {
    carte: {
      id: B, tableauId: T, listeId: L2, teamId: null, titre: 'Carte close', description: '', position: 1, couverture: null, echeance: null, echeanceFaite: false, datePublication: null, urgence: 'critique', termineeLe: '2026-10-30T10:00:00.000Z', termineePar: 'cm123456',
      post: false, statut: null, reseaux: [], textes: {}, liens: {}, publications: {}, soumisPar: null, soumisLe: null, validePar: null, valideLe: null, refusMotif: null, refusePar: null, publiePar: null, publieLe: null, origine: 'manuel', depotGenre: null,
      trello: false, archive: false, creePar: 'cm123456', creeLe: '2026-10-20T09:00:00.000Z', majLe: '', version: 1, etiquettes: [], membres: [], checklists: [], commentaires: [], pieces: [],
      activite: [{ id: 'a1', acteur: 'cm123456', action: 'terminee', meta: { liste: L2 }, date: '2026-10-30T10:00:00.000Z' }], clips: [], resumes: {},
    },
    droits: { voir: true, deposer: true, editer: true, valider: true, gerer: true, commenter: true, modifier: true },
    noms: { cm123456: 'Clara' },
    problemes: [],
  } as unknown as ReponseCarte;
}

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
const serveur = (gerer = true, listes?: ListeCm[]) =>
  fauxServeur(a => {
    const c = a.url.split('?')[0];
    if (c === `/cm/tableaux/${T}`) return { corps: tableau(gerer, listes) };
    if (c === '/cm/preferences' && a.methode === 'GET') return { corps: { preferences: {} } };
    if (c === `/cm/cartes/${B}` && a.methode === 'GET') return { corps: reponseCarte() };
    if (c === `/cm/tableaux/${T}/listes` && a.methode === 'POST') return { corps: { id: L3 } };
    return undefined;
  });

beforeEach(() => {
  oublierSessions();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});
afterEach(() => {
  definirLangue('fr');
  jest.restoreAllMocks();
});

describe('colonnes de fin : noms, exclusions', () => {
  it('noms qui évoquent une colonne de fin (accents, casse, anglais) ; propositions seulement pour les colonnes ouvertes non refusées', () => {
    for (const nom of ['Fini', 'FINIS', 'Terminé', 'Terminées ✓', 'Fait', 'Done', 'Publié', 'Published']) expect(nomColonneDeFin(nom)).toBe(true);
    for (const nom of ['Idées', 'En cours', 'À valider', 'Pas fini', '', null]) expect(nomColonneDeFin(nom)).toBe(false);
    const listes = [liste(L1, 'Idées'), liste(L2, 'Fini'), liste(L3, 'Done', { finIgnoree: true }), liste('x', 'Terminé', { fin: true }), liste('y', 'Publié', { archive: true })];
    expect(colonnesAProposer(listes).map(l => l.nom)).toEqual(['Fini']);
  });

  it('une carte terminée n’est jamais en retard et ne compte pas dans les urgences ; le drapeau reste lisible', () => {
    const maintenant = Date.parse('2026-11-03T10:00:00Z');
    const ouverte = resume(A, 'x', L1, { echeance: '2026-10-01T00:00:00Z' });
    const close = resume(B, 'y', L2, { echeance: '2026-10-01T00:00:00Z', terminee: true });
    expect(enRetard(ouverte, maintenant)).toBe(true);
    expect(enRetard(close, maintenant)).toBe(false);
    expect(estTerminee(close)).toBe(true);
    expect(estTerminee({})).toBe(false);
    const cartes = [resume(A, 'x', L1, { urgence: 'critique' }), resume(B, 'y', L2, { urgence: 'critique', terminee: true }), resume(C, 'z', L1, { urgence: 'urgent' })];
    expect(compterUrgences(cartes)).toEqual({ critique: 1, urgent: 1 });
    // Filtres : retard exclut la terminée ; « Masquer les terminées ».
    expect(carteVisible(close, { ...FILTRES, echeance: 'retard' }, maintenant, {})).toBe(false);
    expect(carteVisible(ouverte, { ...FILTRES, echeance: 'retard' }, maintenant, {})).toBe(true);
    expect(carteVisible(close, { ...FILTRES, masquerTerminees: true }, maintenant, {})).toBe(false);
    expect(carteVisible(close, FILTRES, maintenant, {})).toBe(true);
  });

  it('phrases du journal et des notifications, en français et en anglais', () => {
    const nom = () => 'Clara';
    expect(phraseJournalCm('cm.carte_terminee', 'Clara', { titre: 'Annonce' })).toBe('Clara a terminé la carte « Annonce »');
    expect(phraseJournalCm('cm.carte_rouverte', 'Clara', { titre: 'Annonce' })).toBe('Clara a rouvert la carte « Annonce »');
    expect(phraseJournalCm('cm.liste_fin', 'Clara', { nom: 'Fini', fin: true, cartes: 3 })).toBe('Clara a marqué la colonne « Fini » comme colonne de fin (3 cartes terminées)');
    expect(phraseJournalCm('cm.liste_fin', 'Clara', { cle: 'publie', fin: false, cartes: 2 })).toBe('Clara a retiré la colonne de fin « Publié » (2 cartes rouvertes)');
    expect(phraseNotificationCm('cm-carte-terminee', '', { titre: 'Annonce', membre: 'x', liste: 'Fini' }, nom)).toBe('Clara a terminé la carte « Annonce » (Fini)');
    expect(phraseNotificationCm('cm-carte-terminee', '', { titre: 'Annonce', membre: 'x', cle: 'publie' }, nom)).toBe('Clara a terminé la carte « Annonce » (Publié)');
    definirLangue('en');
    expect(phraseJournalCm('cm.carte_terminee', 'Clara', { titre: 'Annonce' })).toBe('Clara marked the card “Annonce” done');
    expect(phraseNotificationCm('cm-carte-terminee', '', { titre: 'Annonce', membre: 'x', liste: 'Done' }, nom)).toBe('Clara marked the card “Annonce” done (Done)');
  });
});

describe('colonnes de fin sur le tableau', () => {
  it('icône dans l’en-tête de la colonne de fin seulement ; carte terminée : coche, titre atténué, drapeau grisé, hors compteurs d’urgence', async () => {
    const { client } = serveur();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    expect(await screen.findByTestId(`esport-cm-liste-${L2}-fin-icone`)).toBeTruthy();
    expect(screen.queryByTestId(`esport-cm-liste-${L1}-fin-icone`)).toBeNull();
    expect(screen.getByTestId(`esport-cm-carte-${B}-terminee`)).toBeTruthy();
    expect(screen.queryByTestId(`esport-cm-carte-${A}-terminee`)).toBeNull();
    expect(screen.getByTestId(`esport-cm-carte-${B}-urgence-grisee`)).toBeTruthy();
    expect(screen.queryByTestId(`esport-cm-carte-${B}-urgence-bande`)).toBeNull();
    expect(screen.getByTestId(`esport-cm-carte-${A}-urgence-bande`)).toBeTruthy();
    expect(screen.getByLabelText(/^Carte close, Carte terminée, Urgence : Critique/)).toBeTruthy();
    // Compteurs d'en-tête : la critique de la colonne de fin ne compte pas.
    expect(within(screen.getByTestId(`esport-cm-liste-${L1}-entete`)).getByLabelText('1 carte critique')).toBeTruthy();
    expect(within(screen.getByTestId(`esport-cm-liste-${L2}-entete`)).queryByLabelText('1 carte critique')).toBeNull();
  });

  it('filtre « Masquer les terminées »', async () => {
    const { client } = serveur();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${B}`);
    await fireEvent.press(screen.getByTestId('esport-cm-filtres'));
    await fireEvent.press(screen.getByTestId('esport-cm-filtre-terminees'));
    await waitFor(() => expect(screen.queryByTestId(`esport-cm-carte-${B}`)).toBeNull());
    expect(screen.getByTestId(`esport-cm-carte-${A}`)).toBeTruthy();
  });

  it('filtre « En retard » : la carte terminée dont l’échéance est dépassée n’y figure pas', async () => {
    const { client } = serveur();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${B}`);
    await fireEvent.press(screen.getByTestId('esport-cm-filtres'));
    await fireEvent.press(screen.getByTestId('esport-cm-filtre-echeance-retard'));
    await waitFor(() => expect(screen.queryByTestId(`esport-cm-carte-${B}`)).toBeNull());
    expect(screen.getByTestId(`esport-cm-carte-${C}`)).toBeTruthy();
  });

  it('création d’une colonne : case cochée d’office pour « Fini », décochable, envoyée au serveur', async () => {
    const { client, appels } = serveur();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await fireEvent.press(await screen.findByTestId('esport-cm-liste-nouvelle'));
    const case_ = () => screen.getByTestId('esport-cm-liste-fin');
    expect(case_().props.accessibilityState.checked).toBe(false);
    await fireEvent.changeText(screen.getByTestId('esport-cm-liste-nom'), 'En cours');
    expect(case_().props.accessibilityState.checked).toBe(false);
    await fireEvent.changeText(screen.getByTestId('esport-cm-liste-nom'), 'Fini');
    expect(case_().props.accessibilityState.checked).toBe(true);
    expect(screen.getByTestId('esport-cm-liste-fin-suggestion')).toBeTruthy();
    // Une fois la case touchée à la main, le nom ne la change plus.
    await fireEvent.press(case_());
    expect(case_().props.accessibilityState.checked).toBe(false);
    await fireEvent.changeText(screen.getByTestId('esport-cm-liste-nom'), 'Terminé');
    expect(case_().props.accessibilityState.checked).toBe(false);
    await fireEvent.press(case_());
    await fireEvent.press(screen.getByTestId('esport-cm-liste-creer'));
    await waitFor(() => expect(appels.some(a => a.url === `/cm/tableaux/${T}/listes` && a.methode === 'POST')).toBe(true));
    expect(appels.find(a => a.url === `/cm/tableaux/${T}/listes`)?.corps).toEqual({ nom: 'Terminé', fin: true });
  });

  it('création sans case : le corps ne porte pas « fin »', async () => {
    const { client, appels } = serveur();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await fireEvent.press(await screen.findByTestId('esport-cm-liste-nouvelle'));
    await fireEvent.changeText(screen.getByTestId('esport-cm-liste-nom'), 'À relire');
    await fireEvent.press(screen.getByTestId('esport-cm-liste-creer'));
    await waitFor(() => expect(appels.some(a => a.url === `/cm/tableaux/${T}/listes` && a.methode === 'POST')).toBe(true));
    expect(appels.find(a => a.url === `/cm/tableaux/${T}/listes`)?.corps).toEqual({ nom: 'À relire' });
  });

  it('menu ⋯ de la colonne : cocher et décocher la colonne de fin (PATCH fin)', async () => {
    const { client, appels } = serveur();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${A}`);
    await fireEvent.press(screen.getByTestId(`esport-cm-liste-${L1}-menu`));
    await fireEvent.press(await screen.findByTestId(`esport-cm-liste-${L1}-fin`));
    await waitFor(() => expect(appels.some(a => a.xMethode === 'PATCH' && a.url === `/cm/listes/${L1}`)).toBe(true));
    expect(appels.find(a => a.xMethode === 'PATCH' && a.url === `/cm/listes/${L1}`)?.corps).toEqual({ fin: true });
    await fireEvent.press(screen.getByTestId(`esport-cm-liste-${L2}-menu`));
    await fireEvent.press(await screen.findByTestId(`esport-cm-liste-${L2}-fin`));
    await waitFor(() => expect(appels.some(a => a.xMethode === 'PATCH' && a.url === `/cm/listes/${L2}`)).toBe(true));
    expect(appels.find(a => a.xMethode === 'PATCH' && a.url === `/cm/listes/${L2}`)?.corps).toEqual({ fin: false });
  });
});

describe('bannière « Marquer “Fini” comme colonne de fin ? »', () => {
  const listes = [liste(L1, 'Idées'), liste(L2, 'Fini', { position: 2048 }), liste(L3, 'Done', { position: 3072, finIgnoree: true })];

  it('visible pour qui gère le CM, pour les colonnes qui y ressemblent ; Oui marque la colonne', async () => {
    const { client, appels } = serveur(true, listes);
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    expect(await screen.findByTestId(`esport-cm-liste-${L2}-fin-banniere`)).toBeTruthy();
    expect(screen.getByText('Marquer « Fini » comme colonne de fin ?')).toBeTruthy();
    expect(screen.queryByTestId(`esport-cm-liste-${L1}-fin-banniere`)).toBeNull();
    expect(screen.queryByTestId(`esport-cm-liste-${L3}-fin-banniere`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`esport-cm-liste-${L2}-fin-oui`));
    await waitFor(() => expect(appels.some(a => a.xMethode === 'PATCH' && a.url === `/cm/listes/${L2}`)).toBe(true));
    expect(appels.find(a => a.xMethode === 'PATCH' && a.url === `/cm/listes/${L2}`)?.corps).toEqual({ fin: true });
  });

  it('Non merci mémorise le refus (finIgnoree) ; rien sans cm.gerer', async () => {
    const { client, appels } = serveur(true, listes);
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await fireEvent.press(await screen.findByTestId(`esport-cm-liste-${L2}-fin-non`));
    await waitFor(() => expect(appels.some(a => a.xMethode === 'PATCH' && a.url === `/cm/listes/${L2}`)).toBe(true));
    expect(appels.find(a => a.xMethode === 'PATCH' && a.url === `/cm/listes/${L2}`)?.corps).toEqual({ finIgnoree: true });
    const lecteur = serveur(false, listes);
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(lecteur.client)} id={T} large testID="tableau-sans-gerer" />);
    const t = await screen.findByTestId('tableau-sans-gerer');
    await waitFor(() => expect(within(t).getAllByTestId(`esport-cm-liste-${L2}`).length).toBeGreaterThan(0));
    expect(within(t).queryByTestId(`esport-cm-liste-${L2}-fin-banniere`)).toBeNull();
  });
});

describe('fiche de la carte terminée', () => {
  it('mention « Terminée le … par … », drapeau grisé, journal lisible', async () => {
    const { client } = serveur();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await fireEvent.press(await screen.findByTestId(`esport-cm-carte-${B}-tuile`));
    const mention = await screen.findByTestId('esport-cm-fiche-terminee-texte');
    expect(mention.props.children).toMatch(/^Terminée le .* par Clara$/);
    expect(screen.getByTestId('esport-cm-fiche-urgence-grisee')).toBeTruthy();
    expect(screen.getByText(/Clara a terminé la carte \(colonne de fin\)/)).toBeTruthy();
  });
});

describe('Accueil CM : API des cartes terminées', () => {
  it('terminees() interroge /cm/terminees?semaines=N', async () => {
    const { client, appels } = fauxServeur(a => (a.url.startsWith('/cm/terminees') ? { corps: { semaines: [{ debut: '2026-11-02', n: 3 }], total: 3 } } : undefined));
    const r = await apiCm(client).terminees(4);
    expect(r.total).toBe(3);
    expect(appels.some(a => a.url === '/cm/terminees?semaines=4')).toBe(true);
  });
});
