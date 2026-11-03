/**
 * Tableaux CM : création de cartes en chaîne (comme Trello) et déplacement des colonnes (docs/esport/cm.md).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { clientEsport, oublierSessions, type ClientEsport } from './client';
import { apiCm, type CarteResume, type DetailTableau } from './cm/api';
import { definirLangue } from './i18n';
import { Tableau, indexColonneCible, titresAjout } from './ui/cm/Tableau';

const theme = themeHub('nuit');
const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const L1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const L2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const L3 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';

const carte = (id: string, listeId: string, titre: string, position: number): CarteResume => ({
  id, listeId, teamId: null, titre, description: false, position, couverture: null, echeance: null, echeanceFaite: false, datePublication: null, post: false, statut: null, reseaux: [], origine: 'manuel', depotGenre: null, etiquettes: [], membres: [], commentaires: 0, checklist: { total: 0, faits: 0 }, pieces: 0, archive: false, version: 1, modifiable: true,
});

interface Appel {
  url: string;
  methode: string;
  xMethode?: string;
  corps?: Record<string, unknown>;
}

/** Faux serveur à état : les cartes créées et l'ordre des colonnes sont relus par GET. */
function serveur(editer = true) {
  const appels: Appel[] = [];
  const cartes: CarteResume[] = [carte('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', L1, 'Première', 1024)];
  let ordre = [L1, L2, L3];
  let version = 3;
  const detail = (): DetailTableau => ({
    tableau: { id: T, nom: 'Ligne zéro', cleDefaut: null, portee: 'club', team: null, couleur: '#db2777', description: '', version, archive: false, trello: true, majLe: '', fond: null },
    droits: { voir: true, deposer: true, editer, valider: true, gerer: true, commenter: true },
    moi: 'cm123456',
    listes: ordre.map((id, i) => ({ id, nom: `Liste ${id.slice(-1)}`, cle: null, position: (i + 1) * 1024, archive: false })),
    etiquettes: [],
    cartes: [...cartes],
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
    if (c === `/cm/tableaux/${T}/cartes`) {
      cartes.push(carte(`cccccccc-cccc-4ccc-8ccc-${String(cartes.length).padStart(12, '0')}`, String(a.corps?.listeId), String(a.corps?.titre), 1024 * (cartes.length + 1)));
      version++;
      return rep({ ok: true });
    }
    const m = /^\/cm\/listes\/([^/]+)\/deplacer$/.exec(c);
    if (m) {
      const autres = ordre.filter(x => x !== m[1]);
      autres.splice(Number(a.corps?.index), 0, m[1]);
      ordre = autres;
      version++;
      return rep({ ok: true });
    }
    return rep({ ok: true });
  });
  const client: ClientEsport = clientEsport({ adresse: 'https://esport.test', jetonRelais: 'jeton-relais-0123456789' }, requete);
  return { client, appels };
}

const titres = (listeId: string) => within(screen.getByTestId(`esport-cm-liste-${listeId}-cartes`)).queryAllByTestId(/^esport-cm-carte-[0-9a-z-]+-tuile$/).length;
const touche = (key: string, shiftKey = false) => ({ nativeEvent: { key, shiftKey }, preventDefault: jest.fn() });

beforeEach(() => {
  oublierSessions();
  definirLangue('fr');
});

