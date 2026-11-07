/**
 * Client des tickets Discord (migration 0054, docs/esport/tickets.md), par l'appel générique du client Esport.
 * Types miroirs de l'API (esport/noyau/tickets/).
 */

import { requeteUrl, type ClientEsport } from '../client';

export type DeuxLangues = { fr: string; en: string };
export type ModeLangue = 'auteur' | 'en_fr' | 'fr_en' | 'fr' | 'en';
export type Priorite = 'faible' | 'moyen' | 'urgent' | 'critique';
export type Statut = 'ouvert' | 'pris_en_charge' | 'en_attente' | 'resolu' | 'ferme';
export type TypeLiaison = 'aucune' | 'sponsors' | 'cm' | 'fiche';
export type ModeConnexion = 'direct' | 'secours' | 'hors_ligne';

export const PRIORITES: readonly Priorite[] = ['faible', 'moyen', 'urgent', 'critique'];
export const STATUTS: readonly Statut[] = ['ouvert', 'pris_en_charge', 'en_attente', 'resolu', 'ferme'];
export const MODES_LANGUE: readonly ModeLangue[] = ['auteur', 'en_fr', 'fr_en', 'fr', 'en'];

export interface MoiTickets {
  voir: boolean;
  repondre: boolean;
  gerer: boolean;
  configurer: boolean;
  fondateur?: boolean;
  actif: boolean;
  bot?: boolean;
  nonLus?: number;
}

export interface Connexion {
  mode: ModeConnexion;
  depuis: string | null;
  gateway?: string | null;
  code?: number | null;
  dernierAck?: string | null;
  prochainEssai?: string | null;
  releve?: { salons: number; messages: number; limite: boolean; le: string } | null;
  intentRefuse?: boolean;
  jetonRefuse?: boolean;
  sansWebSocket?: boolean;
  dernierEssai?: string | null;
  derniereErreur?: { motif: string; le: string } | null;
  reveil?: { ok: boolean; statut: number; erreur?: string; le: string } | null;
}

/** Diagnostic complet de la connexion (Tickets › Configuration › Connexion), condition par condition. */
export interface DiagnosticTickets {
  bot: boolean;
  serveur: { id: string; nom: string } | null;
  categorie: boolean;
  actif: boolean;
  gatewayActivee: boolean;
  reveilConfigure: boolean | null;
  processus: { role: 'inactif' | 'suiveur' | 'meneur' | null; raison: string | null; le: string; frais: boolean } | null;
  meneur: boolean;
  connexion: Connexion;
  cron: { le: string; frais: boolean } | null;
}

export interface EtatTickets {
  actif: boolean;
  bot: boolean;
  connexion: Connexion;
  diagnostic?: DiagnosticTickets;
}

export interface General {
  actif: boolean;
  guildId: string | null;
  guildNom: string;
  categorieOuverts: string | null;
  categorieArchives: string | null;
  salonJournaux: string | null;
  langue: ModeLangue;
  fermetureAutoH: number;
  avertissementH: number;
  suppressionArchivesJours: number;
  retentionJours: number;
  copierPieces: boolean;
  pieceMaxMo: number;
  /** Personne n'écrit dans les salons : le staff répond depuis l'app, l'auteur avec le bouton « Répondre » du bot. */
  reponsesAppSeules: boolean;
}

/** Catégorie par défaut (modèle proposé par le serveur, esport/noyau/tickets/modeles.mjs). */
export interface ModeleCategorie {
  cle: string;
  nom: DeuxLangues;
  description: DeuxLangues;
  icone: string;
  couleur: string;
  formulaire: ChampFormulaire[];
  fermetureAutoH?: number | null;
  fermetureStaffSeul?: boolean;
  rolesApp?: string[];
  /** Catégorie d'événement (tournoi) : jamais semée automatiquement. */
  evenement?: boolean;
}

