/**
 * Fiche d'un tournoi › « Équipes et rôles Discord » (docs/esport/vocaux.md) : import depuis les tickets (propositions
 * cochées, problèmes signalés, déjà importées décochées), ajout et correction d'une équipe à la main, création des rôles
 * (bilan : absents, sans ID, rôle du bot trop bas), suppression confirmée ; sans vocaux.configurer : pas de bouton.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import type { ClientEsport } from './client';
import { definirLangue } from './i18n';
import { EquipesDiscord } from './ui/competition/EquipesDiscord';
import type { DiscordTournoi, PropositionEquipe } from './vocaux/api';

const theme = themeHub('nuit');
afterEach(() => definirLangue('fr'));

function etatDe(): DiscordTournoi {
  return {
    tournoi: { id: 't1', nom: 'The Nuke End', statut: 'a_venir', fin: '2026-11-22' },
    reglages: { modeleRole: '{tag} {nom}', couleur: null, suppressionH: 24, categorieTicketId: 'cat1', rolesCreesLe: null, rolesSupprimesLe: null },
    equipes: [{ id: 'e1', nom: 'Ligne Zéro', tag: 'LZ0', roleId: null, ticketId: 'tk1', membres: [{ id: 'm1', poste: 'joueur', discordId: '810000000000000101', nom: 'Kira', embarkId: 'Kira#1234', roleStatut: null }] }],
    categoriesTickets: [{ id: 'cat1', nom: { fr: 'Inscription The Nuke End', en: 'The Nuke End registration' } }],
    serveur: { id: '700', nom: 'Club' },
    hubs: [{ id: '751', nom: 'Vocal équipe The Nuke End' }],
    droits: { gerer: true, discord: true, importer: true },
    bot: true,
    limites: { equipes: 64, membres: 10 },
    modeleDefaut: '{tag} {nom}',
  };
}

const propositions: PropositionEquipe[] = [
  { ticketId: 'tk1', numero: 1, statut: 'resolu', auteur: 'Cap', nom: 'Ligne Zéro', tag: 'LZ0', membres: [], problemes: [], deja: true },
  {
    ticketId: 'tk2',
    numero: 2,
    statut: 'resolu',
    auteur: 'Cap',
    nom: 'Bravo',
    tag: 'BRV',
    membres: [
      { poste: 'joueur', discordId: '810000000000000102', nom: '', embarkId: 'Nox#0042', present: true },
      { poste: 'joueur', discordId: null, nom: 'inconnu', embarkId: '', present: null },
    ],
    problemes: ['sans_id'],
    deja: false,
  },
];

function fauxClient(etat: DiscordTournoi) {
  const appels: Array<{ chemin: string; methode?: string; corps?: unknown }> = [];
  const requete = async (chemin: string, methode?: string, corps?: unknown): Promise<unknown> => {
    appels.push({ chemin, methode, corps });
    const base = '/teams/team1/tournois/t1/discord';
    if (chemin === base && !methode) return etat;
    if (chemin === base && methode === 'PUT') return { ...etat, reglages: { ...etat.reglages, ...(corps as object) } };
    if (chemin === `${base}/import`) return { categorieId: 'cat1', propositions };
    if (chemin === `${base}/equipes` && methode === 'POST') {
      const ajout = (corps as { equipes: Array<{ nom: string; tag: string; membres: unknown[] }> }).equipes.map((e, i) => ({ id: `n${i}`, roleId: null, ticketId: null, ...e }));
      etat.equipes = [...etat.equipes, ...(ajout as DiscordTournoi['equipes'])];
      return { ...etat };
    }
    if (chemin === `${base}/equipes/e1` && methode === 'PATCH') return { ...etat, equipes: [{ ...etat.equipes[0], ...(corps as object) }] };
    if (chemin === `${base}/roles`)
      return {
        ...etat,
        reglages: { ...etat.reglages, rolesCreesLe: '2026-11-20T10:00:00.000Z' },
        equipes: etat.equipes.map(e => ({ ...e, roleId: '999' })),
        bilan: { creees: 2, attribues: 3, absents: [{ equipe: 'BRV Bravo', nom: 'Ghost', discordId: '810000000000000199' }], sansId: [{ equipe: 'BRV Bravo', nom: 'inconnu' }], refus: [{ equipe: 'BRV Bravo', quoi: 'attribution', statut: 403, code: 50013 }], limite: false, hierarchie: { positionBot: 3, ok: true } },
      };
    if (chemin === `${base}/roles/supprimer`) return { ...etat, nettoyage: { roles: 2, salons: 1, echecs: [] } };
    throw new Error(`inattendu : ${methode ?? 'GET'} ${chemin}`);
  };
  return { client: { requete } as unknown as ClientEsport, appels };
}

test('import depuis les tickets : propositions, problèmes, déjà importée décochée ; ajout des cochées', async () => {
  const { client, appels } = fauxClient(etatDe());
  await render(<EquipesDiscord theme={theme} client={client} teamId="team1" tournoiId="t1" />);
  expect(await screen.findByText('Hub vocal du tournoi : Vocal équipe The Nuke End.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-eq-importer'));
  expect(await screen.findByTestId('esport-eq-prop-2-sans_id')).toBeTruthy();
  expect(screen.getByText('Déjà dans le tournoi')).toBeTruthy();
  expect(screen.getByText(/inconnu · sans Discord ID/)).toBeTruthy();
  expect(screen.getByText('Ajouter les équipes cochées (1)')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-eq-import-ajouter'));
  await screen.findByText('1 équipe(s) ajoutée(s).');
  const post = appels.find(a => a.chemin.endsWith('/equipes') && a.methode === 'POST')!.corps as { equipes: Array<{ tag: string; ticketId: string; membres: Array<{ discordId: string | null }> }> };
  expect(post.equipes.map(e => [e.tag, e.ticketId, e.membres.map(m => m.discordId)])).toEqual([['BRV', 'tk2', ['810000000000000102', null]]]);
  expect(await screen.findByTestId('esport-eq-equipe-BRV')).toBeTruthy();
});

test('équipe à la main, correction d’un membre ; créer les rôles : bilan ; supprimer les rôles', async () => {
  const { client, appels } = fauxClient(etatDe());
  await render(<EquipesDiscord theme={theme} client={client} teamId="team1" tournoiId="t1" />);
  await fireEvent.press(await screen.findByTestId('esport-eq-equipe-LZ0-modifier'));
  await fireEvent.changeText(screen.getByTestId('esport-eq-edition-LZ0-membre-0-discord'), '81 0000000000000111');
  await fireEvent.press(screen.getByTestId('esport-eq-edition-LZ0-membre-ajouter'));
  await fireEvent.press(screen.getByTestId('esport-eq-edition-LZ0-membre-1-poste-coach'));
  await fireEvent.changeText(screen.getByTestId('esport-eq-edition-LZ0-membre-1-nom'), 'Zed');
  await fireEvent.press(screen.getByTestId('esport-eq-edition-LZ0-enregistrer'));
  await screen.findByText('Enregistré.');
  const patch = appels.find(a => a.methode === 'PATCH')!.corps as { membres: Array<{ poste: string; discordId: string | null; nom: string }> };
  expect(patch.membres).toEqual([
    { poste: 'joueur', discordId: '810000000000000111', nom: 'Kira', embarkId: 'Kira#1234' },
    { poste: 'coach', discordId: null, nom: 'Zed', embarkId: '' },
  ]);
  await fireEvent.press(screen.getByTestId('esport-eq-ajouter'));
  await fireEvent.changeText(screen.getByTestId('esport-eq-nouvelle-nom'), 'Charlie');
  await fireEvent.changeText(screen.getByTestId('esport-eq-nouvelle-tag'), 'chr');
  await fireEvent.press(screen.getByTestId('esport-eq-nouvelle-enregistrer'));
  await screen.findByTestId('esport-eq-equipe-CHR');
  await fireEvent.press(screen.getByTestId('esport-eq-creer-roles'));
  expect(await screen.findByText('2 rôle(s) créé(s), 3 attribution(s).')).toBeTruthy();
  expect(screen.getByTestId('esport-eq-bilan-absents').props.children).toMatch(/Ghost \(BRV Bravo\)/);
  expect(screen.getByTestId('esport-eq-bilan-sans-id').props.children).toMatch(/inconnu/);
  expect(screen.getByTestId('esport-eq-hierarchie')).toBeTruthy();
  expect(screen.getByTestId('esport-eq-crees')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-eq-supprimer-roles'));
  await fireEvent.press(screen.getByTestId('esport-eq-supprimer-roles-confirmer'));
  expect(await screen.findByText('2 rôle(s) et 1 salon(s) supprimé(s).')).toBeTruthy();
});

test('sans vocaux.configurer : pas de bouton Discord, explication ; anglais', async () => {
  definirLangue('en');
  const etat = etatDe();
  etat.droits.discord = false;
  const { client } = fauxClient(etat);
  await render(<EquipesDiscord theme={theme} client={client} teamId="team1" tournoiId="t1" />);
  expect(await screen.findByText(/requires the “Voice channels: configure” permission/)).toBeTruthy();
  expect(screen.queryByTestId('esport-eq-creer-roles')).toBeNull();
});
