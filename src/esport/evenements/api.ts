/**
 * Événements organisés par le club (Administration › Événements, docs/esport/evenements.md ; serveur :
 * esport/noyau/evenements-club/). Permission du club `evenements.gerer` (le Fondateur l'a d'office).
 */

import type { ClientEsport } from '../client';

export type StatutEvenement = 'a_venir' | 'en_cours' | 'termine' | 'annule';
export type Poste = 'joueur' | 'coach' | 'remplacant';
export const POSTES: readonly Poste[] = ['joueur', 'coach', 'remplacant'];

export interface DiscordEvenement {
  rolesAuto: boolean;
  modeleRole: string;
  couleur: string | null;
  /** Les rôles créés sont placés juste en dessous de ce rôle (null : tout en bas). */
  roleAncreId: string | null;
  suppressionH: number;
  rolesCreesLe: string | null;
  rolesSupprimesLe: string | null;
  /** Rôle staff de l'événement : modèle du nom ({evenement}) et rôle créé. */
  staffModele: string;
  staffRoleId: string | null;
}

export interface Evenement {
  id: string;
  nom: string;
  jeu: string | null;
  debut: string | null;
  fin: string | null;
  statut: StatutEvenement;
  description: string;
  categorieTicketId: string | null;
  /** Catégories de tickets de l'événement (inscriptions, support) : le rôle staff traite leurs tickets. */
  categoriesTickets: string[];
  discord: DiscordEvenement;
  creeLe: string;
  majLe: string;
  /** Liste seulement : nombre d'équipes. */
  equipes?: number;
}

export interface MembreEquipe {
  id?: string;
  poste: Poste;
  discordId: string | null;
  nom: string;
  embarkId: string;
  roleStatut?: 'attribue' | 'absent' | 'refus' | null;
}

export interface EquipeEvenement {
  id: string;
  nom: string;
  tag: string;
  roleId: string | null;
  roleNom: string | null;
  ticketId: string | null;
  membres: MembreEquipe[];
}

export interface ChoixEvenements {
  statuts: StatutEvenement[];
  postes: Poste[];
  jeux: Array<{ cle: string; nom: string }>;
  limites: {
    equipes: number;
    membres: number;
    evenements: number;
    nom: number;
    description: number;
  };
  modeleDefaut: string;
  suppressionDefautH: number;
}

export interface BilanRoles {
  creees: number;
  renommees?: number;
  attribues: number;
  retires?: number;
  absents: Array<{ equipe: string; nom: string; discordId: string }>;
  sansId: Array<{ equipe: string; nom: string }>;
  refus: Array<{
    equipe: string;
    quoi: string;
    nom?: string;
    statut: number;
    code: number | null;
  }>;
  limite: boolean;
  hierarchie: { positionBot: number; ok: boolean } | null;
  position?: { ok: boolean; raison?: string; deplaces: number } | null;
}

export interface MembreStaff {
  id: string;
  discordId: string;
  nom: string;
  compteId: string | null;
  roleStatut: 'attribue' | 'absent' | 'refus' | null;
}

export interface CandidatStaff {
  discordId: string;
  nom: string;
  compteId: string | null;
  source: 'app' | 'discord';
}

export interface BilanStaff {
  cree: boolean;
  attribues: number;
  retires: number;
  absents: Array<{ nom: string; discordId: string }>;
  refus: Array<{ quoi: string; statut: number; code: number | null }>;
  categories: number;
  vocaux: number;
  roleId: string | null;
}

export interface FicheEvenement {
  evenement: Evenement;
  equipes: EquipeEvenement[];
  staff: MembreStaff[];
  categoriesTickets: Array<{ id: string; nom: { fr: string; en: string } }>;
  serveur: { id: string; nom: string } | null;
  hubs: Array<{ id: string; nom: string }>;
  droits: { importer: boolean; vocaux: boolean };
  bot: boolean;
  choix: ChoixEvenements;
  /** Après un changement d'équipes : rôles automatiques (`erreur` : bot-absent, sans-serveur). */
  discord?: {
    erreur: string | null;
    bilan?: BilanRoles | null;
    staff?: BilanStaff | null;
    suppression?: { role: boolean; salons: number };
  };
  nettoyage?: { roles: number; salons: number; echecs: unknown[] };
}

