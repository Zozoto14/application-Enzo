/**
 * Team CM (migration 0068, docs/esport/cm.md, « La Team CM ») côté app : la Team CM est une team comme les autres —
 * sélecteur de teams de la création / de l'ajout d'un membre (rôles Responsable CM, Correspondant CM ; pas de poste en
 * jeu), page Teams (carte avec l'entrée de l'espace CM), accueil de la team (entrée « Espace CM du club »),
 * Trombinoscope (cartes des membres du CM avec leur rôle CM, sans elo).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import type { Annuaire, ClientEsport, CompteEsport, TeamAnnuaire, TeamListee } from './client';
import { definirLangue } from './i18n';
import { AjoutTeams } from './ui/AjoutTeams';
import { ROLE_CORRESPONDANT_CM, roleParDefaut } from './ui/CreationCompte';
import { EntreeEspaceCm } from './ui/PageTeam';
import { CarteTeamListe } from './ui/RacineEsport';
import { Trombinoscope } from './ui/membres/Trombinoscope';
import type { CarteTrombi, Trombinoscope as Donnees } from './trombi/api';

const theme = themeHub('nuit');
const TEAM_CM = '00000000-0000-4000-8000-00000000c0de';
const RESPONSABLE = '00000000-0000-4000-8000-00000000c001';

afterEach(() => definirLangue('fr'));

const teamCm: TeamAnnuaire = {
  id: TEAM_CM,
  nom: 'Team CM',
  slug: 'team-cm',
  jeu: 'communication',
  genre: 'cm',
  archivee: false,
  droits: { ajouter: true, roles: true, retirer: true },
  roles: [
    { id: RESPONSABLE, nom: 'Responsable CM', couleur: '#db2777', cle: null, position: 0, systeme: false, attribuable: true },
    { id: ROLE_CORRESPONDANT_CM, nom: 'Correspondant CM', couleur: '#0d9488', cle: null, position: 1, systeme: false, attribuable: true },
    { id: 'r-graphiste', nom: 'Graphiste', couleur: '#22aa88', cle: null, position: 2, systeme: false, attribuable: true },
  ],
};
const valorant: TeamAnnuaire = {
  id: 't-val',
  nom: 'Valorant LZ0',
  slug: 'valorant-lz0',
  jeu: 'valorant',
  archivee: false,
  droits: { ajouter: true, roles: true, retirer: true },
  roles: [
    { id: 'r-man', nom: 'Manager', couleur: '#7c3aed', cle: 'manager', position: 1, systeme: true, attribuable: true },
    { id: 'r-jou', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur', position: 4, systeme: true, attribuable: true },
  ],
};

describe('Team CM : sélecteur de teams d’un membre', () => {
  it('rôle par défaut : Correspondant CM dans la Team CM, Joueur ailleurs', () => {
    expect(roleParDefaut(teamCm)).toBe(ROLE_CORRESPONDANT_CM);
    expect(roleParDefaut(valorant)).toBe('r-jou');
  });

  it('ajouter un joueur à la Team CM avec un rôle CM (en plus de sa team de jeu), sans poste en jeu', async () => {
    const ajouterATeams = jest.fn(async () => null);
    const compte = { compte: 'lea12345', pseudo: 'Léa', appartenances: [{ teamId: 't-val', membreId: 'm1', role: { id: 'r-jou', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, posteJeu: null, statut: 'actif', rejointLe: '', gerable: true }] } as unknown as CompteEsport;
    const annuaire = { superAdmin: true, peutCreerCompte: true, teams: [teamCm, valorant], comptes: [compte] } as Annuaire;
    const client = { ajouterATeams } as unknown as ClientEsport;
    await render(
      <ModeAffichageForce mode="large">
        <AjoutTeams theme={theme} compte={compte} annuaire={annuaire} client={client} onFait={() => undefined} />
      </ModeAffichageForce>,
    );
    await fireEvent.press(await screen.findByTestId('esport-ajout-team-lea12345-team-cm'));
    expect(screen.queryByTestId('esport-ajout-poste-lea12345-team-cm')).toBeNull();
    expect(screen.getByText('Responsable CM')).toBeTruthy();
    expect(screen.getByText('Graphiste')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-ajout-valider-lea12345'));
    await waitFor(() => expect(ajouterATeams).toHaveBeenCalledWith('lea12345', { affectations: [{ teamId: TEAM_CM, roleId: ROLE_CORRESPONDANT_CM }] }));
  });
});

describe('Team CM : page Teams et accueil', () => {
  const liste: TeamListee = { id: TEAM_CM, nom: 'Team CM', slug: 'team-cm', jeu: 'communication', jeuNom: 'Communication', genre: 'cm', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false, membres: 4, modules: ['planning', 'availability', 'resources'], role: { nom: 'Responsable CM', couleur: '#db2777' }, suspendu: false };

  it('la Team CM est une carte de la liste des teams (rôle, effectif, entrée de l’espace CM)', async () => {
    const ouvrir = jest.fn();
    await render(<CarteTeamListe theme={theme} team={liste} onOuvrir={ouvrir} />);
    expect(screen.getByText('Team CM')).toBeTruthy();
    expect(screen.getByText(/Communication · 4 membres/)).toBeTruthy();
    expect(screen.getByText('Responsable CM')).toBeTruthy();
    expect(screen.getByTestId('esport-team-team-cm-cm')).toHaveTextContent('Espace CM du club');
    await fireEvent.press(screen.getByTestId('esport-team-team-cm'));
    expect(ouvrir).toHaveBeenCalled();
  });

  it('accueil de la Team CM : « Ouvrir l’espace CM »', async () => {
    const ouvrir = jest.fn();
    await render(<EntreeEspaceCm theme={theme} onOuvrir={ouvrir} />);
    await fireEvent.press(screen.getByTestId('esport-accueil-espace-cm-ouvrir'));
    expect(ouvrir).toHaveBeenCalled();
  });
});

describe('Team CM : Trombinoscope', () => {
  const tcm = { id: TEAM_CM, nom: 'Team CM', slug: 'team-cm', logoUrl: null, jeu: 'communication', jeuNom: 'Communication', genre: 'cm' as const };
  const val = { id: 't-val', nom: 'Valorant LZ0', slug: 'valorant-lz0', logoUrl: null, jeu: 'valorant', jeuNom: 'Valorant', genre: 'jeu' as const };
  const carte = (compte: string, pseudo: string, teams: CarteTrombi['teams'], extra: Partial<CarteTrombi> = {}): CarteTrombi => ({ compte, pseudo, photo: null, teams, elo: null, reseaux: [], palmares: 0, badges: [], peutEditer: false, moi: false, ...extra });
  const elo = { jeu: 'valorant', jeuNom: 'Valorant', valeur: '2100', rang: 'Immortal 2', pic: '', majLe: '' };
  const donnees: Donnees = {
    droits: { voir: 'club', editer: false, badges: { gerer: false, attribuer: false } },
    badges: [],
    teams: [tcm, val],
    jeux: [],
    fiches: [
      carte('lina0001', 'Lynaoxie', [{ ...tcm, role: { nom: 'Responsable CM', couleur: '#db2777', cle: null }, postes: [], personnages: [], posteLibre: null, rejointLe: '' }], { staff: true, elo }),
      carte('kai12345', 'Kai', [{ ...val, role: { nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, postes: [], personnages: [], posteLibre: null, rejointLe: '' }], { elo }),
    ],
  };
  const client = { requete: async (chemin: string) => (chemin.startsWith('/trombi') ? donnees : {}) } as unknown as ClientEsport;

  it('les membres de la Team CM ont leur carte, avec leur rôle CM et sans elo', async () => {
    await render(
      <ModeAffichageForce mode="large">
        <Trombinoscope theme={theme} client={client} large />
      </ModeAffichageForce>,
    );
    expect(await screen.findByTestId('esport-trombi-carte-lina0001')).toBeTruthy();
    expect(screen.getByTestId('esport-trombi-carte-lina0001-role-cm')).toHaveTextContent('Responsable CM');
    expect(screen.getByText('Team CM · Responsable CM')).toBeTruthy();
    expect(screen.queryByTestId('esport-trombi-carte-lina0001-elo')).toBeNull();
    expect(screen.getByTestId('esport-trombi-carte-kai12345-elo')).toBeTruthy();
    // Recherche par rôle CM.
    await fireEvent.changeText(screen.getByTestId('esport-trombi-recherche'), 'Responsable');
    await waitFor(() => expect(screen.queryByTestId('esport-trombi-carte-kai12345')).toBeNull());
    expect(screen.getByTestId('esport-trombi-carte-lina0001')).toBeTruthy();
  });
});
