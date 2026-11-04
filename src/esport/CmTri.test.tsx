/**
 * Tri des cartes d'une colonne CM (migration 0052, docs/esport/cm.md, « Tri des cartes ») : fonction de tri (urgence,
 * échéance, terminées, positions ; fuseau Europe/Paris, dates figées), option par colonne mémorisée côté serveur, libellé
 * d'en-tête, création en chaîne, relecture en temps réel, glisser-déposer.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { themeHub } from '../hub/themes';
import { clientEsport, oublierSessions, type ClientEsport } from './client';
import { apiCm, type CarteResume, type DetailTableau, type ListeCm, type Urgence } from './cm/api';
import { comparerCartes, trierCartes, triAutomatique } from './cm/tri';
import { definirLangue } from './i18n';
import { Tableau, regleDepot } from './ui/cm/Tableau';

const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const L1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const L2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const id = (n: number) => `cccccccc-cccc-4ccc-8ccc-ccccccccc${String(n).padStart(3, '0')}`;

// « Maintenant » figé : 4 novembre 2026, 10 h à Paris (CET, UTC+1) ; échéances saisies à l'heure de Paris.
const MAINTENANT = new Date('2026-11-04T09:00:00.000Z');
const paris = (jour: string, heure = '12:00') => new Date(`${jour}T${heure}:00+01:00`).toISOString();

const resume = (n: number, titre: string, position: number, extra: Partial<CarteResume> = {}, listeId = L1): CarteResume => ({
  id: id(n), listeId, teamId: null, titre, description: false, position, couverture: null, echeance: null, echeanceFaite: false, datePublication: null, post: false, statut: null, reseaux: [], origine: 'manuel', depotGenre: null,
  etiquettes: [], membres: [], urgence: null, commentaires: 0, checklist: { total: 0, faits: 0 }, pieces: 0, archive: false, version: 1, modifiable: true, ...extra,
});
const titresDe = (cartes: CarteResume[]) => cartes.map(c => c.titre);

describe('fonction de tri automatique', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: MAINTENANT });
  });
  afterEach(() => jest.useRealTimers());

  it('urgence décroissante : Critique, Urgent, Moyen, Faible, sans drapeau ; position à égalité', () => {
    const cartes = [
      resume(1, 'sans', 1),
      resume(2, 'faible', 2, { urgence: 'faible' }),
      resume(3, 'moyen', 3, { urgence: 'moyen' }),
      resume(4, 'urgent', 4, { urgence: 'urgent' }),
      resume(5, 'critique', 5, { urgence: 'critique' }),
      resume(6, 'urgent bis', 0, { urgence: 'urgent' }),
    ];
    expect(titresDe(trierCartes(cartes))).toEqual(['critique', 'urgent bis', 'urgent', 'moyen', 'faible', 'sans']);
    // Chaque niveau passe devant le suivant, quelles que soient les positions.
    const niveaux: Array<Urgence | null> = ['critique', 'urgent', 'moyen', 'faible', null];
    for (let i = 0; i < niveaux.length - 1; i++) {
      expect(comparerCartes(resume(1, 'a', 99, { urgence: niveaux[i] }), resume(2, 'b', 1, { urgence: niveaux[i + 1] }))).toBeLessThan(0);
    }
  });

  it('à urgence égale : échéances dépassées d’abord, puis les plus proches ; sans échéance après celles qui en ont', () => {
    const cartes = [
      resume(1, 'sans échéance', 1, { urgence: 'urgent' }),
      resume(2, 'dans dix jours', 2, { urgence: 'urgent', echeance: paris('2026-11-14') }),
      resume(3, 'demain', 3, { urgence: 'urgent', echeance: paris('2026-11-05') }),
      resume(4, 'hier (dépassée)', 4, { urgence: 'urgent', echeance: paris('2026-11-03') }),
      resume(5, 'il y a un mois', 5, { urgence: 'urgent', echeance: paris('2026-10-04') }),
    ];
    expect(titresDe(trierCartes(cartes))).toEqual(['il y a un mois', 'hier (dépassée)', 'demain', 'dans dix jours', 'sans échéance']);
  });

  it('même jour : l’heure départage (changement d’heure d’octobre inclus) ; mêmes échéances : position', () => {
    // 25 octobre 2026 : passage à l'heure d'hiver à Paris (3 h → 2 h). 02:30 d'été (00:30 UTC) précède 02:30 d'hiver (01:30 UTC).
    const ete = '2026-10-25T00:30:00.000Z';
    const hiver = '2026-10-25T01:30:00.000Z';
    const cartes = [resume(1, 'hiver', 1, { echeance: hiver }), resume(2, 'été', 2, { echeance: ete }), resume(3, 'égale B', 6, { echeance: paris('2026-11-10') }), resume(4, 'égale A', 5, { echeance: paris('2026-11-10') })];
    expect(titresDe(trierCartes(cartes))).toEqual(['été', 'hiver', 'égale A', 'égale B']);
  });

  it('l’urgence prime sur l’échéance ; une échéance cochée « faite » compte comme sans échéance', () => {
    const cartes = [
      resume(1, 'faible très proche', 1, { urgence: 'faible', echeance: paris('2026-11-04', '08:00') }),
      resume(2, 'critique lointaine', 2, { urgence: 'critique', echeance: paris('2027-01-01') }),
      resume(3, 'moyen fait', 3, { urgence: 'moyen', echeance: paris('2026-11-01'), echeanceFaite: true }),
      resume(4, 'moyen à venir', 4, { urgence: 'moyen', echeance: paris('2026-11-30') }),
      resume(5, 'échéance illisible', 5, { urgence: 'moyen', echeance: 'n’importe quoi' }),
    ];
    expect(titresDe(trierCartes(cartes))).toEqual(['critique lointaine', 'moyen à venir', 'moyen fait', 'échéance illisible', 'faible très proche']);
  });

  it('cartes terminées en dernier (leur urgence et leur échéance ne comptent plus), dans leur ordre manuel', () => {
    const cartes = [
      resume(1, 'terminée critique', 1, { urgence: 'critique', terminee: true, echeance: paris('2026-10-01') }),
      resume(2, 'ouverte sans rien', 9),
      resume(3, 'terminée 2', 3, { terminee: true }),
      resume(4, 'ouverte faible', 8, { urgence: 'faible' }),
      resume(5, 'terminée 0', 0, { terminee: true, urgence: 'faible' }),
    ];
    expect(titresDe(trierCartes(cartes))).toEqual(['ouverte faible', 'ouverte sans rien', 'terminée 0', 'terminée critique', 'terminée 2']);
  });

  it('toutes les combinaisons urgence x échéance x terminée : ordre total cohérent, entrée non modifiée', () => {
    const niveaux: Array<Urgence | null> = ['critique', 'urgent', 'moyen', 'faible', null];
    const echeances = [paris('2026-10-20'), paris('2026-11-20'), null];
    let n = 0;
    const cartes: CarteResume[] = [];
    for (const terminee of [false, true]) for (const urgence of niveaux) for (const echeance of echeances) cartes.push(resume(++n, `${terminee ? 'T' : 'O'}-${urgence ?? 'x'}-${echeance ?? 'x'}`, 1000 - n, { urgence, echeance, terminee }));
    const copie = [...cartes];
    const triees = trierCartes(cartes);
    expect(cartes).toEqual(copie);
    expect(triees).toHaveLength(30);
    // Ouvertes avant terminées ; puis urgence décroissante ; puis échéance croissante (sans échéance en dernier).
    expect(triees.slice(0, 15).every(c => !c.terminee) && triees.slice(15).every(c => c.terminee)).toBe(true);
    expect(titresDe(triees).slice(0, 6)).toEqual(['O-critique-' + echeances[0], 'O-critique-' + echeances[1], 'O-critique-x', 'O-urgent-' + echeances[0], 'O-urgent-' + echeances[1], 'O-urgent-x']);
    for (let i = 1; i < 15; i++) expect(comparerCartes(triees[i - 1], triees[i])).toBeLessThan(0);
    // Idempotent et indépendant de l'ordre d'entrée.
    expect(titresDe(trierCartes([...cartes].reverse()))).toEqual(titresDe(triees));
    expect(titresDe(trierCartes(triees))).toEqual(titresDe(triees));
  });

  it('colonne en tri automatique seulement si le serveur le dit ; un serveur ancien garde l’ordre manuel', () => {
    expect(triAutomatique({ tri: 'auto' })).toBe(true);
    expect(triAutomatique({ tri: 'manuel' })).toBe(false);
    expect(triAutomatique({})).toBe(false);
    expect(triAutomatique(undefined)).toBe(false);
  });
});

// ------------------------------------------------------------------ Tableau

interface Appel {
  url: string;
  methode: string;
  xMethode?: string;
  corps?: Record<string, unknown>;
}

/** Faux serveur à état : le tri des colonnes et les cartes sont relus par GET. */
function serveur(editer = true, triInitial: 'auto' | 'manuel' | 'ancien' = 'auto') {
  const appels: Appel[] = [];
  const etat = {
    listes: [
      { id: L1, nom: 'Idées', cle: null, position: 1024, archive: false, fin: false, tri: triInitial === 'ancien' ? undefined : triInitial },
      { id: L2, nom: 'Prêtes', cle: null, position: 2048, archive: false, fin: false, tri: triInitial === 'ancien' ? undefined : triInitial },
    ] as ListeCm[],
    cartes: [
      resume(1, 'Sans drapeau', 1),
      resume(2, 'Faible proche', 2, { urgence: 'faible', echeance: '2026-11-05T11:00:00.000Z' }),
      resume(3, 'Critique', 3, { urgence: 'critique' }),
      resume(4, 'Urgent lointain', 4, { urgence: 'urgent', echeance: '2026-12-20T11:00:00.000Z' }),
      resume(5, 'Urgent proche', 5, { urgence: 'urgent', echeance: '2026-11-06T11:00:00.000Z' }),
      resume(6, 'Autre colonne', 6, {}, L2),
    ],
    version: 3,
  };
  const detail = (): DetailTableau => ({
    tableau: { id: T, nom: 'Contenus', cleDefaut: null, portee: 'club', team: null, couleur: '#db2777', description: '', version: etat.version, archive: false, trello: false, majLe: '', fond: null },
    droits: { voir: true, deposer: true, editer, valider: true, gerer: true, commenter: true },
    moi: 'cm123456',
    listes: etat.listes.map(l => ({ ...l })),
    etiquettes: [],
    cartes: etat.cartes.map(c => ({ ...c })),
    noms: {},
    personnes: [],
  });
  const requete = jest.fn(async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
    const a: Appel = { url: url.replace('https://esport.test', ''), methode: init?.method ?? 'GET', xMethode: init?.headers?.['X-Methode'], corps: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined };
    appels.push(a);
    const rep = (corps: unknown) => ({ ok: true, status: 200, json: async () => corps });
    if (a.url === '/session') return rep({ session: 's1', expire: '2099-01-01T00:00:00.000Z', compte: 'cm123456', superAdmin: false, profil: null, peutCreerTeam: false, fonctions: ['surcharge-methode'] });
    const c = a.url.split('?')[0];
    if (c === `/cm/tableaux/${T}` && a.methode === 'GET') return rep(detail());
    if (c === '/cm/preferences') return rep({ preferences: {} });
    const m = /^\/cm\/listes\/([^/]+)$/.exec(c);
    if (m && a.xMethode === 'PATCH') {
      const l = etat.listes.find(x => x.id === m[1]);
      if (l && a.corps?.tri) l.tri = a.corps.tri as 'auto' | 'manuel';
      etat.version++;
      return rep({ ok: true });
    }
    if (c === `/cm/tableaux/${T}/cartes`) {
      etat.cartes.push(resume(50 + etat.cartes.length, String(a.corps?.titre), 100 + etat.cartes.length, {}, String(a.corps?.listeId)));
      etat.version++;
      return rep({ ok: true });
    }
    return rep({ ok: true });
  });
  const client: ClientEsport = clientEsport({ adresse: 'https://esport.test', jetonRelais: 'jeton-relais-0123456789' }, requete);
  return { client, appels, etat };
}