export interface PropositionEquipe {
  ticketId: string;
  numero: number;
  statut: string;
  auteur: string;
  nom: string;
  tag: string;
  membres: Array<
    MembreEquipe & {
      brut?: string;
      present: boolean | null;
      trouveParNom?: boolean;
    }
  >;
  problemes: string[];
  deja: boolean;
}

export interface RoleServeur {
  id: string;
  nom: string;
  position: number;
  couleur: string | null;
  gere: boolean;
  bot: boolean;
  /** Sous le rôle du bot : peut servir de repère. */
  utilisable: boolean;
}

export interface RolesServeur {
  erreur: string | null;
  roles: RoleServeur[];
  positionBot: number | null;
}

export type SaisieEquipe = {
  nom: string;
  tag: string;
  ticketId?: string | null;
  membres: MembreEquipe[];
};
export type SaisieEvenement = Partial<
  Pick<
    Evenement,
    | 'nom'
    | 'jeu'
    | 'debut'
    | 'fin'
    | 'statut'
    | 'description'
    | 'categorieTicketId'
    | 'categoriesTickets'
  >
> & {
  discord?: Partial<
    Pick<
      DiscordEvenement,
      'rolesAuto' | 'modeleRole' | 'couleur' | 'roleAncreId' | 'suppressionH' | 'staffModele'
    >
  >;
};

export function apiEvenements(client: ClientEsport) {
  const r = <T>(chemin: string, methode?: string, corps?: unknown) =>
    client.requete<T>(chemin, methode, corps);
  const un = (id: string) => `/evenements/${encodeURIComponent(id)}`;
  return {
    lister: () =>
      r<{ evenements: Evenement[]; choix: ChoixEvenements; bot: boolean }>(
        '/evenements',
      ),
    creer: (c: SaisieEvenement) => r<FicheEvenement>('/evenements', 'POST', c),
    lire: (id: string) => r<FicheEvenement>(un(id)),
    modifier: (id: string, c: SaisieEvenement) =>
      r<FicheEvenement>(un(id), 'PATCH', c),
    supprimer: (id: string) => r<{ ok: boolean }>(un(id), 'DELETE'),
    ajouter: (id: string, equipes: SaisieEquipe[]) =>
      r<FicheEvenement>(`${un(id)}/equipes`, 'POST', { equipes }),
    modifierEquipe: (id: string, equipeId: string, c: Partial<SaisieEquipe>) =>
      r<FicheEvenement>(
        `${un(id)}/equipes/${encodeURIComponent(equipeId)}`,
        'PATCH',
        c,
      ),
    supprimerEquipe: (id: string, equipeId: string) =>
      r<FicheEvenement>(
        `${un(id)}/equipes/${encodeURIComponent(equipeId)}`,
        'DELETE',
      ),
    importer: (id: string, categorieId: string | null) =>
      r<{ categorieId: string; propositions: PropositionEquipe[] }>(
        `${un(id)}/import`,
        'POST',
        { categorieId },
      ),
    resynchroniser: (id: string) =>
      r<FicheEvenement>(`${un(id)}/roles`, 'POST', {}),
    supprimerRoles: (id: string) =>
      r<FicheEvenement>(`${un(id)}/roles/supprimer`, 'POST', {}),
    rolesServeur: () => r<RolesServeur>('/evenements/roles-serveur'),
    candidatsStaff: (q: string) => r<{ candidats: CandidatStaff[] }>(`/evenements/staff-candidats?q=${encodeURIComponent(q)}`),
    ajouterStaff: (id: string, c: { discordId: string; nom?: string }) => r<FicheEvenement>(`${un(id)}/staff`, 'POST', c),
    retirerStaff: (id: string, staffId: string) => r<FicheEvenement>(`${un(id)}/staff/${encodeURIComponent(staffId)}`, 'DELETE'),
  };
}
