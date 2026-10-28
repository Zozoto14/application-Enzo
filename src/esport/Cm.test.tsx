/**
 * Section CM côté app : onglet CM d'une team (section Équipe), pas d'entrée « CM » dans la navigation principale,
 * compteur de caractères par réseau, tableau (cartes, déplacement au clavier par le menu, filtres), fiche d'un post (textes FR / EN, compteur, circuit de validation), dépôt d'une
 * information, calendrier, phrases du journal et des notifications (FR / EN).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { CATALOGUE, type ClientEsport, type DetailTeam, type Notification } from './client';
import { apiCm, type DetailTableau, type ReponseCarte } from './cm/api';
import { analyserTexte, compterCaracteres, hashtags } from './cm/reseaux';
import { definirLangue } from './i18n';
import { phraseJournal, phraseNotification } from './libelles';
import { navEsport } from './ui/CadreEsport';
import { sectionsTeam } from './ui/PageTeam';
import { joursDe } from './ui/cm/Calendrier';
import { CmTeam } from './ui/cm/CmTeam';
import { Tableau, carteVisible, indexServeur } from './ui/cm/Tableau';

const theme = themeHub('nuit');
const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const L1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const L2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const C1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const C2 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const C3 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';

function detailTeam(permissions: string[], modules = ['planning', 'cm']): DetailTeam {
  return {
    team: { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
    modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: modules.includes(m.cle) })),
    membres: 6,
    moi: { membreId: 'm1', role: { id: 'r1', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, permissions, superAdmin: false },
  };
}

const carte = (id: string, listeId: string, titre: string, position: number, extra: Partial<DetailTableau['cartes'][number]> = {}): DetailTableau['cartes'][number] => ({
  id,
  listeId,
  teamId: null,
  titre,
  description: false,
  position,
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

function tableau(): DetailTableau {
  return {
    tableau: { id: T, nom: null, cleDefaut: 'contenus', portee: 'club', team: null, couleur: '#db2777', description: '', version: 3, archive: false, trello: false, majLe: '' },
    droits: { voir: true, deposer: true, editer: true, valider: true, gerer: true, commenter: true },
    moi: 'cm123456',
    listes: [
      { id: L1, nom: null, cle: 'idees', position: 1024, archive: false },
      { id: L2, nom: 'Sponsors', cle: null, position: 2048, archive: false },
    ],
    etiquettes: [{ id: 'e1', nom: 'Vidéo', couleur: '#4bce97' }],
    cartes: [
      carte(C1, L1, 'Annonce du tournoi', 1024, { post: true, statut: 'a_valider', reseaux: ['x', 'instagram'], etiquettes: ['e1'], commentaires: 2 }),
      carte(C2, L1, 'Recap de la semaine', 2048),
      carte(C3, L2, 'Contrat sponsor', 1024),
    ],
    noms: {},
    personnes: [{ compte: 'cm123456', pseudo: 'Clara' }],
  };
}

function reponseCarte(textes = { x: { fr: 'Ce soir on joue ! #GG', en: 'Tonight we play! #GG' } }): ReponseCarte {
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
      statut: 'a_valider',
      reseaux: ['x'],
      textes,
      liens: {},
      publications: {},
      soumisPar: 'red12345',
      soumisLe: '2026-10-20T10:00:00.000Z',
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
      creePar: 'red12345',
      creeLe: '2026-10-20T09:00:00.000Z',
      majLe: '',
      version: 4,
      etiquettes: [],
      membres: [],
      checklists: [],
      commentaires: [],
      pieces: [{ id: 'p1', genre: 'lien', nom: 'affiche.png', url: 'https://trello.com/1/cards/x/download/affiche.png', trello: true, fichier: null, creeLe: '' }],
      activite: [],
      clips: [],
      resumes: {},
    },
    droits: { voir: true, deposer: true, editer: true, valider: true, gerer: true, commenter: true, modifier: true },
    noms: { red12345: 'Remi' },
    problemes: [],
  };
}

function fauxClient() {
  const appels: Array<{ chemin: string; methode: string; corps?: unknown }> = [];
  const requete = async <R,>(chemin: string, methode = 'GET', corps?: unknown): Promise<R> => {
    appels.push({ chemin, methode, corps });
    const c = chemin.split('?')[0];
    if (/^\/cm\/tableaux\/[0-9a-f-]+$/.test(c)) return tableau() as R;
    if (/^\/cm\/cartes\/[0-9a-f-]+$/.test(c)) return reponseCarte() as R;
    if (/^\/cm\/cartes\/[0-9a-f-]+\/valider$/.test(c)) return { ...reponseCarte(), carte: { ...reponseCarte().carte, statut: 'valide' } } as R;
    if (/^\/cm\/teams\/t1$/.test(c)) return { team: { id: 't1', nom: 'Faucons', fuseau: 'Europe/Paris' }, permissions: ['cm.clips.proposer', 'cm.deposer', 'cm.voir'], tableaux: [{ id: T, nom: null, cleDefaut: 'contenus', couleur: '#db2777', version: 1 }], depots: [], noms: {}, genres: ['info', 'photo', 'actu', 'recrue', 'resultat', 'evenement', 'autre'] } as R;
    if (/^\/cm\/teams\/t1\/depots$/.test(c)) return { id: C2, tableauId: T } as R;
    if (/^\/cm\/etat$/.test(c)) return { versions: { [T]: 3 }, aValider: 1 } as R;
    return { ok: true } as R;
  };
  const client = { config: { adresse: 'https://esport.test', jetonRelais: 'x' }, requete } as unknown as ClientEsport;
  return { client, appels };
}

afterEach(() => definirLangue('fr'));

describe('section CM', () => {
  it('onglet CM rangé dans la section Équipe (pas de nouvelle section), seulement avec le module et un droit CM', () => {
    const equipe = (p: string[], modules?: string[]) => sectionsTeam(detailTeam(p, modules)).find(g => g.id === 'equipe')?.entrees.map(e => e.id) ?? [];
    expect(equipe(['members.view', 'cm.clips.proposer'])).toEqual(['module:cm', 'membres']);
    expect(equipe(['members.view'])).toEqual(['membres']);
    expect(equipe(['members.view', 'cm.clips.proposer'], ['planning'])).toEqual(['membres']);
    expect(sectionsTeam(detailTeam(['members.view', 'cm.clips.proposer'])).map(g => g.id)).toEqual(['accueil', 'equipe', 'reglages']);
    // Téléphone : toujours dans « Équipe », aucune section de plus dans la barre du bas.
    expect(sectionsTeam(detailTeam(['members.view', 'cm.clips.proposer']), false).find(g => g.id === 'equipe')?.entrees.map(e => e.id)).toEqual(['module:cm', 'membres']);
  });

  it('navigation : plus d’entrée « CM » de premier niveau (l’espace CM du club est dans Teams : NavCm.test.tsx)', () => {
    expect(navEsport(false, false).map(n => n.cle)).toEqual(['dashboard', 'teams', 'membres']);
    expect(navEsport(true, true).map(n => n.cle)).toEqual(['dashboard', 'teams', 'membres', 'jeux', 'statistiques']);
  });

  it('compteur de caractères : X pondéré (adresses à 23, emoji à 2), Instagram en caractères ; hashtags', () => {
    expect(compterCaracteres('Voir https://site-exemple.fr/une/adresse/tres/longue', 'x')).toBe(5 + 23);
    expect(compterCaracteres('GG 🎉', 'x')).toBe(5);
    expect(compterCaracteres('GG 🎉', 'instagram')).toBe(4);
    expect(analyserTexte('a'.repeat(281), 'x').tropLong).toBe(true);
    expect(analyserTexte('a'.repeat(281), 'tiktok').tropLong).toBe(false);
    expect(hashtags('#GG #gg #Esport')).toEqual(['GG', 'Esport']);
  });

  it('filtres et position envoyée au serveur (parmi toutes les cartes de la liste, même filtrées)', () => {
    const t = tableau();
    const filtres = { q: 'recap', etiquettes: [], membres: [], echeance: 'toutes' as const, type: 'tout' as const, statut: '' as const };
    expect(t.cartes.filter(c => carteVisible(c, filtres, Date.now(), {})).map(c => c.id)).toEqual([C2]);
    expect(t.cartes.filter(c => carteVisible(c, { ...filtres, q: '', type: 'posts' }, Date.now(), {})).map(c => c.id)).toEqual([C1]);
    const toutes = [t.cartes[0], t.cartes[1], t.cartes[2]];
    expect(indexServeur(toutes, [t.cartes[2]], 0)).toBe(2);
    expect(indexServeur(toutes, [t.cartes[0]], 1)).toBe(1);
    expect(indexServeur(toutes, [], 0)).toBe(3);
  });

  it('tableau : listes et cartes (statut, réseaux, étiquettes, compteurs), déplacement au clavier par le menu de la carte', async () => {
    const { client, appels } = fauxClient();
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    expect(await screen.findByTestId(`esport-cm-carte-${C1}`)).toBeTruthy();
    expect(screen.getByTestId('esport-cm-tableau-nom').props.children).toBe('Contenus');
    expect(screen.getByText('Idées')).toBeTruthy();
    expect(screen.getByText('Sponsors')).toBeTruthy();
    expect(screen.getByTestId(`esport-cm-carte-${C1}-statut`)).toBeTruthy();
    expect(screen.getByLabelText('2 commentaires')).toBeTruthy();
    // Clavier : menu « ⋯ » › Descendre (index 1 parmi les cartes de la liste, sans elle).
    await fireEvent.press(screen.getByTestId(`esport-cm-carte-${C1}-menu`));
    await fireEvent.press(await screen.findByTestId(`esport-cm-carte-${C1}-descendre`));
    await waitFor(() => expect(appels.some(a => a.chemin.endsWith(`/cm/cartes/${C1}/deplacer`))).toBe(true));
    expect(appels.find(a => a.chemin.endsWith(`/cm/cartes/${C1}/deplacer`))?.corps).toEqual({ listeId: L1, index: 1 });
    // Liste suivante : en bas de « Sponsors ».
    await fireEvent.press(screen.getByTestId(`esport-cm-carte-${C2}-menu`));
    await fireEvent.press(await screen.findByTestId(`esport-cm-carte-${C2}-droite`));
    await waitFor(() => expect(appels.some(a => a.chemin.endsWith(`/cm/cartes/${C2}/deplacer`))).toBe(true));
    expect(appels.find(a => a.chemin.endsWith(`/cm/cartes/${C2}/deplacer`))?.corps).toEqual({ listeId: L2, index: 1 });
  });

  it('fiche d’un post : textes FR / EN et compteur, pièce Trello expliquée, validation avec la version lue', async () => {
    const { client, appels } = fauxClient();
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    await fireEvent.press(await screen.findByTestId(`esport-cm-carte-${C1}-tuile`));
    expect(await screen.findByTestId('esport-cm-post')).toBeTruthy();
    expect(screen.getByTestId('esport-cm-post-x-fr-compteur').props.children).toBe('21 / 280 · #1');
    await fireEvent.changeText(screen.getByTestId('esport-cm-post-x-fr'), 'a'.repeat(290));
    expect(screen.getByTestId('esport-cm-post-x-fr-compteur').props.children).toBe('290 / 280');
    expect(screen.getByTestId('esport-cm-pieces-trello')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-cm-circuit-valider'));
    await waitFor(() => expect(appels.some(a => a.chemin.endsWith('/valider'))).toBe(true));
    expect(appels.find(a => a.chemin.endsWith('/valider'))?.corps).toEqual({ versionAttendue: 4 });
  });

  it('onglet CM de la team : dépôt d’une information par le correspondant', async () => {
    const { client, appels } = fauxClient();
    await render(<CmTeam theme={theme} client={client} detail={detailTeam(['cm.voir', 'cm.deposer', 'cm.clips.proposer'])} large onAller={() => undefined} />);
    await fireEvent.press(await screen.findByTestId('esport-cm-depot-genre-recrue'));
    await fireEvent.changeText(screen.getByTestId('esport-cm-depot-titre'), 'Nouvelle recrue');
    await fireEvent.changeText(screen.getByTestId('esport-cm-depot-liens'), 'https://site-exemple.fr/photo');
    await fireEvent.press(screen.getByTestId('esport-cm-depot-envoyer'));
    await waitFor(() => expect(appels.some(a => a.chemin === '/cm/teams/t1/depots')).toBe(true));
    expect(appels.find(a => a.chemin === '/cm/teams/t1/depots')?.corps).toMatchObject({ genre: 'recrue', titre: 'Nouvelle recrue', liens: ['https://site-exemple.fr/photo'], envois: [] });
    expect(await screen.findByTestId('esport-cm-depot-avis')).toBeTruthy();
  });

  it('calendrier : semaine du lundi au dimanche, mois en semaines entières', () => {
    const ref = Date.parse('2026-11-04T12:00:00Z');
    expect(joursDe('semaine', ref)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
    const mois = joursDe('mois', ref);
    expect([mois[0], mois[mois.length - 1], mois.length % 7]).toEqual(['2026-10-26', '2026-12-06', 0]);
  });

  it('journal et notifications de la section CM, en français et en anglais', () => {
    const e = { id: '1', acteur: 'cm123456', action: 'cm.post_valide', module: 'cm', entite: 'cm_carte', entiteId: C1, meta: { titre: 'Annonce' }, date: '' };
    const noms = { cm123456: 'Clara' };
    expect(phraseJournal(e as never, noms)).toBe('Clara a validé le post « Annonce »');
    const n = (type: string, charge: Record<string, unknown>): Notification => ({ id: '1', type, team: { id: 't1', nom: 'Faucons' }, charge, lue: false, date: '' }) as Notification;
    expect(phraseNotification(n('cm-refuse', { titre: 'Annonce', motif: 'Mauvaise date' }), noms)).toBe('Votre post « Annonce » est refusé : Mauvaise date');
    expect(phraseNotification(n('cm-clip-propose', { titre: 'Ace', membre: 'cm123456' }), noms)).toBe('Clara a proposé un clip (Faucons) : « Ace »');
    definirLangue('en');
    expect(phraseJournal(e as never, noms)).toBe('Clara approved the post “Annonce”');
    expect(phraseNotification(n('cm-a-valider', { titre: 'Annonce', invalide: true }), noms)).toBe('Post changed after approval, to approve again: “Annonce”');
  });
});
