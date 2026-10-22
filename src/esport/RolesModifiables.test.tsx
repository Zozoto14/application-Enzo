/**
 * « Membres et rôles » › matrice des permissions éditable : rôle système (Coach) modifié pour la
 * team avec confirmation, changements non enregistrés surlignés, Annuler, Rétablir par défaut ;
 * Propriétaire verrouillé ; rôle personnalisé (nom, couleur, permissions) ; Manager limité aux
 * rôles placés sous le sien.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { CATALOGUE, type ClientEsport, type DetailTeam, type Role } from './client';
import { themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { MembresRoles, roleModifiable } from './ui/MembresRoles';
import { definirLangue } from './i18n';

const theme = themeHub('nuit');
const TOUTES = CATALOGUE.groupes.flatMap(g => g.permissions.map(p => p.cle));
const COACH = ['members.view', 'strats.view', 'strats.create', 'strats.update'];

const detailDe = (moi: Partial<DetailTeam['moi']> = {}): DetailTeam => ({
  team: { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
  modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: true })),
  membres: 3,
  moi: { membreId: 'm0', role: { id: 'r-prop', nom: 'Propriétaire', couleur: '#d64545', cle: 'proprietaire' }, permissions: TOUTES, superAdmin: true, ...moi },
});

const rolesDe = (coach: Partial<Role> = {}): Role[] => [
  { id: 'r-prop', nom: 'Propriétaire', couleur: '#d64545', systeme: true, cle: 'proprietaire', position: 0, permissions: TOUTES, membres: 1, verrouille: true, modifie: false },
  { id: 'r-man', nom: 'Manager', couleur: '#f59e0b', systeme: true, cle: 'manager', position: 1, permissions: ['members.view', 'roles.manage', 'strats.view'], membres: 1, modifie: false, permissionsParDefaut: [] },
  { id: 'r-coach', nom: 'Coach', couleur: '#0891b2', systeme: true, cle: 'coach', position: 2, permissions: COACH, membres: 2, modifie: false, permissionsParDefaut: COACH, ...coach },
  { id: 'r-cap', nom: 'Capitaine', couleur: '#123456', systeme: false, cle: null, position: 7, permissions: ['strats.view'], membres: 0 },
];

function client(surcharges: Partial<ClientEsport>): ClientEsport {
  const non = async () => {
    throw new Error('non prévu');
  };
  return new Proxy({ membres: async () => [], ...surcharges } as unknown as ClientEsport, { get: (c, k) => (k in c ? (c as unknown as Record<string | symbol, unknown>)[k] : non) });
}

const monter = (c: ClientEsport, detail = detailDe()) =>
  render(
    <ModeAffichageForce mode="large">
      <MembresRoles theme={theme} client={c} detail={detail} large />
    </ModeAffichageForce>,
  );

beforeEach(() => definirLangue('fr'));

describe('Membres et rôles › modifier un rôle existant', () => {
  it('Coach : décocher « strats.create » surligne le changement, Annuler le défait, Enregistrer demande confirmation', async () => {
    const modifierRole = jest.fn(async () => ({ ...rolesDe()[2], permissions: COACH.filter(p => p !== 'strats.create'), modifie: true }));
    await monter(client({ roles: async () => rolesDe(), modifierRole }));
    await fireEvent.press(await screen.findByTestId('esport-role-choisi-r-coach'));
    expect(screen.getByTestId('esport-role-description')).toHaveTextContent(/permissions par défaut/);
    await fireEvent.press(screen.getByTestId('esport-role-modifier'));
    expect(screen.getByTestId('esport-role-changements')).toHaveTextContent('Aucun changement.');
    expect(screen.queryByTestId('esport-role-nom')).toBeNull();

    await fireEvent.press(screen.getByTestId('esport-perm-strats.create'));
    expect(screen.getByTestId('esport-perm-changee-strats.create')).toBeTruthy();
    expect(screen.getByTestId('esport-role-changements')).toHaveTextContent(/1 changement non enregistré/);

    // Annuler : plus rien de surligné, rien d'envoyé.
    await fireEvent.press(screen.getByTestId('esport-role-annuler'));
    expect(screen.queryByTestId('esport-perm-changee-strats.create')).toBeNull();
    expect(modifierRole).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('esport-role-modifier'));
    await fireEvent.press(screen.getByTestId('esport-perm-strats.create'));
    await fireEvent.press(screen.getByTestId('esport-role-enregistrer'));
    expect(screen.getByTestId('esport-role-confirmation')).toHaveTextContent(/rôle système/);
    expect(modifierRole).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('esport-role-enregistrer-confirmer'));
    await waitFor(() => expect(modifierRole).toHaveBeenCalledWith('t1', 'r-coach', { permissions: COACH.filter(p => p !== 'strats.create') }));
  });

  it('rôle système modifié : « Rétablir les permissions par défaut » (avec confirmation)', async () => {
    const retablirRole = jest.fn(async () => rolesDe()[2]);
    await monter(client({ roles: async () => rolesDe({ permissions: ['members.view'], modifie: true }), retablirRole }));
    await fireEvent.press(await screen.findByTestId('esport-role-choisi-r-coach'));
    expect(screen.getByTestId('esport-role-description')).toHaveTextContent(/modifiées pour cette team/);
    await fireEvent.press(screen.getByTestId('esport-role-retablir'));
    await fireEvent.press(screen.getByTestId('esport-role-retablir-confirmer'));
    await waitFor(() => expect(retablirRole).toHaveBeenCalledWith('t1', 'r-coach'));
  });

  it('Propriétaire : verrouillé, ni « Modifier » ni « Rétablir »', async () => {
    await monter(client({ roles: async () => rolesDe() }));
    await fireEvent.press(await screen.findByTestId('esport-role-choisi-r-prop'));
    expect(screen.getByTestId('esport-role-description')).toHaveTextContent(/verrouillé/);
    expect(screen.queryByTestId('esport-role-modifier')).toBeNull();
    expect(screen.queryByTestId('esport-role-retablir')).toBeNull();
  });

  it('rôle personnalisé : nom, couleur et permissions, sans confirmation', async () => {
    const modifierRole = jest.fn(async () => rolesDe()[3]);
    await monter(client({ roles: async () => rolesDe(), modifierRole }));
    await fireEvent.press(await screen.findByTestId('esport-role-choisi-r-cap'));
    await fireEvent.press(screen.getByTestId('esport-role-modifier'));
    await fireEvent.changeText(screen.getByTestId('esport-role-nom'), 'Capitaine IGL');
    await fireEvent.press(screen.getByTestId('esport-role-couleur-#7c3aed'));
    await fireEvent.press(screen.getByTestId('esport-perm-strats.create'));
    await fireEvent.press(screen.getByTestId('esport-role-enregistrer'));
    await waitFor(() => expect(modifierRole).toHaveBeenCalledWith('t1', 'r-cap', { nom: 'Capitaine IGL', couleur: '#7c3aed', permissions: ['strats.view', 'strats.create'] }));
  });

  it('Manager : modifie seulement les rôles sous le sien, et ne coche pas ce qu’il n’a pas', async () => {
    const roles = rolesDe();
    const manager = detailDe({ superAdmin: false, role: { id: 'r-man', nom: 'Manager', couleur: '#f59e0b', cle: 'manager' }, permissions: roles[1].permissions });
    expect(roleModifiable(roles[0], roles, manager)).toBe(false);
    expect(roleModifiable(roles[1], roles, manager)).toBe(false);
    expect(roleModifiable(roles[2], roles, manager)).toBe(true);
    const modifierRole = jest.fn(async () => roles[3]);
    await monter(client({ roles: async () => roles, modifierRole }), manager);
    await fireEvent.press(await screen.findByTestId('esport-role-choisi-r-man'));
    expect(screen.queryByTestId('esport-role-modifier')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-role-choisi-r-cap'));
    await fireEvent.press(screen.getByTestId('esport-role-modifier'));
    // planning.view : le Manager ne l'a pas → la case ne se coche pas.
    await fireEvent.press(screen.getByTestId('esport-perm-planning.view'));
    expect(screen.getByTestId('esport-role-changements')).toHaveTextContent('Aucun changement.');
  });

  it('anglais : libellés traduits', async () => {
    definirLangue('en');
    await monter(client({ roles: async () => rolesDe() }));
    await fireEvent.press(await screen.findByTestId('esport-role-choisi-r-coach'));
    expect(screen.getByText('Edit permissions')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-role-modifier'));
    expect(screen.getByTestId('esport-role-changements')).toHaveTextContent('No changes.');
  });
});
