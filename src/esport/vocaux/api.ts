/**
 * Client des salons vocaux temporaires d'Esport HQ (migration 0060, docs/esport/vocaux.md), par l'appel générique du
 * client Esport. Types miroirs de l'API (esport/noyau/vocaux/).
 */

import type { ClientEsport } from '../client';
import type { Connexion } from '../tickets/api';

export type ModeProprietaire = 'transferer' | 'garder';

export interface Hub {
  id: string;
  nom: string;
  categorieId: string | null;
  modeleNom: string;
  limite: number;
  verrouille: boolean;
  tournoiId: string | null;
  rolesAutorises: string[];
}

export interface ReglagesVocaux {
  actif: boolean;
  hubs: Hub[];
  rolesStaff: string[];
  delaiSuppressionS: number;
  maxParMembre: number;
  quandProprietairePart: ModeProprietaire;
  salonJournaux: string | null;
}

export type CommandesVocaux = Record<string, { actif: boolean; roles: string[] }>;

export interface SalonTemporaire {
  id: string;
  nom: string;
  hubId: string;
  proprietaireId: string | null;
  proprietaireNom: string;
  verrouille: boolean;
  limite: number;
  presents: number;
  amis: number;
  tournoiId: string | null;
  equipeId: string | null;
  videDepuis: string | null;
  creeLe: string;
}

export interface ConfigVocaux {
  reglages: ReglagesVocaux;
  commandes: CommandesVocaux;
  serveur: { id: string; nom: string } | null;
  connexion: Connexion;
  gatewayActivee: boolean;
  etat: { derniereErreur?: { motif: string; statut: number; code: number | null; le: string }; dernierSalon?: { le: string; ok: boolean }; derniereCreation?: DerniereCreation };
  salons: SalonTemporaire[];
  choix: { commandes: string[]; modesProprietaire: ModeProprietaire[]; limites: { hubs: number; roles: number; amis: number; places: number; delaiMinS: number; delaiMaxS: number; parMembreMax: number; modele: number }; modeleDefaut: string; modeleTournoiDefaut: string; permissionsBot: string[] };
  bot: boolean;
  lienInvitation: string | null;
  tournois?: Array<{ id: string; nom: string; team: string }>;
}

export interface SalonDiscord {
  id: string;
  nom: string;
  type: 'vocal' | 'categorie' | 'texte';
  parent: string | null;
  position: number;
}

export interface ServeurVocaux {
  bot: boolean;
  erreur?: string | null;
  serveur?: { id: string; nom: string };
  salons?: SalonDiscord[];
  roles?: Array<{ id: string; nom: string; couleur: string | null; position: number }>;
  positionBot?: number;
  permissions?: { membreTrouve: boolean; serveur: string[]; hubs: Array<{ id: string; nom?: string; introuvable?: boolean; manquantes: string[] }> };
}

export function apiVocaux(client: ClientEsport) {
  const r = <T>(chemin: string, methode?: string, corps?: unknown) => client.requete<T>(chemin, methode, corps);
  return {
    config: () => r<ConfigVocaux>('/vocaux/config'),
    changer: (c: Partial<ReglagesVocaux>) => r<ConfigVocaux>('/vocaux/config', 'PUT', c),
    changerCommandes: (c: CommandesVocaux) => r<ConfigVocaux>('/vocaux/config/commandes', 'PUT', c),
    discord: () => r<ServeurVocaux>('/vocaux/discord'),
  };
}

export type ApiVocaux = ReturnType<typeof apiVocaux>;

// ------------------------------------------------------------------ Équipes d'un tournoi et rôles Discord (migration 0063)

export type Poste = 'joueur' | 'coach' | 'remplacant';
export const POSTES: readonly Poste[] = ['joueur', 'coach', 'remplacant'];

export interface MembreEquipe {
  id?: string;
  poste: Poste;
  discordId: string | null;
  nom: string;
  embarkId: string;
  roleStatut?: 'attribue' | 'absent' | 'refus' | null;
}

