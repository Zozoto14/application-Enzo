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
  fermetureAutoH: number | null;
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

export interface ConfigTickets {
  general: General;
  messages: Partial<Record<string, DeuxLangues>>;
  messagesDefaut: Record<string, DeuxLangues>;
  horaires: Horaires;
  commandes: Commandes;
  categories: Categorie[];
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
  erreur?: string | null;
  serveurs?: Array<{ id: string; nom: string }>;
  serveur?: { id: string; nom: string };
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

export function apiTickets(client: ClientEsport) {
  const r = <T>(chemin: string, methode?: string, corps?: unknown) => client.requete<T>(chemin, methode, corps);
  return {
    moi: () => r<MoiTickets>('/tickets/moi'),
    etat: () => r<{ actif: boolean; bot: boolean; connexion: Connexion }>('/tickets/etat'),
    config: () => r<ConfigTickets>('/tickets/config'),
    discord: () => r<ServeurDiscord>('/tickets/config/discord'),
    changerGeneral: (c: Partial<General>) => r<ConfigTickets>('/tickets/config/general', 'PUT', c),
    changerMessages: (c: Record<string, DeuxLangues>) => r<ConfigTickets>('/tickets/config/messages', 'PUT', c),
    changerHoraires: (c: Horaires) => r<ConfigTickets>('/tickets/config/horaires', 'PUT', c),
    changerCommandes: (c: Commandes) => r<ConfigTickets>('/tickets/config/commandes', 'PUT', c),
    creerCategorie: (c: Partial<Categorie>) => r<{ id: string; categories: Categorie[] }>('/tickets/config/categories', 'POST', c),
    modifierCategorie: (id: string, c: Partial<Categorie>) => r<{ categories: Categorie[] }>(`/tickets/config/categories/${encodeURIComponent(id)}`, 'PATCH', c),
    supprimerCategorie: (id: string) => r<{ categories: Categorie[] }>(`/tickets/config/categories/${encodeURIComponent(id)}`, 'DELETE'),
    ordonnerCategories: (ordre: string[]) => r<{ categories: Categorie[] }>('/tickets/config/categories/ordre', 'PUT', { ordre }),
    creerPanneau: (c: Partial<Panneau>) => r<Panneau>('/tickets/config/panneaux', 'POST', c),
    modifierPanneau: (id: string, c: Partial<Panneau>) => r<Panneau>(`/tickets/config/panneaux/${encodeURIComponent(id)}`, 'PATCH', c),
    supprimerPanneau: (id: string) => r<{ ok: true }>(`/tickets/config/panneaux/${encodeURIComponent(id)}`, 'DELETE'),
    apercuPanneau: (id: string) => r<{ charge: ChargeDiscord }>(`/tickets/config/panneaux/${encodeURIComponent(id)}/apercu`),
    publierPanneau: (id: string) => r<Panneau>(`/tickets/config/panneaux/${encodeURIComponent(id)}/publier`, 'POST'),
    ajouterListeNoire: (c: { discordId: string; nom?: string; raison?: string }) => r<{ ok: true }>('/tickets/config/liste-noire', 'POST', c),
    retirerListeNoire: (id: string) => r<{ ok: true }>(`/tickets/config/liste-noire/${encodeURIComponent(id)}`, 'DELETE'),
    url: requeteUrl,
  };
}
export type ApiTickets = ReturnType<typeof apiTickets>;
