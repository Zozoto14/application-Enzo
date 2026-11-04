/**
 * Tickets Discord (docs/esport/tickets.md), écrans : configuration (connexion « secours » avec l'intent à activer,
 * permissions du bot qui manquent, création d'une catégorie avec formulaire, panneau : aperçu comme sur Discord et
 * publication), navigation (entrée « Tickets », barre du bas du téléphone : cinq entrées au plus, le reste dans
 * « Plus »).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import type { ClientEsport } from './client';
import { definirLangue } from './i18n';
import { navEsport, navMobile } from './ui/CadreEsport';
import { ConfigTickets } from './ui/tickets/ConfigTickets';
import type { Categorie, ChargeDiscord, ConfigTickets as Config, DetailTicket, Panneau, ResumeTicket } from './tickets/api';
import { ListeTickets } from './ui/tickets/TicketsStaff';

const theme = themeHub('nuit');
afterEach(() => definirLangue('fr'));

const VIDE = { fr: '', en: '' };
function configDe(): Config {
  return {
    general: { actif: true, guildId: '700', guildNom: 'Club', categorieOuverts: '710', categorieArchives: null, salonJournaux: null, langue: 'auteur', fermetureAutoH: 168, avertissementH: 24, suppressionArchivesJours: 7, retentionJours: 365, copierPieces: true, pieceMaxMo: 8 },
    messages: {},
    messagesDefaut: { accueil: { fr: 'Bonjour {utilisateur}', en: 'Hi {utilisateur}' } },
    horaires: { actif: false, fuseau: 'Europe/Paris', plages: [] },
    commandes: { ouvrir: { actif: true, roles: [] } },
    categories: [],
    panneaux: [],
    listeNoire: [],
    rolesApp: [{ cle: 'club:r1', nom: 'Support', couleur: '#336699', famille: 'club' }],
    tableauxCm: [],
    choix: { langues: ['auteur', 'en_fr', 'fr_en', 'fr', 'en'], icones: ['billets', 'membres'], priorites: ['faible', 'moyen', 'urgent', 'critique'], liaisons: ['aucune', 'sponsors', 'cm', 'fiche'], commandes: ['ouvrir', 'prendre'], commandesStaff: ['prendre'], limites: {}, permissionsBot: [] },
    bot: true,
    lienInvitation: 'https://discord.com/oauth2/authorize?client_id=1',
  };
}

function fauxClient(conf: Config) {
  const appels: Array<{ chemin: string; methode?: string; corps?: unknown }> = [];
  const requete = async (chemin: string, methode?: string, corps?: unknown): Promise<unknown> => {
    appels.push({ chemin, methode, corps });
    if (chemin === '/tickets/config') return conf;
    if (chemin === '/tickets/etat') return { actif: true, bot: true, connexion: { mode: 'secours', depuis: '2026-11-04T10:00:00.000Z', code: 4014, intentRefuse: true } };
    if (chemin === '/tickets/config/discord')
      return {
        bot: true,
        serveurs: [{ id: '700', nom: 'Club' }],
        serveur: { id: '700', nom: 'Club' },
        salons: [{ id: '710', nom: 'Tickets', type: 'categorie', parent: null }, { id: '713', nom: 'support', type: 'texte', parent: null }],
        roles: [{ id: '720', nom: 'Staff', couleur: null }],
        permissions: { membreTrouve: true, serveur: ['gerer_roles'], ouverts: { id: '710', nom: 'Tickets', manquantes: [] }, archives: null, journaux: null },
      };
    if (chemin === '/tickets/config/categories' && methode === 'POST') {
      const c = corps as Partial<Categorie>;
      const cat = { ...(c as Categorie), id: 'cat1', position: 0 };
      conf.categories = [cat];
      return { id: 'cat1', categories: conf.categories };
    }
    if (chemin === '/tickets/config/panneaux' && methode === 'POST') {
      const p = { ...(corps as Panneau), id: 'pan1', messageId: null, publieLe: null, erreur: null, majLe: '' };
      return p;
    }
    if (chemin === '/tickets/config/panneaux/pan1' && methode === 'PATCH') return { ...(corps as Panneau), id: 'pan1', messageId: null, publieLe: null, erreur: null, majLe: '' };
    if (chemin === '/tickets/config/panneaux/pan1/apercu') {
      const charge: ChargeDiscord = { embeds: [{ title: 'Club support · Support du club', description: 'Open a ticket\n\n> Ouvrez un ticket', color: 0x5865f2 }], components: [{ type: 1, components: [{ type: 2, style: 1, label: 'Help · Aide', custom_id: 'tk:o:cat1' }] }] };
      return { charge };
    }
    if (chemin === '/tickets/config/panneaux/pan1/publier') return { id: 'pan1', titre: VIDE, texte: VIDE, couleur: '#5865f2', imageElementId: null, style: 'boutons', categories: [], salonId: '713', messageId: '999', publieLe: '2026-11-04T10:00:00.000Z', erreur: null, majLe: '' };
    throw new Error(`inattendu : ${methode ?? 'GET'} ${chemin}`);
  };
  return { client: { requete } as unknown as ClientEsport, appels };
}

test('connexion : « secours » avec l’intent MESSAGE_CONTENT à activer, et les permissions du bot qui manquent', async () => {
  const { client } = fauxClient(configDe());
  await render(<ConfigTickets theme={theme} client={client} large />);
  await screen.findByTestId('esport-tk-connexion-secours');
  expect(screen.getByTestId('esport-tk-conf-intent')).toBeTruthy();
  await waitFor(() => expect(screen.getByTestId('esport-tk-conf-permissions')).toBeTruthy());
  expect(screen.getByText(/Gérer les rôles/)).toBeTruthy();
});

test('catégorie : création avec un champ de formulaire, rôles de l’app', async () => {
  const conf = configDe();
  const { client, appels } = fauxClient(conf);
  await render(<ConfigTickets theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-conf-onglet-categories'));
  await fireEvent.press(screen.getByTestId('esport-tk-cat-nouvelle'));
  await fireEvent.changeText(screen.getByTestId('esport-tk-cat-nom-fr'), 'Recrutement');
  await fireEvent.changeText(screen.getByTestId('esport-tk-cat-nom-en'), 'Recruitment');
  await fireEvent.press(screen.getByTestId('esport-tk-cat-roles-app-club:r1'));
  await fireEvent.press(screen.getByTestId('esport-tk-cat-champ-ajouter'));
  await fireEvent.changeText(screen.getByTestId('esport-tk-cat-champ-0-libelle-fr'), 'Ton rang');
  await fireEvent.press(screen.getByTestId('esport-tk-cat-enregistrer'));
  await screen.findByTestId('esport-tk-cat-cat1');
  const post = appels.find(a => a.chemin === '/tickets/config/categories' && a.methode === 'POST')!.corps as Categorie;
  expect(post.nom).toEqual({ fr: 'Recrutement', en: 'Recruitment' });
  expect(post.rolesApp).toEqual(['club:r1']);
  expect(post.formulaire[0].libelle.fr).toBe('Ton rang');
  expect(post.fermetureAutoH).toBeNull();
});

test('panneau : aperçu comme sur Discord, puis publication', async () => {
  const conf = configDe();
  const { client, appels } = fauxClient(conf);
  await render(<ConfigTickets theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-conf-onglet-panneaux'));
  await fireEvent.press(screen.getByTestId('esport-tk-pan-nouveau'));
  await fireEvent.changeText(screen.getByTestId('esport-tk-pan-titre-fr'), 'Support du club');
  await waitFor(() => expect(screen.getByTestId('esport-tk-pan-salon-713')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('esport-tk-pan-salon-713'));
  await fireEvent.press(screen.getByTestId('esport-tk-pan-apercu'));
  await screen.findByTestId('esport-tk-apercu');
  expect(screen.getByText('Help · Aide')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-tk-pan-publier'));
  await screen.findByTestId('esport-tk-pan-editeur-avis');
  expect(appels.some(a => a.chemin === '/tickets/config/panneaux/pan1/publier')).toBe(true);
});

test('navigation : entrée « Tickets » selon le droit ; téléphone : cinq entrées au plus, le reste dans « Plus »', () => {
  expect(navEsport(false, false, false).map(n => n.cle)).toEqual(['dashboard', 'teams', 'membres']);
  expect(navEsport(false, false, true).map(n => n.cle)).toEqual(['dashboard', 'teams', 'membres', 'tickets']);
  const m = navMobile(true, true, true);
  expect(m.barre.map(n => n.cle)).toEqual(['dashboard', 'teams', 'membres', 'tickets', 'plus']);
  expect(m.plus.map(n => n.cle)).toEqual(['jeux', 'statistiques']);
  expect(navMobile(true, true, false).plus).toEqual([]);
});

// ------------------------------------------------------------------ Étape 3 : tickets dans l'app

const CAT = { id: 'cat1', nom: { fr: 'Recrutement', en: 'Recruitment' }, couleur: '#22aa66', icone: 'membres', actif: true };
const resumeTk = (numero: number, nonLu: boolean): ResumeTicket => ({ id: `00000000-0000-0000-0000-00000000000${numero}`, numero, categorie: CAT, statut: 'ouvert', priorite: 'urgent', auteur: { discordId: '8001', nom: 'Léa', compte: null }, responsable: null, ouvertLe: '2026-11-04T10:00:00.000Z', derniereActivite: '2026-11-04T10:05:00.000Z', fermeLe: null, note: null, nonLu });

function fauxClientTickets() {
  const appels: Array<{ chemin: string; methode?: string; corps?: unknown }> = [];
  const detail = (): DetailTicket => ({
    ...resumeTk(1, false),
    nonLuDepuis: null,
    salon: { id: '7001', nom: 'ticket-0001-lea', supprime: false },
    reponses: [{ id: 'rang', libelle: { fr: 'Ton rang', en: 'Your rank' }, valeur: 'Diamant 2' }],
    raison: null,
    noteCommentaire: null,
    liaison: { type: 'aucune' },
    liaisonCategorie: { type: 'aucune' },
    purge: false,
    membres: [],
    messages: [
      { id: 'm1', genre: 'discord', auteur: { nom: 'Léa', discordId: '8001', compte: null }, staff: false, contenu: 'Bonjour, je postule', envoi: 'ok', le: '2026-11-04T10:01:00.000Z', modifieLe: null, supprimeLe: null, pieces: [] },
      { id: 'm2', genre: 'note', auteur: { nom: 'Kai', discordId: null, compte: 'kai' }, staff: true, contenu: 'À vérifier', envoi: 'ok', le: '2026-11-04T10:02:00.000Z', modifieLe: null, supprimeLe: null, pieces: [] },
    ],
    droits: { repondre: true, gerer: false },
  });
  const requete = async (chemin: string, methode?: string, corps?: unknown): Promise<unknown> => {
    appels.push({ chemin, methode, corps });
    if (chemin.startsWith('/tickets?')) return { tickets: [resumeTk(1, true), resumeTk(2, false)], categories: [CAT], droits: { repondre: true, gerer: false, configurer: false } };
    if (chemin === '/tickets/preferences') return { mpNouveau: false, mpMessage: true };
    if (/\/tickets\/[^/]+$/.test(chemin)) return detail();
    if (chemin.endsWith('/lu')) return { ok: true };
    if (chemin.endsWith('/notes') || chemin.endsWith('/messages') || chemin.endsWith('/prendre')) return detail();
    throw new Error(`inattendu : ${methode ?? 'GET'} ${chemin}`);
  };
  return { client: { requete } as unknown as ClientEsport, appels };
}

test('liste : non lus marqués ; vue : conversation, note interne distinguée, réponse et note envoyées aux bonnes routes', async () => {
  const { client, appels } = fauxClientTickets();
  await render(<ListeTickets theme={theme} client={client} large />);
  await screen.findByTestId('esport-tk-ticket-1');
  expect(screen.getByTestId('esport-tk-ticket-1-non-lu')).toBeTruthy();
  expect(screen.queryByTestId('esport-tk-ticket-2-non-lu')).toBeNull();
  await fireEvent.press(screen.getByTestId('esport-tk-ticket-1'));
  await screen.findByTestId('esport-tk-vue');
  expect(screen.getByText('Diamant 2')).toBeTruthy();
  expect(screen.getByTestId('esport-tk-msg-m2-note')).toBeTruthy();
  expect(appels.some(a => a.chemin.endsWith('/lu') && a.methode === 'POST')).toBe(true);
  await fireEvent.changeText(screen.getByTestId('esport-tk-message'), 'Bienvenue !');
  await fireEvent.press(screen.getByTestId('esport-tk-envoyer'));
  await waitFor(() => expect(appels.some(a => a.chemin.endsWith('/messages') && a.methode === 'POST')).toBe(true));
  expect((appels.find(a => a.chemin.endsWith('/messages'))!.corps as { texte: string }).texte).toBe('Bienvenue !');
  await fireEvent(screen.getByTestId('esport-tk-mode-note'), 'valueChange', true);
  await fireEvent.changeText(screen.getByTestId('esport-tk-message'), 'Note privée');
  await fireEvent.press(screen.getByTestId('esport-tk-envoyer'));
  await waitFor(() => expect(appels.some(a => a.chemin.endsWith('/notes'))).toBe(true));
  expect(appels.filter(a => a.chemin.endsWith('/messages')).length).toBe(1);
  // Pas de droit de gestion : ni assignation ni transcript.
  expect(screen.queryByTestId('esport-tk-vue-assigner-kai')).toBeNull();
  expect(screen.queryByTestId('esport-tk-transcript')).toBeNull();
});
