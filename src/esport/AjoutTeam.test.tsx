/**
 * « Membres et rôles » d'une team : ajouter à CETTE team un compte qui existe
 * déjà (jamais connecté dans l'Esport, invité, ou actif ailleurs), et en même
 * temps à d'autres teams, un rôle par team.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { CATALOGUE, ErreurEsport, type Annuaire, type ClientEsport, type CompteEsport, type DetailTeam } from './client';
import { themeHub } from '../hub/themes';
import type { ContexteHub } from '../hub/types';
import { ID_PRINCIPAL, type Profil } from '../profils/profils';
import type { ControleProfils } from '../ui/ecrans/CarteProfils';
import { ModeAffichageForce } from '../ui/mobile';
import { MembresRoles } from './ui/MembresRoles';

const theme = themeHub('nuit');
const fondateur: Profil = { id: ID_PRINCIPAL, nom: 'Enzo', admin: true, creeLe: '' };
const luca: Profil = { id: 'luca000001', nom: 'LUCA', admin: false, creeLe: '', apps: ['esport'], actif: true };

const detail: DetailTeam = {
  team: { id: 't1', nom: 'The final', slug: 'the-final', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
  modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: false })),
  membres: 1,
  moi: { membreId: 'm0', role: { id: 'r-prop', nom: 'Propriétaire', couleur: '#d64545', cle: 'proprietaire' }, permissions: ['members.view', 'members.invite', 'members.assign_role', 'members.remove'], superAdmin: true },
};

const roles = (suffixe: string) => [
  { id: `r-man${suffixe}`, nom: 'Manager', couleur: '#f59e0b', cle: 'manager', position: 1, systeme: true, attribuable: true },
  { id: `r-jou${suffixe}`, nom: 'Joueur', couleur: '#16a34a', cle: 'joueur', position: 4, systeme: true, attribuable: true },
];
const annuaire = (comptes: CompteEsport[]): Annuaire => ({
  superAdmin: true,
  peutCreerCompte: true,
  teams: [
    { id: 't1', nom: 'The final', slug: 'the-final', jeu: 'valorant', archivee: false, droits: { ajouter: true, roles: true, retirer: true }, roles: roles('') },
    { id: 't2', nom: 'Valorant', slug: 'valorant', jeu: 'valorant', archivee: false, droits: { ajouter: true, roles: true, retirer: true }, roles: roles('-2') },
  ],
  comptes,
});

function client(surcharges: Partial<ClientEsport>): ClientEsport {
  const non = async () => {
    throw new Error('non prévu');
  };
  return new Proxy({ membres: async () => [], roles: async () => [], ...surcharges } as unknown as ClientEsport, { get: (c, k) => (k in c ? (c as unknown as Record<string | symbol, unknown>)[k] : non) });
}

const contexte = (): ContexteHub =>
  ({ profil: fondateur, profils: { actuel: fondateur, tous: [fondateur, luca] } as unknown as ControleProfils }) as ContexteHub;

const monter = (c: ClientEsport) =>
  render(
    <ModeAffichageForce mode="large">
      <MembresRoles theme={theme} client={c} detail={detail} large contexte={contexte()} />
    </ModeAffichageForce>,
  );

describe('Membres et rôles › ajouter un compte existant', () => {
  it('Fondateur : LUCA (compte du hub jamais connecté) ajouté à « The final » ET « Valorant » en une fois', async () => {
    const ajouterATeams = jest.fn(async () => null);
    await monter(client({ annuaire: async () => annuaire([]), ajouterATeams }));
    await fireEvent.press(await screen.findByTestId('esport-ajouter-compte-ouvrir'));
    await fireEvent.press(await screen.findByTestId('esport-ajouter-compte-choix-luca000001'));
    // La team courante est cochée d'avance ; on coche la seconde, en Manager.
    await fireEvent.press(await screen.findByTestId('esport-ajout-team-luca000001-valorant'));
    await fireEvent.press(screen.getByTestId('esport-ajout-role-luca000001-valorant-r-man-2'));
    await fireEvent.press(screen.getByTestId('esport-ajout-valider-luca000001'));
    await waitFor(() =>
      expect(ajouterATeams).toHaveBeenCalledWith('luca000001', {
        pseudo: 'LUCA',
        affectations: [
          { teamId: 't1', roleId: 'r-jou' },
          { teamId: 't2', roleId: 'r-man-2' },
        ],
      }),
    );
  });

  it('refus du serveur affiché dans le panneau (pas d’échec silencieux)', async () => {
    const ajouterATeams = jest.fn().mockRejectedValue(new ErreurEsport('Vous ne pouvez pas attribuer un rôle plus élevé que le vôtre.', 403, 'escalade'));
    await monter(client({ annuaire: async () => annuaire([]), ajouterATeams }));
    await fireEvent.press(await screen.findByTestId('esport-ajouter-compte-ouvrir'));
    await fireEvent.press(await screen.findByTestId('esport-ajouter-compte-choix-luca000001'));
    await fireEvent.press(await screen.findByTestId('esport-ajout-valider-luca000001'));
    expect(await screen.findByTestId('esport-ajout-luca000001-erreur')).toHaveTextContent(/plus élevé que le vôtre/);
  });

  it('annuaire illisible : l’erreur est affichée', async () => {
    await monter(client({ annuaire: async () => Promise.reject(new ErreurEsport('Serveur Esport injoignable.', 503, 'injoignable')) }));
    await fireEvent.press(await screen.findByTestId('esport-ajouter-compte-ouvrir'));
    expect(await screen.findByTestId('esport-ajouter-compte-erreur')).toHaveTextContent(/injoignable/);
  });
});
