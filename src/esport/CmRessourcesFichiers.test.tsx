/**
 * DATA › Ressources, fichiers (migration 0051, docs/esport/cm.md « Fichiers ») : filtre par type, ligne d'un fichier
 * (icône, nom, taille, Drive d'origine), fichier d'un Drive inaccessible (ni nom ni lien), aperçu et téléchargement par
 * lien signé, « + Ajouter » → Fichier (choix dans un Drive : référence, sans copie), ressources liées d'une carte, anglais.
 */

import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import type { ClientEsport } from './client';
import { estDeType, filtrerLiens, type FichierRessource, type LienCm } from './cm/liens';
import { phraseJournalCm } from './cm/libelles';
import { definirLangue } from './i18n';
import { Ressources } from './ui/cm/liens/Ressources';
import { LiensLies } from './ui/cm/liens/LiensLies';

const theme = themeHub('nuit');
afterEach(() => definirLangue('fr'));

const META = { format: 'png', nomFormat: 'PNG', largeur: 1080, hauteur: 1350, duree: null, codecVideo: null, codecAudio: null };
const ok = (o: Partial<Extract<FichierRessource, { etat: 'ok' }>> = {}): FichierRessource => ({ source: 'envoi', etat: 'ok', id: 'f1', nom: 'logo.png', genre: 'image', type: 'image/png', taille: 2_048, version: 1, meta: META, majLe: '2026-11-01T10:00:00.000Z', vignette: null, portee: null, remplacer: true, ...o });
const res = (id: string, o: Partial<LienCm> = {}): LienCm => ({ id, genre: 'fichier', titre: id, url: '', hote: '', description: '', categorie: null, epingle: false, position: 1, team: null, creeLe: '', majLe: '', ...o });
const LISTE: LienCm[] = [
  res('logo', { titre: 'Logo officiel', fichier: ok() }),
  res('charte', { titre: 'Charte PDF', fichier: ok({ id: 'f2', nom: 'charte.pdf', genre: 'document', type: 'application/pdf', meta: { ...META, format: 'pdf', nomFormat: 'PDF', largeur: null, hauteur: null }, source: 'drive', portee: 'club' }) }),
  res('nda', { titre: 'Accord', fichier: { source: 'drive', etat: 'inaccessible' } }),
  res('teaser', { titre: 'Teaser', fichier: ok({ id: 'f3', nom: 'teaser.mp4', genre: 'video', type: 'video/mp4', meta: { ...META, format: 'mp4', nomFormat: 'MP4' } }) }),
  { id: 'canva', genre: 'lien', titre: 'Canva', url: 'https://canva.com/', hote: 'canva.com', description: '', categorie: null, epingle: false, position: 2, team: null, creeLe: '', majLe: '' },
];

describe('règles pures', () => {
  it('filtre par type : liens, fichiers, images, documents, vidéos ; nom du fichier dans la recherche', () => {
    const ids = (t: Parameters<typeof estDeType>[1]) => LISTE.filter(l => estDeType(l, t)).map(l => l.id);
    expect(ids('liens')).toEqual(['canva']);
    expect(ids('fichiers')).toEqual(['logo', 'charte', 'nda', 'teaser']);
    expect(ids('images')).toEqual(['logo']);
    expect(ids('documents')).toEqual(['charte']);
    expect(ids('videos')).toEqual(['teaser']);
    expect(filtrerLiens(LISTE, { q: 'teaser.mp4' }).map(l => l.id)).toEqual(['teaser']);
    expect(filtrerLiens(LISTE, { type: 'images', q: 'logo' }).map(l => l.id)).toEqual(['logo']);
  });
  it('journal : fichier ajouté, remplacé', () => {
    expect(phraseJournalCm('cm.lien_cree', 'Clara', { titre: 'Logo', genre: 'fichier' })).toBe('Clara a ajouté le fichier « Logo » aux ressources');
    expect(phraseJournalCm('cm.lien_version', 'Clara', { titre: 'Logo', genre: 'fichier' })).toBe('Clara a remplacé le fichier de la ressource « Logo »');
  });
});

function client(liens = LISTE) {
  const appels: Array<{ chemin: string; methode: string; corps?: unknown }> = [];
  const requete = async <R,>(chemin: string, methode = 'GET', corps?: unknown): Promise<R> => {
    appels.push({ chemin, methode, corps });
    const c = chemin.split('?')[0];
    if (c === '/cm/liens' && methode === 'GET') return { liens, categories: [], teams: [], droits: { editer: true, gerer: true }, max: 500 } as R;
    if (c === '/cm/liens' && methode === 'POST') return { lien: res('nouveau', { fichier: ok() }) } as R;
    if (/^\/cm\/liens\/[^/]+\/fichier\/lien$/.test(c)) return { url: `https://esport.test${c}?sig=x`, expire: '' } as R;
    if (c.startsWith('/cm/liens/cible/carte/')) return { liens, droits: { lier: true, creer: true } } as R;
    if (c === '/cm/drive/portees') return { portees: [{ portee: 'club', team: null, droits: { voir: true, envoyer: true, gerer: true, depot: false } }], quota: null, reglages: null } as R;
    if (c === '/cm/drive') return { portee: 'club', team: null, droits: { voir: true, envoyer: true, gerer: true, depot: false }, dossier: null, chemin: [], dossiers: [], fichiers: [{ id: 'd-f9', portee: 'club', dossierId: null, nom: 'kit.pdf', genre: 'document', type: 'application/pdf', taille: 10, version: 1, meta: { ...META, format: 'pdf', nomFormat: 'PDF' }, tags: [], favori: false, origine: 'envoi', creePar: null, creeLe: '', majPar: null, majLe: '', vignette: null, modifiable: true }], noms: {}, tronque: false, quota: { utilise: 0, enCours: 0, limite: 1, pourcent: 0, alerte: false, fichierMax: 1, zipMax: 1 } } as R;
    return { ok: true } as R;
  };
  return { appels, c: { requete } as unknown as ClientEsport };
}

