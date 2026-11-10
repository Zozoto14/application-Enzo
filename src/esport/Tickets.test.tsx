/**
 * Tickets Discord (docs/esport/tickets.md), écrans : configuration (connexion « secours » avec l'intent à activer,
 * permissions du bot qui manquent, création d'une catégorie avec formulaire, panneau : aperçu comme sur Discord et
 * publication), navigation (entrée « Tickets », barre du bas du téléphone : cinq entrées au plus, le reste dans
 * « Plus ») ; Avis (moyenne, répartition, filtres, avis qui ouvre son ticket) et suppression d'un ticket fermé
 * (confirmation, avis gardé anonyme ou non, suppression groupée) ; catégories par défaut (choix à cocher, doublons
 * grisés, « À configurer : qui traite ? ») ; réglage « Le staff répond uniquement depuis l'AppDashboard ».
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import type { ClientEsport } from './client';
import { definirLangue } from './i18n';
import { ConfigTickets } from './ui/tickets/ConfigTickets';
import type { Categorie, ChargeDiscord, ConfigTickets as Config, DetailTicket, ListeAvis, ModeleCategorie, ModelePanneau, Panneau, ResumeTicket } from './tickets/api';
import { AvisTicketsPage } from './ui/tickets/AvisTickets';
import { ListeTickets } from './ui/tickets/TicketsStaff';
import { choisirDans } from '../ui/selecteurs/deplier';

const theme = themeHub('nuit');
afterEach(() => definirLangue('fr'));

const VIDE = { fr: '', en: '' };
function configDe(): Config {
  return {
    general: { actif: true, guildId: '700', guildNom: 'Club', categorieOuverts: '710', categorieArchives: null, salonJournaux: null, langue: 'auteur', fermetureAutoH: 168, avertissementH: 24, suppressionArchivesJours: 7, retentionJours: 365, retentionSuppressionJours: 30, copierPieces: true, pieceMaxMo: 8, reponsesAppSeules: true },
    messages: {},
    messagesDefaut: { accueil: { fr: 'Bonjour {utilisateur}', en: 'Hi {utilisateur}' } },
    horaires: { actif: false, fuseau: 'Europe/Paris', plages: [] },
    commandes: { ouvrir: { actif: true, roles: [] } },
    bienvenue: { actif: false, roleId: null, roleNom: '', salonId: null, message: 'Bienvenue {membre} ! Tu fais maintenant partie de **{role}** 💥', supprimerApresS: 10, depuis: null, existantsNotes: false },
    bienvenueEtat: {},
    bienvenueMessageDefaut: 'Bienvenue {membre} ! Tu fais maintenant partie de **{role}** 💥',
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
    if (chemin === '/tickets/config/bienvenue' && methode === 'PUT') return { ...conf, bienvenue: { ...conf.bienvenue, ...(corps as object), existantsNotes: true }, titulaires: { ok: true, notes: 3 } };
    if (chemin === '/tickets/config/bienvenue/test' && methode === 'POST') return { ok: true };
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
  await choisirDans('esport-tk-cat-roles-app', 'club:r1');
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

test('catégorie : fermeture automatique « Jamais » ou délai propre en jours, fermeture par le staff seul', async () => {
  const conf = configDe();
  const { client, appels } = fauxClient(conf);
  await render(<ConfigTickets theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-conf-onglet-categories'));
  await fireEvent.press(screen.getByTestId('esport-tk-cat-nouvelle'));
  await fireEvent.changeText(screen.getByTestId('esport-tk-cat-nom-fr'), 'Sponsors');
  // Délai global par défaut : le réglage général est rappelé (168 h = 7 j).
  expect(screen.getByText('Réglage général (Configuration › Général) : 7 j.')).toBeTruthy();
  // Délai propre : saisi en jours, envoyé en heures ; une saisie hors limites est refusée avant l'envoi.
  await fireEvent.press(screen.getByTestId('esport-tk-cat-fermeture-delai'));
  await fireEvent.changeText(screen.getByTestId('esport-tk-cat-fermeture-jours'), '120');
  await fireEvent.press(screen.getByTestId('esport-tk-cat-enregistrer'));
  await screen.findByText('Délai de fermeture : de 1 heure (0,05 jour) à 90 jours.');
  expect(appels.some(a => a.chemin === '/tickets/config/categories')).toBe(false);
  // Jamais + staff seul.
  await fireEvent.press(screen.getByTestId('esport-tk-cat-fermeture-jamais'));
  expect(screen.getByText(/ne sont jamais fermés automatiquement/)).toBeTruthy();
  await fireEvent(screen.getByTestId('esport-tk-cat-staff-seul'), 'valueChange', true);
  await fireEvent.press(screen.getByTestId('esport-tk-cat-enregistrer'));
  await screen.findByTestId('esport-tk-cat-cat1');
  const post = appels.find(a => a.chemin === '/tickets/config/categories' && a.methode === 'POST')!.corps as Categorie;
  expect(post.fermetureAutoH).toBe(0);
  expect(post.fermetureStaffSeul).toBe(true);
  expect(screen.getByTestId('esport-tk-cat-cat1-fermeture')).toHaveTextContent('Ne se ferme jamais automatiquement · Fermeture par le staff seul');
});

test('catégorie : délai propre de 1,5 jour envoyé en heures (36)', async () => {
  const conf = configDe();
  const { client, appels } = fauxClient(conf);
  await render(<ConfigTickets theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-conf-onglet-categories'));
  await fireEvent.press(screen.getByTestId('esport-tk-cat-nouvelle'));
  await fireEvent.changeText(screen.getByTestId('esport-tk-cat-nom-fr'), 'Aide');
  await fireEvent.press(screen.getByTestId('esport-tk-cat-fermeture-delai'));
  await fireEvent.changeText(screen.getByTestId('esport-tk-cat-fermeture-jours'), '1,5');
  await fireEvent.press(screen.getByTestId('esport-tk-cat-enregistrer'));
  await screen.findByTestId('esport-tk-cat-cat1');
  const post = appels.find(a => a.chemin === '/tickets/config/categories' && a.methode === 'POST')!.corps as Categorie;
  expect(post.fermetureAutoH).toBe(36);
  expect(post.fermetureStaffSeul).toBe(false);
  expect(screen.getByTestId('esport-tk-cat-cat1-fermeture')).toHaveTextContent('Fermeture : après 36 h');
});

test('panneau : aperçu comme sur Discord, puis publication', async () => {
  const conf = configDe();
  const { client, appels } = fauxClient(conf);
  await render(<ConfigTickets theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-conf-onglet-panneaux'));
  await fireEvent.press(screen.getByTestId('esport-tk-pan-nouveau'));
  await fireEvent.changeText(screen.getByTestId('esport-tk-pan-titre-fr'), 'Support du club');
  await screen.findByTestId('esport-tk-pan-salon-modifier');
  await choisirDans('esport-tk-pan-salon', '713');
  await fireEvent.press(screen.getByTestId('esport-tk-pan-apercu'));
  await screen.findByTestId('esport-tk-apercu');
  expect(screen.getByText('Help · Aide')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-tk-pan-publier'));
  await screen.findByTestId('esport-tk-pan-editeur-avis');
  expect(appels.some(a => a.chemin === '/tickets/config/panneaux/pan1/publier')).toBe(true);
});

// Navigation : l'entrée « Tickets » (hors de l'Administration) et sa pastille sont testées dans Administration.test.tsx.

// ------------------------------------------------------------------ Étape 3 : tickets dans l'app

const CAT = { id: 'cat1', nom: { fr: 'Recrutement', en: 'Recruitment' }, couleur: '#22aa66', icone: 'membres', actif: true };
const resumeTk = (numero: number, nonLu: boolean): ResumeTicket => ({ id: `00000000-0000-0000-0000-00000000000${numero}`, numero, categorie: CAT, statut: 'ouvert', priorite: 'urgent', auteur: { discordId: '8001', nom: 'Léa', compte: null }, responsable: null, ouvertLe: '2026-11-04T10:00:00.000Z', derniereActivite: '2026-11-04T10:05:00.000Z', fermeLe: null, note: null, nonLu, permanent: false });

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
    fermeture: { heures: 168, source: 'general', staffSeul: false, permanentPar: null, permanentLe: null },
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

test('vue : un gestionnaire rend le ticket permanent (badge, délai annoncé, staff seul)', async () => {
  const appels: Array<{ chemin: string; methode?: string; corps?: unknown }> = [];
  let permanent = false;
  const detail = (): DetailTicket => ({
    ...resumeTk(1, false),
    permanent,
    nonLuDepuis: null,
    salon: { id: '7001', nom: 'ticket-0001-lea', supprime: false },
    reponses: [],
    raison: null,
    noteCommentaire: null,
    liaison: { type: 'aucune' },
    liaisonCategorie: { type: 'aucune' },
    purge: false,
    fermeture: permanent ? { heures: 0, source: 'ticket', staffSeul: true, permanentPar: 'Kai', permanentLe: '2026-11-04T11:00:00.000Z' } : { heures: 72, source: 'categorie', staffSeul: true, permanentPar: null, permanentLe: null },
    membres: [],
    messages: [],
    droits: { repondre: true, gerer: true },
  });
  const requete = async (chemin: string, methode?: string, corps?: unknown): Promise<unknown> => {
    appels.push({ chemin, methode, corps });
    if (chemin.startsWith('/tickets?')) return { tickets: [{ ...resumeTk(1, false), permanent }], categories: [CAT], droits: { repondre: true, gerer: true, configurer: false } };
    if (chemin === '/tickets/preferences') return { mpNouveau: false, mpMessage: true };
    if (chemin.endsWith('/assignables')) return { comptes: [] };
    if (chemin.endsWith('/lu')) return { ok: true };
    if (chemin.endsWith('/permanent')) {
      permanent = (corps as { permanent: boolean }).permanent;
      return detail();
    }
    if (/\/tickets\/[^/]+$/.test(chemin)) return detail();
    throw new Error(`inattendu : ${methode ?? 'GET'} ${chemin}`);
  };
  await render(<ListeTickets theme={theme} client={{ requete } as unknown as ClientEsport} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-ticket-1'));
  await screen.findByTestId('esport-tk-vue');
  expect(screen.getByTestId('esport-tk-vue-fermeture')).toHaveTextContent('Fermeture automatique après 3 j sans message (réglage de la catégorie).');
  expect(screen.getByText('Seul le staff peut fermer ce ticket.')).toBeTruthy();
  expect(screen.queryByTestId('esport-tk-vue-permanent')).toBeNull();
  await fireEvent(screen.getByTestId('esport-tk-permanent'), 'valueChange', true);
  await screen.findByTestId('esport-tk-vue-permanent');
  const post = appels.find(a => a.chemin.endsWith('/permanent'))!;
  expect(post.methode).toBe('POST');
  expect(post.corps).toEqual({ permanent: true });
  expect(screen.getByTestId('esport-tk-vue-fermeture')).toHaveTextContent(/jamais fermé automatiquement/);
  expect(screen.getByText(/Rendu permanent par Kai/)).toBeTruthy();
});

test('vue : sans tickets.gerer, pas d’interrupteur « Ne jamais fermer automatiquement »', async () => {
  const { client } = fauxClientTickets();
  await render(<ListeTickets theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-ticket-1'));
  await screen.findByTestId('esport-tk-vue');
  expect(screen.queryByTestId('esport-tk-permanent')).toBeNull();
  expect(screen.getByTestId('esport-tk-vue-fermeture')).toHaveTextContent('Fermeture automatique après 7 j sans message (réglage général).');
});

// ------------------------------------------------------------------ Général : choisir le serveur, puis tout enregistrer

/** Client du parcours « Général » : rien d'enregistré au départ ; `discord403` : Discord refuse les salons (50001). */
function clientGeneral({ discord403 = false, diagnostic }: { discord403?: boolean; diagnostic?: unknown } = {}) {
  const conf = configDe();
  conf.general = { ...conf.general, actif: false, guildId: null, guildNom: '', categorieOuverts: null };
  const appels: Array<{ chemin: string; methode?: string; corps?: unknown }> = [];
  const serveurs = [{ id: '700', nom: 'Ligne Zero | 線ゼロ' }];
  const requete = async (chemin: string, methode?: string, corps?: unknown): Promise<unknown> => {
    appels.push({ chemin, methode, corps });
    if (chemin === '/tickets/config') return conf;
    if (chemin === '/tickets/etat') return { actif: conf.general.actif, bot: true, connexion: { mode: 'hors_ligne', depuis: null }, ...(diagnostic ? { diagnostic } : {}) };
    if (chemin === '/tickets/config/discord' && !conf.general.guildId) return { bot: true, serveurs, erreur: null };
    if (chemin === '/tickets/config/discord?serveur=700' || chemin === '/tickets/config/discord') {
      if (discord403) return { bot: true, serveurs, serveur: { id: '700', nom: 'Ligne Zero | 線ゼロ', enregistre: false }, erreur: 'discord-403', erreurDetail: { etape: 'salons', statut: 403, code: 50001 } };
      return {
        bot: true,
        serveurs,
        serveur: { id: '700', nom: 'Ligne Zero | 線ゼロ', enregistre: conf.general.guildId === '700' },
        erreur: null,
        salons: [{ id: '710', nom: 'Tickets', type: 'categorie', parent: null }, { id: '711', nom: 'Archives', type: 'categorie', parent: null }, { id: '713', nom: 'journaux', type: 'texte', parent: null }],
        roles: [],
        permissions: { membreTrouve: true, serveur: [], ouverts: null, archives: null, journaux: null },
      };
    }
    if (chemin === '/tickets/config/general' && methode === 'PUT') {
      conf.general = { ...conf.general, ...(corps as object) };
      return { ...conf };
    }
    throw new Error(`inattendu : ${methode ?? 'GET'} ${chemin}`);
  };
  return { client: { requete } as unknown as ClientEsport, appels };
}

