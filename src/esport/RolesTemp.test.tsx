/**
 * Rôles Discord temporaires des teams (docs/esport/bot-discord.md, « Rôles temporaires »), écrans : réglages de la
 * team (rôle choisi parmi ceux du serveur, noms Unicode affichés tels quels, durée, maximum, qui peut le donner,
 * journal, avertissement de hiérarchie), liste des octrois (expire dans, donné par, raison) avec Prolonger / Retirer
 * et formulaire « Donner » (recherche d'une personne), vue d'ensemble de l'onglet Bot Esport HQ et commandes, phrases
 * du journal. Client simulé : aucun réseau.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { ErreurEsport, type ClientEsport } from './client';
import { definirLangue } from './i18n';
import { phraseJournal } from './libelles';
import { ReglagesRolesTemp } from './ui/rolesTemp/ReglagesRolesTemp';
import { OctroisRolesTemp } from './ui/rolesTemp/OctroisRolesTemp';
import { CarteRolesTemp, ReglagesRolesTempClub } from './ui/rolesTemp/CarteRolesTemp';
import { fonctionnalitesBot } from './ui/bot/sections';
import type { EtatBotAdmin } from './bot/api';
import type { EtatRolesTemp, OctroiRoleTemp, ServeurRolesTemp } from './rolesTemp/api';

const theme = themeHub('nuit');
afterEach(() => definirLangue('fr'));

const NOM_TF = '⟡ 🎤𝙄𝙣𝙩𝙚𝙧𝙫𝙚𝙣𝙖𝙣𝙩 𝙏𝙁 ⟡';
const NOM_VAL = '⟡ 🎤Intervenant VAL ⟡';
const TEAM = '11111111-1111-4111-8111-111111111111';
const MAINTENANT = Date.parse('2026-11-10T10:00:00.000Z');
const LIMITES = { dureeMinH: 1, dureeMaxH: 720, dureeDefautH: 24, maxMin: 1, maxMax: 100, maxDefaut: 10, roles: 20 };

const octroi = (maj: Partial<OctroiRoleTemp> = {}): OctroiRoleTemp => ({ id: 'o1', roleNom: NOM_TF, membreId: '820', membreNom: 'Try-Out Un', accordeParNom: 'Coach TF', raison: 'Try-out du samedi', accordeLe: '2026-11-10T09:00:00.000Z', expireLe: '2026-11-11T09:00:00.000Z', essais: 0, erreur: null, ...maj });

function etatDe(maj: Partial<EtatRolesTemp> = {}): EtatRolesTemp {
  return {
    peutRegler: true,
    peutGerer: true,
    reglages: { actif: true, roleId: '730', roleNom: NOM_TF, dureeDefautH: 24, maxSimultanes: 10, rolesAutorises: [], salonJournalId: null, mp: true },
    rolesEquipe: [
      { id: 'r-coach', nom: 'Coach', cle: 'coach', defaut: true },
      { id: 'r-joueur', nom: 'Joueur', cle: 'joueur', defaut: false },
    ],
    actifs: [octroi()],
    serveur: { id: '700', nom: 'Club' },
    bot: true,
    limites: LIMITES,
    lienInvitation: null,
    ...maj,
  };
}

const serveurDe = (maj: Partial<ServeurRolesTemp> = {}): ServeurRolesTemp => ({
  bot: true,
  erreur: null,
  membreTrouve: true,
  gererRoles: true,
  positionBot: 5,
  roleBot: 'Esport HQ',
  roles: [
    { id: '730', nom: NOM_TF, couleur: null, position: 2 },
    { id: '731', nom: NOM_VAL, couleur: null, position: 9 },
  ],
  salons: [{ id: '713', nom: 'journaux', position: 1 }],
  ...maj,
});

type Appel = { chemin: string; methode?: string; corps?: unknown };

function fauxClient(etat: EtatRolesTemp, serveur: ServeurRolesTemp = serveurDe(), { refus = false }: { refus?: boolean } = {}) {
  const appels: Appel[] = [];
  const requete = async (chemin: string, methode?: string, corps?: unknown): Promise<unknown> => {
    appels.push({ chemin, methode, corps });
    if (refus) throw new ErreurEsport('Vous n’avez pas la permission de faire cela.', 403, 'permission');
    const base = `/teams/${TEAM}/roles-temporaires`;
    if (chemin === base && !methode) return etat;
    if (chemin === `${base}/discord`) return serveur;
    if (chemin === `${base}/reglages` && methode === 'PUT') return { ...etat, reglages: { ...etat.reglages, ...(corps as object) }, avertissement: null };
    if (chemin.startsWith(`${base}/membres?q=`)) return { membres: [{ id: '800000000000000077', nom: 'Zoé', pseudo: 'zoe' }, { id: '800000000000000078', nom: 'Zorro le Grand', pseudo: 'zorro' }] };
    if (chemin === base && methode === 'POST') return { ok: true, prolonge: false, octroi: octroi({ id: 'o2', membreNom: (corps as { membreNom: string }).membreNom, expireLe: '2026-11-11T22:00:00.000Z' }) };
    if (/\/prolonger$/.test(chemin) && methode === 'POST') return { ok: true, octroi: octroi({ expireLe: '2026-11-12T09:00:00.000Z' }) };
    if (methode === 'DELETE') return { ok: true, deja: false };
    throw new Error(`inattendu : ${methode ?? 'GET'} ${chemin}`);
  };
  return { client: { requete } as unknown as ClientEsport, appels };
}

test('réglages : rôle choisi parmi ceux du serveur (nom Unicode tel quel), durée, maximum, qui peut donner, journal, MP ; enregistré', async () => {
  const { client, appels } = fauxClient(etatDe({ reglages: { actif: false, roleId: null, roleNom: '', dureeDefautH: 24, maxSimultanes: 10, rolesAutorises: [], salonJournalId: null, mp: true } }));
  await render(<ReglagesRolesTemp theme={theme} client={client} teamId={TEAM} />);
  await screen.findByTestId('esport-rt-reglages');
  await fireEvent.press(await screen.findByTestId('esport-rt-role-modifier'));
  expect(await screen.findByText(NOM_TF)).toBeTruthy();
  expect(screen.getByText(new RegExp(NOM_VAL))).toBeTruthy();
  expect(screen.getByText(/au-dessus du rôle du bot/)).toBeTruthy();
  expect(screen.getByText(/Par défaut : Coach, Manager, Propriétaire/)).toBeTruthy();
  await fireEvent(screen.getByTestId('esport-rt-actif'), 'valueChange', true);
  await fireEvent.press(await screen.findByTestId('esport-rt-role-730'));
  await fireEvent.changeText(screen.getByTestId('esport-rt-duree'), '48');
  await fireEvent.changeText(screen.getByTestId('esport-rt-maximum'), '3');
  await fireEvent.press(screen.getByTestId('esport-rt-autorises-modifier'));
  await fireEvent.press(screen.getByTestId('esport-rt-autorises-r-joueur'));
  await fireEvent.press(screen.getByTestId('esport-rt-journal-modifier'));
  await fireEvent.press(screen.getByTestId('esport-rt-journal-713'));
  await fireEvent(screen.getByTestId('esport-rt-mp'), 'valueChange', false);
  await fireEvent.press(screen.getByTestId('esport-rt-enregistrer'));
  await screen.findByText('Réglages enregistrés.');
  const put = appels.find(a => a.methode === 'PUT')!;
  expect(put.chemin).toBe(`/teams/${TEAM}/roles-temporaires/reglages`);
  expect(put.corps).toMatchObject({ actif: true, roleId: '730', roleNom: NOM_TF, dureeDefautH: 48, maxSimultanes: 3, rolesAutorises: ['r-joueur'], salonJournalId: '713', mp: false });
  expect(screen.getByText(/Commande Discord : \/role-temp donner/)).toBeTruthy();
});

test('réglages : le rôle du bot sous le rôle temporaire est signalé (hiérarchie), la permission « Gérer les rôles » aussi', async () => {
  const { client } = fauxClient(etatDe(), serveurDe({ positionBot: 1, gererRoles: false }));
  await render(<ReglagesRolesTemp theme={theme} client={client} teamId={TEAM} />);
  const alerte = await screen.findByTestId('esport-rt-hierarchie');
  expect(alerte.props.children ?? '').toBeDefined();
  expect(screen.getByText(new RegExp(`Le rôle du bot \\(« Esport HQ »\\) est au même niveau ou sous « ${NOM_TF.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} »`))).toBeTruthy();
  expect(screen.getByTestId('esport-rt-gerer-roles')).toBeTruthy();
});

test('réglages : rien pour qui ne peut pas les régler ; anglais', async () => {
  const { client } = fauxClient(etatDe({ peutRegler: false }));
  const { toJSON } = await render(<ReglagesRolesTemp theme={theme} client={client} teamId={TEAM} />);
  await waitFor(() => expect(screen.queryByTestId('esport-rt-chargement')).toBeNull());
  expect(toJSON()).toBeNull();
  definirLangue('en');
  const autre = fauxClient(etatDe());
  await render(<ReglagesRolesTemp theme={theme} client={autre.client} teamId={TEAM} />);
  expect(await screen.findByText('Enable temporary roles for this team')).toBeTruthy();
});

test('liste : personne, expire dans, donné par, raison ; Prolonger (durée par défaut) et Retirer (confirmé)', async () => {
  const { client, appels } = fauxClient(etatDe());
  await render(<OctroisRolesTemp theme={theme} client={client} teamId={TEAM} maintenant={() => MAINTENANT} />);
  const ligne = await screen.findByTestId('esport-rto-o1');
  expect(ligne).toBeTruthy();
  expect(screen.getByText('Try-Out Un')).toBeTruthy();
  expect(screen.getByText(/expire dans 23 h/)).toBeTruthy();
  expect(screen.getByText(/Donné par Coach TF · Raison : Try-out du samedi/)).toBeTruthy();
  expect(screen.getByTestId('esport-rto-compteur').props.children).toBeDefined();
  expect(screen.getByText(new RegExp('1 actif\\(s\\) sur 10'))).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-rto-prolonger-o1'));
  await screen.findByText(/Rôle prolongé jusqu’au/);
  expect(appels.find(a => a.chemin.endsWith('/o1/prolonger'))!.corps).toEqual({ dureeH: 24 });
  await fireEvent.press(screen.getByTestId('esport-rto-retirer-o1'));
  await fireEvent.press(await screen.findByTestId('esport-rto-retirer-o1-confirmer'));
  await screen.findByText('Rôle retiré.');
  expect(appels.some(a => a.methode === 'DELETE' && a.chemin === `/teams/${TEAM}/roles-temporaires/o1`)).toBe(true);
});

test('formulaire Donner : recherche d’une personne du serveur, choix, durée et raison ; erreur du serveur affichée telle quelle', async () => {
  const { client, appels } = fauxClient(etatDe({ actifs: [] }));
  await render(<OctroisRolesTemp theme={theme} client={client} teamId={TEAM} maintenant={() => MAINTENANT} />);
  expect(await screen.findByTestId('esport-rto-vide')).toBeTruthy();
  expect(screen.getByTestId('esport-rto-donner-bouton').props.accessibilityState?.disabled).toBe(true);
  await fireEvent.changeText(screen.getByTestId('esport-rto-recherche'), 'zo');
  await fireEvent.press(screen.getByTestId('esport-rto-chercher'));
  await fireEvent.press(await screen.findByTestId('esport-rto-membre-800000000000000077'));
  expect(screen.getByTestId('esport-rto-choisie').props.children).toContain('Zoé');
  await fireEvent.changeText(screen.getByTestId('esport-rto-duree'), '12');
  await fireEvent.changeText(screen.getByTestId('esport-rto-raison'), 'Remplace un joueur');
  await fireEvent.press(screen.getByTestId('esport-rto-donner-bouton'));
  await screen.findByText(/Rôle donné à Zoé jusqu’au/);
  expect(appels.find(a => a.methode === 'POST')!.corps).toEqual({ membreId: '800000000000000077', membreNom: 'Zoé', dureeH: 12, raison: 'Remplace un joueur' });
  expect(appels.some(a => a.chemin.includes('/membres?q=zo'))).toBe(true);
});

test('liste : absente pour qui n’a pas le droit (403) ; rôles temporaires désactivés = indication, pas de formulaire', async () => {
  const refuse = fauxClient(etatDe(), serveurDe(), { refus: true });
  const { toJSON } = await render(<OctroisRolesTemp theme={theme} client={refuse.client} teamId={TEAM} />);
  await waitFor(() => expect(toJSON()).toBeNull());
  const inactif = fauxClient(etatDe({ actifs: [], reglages: { actif: false, roleNom: '', dureeDefautH: 24, maxSimultanes: 10 } }));
  await render(<OctroisRolesTemp theme={theme} client={inactif.client} teamId={TEAM} />);
  expect(await screen.findByTestId('esport-rto-inactif')).toBeTruthy();
  expect(screen.queryByTestId('esport-rto-donner')).toBeNull();
});

test('onglet Bot Esport HQ : carte « Rôles temporaires », vue d’ensemble des teams et commandes /role-temp réservées à un rôle', async () => {
  const appels: Appel[] = [];
  const conf = {
    equipes: [
      { id: 't1', nom: 'The Final LZ0', jeu: 'valorant', actif: true, roleNom: NOM_TF, dureeDefautH: 24, maxSimultanes: 10, actifs: 2 },
      { id: 't2', nom: 'Valorant LZ0', jeu: 'valorant', actif: false, roleNom: '', dureeDefautH: 24, maxSimultanes: 10, actifs: 0 },
    ],
    commandes: { donner: { actif: true, roles: [] }, retirer: { actif: true, roles: [] }, liste: { actif: true, roles: [] } },
    serveur: { id: '700', nom: 'Club' },
    bot: true,
    choix: { commandes: ['donner', 'retirer', 'liste'], limites: LIMITES },
    lienInvitation: null,
  };
  const client = {
    requete: async (chemin: string, methode?: string, corps?: unknown) => {
      appels.push({ chemin, methode, corps });
      if (chemin === '/roles-temp/config' && !methode) return conf;
      if (chemin === '/roles-temp/config/commandes' && methode === 'PUT') return { ...conf, commandes: { ...conf.commandes, ...(corps as object) } };
      if (chemin === '/roles-temp/discord') return serveurDe({ roles: [{ id: '720', nom: 'Staff', couleur: null, position: 2 }] });
      throw new Error(`inattendu : ${methode ?? 'GET'} ${chemin}`);
    },
  } as unknown as ClientEsport;
  const ouvrir = jest.fn();
  await render(<CarteRolesTemp theme={theme} client={client} ouvrirTeam={ouvrir} />);
  expect(await screen.findByText(`The Final LZ0 : rôle ${NOM_TF}, 24 h, 2 actif(s)`)).toBeTruthy();
  expect(screen.getByText('Valorant LZ0 : désactivé')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-rtc-regler-t2'));
  expect(ouvrir).toHaveBeenCalledWith('t2', 'module:discord');
  expect(screen.getByText('/role-temp donner : donner le rôle')).toBeTruthy();
  await fireEvent(screen.getByTestId('esport-rtc-cmd-retirer-actif'), 'valueChange', false);
  await fireEvent.press(await screen.findByTestId('esport-rtc-cmd-donner-roles-modifier'));
  await fireEvent.press(await screen.findByTestId('esport-rtc-cmd-donner-roles-720'));
  await fireEvent.press(screen.getByTestId('esport-rtc-cmd-enregistrer'));
  await screen.findByText('Commandes enregistrées.');
  const put = appels.find(a => a.methode === 'PUT')!.corps as Record<string, { actif: boolean; roles: string[] }>;
  expect(put.retirer).toEqual({ actif: false, roles: [] });
  expect(put.donner).toEqual({ actif: true, roles: ['720'] });
});

test('registre des fonctionnalités : carte « Rôles temporaires » avec son état', async () => {
  const carte = fonctionnalitesBot().find(f => f.id === 'roles_temp')!;
  expect(carte).toBeTruthy();
  expect(carte.titre()).toBe('Rôles temporaires');
  expect(carte.bientot).toBeFalsy();
  expect(carte.Reglages).toBe(ReglagesRolesTempClub);
  const ctx = (rolesTemp?: { actif: boolean; configurer: boolean }) => ({ theme, client: {} as ClientEsport, large: false, etat: { rolesTemp } as unknown as EtatBotAdmin, ouvrirSection: () => undefined });
  expect(carte.etat?.(ctx({ actif: true, configurer: true }))).toEqual({ texte: 'Activée', ton: 'ok' });
  expect(carte.etat?.(ctx())).toEqual({ texte: 'Désactivée', ton: 'neutre' });
});

test('journal d’activité : phrases des rôles temporaires (donné, prolongé, retiré, échu)', () => {
  const noms = { max12345: 'Max' };
  const e = (action: string, meta: Record<string, unknown>) => ({ id: '1', action, acteur: 'max12345', entiteType: null, entiteId: null, meta, date: '' });
  expect(phraseJournal(e('discord.role_temp_given', { role: NOM_TF, membre: 'Zoé', prolonge: false }), noms)).toBe(`Max a donné le rôle temporaire « ${NOM_TF} » à Zoé`);
  expect(phraseJournal(e('discord.role_temp_given', { role: NOM_TF, membre: 'Zoé', prolonge: true }), noms)).toMatch(/a prolongé le rôle temporaire/);
  expect(phraseJournal(e('discord.role_temp_removed', { role: NOM_TF, membre: 'Zoé', expire: false }), noms)).toMatch(/a retiré le rôle temporaire/);
  expect(phraseJournal(e('discord.role_temp_removed', { role: NOM_TF, membre: 'Zoé', expire: true }), noms)).toBe(`Le rôle temporaire « ${NOM_TF} » de Zoé est arrivé à échéance`);
});