describe('onglet Ressources, fichiers', () => {
  it('ligne d’un fichier, fichier inaccessible sans nom ni lien, filtre par type', async () => {
    const { c } = client();
    await render(<Ressources theme={theme} client={c} large />);
    expect(await screen.findByTestId('esport-cm-lien-logo-fichier')).toHaveTextContent(/logo\.png · PNG · 1080×1350/);
    expect(screen.getByTestId('esport-cm-lien-charte-fichier')).toHaveTextContent(/Depuis le Drive \(Drive du club\)/);
    expect(screen.getByTestId('esport-cm-lien-nda-fichier')).toHaveTextContent('Fichier d’un Drive auquel vous n’avez pas accès');
    expect(screen.queryByTestId('esport-cm-lien-nda-apercu')).toBeNull();
    expect(screen.queryByTestId('esport-cm-lien-nda-telecharger')).toBeNull();
    expect(screen.getByTestId('esport-cm-ressources-compte')).toHaveTextContent('5 ressources');
    await fireEvent.press(screen.getByTestId('esport-cm-ressources-type-videos'));
    expect(screen.getByTestId('esport-cm-lien-teaser')).toBeTruthy();
    expect(screen.queryByTestId('esport-cm-lien-logo')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-cm-ressources-type-liens'));
    expect(screen.getByTestId('esport-cm-lien-canva')).toBeTruthy();
    expect(screen.queryByTestId('esport-cm-lien-teaser')).toBeNull();
  });

  it('aperçu au clic et téléchargement : liens signés demandés au serveur', async () => {
    const ouvrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { c, appels } = client();
    await render(<Ressources theme={theme} client={c} large />);
    await fireEvent.press(await screen.findByTestId('esport-cm-lien-charte-apercu'));
    expect(await screen.findByTestId('esport-cm-ressources-apercu-volet')).toBeTruthy();
    expect(screen.getByTestId('esport-cm-ressources-apercu-infos')).toHaveTextContent(/charte\.pdf/);
    await fireEvent.press(screen.getByTestId('esport-cm-ressources-apercu-telecharger'));
    await waitFor(() => expect(appels.find(a => a.chemin === '/cm/liens/charte/fichier/lien' && (a.corps as { telecharger?: boolean })?.telecharger)).toBeTruthy());
    await waitFor(() => expect(ouvrir).toHaveBeenCalledWith('https://esport.test/cm/liens/charte/fichier/lien?sig=x'));
    ouvrir.mockRestore();
  });

  it('« + Ajouter » → Fichier : choisi dans un Drive, une ressource qui y fait référence', async () => {
    const { c, appels } = client();
    await render(<Ressources theme={theme} client={c} large />);
    await screen.findByTestId('esport-cm-lien-logo');
    await fireEvent.press(screen.getByTestId('esport-cm-ressources-nouveau'));
    await fireEvent.press(await screen.findByTestId('esport-cm-ressources-nouveau-fichier'));
    expect(await screen.findByTestId('esport-cm-fichiers-form-volet')).toBeTruthy();
    // App native : pas de sélecteur de fichiers, le choix dans un Drive est proposé d'office.
    await fireEvent.press(screen.getByTestId('esport-cm-fichiers-form-mode-appareil'));
    expect(screen.getByTestId('esport-cm-fichiers-form-natif')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-cm-fichiers-form-mode-drive'));
    await fireEvent.press(screen.getByTestId('esport-cm-fichiers-form-drive'));
    await fireEvent.press(await screen.findByTestId('esport-cm-fichiers-form-choix-drive-d-f9'));
    expect(await screen.findByTestId('esport-cm-fichiers-form-drive-choisi')).toHaveTextContent(/kit\.pdf/);
    await fireEvent.changeText(screen.getByTestId('esport-cm-fichiers-form-titre'), 'Kit média');
    await fireEvent.press(screen.getByTestId('esport-cm-fichiers-form-ok'));
    await waitFor(() => expect(appels.find(a => a.methode === 'POST' && a.chemin === '/cm/liens')?.corps).toMatchObject({ genre: 'fichier', elementId: 'd-f9', titre: 'Kit média', acces: 'tous' }));
  });

  it('ressources liées à une carte : fichier ouvert par lien signé, fichier inaccessible sans lien', async () => {
    const ouvrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { c, appels } = client();
    await render(<LiensLies theme={theme} client={c} genre="carte" cibleId="c1" />);
    expect(await screen.findByTestId('esport-cm-liens-carte-nda')).toHaveTextContent(/Fichier d’un Drive auquel vous n’avez pas accès/);
    await fireEvent.press(screen.getByTestId('esport-cm-liens-carte-logo-ouvrir'));
    await waitFor(() => expect(appels.some(a => a.chemin === '/cm/liens/logo/fichier/lien')).toBe(true));
    await waitFor(() => expect(ouvrir).toHaveBeenCalled());
    ouvrir.mockRestore();
  });

  it('anglais', async () => {
    definirLangue('en');
    const { c } = client();
    await render(<Ressources theme={theme} client={c} large />);
    expect(await screen.findByTestId('esport-cm-lien-nda-fichier')).toHaveTextContent('File from a Drive you cannot access');
    expect(screen.getByTestId('esport-cm-ressources-compte')).toHaveTextContent('5 resources');
  });
});
