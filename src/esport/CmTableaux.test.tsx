/**
 * Tableaux CM façon Trello (docs/esport/cm.md, migration 0042), de l'écran au client HTTP :
 *  - BUG d'enregistrement : une saisie du post n'est plus effacée quand la carte est relue (autre action de la
 *    fiche, autre personne) ; « Enregistrer le post » part en POST + X-Methode: PATCH (frontal o2switch) avec la
 *    version lue ; conflit 409 sans changement du contenu : renvoyé avec la nouvelle version ; message près du bouton ;
 *  - structure : défilement vertical DANS chaque colonne (en-tête fixe avec le nombre de cartes, « + Ajouter une
 *    carte » hors de la zone qui défile), colonne réduite (bande verticale, choix mémorisé en base) ;
 *  - cartes compactes : titre seul, la carte ne grandit qu'avec des informations à montrer ;
 *  - fond du tableau (voile sombre) ; calendriers des teams superposés (interrupteurs mémorisés, détail, post).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { clientEsport, oublierSessions, type ClientEsport } from './client';
import { apiCm, type CarteResume, type DetailTableau, type ReponseCarte } from './cm/api';
import { definirLangue } from './i18n';
import { Calendrier, joursEvenement } from './ui/cm/Calendrier';
import { Tableau, carteAInfos } from './ui/cm/Tableau';

const theme = themeHub('nuit');
const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const L1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const L2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const C1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const C2 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const TEAM = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

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

function tableau(fond: DetailTableau['tableau']['fond'] = null): DetailTableau {
  return {
    tableau: { id: T, nom: 'Ligne zéro ALL', cleDefaut: null, portee: 'club', team: null, couleur: '#db2777', description: '', version: 3, archive: false, trello: true, majLe: '', fond },
    droits: { voir: true, deposer: true, editer: true, valider: true, gerer: true, commenter: true },
    moi: 'cm123456',
    listes: [
      { id: L1, nom: 'The Nuke End', cle: null, position: 1024, archive: false },
      { id: L2, nom: 'Valorant', cle: null, position: 2048, archive: false },
    ],
    etiquettes: [{ id: 'e1', nom: 'Vidéo', couleur: '#4bce97', cartes: 1 }],
    cartes: [
      resume(C1, L1, 'Annonce du tournoi', { post: true, statut: 'brouillon', reseaux: ['x'], version: 4 }),
      resume(C2, L1, 'Carte toute simple', { position: 2048 }),
      ...Array.from({ length: 15 }, (_, i) => resume(`eeeeeeee-eeee-4eee-8eee-${String(i).padStart(12, '0')}`, L1, `Carte ${i + 3}`, { position: 4096 + i })),
    ],
    noms: {},
    personnes: [{ compte: 'cm123456', pseudo: 'Clara' }],
  };
}

function reponseCarte(version = 4, textes = { x: { fr: 'Bonjour', en: 'Hello' } }, etiquettes: string[] = []): ReponseCarte {
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
      post: true,
      statut: 'brouillon',
      reseaux: ['x'],
      textes,
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
      trello: true,
      archive: false,
      creePar: 'cm123456',
      creeLe: '2026-10-20T09:00:00.000Z',
      majLe: '',
      version,
      etiquettes,
      membres: [],
      checklists: [],
      commentaires: [],
      pieces: [],
      activite: [],
      clips: [],
      resumes: {},
    },
    droits: { voir: true, deposer: true, editer: true, valider: true, gerer: true, commenter: true, modifier: true },
    noms: {},
    problemes: [],
  };
}

interface Appel {
  url: string;
  methode: string;
  xMethode?: string;
  corps?: Record<string, unknown>;
}

/** Vrai client Esport (src/esport/client.ts) sur un faux serveur qui annonce « surcharge-methode » (o2switch). */
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

