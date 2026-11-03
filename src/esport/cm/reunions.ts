/**
 * Client des réunions de l'équipe CM (migration 0039, docs/esport/cm-reunions.md) : agenda, réponses, disponibilités,
 * statut du moment, « Trouver un créneau », rendez-vous, notes (confidentielles) et tâches, iCal.
 * Types miroirs de l'API (esport/noyau/cm/reunions/). Règles pures de calendrier (jours affichés, positions).
 */

import { requeteUrl, type ClientEsport } from '../client';

export type Reponse = 'attente' | 'accepte' | 'peut_etre' | 'refuse' | 'propose';
export type Statut = 'disponible' | 'occupe' | 'absent' | 'ne_pas_deranger';
export type LieuGenre = 'aucun' | 'discord' | 'lien' | 'lieu';
export type TypeException = 'absence' | 'conge' | 'disponible';
export type Noms = Record<string, string | null>;

export interface Participant {
  compte: string;
  reponse: Reponse;
  commentaire: string;
  proposition: { debut: string; fin: string } | null;
  reponduLe: string | null;
}
export interface TacheReunion {
  id: string;
  texte: string;
  assigneA: string | null;
  echeance: string | null;
  fait: boolean;
  carteId: string | null;
}
export interface NotesReunion {
  ordreDuJour: string;
  compteRendu: string;
  majPar: string | null;
  majLe: string | null;
  taches: TacheReunion[];
}
export interface Reunion {
  id: string;
  genre: 'reunion' | 'rdv';
  titre: string;
  /** Clé de l'occurrence (ISO du début d'origine). */
  cle: string;
  debut: string;
  fin: string;
  fuseau: string;
  local: { date: string; heure: string; heureFin: string };
  recurrence: { freq: 'hebdo'; intervalle: number; jours: number[]; jusqua: string | null; nombre: number | null } | null;
  lieuGenre: LieuGenre;
  lieu: string;
  lien: string | null;
  rappelMinutes: number | null;
  organisateur: string | null;
  statut: 'active' | 'annulee';
  motifAnnulation: string | null;
  version: number;
  participants: Participant[];
  maReponse: Reponse | null;
  droits: { modifier: boolean; notes: boolean; repondre: boolean };
  notes?: NotesReunion;
  creneau?: { id: string; offreId: string; offre: string } | null;
}
export interface MembreEquipe {
  compte: string;
  pseudo: string | null;
  fuseau: string | null;
  enReunion: boolean;
  statut: Statut;
  message: string;
  jusqua: string | null;
  auto: boolean;
}
export interface MoiReunions {
  droits: { voir: boolean; gerer: boolean };
  invite: boolean;
  aRepondre: number;
  compte: string;
  profil: { fuseau: string | null; statut: Statut | null; message: string; jusqua: string | null };
  equipe: MembreEquipe[];
}
export interface SaisieReunion {
  titre?: string;
  ordreDuJour?: string;
  date?: string;
  heureDebut?: string;
  heureFin?: string;
  fuseau?: string;
  recurrence?: { freq: 'hebdo'; jours?: number[]; nombre?: number | null; jusqua?: string | null } | null;
  lieuGenre?: LieuGenre;
  lieu?: string;
  lien?: string;
  rappelMinutes?: number | null;
  participants?: string[];
  version?: number;
}
export interface RegleDispo {
  jour: number;
  debut: string;
  fin: string;
  type: 'disponible' | 'indisponible';
  fuseau?: string;
}
export interface ExceptionDispo {
  id: string;
  debut: string;
  fin: string;
  type: TypeException;
  note: string;
  local?: { debut: { date: string; heure: string }; fin: { date: string; heure: string } };
}
export interface MesDispos {
  fuseau: string;
  regles: RegleDispo[];
  exceptions: ExceptionDispo[];
}
export interface Proposition {
  debut: string;
  fin: string;
  libres: string[];
  inconnus: string[];
  occupes: string[];
  absents: string[];
  n: number;
  total: number;
  tous: boolean;
  local: { date: string; heure: string; heureFin: string };
}
export interface ReponseCreneaux {
  propositions: Proposition[];
  participants: Array<{ compte: string; fuseau: string; sansCreneaux: boolean }>;
  noms: Noms;
  fuseau: string;
}
export interface CelluleGrille {
  debut: string;
  fin: string;
  n: number;
  comptes: string[];
  atteint: boolean;
}
export interface GrilleEquipe {
  jours: string[];
  creneaux: string[];
  cellules: Array<Array<CelluleGrille | null>>;
  fuseau: string;
  pas: number;
  total: number;
  noms: Noms;
  sansCreneaux: string[];
}
export interface CreneauRdv {
  id: string;
  debut: string;
  fin: string;
  reserve: boolean;
  reservePar: string | null;
  reunionId: string | null;
  local: { date: string; heure: string; heureFin: string };
}
export interface OffreRdv {
  id: string;
  proprietaire: string | null;
  proprietairePseudo: string | null;
  titre: string;
  description: string;
  dureeMinutes: number;
  fuseau: string;
  lieuGenre: LieuGenre;
  lieu: string;
  lien: string | null;
  ouverte: boolean;
  mienne: boolean;
  creneaux: CreneauRdv[];
}
export interface AbonnementIcalReunions {
  id: string;
  libelle: string;
  creeLe: string;
  dernierAcces: string | null;
  revoque: boolean;
}

