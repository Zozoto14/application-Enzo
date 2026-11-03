/**
 * Pastille rouge des commentaires non lus des cartes CM (docs/esport/cm.md, migration 0045), de l'écran au client HTTP :
 *  - carte, colonne, tableau (en-tête), « Tout marquer comme lu » ;
 *  - ouvrir la fiche relit la carte avec `?vu=1` (marquée lue par le serveur) ; les nouveaux commentaires sont mis en
 *    évidence sous un séparateur ; bouton « Suivre » ;
 *  - remontées : liste des tableaux, sous-onglet « Tableaux », groupe « Contenus » de la barre latérale (sans double
 *    comptage avec les nouveautés du Drive), tuile « CM du club » de Teams.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { clientEsport, oublierSessions, type ClientEsport } from './client';
import { apiCm, type CarteResume, type DetailTableau, type MoiCm, type ReponseCarte } from './cm/api';
import { phraseNotificationCm } from './cm/libelles';
import { definirLangue } from './i18n';
import { CadreEsport } from './ui/CadreEsport';
import { CarteCmClub } from './ui/RacineEsport';
import { EspaceCm, groupesCm } from './ui/cm/EspaceCm';
import { Tableau } from './ui/cm/Tableau';

const theme = themeHub('nuit');
const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const L1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const L2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const C1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const C2 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const C3 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';

const resume = (id: string, listeId: string, titre: string, extra: Partial<CarteResume> = {}): CarteResume => ({
  id,
  listeId,
  teamId: null,
  titre,
  description: false,
  position: 1024,
  couverture: null,
  echeance: null,
  echeanceFaite: false,
  datePublication: null,
  post: false,
  statut: null,
  reseaux: [],
  origine: 'manuel',
  depotGenre: null,
  etiquettes: [],
  membres: [],
  commentaires: 0,
  checklist: { total: 0, faits: 0 },
  pieces: 0,
  archive: false,
  version: 1,
  modifiable: true,
  ...extra,
});

function tableau(nonLus = 3): DetailTableau {
  return {
    tableau: { id: T, nom: 'Contenus', cleDefaut: null, portee: 'club', team: null, couleur: '#db2777', description: '', version: 3, archive: false, trello: false, majLe: '', fond: null },
    droits: { voir: true, deposer: true, editer: true, valider: true, gerer: true, commenter: true },
    moi: 'cm123456',
    nonLus,
    listes: [
      { id: L1, nom: 'Idées', cle: null, position: 1024, archive: false },
      { id: L2, nom: 'À valider', cle: null, position: 2048, archive: false },
    ],
    etiquettes: [],
    cartes: [
      resume(C1, L1, 'Annonce du tournoi', { commentaires: 3, nonLus: 2 }),
      resume(C2, L1, 'Recrutement', { position: 2048, commentaires: 1, nonLus: 1 }),
      resume(C3, L2, 'Carte lue', { commentaires: 2, nonLus: 0 }),
    ],
    noms: {},
    personnes: [{ compte: 'cm123456', pseudo: 'Clara' }],
  };
}

function reponseCarte(): ReponseCarte {
  return {
    carte: {
      id: C1,
      tableauId: T,
      listeId: L1,
      teamId: null,
      titre: 'Annonce du tournoi',
      description: '',
      position: 1024,
      couverture: null,
      echeance: null,
      echeanceFaite: false,
      datePublication: null,
      post: false,
      statut: null,
      reseaux: [],
      textes: {},
      liens: {},
      publications: {},
      soumisPar: null,
      soumisLe: null,
      validePar: null,
      valideLe: null,
      refusMotif: null,
      refusePar: null,
      publiePar: null,
      publieLe: null,
      origine: 'manuel',
      depotGenre: null,
      trello: false,
      archive: false,
      creePar: 'cm123456',
      creeLe: '2026-10-20T09:00:00.000Z',
      majLe: '',
      version: 1,
      etiquettes: [],
      membres: [],
      checklists: [],
      commentaires: [
        { id: 'k1', auteur: 'red12345', auteurNom: null, texte: 'Déjà lu', creeLe: '2026-10-20T10:00:00.000Z', majLe: '', trello: false, moi: false, nouveau: false },
        { id: 'k2', auteur: 'red12345', auteurNom: null, texte: 'Premier nouveau', creeLe: '2026-10-21T10:00:00.000Z', majLe: '', trello: false, moi: false, nouveau: true },
        { id: 'k3', auteur: 'cm123456', auteurNom: null, texte: 'Ma réponse', creeLe: '2026-10-21T11:00:00.000Z', majLe: '', trello: false, moi: true, nouveau: false },
        { id: 'k4', auteur: 'red12345', auteurNom: null, texte: 'Second nouveau', creeLe: '2026-10-21T12:00:00.000Z', majLe: '', trello: false, moi: false, nouveau: true },
      ],
      vuAvant: '2026-10-20T12:00:00.000Z',
      nonLus: 2,
      suivie: false,
      pieces: [],
      activite: [],
      clips: [],
      resumes: {},
    },
    droits: { voir: true, deposer: true, editer: true, valider: true, gerer: true, commenter: true, modifier: true },
    noms: { red12345: 'Remi', cm123456: 'Clara' },
    problemes: [],
  };
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

beforeEach(() => oublierSessions());
afterEach(() => definirLangue('fr'));

describe('pastille rouge des commentaires non lus', () => {
  it('carte, colonne et tableau portent leur nombre ; une colonne sans non lu n’a pas de pastille', async () => {
    const { client } = fauxServeur(a => (a.url.split('?')[0] === `/cm/tableaux/${T}` ? { corps: tableau() } : undefined));
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${C1}-tuile`);
    expect(screen.getByTestId(`esport-cm-carte-${C1}-nonlus`)).toHaveTextContent('2');
    expect(screen.getByTestId(`esport-cm-carte-${C2}-nonlus`)).toHaveTextContent('1');
    expect(screen.queryByTestId(`esport-cm-carte-${C3}-nonlus`)).toBeNull();
    expect(screen.getByLabelText('2 commentaires non lus')).toBeTruthy();
    // Colonne : somme de ses cartes ; tableau : total.
    expect(screen.getByTestId(`esport-cm-liste-${L1}-nonlus`)).toHaveTextContent('3');
    expect(screen.queryByTestId(`esport-cm-liste-${L2}-nonlus`)).toBeNull();
    expect(screen.getByTestId('esport-cm-tableau-nonlus')).toHaveTextContent('3');
  });

  it('« Tout marquer comme lu » : POST sur le tableau, puis le tableau est relu', async () => {
    let lu = false;
    const { client, appels } = fauxServeur(a => {
      const c = a.url.split('?')[0];
      if (c === `/cm/tableaux/${T}` && a.methode === 'GET') return { corps: lu ? { ...tableau(0), cartes: tableau().cartes.map(x => ({ ...x, nonLus: 0 })) } : tableau() };
      if (c === `/cm/tableaux/${T}/tout-vu`) {
        lu = true;
        return { corps: { ok: true } };
      }
      return undefined;
    });
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    await fireEvent.press(await screen.findByTestId('esport-cm-tableau-tout-lu'));
    await waitFor(() => expect(appels.some(a => a.url === `/cm/tableaux/${T}/tout-vu` && a.methode === 'POST')).toBe(true));
    await waitFor(() => expect(screen.queryByTestId('esport-cm-tableau-nonlus')).toBeNull());
    expect(screen.queryByTestId(`esport-cm-carte-${C1}-nonlus`)).toBeNull();
    expect(screen.queryByTestId('esport-cm-tableau-tout-lu')).toBeNull();
  });

  it('ouvrir la fiche : lecture avec ?vu=1, séparateur « Nouveaux » avant les commentaires des autres, « Suivre »', async () => {
    const { client, appels } = fauxServeur(a => {
      const c = a.url.split('?')[0];
      if (c === `/cm/tableaux/${T}`) return { corps: tableau() };
      if (c === `/cm/cartes/${C1}` && a.methode === 'GET') return { corps: reponseCarte() };
      if (c === `/cm/cartes/${C1}/suivre`) return { corps: { ok: true, suivie: true } };
      return undefined;
    });
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    await fireEvent.press(await screen.findByTestId(`esport-cm-carte-${C1}-tuile`));
    const panneau = await screen.findByTestId('esport-cm-fiche-commentaires');
    expect(appels.some(a => a.url === `/cm/cartes/${C1}?vu=1`)).toBe(true);
    // Le séparateur est UNIQUE (avant le premier nouveau) et annonce le nombre de nouveaux commentaires (hors les miens).
    expect(within(panneau).getAllByTestId('esport-cm-commentaires-nouveaux')).toHaveLength(1);
    expect(within(panneau).getByText('2 nouveaux commentaires')).toBeTruthy();
    expect(within(panneau).getByTestId('esport-cm-commentaire-k2').props.accessibilityLabel).toBe('Nouveaux');
    expect(within(panneau).getByTestId('esport-cm-commentaire-k4').props.accessibilityLabel).toBe('Nouveaux');
    expect(within(panneau).getByTestId('esport-cm-commentaire-k1').props.accessibilityLabel).toBeUndefined();
    expect(within(panneau).getByTestId('esport-cm-commentaire-k3').props.accessibilityLabel).toBeUndefined();
    // Des commentaires viennent d'être lus : le tableau est relu (les pastilles se mettent à jour).
    await waitFor(() => expect(appels.filter(a => a.url === `/cm/tableaux/${T}`).length).toBeGreaterThan(1));
    // Suivre la carte.
    await fireEvent.press(within(panneau).getByTestId('esport-cm-fiche-suivre'));
    await waitFor(() => expect(appels.some(a => a.url === `/cm/cartes/${C1}/suivre` && a.corps?.suivre === true)).toBe(true));
  });
});

describe('remontées de la pastille', () => {
  it('le groupe « Contenus » et le sous-onglet « Tableaux » portent les commentaires non lus, sans toucher au Drive', () => {
    const g = groupesCm({ voirCm: true, drive: true, sponsors: false, reunions: false, gerer: false, aValider: 2, nouveautesDrive: 5, commentairesNonLus: 4 });
    const contenus = g.find(x => x.id === 'contenus')!;
    expect(contenus.entrees.find(e => e.id === 'tableaux')?.compteur).toBe(4);
    expect(contenus.entrees.find(e => e.id === 'valider')?.compteur).toBe(2);
    expect(contenus.compteur).toBe(6);
    // Le Drive garde SES nouveautés : aucun double comptage.
    const drive = g.flatMap(x => x.entrees).find(e => e.id === 'drive');
    expect(drive?.compteur).toBe(5);
    expect(g.find(x => x.entrees.some(e => e.id === 'drive'))?.compteur).toBe(5);
    expect(groupesCm({ voirCm: true, drive: false, sponsors: false, reunions: false, gerer: false }).find(x => x.id === 'contenus')?.compteur).toBeUndefined();
  });

  const MOI: MoiCm = { espace: true, sponsors: [], club: ['cm.voir', 'cm.editer', 'cm.deposer', 'cm.drive.voir'], teams: [], gerer: false };
  const clientCm = (nonLus: { total: number; tableaux: Record<string, number> }) =>
    ({
      config: { adresse: 'https://esport.test', jetonRelais: 'x' },
      teams: async () => [],
      requete: async (chemin: string) => {
        const c = chemin.split('?')[0];
        if (c === '/cm/etat') return { versions: {}, aValider: 0, nonLus };
        if (c === '/cm/tableaux') return { tableaux: [{ id: T, nom: null, cleDefaut: 'contenus', portee: 'club', team: null, couleur: '#db2777', description: '', version: 1, archive: false, trello: false, majLe: '', cartes: 3, aValider: 0, nonLus: 0 }], portees: [] };
        if (c === '/cm/drive/nouveautes') return { total: 7, racine: 7, dossiers: {} };
        return { ok: true };
      },
    }) as unknown as ClientEsport;

  it('espace CM : pastille sur le groupe, le sous-onglet et le tableau de la liste (nombre de l’état, relu en temps réel)', async () => {
    await render(
      <ModeAffichageForce mode="large">
        <CadreEsport theme={theme} large onglet="teams" onOnglet={() => undefined}>
          <EspaceCm theme={theme} client={clientCm({ total: 4, tableaux: { [T]: 4 } })} large moi={MOI} ongletInitial="tableaux" />
        </CadreEsport>
      </ModeAffichageForce>,
    );
    expect(await screen.findByTestId('esport-cm-onglet-tableaux-pastille')).toHaveTextContent('4');
    expect(await screen.findByTestId('esport-cm-tableau-club-nonlus')).toHaveTextContent('4');
    expect(screen.getByLabelText('Contenus (4)')).toBeTruthy();
  });

  it('tuile « CM du club » : pastille des commentaires non lus à côté de « Contenus », nouveautés du Drive à part', async () => {
    const client = clientCm({ total: 4, tableaux: { [T]: 4 } });
    await render(<CarteCmClub theme={theme} moi={MOI} client={client} onOuvrir={() => undefined} />);
    expect(await screen.findByTestId('esport-teams-cm-commentaires')).toHaveTextContent('4');
    expect(await screen.findByTestId('esport-teams-cm-drive-nouveautes')).toHaveTextContent('7');
  });

  it('tuile « CM du club » : aucune pastille quand tout est lu', async () => {
    const client = clientCm({ total: 0, tableaux: {} });
    await render(<CarteCmClub theme={theme} moi={MOI} client={client} onOuvrir={() => undefined} />);
    await screen.findByTestId('esport-teams-cm-drive-nouveautes');
    expect(screen.queryByTestId('esport-teams-cm-commentaires')).toBeNull();
  });
});

describe('notification de commentaire (catégorie CM)', () => {
  it('phrase française et anglaise', () => {
    const nom = (id: unknown) => (id === 'red12345' ? 'Remi' : '?');
    expect(phraseNotificationCm('cm-commentaire', '', { titre: 'Annonce', membre: 'red12345' }, nom)).toBe('Remi a commenté « Annonce »');
    definirLangue('en');
    expect(phraseNotificationCm('cm-commentaire', '', { titre: 'Annonce', membre: 'red12345' }, nom)).toBe('Remi commented on “Annonce”');
  });
});