test('Général : choisir le serveur montre ses catégories sans enregistrer ; serveur + catégorie + activation enregistrés ensemble', async () => {
  const { client, appels } = clientGeneral();
  await render(<ConfigTickets theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-conf-onglet-general'));
  expect(screen.getByText('Choisissez d’abord le serveur.')).toBeTruthy();
  await fireEvent(screen.getByTestId('esport-tk-general-actif'), 'valueChange', true);
  expect(screen.getByTestId('esport-tk-general-manque')).toBeTruthy();
  // Le serveur est choisi : ses catégories sont lues TOUT DE SUITE (aucun enregistrement avant).
  await fireEvent.press(await screen.findByTestId('esport-tk-general-serveur-700'));
  await screen.findByTestId('esport-tk-general-ouverts-modifier');
  expect(appels.some(a => a.chemin === '/tickets/config/discord?serveur=700')).toBe(true);
  expect(appels.some(a => a.methode === 'PUT')).toBe(false);
  expect(screen.queryByText('Choisissez d’abord le serveur.')).toBeNull();
  expect(screen.getByTestId('esport-tk-general-non-enregistre')).toBeTruthy();
  expect(screen.getByText(/catégorie Discord des tickets ouverts\.$/)).toBeTruthy();
  await choisirDans('esport-tk-general-ouverts', '710');
  await choisirDans('esport-tk-general-archives', '711');
  await choisirDans('esport-tk-general-journaux', '713');
  expect(screen.queryByTestId('esport-tk-general-manque')).toBeNull();
  // Tickets supprimés : lisibles 30 jours par défaut, réglable.
  expect(screen.getByTestId('esport-tk-general-retentionSuppressionJours').props.value).toBe('30');
  await fireEvent.changeText(screen.getByTestId('esport-tk-general-retentionSuppressionJours'), '14');
  await fireEvent.press(screen.getByTestId('esport-tk-general-enregistrer'));
  // Le retour s'affiche près du bouton.
  await screen.findByTestId('esport-tk-general-avis');
  expect(screen.getByText(/connexion Discord démarre dans la minute/)).toBeTruthy();
  const put = appels.find(a => a.methode === 'PUT')!.corps as Record<string, unknown>;
  expect(put).toMatchObject({ actif: true, guildId: '700', guildNom: 'Ligne Zero | 線ゼロ', categorieOuverts: '710', categorieArchives: '711', salonJournaux: '713', retentionSuppressionJours: 14 });
  // L'état de la connexion est relu après l'enregistrement.
  await waitFor(() => expect(appels.filter(a => a.chemin === '/tickets/etat').length).toBeGreaterThanOrEqual(2));
});

test('Général : Discord refuse (403 / 50001 Missing Access) : erreur et marche à suivre affichées dans Général', async () => {
  const { client } = clientGeneral({ discord403: true });
  await render(<ConfigTickets theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-conf-onglet-general'));
  await fireEvent.press(await screen.findByTestId('esport-tk-general-serveur-700'));
  const avis = await screen.findByTestId('esport-tk-general-erreur-discord');
  expect(avis).toBeTruthy();
  expect(screen.getByText(/403, code 50001 Missing Access/)).toBeTruthy();
  expect(screen.getByText(/Inviter le bot/)).toBeTruthy();
  expect(screen.getByTestId('esport-tk-general-relire')).toBeTruthy();
  expect(screen.queryByTestId('esport-tk-general-ouverts-710')).toBeNull();
});

test('Connexion : diagnostic précis (ce qui manque, dernière erreur, cron jamais vu avec la commande à ajouter)', async () => {
  const diagnostic = {
    bot: true,
    serveur: null,
    categorie: false,
    actif: false,
    gatewayActivee: true,
    reveilConfigure: false,
    processus: { role: 'inactif', raison: 'sans-serveur', le: new Date().toISOString(), frais: true },
    meneur: false,
    connexion: { mode: 'hors_ligne', depuis: null },
    cron: null,
  };
  const { client } = clientGeneral({ diagnostic });
  await render(<ConfigTickets theme={theme} client={client} large />);
  await screen.findByTestId('esport-tk-diag');
  expect(screen.getByLabelText(/Jeton du bot sur le serveur \(DISCORD_BOT_TOKEN\) : OK/)).toBeTruthy();
  expect(screen.getByLabelText(/Serveur Discord choisi : À faire/)).toBeTruthy();
  expect(screen.getByLabelText(/Tickets activés : À faire/)).toBeTruthy();
  expect(screen.getByText(/URL_PUBLIQUE absente/)).toBeTruthy();
  expect(screen.getByTestId('esport-tk-diag-cron-commande')).toBeTruthy();
  expect(screen.getByText(/esport\/serveur\/cron\.mjs/)).toBeTruthy();
});

// ------------------------------------------------------------------ Avis de satisfaction (migration 0056)

const CAT2 = { id: 'cat2', nom: { fr: 'Partenariat', en: 'Partnership' }, couleur: '#aa6622', icone: 'billets', actif: true };
function listeAvis(note?: string): ListeAvis {
  const avis = [
    { id: 't1', ticketId: '00000000-0000-0000-0000-000000000001', numero: 1, salon: 'ticket-0001-lea', anonyme: false, categorie: CAT, note: 5, commentaire: 'Super réactif', auteur: 'Léa', responsable: { nom: 'Kai', cle: 'c:kai' }, le: '2026-11-04T12:00:00.000Z' },
    { id: 't2', ticketId: '00000000-0000-0000-0000-000000000002', numero: 2, salon: null, anonyme: false, categorie: CAT2, note: 2, commentaire: null, auteur: null, responsable: null, le: '2026-11-03T12:00:00.000Z' },
    { id: 'anon:a1', ticketId: null, numero: null, salon: null, anonyme: true, categorie: CAT, note: 4, commentaire: 'Bien', auteur: null, responsable: { nom: 'Kai', cle: 'c:kai' }, le: '2026-11-02T12:00:00.000Z' },
  ];
  return { total: 3, moyenne: 11 / 3, repartition: [0, 1, 0, 1, 1], avis: note ? avis.filter(a => String(a.note) === note) : avis, categories: [CAT, CAT2], responsables: [{ cle: 'c:kai', nom: 'Kai' }], voirTickets: true };
}

test('Avis : moyenne, nombre, répartition en barres, étoiles monochromes, filtres envoyés, un avis ouvre son ticket (pas l’anonyme)', async () => {
  const appels: string[] = [];
  const requete = async (chemin: string): Promise<unknown> => {
    appels.push(chemin);
    if (chemin.startsWith('/tickets/avis')) return listeAvis(/note=(\d)/.exec(chemin)?.[1]);
    throw new Error(`inattendu : ${chemin}`);
  };
  const ouverts: Array<[string, number]> = [];
  await render(<AvisTicketsPage theme={theme} client={{ requete } as unknown as ClientEsport} onOuvrir={(id, numero) => ouverts.push([id, numero])} />);
  await screen.findByTestId('esport-tk-avis');
  expect(screen.getByTestId('esport-tk-avis-moyenne-valeur')).toHaveTextContent('3.7/5');
  expect(screen.getByTestId('esport-tk-avis-nombre')).toHaveTextContent('3');
  expect(screen.getByLabelText('5 sur 5 : 1 avis')).toBeTruthy();
  expect(screen.getByLabelText('3 sur 5 : 0 avis')).toBeTruthy();
  expect(screen.getByTestId('esport-tk-avis-t1-etoiles').props.accessibilityLabel).toBe('5 sur 5');
  expect(screen.getByText('Super réactif')).toBeTruthy();
  expect(screen.getByText('Ticket supprimé (avis anonyme)')).toBeTruthy();
  expect(screen.getAllByText('Sans commentaire.').length).toBe(1);
  expect(screen.getByText(/auteur effacé/)).toBeTruthy();
  // Filtres : note, catégorie, responsable, tri, période.
  await fireEvent.press(screen.getByTestId('esport-tk-avis-f-note-5'));
  await waitFor(() => expect(appels.some(c => c.includes('note=5'))).toBe(true));
  await waitFor(() => expect(screen.queryByText('Ticket supprimé (avis anonyme)')).toBeNull());
  await fireEvent.press(screen.getByTestId('esport-tk-avis-f-categorie-cat1'));
  await fireEvent.press(screen.getByTestId('esport-tk-avis-f-responsable-c:kai'));
  await fireEvent.press(screen.getByTestId('esport-tk-avis-tri-note_bas'));
  await fireEvent.press(screen.getByTestId('esport-tk-avis-f-periode-30'));
  await waitFor(() => expect(appels.at(-1)).toMatch(/categorie=cat1/));
  const dernier = appels.at(-1)!;
  expect(dernier).toMatch(/note=5/);
  expect(dernier).toMatch(/responsable=c%3Akai/);
  expect(dernier).toMatch(/tri=note_bas/);
  expect(dernier).toMatch(/du=\d{4}-\d{2}-\d{2}/);
  // Toucher un avis ouvre son ticket.
  await fireEvent.press(screen.getByTestId('esport-tk-avis-t1'));
  expect(ouverts).toEqual([['00000000-0000-0000-0000-000000000001', 1]]);
});

test('Avis : un avis anonyme (ticket supprimé) n’est pas cliquable', async () => {
  const requete = async (): Promise<unknown> => listeAvis();
  const ouverts: string[] = [];
  await render(<AvisTicketsPage theme={theme} client={{ requete } as unknown as ClientEsport} onOuvrir={id => ouverts.push(id)} />);
  await screen.findByTestId('esport-tk-avis-anon:a1');
  expect(screen.getByTestId('esport-tk-avis-anon:a1').props.accessibilityRole).toBeUndefined();
  expect(screen.getByTestId('esport-tk-avis-t1').props.accessibilityRole).toBe('button');
});

/** Client d'un ticket FERMÉ noté (4/5, commentaire), que l'acteur peut supprimer. */
function clientFerme() {
  const appels: Array<{ chemin: string; methode?: string; corps?: unknown }> = [];
  let supprime = false;
  const ferme = (n: number): ResumeTicket => ({ ...resumeTk(n, false), statut: 'ferme', fermeLe: '2026-11-04T11:00:00.000Z', note: n === 1 ? 4 : null });
  const detail = (): DetailTicket => ({
    ...ferme(1),
    nonLuDepuis: null,
    salon: { id: '7001', nom: 'ticket-0001-lea', supprime: false },
    reponses: [],
    raison: null,
    noteCommentaire: 'Merci pour l’aide',
    noteLe: '2026-11-04T11:30:00.000Z',
    liaison: { type: 'aucune' },
    liaisonCategorie: { type: 'aucune' },
    purge: false,
    fermeture: { heures: 168, source: 'general', staffSeul: false, permanentPar: null, permanentLe: null },
    membres: [],
    messages: [],
    droits: { repondre: true, gerer: true, supprimer: true },
  });
  const requete = async (chemin: string, methode?: string, corps?: unknown): Promise<unknown> => {
    appels.push({ chemin, methode, corps });
    if (chemin.startsWith('/tickets?')) return { tickets: supprime ? [ferme(2)] : [ferme(1), ferme(2), ferme(3)], categories: [CAT], droits: { repondre: true, gerer: true, configurer: false, supprimer: true } };
    if (chemin === '/tickets/preferences') return { mpNouveau: false, mpMessage: true };
    if (chemin.endsWith('/assignables')) return { comptes: [] };
    if (chemin.endsWith('/lu')) return { ok: true };
    if (chemin.endsWith('/supprimer') && chemin !== '/tickets/supprimer') {
      supprime = true;
      return { ok: true, numero: 1, jours: 30, effaceLe: '2026-12-04T11:00:00.000Z' };
    }
    if (chemin === '/tickets/supprimer') {
      supprime = true;
      return { supprimes: [1, 3], echecs: [] };
    }
    if (/\/tickets\/[^/]+$/.test(chemin)) return detail();
    throw new Error(`inattendu : ${methode ?? 'GET'} ${chemin}`);
  };
  return { client: { requete } as unknown as ClientEsport, appels };
}

test('vue d’un ticket fermé : avis de l’auteur (étoiles, commentaire) ; Supprimer : confirmation claire, avis gardé par défaut ou supprimé', async () => {
  const { client, appels } = clientFerme();
  await render(<ListeTickets theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-ticket-1'));
  await screen.findByTestId('esport-tk-vue');
  expect(screen.getByTestId('esport-tk-vue-avis-etoiles').props.accessibilityLabel).toBe('4 sur 5');
  expect(screen.getByTestId('esport-tk-vue-avis-commentaire')).toHaveTextContent('Merci pour l’aide');
  expect(screen.getByText(/^Noté le /)).toBeTruthy();
  // Rien n'est supprimé avant la confirmation ; Annuler referme la confirmation.
  await fireEvent.press(screen.getByTestId('esport-tk-supprimer'));
  expect(screen.getByTestId('esport-tk-suppr-titre')).toHaveTextContent('Supprimer le ticket n° 1 ?');
  expect(screen.getByText(/Le salon Discord est supprimé tout de suite\. Le ticket reste lisible dans l’app pendant 30 jours/)).toBeTruthy();
  expect(screen.getByTestId('esport-tk-suppr-garder-avis').props.value).toBe(true);
  await fireEvent.press(screen.getByTestId('esport-tk-suppr-annuler'));
  expect(screen.queryByTestId('esport-tk-suppr')).toBeNull();
  expect(appels.some(a => a.chemin.endsWith('/supprimer'))).toBe(false);
  // Avis supprimé aussi : interrupteur coupé, puis confirmation.
  await fireEvent.press(screen.getByTestId('esport-tk-supprimer'));
  await fireEvent(screen.getByTestId('esport-tk-suppr-garder-avis'), 'valueChange', false);
  await fireEvent.press(screen.getByTestId('esport-tk-suppr-confirmer'));
  await waitFor(() => expect(appels.some(a => a.chemin === '/tickets/00000000-0000-0000-0000-000000000001/supprimer')).toBe(true));
  const post = appels.find(a => a.chemin.endsWith('/supprimer'))!;
  expect(post.methode).toBe('POST');
  expect(post.corps).toEqual({ garderAvis: false });
  // Le volet se ferme, la liste est relue, la suppression est annoncée.
  await waitFor(() => expect(screen.queryByTestId('esport-tk-vue')).toBeNull());
  await screen.findByText(/^Ticket n° 1 supprimé de Discord : encore lisible dans « Supprimés » jusqu’au /);
  await waitFor(() => expect(screen.queryByTestId('esport-tk-ticket-1')).toBeNull());
});

test('vue : un ticket ouvert n’a pas de bouton Supprimer ; liste des fermés : suppression groupée (avis gardé par défaut)', async () => {
  const { client: clientOuvert } = fauxClientTickets();
  const r = await render(<ListeTickets theme={theme} client={clientOuvert} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-ticket-1'));
  await screen.findByTestId('esport-tk-vue');
  expect(screen.queryByTestId('esport-tk-supprimer')).toBeNull();
  expect(screen.queryByTestId('esport-tk-selection')).toBeNull();
  await r.unmount();

  const { client, appels } = clientFerme();
  await render(<ListeTickets theme={theme} client={client} large />);
  await screen.findByTestId('esport-tk-ticket-1');
  expect(screen.queryByTestId('esport-tk-selection')).toBeNull();
  await fireEvent.press(screen.getByTestId('esport-tk-f-statut-ferme'));
  await fireEvent.press(await screen.findByTestId('esport-tk-selection-basculer'));
  await fireEvent.press(screen.getByTestId('esport-tk-ticket-1'));
  await fireEvent.press(screen.getByTestId('esport-tk-ticket-3'));
  expect(screen.queryByTestId('esport-tk-vue')).toBeNull();
  expect(screen.getByTestId('esport-tk-ticket-1').props.accessibilityState).toEqual({ checked: true });
  expect(screen.getByText('2 ticket(s) choisi(s)')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-tk-selection-supprimer'));
  expect(screen.getByTestId('esport-tk-suppr-groupe-titre')).toHaveTextContent('Supprimer 2 ticket(s) fermé(s) ?');
  await fireEvent.press(screen.getByTestId('esport-tk-suppr-groupe-confirmer'));
  await waitFor(() => expect(appels.some(a => a.chemin === '/tickets/supprimer')).toBe(true));
  expect(appels.find(a => a.chemin === '/tickets/supprimer')!.corps).toEqual({ ids: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003'], garderAvis: true });
  await screen.findByText('2 ticket(s) supprimé(s) de Discord, lisibles dans « Supprimés ».');
});

/** Client des tickets supprimés (migration 0065) : la liste « Supprimés » et un ticket supprimé, restaurable. */
function clientCorbeille({ garderAvis = true }: { garderAvis?: boolean } = {}) {
  const appels: Array<{ chemin: string; methode?: string; corps?: unknown }> = [];
  const effaceLe = new Date(Date.now() + 12 * 86_400_000 + 3_600_000).toISOString();
  const supprime = { le: '2026-11-04T12:00:00.000Z', par: 'Kai', effaceLe, garderAvis };
  const ticket = (numero: number): ResumeTicket => ({ ...resumeTk(numero, false), statut: 'ferme', fermeLe: '2026-11-04T11:00:00.000Z', note: 4, supprime });
  const detail = (): DetailTicket => ({
    ...ticket(1),
    nonLuDepuis: null,
    salon: { id: '7001', nom: 'ticket-0001-lea', supprime: true },
    reponses: [],
    raison: null,
    noteCommentaire: 'Merci',
    noteLe: '2026-11-04T11:30:00.000Z',
    liaison: { type: 'aucune' },
    liaisonCategorie: { type: 'aucune' },
    purge: false,
    fermeture: { heures: 168, source: 'general', staffSeul: false, permanentPar: null, permanentLe: null },
    membres: [],
    messages: [{ id: 'm1', genre: 'discord', auteur: { nom: 'Léa', discordId: '8001', compte: null }, staff: false, contenu: 'Bonjour, je postule', envoi: 'ok', le: '2026-11-04T10:01:00.000Z', modifieLe: null, supprimeLe: null, pieces: [] }],
    droits: { repondre: true, gerer: true, supprimer: true },
    retentionSuppressionJours: 30,
  });
  const requete = async (chemin: string, methode?: string, corps?: unknown): Promise<unknown> => {
    appels.push({ chemin, methode, corps });
    if (chemin.startsWith('/tickets?')) return { tickets: chemin.includes('statut=supprimes') ? [ticket(1)] : [], categories: [CAT], nbSupprimes: 1, retentionSuppressionJours: 30, droits: { repondre: true, gerer: true, configurer: false, supprimer: true } };
    if (chemin === '/tickets/preferences') return { mpNouveau: false, mpMessage: true };
    if (chemin.endsWith('/assignables')) return { comptes: [] };
    if (chemin.endsWith('/lu')) return { ok: true };
    if (chemin.endsWith('/restaurer')) return { ...detail(), supprime: null };
    if (chemin.endsWith('/effacer')) return { ok: true, numero: 1 };
    if (/\/tickets\/[^/]+$/.test(chemin)) return detail();
    throw new Error(`inattendu : ${methode ?? 'GET'} ${chemin}`);
  };
  return { client: { requete } as unknown as ClientEsport, appels };
}

test('filtre « Supprimés (30 j) » : badge « Supprimé de Discord », compte à rebours, ticket lisible ; Restaurer, Restaurer et rouvrir, Supprimer définitivement maintenant', async () => {
  const { client, appels } = clientCorbeille({ garderAvis: false });
  await render(<ListeTickets theme={theme} client={client} large />);
  expect(await screen.findByText('Supprimés (30 j)')).toBeTruthy();
  expect(appels.filter(a => a.chemin.startsWith('/tickets?')).every(a => !a.chemin.includes('supprimes'))).toBe(true);
  await fireEvent.press(screen.getByTestId('esport-tk-f-statut-supprimes'));
  await waitFor(() => expect(appels.some(a => a.chemin.includes('statut=supprimes'))).toBe(true));
  expect(await screen.findByTestId('esport-tk-corbeille-aide')).toHaveTextContent(/Les tickets supprimés sont retirés de Discord et restent lisibles ici 30 jours/);
  expect(screen.getByTestId('esport-tk-ticket-1-corbeille')).toHaveTextContent(/^Supprimé de Discord — effacé définitivement le /);
  expect(screen.getByTestId('esport-tk-ticket-1-compte')).toHaveTextContent(/13 j restants/);

  // Le ticket supprimé reste lisible : conversation, avis ; pas de Rouvrir ni de Supprimer ordinaires.
  await fireEvent.press(screen.getByTestId('esport-tk-ticket-1'));
  await screen.findByTestId('esport-tk-vue-corbeille');
  expect(screen.getByTestId('esport-tk-vue-corbeille-badge')).toHaveTextContent(/Supprimé de Discord — effacé définitivement le /);
  expect(screen.getByTestId('esport-tk-vue-corbeille-compte')).toHaveTextContent(/13 j restants/);
  expect(screen.getByText('Supprimé par Kai le', { exact: false })).toBeTruthy();
  expect(screen.getByText('Bonjour, je postule')).toBeTruthy();
  expect(screen.getByTestId('esport-tk-vue-avis-commentaire')).toHaveTextContent('Merci');
  expect(screen.queryByTestId('esport-tk-rouvrir')).toBeNull();
  expect(screen.queryByTestId('esport-tk-supprimer')).toBeNull();
  expect(screen.getByTestId('esport-tk-restaurer')).toBeTruthy();

  // Restaurer : sans réouverture (pas de nouveau salon Discord).
  await fireEvent.press(screen.getByTestId('esport-tk-restaurer'));
  await waitFor(() => expect(appels.some(a => a.chemin.endsWith('/restaurer'))).toBe(true));
  expect(appels.find(a => a.chemin.endsWith('/restaurer'))).toMatchObject({ methode: 'POST', corps: { rouvrir: false } });
  await screen.findByText('Ticket restauré.');
  await waitFor(() => expect(screen.queryByTestId('esport-tk-vue-corbeille')).toBeNull());
  expect(screen.getByTestId('esport-tk-rouvrir')).toBeTruthy();
});

test('ticket supprimé : « Restaurer et rouvrir » demande la réouverture (nouveau salon Discord)', async () => {
  const { client, appels } = clientCorbeille({ garderAvis: false });
  await render(<ListeTickets theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-f-statut-supprimes'));
  await fireEvent.press(await screen.findByTestId('esport-tk-ticket-1'));
  await screen.findByTestId('esport-tk-vue-corbeille');
  await fireEvent.press(screen.getByTestId('esport-tk-restaurer-rouvrir'));
  await waitFor(() => expect(appels.some(a => a.chemin.endsWith('/restaurer'))).toBe(true));
  expect(appels.find(a => a.chemin.endsWith('/restaurer'))!.corps).toEqual({ rouvrir: true });
  await screen.findByText('Ticket restauré.');
});

test('ticket supprimé : effacement définitif tout de suite, avec confirmation et le choix de l’avis', async () => {
  const { client, appels } = clientCorbeille({ garderAvis: false });
  await render(<ListeTickets theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-f-statut-supprimes'));
  await fireEvent.press(await screen.findByTestId('esport-tk-ticket-1'));
  await screen.findByTestId('esport-tk-vue-corbeille');
  await fireEvent.press(screen.getByTestId('esport-tk-effacer'));
  expect(screen.getByTestId('esport-tk-effacer-dialogue-titre')).toHaveTextContent('Supprimer définitivement le ticket n° 1 maintenant ?');
  expect(screen.getByText(/C’est irréversible : la conversation, les notes internes, les pièces jointes et le transcript sont effacés tout de suite/)).toBeTruthy();
  expect(screen.getByTestId('esport-tk-effacer-dialogue-garder-avis').props.value).toBe(false);
  // Rien n'est effacé avant la confirmation ; Annuler referme.
  await fireEvent.press(screen.getByTestId('esport-tk-effacer-dialogue-annuler'));
  expect(appels.some(a => a.chemin.endsWith('/effacer'))).toBe(false);
  await fireEvent.press(screen.getByTestId('esport-tk-effacer'));
  await fireEvent(screen.getByTestId('esport-tk-effacer-dialogue-garder-avis'), 'valueChange', true);
  await fireEvent.press(screen.getByTestId('esport-tk-effacer-dialogue-confirmer'));
  await waitFor(() => expect(appels.some(a => a.chemin.endsWith('/effacer'))).toBe(true));
  expect(appels.find(a => a.chemin.endsWith('/effacer'))).toMatchObject({ methode: 'POST', corps: { garderAvis: true } });
  await waitFor(() => expect(screen.queryByTestId('esport-tk-vue')).toBeNull());
  await screen.findByText('Ticket n° 1 effacé définitivement.');
});

// ------------------------------------------------------------------ Catégories par défaut, réponses depuis l'app seulement

const champ = (id: string) => ({ id, libelle: { fr: id, en: id }, placeholder: VIDE, style: 'court' as const, requis: true, min: 0, max: 100 });
const MODELES: ModeleCategorie[] = [
  { cle: 'support', nom: { fr: 'Support général', en: 'General support' }, description: { fr: 'Une question', en: 'A question' }, icone: 'billets', couleur: '#5865f2', formulaire: [champ('sujet'), champ('details')] },
  { cle: 'partenariat', nom: { fr: 'Partenariat & sponsoring', en: 'Partnership & sponsorship' }, description: { fr: 'Proposer', en: 'Offer' }, icone: 'membres', couleur: '#c99a1e', formulaire: [champ('entreprise')], fermetureAutoH: 0, fermetureStaffSeul: true },
  { cle: 'autre', nom: { fr: 'Autre', en: 'Other' }, description: { fr: 'Toute autre demande', en: 'Any other request' }, icone: 'billets', couleur: '#8b8b9a', formulaire: [champ('sujet')] },
];

test('catégories par défaut : choix à cocher, nom déjà pris grisé, ajout de la sélection ; « À configurer : qui traite ? »', async () => {
  const conf = configDe();
  const existante: Categorie = { id: 'c0', position: 0, nom: { fr: 'autre', en: 'Misc' }, description: VIDE, icone: 'billets', couleur: '#5865f2', actif: true, rolesDiscord: [], rolesApp: [], formulaire: [], accueil: VIDE, modeleNom: 'ticket-{numero}', maxOuverts: 1, fermetureAutoH: null, fermetureStaffSeul: false, satisfaction: true, prioriteDefaut: 'moyen', mentions: [], liaison: { type: 'aucune' } };
  conf.categories = [existante];
  conf.modeles = MODELES;
  const { client: base, appels } = fauxClient(conf);
  const requete = async (chemin: string, methode?: string, corps?: unknown): Promise<unknown> => {
    if (chemin === '/tickets/config/categories/defaut') {
      appels.push({ chemin, methode, corps });
      const cles = (corps as { cles: string[] }).cles;
      const ajout = MODELES.filter(m => cles.includes(m.cle)).map((m, i) => ({ ...existante, id: `m${i}`, nom: m.nom, rolesApp: m.cle === 'partenariat' ? ['club:r1'] : [] }));
      conf.categories = [existante, ...ajout];
      return { ajoutees: cles, ignorees: [], categories: conf.categories };
    }
    return (base as unknown as { requete: typeof requete }).requete(chemin, methode, corps);
  };
  await render(<ConfigTickets theme={theme} client={{ requete } as unknown as ClientEsport} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-conf-onglet-categories'));
  // La catégorie existante n'a ni rôle Discord ni rôle de l'app : avertissement.
  expect(screen.getByTestId('esport-tk-cat-c0-a-configurer')).toHaveTextContent(/À configurer : qui traite/);
  await fireEvent.press(screen.getByTestId('esport-tk-cat-defaut'));
  await screen.findByTestId('esport-tk-modeles');
  // « Autre » existe déjà (casse ignorée) : grisé, non coché ; les autres cochés par défaut.
  expect(screen.getByTestId('esport-tk-modele-autre').props.accessibilityState).toEqual({ checked: false, disabled: true });
  expect(screen.getByTestId('esport-tk-modele-autre-existe')).toBeTruthy();
  expect(screen.getByTestId('esport-tk-modele-support').props.accessibilityState).toEqual({ checked: true, disabled: false });
  expect(screen.getByText(/jamais fermée automatiquement/)).toBeTruthy();
  expect(screen.getByTestId('esport-tk-modeles-ajouter')).toHaveTextContent('Ajouter la sélection (2)');
  // Décocher « Support général » : seul « Partenariat » part.
  await fireEvent.press(screen.getByTestId('esport-tk-modele-support'));
  expect(screen.getByTestId('esport-tk-modeles-ajouter')).toHaveTextContent('Ajouter la sélection (1)');
  await fireEvent.press(screen.getByTestId('esport-tk-modeles-ajouter'));
  await screen.findByTestId('esport-tk-cat-m0');
  expect(appels.find(a => a.chemin === '/tickets/config/categories/defaut')!.corps).toEqual({ cles: ['partenariat'] });
  expect(screen.queryByTestId('esport-tk-modeles')).toBeNull();
  await screen.findByText('1 catégorie(s) ajoutée(s).');
  // Partenariat a un rôle de l'app : pas d'avertissement.
  expect(screen.queryByTestId('esport-tk-cat-m0-a-configurer')).toBeNull();
  // Tout décocher : bouton désactivé.
  await fireEvent.press(screen.getByTestId('esport-tk-cat-defaut'));
  await fireEvent.press(await screen.findByTestId('esport-tk-modeles-rien'));
  expect(screen.getByTestId('esport-tk-modeles-ajouter')).toHaveTextContent('Ajouter la sélection (0)');
});

test('Général : « Le staff répond uniquement depuis l’AppDashboard » activé par défaut, limite Administrateur expliquée ; le désactiver met à jour les salons', async () => {
  const { client, appels } = clientGeneral();
  const base = client as unknown as { requete(chemin: string, methode?: string, corps?: unknown): Promise<unknown> };
  const requete = async (chemin: string, methode?: string, corps?: unknown): Promise<unknown> => {
    const r = await base.requete(chemin, methode, corps);
    return chemin === '/tickets/config/general' && methode === 'PUT' ? { ...(r as object), reapplication: { ok: 2, echecs: 1, total: 3 } } : r;
  };
  await render(<ConfigTickets theme={theme} client={{ requete } as unknown as ClientEsport} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-conf-onglet-general'));
  expect(screen.getByText('Le staff répond uniquement depuis l’AppDashboard')).toBeTruthy();
  expect(screen.getByTestId('esport-tk-general-app-seule').props.value).toBe(true);
  expect(screen.getByTestId('esport-tk-general-app-seule-admin')).toHaveTextContent(/Administrateur/);
  await fireEvent(screen.getByTestId('esport-tk-general-app-seule'), 'valueChange', false);
  expect(screen.queryByTestId('esport-tk-general-app-seule-admin')).toBeNull();
  await fireEvent.press(screen.getByTestId('esport-tk-general-enregistrer'));
  await screen.findByText(/Droits mis à jour dans 2 salon\(s\) sur 3 ; 1 échec/);
  expect((appels.find(a => a.methode === 'PUT')!.corps as Record<string, unknown>).reponsesAppSeules).toBe(false);
  expect(appels.find(a => a.methode === 'PUT')!.corps).not.toHaveProperty('annonces');
});

const MODELES_PANNEAUX: ModelePanneau[] = [
  { cle: 'support', nom: { fr: 'Support LZ — Centre d’aide', en: 'LZ Support — Help center' }, description: { fr: 'Le panneau principal', en: 'The main panel' }, titre: { fr: 'Centre d’aide LZ', en: 'LZ Help Center' }, texte: { fr: 'Texte', en: 'Text' }, couleur: '#0c66e4', style: 'auto', categories: 'toutes' },
  { cle: 'partenariats', nom: { fr: 'Partenariats', en: 'Partnerships' }, description: { fr: 'Un seul bouton', en: 'A single button' }, titre: { fr: 'Partenariats et sponsoring', en: 'Partnerships and sponsorship' }, texte: { fr: 'Texte', en: 'Text' }, couleur: '#c99a1e', style: 'boutons', categories: ['partenariat'] },
  { cle: 'evenement', nom: { fr: 'Tournoi / Événement', en: 'Tournament / Event' }, description: { fr: 'Inscription', en: 'Registration' }, titre: { fr: 'Inscription — {evenement}', en: 'Registration — {evenement}' }, texte: { fr: 'Texte', en: 'Text' }, couleur: '#4caf7a', style: 'boutons', categories: ['support'], evenement: true, libelleBouton: { fr: 'S’inscrire', en: 'Register' } },
];

test('panneaux par défaut : modèle choisi, catégories absentes à ajouter ou non, événement nommé ; le panneau s’ouvre dans l’éditeur sans être publié', async () => {
  const conf = configDe();
  const support: Categorie = { id: 'c0', position: 0, nom: { fr: 'support GÉNÉRAL', en: 'Help' }, description: VIDE, icone: 'billets', couleur: '#5865f2', actif: true, rolesDiscord: [], rolesApp: [], formulaire: [], accueil: VIDE, modeleNom: 'ticket-{numero}', maxOuverts: 1, fermetureAutoH: null, fermetureStaffSeul: false, satisfaction: true, prioriteDefaut: 'moyen', mentions: [], liaison: { type: 'aucune' } };
  conf.categories = [support];
  conf.modeles = MODELES;
  conf.modelesPanneaux = MODELES_PANNEAUX;
  const { client: base, appels } = fauxClient(conf);
  const requete = async (chemin: string, methode?: string, corps?: unknown): Promise<unknown> => {
    if (chemin === '/tickets/config/panneaux/defaut') {
      appels.push({ chemin, methode, corps });
      const c = corps as { modele: string; evenement?: string };
      const panneau: Panneau = { id: 'pan1', titre: { fr: c.evenement ? `Inscription — ${c.evenement}` : 'Partenariats et sponsoring', en: 'x' }, texte: { fr: 'Texte', en: 'Text' }, couleur: '#c99a1e', imageElementId: null, style: 'boutons', categories: ['c0'], libelles: { c0: { fr: 'S’inscrire', en: 'Register' } }, salonId: null, messageId: null, publieLe: null, erreur: null, majLe: '' };
      return { panneau, ajoutees: [], ignorees: ['partenariat'], renomme: false, categories: conf.categories };
    }
    return (base as unknown as { requete: typeof requete }).requete(chemin, methode, corps);
  };
  await render(<ConfigTickets theme={theme} client={{ requete } as unknown as ClientEsport} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-conf-onglet-panneaux'));
  await fireEvent.press(screen.getByTestId('esport-tk-pan-defaut'));
  await screen.findByTestId('esport-tk-pmodeles');
  // « Support LZ » : toutes les catégories ; « Support général » existe (casse ignorée), les deux autres manquent.
  expect(screen.getByTestId('esport-tk-pmodele-support').props.accessibilityState).toEqual({ checked: true });
  expect(screen.getByText('Catégories absentes : Partenariat & sponsoring, Autre')).toBeTruthy();
  // « Partenariats » : la catégorie manque ; décocher l'ajout affiche l'avertissement et l'envoie.
  await fireEvent.press(screen.getByTestId('esport-tk-pmodele-partenariats'));
  expect(screen.getByText('Catégories absentes : Partenariat & sponsoring')).toBeTruthy();
  expect(screen.queryByTestId('esport-tk-pmodele-sans')).toBeNull();
  await fireEvent(screen.getByTestId('esport-tk-pmodele-ajouter'), 'valueChange', false);
  await fireEvent.press(screen.getByTestId('esport-tk-pmodele-ajouter'));
  expect(await screen.findByTestId('esport-tk-pmodele-sans')).toHaveTextContent(/laissées de côté/);
  // « Tournoi / Événement » : nom obligatoire, catégorie existante choisie (plus rien de manquant).
  await fireEvent.press(screen.getByTestId('esport-tk-pmodele-evenement'));
  expect(screen.getByTestId('esport-tk-pmodele-creer').props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.changeText(screen.getByTestId('esport-tk-pmodele-nom-evenement'), '  The Nuke End ');
  await fireEvent.press(screen.getByTestId('esport-tk-pmodele-categorie-c0'));
  expect(screen.queryByTestId('esport-tk-pmodele-manquantes')).toBeNull();
  await fireEvent.press(screen.getByTestId('esport-tk-pmodele-creer'));
  await screen.findByTestId('esport-tk-pan-editeur');
  expect(appels.find(a => a.chemin === '/tickets/config/panneaux/defaut')!.corps).toEqual({ modele: 'evenement', evenement: 'The Nuke End', categorieId: 'c0', ajouterManquantes: false });
  expect(screen.queryByTestId('esport-tk-pmodeles')).toBeNull();
  await screen.findByText(/Panneau créé, pas encore publié/);
  // Éditeur : libellé propre du bouton, conseil « lecture seule » ; rien n'a été publié.
  expect(screen.getByTestId('esport-tk-pan-libelle-c0-fr').props.value).toBe('S’inscrire');
  expect(screen.getByTestId('esport-tk-pan-lecture-seule')).toHaveTextContent(/lecture seule pour @everyone/);
  expect(appels.some(a => a.chemin.endsWith('/publier'))).toBe(false);
});

test('Bienvenue : rôle, salon et message choisis, activation enregistrée ; titulaires actuels annoncés ; message d’essai', async () => {
  const { client, appels } = fauxClient(configDe());
  await render(<ConfigTickets theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-conf-onglet-bienvenue'));
  expect(screen.getByText(/Server Members Intent/)).toBeTruthy();
  await fireEvent(screen.getByTestId('esport-tk-bv-actif'), 'valueChange', true);
  await choisirDans('esport-tk-bv-role', '720');
  await choisirDans('esport-tk-bv-salon', '713');
  await fireEvent.changeText(screen.getByTestId('esport-tk-bv-message'), 'Bienvenue {membre} dans {role} 💥');
  expect(screen.getByTestId('esport-tk-bv-suppression').props.value).toBe('10');
  await fireEvent.changeText(screen.getByTestId('esport-tk-bv-suppression'), '5');
  await fireEvent.press(screen.getByTestId('esport-tk-bv-enregistrer'));
  await screen.findByText(/3 membre\(s\) qui avaient déjà le rôle/);
  const put = appels.find(a => a.chemin === '/tickets/config/bienvenue' && a.methode === 'PUT')!.corps as Record<string, unknown>;
  expect(put).toMatchObject({ actif: true, roleId: '720', roleNom: 'Staff', salonId: '713', message: 'Bienvenue {membre} dans {role} 💥', supprimerApresS: 5 });
  await fireEvent.press(screen.getByTestId('esport-tk-bv-tester'));
  await screen.findByText('Message d’essai publié dans le salon.');
});

test('Bienvenue : intent « Server Members » refusé par Discord : rappel affiché', async () => {
  const conf = configDe();
  conf.bienvenueEtat = { membresRefuses: true };
  const { client } = fauxClient(conf);
  await render(<ConfigTickets theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-conf-onglet-bienvenue'));
  expect(screen.getByTestId('esport-tk-bv-refus')).toBeTruthy();
});