/** Panneau par défaut (esport/noyau/tickets/modeles.mjs : PANNEAUX_DEFAUT). */
export interface ModelePanneau {
  cle: string;
  nom: DeuxLangues;
  description: DeuxLangues;
  titre: DeuxLangues;
  texte: DeuxLangues;
  couleur: string;
  style: 'boutons' | 'menu' | 'auto';
  /** Clés de catégories par défaut, ou 'toutes' (toutes les catégories actives). */
  categories: string[] | 'toutes';
  /** Le nom de l'événement est demandé, et la catégorie peut être choisie. */
  evenement?: boolean;
  /** Nom de l'événement déjà fixé (panneau prêt d'un tournoi). */
  evenementFixe?: string;
  libelleBouton?: DeuxLangues;
}

export interface ChampFormulaire {
  id: string;
  libelle: DeuxLangues;
  style: 'court' | 'long';
  requis: boolean;
  placeholder: DeuxLangues;
  min: number;
  max: number;
}

export interface Categorie {
  id: string;
  nom: DeuxLangues;
  description: DeuxLangues;
  icone: string;
  couleur: string;
  position: number;
  actif: boolean;
  rolesDiscord: string[];
  rolesApp: string[];
  formulaire: ChampFormulaire[];
  accueil: DeuxLangues;
  modeleNom: string;
  maxOuverts: number;
  /** Fermeture automatique : null = délai général, 0 = jamais, N = N heures sans message. */
  fermetureAutoH: number | null;
  /** Seul le staff ferme les tickets de cette catégorie (l'auteur ne peut pas). */
  fermetureStaffSeul: boolean;
  satisfaction: boolean;
  prioriteDefaut: Priorite;
  mentions: string[];
  liaison: { type: TypeLiaison; tableauId?: string };
}

export interface Panneau {
  id: string;
  titre: DeuxLangues;
  texte: DeuxLangues;
  couleur: string;
  imageElementId: string | null;
  style: 'boutons' | 'menu';
  categories: string[];
  /** Libellé propre d'un bouton, par catégorie (à la place de son nom). */
  libelles?: Record<string, DeuxLangues>;
  salonId: string | null;
  messageId: string | null;
  publieLe: string | null;
  erreur: string | null;
  majLe: string;
}

export interface Horaires {
  actif: boolean;
  fuseau: string;
  plages: Array<{ jour: number; debut: string; fin: string }>;
}

export type Commandes = Record<string, { actif: boolean; roles: string[] }>;

/** Bienvenue par rôle (Tickets › Configuration › Bienvenue). */
export interface Bienvenue {
  actif: boolean;
  roleId: string | null;
  roleNom: string;
  salonId: string | null;
  message: string;
  depuis: string | null;
  existantsNotes: boolean;
}
export interface EtatBienvenue {
  membresRefuses?: boolean;
  dernier?: { le: string; ok: boolean; statut?: number; code?: number | null };
}

export interface ConfigTickets {
  general: General;
  messages: Partial<Record<string, DeuxLangues>>;
  messagesDefaut: Record<string, DeuxLangues>;
  horaires: Horaires;
  commandes: Commandes;
  bienvenue: Bienvenue;
  bienvenueEtat: EtatBienvenue;
  bienvenueMessageDefaut: string;
  categories: Categorie[];
  /** Catégories par défaut proposées (bouton « Catégories par défaut »). */
  modeles?: ModeleCategorie[];
  /** Panneaux par défaut proposés (bouton « Panneaux par défaut »). */
  modelesPanneaux?: ModelePanneau[];
  panneaux: Panneau[];
  listeNoire: Array<{ discordId: string; nom: string; raison: string; ajouteLe: string }>;
  rolesApp: Array<{ cle: string; nom: string; couleur: string; famille: 'club' | 'cm' }>;
  tableauxCm: Array<{ id: string; nom: string }>;
  choix: { langues: ModeLangue[]; icones: string[]; priorites: Priorite[]; liaisons: TypeLiaison[]; commandes: string[]; commandesStaff: string[]; limites: Record<string, number>; permissionsBot: string[] };
  bot: boolean;
  lienInvitation: string | null;
}

