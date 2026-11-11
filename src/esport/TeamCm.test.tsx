/**
 * Le CM du club, une team (migrations 0068 et 0069, docs/esport/cm.md) côté app — 
 * sélecteur de teams de la création / de l'ajout d'un membre (rôles Responsable CM, Correspondant CM ; pas de poste en
 * jeu), page Teams (carte avec l'entrée de l'espace CM), accueil de la team (entrée « Espace CM du club »),
 * Trombinoscope (cartes des membres du CM avec leur rôle CM, sans elo).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { CATALOGUE, type Annuaire, type ClientEsport, type CompteEsport, type DetailTeam, type TeamAnnuaire, type TeamListee } from './client';
import type { MoiCm } from './cm/api';
import { definirLangue } from './i18n';
import { AjoutTeams } from './ui/AjoutTeams';
import { ROLE_CORRESPONDANT_CM, roleParDefaut } from './ui/CreationCompte';
import { CarteCmClub, CarteTeamListe, versEspaceCm } from './ui/RacineEsport';
import { groupesCm } from './ui/cm/EspaceCm';
import { entreesTeamCm } from './ui/cm/SectionsTeamCm';
import { entreesBarre } from './ui/PageTeam';
import { Trombinoscope } from './ui/membres/Trombinoscope';
import type { CarteTrombi, Trombinoscope as Donnees } from './trombi/api';

const theme = themeHub('nuit');
const TEAM_CM = '00000000-0000-4000-8000-00000000c0de';
const RESPONSABLE = '00000000-0000-4000-8000-00000000c001';

afterEach(() => definirLangue('fr'));

const teamCm: TeamAnnuaire = {
  id: TEAM_CM,
  nom: 'CM du club',
  slug: 'cm-du-club',
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

describe('CM du club : sélecteur de teams d’un membre', () => {
  it('rôle par défaut : Correspondant CM dans le CM du club, Joueur ailleurs', () => {
    expect(roleParDefaut(teamCm)).toBe(ROLE_CORRESPONDANT_CM);
    expect(roleParDefaut(valorant)).toBe('r-jou');
  });

  it('ajouter un joueur au CM du club avec un rôle CM (en plus de sa team de jeu), sans poste en jeu', async () => {
    const ajouterATeams = jest.fn(async () => null);
    const compte = { compte: 'lea12345', pseudo: 'Léa', appartenances: [{ teamId: 't-val', membreId: 'm1', role: { id: 'r-jou', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, posteJeu: null, statut: 'actif', rejointLe: '', gerable: true }] } as unknown as CompteEsport;
    const annuaire = { superAdmin: true, peutCreerCompte: true, teams: [teamCm, valorant], comptes: [compte] } as Annuaire;
    const client = { ajouterATeams } as unknown as ClientEsport;
    await render(
      <ModeAffichageForce mode="large">
        <AjoutTeams theme={theme} compte={compte} annuaire={annuaire} client={client} onFait={() => undefined} />
      </ModeAffichageForce>,
    );
    await fireEvent.press(await screen.findByTestId('esport-ajout-team-lea12345-cm-du-club'));
    expect(screen.queryByTestId('esport-ajout-poste-lea12345-cm-du-club')).toBeNull();
    expect(screen.getByText('Responsable CM')).toBeTruthy();
    expect(screen.getByText('Graphiste')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-ajout-valider-lea12345'));
    await waitFor(() => expect(ajouterATeams).toHaveBeenCalledWith('lea12345', { affectations: [{ teamId: TEAM_CM, roleId: ROLE_CORRESPONDANT_CM }] }));
  });
});

describe('CM du club : une seule carte, la team dans l’espace CM', () => {
  const liste: TeamListee = { id: TEAM_CM, nom: 'CM du club', slug: 'cm-du-club', jeu: 'communication', jeuNom: 'Communication', genre: 'cm', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false, membres: 4, modules: ['planning', 'availability', 'resources', 'meeting_summaries'], role: null, suspendu: false };
  const MOI: MoiCm = { espace: true, sponsors: ['sponsors.voir'], club: ['cm.voir', 'cm.drive.voir'], teams: [], gerer: true };
  const clientCm = { config: { adresse: 'https://esport.test', jetonRelais: 'x' }, teams: async () => [liste], requete: async () => ({ versions: {}, aValider: 0, nonLus: { total: 0, tableaux: {} } }) } as unknown as ClientEsport;

  it('carte « CM du club » : « Communication · N membres », sections du CM (Contenus, Drive, Sponsors), ouvre l’espace CM', async () => {
    const ouvrir = jest.fn();
    await render(<CarteCmClub theme={theme} moi={MOI} client={clientCm} onOuvrir={ouvrir} membres={4} />);
    expect(screen.getByText('CM du club')).toBeTruthy();
    expect(screen.getByTestId('esport-teams-cm-sous')).toHaveTextContent('Communication · 4 membres');
    expect(screen.getByText('Contenus')).toBeTruthy();
    expect(screen.getByText('Sponsors')).toBeTruthy();
    for (const absent of ['Jeu', 'Agenda', 'Équipe', 'Super admin']) expect(screen.queryByText(absent)).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-teams-cm-ouvrir'));
    expect(ouvrir).toHaveBeenCalled();
  });

  it('carte de team de secours (sans espace CM) : jamais la section « Jeu », couleur et initiales du CM', async () => {
    await render(<CarteTeamListe theme={theme} team={liste} onOuvrir={() => undefined} />);
    expect(screen.queryByText('Jeu')).toBeNull();
    expect(screen.getByText('CM', { includeHiddenElements: true })).toBeTruthy();
  });

  it('une page de team du CM du club ouvre l’espace CM (accueil, ou la même section)', () => {
    expect(versEspaceCm({ v: 'team', id: TEAM_CM })).toEqual({ v: 'cm' });
    expect(versEspaceCm({ v: 'team', id: TEAM_CM, section: 'membres' })).toEqual({ v: 'cm', onglet: 'team:membres' });
    expect(versEspaceCm({ v: 'team', id: TEAM_CM, section: 'module:planning' })).toEqual({ v: 'cm', onglet: 'team:module:planning' });
    expect(versEspaceCm({ v: 'team', id: 't-val' })).toEqual({ v: 'team', id: 't-val' });
  });

  it('espace CM › Équipe : Équipe CM (membres de la team), Réunions, Disponibilités, puis Rôles CM (ni Planning, ni Présence, ni Objectifs) ; Gestion : Paramètres de la team', () => {
    const detail: DetailTeam = {
      team: { id: TEAM_CM, nom: 'CM du club', slug: 'cm-du-club', jeu: 'communication', genre: 'cm', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
      modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: ['availability', 'meeting_summaries', 'discord', 'resources'].includes(m.cle) })),
      membres: 4,
      moi: { membreId: 'm1', role: { id: RESPONSABLE, nom: 'Responsable CM', couleur: '#db2777', cle: null }, permissions: ['members.view', 'planning.view', 'availability.view_all', 'availability.edit_own', 'discord.manage', 'resources.view'], superAdmin: false },
    };
    const groupes = groupesCm({ voirCm: true, drive: true, sponsors: false, reunions: true, gerer: true, team: entreesTeamCm(entreesBarre(detail)) });
    const equipe = groupes.find(g => g.id === 'equipe')!;
    expect(equipe.entrees.map(e => [e.id, e.libelle])).toEqual([
      ['team:membres', 'Équipe CM'],
      ['reunions', expect.any(String)],
      ['team:module:availability', 'Disponibilités'],
      ['team:module:meeting_summaries', 'Résumés'],
      ['equipe', 'Rôles CM'],
    ]);
    // Le Fondateur peut rallumer ces modules dans les Paramètres de la team : les entrées reviennent.
    const rallume: DetailTeam = { ...detail, modules: detail.modules.map(m => ({ ...m, active: m.active || ['planning', 'attendance', 'goals_tasks'].includes(m.cle) })), moi: { ...detail.moi, permissions: [...detail.moi.permissions, 'attendance.view_all', 'attendance.rsvp_own', 'goals_tasks.view'], superAdmin: true } };
    const ids = groupesCm({ voirCm: true, drive: true, sponsors: false, reunions: true, gerer: true, team: entreesTeamCm(entreesBarre(rallume)) }).find(g => g.id === 'equipe')!.entrees.map(e => e.id);
    expect(ids).toEqual(expect.arrayContaining(['team:module:planning', 'team:module:attendance', 'team:module:goals_tasks']));
    expect(groupes.find(g => g.id === 'gestion')!.entrees.map(e => e.id)).toEqual(expect.arrayContaining(['team:parametres', 'team:module:discord']));
    expect(groupes.find(g => g.id === 'data')!.entrees.map(e => e.id)).toContain('team:module:resources');
    // Sans la team (compte hors équipe), rien ne change.
    expect(groupesCm({ voirCm: true, drive: false, sponsors: false, reunions: true, gerer: true }).find(g => g.id === 'equipe')!.entrees.map(e => e.libelle)).toEqual([expect.any(String), 'Équipe CM']);
  });
});

describe('CM du club : Trombinoscope', () => {
  const tcm = { id: TEAM_CM, nom: 'CM du club', slug: 'cm-du-club', logoUrl: null, jeu: 'communication', jeuNom: 'Communication', genre: 'cm' as const };
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

  it('les membres du CM du club ont leur carte, avec leur rôle CM et sans elo', async () => {
    await render(
      <ModeAffichageForce mode="large">
        <Trombinoscope theme={theme} client={client} large />
      </ModeAffichageForce>,
    );
    expect(await screen.findByTestId('esport-trombi-carte-lina0001')).toBeTruthy();
    expect(screen.getByTestId('esport-trombi-carte-lina0001-role-cm')).toHaveTextContent('Responsable CM');
    expect(screen.getByText('CM du club · Responsable CM')).toBeTruthy();
    expect(screen.queryByTestId('esport-trombi-carte-lina0001-elo')).toBeNull();
    expect(screen.getByTestId('esport-trombi-carte-kai12345-elo')).toBeTruthy();
    // Recherche par rôle CM.
    await fireEvent.changeText(screen.getByTestId('esport-trombi-recherche'), 'Responsable');
    await waitFor(() => expect(screen.queryByTestId('esport-trombi-carte-kai12345')).toBeNull());
    expect(screen.getByTestId('esport-trombi-carte-lina0001')).toBeTruthy();
  });
});