describe('tableaux CM façon Trello', () => {
  it('BUG enregistrement : le texte du post reste après une autre action de la fiche, et part en POST + X-Methode: PATCH', async () => {
    let version = 4;
    const { client, appels } = fauxServeur(a => {
      const c = a.url.split('?')[0];
      if (c === `/cm/tableaux/${T}`) return { corps: tableau() };
      if (c === `/cm/cartes/${C1}` && a.methode === 'GET') return { corps: reponseCarte(version) };
      // Une étiquette ajoutée : la carte relue (nouvel objet, nouvelle version), textes du serveur inchangés.
      if (c === `/cm/cartes/${C1}` && a.xMethode === 'PATCH' && a.corps?.etiquettes) {
        version += 1;
        return { corps: reponseCarte(version, undefined, ['e1']) };
      }
      if (c === `/cm/cartes/${C1}` && a.xMethode === 'PATCH' && a.corps?.textes) {
        version += 1;
        return { corps: reponseCarte(version, a.corps.textes as { x: { fr: string; en: string } }, ['e1']) };
      }
      return undefined;
    });
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    await fireEvent.press(await screen.findByTestId(`esport-cm-carte-${C1}-tuile`));
    await fireEvent.changeText(await screen.findByTestId('esport-cm-post-x-fr'), 'Bonjour à tous');
    expect(screen.getByTestId('esport-cm-post-enregistrer')).toBeTruthy();
    // Autre action AVANT d'enregistrer : la carte est relue…
    await fireEvent.press(screen.getByTestId('esport-cm-fiche-etiquette-e1'));
    await waitFor(() => expect(appels.some(a => a.corps?.etiquettes)).toBe(true));
    await waitFor(() => expect(screen.getByTestId('esport-cm-fiche-etiquette-e1').props.accessibilityState.checked).toBe(true));
    // …et la saisie est toujours là, avec son bouton (avant : effacée, plus rien à enregistrer).
    expect(screen.getByTestId('esport-cm-post-x-fr').props.value).toBe('Bonjour à tous');
    await fireEvent.press(screen.getByTestId('esport-cm-post-enregistrer'));
    await waitFor(() => expect(appels.some(a => a.corps?.textes)).toBe(true));
    const envoi = appels.find(a => a.corps?.textes)!;
    expect([envoi.methode, envoi.xMethode]).toEqual(['POST', 'PATCH']);
    expect(envoi.corps).toMatchObject({ textes: { x: { fr: 'Bonjour à tous', en: 'Hello' } }, versionAttendue: 5 });
    // « Enregistré » s'affiche dans le bloc du post, près du bouton.
    expect(await screen.findByTestId('esport-cm-fiche-post-avis')).toBeTruthy();
    expect(screen.queryByTestId('esport-cm-post-enregistrer')).toBeNull();
  });

  it('conflit de version (409) sans changement du contenu du post : renvoyé avec la nouvelle version', async () => {
    const { client, appels } = fauxServeur(a => {
      const c = a.url.split('?')[0];
      if (c === `/cm/tableaux/${T}`) return { corps: tableau() };
      // Lu en version 4 ; entre-temps quelqu'un a coché une checklist (version 9, mêmes textes).
      if (c === `/cm/cartes/${C1}` && a.methode === 'GET') return { corps: reponseCarte(appels.some(x => x.xMethode === 'PATCH') ? 9 : 4) };
      if (c === `/cm/cartes/${C1}` && a.xMethode === 'PATCH') {
        if (a.corps?.versionAttendue !== 9) return { status: 409, corps: { erreur: 'Cette carte a été modifiée entre-temps : rechargez-la.', code: 'modifiee-entre-temps' } };
        return { corps: reponseCarte(10, a.corps.textes as { x: { fr: string; en: string } }) };
      }
      return undefined;
    });
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    await fireEvent.press(await screen.findByTestId(`esport-cm-carte-${C1}-tuile`));
    await fireEvent.changeText(await screen.findByTestId('esport-cm-post-x-fr'), 'Nouveau texte');
    await fireEvent.press(screen.getByTestId('esport-cm-post-enregistrer'));
    await waitFor(() => expect(appels.filter(a => a.xMethode === 'PATCH').map(a => a.corps?.versionAttendue)).toEqual([4, 9]));
    expect(await screen.findByTestId('esport-cm-fiche-post-avis')).toBeTruthy();
  });

  it('conflit de version (409) avec d’autres textes sur le serveur : la saisie reste, message près du bouton', async () => {
    const { client, appels } = fauxServeur(a => {
      const c = a.url.split('?')[0];
      if (c === `/cm/tableaux/${T}`) return { corps: tableau() };
      const apres = appels.some(x => x.xMethode === 'PATCH');
      if (c === `/cm/cartes/${C1}` && a.methode === 'GET') return { corps: reponseCarte(apres ? 11 : 4, apres ? { x: { fr: 'Changé ailleurs', en: 'Hello' } } : undefined) };
      if (c === `/cm/cartes/${C1}` && a.xMethode === 'PATCH') return { status: 409, corps: { erreur: 'Cette carte a été modifiée entre-temps : rechargez-la.', code: 'modifiee-entre-temps' } };
      return undefined;
    });
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    await fireEvent.press(await screen.findByTestId(`esport-cm-carte-${C1}-tuile`));
    await fireEvent.changeText(await screen.findByTestId('esport-cm-post-x-fr'), 'Ma version');
    await fireEvent.press(screen.getByTestId('esport-cm-post-enregistrer'));
    expect(await screen.findByTestId('esport-cm-fiche-post-erreur')).toBeTruthy();
    expect(screen.getByText(/vos textes sont gardés/)).toBeTruthy();
    expect(screen.getByTestId('esport-cm-post-x-fr').props.value).toBe('Ma version');
    expect(appels.filter(a => a.xMethode === 'PATCH')).toHaveLength(1);
  });

  it('structure : chaque colonne défile seule (en-tête fixe, compteur, « + Ajouter une carte » hors défilement), réduire = bande mémorisée en base', async () => {
    const { client, appels } = fauxServeur(a => {
      const c = a.url.split('?')[0];
      if (c === `/cm/tableaux/${T}`) return { corps: tableau() };
      if (c === '/cm/preferences' && a.methode === 'GET') return { corps: { preferences: {} } };
      return undefined;
    });
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    const colonne = await screen.findByTestId(`esport-cm-liste-${L1}-cartes`);
    // Les 17 cartes sont DANS la zone qui défile ; l'en-tête et « + Ajouter une carte » n'y sont pas.
    expect(within(colonne).getAllByTestId(/^esport-cm-carte-[0-9a-f-]+-tuile$/)).toHaveLength(17);
    expect(within(colonne).queryByTestId(`esport-cm-ajout-${L1}`)).toBeNull();
    expect(within(colonne).queryByTestId(`esport-cm-liste-${L1}-entete`)).toBeNull();
    expect(screen.getByTestId(`esport-cm-ajout-${L1}`)).toBeTruthy();
    expect(screen.getByTestId(`esport-cm-liste-${L1}-compteur`).props.children).toBe('17');
    // Réduire : bande verticale (bouton « agrandir » avec le nom et le nombre), choix envoyé (PUT → POST + X-Methode).
    await fireEvent.press(screen.getByTestId(`esport-cm-liste-${L1}-reduire`));
    expect(screen.queryByTestId(`esport-cm-liste-${L1}-cartes`)).toBeNull();
    expect(screen.getByLabelText('Agrandir la liste The Nuke End (17 cartes)')).toBeTruthy();
    await waitFor(() => expect(appels.some(a => a.url === `/cm/preferences/tableau.${T}.reduites`)).toBe(true));
    const pref = appels.find(a => a.url === `/cm/preferences/tableau.${T}.reduites`)!;
    expect([pref.methode, pref.xMethode, pref.corps]).toEqual(['POST', 'PUT', { valeur: [L1] }]);
    await fireEvent.press(screen.getByLabelText('Agrandir la liste The Nuke End (17 cartes)'));
    expect(await screen.findByTestId(`esport-cm-liste-${L1}-cartes`)).toBeTruthy();
  });

  it('colonnes réduites relues depuis les préférences du compte', async () => {
    const { client } = fauxServeur(a => {
      const c = a.url.split('?')[0];
      if (c === `/cm/tableaux/${T}`) return { corps: tableau() };
      if (c === '/cm/preferences') return { corps: { preferences: { [`tableau.${T}.reduites`]: [L2] } } };
      return undefined;
    });
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-liste-${L1}-cartes`);
    await waitFor(() => expect(screen.queryByTestId(`esport-cm-liste-${L2}-cartes`)).toBeNull());
    expect(screen.getByLabelText('Agrandir la liste Valorant (0 cartes)')).toBeTruthy();
  });

  it('cartes compactes : titre seul par défaut ; elles grandissent seulement avec des informations', async () => {
    expect(carteAInfos(resume(C2, L1, 'x'))).toBe(false);
    for (const extra of [{ description: true }, { commentaires: 2 }, { checklist: { total: 3, faits: 1 } }, { pieces: 1 }, { membres: ['cm123456'] }, { echeance: '2026-12-01T10:00:00.000Z' }, { post: true }]) {
      expect(carteAInfos(resume(C2, L1, 'x', extra as Partial<CarteResume>))).toBe(true);
    }
    // Étiquettes et couverture : au-dessus du titre, sans ligne d'informations.
    expect(carteAInfos(resume(C2, L1, 'x', { etiquettes: ['e1'], couverture: { couleur: '#4bce97' } }))).toBe(false);
    const d = tableau();
    d.cartes[1] = { ...d.cartes[1], etiquettes: ['e1'], description: true, membres: ['cm123456'] };
    const { client } = fauxServeur(a => (a.url.split('?')[0] === `/cm/tableaux/${T}` ? { corps: d } : undefined));
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${C2}`);
    expect(screen.getByTestId(`esport-cm-carte-${C2}-etiquettes`)).toBeTruthy();
    expect(screen.getByTestId(`esport-cm-carte-${C2}-description`)).toBeTruthy();
    expect(screen.getByTestId(`esport-cm-carte-${C2}-membres`)).toBeTruthy();
    const simple = d.cartes[2].id;
    expect(screen.queryByTestId(`esport-cm-carte-${simple}-infos`)).toBeNull();
    expect(screen.queryByTestId(`esport-cm-carte-${simple}-etiquettes`)).toBeNull();
  });

  it('fond : dégradé choisi (PATCH en POST + X-Methode), voile sombre derrière les colonnes', async () => {
    let fond: DetailTableau['tableau']['fond'] = null;
    const { client, appels } = fauxServeur(a => {
      const c = a.url.split('?')[0];
      if (c === `/cm/tableaux/${T}` && a.xMethode === 'PATCH') {
        fond = a.corps?.fond as typeof fond;
        return { corps: tableau(fond) };
      }
      if (c === `/cm/tableaux/${T}`) return { corps: tableau(fond) };
      return undefined;
    });
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${C1}`);
    expect(screen.queryByTestId('esport-cm-voile')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-cm-tableau-menu'));
    await fireEvent.press(await screen.findByTestId('esport-cm-tableau-fond'));
    await fireEvent.press(await screen.findByTestId('esport-cm-fond-degrade-ocean'));
    await waitFor(() => expect(appels.some(a => a.xMethode === 'PATCH' && a.url === `/cm/tableaux/${T}`)).toBe(true));
    expect(appels.find(a => a.xMethode === 'PATCH')?.corps).toEqual({ fond: { genre: 'degrade', cle: 'ocean' } });
    expect(await screen.findByTestId('esport-cm-voile')).toBeTruthy();
  });

  it('calendrier : calendriers des teams superposés (interrupteur mémorisé), détail en lecture seule, « Créer un post »', async () => {
    const ouverts: string[] = [];
    const { client, appels } = fauxServeur(a => {
      const c = a.url.split('?')[0];
      if (c === '/cm/calendrier') return { corps: { cartes: [] } };
      if (c === '/cm/preferences') return { corps: { preferences: {} } };
      if (c === '/cm/calendrier/teams')
        return {
          corps: {
            teams: [
              { id: TEAM, nom: 'Faucons', couleur: '#579dff', acces: 'competition', evenements: [{ id: 'match:m1', genre: 'match', type: 'match', titre: 'Coupe · Quart de finale · Nova', debut: '2026-11-04T19:00:00.000Z', fin: null, lieu: '', description: '', matchId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', tournoiId: 'ffffffff-ffff-4fff-8fff-fffffffffff1', publiable: true }] },
            ],
          },
        };
      if (c === '/cm/tableaux' && a.methode === 'GET') return { corps: { tableaux: [{ ...tableau().tableau, cleDefaut: 'contenus', droits: tableau().droits }], portees: [] } };
      if (c === `/cm/tableaux/${T}`) return { corps: tableau() };
      if (c.startsWith(`/cm/teams/${TEAM}/resume`)) return { corps: { textes: { x: { fr: 'Ce soir', en: 'Tonight' } }, liens: { teamId: TEAM, matchId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' } } };
      if (c === `/cm/tableaux/${T}/cartes`) return { corps: reponseCarte() };
      return undefined;
    });
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'setInterval'] });
    jest.setSystemTime(new Date('2026-11-03T10:00:00.000Z'));
    try {
      await render(<Calendrier theme={theme} api={apiCm(client)} large creerPost onOuvrirTableau={id => ouverts.push(id)} />);
      const ev = await screen.findByTestId(`esport-cm-calendrier-ev-${TEAM}-match:m1`);
      expect(ev).toBeTruthy();
      expect(screen.getByText('publiable')).toBeTruthy();
      // Masquer la team : l'événement disparaît, le choix est enregistré pour le compte.
      await fireEvent.press(screen.getByTestId(`esport-cm-calendrier-team-${TEAM}`));
      expect(screen.queryByTestId(`esport-cm-calendrier-ev-${TEAM}-match:m1`)).toBeNull();
      await waitFor(() => expect(appels.some(a => a.url === '/cm/preferences/calendrier.teams')).toBe(true));
      expect(appels.find(a => a.url === '/cm/preferences/calendrier.teams')?.corps).toEqual({ valeur: { [TEAM]: false } });
      await fireEvent.press(screen.getByTestId(`esport-cm-calendrier-team-${TEAM}`));
      await fireEvent.press(await screen.findByTestId(`esport-cm-calendrier-ev-${TEAM}-match:m1`));
      expect(await screen.findByTestId('esport-cm-calendrier-detail')).toBeTruthy();
      expect(screen.getByText(/seul ce qui peut être annoncé/)).toBeTruthy();
      await fireEvent.press(screen.getByTestId('esport-cm-calendrier-creer-post'));
      await waitFor(() => expect(ouverts).toEqual([T]));
      const creation = appels.find(a => a.url === `/cm/tableaux/${T}/cartes`)!;
      expect(creation.corps).toMatchObject({ listeId: L1, post: true, datePublication: '2026-11-04T19:00:00.000Z', textes: { x: { fr: 'Ce soir', en: 'Tonight' } }, teamId: TEAM });
      expect((creation.corps?.liens as Record<string, string>).matchId).toBe('ffffffff-ffff-4fff-8fff-ffffffffffff');
    } finally {
      jest.useRealTimers();
    }
  });

  it('calendrier : sans droit de préparer des posts, pas de bouton ; tournoi sur plusieurs jours', async () => {
    expect(joursEvenement({ debut: '2026-11-07T00:00:00.000Z', fin: '2026-11-09T23:59:00.000Z', jour: true })).toEqual(['2026-11-07', '2026-11-08', '2026-11-09']);
    expect(joursEvenement({ debut: '2026-11-04T23:30:00.000Z', fin: null })).toEqual(['2026-11-05']);
    const { client } = fauxServeur(a => {
      const c = a.url.split('?')[0];
      if (c === '/cm/calendrier') return { corps: { cartes: [] } };
      if (c === '/cm/calendrier/teams') return { corps: { teams: [{ id: TEAM, nom: 'Faucons', couleur: '#579dff', acces: 'planning', evenements: [{ id: 'e:1', genre: 'planning', type: 'scrim', titre: 'Scrim', debut: new Date().toISOString(), fin: null, lieu: 'Serveur', description: '', matchId: null, tournoiId: null, publiable: false }] }] } };
      return undefined;
    });
    await render(<Calendrier theme={theme} api={apiCm(client)} large={false} onOuvrirTableau={() => undefined} />);
    await fireEvent.press(await screen.findByTestId(`esport-cm-calendrier-ev-${TEAM}-e:1`));
    expect(await screen.findByText('Lieu : Serveur')).toBeTruthy();
    expect(screen.queryByTestId('esport-cm-calendrier-creer-post')).toBeNull();
  });
});