export interface SalonDiscord {
  id: string;
  nom: string;
  type: 'categorie' | 'texte';
  parent: string | null;
}
export interface VerifSalon {
  id: string;
  nom?: string;
  introuvable?: boolean;
  manquantes: string[];
}
export interface ServeurDiscord {
  bot: boolean;
  /** `discord-<statut>` (0 : Discord injoignable), `bot-absent` (le bot n'est pas sur ce serveur). */
  erreur?: string | null;
  erreurDetail?: { etape: 'serveurs' | 'salons' | 'roles'; statut: number; code: number | null } | null;
  serveurs?: Array<{ id: string; nom: string }>;
  serveur?: { id: string; nom: string; enregistre?: boolean };
  salons?: SalonDiscord[];
  roles?: Array<{ id: string; nom: string; couleur: string | null }>;
  permissions?: { membreTrouve: boolean; serveur: string[]; ouverts: VerifSalon | null; archives: VerifSalon | null; journaux: VerifSalon | null };
}

/** Charge d'un message Discord (aperçu « comme sur Discord »). */
export interface ChargeDiscord {
  content?: string;
  embeds: Array<{ title?: string; description?: string; color?: number; image?: { url: string }; fields?: Array<{ name: string; value: string; inline?: boolean }> }>;
  components: Array<{ type: number; components: Array<{ type: number; style?: number; label?: string; custom_id?: string; placeholder?: string; options?: Array<{ label: string; value: string; description?: string }> }> }>;
}

export interface CategorieCourte {
  id: string;
  nom: DeuxLangues;
  couleur: string;
  icone: string;
  actif: boolean;
}

export interface ResumeTicket {
  id: string;
  numero: number;
  categorie: CategorieCourte;
  statut: Statut;
  priorite: Priorite;
  auteur: { discordId: string; nom: string; compte: string | null };
  responsable: { nom: string; compte: string | null; discordId: string | null; moi: boolean } | null;
  ouvertLe: string;
  derniereActivite: string;
  fermeLe: string | null;
  note: number | null;
  nonLu: boolean;
  /** Ticket permanent : jamais fermé automatiquement. */
  permanent: boolean;
}

export interface PieceTicket {
  id: string;
  nom: string;
  type: string;
  taille: number;
  copiee: boolean;
  url: string | null;
}

export interface MessageTicket {
  id: string;
  genre: 'discord' | 'app' | 'note' | 'systeme';
  auteur: { nom: string; discordId: string | null; compte: string | null };
  staff: boolean;
  contenu: string;
  envoi: 'ok' | 'attente' | 'echec';
  le: string;
  modifieLe: string | null;
  supprimeLe: string | null;
  pieces: PieceTicket[];
}

export interface Liaison {
  type: TypeLiaison;
  id?: string;
  titre?: string;
  tableauId?: string;
  compte?: string;
}

export interface DetailTicket extends ResumeTicket {
  nonLuDepuis: string | null;
  salon: { id: string; nom: string; supprime: boolean } | null;
  reponses: Array<{ id: string; libelle: DeuxLangues; valeur: string }>;
  raison: string | null;
  noteCommentaire: string | null;
  /** Date de la note de l'auteur (migration 0056 : vue du ticket fermé). */
  noteLe?: string | null;
  liaison: Liaison;
  liaisonCategorie: { type: TypeLiaison; tableauId?: string };
  purge: boolean;
  /** Fermeture automatique : délai en heures (0 : jamais) et d'où il vient (ticket permanent > catégorie > général). */
  fermeture: { heures: number; source: 'ticket' | 'categorie' | 'general'; staffSeul: boolean; permanentPar: string | null; permanentLe: string | null };
  membres: Array<{ discordId: string; nom: string; depuis: string }>;
  messages: MessageTicket[];
  /** `supprimer` : supprimer ce ticket une fois fermé (tickets.gerer, ou configurer pour une catégorie de ses rôles). */
  droits: { repondre: boolean; gerer: boolean; supprimer?: boolean };
}

export interface FiltresTickets {
  statut?: string;
  categorie?: string;
  priorite?: string;
  responsable?: string;
  auteur?: string;
  du?: string;
  au?: string;
  q?: string;
}

export interface BlocStats {
  crees: number;
  fermes: number;
  premiereReponseMs: number | null;
  resolutionMs: number | null;
  satisfaction: number | null;
  notes: number;
}
export interface StatsTickets {
  du: string;
  au: string;
  total: BlocStats & { ouverts: number };
  parCategorie: Array<BlocStats & { categorie: CategorieCourte; ouverts: number }>;
  parResponsable: Array<BlocStats & { nom: string; compte: string | null }>;
}