describe('création de cartes en chaîne', () => {
  it('Entrée crée la carte, vide le champ et le garde ouvert ; la carte apparaît tout de suite', async () => {
    const { client, appels } = serveur();
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-liste-${L1}-cartes`);
    await fireEvent.press(screen.getByTestId(`esport-cm-ajout-${L1}`));
    const champ = await screen.findByTestId(`esport-cm-ajout-${L1}-titre`);
    expect(titres(L1)).toBe(1);
    await fireEvent.changeText(champ, 'Idée A');
    const e = touche('Enter');
    await fireEvent(champ, 'keyPress', e);
    expect(e.preventDefault).toHaveBeenCalled();
    // Optimiste : visible avant même la réponse ; champ vide et toujours là.
    expect(screen.getByText('Idée A')).toBeTruthy();
    expect(screen.getByTestId(`esport-cm-ajout-${L1}-titre`).props.value).toBe('');
    await fireEvent.changeText(screen.getByTestId(`esport-cm-ajout-${L1}-titre`), 'Idée B');
    await fireEvent(screen.getByTestId(`esport-cm-ajout-${L1}-titre`), 'keyPress', touche('Enter'));
    await waitFor(() => expect(appels.filter(a => a.url === `/cm/tableaux/${T}/cartes`)).toHaveLength(2));
    expect(appels.filter(a => a.url === `/cm/tableaux/${T}/cartes`).map(a => a.corps)).toEqual([
      { listeId: L1, titre: 'Idée A', post: false },
      { listeId: L1, titre: 'Idée B', post: false },
    ]);
    await waitFor(() => expect(titres(L1)).toBe(3));
    expect(screen.getByTestId(`esport-cm-ajout-${L1}-titre`)).toBeTruthy();
    // Le bouton garde aussi le champ ouvert.
    await fireEvent.changeText(screen.getByTestId(`esport-cm-ajout-${L1}-titre`), 'Idée C');
    await fireEvent.press(screen.getByTestId(`esport-cm-ajout-${L1}-carte`));
    await waitFor(() => expect(titres(L1)).toBe(4));
    expect(screen.getByTestId(`esport-cm-ajout-${L1}-titre`).props.value).toBe('');
  });

  it('Maj+Entrée ne crée rien ; Entrée sur un champ vide non plus ; Échap ferme le champ', async () => {
    const { client, appels } = serveur();
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    await fireEvent.press(await screen.findByTestId(`esport-cm-ajout-${L1}`));
    const champ = await screen.findByTestId(`esport-cm-ajout-${L1}-titre`);
    await fireEvent.changeText(champ, 'Titre');
    const maj = touche('Enter', true);
    await fireEvent(champ, 'keyPress', maj);
    expect(maj.preventDefault).not.toHaveBeenCalled();
    await fireEvent.changeText(champ, 'Titre\nsuite');
    expect(screen.queryByTestId(`esport-cm-ajout-${L1}-collage`)).toBeNull();
    await fireEvent.changeText(champ, '');
    await fireEvent(champ, 'keyPress', touche('Enter'));
    expect(appels.some(a => a.url === `/cm/tableaux/${T}/cartes`)).toBe(false);
    await fireEvent(champ, 'keyPress', touche('Escape'));
    expect(screen.queryByTestId(`esport-cm-ajout-${L1}-titre`)).toBeNull();
    expect(screen.getByTestId(`esport-cm-ajout-${L1}`)).toBeTruthy();
  });

  it('collage de plusieurs lignes : « Créer 3 cartes », une carte par ligne dans l’ordre', async () => {
    const { client, appels } = serveur();
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    await fireEvent.press(await screen.findByTestId(`esport-cm-ajout-${L2}`));
    const champ = await screen.findByTestId(`esport-cm-ajout-${L2}-titre`);
    await fireEvent.changeText(champ, 'Un\n\n  Deux  \nTrois\n');
    expect(screen.getByText('Créer 3 cartes')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`esport-cm-ajout-${L2}-carte`));
    expect(screen.getByText('Un')).toBeTruthy();
    expect(screen.getByText('Trois')).toBeTruthy();
    await waitFor(() => expect(appels.filter(a => a.url === `/cm/tableaux/${T}/cartes`)).toHaveLength(3));
    expect(appels.filter(a => a.url === `/cm/tableaux/${T}/cartes`).map(a => a.corps?.titre)).toEqual(['Un', 'Deux', 'Trois']);
    await waitFor(() => expect(titres(L2)).toBe(3));
    expect(screen.getByTestId(`esport-cm-ajout-${L2}-titre`).props.value).toBe('');
  });

  it('titresAjout : une carte, ou une par ligne non vide', () => {
    expect(titresAjout('  a  ', false)).toEqual(['a']);
    expect(titresAjout('a\n\nb\r\n c ', true)).toEqual(['a', 'b', 'c']);
    expect(titresAjout('   ', false)).toEqual([]);
    expect(titresAjout('x'.repeat(250), false)[0]).toHaveLength(200);
  });
});

describe('déplacer les colonnes', () => {
  const ordreAffiche = () => screen.getAllByTestId(/^esport-cm-liste-[0-9a-f-]+-entete$/).map(n => n.props.testID.replace('esport-cm-liste-', '').replace('-entete', '').slice(-1));

  it('menu ⋯ (clavier) : « Déplacer la colonne à droite » réordonne tout de suite et le serveur reçoit l’index', async () => {
    const { client, appels } = serveur();
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-liste-${L1}-cartes`);
    expect(ordreAffiche()).toEqual(['1', '2', '3']);
    expect(screen.getByTestId(`esport-cm-liste-${L1}-poignee`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`esport-cm-liste-${L1}-menu`));
    expect(screen.queryByTestId(`esport-cm-liste-${L1}-gauche`)).toBeNull();
    await fireEvent.press(await screen.findByTestId(`esport-cm-liste-${L1}-droite`));
    expect(ordreAffiche()).toEqual(['2', '1', '3']);
    await waitFor(() => expect(appels.some(a => a.url === `/cm/listes/${L1}/deplacer`)).toBe(true));
    expect(appels.find(a => a.url === `/cm/listes/${L1}/deplacer`)?.corps).toEqual({ index: 1 });
    await waitFor(() => expect(screen.getByTestId('esport-cm-annonce').props.children).toMatch(/Colonne Liste 1 déplacée en position 2 sur 3/));
    // Relu depuis le serveur : l'ordre persiste.
    await waitFor(() => expect(appels.filter(a => a.url === `/cm/tableaux/${T}`).length).toBeGreaterThan(1));
    expect(ordreAffiche()).toEqual(['2', '1', '3']);
    await fireEvent.press(screen.getByTestId(`esport-cm-liste-${L3}-menu`));
    expect(screen.queryByTestId(`esport-cm-liste-${L3}-droite`)).toBeNull();
    expect(await screen.findByTestId(`esport-cm-liste-${L3}-gauche`)).toBeTruthy();
  });

  it('changement fait ailleurs : la version du serveur monte, l’ordre des colonnes est relu', async () => {
    const { client } = serveur();
    const api = apiCm(client);
    const vue = await render(<Tableau theme={theme} api={api} id={T} large versionServeur={3} />);
    await screen.findByTestId(`esport-cm-liste-${L1}-cartes`);
    await api.deplacerListe(L3, 0);
    await vue.rerender(<Tableau theme={theme} api={api} id={T} large versionServeur={4} />);
    await waitFor(() => expect(ordreAffiche()).toEqual(['3', '1', '2']));
  });

  it('sans le droit de modifier : pas de poignée ni de déplacement', async () => {
    const { client } = serveur(false);
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-liste-${L1}-cartes`);
    expect(screen.queryByTestId(`esport-cm-liste-${L1}-poignee`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`esport-cm-liste-${L1}-menu`));
    expect(screen.queryByTestId(`esport-cm-liste-${L1}-droite`)).toBeNull();
  });

  it('indexColonneCible : rang parmi les autres colonnes, selon le centre et le défilement', () => {
    const r = [
      { id: 'a', x: 0, l: 100 },
      { id: 'b', x: 110, l: 100 },
      { id: 'c', x: 220, l: 100 },
    ];
    expect(indexColonneCible(r, 'a', 10)).toBe(0);
    expect(indexColonneCible(r, 'a', 200)).toBe(1);
    expect(indexColonneCible(r, 'a', 400)).toBe(2);
    expect(indexColonneCible(r, 'c', 10)).toBe(0);
    expect(indexColonneCible(r, 'c', 90)).toBe(1);
    // Le tableau a défilé de 100 px vers la droite depuis la mesure.
    expect(indexColonneCible(r, 'a', 100, 100)).toBe(1);
  });
});