export interface EquipeTournoi {
  id: string;
  nom: string;
  tag: string;
  roleId: string | null;
  ticketId: string | null;
  membres: MembreEquipe[];
}

export interface DiscordTournoi {
  tournoi: { id: string; nom: string; statut: string; fin: string | null };
  reglages: { modeleRole: string; couleur: string | null; suppressionH: number; categorieTicketId: string | null; rolesCreesLe: string | null; rolesSupprimesLe: string | null };
  equipes: EquipeTournoi[];
  categoriesTickets: Array<{ id: string; nom: { fr: string; en: string } }>;
  serveur: { id: string; nom: string } | null;
  hubs: Array<{ id: string; nom: string }>;
  droits: { gerer: boolean; discord: boolean; importer: boolean };
  bot: boolean;
  limites: { equipes: number; membres: number };
  modeleDefaut: string;
}

export interface PropositionEquipe {
  ticketId: string;
  numero: number;
  statut: string;
  auteur: string;
  nom: string;
  tag: string;
  membres: Array<MembreEquipe & { brut?: string; present: boolean | null; trouveParNom?: boolean }>;
  problemes: string[];
  deja: boolean;
}

export interface BilanRoles {
  creees: number;
  attribues: number;
  absents: Array<{ equipe: string; nom: string; discordId: string }>;
  sansId: Array<{ equipe: string; nom: string }>;
  refus: Array<{ equipe: string; quoi: string; nom?: string; statut: number; code: number | null }>;
  limite: boolean;
  hierarchie: { positionBot: number; ok: boolean } | null;
}

export type SaisieEquipe = { nom: string; tag: string; ticketId?: string | null; membres: MembreEquipe[] };

export function apiEquipes(client: ClientEsport) {
  const r = <T>(chemin: string, methode?: string, corps?: unknown) => client.requete<T>(chemin, methode, corps);
  const base = (teamId: string, tournoiId: string) => `/teams/${encodeURIComponent(teamId)}/tournois/${encodeURIComponent(tournoiId)}/discord`;
  return {
    lire: (t: string, id: string) => r<DiscordTournoi>(base(t, id)),
    reglages: (t: string, id: string, c: Partial<DiscordTournoi['reglages']>) => r<DiscordTournoi>(base(t, id), 'PUT', c),
    ajouter: (t: string, id: string, equipes: SaisieEquipe[]) => r<DiscordTournoi>(`${base(t, id)}/equipes`, 'POST', { equipes }),
    modifier: (t: string, id: string, equipeId: string, c: Partial<SaisieEquipe>) => r<DiscordTournoi>(`${base(t, id)}/equipes/${encodeURIComponent(equipeId)}`, 'PATCH', c),
    supprimer: (t: string, id: string, equipeId: string) => r<DiscordTournoi>(`${base(t, id)}/equipes/${encodeURIComponent(equipeId)}`, 'DELETE'),
    importer: (t: string, id: string, categorieId: string | null) => r<{ categorieId: string; propositions: PropositionEquipe[] }>(`${base(t, id)}/import`, 'POST', { categorieId }),
    creerRoles: (t: string, id: string) => r<DiscordTournoi & { bilan: BilanRoles }>(`${base(t, id)}/roles`, 'POST', {}),
    supprimerRoles: (t: string, id: string) => r<DiscordTournoi & { nettoyage: { roles: number; salons: number; echecs: unknown[] } }>(`${base(t, id)}/roles/supprimer`, 'POST', {}),
  };
}

/** Mesures de la dernière création d'un salon (moteur vocal) : durées en millisecondes. */
export type DerniereCreation = {
  le: string;
  totalMs: number;
  attenteMs: number;
  preparationMs: number;
  creationMs: number;
  deplacementMs: number;
  connexion: 'reutilisee' | 'neuve' | null;
  deplace: boolean;
  hubId: string;
};
