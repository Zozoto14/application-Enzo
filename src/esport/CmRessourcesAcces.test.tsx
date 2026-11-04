/**
 * DATA › Ressources, « Qui voit la ressource » (migration 0048, docs/esport/cm.md) : cadenas et personnes autorisées sur
 * la ligne, pastille « Nouveau » jusqu'à l'ouverture (état envoyé au serveur), filtre « Partagé avec moi », « Partager
 * avec… » (Lyna en un clic), réglage restreint dans le menu ⋯ et à la création, phrase de la notification, anglais.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import type { ClientEsport } from './client';
import { filtrerLiens, type LienCm, type ReglageAccesLien } from './cm/liens';
import { phraseNotificationCm } from './cm/libelles';
import { definirLangue } from './i18n';
import { Ressources } from './ui/cm/liens/Ressources';

const theme = themeHub('nuit');
afterEach(() => definirLangue('fr'));

const TOUS = { modifier: true, supprimer: true, acces: true, partager: true };
const lien = (id: string, o: Partial<LienCm> = {}): LienCm => ({ id, titre: id, url: `https://${id}.exemple.fr/`, hote: `${id}.exemple.fr`, description: '', categorie: null, epingle: false, position: 1, team: null, acces: 'tous', creeLe: '', majLe: '', droits: TOUS, ...o });
const LIENS: LienCm[] = [
  lien('taches', { titre: 'Tâches de Lyna', acces: 'restreint', autorises: { total: 8, personnes: [{ compte: 'lyn12345', pseudo: 'Lyna' }, { compte: 'cm123456', pseudo: 'Clara Martin' }] }, nouveau: true, partageAvecMoi: true, droits: { modifier: false, supprimer: false, acces: false, partager: false } }),
  lien('charte', { titre: 'Charte' }),
];
const REGLAGE: ReglageAccesLien = {
  lien: { id: 'charte', titre: 'Charte', creePar: 'cm123456', team: null },
  acces: 'tous',
  regles: [],
  effectifs: null,
  options: { personnes: [{ compte: 'principal', pseudo: 'Fondateur' }, { compte: 'cm123456', pseudo: 'Clara' }, { compte: 'lyn12345', pseudo: 'Lyna' }, { compte: 'osc12345', pseudo: 'Oscar' }], rolesCm: [{ id: 'r1', nom: 'Rédaction', couleur: '#123456' }], rolesClub: [], rolesTeam: [] },
  moi: 'cm123456',
};

function client(liens = LIENS) {
  const appels: Array<{ chemin: string; methode: string; corps?: unknown }> = [];
  const requete = async <R,>(chemin: string, methode = 'GET', corps?: unknown): Promise<R> => {
    appels.push({ chemin, methode, corps });
    const c = chemin.split('?')[0];
    if (c === '/cm/liens' && methode === 'GET') return { liens, categories: [], teams: [], droits: { editer: true, gerer: true }, nouveaux: 1, max: 500 } as R;
    if (c === '/cm/liens' && methode === 'POST') return { lien: lien('nouveau') } as R;
    if (c === '/cm/liens/acces' || c.endsWith('/acces')) return (methode === 'PUT' ? { ...REGLAGE, acces: 'restreint', regles: (corps as { regles: unknown[] }).regles, effectifs: [{ compte: 'principal', pseudo: 'Fondateur', niveau: 'modifier' }, { compte: 'lyn12345', pseudo: 'Lyna', niveau: 'voir' }] } : REGLAGE) as R;
    if (c.endsWith('/partage')) return { ok: true, partages: (corps as { comptes: string[] }).comptes.length } as R;
    return { ok: true } as R;
  };
  return { appels, c: { requete } as unknown as ClientEsport };
}

it('filtre « Partagé avec moi »', () => {
  expect(filtrerLiens(LIENS, { partages: true }).map(l => l.id)).toEqual(['taches']);
});

it('ligne : cadenas, personnes autorisées, « Nouveau » qui disparaît à l’ouverture ; filtre ; droits du serveur', async () => {
  const { c, appels } = client();
  const ouvrir = jest.fn();
  (globalThis as { open?: unknown }).open = ouvrir;
  await render(<Ressources theme={theme} client={c} large />);
  expect(await screen.findByTestId('esport-cm-lien-taches-restreint')).toBeTruthy();
  expect(screen.getByTestId('esport-cm-lien-taches-autorises')).toHaveTextContent(/LY.*CM.*\+6/);
  expect(screen.getByTestId('esport-cm-lien-taches-nouveau')).toHaveTextContent('Nouveau');
  expect(screen.queryByTestId('esport-cm-lien-charte-restreint')).toBeNull();
  // « Peut voir » : ni modifier, ni partager, ni régler l'accès.
  await fireEvent.press(screen.getByTestId('esport-cm-lien-taches-menu'));
  expect(screen.queryByTestId('esport-cm-lien-taches-modifier')).toBeNull();
  expect(screen.queryByTestId('esport-cm-lien-taches-partager')).toBeNull();
  expect(screen.queryByTestId('esport-cm-lien-taches-acces')).toBeNull();
  await fireEvent(screen.getByTestId('esport-cm-ressources-partages'), 'valueChange', true);
  expect(screen.queryByTestId('esport-cm-lien-charte')).toBeNull();
  await fireEvent.press(screen.getByTestId('esport-cm-lien-taches-aller'));
  expect(ouvrir).toHaveBeenCalledWith('https://taches.exemple.fr/', '_blank', 'noopener,noreferrer');
  await waitFor(() => expect(appels.some(a => a.methode === 'POST' && a.chemin === '/cm/liens/taches/vu')).toBe(true));
  delete (globalThis as { open?: unknown }).open;
});

it('« Partager avec… » : Lyna en un clic', async () => {
  const { c, appels } = client();
  await render(<Ressources theme={theme} client={c} large />);
  await fireEvent.press(await screen.findByTestId('esport-cm-lien-charte-menu'));
  await fireEvent.press(screen.getByTestId('esport-cm-lien-charte-partager'));
  // Soi-même n'est pas proposé.
  expect(await screen.findByTestId('esport-cm-lien-partage-lyn12345')).toBeTruthy();
  expect(screen.queryByTestId('esport-cm-lien-partage-cm123456')).toBeNull();
  await fireEvent.press(screen.getByTestId('esport-cm-lien-partage-envoyer'));
  expect(await screen.findByTestId('esport-cm-lien-partage-erreur')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-cm-lien-partage-lyn12345'));
  await fireEvent.press(screen.getByTestId('esport-cm-lien-partage-envoyer'));
  await waitFor(() => expect(appels.find(a => a.chemin === '/cm/liens/charte/partage')?.corps).toEqual({ comptes: ['lyn12345'], niveau: 'voir' }));
  expect(await screen.findByText('Partagée avec 1 personne.')).toBeTruthy();
});

it('« Qui voit la ressource… » : restreint à Lyna (peut voir), qui voit aujourd’hui', async () => {
  const { c, appels } = client();
  await render(<Ressources theme={theme} client={c} large />);
  await fireEvent.press(await screen.findByTestId('esport-cm-lien-charte-menu'));
  await fireEvent.press(screen.getByTestId('esport-cm-lien-charte-acces'));
  await fireEvent.press(await screen.findByTestId('esport-cm-lien-acces-mode-restreint'));
  // Le Fondateur et le créateur la voient toujours : non proposés.
  expect(screen.queryByTestId('esport-cm-lien-acces-compte-principal-voir')).toBeNull();
  expect(screen.queryByTestId('esport-cm-lien-acces-compte-cm123456-voir')).toBeNull();
  await fireEvent.press(screen.getByTestId('esport-cm-lien-acces-compte-lyn12345-voir'));
  await fireEvent.press(screen.getByTestId('esport-cm-lien-acces-enregistrer'));
  await waitFor(() => expect(appels.find(a => a.methode === 'PUT')?.corps).toEqual({ acces: 'restreint', regles: [{ genre: 'compte', cible: 'lyn12345', niveau: 'voir' }] }));
  expect(await screen.findByTestId('esport-cm-lien-acces-effectifs')).toHaveTextContent(/Lyna/);
});

it('création restreinte : visibilité choisie dans le formulaire', async () => {
  const { c, appels } = client();
  await render(<Ressources theme={theme} client={c} large />);
  await fireEvent.press(await screen.findByTestId('esport-cm-ressources-nouveau'));
  await fireEvent.press(await screen.findByTestId('esport-cm-ressources-nouveau-lien'));
  await fireEvent.changeText(screen.getByTestId('esport-cm-liens-form-titre'), 'Tâches');
  await fireEvent.changeText(screen.getByTestId('esport-cm-liens-form-url'), 'https://exemple.fr/taches');
  await fireEvent.press(screen.getByTestId('esport-cm-liens-form-acces-mode-restreint'));
  await fireEvent.press(await screen.findByTestId('esport-cm-liens-form-acces-compte-lyn12345-voir'));
  await fireEvent.press(screen.getByTestId('esport-cm-liens-form-ok'));
  await waitFor(() => expect(appels.find(a => a.methode === 'POST' && a.chemin === '/cm/liens')?.corps).toMatchObject({ titre: 'Tâches', acces: 'restreint', regles: [{ genre: 'compte', cible: 'lyn12345', niveau: 'voir' }] }));
});

it('notification et anglais', async () => {
  const nom = (id: unknown) => (id === 'cm123456' ? 'Clara' : '?');
  expect(phraseNotificationCm('cm-lien-partage', '', { titre: 'Tâches', membre: 'cm123456' }, nom)).toBe('Clara a partagé une ressource avec vous : « Tâches »');
  definirLangue('en');
  expect(phraseNotificationCm('cm-lien-partage', '', { titre: 'Tasks', membre: 'cm123456' }, nom)).toBe('Clara shared a resource with you: “Tasks”');
  const { c } = client();
  await render(<Ressources theme={theme} client={c} large />);
  expect(await screen.findByTestId('esport-cm-lien-taches-nouveau')).toHaveTextContent('New');
});
