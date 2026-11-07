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
  etat: { derniereErreur?: { motif: string; statut: number; code: number | null; le: string }; dernierSalon?: { le: string; ok: boolean } };
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
