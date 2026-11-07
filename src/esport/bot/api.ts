/**
 * Client d'Administration › Bot Esport HQ (esport/noyau/discord/bot/administration.mjs). Types miroirs de l'API ; le
 * serveur ne renvoie jamais le jeton du bot (seulement s'il est présent).
 */

import type { ClientEsport } from '../client';
import type { Commandes, Connexion, DiagnosticTickets, ModeLangue } from '../tickets/api';

export interface TeamBot {
  id: string;
  nom: string;
  jeu: string;
  archivee: boolean;
  moduleActif: boolean;
  webhook: { invalide: boolean; dernierSucces: string | null } | null;
  serveurBot: { salonNom: string | null; invalide: boolean; dernierSucces: string | null } | null;
  langue: 'fr' | 'en';
  filFr: boolean;
  relancesMp: boolean;
  abandonnes: number;
}

export interface CommandeBot {
  nom: string;
  description: string;
  partout: boolean;
  admin: boolean;
  sousCommandes: Array<{ nom: string; description: string }>;
}

export interface EtatBotAdmin {
  fondateur: boolean;
  bot: { configure: boolean; applicationId: string | null; clePublique: boolean; jeton: boolean };
  invitation: string | null;
  permissions: { entier: string; fonctionnalites: Array<{ id: string; permissions: string[] }> };
  tickets: { actif: boolean; langue: ModeLangue; connexion: Connexion; diagnostic: DiagnosticTickets; commandes: Commandes };
  serveur: { id: string; nom: string } | null;
  teams: TeamBot[];
  commandes: CommandeBot[];
}

export interface VerifServeurBot {
  bot: boolean;
  serveur?: { id: string; nom: string } | null;
  erreur?: string | null;
  membreTrouve?: boolean;
  complet?: boolean;
  fonctionnalites?: Array<{ id: string; manquantes: string[] }>;
}

export interface EtatCommandesBot {
  bot: boolean;
  attendues: string[];
  enregistrees: string[] | null;
  aJour?: boolean;
  manquantes?: string[];
  enTrop?: string[];
  differentes?: string[];
  erreur?: string | null;
}

export function apiBotAdmin(client: ClientEsport) {
  return {
    etat: () => client.requete<EtatBotAdmin>('/bot-discord'),
    verifierServeur: () => client.requete<VerifServeurBot>('/bot-discord/serveur'),
    commandes: () => client.requete<EtatCommandesBot>('/bot-discord/commandes'),
    reenregistrer: () => client.requete<EtatCommandesBot & { ok: boolean; n: number }>('/bot-discord/commandes', 'POST', {}),
  };
}
