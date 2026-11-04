/**
 * DATA › Ressources (docs/esport/cm.md) : règles pures (adresse https, filtre, ordre), liste et recherche, ouverture dans un
 * nouvel onglet (`noopener,noreferrer`), ajout avec validation d'adresse, droits (cm.editer, cm.gerer), « où est-il lié »,
 * ressources liées d'une carte (lier, délier, créer), anglais.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import type { ClientEsport } from './client';
import { adresseLienValide, deplacerLien, filtrerLiens, type LienCm } from './cm/liens';
import { definirLangue } from './i18n';
import { Ressources } from './ui/cm/liens/Ressources';
import { LiensLies } from './ui/cm/liens/LiensLies';

const theme = themeHub('nuit');
afterEach(() => definirLangue('fr'));

const lien = (id: string, o: Partial<LienCm> = {}): LienCm => ({ id, titre: id, url: `https://${id}.exemple.fr/`, hote: `${id}.exemple.fr`, description: '', categorie: null, epingle: false, position: 1, team: null, creeLe: '', majLe: '', ...o });
const LIENS: LienCm[] = [
  lien('canva', { titre: 'Charte graphique', hote: 'canva.com', url: 'https://canva.com/charte', description: 'Modèles de posts', categorie: 'Design', epingle: true, liaisons: 2 }),
  lien('unsplash', { titre: 'Banque d’images', hote: 'unsplash.com', url: 'https://unsplash.com/', categorie: 'Design', team: { id: 't1', nom: 'Faucons' } }),
  lien('analytics', { titre: 'Éléments chiffrés', hote: 'analytics.exemple.org', url: 'https://analytics.exemple.org/' }),
];

describe('règles pures', () => {
  it('adresse : https seulement, hôte public, sans identifiants', () => {
    expect(adresseLienValide(' https://www.exemple.fr/p?q=1 ')).toBe('https://www.exemple.fr/p?q=1');
    for (const m of ['http://exemple.fr', 'javascript:alert(1)', 'https://localhost/', 'https://127.0.0.1/', 'https://u:p@exemple.fr/', 'exemple.fr', '', 'https://intranet/', 'https://[::1]/']) expect(adresseLienValide(m)).toBeNull();
  });
  it('filtre : texte sans accents, étiquette, team, épinglés', () => {
    expect(filtrerLiens(LIENS, { q: 'elements' }).map(l => l.id)).toEqual(['analytics']);
    expect(filtrerLiens(LIENS, { q: 'banque faucons' }).map(l => l.id)).toEqual(['unsplash']);
    expect(filtrerLiens(LIENS, { categorie: 'Design' }).map(l => l.id)).toEqual(['canva', 'unsplash']);
    expect(filtrerLiens(LIENS, { team: 'club' }).map(l => l.id)).toEqual(['canva', 'analytics']);
    expect(filtrerLiens(LIENS, { team: 't1' }).map(l => l.id)).toEqual(['unsplash']);
    expect(filtrerLiens(LIENS, { epingles: true }).map(l => l.id)).toEqual(['canva']);
  });
  it('ordre : on ne traverse pas la frontière des épinglés', () => {
    expect(deplacerLien(LIENS, 'unsplash', 1)).toEqual(['canva', 'analytics', 'unsplash']);
    expect(deplacerLien(LIENS, 'unsplash', -1)).toBeNull();
    expect(deplacerLien(LIENS, 'canva', 1)).toBeNull();
    expect(deplacerLien(LIENS, 'inconnu', 1)).toBeNull();
  });
});

function client(droits = { editer: true, gerer: true }, liens = LIENS) {
  const appels: Array<{ chemin: string; methode: string; corps?: unknown }> = [];
  const requete = async <R,>(chemin: string, methode = 'GET', corps?: unknown): Promise<R> => {
    appels.push({ chemin, methode, corps });
    const c = chemin.split('?')[0];
    if (c === '/cm/liens' && methode === 'GET') return { liens, categories: ['Design'], teams: [{ id: 't1', nom: 'Faucons' }], droits, max: 500 } as R;
    if (c === '/cm/liens' && methode === 'POST') return { lien: lien('nouveau', { titre: (corps as { titre: string }).titre }) } as R;
    if (c.startsWith('/cm/liens/canva/liaisons')) return { cartes: [{ id: 'c1', titre: 'Annonce', tableauId: 'tb1', tableau: 'Contenus', portee: 'club', modifier: true }], dossiers: [{ id: 'd1', nom: 'Contrats', portee: 'club', chemin: ['Contrats'], modifier: true }], droits: { editer: droits.editer } } as R;
    if (c.startsWith('/cm/liens/cible/carte/')) return { liens: [LIENS[0]], droits: { lier: droits.editer, creer: droits.editer } } as R;
    return { ok: true } as R;
  };
  return { appels, c: { requete } as unknown as ClientEsport };
}

describe('onglet Ressources', () => {
  it('liste, recherche, filtres, ouverture dans un nouvel onglet', async () => {
    const { c } = client();
    const ouvrir = jest.fn();
    (globalThis as { open?: unknown }).open = ouvrir;
    await render(<Ressources theme={theme} client={c} large />);
    expect(await screen.findByTestId('esport-cm-lien-canva')).toBeTruthy();
    expect(screen.getByTestId('esport-cm-lien-canva-hote')).toHaveTextContent('canva.com');
    expect(screen.getByTestId('esport-cm-lien-canva-epingle')).toBeTruthy();
    expect(screen.getByTestId('esport-cm-lien-canva-liaisons')).toHaveTextContent(/Lié 2 fois/);
    expect(screen.getByTestId('esport-cm-ressources-compte')).toHaveTextContent('3 ressources');
    await fireEvent.changeText(screen.getByTestId('esport-cm-ressources-recherche'), 'elements');
    expect(screen.queryByTestId('esport-cm-lien-canva')).toBeNull();
    expect(screen.getByTestId('esport-cm-lien-analytics')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('esport-cm-ressources-recherche'), 'zzz');
    expect(screen.getByTestId('esport-cm-ressources-aucun')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('esport-cm-ressources-recherche'), '');
    await fireEvent.press(screen.getByTestId('esport-cm-ressources-team-t1'));
    expect(screen.getByTestId('esport-cm-lien-unsplash')).toBeTruthy();
    expect(screen.queryByTestId('esport-cm-lien-canva')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-cm-ressources-team-'));
    await fireEvent.press(screen.getByTestId('esport-cm-lien-canva-aller'));
    expect(ouvrir).toHaveBeenCalledWith('https://canva.com/charte', '_blank', 'noopener,noreferrer');
    delete (globalThis as { open?: unknown }).open;
  });

  it('ajout : adresse invalide refusée côté écran, adresse https envoyée normalisée', async () => {
    const { c, appels } = client();
    await render(<Ressources theme={theme} client={c} large />);
    await fireEvent.press(await screen.findByTestId('esport-cm-ressources-nouveau'));
    await fireEvent.press(await screen.findByTestId('esport-cm-ressources-nouveau-lien'));
    await fireEvent.changeText(screen.getByTestId('esport-cm-liens-form-titre'), 'Nouveau');
    await fireEvent.changeText(screen.getByTestId('esport-cm-liens-form-url'), 'http://exemple.fr');
    await fireEvent.press(screen.getByTestId('esport-cm-liens-form-ok'));
    expect(await screen.findByTestId('esport-cm-liens-form-erreur')).toBeTruthy();
    expect(appels.some(a => a.methode === 'POST')).toBe(false);
    await fireEvent.changeText(screen.getByTestId('esport-cm-liens-form-url'), 'https://exemple.fr/x');
    await fireEvent.press(screen.getByTestId('esport-cm-liens-form-ok'));
    await waitFor(() => expect(appels.find(a => a.methode === 'POST')?.corps).toMatchObject({ titre: 'Nouveau', url: 'https://exemple.fr/x', teamId: null, epingle: false }));
  });

  it('droits : sans cm.editer ni cm.gerer, ni ajout ni modification ni suppression', async () => {
    const { c } = client({ editer: false, gerer: false });
    await render(<Ressources theme={theme} client={c} large />);
    await screen.findByTestId('esport-cm-lien-canva');
    expect(screen.queryByTestId('esport-cm-ressources-nouveau')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-cm-lien-canva-menu'));
    expect(screen.queryByTestId('esport-cm-lien-canva-modifier')).toBeNull();
    expect(screen.queryByTestId('esport-cm-lien-canva-supprimer')).toBeNull();
    expect(screen.getByTestId('esport-cm-lien-canva-voir-liaisons')).toBeTruthy();
  });

  it('où est-il lié : cartes et dossiers, avec raccourcis ; délier', async () => {
    const { c, appels } = client();
    const tableau = jest.fn();
    const dossier = jest.fn();
    await render(<Ressources theme={theme} client={c} large onOuvrirTableau={tableau} onOuvrirDossier={dossier} />);
    await fireEvent.press(await screen.findByTestId('esport-cm-lien-canva-menu'));
    await fireEvent.press(screen.getByTestId('esport-cm-lien-canva-voir-liaisons'));
    await fireEvent.press(await screen.findByTestId('esport-cm-ressources-carte-c1'));
    expect(tableau).toHaveBeenCalledWith('tb1');
    await fireEvent.press(screen.getByTestId('esport-cm-ressources-dossier-d1'));
    expect(dossier).toHaveBeenCalledWith('club', 'd1');
    await fireEvent.press(screen.getByTestId('esport-cm-ressources-dossier-d1-delier'));
    await waitFor(() => expect(appels.some(a => a.methode === 'DELETE' && a.chemin === '/cm/liens/canva/liaisons/dossier/d1')).toBe(true));
  });

  it('anglais', async () => {
    definirLangue('en');
    const { c } = client();
    await render(<Ressources theme={theme} client={c} large />);
    expect(await screen.findByTestId('esport-cm-ressources-compte')).toHaveTextContent('3 resources');
  });
});

describe('ressources liées à une carte', () => {
  it('liste, recherche parmi les ressources, lier, créer et lier, délier', async () => {
    const { c, appels } = client();
    await render(<LiensLies theme={theme} client={c} genre="carte" cibleId="c1" />);
    expect(await screen.findByTestId('esport-cm-liens-carte-canva')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-cm-liens-carte-lier'));
    await fireEvent.changeText(await screen.findByTestId('esport-cm-liens-carte-recherche'), 'banque');
    expect(screen.queryByTestId('esport-cm-liens-carte-choix-canva')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-cm-liens-carte-choix-unsplash'));
    await waitFor(() => expect(appels.some(a => a.methode === 'POST' && a.chemin === '/cm/liens/unsplash/liaisons')).toBe(true));
    // Créer une nouvelle ressource : créée puis liée.
    await fireEvent.press(screen.getByTestId('esport-cm-liens-carte-creer'));
    await fireEvent.changeText(screen.getByTestId('esport-cm-liens-carte-form-titre'), 'Brief');
    await fireEvent.changeText(screen.getByTestId('esport-cm-liens-carte-form-url'), 'https://exemple.fr/brief');
    await fireEvent.press(screen.getByTestId('esport-cm-liens-carte-form-ok'));
    await waitFor(() => expect(appels.some(a => a.methode === 'POST' && a.chemin === '/cm/liens/nouveau/liaisons')).toBe(true));
    // Délier.
    await fireEvent.press(await screen.findByTestId('esport-cm-liens-carte-canva-delier'));
    await waitFor(() => expect(appels.some(a => a.methode === 'DELETE' && a.chemin === '/cm/liens/canva/liaisons/carte/c1')).toBe(true));
  });

  it('sans droit de lier : liste en lecture seule', async () => {
    const { c } = client({ editer: false, gerer: false });
    await render(<LiensLies theme={theme} client={c} genre="carte" cibleId="c1" />);
    await screen.findByTestId('esport-cm-liens-carte-canva');
    expect(screen.queryByTestId('esport-cm-liens-carte-lier')).toBeNull();
    expect(screen.queryByTestId('esport-cm-liens-carte-canva-delier')).toBeNull();
  });
});
