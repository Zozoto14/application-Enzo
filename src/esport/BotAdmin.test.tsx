/**
 * Administration › Bot Esport HQ : sous-onglet visible pour le Fondateur et pour qui configure les tickets (jamais
 * pour tickets.voir seul ni pour un autre droit d'Administration) ; sections Connexion et état (configuration sans
 * secret, diagnostic, invitation, vérification du serveur, commandes à réenregistrer et bouton), Serveur Discord,
 * Messages et langue, Annonces par team, Commandes, Fonctionnalités (registre, salons vocaux « Bientôt ») ; liens
 * vers Tickets › Configuration (à la bonne section) et vers le Discord d'une team.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { REGISTRE } from '../hub/registre';
import { themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { oublierSessions, type ClientEsport } from './client';
import { definirLangue } from './i18n';
import { sousOngletsAdmin } from './ui/administration/PageAdministration';
import { Esport, fabrique } from './ui/RacineEsport';
import { FONCTIONNALITES_BOT } from './ui/bot/sections';

jest.mock('./tempsReel/hooks', () => ({ ...jest.requireActual('./tempsReel/hooks'), useTempsReel: () => 'direct' }));

const theme = themeHub('nuit');
const relaisReel = fabrique.relais;
const clientReel = fabrique.client;
afterEach(() => {
  fabrique.relais = relaisReel;
  fabrique.client = clientReel;
  oublierSessions();
  definirLangue('fr');
});

const DIAG = { bot: true, serveur: { id: '700000000000000001', nom: 'Club' }, categorie: true, actif: true, gatewayActivee: true, reveilConfigure: null, processus: { role: 'meneur', raison: null, le: '2026-11-07T10:00:00.000Z', frais: true }, meneur: true, connexion: { mode: 'direct', depuis: '2026-11-07T10:00:00.000Z', gateway: 'pret' }, cron: { le: '2026-11-07T10:00:00.000Z', frais: true } };

const ETAT = {
  fondateur: true,
  bot: { configure: true, applicationId: '424242424242424242', clePublique: true, jeton: true },
  invitation: 'https://discord.com/oauth2/authorize?client_id=424242424242424242&scope=bot%20applications.commands&permissions=378225806416',
  permissions: { entier: '378225806416', fonctionnalites: [{ id: 'annonces', permissions: ['voir_salons', 'envoyer'] }, { id: 'tickets', permissions: ['gerer_salons'] }] },
  tickets: { actif: true, langue: 'en_fr', connexion: { mode: 'direct', depuis: '2026-11-07T10:00:00.000Z' }, diagnostic: DIAG, commandes: { ouvrir: { actif: true, roles: [] }, fermer: { actif: false, roles: [] }, tickets: { actif: true, roles: ['1', '2'] } } },
  serveur: { id: '700000000000000001', nom: 'Club' },
  teams: [
    { id: '11111111-1111-4111-8111-111111111111', nom: 'Team Alpha', jeu: 'valorant', archivee: false, moduleActif: true, webhook: { invalide: false, dernierSucces: null }, serveurBot: { salonNom: 'annonces', invalide: false, dernierSucces: null }, langue: 'fr', filFr: true, relancesMp: true, abandonnes: 0 },
    { id: '22222222-2222-4222-8222-222222222222', nom: 'Team Bravo', jeu: 'valorant', archivee: false, moduleActif: false, webhook: null, serveurBot: null, langue: 'en', filFr: false, relancesMp: false, abandonnes: 0 },
  ],
  commandes: [
    { nom: 'aide', description: 'Ce que sait faire le bot Esport', partout: true, admin: false, sousCommandes: [] },
    { nom: 'esport-lier-serveur', description: 'Lier ce serveur', partout: false, admin: true, sousCommandes: [] },
    { nom: 'ticket', description: 'Tickets du support', partout: false, admin: false, sousCommandes: [{ nom: 'ouvrir', description: 'Ouvrir un ticket' }, { nom: 'fermer', description: 'Fermer ce ticket' }] },
    { nom: 'tickets', description: 'Tes tickets ouverts', partout: false, admin: false, sousCommandes: [] },
  ],
};

type Droits = { superAdmin?: boolean; roles?: boolean; tickets?: 'voir' | 'configurer' | null };

function fauxClient(d: Droits, commandes: Record<string, unknown> = { bot: true, attendues: ['aide', 'ticket'], enregistrees: ['aide'], aJour: false, manquantes: ['ticket'], enTrop: [], differentes: [], erreur: null }) {
  const moi = {
    compte: d.superAdmin ? 'principal' : 'lea12345',
    superAdmin: Boolean(d.superAdmin),
    profil: { pseudo: d.superAdmin ? 'Fondateur' : 'Léa', riotId: null, discord: null },
    peutCreerTeam: Boolean(d.superAdmin),
    peutGererJeux: Boolean(d.superAdmin),
    peutVoirStatistiques: Boolean(d.superAdmin),
    peutGererRoles: Boolean(d.superAdmin || d.roles),
    peutGererDevblog: Boolean(d.superAdmin),
  };
  const requete = jest.fn(async (chemin: string, methode?: string) => {
    if (chemin === '/tickets/moi') {
      if (!d.tickets && !d.superAdmin) throw Object.assign(new Error('404'), { status: 404 });
      const configurer = d.superAdmin || d.tickets === 'configurer';
      return { voir: d.tickets === 'voir', repondre: false, gerer: false, configurer, actif: true };
    }
    if (chemin === '/bot-discord') return ETAT;
    if (chemin === '/bot-discord/commandes') return methode === 'POST' ? { ok: true, n: 2, bot: true, attendues: ['aide', 'ticket'], enregistrees: ['aide', 'ticket'], aJour: true, manquantes: [], enTrop: [], differentes: [], erreur: null } : commandes;
    if (chemin === '/bot-discord/serveur') return { bot: true, serveur: { id: '700000000000000001', nom: 'Club' }, erreur: null, membreTrouve: true, complet: false, fonctionnalites: [{ id: 'annonces', manquantes: [] }, { id: 'tickets', manquantes: ['gerer_salons'] }] };
    if (chemin === '/tickets/compteur') return { nonLus: 0, ouverts: 0 };
    if (chemin === '/tickets/etat') return { actif: true, connexion: { mode: 'direct', depuis: null } };
    if (chemin === '/tickets/config') throw Object.assign(new Error('attente'), { status: 503 });
    if (chemin.startsWith('/tickets/config/discord')) return { bot: true, serveurs: [] };
    if (chemin.startsWith('/tickets')) return { tickets: [], categories: [], droits: { repondre: false, gerer: false, configurer: true } };
    if (chemin.startsWith('/roles-permissions')) return { moi: { fondateur: true, permissions: [] }, globaux: { roles: [], permissions: [], reservees: [] }, cm: { permissions: [] }, modele: { roles: [], permissions: [], modifiable: true }, teams: [], comptes: [] };
    if (chemin.startsWith('/cm/moi')) return { espace: false, club: [], teams: [] };
    throw Object.assign(new Error(`non prévu : ${chemin}`), { status: 404 });
  });
  const client = {
    config: { adresse: 'https://esport.test', jetonRelais: 'x' },
    ouvrir: async () => moi,
    moi: async () => moi,
    teams: async () => [],
    tableau: async () => ({ genereLe: '', teams: [], global: { resumesARediger: 0, evenementsSemaine: [], alertes: [] } }),
    notifications: jest.fn(async () => ({ nonLues: 0, noms: {}, liste: [] })),
    boiteResumes: async () => ({ depots: [], teams: [], types: [], deposants: [], attente: 0, nouveaux: 0, total: 0 }),
    requete,
  } as unknown as ClientEsport;
  return { client, requete };
}

async function monter(client: ClientEsport, mode: 'large' | 'telephone' = 'large') {
  fabrique.relais = () => ({ relais: 'https://relais.appdashboard.fr', jeton: 'jeton' });
  fabrique.client = () => client;
  return await render(
    <ModeAffichageForce mode={mode}>
      <Esport contexte={{}} theme={theme} registre={REGISTRE} onRetour={() => undefined} />
    </ModeAffichageForce>,
  );
}

async function ouvrirBot() {
  await fireEvent.press(await screen.findByTestId('esport-nav-administration'));
  await fireEvent.press(await screen.findByTestId('esport-admin-onglet-bot'));
  return screen.findByTestId('esport-bot');
}

test('ordre et droits : « Bot Esport HQ » entre Rôles et Devblog, selon son droit', () => {
  expect(sousOngletsAdmin({ statistiques: true, jeux: true, roles: true, bot: true, devblog: true })).toEqual(['statistiques', 'jeux', 'roles', 'bot', 'devblog']);
  expect(sousOngletsAdmin({ roles: true })).toEqual(['roles']);
  expect(sousOngletsAdmin({ bot: true })).toEqual(['bot']);
});

test('visible : Fondateur, et tickets.configurer (seul : la page s’ouvre directement) ; jamais tickets.voir seul ni roles.gerer seul', async () => {
  const r1 = await monter(fauxClient({ superAdmin: true }).client);
  expect(await ouvrirBot()).toBeTruthy();
  await r1.unmount();
  const r2 = await monter(fauxClient({ tickets: 'configurer' }).client);
  await fireEvent.press(await screen.findByTestId('esport-nav-administration'));
  expect(await screen.findByTestId('esport-bot')).toBeTruthy();
  expect(screen.queryByTestId('esport-admin-onglets')).toBeNull();
  await r2.unmount();
  const r3 = await monter(fauxClient({ tickets: 'voir' }).client);
  await screen.findByTestId('esport-nav-tickets');
  expect(screen.queryByTestId('esport-nav-administration')).toBeNull();
  await r3.unmount();
  const { client, requete } = fauxClient({ roles: true });
  await monter(client);
  await fireEvent.press(await screen.findByTestId('esport-nav-administration'));
  await screen.findByTestId('esport-roles-permissions');
  expect(screen.queryByTestId('esport-admin-onglet-bot')).toBeNull();
  expect(requete.mock.calls.some(c => c[0] === '/bot-discord')).toBe(false);
});

test('Connexion et état : configuration sans secret, diagnostic, invitation, vérification du serveur, commandes à réenregistrer', async () => {
  const { client, requete } = fauxClient({ superAdmin: true });
  await monter(client);
  await ouvrirBot();
  expect(await screen.findByTestId('esport-bot-connexion')).toBeTruthy();
  expect(screen.getByTestId('esport-bot-application')).toHaveTextContent(/424242424242424242/);
  expect(screen.getByTestId('esport-bot-jeton')).toHaveTextContent(/Présent/);
  expect(screen.getByTestId('esport-tk-diag')).toBeTruthy();
  expect(screen.getByTestId('esport-bot-invitation')).toHaveTextContent(/permissions=378225806416/);
  expect(screen.getByTestId('esport-bot-perm-annonces')).toHaveTextContent(/Voir les salons, Envoyer des messages/);
  expect(screen.getByTestId('esport-bot-inviter')).toBeTruthy();
  // Vérifier le serveur : ce qui manque, par fonctionnalité.
  await fireEvent.press(screen.getByTestId('esport-bot-verifier'));
  expect(await screen.findByTestId('esport-bot-verif-tickets')).toHaveTextContent(/Il manque : Gérer les salons/);
  expect(screen.getByTestId('esport-bot-verif-annonces')).toHaveTextContent(/Rien ne manque/);
  // Commandes : à réenregistrer, avec la commande cPanel et le bouton (le serveur fait l'enregistrement).
  expect(await screen.findByTestId('esport-bot-cmd-a-reenregistrer')).toHaveTextContent(/Absentes chez Discord : \/ticket/);
  expect(screen.getByTestId('esport-bot-cmd-cpanel')).toHaveTextContent(/discord-commandes\.mjs/);
  await fireEvent.press(screen.getByTestId('esport-bot-cmd-reenregistrer'));
  expect(await screen.findByTestId('esport-bot-cmd-a-jour')).toBeTruthy();
  expect(screen.getByTestId('esport-bot-cmd-avis')).toHaveTextContent(/2 commandes enregistrées/);
  expect(requete.mock.calls.some(c => c[0] === '/bot-discord/commandes' && c[1] === 'POST')).toBe(true);
  expect(screen.queryByTestId('esport-bot-cmd-cpanel')).toBeNull();
});

test('commandes à jour : pas d’alerte ni de commande cPanel', async () => {
  await monter(fauxClient({ superAdmin: true }, { bot: true, attendues: ['aide'], enregistrees: ['aide'], aJour: true, manquantes: [], enTrop: [], differentes: [], erreur: null }).client);
  await ouvrirBot();
  expect(await screen.findByTestId('esport-bot-cmd-a-jour')).toHaveTextContent(/1 commandes/);
  expect(screen.queryByTestId('esport-bot-cmd-a-reenregistrer')).toBeNull();
  expect(screen.queryByTestId('esport-bot-cmd-cpanel')).toBeNull();
});

test('Serveur Discord, Messages et langue, Annonces par team, Commandes, Fonctionnalités', async () => {
  await monter(fauxClient({ superAdmin: true }).client);
  await ouvrirBot();
  await fireEvent.press(screen.getByTestId('esport-bot-onglet-serveur'));
  expect(await screen.findByTestId('esport-bot-serveur-choisi')).toHaveTextContent(/Club/);
  expect(screen.getByTestId('esport-bot-serveur-teams')).toHaveTextContent(/1 sur 2/);

  await fireEvent.press(screen.getByTestId('esport-bot-onglet-messages'));
  expect(await screen.findByTestId('esport-bot-msg-tickets-langue')).toHaveTextContent(/Anglais puis français/);
  expect(screen.getByTestId('esport-bot-msg-team-11111111-1111-4111-8111-111111111111')).toHaveTextContent(/Anglais \+ fil français · Rappels en MP/);
  expect(screen.getByTestId('esport-bot-msg-team-22222222-2222-4222-8222-222222222222')).toHaveTextContent(/Message unique en anglais · Sans rappels en MP/);
  // Test des MP : panneau de la page Discord de la team, pour une team avec le module.
  expect(screen.getByTestId('esport-bot-msg-test-team-11111111-1111-4111-8111-111111111111')).toBeTruthy();
  expect(screen.queryByTestId('esport-bot-msg-test-team-22222222-2222-4222-8222-222222222222')).toBeNull();

  await fireEvent.press(screen.getByTestId('esport-bot-onglet-annonces'));
  expect(await screen.findByTestId('esport-bot-ann-11111111-1111-4111-8111-111111111111-webhook')).toHaveTextContent(/Webhook configuré/);
  expect(screen.getByTestId('esport-bot-ann-11111111-1111-4111-8111-111111111111-serveur')).toHaveTextContent(/#annonces/);
  expect(screen.getByTestId('esport-bot-ann-22222222-2222-4222-8222-222222222222-module')).toHaveTextContent(/Module Discord désactivé/);

  await fireEvent.press(screen.getByTestId('esport-bot-onglet-commandes'));
  expect(await screen.findByTestId('esport-bot-cmds-ticket-ouvrir')).toHaveTextContent(/Ouvrir un ticket/);
  expect(screen.getByTestId('esport-bot-cmds-reglage-fermer')).toHaveTextContent(/Coupée/);
  expect(screen.getByTestId('esport-bot-cmds-reglage-tickets')).toHaveTextContent(/rôles : 2/);
  expect(screen.getByTestId('esport-bot-cmds-esport-lier-serveur')).toHaveTextContent(/Admins du serveur/);

  await fireEvent.press(screen.getByTestId('esport-bot-onglet-fonctionnalites'));
  for (const f of FONCTIONNALITES_BOT) expect(await screen.findByTestId(`esport-bot-fn-${f.id}`)).toBeTruthy();
  expect(screen.getByTestId('esport-bot-fn-vocaux-bientot')).toBeTruthy();
  expect(screen.queryByTestId('esport-bot-fn-vocaux-ouvrir')).toBeNull();
  expect(screen.getByTestId('esport-bot-fn-tickets-ouvrir')).toBeTruthy();
});

test('liens : Commandes → Tickets › Configuration › Commandes ; Annonces → Discord de la team', async () => {
  const { client, requete } = fauxClient({ superAdmin: true });
  const r = await monter(client);
  await ouvrirBot();
  await fireEvent.press(screen.getByTestId('esport-bot-onglet-commandes'));
  await fireEvent.press(await screen.findByTestId('esport-bot-cmds-regler'));
  expect(await screen.findByTestId('esport-tickets')).toBeTruthy();
  // Configuration ouverte d'emblée (lue au serveur).
  await waitFor(() => expect(requete.mock.calls.some(c => c[0] === '/tickets/config')).toBe(true));
  await r.unmount();
  await monter(fauxClient({ superAdmin: true }).client);
  await ouvrirBot();
  await fireEvent.press(screen.getByTestId('esport-bot-onglet-annonces'));
  await fireEvent.press(await screen.findByTestId('esport-bot-ann-11111111-1111-4111-8111-111111111111-ouvrir'));
  await waitFor(() => expect(screen.queryByTestId('esport-bot')).toBeNull());
});
