/**
 * Événements organisés par le club (Administration › Événements, docs/esport/evenements.md ; serveur :
 * esport/noyau/evenements-club/). Permission du club `evenements.gerer` (le Fondateur l'a d'office).
 */

import type { ClientEsport } from '../client';
import type { Hub } from '../vocaux/api';

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
  /** Nom du rôle staff créé (tel que le bot l'a nommé). */
  staffRoleNom?: string | null;
  /** Rôles staff supplémentaires : mêmes droits que le rôle staff (docs/esport/evenements.md). */
  staffRolesSup?: StaffRoleSup[];
}

/** Rôle staff supplémentaire d'un événement. */
export interface StaffRoleSup {
  id: string;
  nom: string;
  /** Libellé court du salon du staff (`{role}`) ; vide : dérivé du nom. */
  label: string;
  couleur: string | null;
  /** Supprimé de Discord à la fin ou à la suppression de l'événement. */
  supprimerFin: boolean;
  /** Créé par l'événement (« Créer un rôle staff »). */
  cree: boolean;
  /** Rôle créé : Discord ID des personnes qui le reçoivent. */
  membres: string[];
}

/** Rôle que la fin de l'événement supprimera de Discord. */
export interface RoleASupprimer {
  id: string;
  nom: string;
  quoi: 'staff' | 'staff-cree' | 'staff-existant' | 'equipe';
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
  /** Capitaine de l'équipe (un seul) : reçoit le lien du map ban du site. */
  capitaine?: boolean;
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
  /** Ce que la suppression emporte : hubs vocaux de l'événement ; salons vocaux désactivés faute d'autre hub. */
  suppression?: { hubs: number; desactiveVocaux: boolean; /** Rôles supprimés de Discord avec l'événement. */ roles?: RoleASupprimer[] };
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
  /** Pourquoi le rôle ne peut pas être choisi comme rôle staff (everyone, gere, permissions, au-dessus-du-bot), ou null. */
  interdit?: string | null;
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
  > & { staffRolesSup?: Array<Pick<StaffRoleSup, 'id'> & Partial<Pick<StaffRoleSup, 'label' | 'supprimerFin' | 'membres'>>> };
};

/** Vocaux de l'événement (GET /evenements/:id/vocaux) : ses hubs, dans les réglages des salons vocaux. */
export interface VocauxEvenement {
  hubs: Hub[];
  /** Salons déjà pris par un autre hub (ordinaire ou d'un autre événement). */
  autresHubs: string[];
  /** Salons vocaux temporaires activés (Bot Esport HQ). */
  actif: boolean;
  /** Rôle staff de l'événement : entre d'office dans tous les salons d'équipe. */
  staffRole: { id: string; nom: string } | null;
  /** Créer, modifier, retirer : permission vocaux.configurer en plus d'evenements.gerer. */
  peutModifier: boolean;
  choix: { limites: { hubs: number; roles: number; places: number; modele: number }; modeleDefaut: string; /** Salon du staff dans le hub : modèle par défaut (« Staff — {pseudo} »). */ modeleStaffDefaut?: string };
}

/** Champs d'un hub d'événement saisis dans la fiche (l'événement et le verrouillage sont imposés par le serveur). */
export type SaisieHubEvenement = Partial<Pick<Hub, 'id' | 'nom' | 'categorieId' | 'modeleNom' | 'limite' | 'rolesAutorises' | 'placerSousHub' | 'visibleNonJoignable' | 'masquerHub' | 'modeleStaff' | 'etiquettes'>>;

/** Lien avec un tournoi du site LigneZero (docs/esport/evenements.md, « Site LigneZero »). */
export interface SiteEvenement {
  tournoiId: string | null;
  tournois: Array<{ id: string; nom: string; statut: string }>;
  erreur: string | null;
  etat: { ok: boolean; le: string; envoyees: number; recues: number; majSite: number; majApp: number; supprimees: number; erreurs: string[] } | null;
}

