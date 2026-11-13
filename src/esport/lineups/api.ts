/**
 * Client du module Lineups (esport/noyau/lineups/, migration 0082), par l'appel générique du client Esport.
 * Types miroirs de l'API. Contenu TACTIQUE : aucun de ces champs ne passe par l'assistant d'écriture.
 */

import { requeteUrl, type ClientEsport } from '../client';
import type { LienSigne, Personne } from '../strats/api';
import type { ModeleStrat } from '../strats/modeles';

export type PostureLineup = 'debout' | 'saut' | 'course' | 'accroupi';
export const POSTURES: readonly PostureLineup[] = ['debout', 'saut', 'course', 'accroupi'];
export type RoleImage = 'position' | 'visee' | 'resultat' | 'autre';
export const ROLES_IMAGE: readonly RoleImage[] = ['position', 'visee', 'resultat', 'autre'];
export type RoleMedia = RoleImage | 'video';
export type StatutLineup = 'propose' | 'valide';

/** Élément du profil de jeu (map, personnage, capacité, callout) : clé stable et nom recopié. */
export interface Reference {
  cle: string | null;
  nom: string;
}
/** Point de la minimap, dans le repère carré de 1000 unités des strats. */
export interface PointCarte {
  x: number;
  y: number;
}
export interface MediaLineup {
  id: string;
  role: RoleMedia;
  genre: 'image' | 'video';
  type: string;
  taille: number;
  nom: string;
  /** Lien signé (2 h) ; null sans stockage branché. */
  lien: LienSigne | null;
}
/** Strat liée : sans titre (ni identifiant) quand le lecteur ne peut pas la voir (strat privée, module fermé). */
export interface StratLiee {
  id: string | null;
  titre: string | null;
  carte: string | null;
  etape: number | null;
  ouvrable: boolean;
}
export interface Lineup {
  id: string;
  jeu: string;
  modele: ModeleStrat;
  titre: string;
  carte: { cle: string; nom: string };
  personnage: Reference | null;
  capacite: Reference | null;
  /** « attaque », « defense », clé d'un mode du jeu, ou vide (partout). */
  side: string;
  zone: Reference | null;
  posture: PostureLineup;
  visee: string;
  timing: string;
  instructions: string;
  difficulte: 1 | 2 | 3;
  tags: string[];
  depart: PointCarte | null;
  arrivee: PointCarte | null;
  videoUrl: string | null;
  medias: MediaLineup[];
  statut: StatutLineup;
  validePar: Personne | null;
  valideLe: string | null;
  favori: boolean;
  strats: StratLiee[];
  creePar: { compte: string | null; pseudo: string | null };
  creeLe: string;
  majLe: string;
  moi: { modifier: boolean; supprimer: boolean; valider: boolean; lier: boolean };
  /** Présent dans la lecture « lineups d'une strat ». */
  etape?: number | null;
}
export interface DroitsLineups {
  proposer: boolean;
  gerer: boolean;
  lier: boolean;
}
export interface ListeLineups {
  lineups: Lineup[];
  total: number;
  droits: DroitsLineups;
  limites: { images: number; tailleImage: number; tailleVideo: number };
}
export interface LineupCorbeille {
  id: string;
  titre: string;
  carte: { cle: string; nom: string };
  statut: StatutLineup;
  supprimeLe: string;
  supprimePar: Personne | null;
  expireLe: string;
}
export interface FiltresLineups {
  carte?: string;
  personnage?: string;
  capacite?: string;
  side?: string;
  zone?: string;
  tag?: string;
  statut?: StatutLineup;
  favoris?: boolean;
  q?: string;
}
export interface SaisieLineup {
  titre: string;
  carte: { cle: string; nom: string };
  personnage: Reference | null;
  capacite: Reference | null;
  side: string;
  zone: Reference | null;
  posture: PostureLineup;
  visee: string;
  timing: string;
  instructions: string;
  difficulte: number;
  tags: string[];
  depart: PointCarte | null;
  arrivee: PointCarte | null;
  videoUrl: string | null;
  statut?: StatutLineup;
}

export function apiLineups(client: ClientEsport) {
  const base = (t: string) => `/teams/${encodeURIComponent(t)}/lineups`;
  const un = (t: string, id: string) => `${base(t)}/${encodeURIComponent(id)}`;
  return {
    client,
    liste: (t: string, f: FiltresLineups = {}) => client.requete<ListeLineups>(`${base(t)}${requeteUrl({ ...f })}`),
    detail: (t: string, id: string) => client.requete<Lineup>(un(t, id)),
    creer: (t: string, corps: SaisieLineup) => client.requete<Lineup>(base(t), 'POST', corps),
    modifier: (t: string, id: string, corps: Partial<SaisieLineup>) => client.requete<Lineup>(un(t, id), 'PATCH', corps),
    supprimer: (t: string, id: string) => client.requete<{ ok: true }>(un(t, id), 'DELETE'),
    corbeille: async (t: string) => (await client.requete<{ lineups: LineupCorbeille[] }>(`${base(t)}/corbeille`)).lineups,
    restaurer: (t: string, id: string) => client.requete<Lineup>(`${un(t, id)}/restaurer`, 'POST', {}),
    favori: (t: string, id: string, actif: boolean) => client.requete<{ ok: true; favori: boolean }>(`${un(t, id)}/favori`, actif ? 'PUT' : 'DELETE', actif ? {} : undefined),
    ajouterMedia: (t: string, id: string, envoi: string, role: RoleMedia) => client.requete<Lineup>(`${un(t, id)}/medias`, 'POST', { envoi, role }),
    modifierMedia: (t: string, id: string, media: string, corps: { role?: RoleImage; position?: number }) => client.requete<Lineup>(`${un(t, id)}/medias/${encodeURIComponent(media)}`, 'PATCH', corps),
    retirerMedia: (t: string, id: string, media: string) => client.requete<Lineup>(`${un(t, id)}/medias/${encodeURIComponent(media)}`, 'DELETE'),
    lierStrat: (t: string, id: string, strat: string, etape?: number | null) => client.requete<Lineup>(`${un(t, id)}/strats/${encodeURIComponent(strat)}`, 'PUT', { etape: etape ?? null }),
    delierStrat: (t: string, id: string, strat: string) => client.requete<Lineup>(`${un(t, id)}/strats/${encodeURIComponent(strat)}`, 'DELETE'),
    /** Lineups d'une strat (lecture : éditeur de strats, bloc « Lineups liés »). */
    deStrat: (t: string, strat: string) => client.requete<{ strat: { id: string; titre: string }; lineups: Lineup[]; droits: DroitsLineups }>(`/teams/${encodeURIComponent(t)}/strats/${encodeURIComponent(strat)}/lineups`),
  };
}
export type ApiLineups = ReturnType<typeof apiLineups>;