const e = encodeURIComponent;

export function apiReunions(client: ClientEsport) {
  const r = <T>(chemin: string, methode = 'GET', corps?: unknown) => client.requete<T>(chemin, methode, corps);
  type Detail = { reunion: Reunion; noms: Noms };
  return {
    /** Client Esport (tableaux CM : une tâche de suivi devient une carte). */
    client,
    moi: () => r<MoiReunions>('/cm/reunions/moi'),
    agenda: (du: string, au: string) => r<{ reunions: Reunion[]; noms: Noms; droits: { voir: boolean; gerer: boolean } }>(`/cm/reunions${requeteUrl({ du, au })}`),
    detail: (id: string) => r<Detail>(`/cm/reunions/${e(id)}`),
    creer: (s: SaisieReunion) => r<Detail>('/cm/reunions', 'POST', s),
    modifier: (id: string, s: SaisieReunion) => r<Detail>(`/cm/reunions/${e(id)}`, 'PATCH', s),
    annuler: (id: string, motif: string, occurrence?: string) => r<Detail>(`/cm/reunions/${e(id)}/annuler`, 'POST', { motif, ...(occurrence ? { occurrence } : {}) }),
    repondre: (id: string, x: { reponse: Exclude<Reponse, 'attente'>; commentaire?: string; date?: string; heureDebut?: string; heureFin?: string; fuseau?: string }) => r<Detail>(`/cm/reunions/${e(id)}/reponse`, 'PUT', x),
    notes: (id: string, x: { ordreDuJour?: string; compteRendu?: string }) => r<Detail>(`/cm/reunions/${e(id)}/notes`, 'PUT', x),
    ajouterTache: (id: string, x: { texte: string; assigneA?: string | null; echeance?: string | null }) => r<Detail>(`/cm/reunions/${e(id)}/taches`, 'POST', x),
    modifierTache: (id: string, x: { texte?: string; fait?: boolean; assigneA?: string | null }) => r<Detail>(`/cm/reunions/taches/${e(id)}`, 'PATCH', x),
    supprimerTache: (id: string) => r<Detail>(`/cm/reunions/taches/${e(id)}`, 'DELETE'),
    tacheVersCarte: (id: string, tableauId: string) => r<Detail & { carte: { id: string | null; tableauId: string } }>(`/cm/reunions/taches/${e(id)}/carte`, 'POST', { tableauId }),
    creneaux: (x: { participants: string[]; duree: number; du: string; jours?: number; fuseau: string; heureMin?: string; heureMax?: string; sauf?: string; max?: number }) => r<ReponseCreneaux>('/cm/reunions/creneaux', 'POST', x),
    comptes: (q: string) => r<{ comptes: Array<{ compte: string; pseudo: string; equipe: boolean }> }>(`/cm/reunions/comptes${requeteUrl({ q })}`),
    statut: (x: { statut: Statut | null; message?: string; jusqua?: string | null; fuseau?: string }) => r<MoiReunions>('/cm/reunions/statut', 'PUT', x),
    grille: (semaine: string, fuseau: string) => r<GrilleEquipe>(`/cm/reunions/equipe/grille${requeteUrl({ semaine, fuseau })}`),
    mesDispos: (fuseau?: string) => r<MesDispos>(`/cm/reunions/dispos/moi${requeteUrl({ fuseau })}`),
    remplacerRegles: (regles: RegleDispo[], fuseau: string) => r<MesDispos>('/cm/reunions/dispos/moi/regles', 'PUT', { regles, fuseau }),
    ajouterException: (x: { type: TypeException; jourDebut: string; jourFin: string; fuseau: string; note?: string }) => r<MesDispos>('/cm/reunions/dispos/moi/exceptions', 'POST', x),
    supprimerException: (id: string) => r<MesDispos>(`/cm/reunions/dispos/moi/exceptions/${e(id)}`, 'DELETE'),
    rdv: () => r<{ offres: OffreRdv[]; noms: Noms }>('/cm/reunions/rdv'),
    creerOffre: (x: { titre: string; description?: string; dureeMinutes: number; fuseau: string; lieuGenre: LieuGenre; lieu?: string; lien?: string; plages: Array<{ date: string; heureDebut: string; heureFin: string }> }) => r<{ offres: OffreRdv[]; noms: Noms }>('/cm/reunions/rdv', 'POST', x),
    fermerOffre: (id: string, ouverte: boolean) => r<{ offres: OffreRdv[]; noms: Noms }>(`/cm/reunions/rdv/${e(id)}`, 'PATCH', { ouverte }),
    supprimerOffre: (id: string) => r<{ offres: OffreRdv[]; noms: Noms }>(`/cm/reunions/rdv/${e(id)}`, 'DELETE'),
    reserver: (creneauId: string, note?: string) => r<Detail>(`/cm/reunions/rdv/creneaux/${e(creneauId)}/reserver`, 'POST', { note }),
    exportIcs: () => r<{ nom: string; type: string; contenu: string }>('/cm/reunions/export.ics?format=json'),
    abonnements: () => r<{ abonnements: AbonnementIcalReunions[] }>('/cm/reunions/ical'),
    creerAbonnement: (libelle: string) => r<{ jeton: string; chemin: string; abonnement: AbonnementIcalReunions }>('/cm/reunions/ical', 'POST', { libelle }),
    revoquerAbonnement: (id: string) => r<{ abonnements: AbonnementIcalReunions[] }>(`/cm/reunions/ical/${e(id)}`, 'DELETE'),
  };
}
export type ApiReunions = ReturnType<typeof apiReunions>;