/** Salons de match Discord (docs/esport/evenements.md, « Salons de match ») : réglages de l'événement. */
export type LangueSalons = 'bot' | 'fr' | 'en' | 'fr_en' | 'en_fr';
export interface ReglagesSalonsMatch {
  actif: boolean;
  categorieId: string | null;
  modeleNom: string;
  /** Minutes entre la fin du match (ou son annulation) et la suppression du salon : 5 à 1440. */
  delaiSuppressionMin: number;
  /** Rappels 30 et 10 minutes avant le match. */
  rappels: boolean;
  langue: LangueSalons;
  /** Création anticipée en heures avant l'horaire (0 : dès que les équipes du match sont connues). */
  avanceH: number;
  /** Rétention des historiques en jours (0 : jusqu'à la suppression de l'événement). */
  retentionJours: number;
}
export type StatutSalonMatch = 'creation' | 'ouvert' | 'termine' | 'annule' | 'supprime';
export interface EquipeSalonMatch {
  nom: string;
  tag: string;
  /** Équipe reliée à une équipe de l'événement avec un rôle Discord. */
  role: boolean;
}
export interface SalonMatch {
  id: string;
  cle: string;
  genre: 'match' | 'lobby';
  titre: string;
  equipes: EquipeSalonMatch[];
  salonId: string | null;
  lien: string | null;
  statut: StatutSalonMatch;
  prevuLe: string | null;
  resultatLe: string | null;
  suppressionLe: string | null;
  supprimeLe: string | null;
  historique: boolean;
  nbMessages: number;
  erreur: string | null;
}
export interface MatchSiteSansSalon {
  cle: string;
  genre: 'match' | 'lobby';
  titre: string;
  statut: 'pending' | 'live' | 'finished';
  prevuLe: string | null;
  equipes: EquipeSalonMatch[];
}
export interface VueSalonsMatch {
  reglages: ReglagesSalonsMatch;
  choix: { limites: { delaiMin: number; delaiMax: number; modele: number; avanceMax: number; retentionMax: number }; langues: LangueSalons[]; defaut: ReglagesSalonsMatch };
  lie: boolean;
  bot: boolean;
  erreurDiscord: string | null;
  erreurSite: string | null;
  categories: Array<{ id: string; nom: string }>;
  salons: SalonMatch[];
  matchs: MatchSiteSansSalon[];
  etat: { le: string; crees: number; majs: number; resultats: number; annules: number; supprimes: number; attente: number; limite: boolean; erreur: string | null } | null;
}
export interface MessageHistorique {
  id: string;
  auteur: string;
  auteurId: string | null;
  bot: boolean;
  contenu: string;
  le: string | null;
  pieces: Array<{ nom: string; url: string; taille: number }>;
  embeds: string[];
}

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
    supprimer: (id: string) => r<{ ok: boolean; hubs: number; vocauxDesactives: boolean; nettoyage: { roles: number; salons: number; echecs: unknown[]; erreur: string | null } }>(un(id), 'DELETE'),
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
    site: (id: string) => r<SiteEvenement>(`${un(id)}/site`),
    lierSite: (id: string, tournoiId: string | null) => r<SiteEvenement>(`${un(id)}/site`, 'PUT', { tournoiId }),
    synchroniserSite: (id: string) => r<SiteEvenement>(`${un(id)}/site/synchro`, 'POST', {}),
    candidatsStaff: (q: string) => r<{ candidats: CandidatStaff[] }>(`/evenements/staff-candidats?q=${encodeURIComponent(q)}`),
    ajouterStaff: (id: string, c: { discordId: string; nom?: string }) => r<FicheEvenement>(`${un(id)}/staff`, 'POST', c),
    creerRoleStaff: (id: string, c: { nom: string; couleur?: string | null; label?: string; membres?: string[] }) => r<FicheEvenement>(`${un(id)}/staff-roles`, 'POST', c),
    retirerStaff: (id: string, staffId: string) => r<FicheEvenement>(`${un(id)}/staff/${encodeURIComponent(staffId)}`, 'DELETE'),
    vocaux: (id: string) => r<VocauxEvenement>(`${un(id)}/vocaux`),
    ajouterHub: (id: string, c: SaisieHubEvenement) => r<VocauxEvenement>(`${un(id)}/vocaux`, 'POST', c),
    modifierHub: (id: string, hubId: string, c: SaisieHubEvenement) => r<VocauxEvenement>(`${un(id)}/vocaux/${encodeURIComponent(hubId)}`, 'PATCH', c),
    retirerHub: (id: string, hubId: string) => r<VocauxEvenement>(`${un(id)}/vocaux/${encodeURIComponent(hubId)}`, 'DELETE'),
    salonsMatch: (id: string) => r<VueSalonsMatch>(`${un(id)}/salons-match`),
    reglerSalonsMatch: (id: string, c: Partial<ReglagesSalonsMatch>) => r<VueSalonsMatch>(`${un(id)}/salons-match`, 'PUT', c),
    synchroniserSalonsMatch: (id: string) => r<VueSalonsMatch>(`${un(id)}/salons-match/synchro`, 'POST', {}),
    creerSalonMatch: (id: string, cle: string) => r<VueSalonsMatch>(`${un(id)}/salons-match/creer`, 'POST', { cle }),
    supprimerSalonMatch: (id: string, salonId: string) => r<VueSalonsMatch>(`${un(id)}/salons-match/${encodeURIComponent(salonId)}/supprimer`, 'POST', {}),
    historiqueSalonMatch: (id: string, salonId: string) => r<{ salon: SalonMatch; messages: MessageHistorique[] }>(`${un(id)}/salons-match/${encodeURIComponent(salonId)}/historique`),
  };
}
