/**
 * Client du suivi des joueurs (module `player_notes`) : types miroirs de
 * l'API (esport/noyau/suivi/service.mjs).
 */

import type { ClientEsport } from '../client';

export type CategorieNote = 'performance' | 'mental' | 'communication' | 'comportement' | 'objectif' | 'autre';
export type TonNote = 'positif' | 'a_travailler' | 'neutre';
export type TypeLien = 'evenement' | 'review' | 'repere';
export const CATEGORIES_NOTE: readonly CategorieNote[] = ['performance', 'mental', 'communication', 'comportement', 'objectif', 'autre'];
export const TONS_NOTE: readonly TonNote[] = ['positif', 'a_travailler', 'neutre'];

export interface LienNote {
  type: TypeLien;
  id: string;
  occurrence?: string | null;
  titre?: string | null;
}

export interface NoteJoueur {
  id: string;
  joueur: string;
  auteur: { compte: string; pseudo: string | null } | null;
  categorie: CategorieNote;
  ton: TonNote;
  contenu: string;
  tags: string[];
  lien: LienNote | null;
  date: string;
  epinglee: boolean;
  partagee: boolean;
  auteurMasque: boolean;
  creeLe: string;
  majLe: string;
  peutModifier: boolean;
  peutSupprimer: boolean;
}

export interface JoueurSuivi {
  compte: string;
  pseudo: string | null;
  poste: string | null;
  role: { nom: string; couleur: string; cle: string | null } | null;
  groupe: 'joueurs' | 'staff';
  statut: string | null;
  notes: number;
  derniere: string | null;
  partagees: number;
}

export interface DroitsSuivi {
  ecrire: boolean;
  supprimer: boolean;
}

export interface ResumeFiche {
  presence: { taux: number | null; ponctualite: number | null; marques: number; nonMarques: number; present: number; retard: number; absent: number; excuse: number; serie: number; retardMoyen: number | null } | null;
  taches: { ouvertes: number; enRetard: number; faites: number } | null;
  objectifs: Array<{ id: string; titre: string; statut: string; dateCible: string | null }> | null;
  total: number;
  partagees: number;
  dernieres: NoteJoueur[];
}

export interface FicheJoueur {
  joueur: { compte: string; pseudo: string | null; poste: string | null; role: JoueurSuivi['role']; statut: string | null; ancien: boolean };
  resume: ResumeFiche;
  notes: NoteJoueur[];
  etiquettes: string[];
  droits: DroitsSuivi;
}

/** Note partagée avec le joueur (lecture seule). */
export interface NotePartagee {
  id: string;
  categorie: CategorieNote;
  ton: TonNote;
  contenu: string;
  tags: string[];
  date: string;
  auteur: string | null;
  partageeLe: string | null;
}

export interface SaisieNote {
  contenu?: string;
  categorie?: CategorieNote;
  ton?: TonNote;
  tags?: string[];
  date?: string;
  lien?: { type: TypeLien; id: string; occurrence?: string | null } | null;
  epinglee?: boolean;
  partagee?: boolean;
  auteurMasque?: boolean;
}

const q = (params: Record<string, string | undefined>): string => {
  const p = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return p ? `?${p}` : '';
};

export function apiSuivi(client: ClientEsport, teamId: string) {
  const t = `/teams/${encodeURIComponent(teamId)}/suivi`;
  const f = (compte: string) => `${t}/${encodeURIComponent(compte)}`;
  return {
    liste: () => client.requete<{ joueurs: JoueurSuivi[]; droits: DroitsSuivi }>(t),
    fiche: (compte: string, filtres: { q?: string; categorie?: string; ton?: string; tag?: string } = {}) => client.requete<FicheJoueur>(`${f(compte)}${q(filtres)}`),
    mesNotes: () => client.requete<{ notes: NotePartagee[] }>(`${t}/moi`),
    creer: (compte: string, s: SaisieNote) => client.requete<NoteJoueur>(`${f(compte)}/notes`, 'POST', s),
    modifier: (compte: string, id: string, s: SaisieNote) => client.requete<NoteJoueur>(`${f(compte)}/notes/${encodeURIComponent(id)}`, 'PATCH', s),
    supprimer: (compte: string, id: string) => client.requete<{ ok: true }>(`${f(compte)}/notes/${encodeURIComponent(id)}`, 'DELETE'),
  };
}

export type ApiSuivi = ReturnType<typeof apiSuivi>;