/** Un avis de satisfaction (migration 0056) ; `anonyme` : ticket supprimé, avis gardé sans lien. */
export interface AvisTicket {
  id: string;
  ticketId: string | null;
  numero: number | null;
  salon: string | null;
  anonyme: boolean;
  categorie: CategorieCourte;
  note: number;
  commentaire: string | null;
  auteur: string | null;
  responsable: { nom: string; cle: string } | null;
  le: string;
}

export type TriAvis = 'recent' | 'ancien' | 'note_haut' | 'note_bas';
export interface FiltresAvis {
  categorie?: string;
  note?: string;
  du?: string;
  au?: string;
  responsable?: string;
  tri?: TriAvis;
}

export interface ListeAvis {
  total: number;
  moyenne: number | null;
  /** Nombre d'avis de chaque note, de 1 à 5 (mêmes filtres, sauf la note). */
  repartition: number[];
  avis: AvisTicket[];
  categories: CategorieCourte[];
  responsables: Array<{ cle: string; nom: string }>;
  /** L'acteur peut ouvrir les tickets (tickets.voir). */
  voirTickets: boolean;
}

/** Pièce jointe envoyée depuis l'appareil (contenu en base64, 8 Mo au plus). */
export interface PieceEnvoyee {
  nom: string;
  type: string;
  base64: string;
}