// ------------------------------------------------------------------ Règles pures du calendrier

export type VueAgenda = 'jour' | 'semaine' | 'mois';
const JOUR = 86_400_000;

/** « AAAA-MM-JJ » + n jours. */
export function plusJours(date: string, n: number): string {
  const [a, m, j] = date.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j + n)).toISOString().slice(0, 10);
}

/** Jour ISO (1 = lundi … 7 = dimanche) d'une date « AAAA-MM-JJ ». */
export function jourIso(date: string): number {
  const [a, m, j] = date.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j)).getUTCDay();
  return d === 0 ? 7 : d;
}

export const lundiDe = (date: string): string => plusJours(date, 1 - jourIso(date));

/** Jours affichés par la vue (jour : 1 ; semaine : lundi → dimanche ; mois : semaines entières). */
export function joursVue(vue: VueAgenda, reference: string): string[] {
  if (vue === 'jour') return [reference];
  if (vue === 'semaine') return Array.from({ length: 7 }, (_, i) => plusJours(lundiDe(reference), i));
  const premier = `${reference.slice(0, 7)}-01`;
  const [a, m] = premier.split('-').map(Number);
  const dernier = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  const debut = lundiDe(premier);
  const fin = plusJours(lundiDe(dernier), 6);
  const n = Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${debut}T00:00:00Z`)) / JOUR) + 1;
  return Array.from({ length: n }, (_, i) => plusJours(debut, i));
}

/** Avance (ou recule) la date de référence d'une vue. */
export function decaler(vue: VueAgenda, reference: string, sens: number): string {
  if (vue === 'jour') return plusJours(reference, sens);
  if (vue === 'semaine') return plusJours(reference, 7 * sens);
  const [a, m] = reference.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + sens, 15)).toISOString().slice(0, 10);
}

/** Parties murales d'un instant dans un fuseau (date, heure, minutes depuis minuit). */
export function murale(isoTexte: string, fuseau: string): { date: string; heure: string; minutes: number } {
  const d = new Date(isoTexte);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const v = (t: string) => p.find(x => x.type === t)?.value ?? '00';
  const heure = `${v('hour')}:${v('minute')}`;
  return { date: `${v('year')}-${v('month')}-${v('day')}`, heure, minutes: Number(v('hour')) * 60 + Number(v('minute')) };
}

/** Fuseau de l'appareil (repli : Europe/Paris). */
export function fuseauAppareil(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';
  } catch {
    return 'Europe/Paris';
  }
}

/** Position d'un bloc dans la grille horaire : `{ haut, hauteur }` en minutes depuis `debutGrille`, bornées. */
export function bloc(debutMin: number, finMin: number, debutGrille: number, finGrille: number): { haut: number; hauteur: number } | null {
  const a = Math.max(debutMin, debutGrille);
  const b = Math.min(finMin <= debutMin ? 1440 : finMin, finGrille);
  if (b <= a) return null;
  return { haut: a - debutGrille, hauteur: Math.max(b - a, 15) };
}

/** « HH:MM » + minutes (bornées à la journée). */
export function heurePlus(h: string, minutes: number): string {
  const [a, b] = h.split(':').map(Number);
  const t = Math.min(a * 60 + b + minutes, 1440);
  return `${String(Math.floor(t / 60) % 25).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export const heureValide = (h: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(h);
export const dateValide = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
