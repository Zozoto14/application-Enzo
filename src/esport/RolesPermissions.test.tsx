/**
 * Page Membres › Rôles et permissions : onglet réservé (Fondateur, roles.gerer), rôles du club (Second CEO) avec la
 * matrice par catégories, descriptions, « Sensible », recherche, confirmation avant d'accorder une permission
 * sensible, « Qui a ce rôle » ; délégué : permissions non accordables grisées ; rôles CM ; modèle des teams.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import type { ClientEsport } from './client';
import { definirLangue } from './i18n';
import { PageMembres } from './ui/membres/PageMembres';
import { RolesPermissions } from './ui/membres/RolesPermissions';
import type { VueRoles } from './roles/api';

const theme = themeHub('nuit');
afterEach(() => definirLangue('fr'));

const SECOND_CEO = ['cm.gerer', 'cm.voir', 'membres.inviter', 'statistiques.voir', 'teams.acces_total'];
function vue(fondateur = true): VueRoles {
  return {
    moi: { fondateur, permissions: fondateur ? [] : ['cm.voir', 'roles.gerer', 'teams.creer'] },
    globaux: {
      roles: [
        { id: 'role-global-second-ceo', nom: 'Second CEO', couleur: '#c99a1e', systeme: true, cle: 'second_ceo', permissions: SECOND_CEO, permissionsParDefaut: SECOND_CEO, modifie: false, comptes: [{ compte: 'grimm123', pseudo: 'Grimm' }] },
        { id: 'r-recruteur', nom: 'Recruteur', couleur: '#22a879', systeme: false, cle: null, permissions: ['teams.creer'], comptes: [] },
      ],
      permissions: ['roles.gerer', 'teams.acces_total', 'teams.creer', 'membres.inviter', 'statistiques.voir', 'cm.voir', 'cm.gerer'],
      reservees: ['roles.gerer'],
    },
    cm: { permissions: ['cm.voir', 'cm.gerer'] },
    modele: { roles: [{ cle: 'coach', nom: 'Coach', couleur: '#2563eb', permissions: ['members.view'], permissionsParDefaut: ['members.view'], modifie: false }], permissions: ['members.view', 'strats.delete'], modifiable: fondateur },
    teams: [],
    comptes: [
      { compte: 'grimm123', pseudo: 'Grimm' },
      { compte: 'lea12345', pseudo: 'Léa' },
    ],
  };
}

function faux(v: VueRoles) {
  const appels: Array<[string, string, unknown]> = [];
  const requete = jest.fn(async (chemin: string, methode = 'GET', corps?: unknown) => {
    appels.push([chemin, methode, corps]);
    if (chemin === '/roles-permissions') return v;
    if (chemin.startsWith('/roles-permissions/globaux/') && methode === 'PATCH') return { ...v.globaux.roles[0], ...(corps as object) };
    if (chemin === '/cm/roles') return { roles: [{ id: 'cm-role-responsable', nom: 'Responsable CM', couleur: '#db2777', systeme: true, cle: 'responsable', permissions: ['cm.voir', 'cm.gerer'], affectations: 1 }], permissions: ['cm.voir', 'cm.gerer'] };
    if (chemin === '/cm/affectations') return { affectations: [{ id: 'a1', compte: 'lina1234', pseudo: 'Lina', role: { id: 'cm-role-responsable', nom: 'Responsable CM', couleur: '#db2777', cle: 'responsable' }, portee: 'club', team: null, creeLe: '2026-10-01' }] };
    if (chemin.startsWith('/roles-permissions/journal')) return { entrees: [], noms: {} };
    return {};
  });
  return { client: { requete } as unknown as ClientEsport, appels };
}

test('Club : Second CEO, matrice par catégories avec descriptions, « Sensible », qui a ce rôle ; recherche', async () => {
  const { client } = faux(vue());
  await render(<RolesPermissions theme={theme} client={client} large />);
  await screen.findByTestId('esport-rp-club-editeur');
  expect(screen.getAllByText('Second CEO').length).toBeGreaterThan(0);
  expect(screen.getByTestId('esport-rp-club-categorie-teams')).toBeTruthy();
  expect(screen.getByTestId('esport-rp-club-categorie-cm')).toBeTruthy();
  expect(screen.getByText(/Entrer dans TOUTES les teams/)).toBeTruthy();
  expect(screen.getAllByText('Sensible').length).toBeGreaterThan(0);
  expect(screen.getByTestId('esport-rp-club-qui-grimm123')).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId('esport-rp-recherche'), 'statistiques');
  expect(screen.queryByTestId('esport-rp-club-perm-teams.creer')).toBeNull();
  expect(screen.getByTestId('esport-rp-club-perm-statistiques.voir')).toBeTruthy();
});

test('Club : accorder une permission sensible demande une confirmation, puis PATCH', async () => {
  const { client, appels } = faux(vue());
  await render(<RolesPermissions theme={theme} client={client} large />);
  await screen.findByTestId('esport-rp-club-editeur');
  await fireEvent.press(screen.getByTestId('esport-rp-club-perm-roles.gerer'));
  expect(screen.getByTestId('esport-rp-club-compteur').props.children).toBe('1 changement');
  await fireEvent.press(screen.getByTestId('esport-rp-club-enregistrer'));
  expect(screen.getByText(/permissions sensibles : roles.gerer/)).toBeTruthy();
  expect(appels.some(([, m]) => m === 'PATCH')).toBe(false);
  await fireEvent.press(screen.getByTestId('esport-rp-club-enregistrer'));
  await waitFor(() => expect(appels.some(([c, m]) => m === 'PATCH' && c === '/roles-permissions/globaux/role-global-second-ceo')).toBe(true));
  const patch = appels.find(([, m]) => m === 'PATCH');
  expect((patch?.[2] as { permissions: string[] }).permissions).toContain('roles.gerer');
});

test('délégué : Second CEO en lecture seule, permissions non accordables grisées, modèle des teams en lecture', async () => {
  const { client } = faux(vue(false));
  await render(<RolesPermissions theme={theme} client={client} large />);
  await screen.findByTestId('esport-rp-club-editeur');
  expect(screen.getByText('Lecture seule : seul le Fondateur modifie ce rôle.')).toBeTruthy();
  expect(screen.getByTestId('esport-rp-club-perm-teams.creer').props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(screen.getByTestId('esport-rp-club-role-r-recruteur'));
  expect(screen.getByTestId('esport-rp-club-perm-teams.creer').props.accessibilityState.disabled).toBe(false);
  expect(screen.getByTestId('esport-rp-club-perm-roles.gerer').props.accessibilityState.disabled).toBe(true);
  expect(screen.getByTestId('esport-rp-club-perm-statistiques.voir').props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(screen.getByTestId('esport-rp-section-teams'));
  expect(await screen.findByText('Seul le Fondateur règle le modèle des nouvelles teams.')).toBeTruthy();
});

test('CM : rôles CM et qui les a (Équipe CM) ; anglais', async () => {
  definirLangue('en');
  const { client } = faux(vue());
  await render(<RolesPermissions theme={theme} client={client} large={false} />);
  await screen.findByTestId('esport-rp-club-editeur');
  await fireEvent.press(screen.getByTestId('esport-rp-section-cm'));
  expect(await screen.findByTestId('esport-rp-cm-editeur')).toBeTruthy();
  expect(screen.getByText('CM: see the CM section (boards, posts, networks read-only). In a team role: only the team’s CM tab (its board), never the club’s CM space.')).toBeTruthy();
  expect(await screen.findByText('Lina · whole club')).toBeTruthy();
});

test('Membres : l’onglet « Rôles et permissions » n’apparaît que s’il est permis', async () => {
  const { client } = faux(vue());
  const props = { theme, client, contexte: {} as never, registre: [], large: true, onOuvrirTeam: () => undefined };
  const { unmount } = await render(<PageMembres {...props} ongletInitial="tous" />);
  expect(screen.queryByTestId('esport-membres-onglet-roles')).toBeNull();
  await unmount();
  await render(<PageMembres {...props} ongletInitial="roles" rolesPermissions />);
  expect(screen.getByTestId('esport-membres-onglet-roles')).toBeTruthy();
  expect(await screen.findByTestId('esport-roles-permissions')).toBeTruthy();
});