export function apiTickets(client: ClientEsport) {
  const r = <T>(chemin: string, methode?: string, corps?: unknown) => client.requete<T>(chemin, methode, corps);
  return {
    moi: () => r<MoiTickets>('/tickets/moi'),
    etat: () => r<EtatTickets>('/tickets/etat'),
    config: () => r<ConfigTickets>('/tickets/config'),
    /** Serveur Discord : celui enregistré, ou `serveur` (choisi dans l'app, pas encore enregistré). */
    discord: (serveur?: string | null) => r<ServeurDiscord>(`/tickets/config/discord${serveur ? `?serveur=${encodeURIComponent(serveur)}` : ''}`),
    changerGeneral: (c: Partial<General>) => r<ConfigTickets & { reapplication?: { ok: number; echecs: number; total: number } }>('/tickets/config/general', 'PUT', c),
    changerMessages: (c: Record<string, DeuxLangues>) => r<ConfigTickets>('/tickets/config/messages', 'PUT', c),
    changerHoraires: (c: Horaires) => r<ConfigTickets>('/tickets/config/horaires', 'PUT', c),
    changerCommandes: (c: Commandes) => r<ConfigTickets>('/tickets/config/commandes', 'PUT', c),
    changerBienvenue: (c: Partial<Bienvenue>) => r<ConfigTickets & { titulaires?: { ok: boolean; notes?: number } }>('/tickets/config/bienvenue', 'PUT', c),
    testerBienvenue: () => r<{ ok: boolean; erreur?: string }>('/tickets/config/bienvenue/test', 'POST', {}),
    creerCategorie: (c: Partial<Categorie>) => r<{ id: string; categories: Categorie[] }>('/tickets/config/categories', 'POST', c),
    modifierCategorie: (id: string, c: Partial<Categorie>) => r<{ categories: Categorie[] }>(`/tickets/config/categories/${encodeURIComponent(id)}`, 'PATCH', c),
    supprimerCategorie: (id: string) => r<{ categories: Categorie[] }>(`/tickets/config/categories/${encodeURIComponent(id)}`, 'DELETE'),
    ajouterModeles: (cles: string[]) => r<{ ajoutees: string[]; ignorees: string[]; categories: Categorie[] }>('/tickets/config/categories/defaut', 'POST', { cles }),
    ordonnerCategories: (ordre: string[]) => r<{ categories: Categorie[] }>('/tickets/config/categories/ordre', 'PUT', { ordre }),
    creerPanneauModele: (c: { modele: string; evenement?: string; categorieId?: string | null; ajouterManquantes: boolean }) => r<{ panneau: Panneau; ajoutees: string[]; ignorees: string[]; renomme: boolean; categories: Categorie[] }>('/tickets/config/panneaux/defaut', 'POST', c),
    creerPanneau: (c: Partial<Panneau>) => r<Panneau>('/tickets/config/panneaux', 'POST', c),
    modifierPanneau: (id: string, c: Partial<Panneau>) => r<Panneau>(`/tickets/config/panneaux/${encodeURIComponent(id)}`, 'PATCH', c),
    supprimerPanneau: (id: string) => r<{ ok: true }>(`/tickets/config/panneaux/${encodeURIComponent(id)}`, 'DELETE'),
    apercuPanneau: (id: string) => r<{ charge: ChargeDiscord }>(`/tickets/config/panneaux/${encodeURIComponent(id)}/apercu`),
    publierPanneau: (id: string) => r<Panneau>(`/tickets/config/panneaux/${encodeURIComponent(id)}/publier`, 'POST'),
    ajouterListeNoire: (c: { discordId: string; nom?: string; raison?: string }) => r<{ ok: true }>('/tickets/config/liste-noire', 'POST', c),
    retirerListeNoire: (id: string) => r<{ ok: true }>(`/tickets/config/liste-noire/${encodeURIComponent(id)}`, 'DELETE'),
    liste: (f: FiltresTickets = {}) => r<{ tickets: ResumeTicket[]; categories: CategorieCourte[]; droits: { repondre: boolean; gerer: boolean; configurer: boolean; supprimer?: boolean } }>(`/tickets${requeteUrl({ ...f })}`),
    compteur: () => r<{ nonLus: number; ouverts?: number }>('/tickets/compteur'),
    detail: (id: string) => r<DetailTicket>(`/tickets/${encodeURIComponent(id)}`),
    lu: (id: string) => r<{ ok: true }>(`/tickets/${encodeURIComponent(id)}/lu`, 'POST'),
    repondre: (id: string, c: { texte: string; pieces?: PieceEnvoyee[]; drive?: string[] }) => r<DetailTicket>(`/tickets/${encodeURIComponent(id)}/messages`, 'POST', c),
    noter: (id: string, texte: string) => r<DetailTicket>(`/tickets/${encodeURIComponent(id)}/notes`, 'POST', { texte }),
    action: (id: string, action: string, corps: Record<string, unknown> = {}) => r<DetailTicket>(`/tickets/${encodeURIComponent(id)}/${action}`, 'POST', corps),
    assignables: (id: string) => r<{ comptes: Array<{ compte: string; pseudo: string | null }> }>(`/tickets/${encodeURIComponent(id)}/assignables`),
    transcript: (id: string) => r<{ nom: string; contenu: string; type: string }>(`/tickets/${encodeURIComponent(id)}/transcript`),
    lienPiece: (id: string, piece: string, telecharger = false) => r<{ url: string; expire: number }>(`/tickets/${encodeURIComponent(id)}/pieces/${encodeURIComponent(piece)}/lien${requeteUrl({ telecharger: telecharger ? '1' : undefined })}`, 'POST'),
    lier: (id: string, c: { type: TypeLiaison; id?: string; nom?: string; tableauId?: string }) => r<DetailTicket>(`/tickets/${encodeURIComponent(id)}/liaison`, 'POST', c),
    stats: (p: { du?: string; au?: string } = {}) => r<StatsTickets>(`/tickets/stats${requeteUrl({ ...p })}`),
    avis: (f: FiltresAvis = {}) => r<ListeAvis>(`/tickets/avis${requeteUrl({ ...f })}`),
    supprimer: (id: string, garderAvis: boolean) => r<{ ok: true; numero: number }>(`/tickets/${encodeURIComponent(id)}/supprimer`, 'POST', { garderAvis }),
    supprimerPlusieurs: (ids: string[], garderAvis: boolean) => r<{ supprimes: number[]; echecs: Array<{ id: string; code: string }> }>('/tickets/supprimer', 'POST', { ids, garderAvis }),
    preferences: () => r<{ mpNouveau: boolean; mpMessage: boolean }>('/tickets/preferences'),
    changerPreferences: (c: { mpNouveau: boolean; mpMessage: boolean }) => r<{ mpNouveau: boolean; mpMessage: boolean }>('/tickets/preferences', 'PUT', c),
  };
}
export type ApiTickets = ReturnType<typeof apiTickets>;
