/**
 * Tickets, écrans : grande zone de réponse (6 lignes sur ordinateur, 5 sur téléphone, jusqu'à la moitié de l'écran ;
 * Entrée = nouvelle ligne, Ctrl/Cmd+Entrée = envoyer), « Mentionner » (cibles proposées, recherche d'un membre, mention
 * envoyée avec exactement les cibles cochées), événement « non publié sur Discord » dans la conversation, et
 * Configuration › Messages › « Messages automatiques dans le salon » (un interrupteur par événement).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import type { ClientEsport } from './client';
import { definirLangue } from './i18n';
import { ModeAffichageForce } from '../ui/mobile/useMobile';
import { apiTickets, type ConfigTickets as Config, type DetailTicket, type Mentionnables } from './tickets/api';
import { VueTicket } from './ui/tickets/TicketsStaff';
import { ConfigTickets } from './ui/tickets/ConfigTickets';
import { HAUTEUR_LIGNE_COMPOSEUR, bornesComposeur, estRaccourciEnvoi } from './ui/tickets/ComposeurTicket';

const theme = themeHub('nuit');
afterEach(() => definirLangue('fr'));

const CAT = { id: 'cat1', nom: { fr: 'Recrutement', en: 'Recruitment' }, couleur: '#5865f2', icone: 'membres', actif: true };

function detail(gerer = true): DetailTicket {
  return {
    id: 't1',
    numero: 1,
    categorie: CAT,
    statut: 'ouvert',
    priorite: 'moyen',
    auteur: { discordId: '8001', nom: 'Léa', compte: null },
    responsable: null,
    ouvertLe: '2026-11-04T10:00:00.000Z',
    derniereActivite: '2026-11-04T10:00:00.000Z',
    fermeLe: null,
    note: null,
    nonLu: false,
    permanent: false,
    nonLuDepuis: null,
    salon: { id: '9001', nom: 'ticket-0001', supprime: false },
    reponses: [],
    raison: null,
    noteCommentaire: null,
    liaison: { type: 'aucune' },
    liaisonCategorie: { type: 'aucune' },
    purge: false,
    fermeture: { heures: 168, source: 'general', staffSeul: false, permanentPar: null, permanentLe: null },
    membres: [{ discordId: '8002', nom: 'Bob', depuis: '2026-11-04T10:00:00.000Z' }],
    messages: [{ id: 'm1', genre: 'systeme', auteur: { nom: 'Esport HQ', discordId: null, compte: null }, staff: true, contenu: 'Priorité : Urgente.', envoi: 'ok', nonPublie: true, le: '2026-11-04T10:01:00.000Z', modifieLe: null, supprimeLe: null, pieces: [] }],
    droits: { repondre: true, gerer },
  };
}

const MENTIONNABLES: Mentionnables = {
  auteur: { discordId: '8001', nom: 'Léa' },
  membres: [{ discordId: '8002', nom: 'Bob' }],
  roles: [{ id: '720', nom: 'Staff' }],
  staff: [{ discordId: '8003', nom: 'Kai' }],
  recherche: null,
};

function fauxClient({ gerer = true } = {}) {
  const appels: Array<{ chemin: string; methode?: string; corps?: unknown }> = [];
  const requete = async (chemin: string, methode?: string, corps?: unknown): Promise<unknown> => {
    appels.push({ chemin, methode, corps });
    if (chemin === '/tickets/t1') return detail(gerer);
    if (chemin === '/tickets/t1/lu') return { ok: true };
    if (chemin === '/tickets/t1/assignables') return { comptes: [] };
    if (chemin === '/tickets/t1/mentionnables') return MENTIONNABLES;
    if (chemin.startsWith('/tickets/t1/mentionnables?q=')) return { ...MENTIONNABLES, recherche: [{ discordId: '8077', nom: 'Zoé', pseudo: 'zoe' }] };
    if (chemin === '/tickets/t1/mentionner' || chemin === '/tickets/t1/messages' || chemin === '/tickets/t1/notes') return detail(gerer);
    throw new Error(`inattendu : ${methode ?? 'GET'} ${chemin}`);
  };
  const client = { requete } as unknown as ClientEsport;
  return { client, api: apiTickets(client), appels };
}

const hauteurDe = (el: { props: { style?: unknown } }) => {
  const plat = ([] as unknown[]).concat(el.props.style as unknown[]).flat(3).filter(Boolean) as Array<Record<string, unknown>>;
  return Object.assign({}, ...plat) as { height?: number; minHeight?: number; maxHeight?: number; width?: string };
};

test('bornes de la zone de réponse : 6 lignes sur ordinateur, 5 sur téléphone, au plus la moitié de l’écran ; Ctrl/Cmd+Entrée', () => {
  expect(bornesComposeur(false, 1000)).toEqual({ min: 6 * HAUTEUR_LIGNE_COMPOSEUR + 20, max: 500 });
  expect(bornesComposeur(true, 800)).toEqual({ min: 5 * HAUTEUR_LIGNE_COMPOSEUR + 20, max: 400 });
  expect(bornesComposeur(true, 200).max).toBe(bornesComposeur(true, 200).min);
  expect(estRaccourciEnvoi({ key: 'Enter', ctrlKey: true })).toBe(true);
  expect(estRaccourciEnvoi({ key: 'Enter', metaKey: true })).toBe(true);
  expect(estRaccourciEnvoi({ key: 'Enter' })).toBe(false);
  expect(estRaccourciEnvoi({ key: 'a', ctrlKey: true })).toBe(false);
});

test('zone de réponse : grande sur ordinateur (pleine largeur, rappel du raccourci), Entrée = ligne, Ctrl+Entrée = envoyer ; note interne aussi', async () => {
  const { client, api, appels } = fauxClient();
  await render(
    <ModeAffichageForce mode="large">
      <VueTicket theme={theme} client={client} api={api} id="t1" categories={[]} large />
    </ModeAffichageForce>,
  );
  const champ = await screen.findByTestId('esport-tk-message');
  const s = hauteurDe(champ);
  expect(s.height).toBeGreaterThanOrEqual(6 * HAUTEUR_LIGNE_COMPOSEUR);
  expect(s.minHeight).toBeGreaterThanOrEqual(6 * HAUTEUR_LIGNE_COMPOSEUR);
  expect(s.width).toBe('100%');
  expect(champ.props.multiline).toBe(true);
  expect(screen.getByTestId('esport-tk-message-raccourci')).toHaveTextContent(/Ctrl\+Entrée/);
  await fireEvent.changeText(champ, 'Ligne 1\nLigne 2');
  await fireEvent(champ, 'keyPress', { nativeEvent: { key: 'Enter' }, preventDefault: () => undefined });
  expect(appels.some(a => a.chemin === '/tickets/t1/messages')).toBe(false);
  await fireEvent(champ, 'keyPress', { nativeEvent: { key: 'Enter', ctrlKey: true }, preventDefault: () => undefined });
  await waitFor(() => expect(appels.some(a => a.chemin === '/tickets/t1/messages' && a.methode === 'POST')).toBe(true));
  expect((appels.find(a => a.chemin === '/tickets/t1/messages')!.corps as { texte: string }).texte).toBe('Ligne 1\nLigne 2');
  // Champ vide : Cmd+Entrée n'envoie rien.
  await waitFor(() => expect(screen.getByTestId('esport-tk-message').props.value).toBe(''));
  await fireEvent(screen.getByTestId('esport-tk-message'), 'keyPress', { nativeEvent: { key: 'Enter', metaKey: true }, preventDefault: () => undefined });
  expect(appels.filter(a => a.chemin === '/tickets/t1/messages').length).toBe(1);
  // Note interne : même grande zone, Cmd+Entrée enregistre la note.
  await fireEvent(screen.getByTestId('esport-tk-mode-note'), 'valueChange', true);
  await fireEvent.changeText(screen.getByTestId('esport-tk-message'), 'À vérifier');
  await fireEvent(screen.getByTestId('esport-tk-message'), 'keyPress', { nativeEvent: { key: 'Enter', metaKey: true }, preventDefault: () => undefined });
  await waitFor(() => expect(appels.some(a => a.chemin === '/tickets/t1/notes')).toBe(true));
  // Événement non publié sur Discord : marqué dans la conversation.
  expect(screen.getByTestId('esport-tk-msg-m1-non-publie')).toHaveTextContent('non publié sur Discord');
});

test('zone de réponse sur téléphone : 5 lignes au départ', async () => {
  const { client, api } = fauxClient();
  await render(
    <ModeAffichageForce mode="telephone">
      <VueTicket theme={theme} client={client} api={api} id="t1" categories={[]} />
    </ModeAffichageForce>,
  );
  const s = hauteurDe(await screen.findByTestId('esport-tk-message'));
  expect(s.minHeight).toBe(5 * HAUTEUR_LIGNE_COMPOSEUR + 20);
  expect(s.maxHeight).toBeGreaterThanOrEqual(s.minHeight!);
});

test('« Mentionner » : auteur, personnes ajoutées, rôles, staff, recherche ; mention envoyée avec les cibles cochées (personne trouvée ajoutée)', async () => {
  const { client, api, appels } = fauxClient();
  await render(<VueTicket theme={theme} client={client} api={api} id="t1" categories={[]} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-mentionner'));
  await screen.findByTestId('esport-tk-mention-auteur-8001');
  expect(screen.getByTestId('esport-tk-mention-membre-8002')).toBeTruthy();
  expect(screen.getByTestId('esport-tk-mention-role-720')).toHaveTextContent('@Staff');
  expect(screen.getByTestId('esport-tk-mention-staff-8003')).toBeTruthy();
  expect(screen.getByTestId('esport-tk-mention-envoyer').props.accessibilityState?.disabled).toBe(true);
  await fireEvent.press(screen.getByTestId('esport-tk-mention-auteur-8001'));
  await fireEvent.press(screen.getByTestId('esport-tk-mention-role-720'));
  expect(screen.getByTestId('esport-tk-mention-auteur-8001').props.accessibilityState).toEqual({ checked: true });
  await fireEvent.changeText(screen.getByTestId('esport-tk-mention-q'), 'zo');
  await fireEvent.press(screen.getByTestId('esport-tk-mention-chercher'));
  await fireEvent.press(await screen.findByTestId('esport-tk-mention-trouve-8077'));
  expect(screen.getByTestId('esport-tk-mention-ajouter').props.value).toBe(true);
  await fireEvent.changeText(screen.getByTestId('esport-tk-mention-message'), 'Merci de confirmer');
  expect(screen.getByTestId('esport-tk-mention-envoyer')).toHaveTextContent('Mentionner (3)');
  await fireEvent.press(screen.getByTestId('esport-tk-mention-envoyer'));
  await waitFor(() => expect(appels.some(a => a.chemin === '/tickets/t1/mentionner')).toBe(true));
  const corps = appels.find(a => a.chemin === '/tickets/t1/mentionner')!.corps as { cibles: unknown[]; message: string };
  expect(corps.message).toBe('Merci de confirmer');
  expect(corps.cibles).toEqual([
    { type: 'membre', id: '8001', nom: 'Léa' },
    { type: 'role', id: '720', nom: 'Staff' },
    { type: 'membre', id: '8077', nom: 'Zoé', ajouter: true },
  ]);
  expect(appels.some(a => a.chemin === '/tickets/t1/mentionnables?q=zo')).toBe(true);
  await waitFor(() => expect(screen.queryByTestId('esport-tk-mention')).toBeNull());
  await screen.findByText('Mention publiée dans le ticket.');
});

test('« Mentionner » sans tickets.gerer : la personne trouvée n’est pas ajoutée au ticket', async () => {
  const { client, api, appels } = fauxClient({ gerer: false });
  await render(<VueTicket theme={theme} client={client} api={api} id="t1" categories={[]} />);
  await fireEvent.press(await screen.findByTestId('esport-tk-mentionner'));
  await fireEvent.changeText(await screen.findByTestId('esport-tk-mention-q'), 'zo');
  await fireEvent.press(screen.getByTestId('esport-tk-mention-chercher'));
  await fireEvent.press(await screen.findByTestId('esport-tk-mention-trouve-8077'));
  expect(screen.queryByTestId('esport-tk-mention-ajouter')).toBeNull();
  await fireEvent.press(screen.getByTestId('esport-tk-mention-envoyer'));
  await waitFor(() => expect(appels.some(a => a.chemin === '/tickets/t1/mentionner')).toBe(true));
  expect((appels.find(a => a.chemin === '/tickets/t1/mentionner')!.corps as { cibles: unknown[] }).cibles).toEqual([{ type: 'membre', id: '8077', nom: 'Zoé' }]);
});

const ANNONCES_DEFAUT = { prise_en_charge: true, liberation: false, attente: false, priorite: false, ajoute: true, retire: false, transfere: false, permanent: false, hors_horaires: true, avertissement: true, fermeture: true, reouverture: true, mp_fermeture: true };

function configDe(): Config {
  return {
    general: { actif: true, guildId: '700', guildNom: 'Club', categorieOuverts: '710', categorieArchives: null, salonJournaux: null, langue: 'auteur', fermetureAutoH: 168, avertissementH: 24, suppressionArchivesJours: 7, retentionJours: 365, copierPieces: true, pieceMaxMo: 8, reponsesAppSeules: true, annonces: { ...ANNONCES_DEFAUT } },
    messages: {},
    messagesDefaut: { accueil: { fr: 'Bonjour {utilisateur}', en: 'Hi {utilisateur}' } },
    annoncesDefaut: ANNONCES_DEFAUT,
    horaires: { actif: false, fuseau: 'Europe/Paris', plages: [] },
    commandes: {},
    bienvenue: { actif: false, roleId: null, roleNom: '', salonId: null, message: 'Bienvenue {membre}', supprimerApresS: 10, depuis: null, existantsNotes: false },
    bienvenueEtat: {},
    bienvenueMessageDefaut: 'Bienvenue {membre}',
    categories: [],
    panneaux: [],
    listeNoire: [],
    rolesApp: [],
    tableauxCm: [],
    choix: { langues: ['auteur', 'en_fr', 'fr_en', 'fr', 'en'], icones: ['billets'], priorites: ['faible', 'moyen', 'urgent', 'critique'], liaisons: ['aucune'], commandes: ['ping'], commandesStaff: ['ping'], limites: {}, permissionsBot: [] },
    bot: true,
    lienInvitation: null,
  };
}

test('Messages › « Messages automatiques dans le salon » : défauts affichés, un événement réactivé et un coupé, seuls les messages automatiques envoyés', async () => {
  const conf = configDe();
  const appels: Array<{ chemin: string; methode?: string; corps?: unknown }> = [];
  const requete = async (chemin: string, methode?: string, corps?: unknown): Promise<unknown> => {
    appels.push({ chemin, methode, corps });
    if (chemin === '/tickets/config') return conf;
    if (chemin === '/tickets/etat') return { actif: true, bot: true, connexion: { mode: 'direct', depuis: null } };
    if (chemin.startsWith('/tickets/config/discord')) return { bot: true, serveurs: [], serveur: { id: '700', nom: 'Club' }, salons: [], roles: [], permissions: null };
    if (chemin === '/tickets/config/general' && methode === 'PUT') {
      conf.general = { ...conf.general, ...(corps as object) };
      return { ...conf };
    }
    throw new Error(`inattendu : ${methode ?? 'GET'} ${chemin}`);
  };
  await render(<ConfigTickets theme={theme} client={{ requete } as unknown as ClientEsport} large />);
  await fireEvent.press(await screen.findByTestId('esport-tk-conf-onglet-messages'));
  await screen.findByText('Messages automatiques dans le salon');
  expect(screen.getByTestId('esport-tk-annonce-priorite-actif').props.value).toBe(false);
  expect(screen.getByTestId('esport-tk-annonce-priorite')).toHaveTextContent(/silencieux par défaut/);
  expect(screen.getByTestId('esport-tk-annonce-prise_en_charge-actif').props.value).toBe(true);
  expect(screen.getByTestId('esport-tk-annonce-ajoute-actif').props.value).toBe(true);
  expect(screen.getByTestId('esport-tk-annonce-fermeture')).toHaveTextContent(/publié par défaut/);
  await fireEvent(screen.getByTestId('esport-tk-annonce-priorite-actif'), 'valueChange', true);
  await fireEvent(screen.getByTestId('esport-tk-annonce-prise_en_charge-actif'), 'valueChange', false);
  await fireEvent.press(screen.getByTestId('esport-tk-annonces-enregistrer'));
  await waitFor(() => expect(appels.some(a => a.chemin === '/tickets/config/general' && a.methode === 'PUT')).toBe(true));
  const corps = appels.find(a => a.methode === 'PUT')!.corps as Record<string, unknown>;
  expect(Object.keys(corps)).toEqual(['annonces']);
  expect(corps.annonces).toEqual({ ...ANNONCES_DEFAUT, priorite: true, prise_en_charge: false });
});
