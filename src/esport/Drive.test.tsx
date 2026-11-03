/**
 * Drive de la section CM côté app : règles pures (tri, lien interne, durée), écran du Drive (dossiers par
 * défaut traduits, fil d'Ariane, recherche, lien interne collé, corbeille), dépôt des joueurs (leur seul
 * dossier), onglet Drive d'une team, pièce jointe d'une carte choisie dans le Drive, phrases du journal et
 * de la notification d'espace (FR / EN).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { CATALOGUE, type ClientEsport, type DetailTeam, type Notification } from './client';
import { apiCm, type DetailTableau, type ReponseCarte } from './cm/api';
import { descendantsDe, dureeLisible, groupesAnnulation, lireLienDrive, refusDeplacement, trierFichiers, type ContenuDrive, type FichierDrive } from './cm/drive';
import { definirLangue } from './i18n';
import { phraseJournal, phraseNotification } from './libelles';
import { CmTeam } from './ui/cm/CmTeam';
import { Tableau } from './ui/cm/Tableau';
import { Drive } from './ui/cm/drive/Drive';
import { CarteCmClub } from './ui/RacineEsport';

const theme = themeHub('nuit');
const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const L1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const C1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const D_LOGOS = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const D_DEPOT = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
const F1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const F2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';

const fichier = (id: string, nom: string, extra: Partial<FichierDrive> = {}): FichierDrive => ({
  id,
  portee: 'club',
  dossierId: null,
  nom,
  genre: 'image',
  type: 'image/png',
  taille: 2048,
  version: 1,
  meta: { format: 'png', nomFormat: 'PNG', largeur: 1080, hauteur: 1080, duree: null, codecVideo: null, codecAudio: null },
  tags: [],
  favori: false,
  origine: 'envoi',
  creePar: 'cm123456',
  creeLe: '2026-10-20T10:00:00.000Z',
  majPar: 'cm123456',
  majLe: '2026-10-20T10:00:00.000Z',
  vignette: null,
  modifiable: true,
  ...extra,
});

const quota = { utilise: 17_000, enCours: 0, limite: 20_000, pourcent: 85, alerte: true, fichierMax: 2 * 1024 ** 3, zipMax: 2 * 1024 ** 3 };
const droitsCm = { voir: true, envoyer: true, gerer: true, depot: false };

function racine(dossier: string | null): ContenuDrive {
  if (dossier === D_LOGOS) {
    return { portee: 'club', team: null, droits: droitsCm, dossier: { id: D_LOGOS, portee: 'club', parentId: null, nom: null, cle: 'logos', restreint: false, fichiers: 1, favori: false, creePar: null, creeLe: '', majLe: '', modifiable: true, systeme: true }, chemin: [{ id: D_LOGOS, nom: null, cle: 'logos' }], dossiers: [], fichiers: [fichier(F2, 'blason.png', { dossierId: D_LOGOS })], noms: { cm123456: 'Clara' }, tronque: false, quota };
  }
  return {
    portee: 'club',
    team: null,
    droits: droitsCm,
    dossier: null,
    chemin: [],
    dossiers: [{ id: D_LOGOS, portee: 'club', parentId: null, nom: null, cle: 'logos', restreint: false, fichiers: 1, favori: false, creePar: null, creeLe: '', majLe: '', modifiable: true, systeme: true }],
    fichiers: [fichier(F1, 'affiche.png', { tags: ['saison'] })],
    noms: { cm123456: 'Clara' },
    tronque: false,
    quota,
    nouveautes: { total: 2, racine: 0, dossiers: { [D_LOGOS]: 2 } },
  };
}

function tableau(): DetailTableau {
  return {
    tableau: { id: T, nom: null, cleDefaut: 'contenus', portee: 'club', team: null, couleur: '#db2777', description: '', version: 3, archive: false, trello: false, majLe: '' },
    droits: { voir: true, deposer: true, editer: true, valider: true, gerer: true, commenter: true },
    moi: 'cm123456',
    listes: [{ id: L1, nom: null, cle: 'idees', position: 1024, archive: false }],
    etiquettes: [],
    cartes: [{ id: C1, listeId: L1, teamId: null, titre: 'Annonce', description: false, position: 1024, couverture: null, echeance: null, echeanceFaite: false, datePublication: null, post: false, statut: null, reseaux: [], origine: 'manuel', depotGenre: null, etiquettes: [], membres: [], commentaires: 0, checklist: { total: 0, faits: 0 }, pieces: 0, archive: false, version: 1, modifiable: true }],
    noms: {},
    personnes: [],
  };
}

function reponseCarte(): ReponseCarte {
  return {
    carte: { id: C1, tableauId: T, listeId: L1, teamId: null, titre: 'Annonce', description: '', position: 1024, couverture: null, echeance: null, echeanceFaite: false, datePublication: null, post: false, statut: null, reseaux: [], textes: {}, liens: {}, publications: {}, soumisPar: null, soumisLe: null, validePar: null, valideLe: null, refusMotif: null, refusePar: null, publiePar: null, publieLe: null, origine: 'manuel', depotGenre: null, trello: false, archive: false, creePar: 'cm123456', creeLe: '', majLe: '', version: 1, etiquettes: [], membres: [], checklists: [], commentaires: [], pieces: [], activite: [], clips: [], resumes: {} },
    droits: { voir: true, deposer: true, editer: true, valider: true, gerer: true, commenter: true, modifier: true },
    noms: {},
    problemes: [],
  };
}

function fauxClient({ depot = false } = {}) {
  const appels: Array<{ chemin: string; methode: string; corps?: unknown }> = [];
  const requete = async <R,>(chemin: string, methode = 'GET', corps?: unknown): Promise<R> => {
    appels.push({ chemin, methode, corps });
    const [c, qs = ''] = chemin.split('?');
    const q = new URLSearchParams(qs);
    if (c === '/cm/drive/portees') {
      const droits = depot ? { voir: false, envoyer: false, gerer: false, depot: true } : droitsCm;
      return { portees: [{ portee: depot ? 't1' : 'club', team: depot ? { id: 't1', nom: 'Faucons' } : null, droits }, ...(depot ? [] : [{ portee: 't1', team: { id: 't1', nom: 'Faucons' }, droits }])], quota: depot ? null : quota, reglages: depot ? null : { rangementVisuels: true, rangementClips: true } } as R;
    }
    if (c === '/cm/drive') {
      if (depot) return { ...racine(null), portee: 't1', droits: { voir: false, envoyer: false, gerer: false, depot: true }, dossier: { ...racine(D_LOGOS).dossier!, id: D_DEPOT, cle: 'depot' }, chemin: [{ id: D_DEPOT, nom: null, cle: 'depot' }], dossiers: [], fichiers: [fichier(F1, 'ma-photo.png', { portee: 't1', dossierId: D_DEPOT })] } as R;
      return racine(q.get('dossier')) as R;
    }
    if (c === '/cm/drive/arbre') return { portee: 'club', dossiers: [{ id: D_LOGOS, parentId: null, nom: null, cle: 'logos', restreint: false }] } as R;
    if (c === '/cm/drive/lot') return { faits: [F1], erreurs: [], avant: { [F1]: null } } as R;
    if (c === '/cm/drive/nouveautes') return { total: 3, portees: [{ portee: 'club', total: 3 }] } as R;
    if (c === '/cm/drive/filtres') return { tags: [{ tag: 'saison', n: 1 }], auteurs: [{ compte: 'cm123456', pseudo: 'Clara' }], genres: [] } as R;
    if (c === '/cm/drive/recherche') return { portee: 'club', droits: droitsCm, fichiers: [fichier(F2, 'blason.png', { dossierId: D_LOGOS })], dossiers: [], noms: {}, chemins: { [D_LOGOS]: [{ id: D_LOGOS, nom: null, cle: 'logos' }] } } as R;
    if (c === `/cm/drive/elements/${F2}`) return { genre: 'fichier', id: F2, portee: 'club', dossierId: D_LOGOS } as R;
    if (c === `/cm/drive/fichiers/${F2}`) return { fichier: fichier(F2, 'blason.png', { dossierId: D_LOGOS }), chemin: [{ id: D_LOGOS, nom: null, cle: 'logos' }], versions: [{ version: 1, nom: 'blason.png', type: 'image/png', taille: 2048, creePar: 'cm123456', creeLe: '', actuelle: true, meta: fichier(F2, 'x').meta }], utilisations: { cartes: [], visuels: 0, sponsors: 0 }, droits: { ...droitsCm, modifier: true }, noms: {} } as R;
    if (c === '/cm/drive/corbeille') return { portee: 'club', droits: droitsCm, elements: [{ ...fichier(F2, 'vieux.png'), element: 'fichier', supprimeLe: '2026-10-19T10:00:00.000Z', supprimePar: 'cm123456', expireLe: '2026-11-18T10:00:00.000Z', restaurable: true }], noms: { cm123456: 'Clara' }, dureeJours: 30 } as R;
    if (/^\/cm\/tableaux\/[0-9a-f-]+$/.test(c)) return tableau() as R;
    if (/^\/cm\/cartes\/[0-9a-f-]+(\/pieces)?$/.test(c)) return reponseCarte() as R;
    if (c === '/cm/teams/t1') return { team: { id: 't1', nom: 'Faucons', fuseau: 'Europe/Paris' }, permissions: ['cm.clips.proposer'], tableaux: [], depots: [], noms: {}, genres: ['info'] } as R;
    if (c === '/cm/etat') return { versions: {}, aValider: 0 } as R;
    if (c === '/cm/teams/t1/clips') return { clips: [], noms: {} } as R;
    return { ok: true } as R;
  };
  const client = { config: { adresse: 'https://esport.test', jetonRelais: 'x' }, requete } as unknown as ClientEsport;
  return { client, appels };
}

function detailTeam(permissions: string[]): DetailTeam {
  return {
    team: { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
    modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: ['cm'].includes(m.cle) })),
    membres: 6,
    moi: { membreId: 'm1', role: { id: 'r1', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, permissions, superAdmin: false },
  };
}

afterEach(() => definirLangue('fr'));

describe('Drive CM', () => {
  it('règles : tri (nom, date récente d’abord, taille), lien interne « drive: », durée', () => {
    const a = fichier(F1, 'b.png', { taille: 10, majLe: '2026-10-01T00:00:00Z' });
    const b = fichier(F2, 'A.png', { taille: 30, majLe: '2026-10-05T00:00:00Z' });
    expect(trierFichiers([a, b], 'nom').map(f => f.nom)).toEqual(['A.png', 'b.png']);
    expect(trierFichiers([a, b], 'date').map(f => f.nom)).toEqual(['A.png', 'b.png']);
    expect(trierFichiers([a, b], 'taille', true).map(f => f.nom)).toEqual(['A.png', 'b.png']);
    expect(lireLienDrive(` drive:${F1.toUpperCase()} `)).toBe(F1);
    expect(lireLienDrive('drive:../../x')).toBeUndefined();
    expect([dureeLisible(65), dureeLisible(3723), dureeLisible(null)]).toEqual(['1:05', '1:02:03', '']);
  });

  it('déplacer : refus (permission, dossier par défaut, cycle, déjà ici) et annulation regroupée par origine', () => {
    const arbre = [
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
      { id: 'x', parentId: null },
    ];
    expect([...descendantsDe(arbre, 'a')].sort()).toEqual(['a', 'b', 'c']);
    const dossierA = { genre: 'dossier' as const, id: 'a', parentId: null, modifiable: true };
    expect(refusDeplacement([dossierA], 'c', arbre)).toBe('boucle');
    expect(refusDeplacement([dossierA], 'a', arbre)).toBe('boucle');
    expect(refusDeplacement([dossierA], 'x', arbre)).toBeNull();
    expect(refusDeplacement([dossierA], null, arbre)).toBe('meme');
    expect(refusDeplacement([{ ...dossierA, systeme: true }], 'x', arbre)).toBe('systeme');
    expect(refusDeplacement([dossierA, { genre: 'fichier', id: 'f', parentId: 'b', modifiable: false }], 'x', arbre)).toBe('permission');
    const els = [
      { genre: 'fichier' as const, id: 'f1' },
      { genre: 'fichier' as const, id: 'f2' },
      { genre: 'dossier' as const, id: 'd1' },
      { genre: 'fichier' as const, id: 'f3' },
    ];
    expect(groupesAnnulation(els, { f1: 'a', f2: null, d1: 'a' })).toEqual([
      { dossierId: 'a', elements: [els[0], els[2]] },
      { dossierId: null, elements: [els[1]] },
    ]);
  });

  it('nouveautés : pastille par dossier et dans l’arborescence, tout marquer comme vu ; déplacer par le menu puis « Annuler »', async () => {
    const { client, appels } = fauxClient();
    await render(<Drive theme={theme} client={client} large />);
    await screen.findByText('affiche.png');
    expect(appels.some(a => a.chemin === '/cm/drive?portee=club&vu=1')).toBe(true);
    expect(screen.getByTestId(`esport-drive-dossier-${D_LOGOS}-nouveautes`)).toBeTruthy();
    expect(await screen.findByTestId('esport-drive-arbre')).toBeTruthy();
    expect(screen.getByTestId(`esport-drive-arbre-${D_LOGOS}-nouveautes`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-drive-tout-vu'));
    await waitFor(() => expect(appels.some(a => a.chemin === '/cm/drive/tout-vu' && a.methode === 'POST')).toBe(true));
    expect(appels.find(a => a.chemin === '/cm/drive/tout-vu')?.corps).toEqual({ portee: 'club' });
    // Déplacer (menu « ⋯ » › Déplacer) : choix du dossier, lot « deplacer », toast « Annuler ».
    await fireEvent.press(screen.getByTestId(`esport-drive-fichier-${F1}-menu`));
    await fireEvent.press(await screen.findByText('Déplacer'));
    await fireEvent.press(await screen.findByTestId(`esport-drive-destination-${D_LOGOS}`));
    await fireEvent.press(screen.getByTestId('esport-drive-destination-ok'));
    await waitFor(() => expect(appels.some(a => a.chemin === '/cm/drive/lot')).toBe(true));
    expect(appels.find(a => a.chemin === '/cm/drive/lot')?.corps).toEqual({ action: 'deplacer', elements: [{ genre: 'fichier', id: F1 }], dossierId: D_LOGOS });
    expect(await screen.findByText('1 élément déplacé vers « Logos ».')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-drive-toast-annuler'));
    await waitFor(() => expect(appels.filter(a => a.chemin === '/cm/drive/lot').length).toBe(2));
    expect(appels.filter(a => a.chemin === '/cm/drive/lot')[1].corps).toEqual({ action: 'deplacer', elements: [{ genre: 'fichier', id: F1 }], dossierId: null });
    expect(await screen.findByText('Déplacement annulé.')).toBeTruthy();
  });

  it('pastille du Drive sur la tuile « CM du club » : total des nouveautés de tous les Drive visibles', async () => {
    const { client, appels } = fauxClient();
    const moi = { espace: true, club: ['cm.voir', 'cm.drive.voir'], teams: [], gerer: false } as never;
    await render(<CarteCmClub theme={theme} moi={moi} client={client} onOuvrir={() => undefined} />);
    expect(await screen.findByTestId('esport-teams-cm-drive-nouveautes')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(appels.some(a => a.chemin === '/cm/drive/nouveautes')).toBe(true);
  });

  it('écran : dossiers par défaut traduits, ouverture d’un dossier et fil d’Ariane, alerte d’espace, corbeille', async () => {
    const { client, appels } = fauxClient();
    await render(<Drive theme={theme} client={client} large />);
    expect(await screen.findByText('Logos')).toBeTruthy();
    expect(screen.getByText('affiche.png')).toBeTruthy();
    expect(screen.getByTestId('esport-drive-quota-alerte')).toBeTruthy();
    // Portées : club et team.
    expect(screen.getByTestId('esport-drive-portee-t1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`esport-drive-dossier-${D_LOGOS}`));
    await waitFor(() => expect(appels.some(a => a.chemin === `/cm/drive?portee=club&dossier=${D_LOGOS}&vu=1`)).toBe(true));
    expect(await screen.findByText('blason.png')).toBeTruthy();
    expect(screen.getByTestId('esport-drive-ariane-racine')).toBeTruthy();
    // Corbeille : élément, auteur, date d'effacement, restaurer.
    await fireEvent.press(screen.getByTestId('esport-drive-corbeille'));
    expect(await screen.findByTestId(`esport-drive-corbeille-${F2}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`esport-drive-corbeille-${F2}-restaurer`));
    await waitFor(() => expect(appels.some(a => a.chemin === `/cm/drive/corbeille/${F2}/restaurer` && a.methode === 'POST')).toBe(true));
  });

  it('étiquettes : gestionnaires seulement ; renommer, et supprimer définitivement avec le nombre de fichiers', async () => {
    const { client, appels } = fauxClient();
    await render(<Drive theme={theme} client={client} large />);
    await screen.findByText('affiche.png');
    await fireEvent.press(await screen.findByTestId('esport-drive-tags-gerer'));
    expect(await screen.findByTestId('esport-drive-tag-saison')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-drive-tag-saison-renommer'));
    await fireEvent.changeText(screen.getByTestId('esport-drive-tag-nom'), 'saison-2026');
    await fireEvent.press(screen.getByTestId('esport-drive-tag-nom-ok'));
    await waitFor(() => expect(appels.some(a => a.methode === 'PATCH' && a.chemin === '/cm/drive/tags')).toBe(true));
    expect(appels.find(a => a.methode === 'PATCH' && a.chemin === '/cm/drive/tags')?.corps).toEqual({ portee: 'club', tag: 'saison', nom: 'saison-2026' });
    await fireEvent.press(screen.getByTestId('esport-drive-tag-saison-supprimer'));
    expect(screen.getByText(/Retirer définitivement « #saison » de 1 fichier/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-drive-tag-saison-supprimer-ok'));
    await waitFor(() => expect(appels.some(a => a.methode === 'DELETE' && a.chemin === '/cm/drive/tags?portee=club&tag=saison')).toBe(true));
  });

  it('recherche avec filtres, et lien interne collé : ouvre l’élément', async () => {
    const { client, appels } = fauxClient();
    await render(<Drive theme={theme} client={client} large />);
    await screen.findByText('affiche.png');
    await fireEvent.changeText(screen.getByTestId('esport-drive-recherche'), 'blason');
    await fireEvent.press(screen.getByTestId('esport-drive-recherche-ok'));
    expect(await screen.findByTestId('esport-drive-resultats')).toBeTruthy();
    expect(appels.find(a => a.chemin.startsWith('/cm/drive/recherche'))?.chemin).toBe('/cm/drive/recherche?portee=club&q=blason');
    await fireEvent.changeText(screen.getByTestId('esport-drive-recherche'), `drive:${F2}`);
    await fireEvent.press(screen.getByTestId('esport-drive-recherche-ok'));
    await waitFor(() => expect(appels.some(a => a.chemin === `/cm/drive/fichiers/${F2}`)).toBe(true));
    expect(await screen.findByTestId('esport-drive-detail')).toBeTruthy();
    expect(screen.getByTestId('esport-drive-version-1')).toBeTruthy();
  });

  it('joueur : seulement le dossier « Dépôt joueurs », ni recherche ni corbeille ; onglet Drive de la team', async () => {
    const { client } = fauxClient({ depot: true });
    await render(<CmTeam theme={theme} client={client} detail={detailTeam(['cm.clips.proposer'])} large onAller={() => undefined} />);
    await fireEvent.press(await screen.findByTestId('esport-cm-team-onglet-drive'));
    expect(await screen.findByText('ma-photo.png')).toBeTruthy();
    expect(screen.getByTestId('esport-drive-depot-aide')).toBeTruthy();
    expect(screen.queryByTestId('esport-drive-recherche')).toBeNull();
    expect(screen.queryByTestId('esport-drive-corbeille')).toBeNull();
    expect(screen.queryByTestId('esport-drive-quota')).toBeNull();
  });

  it('carte CM : pièce jointe choisie dans le Drive (aucun envoi de fichier)', async () => {
    const { client, appels } = fauxClient();
    await render(<Tableau theme={theme} api={apiCm(client)} id={T} large />);
    await fireEvent.press(await screen.findByTestId(`esport-cm-carte-${C1}-tuile`));
    await fireEvent.press(await screen.findByTestId('esport-cm-piece-drive'));
    await fireEvent.press(await screen.findByTestId(`esport-cm-piece-choix-drive-${F1}`));
    await waitFor(() => expect(appels.some(a => a.chemin === `/cm/cartes/${C1}/pieces`)).toBe(true));
    expect(appels.find(a => a.chemin === `/cm/cartes/${C1}/pieces`)?.corps).toEqual({ genre: 'drive', fichierId: F1 });
  });

  it('journal et notification d’espace, en français et en anglais', () => {
    const e = { id: '1', acteur: 'cm123456', action: 'cm.drive_fichier_ajoute', module: 'cm', entite: 'cm_drive', entiteId: F1, meta: { nom: 'logo.png' }, date: '' };
    const noms = { cm123456: 'Clara' };
    expect(phraseJournal(e as never, noms)).toBe('Clara a ajouté « logo.png » au Drive');
    const n: Notification = { id: '1', type: 'cm-drive-quota', team: null, charge: { pourcent: 82, utilise: 1024 ** 3, limite: 2 * 1024 ** 3 }, lue: false, date: '' } as unknown as Notification;
    expect(phraseNotification(n, noms)).toBe('Le Drive CM est rempli à 82 % (1,0 Go sur 2,0 Go) : videz la corbeille ou faites du tri.');
    definirLangue('en');
    expect(phraseJournal(e as never, noms)).toBe('Clara added “logo.png” to the Drive');
    expect(phraseNotification(n, noms)).toBe('The CM Drive is 82% full (1.0 GB of 2.0 GB): empty the trash or clean up.');
  });
});
