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
  /** Salons créés rangés juste sous le hub (oui par défaut). */
  placerSousHub?: boolean;
  /** Salons verrouillés visibles mais pas joignables pour les personnes sans accès (sinon cachés ; non par défaut). */
  visibleNonJoignable?: boolean;
  /** Hub caché aux personnes sans accès (oui par défaut pour un hub d'événement). */
  masquerHub?: boolean;
  /** Hub ordinaire : rôles qui peuvent l'utiliser (exigés pour le cacher). */
  rolesHub?: string[];
  /** Hub d'événement : modèle du nom du salon du staff ({role}, {pseudo}). */
  modeleStaff?: string;
  /** Hub d'événement : libellés courts des rôles autorisés en plus ({role} du salon du staff). */
  etiquettes?: Record<string, string>;
}

export interface ReglagesVocaux {
  actif: boolean;
  hubs: Hub[];
  rolesStaff: string[];
  delaiSuppressionS: number;
  maxParMembre: number;
  quandProprietairePart: ModeProprietaire;
  salonJournaux: string | null;
  /** Libellés courts des rôles du staff ({role} du salon du staff d'un hub d'événement). */
  etiquettesStaff?: Record<string, string>;
  /** Rôles « passe-partout » (Goat) : entrent dans toutes les vocs par surcharges de salons, aucune permission de serveur. */
  rolesPassePartout?: string[];
  /** Aussi sur tous les salons vocaux existants du serveur (oui par défaut). */
  passePartoutTous?: boolean;
}

/** Bilan de la dernière synchronisation de l'accès passe-partout. */
export interface BilanPasse {
  cibles: number;
  couverts: number;
  ajoutes: number;
  restaures: number;
  echecs: Array<{ id: string; nom: string; statut: number; code: number | null }>;
  reste: number;
  limiteDebit: boolean;
  le: string;
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
  etat: { derniereErreur?: { motif: string; statut: number; code: number | null; le: string }; dernierSalon?: { le: string; ok: boolean }; derniereCreation?: DerniereCreation; passePartout?: BilanPasse };
  salons: SalonTemporaire[];
  choix: { passePartout?: { droits: string[]; nomDefaut: string }; commandes: string[]; modesProprietaire: ModeProprietaire[]; limites: { hubs: number; roles: number; amis: number; places: number; delaiMinS: number; delaiMaxS: number; parMembreMax: number; modele: number }; modeleDefaut: string; modeleTournoiDefaut: string; permissionsBot: string[] };
  bot: boolean;
  lienInvitation: string | null;
  /** Événements du club proposés pour un hub d'équipe (Administration › Événements) ; clé `tournoiId` du hub. */
  evenements?: Array<{ id: string; nom: string; statut: string; debut: string | null; equipes: number; /** Rôle staff de l'événement (entre d'office dans les salons d'équipe). */ staffRole?: { id: string; nom: string } | null }>;
  /** Le compte peut créer un événement (lien vers Administration › Événements). */
  peutGererEvenements?: boolean;
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
    /** Crée le rôle Goat (aucune permission) et l'ajoute aux rôles passe-partout. */
    creerGoat: (c: { nom?: string; couleur?: string }) => r<ConfigVocaux & { roleCree: { id: string; nom: string; positionne: boolean } }>('/vocaux/goat', 'POST', c),
    synchroniserPasse: () => r<ConfigVocaux>('/vocaux/passe-partout/synchroniser', 'POST', {}),
  };
}

export type ApiVocaux = ReturnType<typeof apiVocaux>;

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