const titresColonne = (listeId = L1) =>
  within(screen.getByTestId(`esport-cm-liste-${listeId}-cartes`))
    .getAllByTestId(/^esport-cm-carte-[0-9a-f-]+-tuile$/)
    .map(n => (n.props.accessibilityLabel as string).split(',')[0]);

beforeEach(() => {
  oublierSessions();
  definirLangue('fr');
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});
afterEach(() => {
  definirLangue('fr');
  jest.restoreAllMocks();
});

describe('tri automatique sur le tableau', () => {
  it('par défaut : urgence puis échéance ; libellé discret « Trié par urgence » dans l’en-tête avec son infobulle', async () => {
    const { client } = serveur();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${id(1)}`);
    expect(titresColonne()).toEqual(['Critique', 'Urgent proche', 'Urgent lointain', 'Faible proche', 'Sans drapeau']);
    const libelle = screen.getByTestId(`esport-cm-liste-${L1}-tri-actif`);
    expect(libelle.props.children).toBe('Trié par urgence');
    expect(libelle.props.accessibilityHint).toContain('Passer en ordre manuel pour réordonner');
    expect(libelle.props.title).toContain('Passer en ordre manuel pour réordonner');
  });

  it('ordre manuel : positions, pas de libellé ; serveur ancien (sans option) : ordre manuel', async () => {
    const { client } = serveur(true, 'manuel');
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${id(1)}`);
    expect(titresColonne()).toEqual(['Sans drapeau', 'Faible proche', 'Critique', 'Urgent lointain', 'Urgent proche']);
    expect(screen.queryByTestId(`esport-cm-liste-${L1}-tri-actif`)).toBeNull();
    const ancien = serveur(true, 'ancien');
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(ancien.client)} id={T} large testID="tableau-ancien" />);
    await waitFor(() => expect(within(screen.getByTestId('tableau-ancien')).queryAllByTestId(/-tuile$/).length).toBeGreaterThan(0));
    expect(within(screen.getByTestId('tableau-ancien')).queryByTestId(`esport-cm-liste-${L1}-tri-actif`)).toBeNull();
  });

  it('menu ⋯ : « Ordre manuel » / « Tri automatique » enregistrés par colonne côté serveur (PATCH tri), relus par les autres', async () => {
    const { client, appels, etat } = serveur();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${id(1)}`);
    await fireEvent.press(screen.getByTestId(`esport-cm-liste-${L1}-menu`));
    expect(await screen.findByText('Tri automatique (urgence puis échéance) (actuel)')).toBeTruthy();
    await fireEvent.press(await screen.findByTestId(`esport-cm-liste-${L1}-tri-manuel`));
    expect(titresColonne()).toEqual(['Sans drapeau', 'Faible proche', 'Critique', 'Urgent lointain', 'Urgent proche']);
    await waitFor(() => expect(appels.some(a => a.url === `/cm/listes/${L1}` && a.xMethode === 'PATCH')).toBe(true));
    expect(appels.find(a => a.url === `/cm/listes/${L1}` && a.xMethode === 'PATCH')?.corps).toEqual({ tri: 'manuel' });
    expect(etat.listes.map(l => l.tri)).toEqual(['manuel', 'auto']);
    // L'autre colonne n'est pas touchée.
    expect(screen.getByTestId(`esport-cm-liste-${L2}-tri-actif`)).toBeTruthy();
    // Un autre navigateur relit le choix : colonne 1 manuelle, colonne 2 automatique.
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large testID="tableau-autre" />);
    const autre = within(await screen.findByTestId('tableau-autre'));
    await waitFor(() => expect(autre.queryAllByTestId(`esport-cm-liste-${L2}-tri-actif`).length).toBe(1));
    expect(autre.queryByTestId(`esport-cm-liste-${L1}-tri-actif`)).toBeNull();
    // Retour au tri automatique.
    await fireEvent.press(screen.getByTestId(`esport-cm-liste-${L1}-menu`));
    await fireEvent.press(await screen.findByTestId(`esport-cm-liste-${L1}-tri-auto`));
    expect(titresColonne()).toEqual(['Critique', 'Urgent proche', 'Urgent lointain', 'Faible proche', 'Sans drapeau']);
    await waitFor(() => expect(etat.listes[0].tri).toBe('auto'));
  });

  it('lecteur : pas de choix de tri dans le menu de la colonne', async () => {
    const { client } = serveur(false);
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${id(1)}`);
    await fireEvent.press(screen.getByTestId(`esport-cm-liste-${L1}-menu`));
    await screen.findByTestId(`esport-cm-liste-${L1}-reduire-menu`);
    expect(screen.queryByTestId(`esport-cm-liste-${L1}-tri-auto`)).toBeNull();
    expect(screen.queryByTestId(`esport-cm-liste-${L1}-tri-manuel`)).toBeNull();
  });

  it('colonne triée : « Monter » / « Descendre » absents (réordonner dedans n’a pas de sens), « Déplacer vers… » reste', async () => {
    const { client } = serveur();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${id(1)}`);
    await fireEvent.press(screen.getByTestId(`esport-cm-carte-${id(5)}-menu`));
    await screen.findByTestId(`esport-cm-carte-${id(5)}-ouvrir`);
    expect(screen.queryByTestId(`esport-cm-carte-${id(5)}-monter`)).toBeNull();
    expect(screen.queryByTestId(`esport-cm-carte-${id(5)}-descendre`)).toBeNull();
  });

  it('glisser-déposer : entre colonnes possible (poignée présente), à l’intérieur d’une colonne triée bloqué, libre en ordre manuel', async () => {
    expect(regleDepot(true, L1, L1)).toBe('bloque');
    expect(regleDepot(true, L1, L2)).toBe('fin');
    expect(regleDepot(false, L1, L1)).toBe('libre');
    expect(regleDepot(false, L1, L2)).toBe('libre');
    const { client } = serveur();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${id(1)}`);
    expect(screen.getByTestId(`esport-cm-carte-${id(1)}-poignee`)).toBeTruthy();
    const lecteur = serveur(false);
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(lecteur.client)} id={T} large testID="tableau-lecteur" />);
    await waitFor(() => expect(within(screen.getByTestId('tableau-lecteur')).queryAllByTestId(/-tuile$/).length).toBeGreaterThan(0));
    expect(within(screen.getByTestId('tableau-lecteur')).queryByTestId(`esport-cm-carte-${id(1)}-poignee`)).toBeNull();
  });

  it('temps réel : quand l’urgence ou l’échéance change ailleurs, la carte se replace', async () => {
    const { client, etat } = serveur();
    const vue = await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${id(1)}`);
    expect(titresColonne()[0]).toBe('Critique');
    // Un collègue passe « Sans drapeau » en critique avec échéance demain, puis repousse « Critique ».
    etat.cartes[0] = { ...etat.cartes[0], urgence: 'critique', echeance: '2026-11-05T11:00:00.000Z' };
    etat.cartes[2] = { ...etat.cartes[2], echeance: '2026-12-31T11:00:00.000Z' };
    etat.version++;
    await act(async () => {
      vue.rerender(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large versionServeur={etat.version} />);
    });
    await waitFor(() => expect(titresColonne().slice(0, 2)).toEqual(['Sans drapeau', 'Critique']));
    expect(titresColonne()).toEqual(['Sans drapeau', 'Critique', 'Urgent proche', 'Urgent lointain', 'Faible proche']);
  });

  it('animation du reclassement : présente en tri automatique, coupée avec prefers-reduced-motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const { client } = serveur();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${id(1)}`);
    await waitFor(() => expect(screen.getAllByTestId('esport-cm-place-carte').length).toBeGreaterThan(0));
    jest.restoreAllMocks();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large testID="tableau-reduit" />);
    await waitFor(() => expect(within(screen.getByTestId('tableau-reduit')).queryAllByTestId(/-tuile$/).length).toBeGreaterThan(0));
    expect(within(screen.getByTestId('tableau-reduit')).queryByTestId('esport-cm-place-carte')).toBeNull();
  });

  it('création en chaîne : la nouvelle carte (sans drapeau) se range à sa place triée, avant les cartes terminées', async () => {
    const { client, appels } = serveur();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${id(1)}`);
    await fireEvent.press(screen.getByTestId(`esport-cm-ajout-${L1}`));
    const champ = await screen.findByTestId(`esport-cm-ajout-${L1}-titre`);
    await fireEvent.changeText(champ, 'Idée A');
    await fireEvent(champ, 'keyPress', { nativeEvent: { key: 'Enter', shiftKey: false }, preventDefault: jest.fn() });
    // Optimiste : à la fin des cartes sans drapeau (position la plus grande), derrière celles qui ont une urgence.
    expect(titresColonne()).toEqual(['Critique', 'Urgent proche', 'Urgent lointain', 'Faible proche', 'Sans drapeau', 'Idée A']);
    await waitFor(() => expect(appels.some(a => a.url === `/cm/tableaux/${T}/cartes`)).toBe(true));
    await waitFor(() => expect(titresColonne()).toHaveLength(6));
    expect(titresColonne()[5]).toBe('Idée A');
  });
});
