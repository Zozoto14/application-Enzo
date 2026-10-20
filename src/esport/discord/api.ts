/**
 * Client des notifications Discord (phase 4), par l'appel générique du client
 * Esport (`client.requete`). Types miroirs de l'API (esport/noyau/discord/).
 *
 * L'adresse du webhook ne revient JAMAIS du serveur : seulement `masque`
 * (« …/abcd »). Elle ne part que dans `definirWebhook`.
 */

import type { ClientEsport } from '../client';

export interface WebhookDiscord {
  configure: boolean;
  /** « …/abcd » : les 4 derniers caractères du jeton. */
  masque?: string;
  creeLe?: string;
  majLe?: string;
  dernierSucces?: string | null;
  dernierEchec?: string | null;
  /** Discord ne reconnaît plus le webhook : à ressaisir. */
  invalide?: boolean;
  bloqueJusqua?: string | null;
}

export interface VariableDiscord {
  nom: string;
  description: string;
}

export interface ParametreDiscord {
  cle: string;
  libelle: string;
  description: string;
  modules: string[];
  /** false : un module requis est absent pour cette team (ex. Review vidéo). */
  disponible: boolean;
  actif: boolean;
  modele: string;
  modeleDefaut: string;
  personnalise: boolean;
  roleMention: string | null;
  variables: VariableDiscord[];
  apercu: string;
}

export interface EnvoiDiscord {
  id: string;
  cle: string;
  libelle: string;
  statut: 'attente' | 'envoye' | 'abandonne';
  essais: number;
  erreur: string | null;
  prochainEssai: string | null;
  creeLe: string;
  envoyeLe: string | null;
}

export interface EtatDiscord {
  webhook: WebhookDiscord;
  parametres: ParametreDiscord[];
  file: { enAttente: number; abandonnes: number };
  envois: EnvoiDiscord[];
}

export interface ChampsParametreDiscord {
  actif?: boolean;
  /** Vide ou null : modèle par défaut. */
  modele?: string | null;
  /** Identifiant numérique d'un rôle Discord ; vide ou null : aucune mention. */
  roleMention?: string | null;
}

export function apiDiscord(client: ClientEsport, teamId: string) {
  const base = `/teams/${encodeURIComponent(teamId)}/discord`;
  return {
    etat: () => client.requete<EtatDiscord>(base),
    definirWebhook: (url: string) => client.requete<WebhookDiscord>(`${base}/webhook`, 'PUT', { url }),
    supprimerWebhook: async () => {
      await client.requete(`${base}/webhook`, 'DELETE');
    },
    tester: async () => {
      await client.requete(`${base}/test`, 'POST', {});
    },
    majParametre: (cle: string, champs: ChampsParametreDiscord) => client.requete<ParametreDiscord>(`${base}/parametres/${encodeURIComponent(cle)}`, 'PUT', champs),
  };
}

// ------------------------------------------------------------------ Bot Discord (interactions)

export interface PingBot {
  type: string;
  libelle: string;
  ping: boolean;
}

export interface CompteLieBot {
  compte: string;
  pseudo: string;
  role: string;
  lie: boolean;
  discordNom: string | null;
  lieLe: string | null;
}

export interface EtatBot {
  /** Le serveur Esport a l'Application ID et la clé publique du bot. */
  disponible: boolean;
  /** Lien d'invitation du bot sur un serveur (scopes bot + applications.commands). */
  invitation: string | null;
  serveur: { serveur: string; salon: string; salonNom: string | null; lieLe: string; majLe: string; dernierSucces: string | null; dernierEchec: string | null; invalide: boolean } | null;
  pings: PingBot[];
  comptes: CompteLieBot[];
}

export interface CodeLiaison {
  code: string;
  expire: string;
  commande: string;
}

export interface MonDiscord {
  botDisponible: boolean;
  lie: boolean;
  discordNom: string | null;
  lieLe: string | null;
}

export function apiBot(client: ClientEsport, teamId: string) {
  const base = `/teams/${encodeURIComponent(teamId)}/discord/bot`;
  return {
    etat: () => client.requete<EtatBot>(base),
    code: () => client.requete<CodeLiaison>(`${base}/code`, 'POST', {}),
    delier: async () => {
      await client.requete(`${base}/serveur`, 'DELETE');
    },
    ping: (type: string, ping: boolean) => client.requete<{ pings: PingBot[] }>(`${base}/pings/${encodeURIComponent(type)}`, 'PUT', { ping }),
  };
}

/** Mon compte Discord (bouton « Lier mon Discord » du profil). */
export function apiMonDiscord(client: ClientEsport) {
  return {
    etat: () => client.requete<MonDiscord>('/moi/discord'),
    code: () => client.requete<CodeLiaison>('/moi/discord/code', 'POST', {}),
    delier: async () => {
      await client.requete('/moi/discord', 'DELETE');
    },
  };
}

/** Permission qui ouvre l'écran Discord. */
export const PERMISSION_DISCORD = 'discord.manage';

/** Libellés des types de notification (miroir de esport/noyau/discord/catalogue.mjs), pour le journal. */
export const LIBELLES_DISCORD: Record<string, string> = {
  event_created: 'Nouvel événement',
  reminder_d1: 'Rappel J-1',
  reminder_h1: 'Rappel H-1',
  event_now: 'C’est maintenant',
  rsvp_relance: 'Relance des convoqués',
  rsvp_missing: 'RSVP manquant',
  summary_published: 'Résumé publié',
  summary_submitted: 'Nouveau dépôt de réunion',
  task_assigned: 'Tâche assignée',
  task_due: 'Échéance de tâche',
  member_joined: 'Membre rejoint',
  role_changed: 'Changement de rôle',
  review_created: 'Review créée',
};
