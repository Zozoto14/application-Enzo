/**
 * Client des rôles Discord temporaires des teams (migration 0066, docs/esport/bot-discord.md), par l'appel générique du
 * client Esport. Types miroirs de l'API (esport/noyau/roles-temp/).
 */

import type { ClientEsport } from '../client';

export interface ReglagesRolesTemp {
  actif: boolean;
  roleId: string | null;
  roleNom: string;
  dureeDefautH: number;
  maxSimultanes: number;
  rolesAutorises: string[];
  salonJournalId: string | null;
  mp: boolean;
}

export interface OctroiRoleTemp {
  id: string;
  roleNom: string;
  membreId: string;
  membreNom: string;
  accordeParNom: string;
  raison: string;
  accordeLe: string;
  expireLe: string;
  essais: number;
  erreur: string | null;
}

export interface LimitesRolesTemp {
  dureeMinH: number;
  dureeMaxH: number;
  dureeDefautH: number;
  maxMin: number;
  maxMax: number;
  maxDefaut: number;
  roles: number;
}

export interface EtatRolesTemp {
  peutRegler: boolean;
  peutGerer: boolean;
  /** Complets pour qui règle ; sinon seulement le rôle, la durée par défaut et le maximum. */
  reglages: Partial<ReglagesRolesTemp> & Pick<ReglagesRolesTemp, 'actif' | 'roleNom' | 'dureeDefautH' | 'maxSimultanes'>;
  rolesEquipe: Array<{ id: string; nom: string; cle: string | null; defaut: boolean }>;
  actifs: OctroiRoleTemp[];
  serveur: { id: string; nom: string } | null;
  bot: boolean;
  limites: LimitesRolesTemp;
  lienInvitation: string | null;
  /** Après un enregistrement : 'hierarchie' (rôle du bot sous le rôle choisi), 'gerer_roles' (permission manquante). */
  avertissement?: 'hierarchie' | 'gerer_roles' | null;
}

export interface ServeurRolesTemp {
  bot: boolean;
  erreur?: string | null;
  membreTrouve?: boolean;
  gererRoles?: boolean;
  positionBot?: number;
  roleBot?: string;
  roles?: Array<{ id: string; nom: string; couleur: string | null; position: number }>;
  salons?: Array<{ id: string; nom: string; position: number }>;
}

export interface MembreDiscord {
  id: string;
  nom: string;
  pseudo: string;
}

export interface CommandesRolesTemp {
  [commande: string]: { actif: boolean; roles: string[] };
}

export interface ConfigRolesTempClub {
  equipes: Array<{ id: string; nom: string; jeu: string; actif: boolean; roleNom: string; dureeDefautH: number; maxSimultanes: number; actifs: number }>;
  commandes: CommandesRolesTemp;
  serveur: { id: string; nom: string } | null;
  bot: boolean;
  choix: { commandes: string[]; limites: LimitesRolesTemp };
  lienInvitation: string | null;
}

export function apiRolesTemp(client: ClientEsport, teamId: string) {
  const r = <T>(chemin: string, methode?: string, corps?: unknown) => client.requete<T>(`/teams/${encodeURIComponent(teamId)}/roles-temporaires${chemin}`, methode, corps);
  return {
    etat: () => r<EtatRolesTemp>(''),
    discord: () => r<ServeurRolesTemp>('/discord'),
    changer: (c: Partial<ReglagesRolesTemp>) => r<EtatRolesTemp>('/reglages', 'PUT', c),
    membres: (q: string) => r<{ membres: MembreDiscord[] }>(`/membres?q=${encodeURIComponent(q)}`),
    donner: (c: { membreId: string; membreNom: string; dureeH?: number; raison?: string }) => r<{ ok: boolean; prolonge: boolean; octroi: OctroiRoleTemp }>('', 'POST', c),
    prolonger: (id: string, dureeH: number) => r<{ ok: boolean; octroi: OctroiRoleTemp }>(`/${encodeURIComponent(id)}/prolonger`, 'POST', { dureeH }),
    retirer: (id: string) => r<{ ok: boolean; deja: boolean }>(`/${encodeURIComponent(id)}`, 'DELETE'),
  };
}

export type ApiRolesTemp = ReturnType<typeof apiRolesTemp>;

export function apiRolesTempClub(client: ClientEsport) {
  const r = <T>(chemin: string, methode?: string, corps?: unknown) => client.requete<T>(`/roles-temp${chemin}`, methode, corps);
  return {
    config: () => r<ConfigRolesTempClub>('/config'),
    changerCommandes: (c: CommandesRolesTemp) => r<ConfigRolesTempClub>('/config/commandes', 'PUT', c),
    discord: () => r<ServeurRolesTemp>('/discord'),
  };
}
