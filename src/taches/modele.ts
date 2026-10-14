/**
 * Tâches (V1) : modèle Espaces > Projets > Listes > Tâches, sous-tâches (un
 * niveau), checklists, statuts propres à chaque projet, priorité, échéance,
 * étiquettes, personne assignée (le Fondateur ou l'ami), commentaires,
 * historique, récurrence, rappels, « pour aujourd'hui ».
 *
 * Fusion par CHAMP : chaque entité porte `h`, l'horodatage de chacun de ses
 * champs (« ISO|auteur ») ; deux copies se réunissent champ par champ, le plus
 * récent l'emporte (`fusion.ts`). Une suppression est un champ comme un autre
 * (`supprime`, pierre tombale datée) : elle voyage et peut être annulée.
 * L'historique garde l'ancienne valeur du titre et de la description : une
 * modification écrasée par une autre plus récente reste lisible.
 *
 * Tout est pur : horloge, auteur et tirage aléatoire sont passés en paramètre.
 */

import { jourValide, heureValide, sansAccents } from './dates';

// ------------------------------------------------------------------ Types

/**
 * Qui agit : « fondateur », « ami » (l'ami unique des V1/V2, gardé tel quel)
 * ou, depuis la V3, l'identifiant du compte d'un membre (10 caractères
 * a-z0-9). Le code d'horodatage est « f », « a » ou cet identifiant.
 */
export type Auteur = 'fondateur' | 'ami' | (string & {});
/** Droit d'un membre sur un projet (V3). « admin » : écriture et gestion du projet (listes, statuts, paramètres). */
export type DroitMembre = 'lecture' | 'ecriture' | 'admin';
export const DROITS_MEMBRE: readonly DroitMembre[] = ['lecture', 'ecriture', 'admin'];
export const LIBELLES_DROIT: Record<DroitMembre | 'aucun', string> = { aucun: 'Aucun accès', lecture: 'Lecture', ecriture: 'Écriture', admin: 'Admin du projet' };
/** Identifiant d'un compte membre (jamais « fondateur » ni « ami », réservés). */
export const idMembreValide = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9]{6,16}$/.test(v) && v !== 'fondateur';
export type Priorite = 'urgente' | 'haute' | 'normale' | 'basse';
export type ModePartage = 'aucun' | 'lecture' | 'ecriture';

export const PRIORITES: readonly Priorite[] = ['urgente', 'haute', 'normale', 'basse'];
export const LIBELLES_PRIORITE: Record<Priorite, string> = { urgente: 'Urgente', haute: 'Haute', normale: 'Normale', basse: 'Basse' };
export const RANG_PRIORITE: Record<Priorite, number> = { urgente: 0, haute: 1, normale: 2, basse: 3 };
export const LIBELLES_PARTAGE: Record<ModePartage, string> = { aucun: 'Non partagé', lecture: 'Lecture seule', ecriture: 'Lecture et écriture' };

/** Horodatages par champ : « 2026-10-13T09:00:00.000Z|f » (f : Fondateur, a : ami, sinon l'identifiant du membre). */
export type Horodatages = Record<string, string>;

export interface Entite {
  id: string;
  h: Horodatages;
  /** Pierre tombale : l'entité est supprimée (datée par `h.supprime`). */
  supprime?: boolean;
  /**
   * Lot de suppression : identifiant de l'élément supprimé par l'utilisateur
   * (l'espace, le projet, la liste ou la tâche). Tout ce qui a été supprimé
   * avec lui porte le même lot : la corbeille le restaure d'un bloc, sans
   * ressusciter ce qui avait été supprimé avant, à part.
   */
  lot?: string;
  /** Supprimé définitivement (sorti de la corbeille) : la pierre tombale reste pour la synchronisation. */
  efface?: boolean;
}

export interface Espace extends Entite {
  nom: string;
  couleur: string;
  ordre: number;
}

export interface Statut {
  id: string;
  nom: string;
  couleur: string;
  /** Statut « terminé » : la tâche est faite (récurrence, Ma journée, filtres). */
  ferme: boolean;
}

/** Apps du hub reliées à Tâches (V2, `integrations/`). */
export type AppLiee = 'prospects' | 'abonnements' | 'portefeuille' | 'office';
export const APPS_LIEES: readonly AppLiee[] = ['prospects', 'abonnements', 'portefeuille', 'office'];

export interface Projet extends Entite {
  espaceId: string;
  nom: string;
  couleur: string;
  statuts: Statut[];
  ordre: number;
  /** Partage avec l'ami choisi (V1 : un seul ami). */
  partage: ModePartage;
  /** Projet tenu par une app reliée (« Prospects »…) : jamais partagé. */
  auto?: AppLiee;
  /** Paramètres du projet (V2) : description, icône (un emoji), étiquettes proposées, dates. */
  description?: string;
  icone?: string;
  etiquettes?: string[];
  debut?: string;
  fin?: string;
  /** Historique des modifications du projet (union à la fusion, 100 derniers). */
  historique?: EvenementHistorique[];
  /** Droits des membres (V3), par identifiant de compte. L'ami des V1/V2 garde aussi `partage`. */
  acces?: Record<string, DroitMembre>;
}

export interface Liste extends Entite {
  projetId: string;
  nom: string;
  ordre: number;
}

export interface Echeance {
  jour: string;
  heure?: string;
}

export type Recurrence =
  | { type: 'quotidienne'; intervalle: number }
  /** Jours ISO : 1 = lundi … 7 = dimanche. */
  | { type: 'hebdo'; jours: number[] }
  | { type: 'mensuelle'; jour: number }
  | { type: 'annuelle'; mois: number; jour: number };

export interface ElementChecklist {
  id: string;
  texte: string;
  fait: boolean;
  ordre: number;
  /** Horodatage de la dernière modification de l'élément (fusion élément par élément). */
  h: string;
  supprime?: boolean;
}

export interface Commentaire {
  id: string;
  auteur: Auteur;
  texte: string;
  date: string;
  h: string;
  supprime?: boolean;
  /** Personnes mentionnées (« @Léa ») : leurs codes (V3). */
  mentions?: string[];
}

/** Temps passé sur une tâche (minuteur arrêté ou saisie manuelle). */
export interface EntreeTemps {
  id: string;
  auteur: Auteur;
  /** Jour où le temps a été passé (AAAA-MM-JJ). */
  jour: string;
  minutes: number;
  /** Début du minuteur (ISO), absent pour une saisie manuelle. */
  debut?: string;
  note?: string;
  h: string;
  supprime?: boolean;
}

/** Session (ou sous-agent) de Claude Code liée à une tâche (Claude Office). */
export interface LienOffice {
  session: string;
  /** Clé de l'agent (appareil + session), pour retrouver ses sous-agents. */
  cle?: string;
  sousAgent?: string;
  /** Projet (dossier) de la session, et ce que fait le sous-agent. */
  projet?: string;
  libelle?: string;
  /** Lien posé à cet instant (ISO) : seule une fin postérieure fait passer la tâche « En revue ». */
  depuis: string;
  /** Dernière fin déjà prise en compte (ms). */
  finVue?: number;
}

/** Entrée du « Journal du jour » d'un projet : ce qui a été fait, en une phrase. */
export interface EntreeJournal {
  id: string;
  projetId: string;
  /** Jour (AAAA-MM-JJ). */
  jour: string;
  auteur: Auteur;
  texte: string;
  tacheId?: string;
  minutes?: number;
  creeLe: string;
  h: string;
  supprime?: boolean;
}

export interface LienGithub {
  depot: string;
  branche?: string;
  pr?: number;
  /** Passer la tâche au statut « terminé » quand la PR est fusionnée. */
  faiteSiFusion?: boolean;
}

/** Objectif (V3) : une cible datée, suivie par ses tâches et projets liés, ou saisie à la main. */
export interface Objectif extends Entite {
  titre: string;
  description?: string;
  /** Échéance (AAAA-MM-JJ). */
  echeance?: string;
  /** Mode de calcul de la progression. */
  mode: 'taches' | 'manuel';
  /** Tâches et projets liés (mode « taches »). */
  taches: string[];
  projets: string[];
  /** Progression saisie (0-100, mode « manuel »). */
  manuel?: number;
  /** Cible chiffrée facultative (« 10 articles ») : valeur atteinte saisie à la main. */
  cible?: number;
  unite?: string;
  atteint?: number;
  couleur: string;
  ordre: number;
}

export interface EvenementHistorique {
  id: string;
  date: string;
  auteur: Auteur;
  texte: string;
  /** Ancienne valeur d'un texte (titre, description) : rien n'est perdu. */
  avant?: string;
}

export interface Tache extends Entite {
  projetId: string;
  listeId: string;
  /** Tâche parente (sous-tâche, un seul niveau). */
  parentId?: string;
  titre: string;
  description: string;
  statut: string;
  priorite: Priorite;
  echeance?: Echeance;
  etiquettes: string[];
  assigne?: Auteur;
  recurrence?: Recurrence;
  /** Rappels : minutes avant l'échéance (0 = à l'échéance). */
  rappels: number[];
  /** Choisie pour ce jour-là (« Ma journée »). */
  pourAujourdhui?: string;
  /** Personnes assignées (V3, plusieurs) ; `assigne` garde la première pour les appareils plus anciens. */
  assignes?: Auteur[];
  /** Début (AAAA-MM-JJ) pour la chronologie (Gantt). */
  debut?: string;
  /** Tâches qui doivent être finies avant celle-ci (« fin → début »). */
  dependances?: string[];
  /** Jalon : un point dans la chronologie (son échéance). */
  jalon?: boolean;
  /** Lien GitHub (V3, facultatif) : dépôt « propriétaire/nom », branche, numéro de PR. */
  github?: LienGithub;
  ordre: number;
  creeLe: string;
  creePar: Auteur;
  termineLe?: string;
  /** Tâche suivante déjà créée par la récurrence (évite un doublon). */
  suivante?: string;
  /** Créée par une app reliée : app et identifiant stable de l'élément source (pas de doublon). */
  source?: { app: AppLiee; cle: string };
  /** Sessions de Claude Code liées (Fondateur seulement ; jamais envoyées à l'ami). */
  liensOffice?: LienOffice[];
  /** Estimation (minutes). */
  estimation?: number;
  /** Minuteur en cours : début (ISO) pour le Fondateur (F) et pour l'ami (A). */
  chronoF?: string;
  chronoA?: string;
  temps: Record<string, EntreeTemps>;
  checklist: Record<string, ElementChecklist>;
  commentaires: Record<string, Commentaire>;
  historique: EvenementHistorique[];
}

export type TypeVue = 'liste' | 'kanban' | 'calendrier' | 'journee' | 'gantt' | 'tableau';
export type Tri = 'manuel' | 'echeance' | 'priorite' | 'titre' | 'creation' | 'statut';
export type Groupe = 'statut' | 'priorite' | 'echeance' | 'aucun';
export type FiltreEcheance = 'toutes' | 'retard' | 'aujourdhui' | 'semaine' | 'sans';

export interface Filtres {
  recherche: string;
  statuts: string[];
  priorites: Priorite[];
  etiquettes: string[];
  /** « tous », « personne », ou le code d'une personne (« fondateur », « ami », identifiant d'un membre). */
  assigne: 'tous' | Auteur | 'personne';
  echeance: FiltreEcheance;
  terminees: boolean;
}

export const FILTRES_DEFAUT: Filtres = { recherche: '', statuts: [], priorites: [], etiquettes: [], assigne: 'tous', echeance: 'toutes', terminees: true };

export interface VueEnregistree extends Entite {
  nom: string;
  vue: TypeVue;
  /** Projet visé (absent : tous les projets). */
  projetId?: string;
  filtres: Filtres;
  tri: Tri;
  groupe: Groupe;
}

export interface Reglages extends Entite {
  /** Ami choisi (un seul en V1) : identifiant de son compte et prénom affiché. */
  ami?: string;
  amiNom?: string;
  /** Clé de partage (32 octets, hexadécimal) : remise à l'ami dans le dépôt scellé pour lui. */
  cle?: string;
  /** Espace des données d'exemple (retirées d'un geste). */
  demo?: string;
  /** Liens avec les autres apps (Fondateur) : activés un par un. */
  liens?: Partial<Record<AppLiee, boolean>>;
  /** Réglages des notifications du Fondateur (F) et de l'ami (A) : chacun les siens, synchronisés entre ses appareils. */
  notifF?: unknown;
  notifA?: unknown;
  /**
   * Membres (V3) invités par le Fondateur, par identifiant de compte : prénom,
   * clé de membre (scelle ce qu'il renvoie), date d'invitation, rang du hub.
   * L'ami des V1/V2 (`ami`, `amiNom`, `cle`) reste à part et compte comme membre.
   */
  membres?: Record<string, MembreTaches>;
  /** Clé de partage de chaque projet partagé (V3), et la précédente après une rotation. */
  clesProjets?: Record<string, { cle: string; avant?: string; le?: string }>;
  /** Réglages de notification des membres (V3), avec leur horodatage. */
  notifsMembres?: Record<string, { valeur: unknown; h: string }>;
}

export interface MembreTaches {
  nom: string;
  cle: string;
  depuis: string;
  rang?: 'ami' | 'gestionnaire' | 'administrateur';
  /** Peut créer ses propres projets (dans sa base, à lui seul). */
  perso?: boolean;
}

export interface DonneesTaches {
  v: 1;
  espaces: Record<string, Espace>;
  projets: Record<string, Projet>;
  listes: Record<string, Liste>;
  taches: Record<string, Tache>;
  vues: Record<string, VueEnregistree>;
  reglages: Reglages;
  /** Journal du jour des projets (V2), fusionné entrée par entrée. */
  journal: Record<string, EntreeJournal>;
  /** Objectifs (V3). */
  objectifs: Record<string, Objectif>;
}

/** Qui agit, quand : horodatages et historique. */
export interface Contexte {
  maintenant: number;
  auteur: Auteur;
  alea?: () => number;
}

export class ErreurTaches extends Error {}

// ------------------------------------------------------------------ Constantes

export const COULEURS = ['#5B8CFF', '#3FD49B', '#B78CFF', '#F0A04B', '#FF6B8A', '#2EC4D6', '#E8C547', '#8A94A7'] as const;

export const STATUTS_DEFAUT: readonly Statut[] = [
  { id: 'a-faire', nom: 'À faire', couleur: '#8A94A7', ferme: false },
  { id: 'en-cours', nom: 'En cours', couleur: '#5B8CFF', ferme: false },
  { id: 'en-revue', nom: 'En revue', couleur: '#F0A04B', ferme: false },
  { id: 'fait', nom: 'Fait', couleur: '#3FD49B', ferme: true },
];

export const BORNES = {
  titre: 300,
  description: 10_000,
  nom: 80,
  etiquette: 32,
  etiquettes: 12,
  commentaire: 4000,
  checklist: 100,
  statuts: 12,
  rappels: 5,
  historique: 100,
  avant: 400,
} as const;

export const CODE_AUTEUR: Record<'fondateur' | 'ami', string> = { fondateur: 'f', ami: 'a' };
/** Code d'horodatage d'un auteur : « f », « a » ou l'identifiant du membre. */
export const codeAuteur = (a: Auteur): string => (a === 'fondateur' ? 'f' : a === 'ami' ? 'a' : a);
/** Suffixe des horodatages de cet auteur (« |f »…). */
export const suffixeAuteur = (a: Auteur): string => `|${codeAuteur(a)}`;
export const RAPPELS_PROPOSES: readonly number[] = [0, 10, 30, 60, 120, 1440, 2880];

// ------------------------------------------------------------------ Outils

let compteurIds = 0;

/** Identifiant neuf : instant, tirage, et un compteur (plusieurs créations dans le même geste). */
export function nouvelId(prefixe: string, maintenant: number, alea: () => number = Math.random): string {
  compteurIds = (compteurIds + 1) % 1296;
  return `${prefixe}${maintenant.toString(36)}${Math.floor(alea() * 36 ** 6).toString(36).padStart(6, '0')}${compteurIds.toString(36).padStart(2, '0')}`;
}

const MOTIF_ID = /^[a-z0-9-]{2,48}$/;
export const idValide = (id: unknown): id is string => typeof id === 'string' && MOTIF_ID.test(id);
const MOTIF_H = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|(?:f|a|[a-z0-9]{6,16})$/;
export const hValide = (h: unknown): h is string => typeof h === 'string' && MOTIF_H.test(h);
const MOTIF_COULEUR = /^#[0-9A-Fa-f]{6}$/;

/**
 * Horodatage d'un champ : l'instant présent, toujours postérieur au
 * précédent (une horloge en retard ne fait pas perdre une modification).
 */
export function horodatage(ms: number, auteur: Auteur, precedent?: string): string {
  let instant = ms;
  if (precedent) {
    const avant = Date.parse(precedent.split('|')[0]);
    if (Number.isFinite(avant) && avant >= instant) instant = avant + 1;
  }
  return `${new Date(instant).toISOString()}|${codeAuteur(auteur)}`;
}

export function auteurDeH(h: string | undefined): Auteur | undefined {
  const code = h?.split('|')[1];
  if (!code) return undefined;
  return code === 'f' ? 'fondateur' : code === 'a' ? 'ami' : idMembreValide(code) ? code : undefined;
}

const texte = (v: unknown, max: number, defaut = ''): string => (typeof v === 'string' ? v.slice(0, max) : defaut);
const nombre = (v: unknown, defaut = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : defaut);
const dict = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const couleur = (v: unknown, defaut: string) => (typeof v === 'string' && MOTIF_COULEUR.test(v) ? v : defaut);

function lireH(v: unknown): Horodatages {
  const r: Horodatages = {};
  for (const [cle, h] of Object.entries(dict(v))) if ((/^[a-zA-Z]{1,24}$/.test(cle) || MOTIF_CHAMP_CHRONO.test(cle)) && hValide(h)) r[cle] = h;
  return r;
}

export function normaliserEtiquette(e: string): string {
  return e.trim().replace(/^#/, '').replace(/\s+/g, '-').slice(0, BORNES.etiquette);
}

// ------------------------------------------------------------------ Lecture (données non sûres)

export function lireRecurrence(v: unknown): Recurrence | undefined {
  const o = dict(v);
  switch (o.type) {
    case 'quotidienne':
      return { type: 'quotidienne', intervalle: Math.min(365, Math.max(1, Math.round(nombre(o.intervalle, 1)))) };
    case 'hebdo': {
      const jours = [...new Set((Array.isArray(o.jours) ? o.jours : []).filter((j): j is number => Number.isInteger(j) && j >= 1 && j <= 7))].sort();
      return jours.length ? { type: 'hebdo', jours } : undefined;
    }
    case 'mensuelle':
      return { type: 'mensuelle', jour: Math.min(31, Math.max(1, Math.round(nombre(o.jour, 1)))) };
    case 'annuelle':
      return { type: 'annuelle', mois: Math.min(12, Math.max(1, Math.round(nombre(o.mois, 1)))), jour: Math.min(31, Math.max(1, Math.round(nombre(o.jour, 1)))) };
    default:
      return undefined;
  }
}

function lireEcheance(v: unknown): Echeance | undefined {
  const o = dict(v);
  if (!jourValide(o.jour)) return undefined;
  return { jour: o.jour, ...(heureValide(o.heure) ? { heure: o.heure } : {}) };
}

export const lireAuteur = (v: unknown): Auteur | undefined => (v === 'fondateur' || v === 'ami' || idMembreValide(v) ? (v as Auteur) : undefined);
/** Minuteur d'un membre V3 : champ `chrono_<identifiant>`. */
export const MOTIF_CHAMP_CHRONO = /^chrono_[a-z0-9]{6,16}$/;
const lireAuteurs = (v: unknown): Auteur[] => [...new Set((Array.isArray(v) ? v : []).map(lireAuteur).filter((a): a is Auteur => Boolean(a)))].slice(0, 20);
const MOTIF_DEPOT_GITHUB = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
export function lireLienGithub(v: unknown): LienGithub | undefined {
  const o = dict(v);
  if (typeof o.depot !== 'string' || !MOTIF_DEPOT_GITHUB.test(o.depot)) return undefined;
  return {
    depot: o.depot,
    ...(typeof o.branche === 'string' && /^[A-Za-z0-9._/-]{1,200}$/.test(o.branche) ? { branche: o.branche } : {}),
    ...(Number.isInteger(o.pr) && (o.pr as number) > 0 && (o.pr as number) < 1e7 ? { pr: o.pr as number } : {}),
    ...(o.faiteSiFusion === true ? { faiteSiFusion: true } : {}),
  };
}
const DROITS_VALIDES = new Set<string>(['lecture', 'ecriture', 'admin']);
function lireAcces(v: unknown): Record<string, DroitMembre> | undefined {
  const r: Record<string, DroitMembre> = {};
  for (const [id, droit] of Object.entries(dict(v)).slice(0, 100)) if ((idMembreValide(id) || id === 'ami') && typeof droit === 'string' && DROITS_VALIDES.has(droit)) r[id] = droit as DroitMembre;
  return Object.keys(r).length ? r : undefined;
}

function lireStatuts(v: unknown): Statut[] {
  const vus = new Set<string>();
  const r: Statut[] = [];
  for (const s of Array.isArray(v) ? v : []) {
    const o = dict(s);
    if (!idValide(o.id) || vus.has(o.id)) continue;
    vus.add(o.id);
    r.push({ id: o.id, nom: texte(o.nom, BORNES.nom, 'Statut') || 'Statut', couleur: couleur(o.couleur, '#8A94A7'), ferme: o.ferme === true });
    if (r.length >= BORNES.statuts) break;
  }
  return r.length ? r : STATUTS_DEFAUT.map(s => ({ ...s }));
}

function base(o: Record<string, unknown>): Entite | undefined {
  if (!idValide(o.id)) return undefined;
  return { id: o.id, h: lireH(o.h), ...(o.supprime === true ? { supprime: true } : {}), ...(idValide(o.lot) ? { lot: o.lot } : {}), ...(o.efface === true ? { efface: true } : {}) };
}

export function lireEspace(v: unknown): Espace | undefined {
  const o = dict(v);
  const b = base(o);
  return b && { ...b, nom: texte(o.nom, BORNES.nom, 'Espace') || 'Espace', couleur: couleur(o.couleur, COULEURS[0]), ordre: nombre(o.ordre) };
}

export function lireProjet(v: unknown): Projet | undefined {
  const o = dict(v);
  const b = base(o);
  if (!b || !idValide(o.espaceId)) return undefined;
  const partage: ModePartage = o.partage === 'lecture' || o.partage === 'ecriture' ? o.partage : 'aucun';
  const auto = APPS_LIEES.includes(o.auto as AppLiee) ? (o.auto as AppLiee) : undefined;
  const etiquettes = (Array.isArray(o.etiquettes) ? o.etiquettes : []).filter((e): e is string => typeof e === 'string').map(normaliserEtiquette).filter(Boolean).slice(0, 30);
  const historique = Array.isArray(o.historique) ? lireHistorique(o.historique) : [];
  return {
    ...b,
    espaceId: o.espaceId,
    nom: texte(o.nom, BORNES.nom, 'Projet') || 'Projet',
    couleur: couleur(o.couleur, COULEURS[0]),
    statuts: lireStatuts(o.statuts),
    ordre: nombre(o.ordre),
    partage: auto ? 'aucun' : partage,
    ...(auto ? { auto } : {}),
    ...(typeof o.description === 'string' && o.description ? { description: o.description.slice(0, 2000) } : {}),
    ...(typeof o.icone === 'string' && o.icone && o.icone.length <= 8 ? { icone: o.icone } : {}),
    ...(etiquettes.length ? { etiquettes } : {}),
    ...(jourValide(o.debut) ? { debut: o.debut } : {}),
    ...(jourValide(o.fin) ? { fin: o.fin } : {}),
    ...(historique.length ? { historique } : {}),
    ...((acces => (acces && !auto ? { acces } : {}))(lireAcces(o.acces))),
  };
}

export function lireListe(v: unknown): Liste | undefined {
  const o = dict(v);
  const b = base(o);
  if (!b || !idValide(o.projetId)) return undefined;
  return { ...b, projetId: o.projetId, nom: texte(o.nom, BORNES.nom, 'Liste') || 'Liste', ordre: nombre(o.ordre) };
}

function lireChecklist(v: unknown): Record<string, ElementChecklist> {
  const r: Record<string, ElementChecklist> = {};
  for (const [id, e] of Object.entries(dict(v)).slice(0, BORNES.checklist * 2)) {
    const o = dict(e);
    if (!idValide(id) || !hValide(o.h)) continue;
    r[id] = { id, texte: texte(o.texte, BORNES.titre), fait: o.fait === true, ordre: nombre(o.ordre), h: o.h, ...(o.supprime === true ? { supprime: true } : {}) };
  }
  return r;
}

const MOTIF_SESSION = /^[A-Za-z0-9_.:-]{1,80}$/;

export function lireTemps(v: unknown): Record<string, EntreeTemps> {
  const r: Record<string, EntreeTemps> = {};
  for (const [id, e] of Object.entries(dict(v)).slice(0, 2000)) {
    const o = dict(e);
    const auteur = lireAuteur(o.auteur);
    if (!idValide(id) || !hValide(o.h) || !auteur || !jourValide(o.jour)) continue;
    const minutes = Math.round(nombre(o.minutes));
    if (minutes < 0 || minutes > 24 * 60) continue;
    r[id] = {
      id,
      auteur,
      jour: o.jour,
      minutes,
      ...(typeof o.debut === 'string' && !Number.isNaN(Date.parse(o.debut)) ? { debut: o.debut.slice(0, 30) } : {}),
      ...(typeof o.note === 'string' && o.note ? { note: o.note.slice(0, 200) } : {}),
      h: o.h,
      ...(o.supprime === true ? { supprime: true } : {}),
    };
  }
  return r;
}

function lireLiensOffice(v: unknown): LienOffice[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const r: LienOffice[] = [];
  for (const x of v.slice(0, 20)) {
    const o = dict(x);
    if (typeof o.session !== 'string' || !MOTIF_SESSION.test(o.session) || typeof o.depuis !== 'string' || Number.isNaN(Date.parse(o.depuis))) continue;
    r.push({
      session: o.session,
      ...(typeof o.cle === 'string' && o.cle.length <= 160 ? { cle: o.cle } : {}),
      ...(typeof o.sousAgent === 'string' && MOTIF_SESSION.test(o.sousAgent) ? { sousAgent: o.sousAgent } : {}),
      ...(typeof o.projet === 'string' ? { projet: o.projet.slice(0, 80) } : {}),
      ...(typeof o.libelle === 'string' ? { libelle: o.libelle.slice(0, 160) } : {}),
      depuis: o.depuis.slice(0, 30),
      ...(typeof o.finVue === 'number' && Number.isFinite(o.finVue) ? { finVue: o.finVue } : {}),
    });
  }
  return r.length ? r : undefined;
}

const instantValide = (v: unknown): v is string => typeof v === 'string' && v.length <= 30 && !Number.isNaN(Date.parse(v));

function lireSource(v: unknown): { source: { app: AppLiee; cle: string } } | Record<string, never> {
  const src = dict(v);
  return APPS_LIEES.includes(src.app as AppLiee) && typeof src.cle === 'string' && src.cle.length > 0 && src.cle.length <= 160 ? { source: { app: src.app as AppLiee, cle: src.cle } } : {};
}

function lireCommentaires(v: unknown): Record<string, Commentaire> {
  const r: Record<string, Commentaire> = {};
  for (const [id, e] of Object.entries(dict(v)).slice(0, 500)) {
    const o = dict(e);
    const auteur = lireAuteur(o.auteur);
    if (!idValide(id) || !hValide(o.h) || !auteur || typeof o.date !== 'string') continue;
    const mentions = lireAuteurs(o.mentions);
    r[id] = { id, auteur, texte: texte(o.texte, BORNES.commentaire), date: o.date.slice(0, 30), h: o.h, ...(o.supprime === true ? { supprime: true } : {}), ...(mentions.length ? { mentions } : {}) };
  }
  return r;
}

function lireHistorique(v: unknown): EvenementHistorique[] {
  const r: EvenementHistorique[] = [];
  for (const e of (Array.isArray(v) ? v : []).slice(-BORNES.historique * 2)) {
    const o = dict(e);
    const auteur = lireAuteur(o.auteur);
    if (typeof o.id !== 'string' || o.id.length > 64 || typeof o.date !== 'string' || !auteur) continue;
    r.push({ id: o.id, date: o.date.slice(0, 30), auteur, texte: texte(o.texte, 200), ...(typeof o.avant === 'string' ? { avant: o.avant.slice(0, BORNES.avant) } : {}) });
  }
  return borneHistorique(r);
}

export function borneHistorique(h: EvenementHistorique[]): EvenementHistorique[] {
  const uniques = new Map<string, EvenementHistorique>();
  for (const e of h) if (!uniques.has(e.id)) uniques.set(e.id, e);
  return [...uniques.values()].sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1)).slice(-BORNES.historique);
}

export function lireTache(v: unknown): Tache | undefined {
  const o = dict(v);
  const b = base(o);
  if (!b || !idValide(o.projetId) || !idValide(o.listeId)) return undefined;
  const priorite: Priorite = PRIORITES.includes(o.priorite as Priorite) ? (o.priorite as Priorite) : 'normale';
  const echeance = lireEcheance(o.echeance);
  const recurrence = lireRecurrence(o.recurrence);
  const assigne = lireAuteur(o.assigne);
  const etiquettes = [...new Set((Array.isArray(o.etiquettes) ? o.etiquettes : []).filter((e): e is string => typeof e === 'string').map(normaliserEtiquette).filter(Boolean))].slice(0, BORNES.etiquettes);
  const rappels = [...new Set((Array.isArray(o.rappels) ? o.rappels : []).filter((m): m is number => Number.isInteger(m) && m >= 0 && m <= 60 * 24 * 30))].sort((a, b) => a - b).slice(0, BORNES.rappels);
  return {
    ...b,
    projetId: o.projetId,
    listeId: o.listeId,
    ...(idValide(o.parentId) ? { parentId: o.parentId } : {}),
    titre: texte(o.titre, BORNES.titre),
    description: texte(o.description, BORNES.description),
    statut: idValide(o.statut) ? o.statut : STATUTS_DEFAUT[0].id,
    priorite,
    ...(echeance ? { echeance } : {}),
    etiquettes,
    ...(assigne ? { assigne } : {}),
    ...(recurrence ? { recurrence } : {}),
    rappels,
    ...(jourValide(o.pourAujourdhui) ? { pourAujourdhui: o.pourAujourdhui } : {}),
    ...((a => (Array.isArray(o.assignes) ? { assignes: a } : {}))(lireAuteurs(o.assignes))),
    ...(jourValide(o.debut) ? { debut: o.debut } : {}),
    ...((dep => (dep.length ? { dependances: dep } : {}))([...new Set((Array.isArray(o.dependances) ? o.dependances : []).filter(idValide))].filter(x => x !== o.id).slice(0, 30))),
    ...(o.jalon === true ? { jalon: true } : {}),
    ...((g => (g ? { github: g } : {}))(lireLienGithub(o.github))),
    ...Object.fromEntries(Object.entries(o).filter(([c, v]) => MOTIF_CHAMP_CHRONO.test(c) && instantValide(v))),
    ordre: nombre(o.ordre),
    creeLe: typeof o.creeLe === 'string' ? o.creeLe.slice(0, 30) : new Date(0).toISOString(),
    creePar: lireAuteur(o.creePar) ?? 'fondateur',
    ...(typeof o.termineLe === 'string' ? { termineLe: o.termineLe.slice(0, 30) } : {}),
    ...(idValide(o.suivante) ? { suivante: o.suivante } : {}),
    ...lireSource(o.source),
    ...((l => (l ? { liensOffice: l } : {}))(lireLiensOffice(o.liensOffice))),
    ...(typeof o.estimation === 'number' && Number.isFinite(o.estimation) && o.estimation > 0 ? { estimation: Math.min(100_000, Math.round(o.estimation)) } : {}),
    ...(instantValide(o.chronoF) ? { chronoF: o.chronoF } : {}),
    ...(instantValide(o.chronoA) ? { chronoA: o.chronoA } : {}),
    temps: lireTemps(o.temps),
    checklist: lireChecklist(o.checklist),
    commentaires: lireCommentaires(o.commentaires),
    historique: lireHistorique(o.historique),
  };
}

const MOTIF_FILTRE = /^[a-z0-9-]{1,48}$/;

export function lireFiltres(v: unknown): Filtres {
  const o = dict(v);
  const liste = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.length <= 48) : []);
  const echeances: FiltreEcheance[] = ['toutes', 'retard', 'aujourdhui', 'semaine', 'sans'];
  return {
    recherche: texte(o.recherche, 120),
    statuts: liste(o.statuts).filter(s => MOTIF_FILTRE.test(s)),
    priorites: liste(o.priorites).filter((p): p is Priorite => PRIORITES.includes(p as Priorite)),
    etiquettes: liste(o.etiquettes),
    assigne: o.assigne === 'personne' ? 'personne' : lireAuteur(o.assigne) ?? 'tous',
    echeance: echeances.includes(o.echeance as FiltreEcheance) ? (o.echeance as FiltreEcheance) : 'toutes',
    terminees: o.terminees !== false,
  };
}

export function lireVue(v: unknown): VueEnregistree | undefined {
  const o = dict(v);
  const b = base(o);
  if (!b) return undefined;
  const vues: TypeVue[] = ['liste', 'kanban', 'calendrier', 'journee', 'gantt', 'tableau'];
  const tris: Tri[] = ['manuel', 'echeance', 'priorite', 'titre', 'creation', 'statut'];
  const groupes: Groupe[] = ['statut', 'priorite', 'echeance', 'aucun'];
  return {
    ...b,
    nom: texte(o.nom, BORNES.nom, 'Vue') || 'Vue',
    vue: vues.includes(o.vue as TypeVue) ? (o.vue as TypeVue) : 'liste',
    ...(idValide(o.projetId) ? { projetId: o.projetId } : {}),
    filtres: lireFiltres(o.filtres),
    tri: tris.includes(o.tri as Tri) ? (o.tri as Tri) : 'manuel',
    groupe: groupes.includes(o.groupe as Groupe) ? (o.groupe as Groupe) : 'statut',
  };
}

export function lireReglages(v: unknown): Reglages {
  const o = dict(v);
  return {
    id: 'reglages',
    h: lireH(o.h),
    ...(typeof o.ami === 'string' && /^[a-z0-9]{6,16}$/.test(o.ami) ? { ami: o.ami } : {}),
    ...(typeof o.amiNom === 'string' ? { amiNom: o.amiNom.slice(0, 40) } : {}),
    ...(typeof o.cle === 'string' && /^[0-9a-f]{64}$/.test(o.cle) ? { cle: o.cle } : {}),
    ...(idValide(o.demo) ? { demo: o.demo } : {}),
    ...((l => {
      const liens = Object.fromEntries(APPS_LIEES.filter(a => typeof l[a] === 'boolean').map(a => [a, l[a] as boolean]));
      return Object.keys(liens).length ? { liens } : {};
    })(dict(o.liens))),
    ...(o.notifF && typeof o.notifF === 'object' ? { notifF: o.notifF } : {}),
    ...(o.notifA && typeof o.notifA === 'object' ? { notifA: o.notifA } : {}),
    ...((m => (Object.keys(m).length ? { membres: m } : {}))(lireMembres(o.membres))),
    ...((c => (Object.keys(c).length ? { clesProjets: c } : {}))(lireClesProjets(o.clesProjets))),
    ...((n => (Object.keys(n).length ? { notifsMembres: n } : {}))(lireNotifsMembres(o.notifsMembres))),
  };
}

const HEX64 = /^[0-9a-f]{64}$/;
function lireMembres(v: unknown): Record<string, MembreTaches> {
  const r: Record<string, MembreTaches> = {};
  for (const [id, m] of Object.entries(dict(v)).slice(0, 50)) {
    const o = dict(m);
    if (!idMembreValide(id) || typeof o.cle !== 'string' || !HEX64.test(o.cle)) continue;
    r[id] = {
      nom: texte(o.nom, 40, 'Membre') || 'Membre',
      cle: o.cle,
      depuis: typeof o.depuis === 'string' ? o.depuis.slice(0, 30) : new Date(0).toISOString(),
      ...(o.rang === 'ami' || o.rang === 'gestionnaire' || o.rang === 'administrateur' ? { rang: o.rang } : {}),
      ...(o.perso === true ? { perso: true } : {}),
    };
  }
  return r;
}
function lireClesProjets(v: unknown): Record<string, { cle: string; avant?: string; le?: string }> {
  const r: Record<string, { cle: string; avant?: string; le?: string }> = {};
  for (const [id, c] of Object.entries(dict(v)).slice(0, 1000)) {
    const o = dict(c);
    if (!idValide(id) || typeof o.cle !== 'string' || !HEX64.test(o.cle)) continue;
    r[id] = { cle: o.cle, ...(typeof o.avant === 'string' && HEX64.test(o.avant) ? { avant: o.avant } : {}), ...(typeof o.le === 'string' ? { le: o.le.slice(0, 30) } : {}) };
  }
  return r;
}
function lireNotifsMembres(v: unknown): Record<string, { valeur: unknown; h: string }> {
  const r: Record<string, { valeur: unknown; h: string }> = {};
  for (const [id, n] of Object.entries(dict(v)).slice(0, 50)) {
    const o = dict(n);
    if (idMembreValide(id) && hValide(o.h) && o.valeur && typeof o.valeur === 'object') r[id] = { valeur: o.valeur, h: o.h };
  }
  return r;
}

export function lireObjectif(v: unknown): Objectif | undefined {
  const o = dict(v);
  const b = base(o);
  if (!b) return undefined;
  const ids = (x: unknown) => [...new Set((Array.isArray(x) ? x : []).filter(idValide))].slice(0, 200);
  const borne = (x: unknown, min: number, max: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : undefined);
  const manuel = borne(o.manuel, 0, 100);
  const cible = borne(o.cible, 0, 1e9);
  const atteint = borne(o.atteint, 0, 1e9);
  return {
    ...b,
    titre: texte(o.titre, BORNES.titre, 'Objectif') || 'Objectif',
    ...(typeof o.description === 'string' && o.description ? { description: o.description.slice(0, 2000) } : {}),
    ...(jourValide(o.echeance) ? { echeance: o.echeance } : {}),
    mode: o.mode === 'manuel' ? 'manuel' : 'taches',
    taches: ids(o.taches),
    projets: ids(o.projets),
    ...(manuel !== undefined ? { manuel: Math.round(manuel) } : {}),
    ...(cible !== undefined && cible > 0 ? { cible } : {}),
    ...(typeof o.unite === 'string' && o.unite ? { unite: o.unite.slice(0, 30) } : {}),
    ...(atteint !== undefined ? { atteint } : {}),
    couleur: couleur(o.couleur, COULEURS[0]),
    ordre: nombre(o.ordre),
  };
}

function lireDict<T extends Entite>(v: unknown, lire: (x: unknown) => T | undefined, max: number): Record<string, T> {
  const r: Record<string, T> = {};
  for (const e of Object.values(dict(v)).slice(0, max)) {
    const lu = lire(e);
    if (lu) r[lu.id] = lu;
  }
  return r;
}

export const donneesVides = (): DonneesTaches => ({ v: 1, espaces: {}, projets: {}, listes: {}, taches: {}, vues: {}, reglages: { id: 'reglages', h: {} }, journal: {}, objectifs: {} });

export function lireJournal(v: unknown): Record<string, EntreeJournal> {
  const r: Record<string, EntreeJournal> = {};
  for (const [id, e] of Object.entries(dict(v)).slice(0, 20_000)) {
    const o = dict(e);
    const auteur = lireAuteur(o.auteur);
    if (!idValide(id) || !idValide(o.projetId) || !jourValide(o.jour) || !auteur || !hValide(o.h)) continue;
    r[id] = {
      id,
      projetId: o.projetId,
      jour: o.jour,
      auteur,
      texte: texte(o.texte, BORNES.commentaire),
      ...(idValide(o.tacheId) ? { tacheId: o.tacheId } : {}),
      ...(typeof o.minutes === 'number' && o.minutes > 0 && o.minutes <= 24 * 60 ? { minutes: Math.round(o.minutes) } : {}),
      creeLe: typeof o.creeLe === 'string' ? o.creeLe.slice(0, 30) : new Date(0).toISOString(),
      h: o.h,
      ...(o.supprime === true ? { supprime: true } : {}),
    };
  }
  return r;
}

/** Lit des données de tâches (texte JSON ou objet), en écartant tout ce qui est invalide. */
export function lireDonnees(brut: unknown): DonneesTaches {
  let o: Record<string, unknown>;
  try {
    o = dict(typeof brut === 'string' ? JSON.parse(brut) : brut);
  } catch {
    return donneesVides();
  }
  return {
    v: 1,
    espaces: lireDict(o.espaces, lireEspace, 200),
    projets: lireDict(o.projets, lireProjet, 1000),
    listes: lireDict(o.listes, lireListe, 3000),
    taches: lireDict(o.taches, lireTache, 20_000),
    vues: lireDict(o.vues, lireVue, 100),
    reglages: lireReglages(o.reglages),
    journal: lireJournal(o.journal),
    objectifs: lireDict(o.objectifs, lireObjectif, 500),
  };
}

export const ecrireDonnees = (d: DonneesTaches): string => JSON.stringify(d);

// ------------------------------------------------------------------ Modification d'une entité

/** Change des champs d'une entité en datant chacun (rien n'est daté s'il ne change pas). */
export function changerChamps<T extends Entite>(e: T, changement: Readonly<Record<string, unknown>>, ctx: Contexte): T {
  const suivant = { ...e, h: { ...e.h } } as unknown as Record<string, unknown> & { h: Horodatages };
  let change = false;
  for (const [cle, valeur] of Object.entries(changement)) {
    if (cle === 'id' || cle === 'h') continue;
    if (JSON.stringify((e as Record<string, unknown>)[cle]) === JSON.stringify(valeur)) continue;
    if (valeur === undefined) delete suivant[cle];
    else suivant[cle] = valeur;
    suivant.h[cle] = horodatage(ctx.maintenant, ctx.auteur, e.h[cle]);
    change = true;
  }
  return change ? (suivant as unknown as T) : e;
}

function nouvelleEntite(prefixe: string, ctx: Contexte): Entite {
  return { id: nouvelId(prefixe, ctx.maintenant, ctx.alea), h: {} };
}

/** Horodate tous les champs d'une entité neuve. */
function dater<T extends Entite>(e: T, ctx: Contexte): T {
  const h: Horodatages = {};
  const hh = horodatage(ctx.maintenant, ctx.auteur);
  for (const cle of Object.keys(e)) if (cle !== 'id' && cle !== 'h' && cle !== 'checklist' && cle !== 'commentaires' && cle !== 'historique' && cle !== 'temps') h[cle] = hh;
  return { ...e, h };
}

const nomPropre = (nom: string, defaut: string) => nom.trim().slice(0, BORNES.nom) || defaut;

// ------------------------------------------------------------------ Lecture des vivants

export const vivant = <T extends Entite>(e: T | undefined): e is T => Boolean(e && !e.supprime);
const parOrdre = <T extends { ordre: number; nom?: string; id: string }>(a: T, b: T) => a.ordre - b.ordre || a.id.localeCompare(b.id);

export function espacesVivants(d: DonneesTaches): Espace[] {
  return Object.values(d.espaces).filter(vivant).sort(parOrdre);
}
export function projetsDe(d: DonneesTaches, espaceId?: string): Projet[] {
  return Object.values(d.projets)
    .filter(p => vivant(p) && (espaceId === undefined || p.espaceId === espaceId) && (espaceId !== undefined || vivant(d.espaces[p.espaceId]) || !d.espaces[p.espaceId]))
    .sort(parOrdre);
}
export function listesDe(d: DonneesTaches, projetId: string): Liste[] {
  return Object.values(d.listes).filter(l => vivant(l) && l.projetId === projetId).sort(parOrdre);
}
/** Tâches vivantes d'un projet vivant (ou de tous), sous-tâches comprises. */
export function tachesVivantes(d: DonneesTaches, projetId?: string): Tache[] {
  return Object.values(d.taches).filter(t => {
    if (!vivant(t) || (projetId !== undefined && t.projetId !== projetId)) return false;
    const p = d.projets[t.projetId];
    const l = d.listes[t.listeId];
    if (!vivant(p) || !vivant(l)) return false;
    if (t.parentId && !vivant(d.taches[t.parentId])) return false;
    return true;
  });
}
export const sousTaches = (d: DonneesTaches, id: string): Tache[] =>
  Object.values(d.taches)
    .filter(t => vivant(t) && t.parentId === id)
    .sort((a, b) => a.ordre - b.ordre || a.creeLe.localeCompare(b.creeLe));

export function statutsDe(d: DonneesTaches, projetId: string): Statut[] {
  return d.projets[projetId]?.statuts ?? STATUTS_DEFAUT.map(s => ({ ...s }));
}
export function statutDe(d: DonneesTaches, t: Pick<Tache, 'projetId' | 'statut'>): Statut {
  const statuts = statutsDe(d, t.projetId);
  return statuts.find(s => s.id === t.statut) ?? statuts[0];
}
export const estTerminee = (d: DonneesTaches, t: Pick<Tache, 'projetId' | 'statut'>): boolean => statutDe(d, t).ferme;

export function etiquettesUtilisees(taches: readonly Tache[]): string[] {
  return [...new Set(taches.flatMap(t => t.etiquettes))].sort((a, b) => sansAccents(a).localeCompare(sansAccents(b)));
}

// ------------------------------------------------------------------ Espaces, projets, listes

export function creerEspace(d: DonneesTaches, nom: string, ctx: Contexte, couleurChoisie?: string): { donnees: DonneesTaches; espace: Espace } {
  const ordre = Math.max(0, ...Object.values(d.espaces).map(e => e.ordre)) + 1;
  const espace = dater<Espace>({ ...nouvelleEntite('e', ctx), nom: nomPropre(nom, 'Espace'), couleur: couleurChoisie ?? COULEURS[Object.keys(d.espaces).length % COULEURS.length], ordre }, ctx);
  return { donnees: { ...d, espaces: { ...d.espaces, [espace.id]: espace } }, espace };
}

export function creerProjet(d: DonneesTaches, espaceId: string, nom: string, ctx: Contexte): { donnees: DonneesTaches; projet: Projet; liste: Liste } {
  if (!vivant(d.espaces[espaceId])) throw new ErreurTaches('Espace introuvable.');
  const ordre = Math.max(0, ...Object.values(d.projets).map(p => p.ordre)) + 1;
  const projet = dater<Projet>({
    ...nouvelleEntite('p', ctx),
    espaceId,
    nom: nomPropre(nom, 'Projet'),
    couleur: d.espaces[espaceId].couleur,
    statuts: STATUTS_DEFAUT.map(s => ({ ...s })),
    ordre,
    partage: 'aucun',
  }, ctx);
  const liste = dater<Liste>({ ...nouvelleEntite('l', ctx), projetId: projet.id, nom: 'Liste', ordre: 1 }, ctx);
  return { donnees: { ...d, projets: { ...d.projets, [projet.id]: projet }, listes: { ...d.listes, [liste.id]: liste } }, projet, liste };
}

export function creerListe(d: DonneesTaches, projetId: string, nom: string, ctx: Contexte): { donnees: DonneesTaches; liste: Liste } {
  if (!vivant(d.projets[projetId])) throw new ErreurTaches('Projet introuvable.');
  const ordre = Math.max(0, ...listesDe(d, projetId).map(l => l.ordre)) + 1;
  const liste = dater<Liste>({ ...nouvelleEntite('l', ctx), projetId, nom: nomPropre(nom, 'Liste'), ordre }, ctx);
  return { donnees: { ...d, listes: { ...d.listes, [liste.id]: liste } }, liste };
}

export function modifierEspace(d: DonneesTaches, id: string, c: Partial<Pick<Espace, 'nom' | 'couleur' | 'ordre'>>, ctx: Contexte): DonneesTaches {
  const e = d.espaces[id];
  if (!vivant(e)) throw new ErreurTaches('Espace introuvable.');
  return { ...d, espaces: { ...d.espaces, [id]: changerChamps(e, c.nom !== undefined ? { ...c, nom: nomPropre(c.nom, e.nom) } : c, ctx) } };
}

export type ChangementProjet = Partial<Pick<Projet, 'nom' | 'couleur' | 'ordre' | 'partage' | 'espaceId' | 'description' | 'icone' | 'etiquettes' | 'debut' | 'fin'>>;

/** Texte de l'historique du projet pour un champ changé. */
function decrireProjet(d: DonneesTaches, p: Projet, cle: string, v: unknown): string | undefined {
  switch (cle) {
    case 'nom':
      return `Renommé : « ${p.nom} » → « ${v as string} »`;
    case 'couleur':
      return 'Couleur changée';
    case 'icone':
      return v ? `Icône : ${v as string}` : 'Icône retirée';
    case 'description':
      return 'Description modifiée';
    case 'etiquettes':
      return `Étiquettes du projet : ${((v as string[]) ?? []).map(e => `#${e}`).join(' ') || 'aucune'}`;
    case 'debut':
      return `Début : ${v ? (v as string).split('-').reverse().join('/') : '—'}`;
    case 'fin':
      return `Fin : ${v ? (v as string).split('-').reverse().join('/') : '—'}`;
    case 'espaceId':
      return `Déplacé vers l’espace « ${d.espaces[v as string]?.nom ?? ''} »`;
    case 'partage':
      return `Partage : ${LIBELLES_PARTAGE[v as ModePartage]}`;
    case 'statuts':
      return 'Statuts modifiés';
    default:
      return undefined;
  }
}

/** Ajoute à l'historique d'un projet ce qui a changé entre `avant` et `apres`. */
function historiserProjet(d: DonneesTaches, avant: Projet, apres: Projet, champs: readonly string[], ctx: Contexte): Projet {
  if (apres === avant) return apres;
  const evts: EvenementHistorique[] = [];
  for (const c of champs) {
    if (JSON.stringify((avant as unknown as Record<string, unknown>)[c]) === JSON.stringify((apres as unknown as Record<string, unknown>)[c])) continue;
    const t = decrireProjet(d, avant, c, (apres as unknown as Record<string, unknown>)[c]);
    if (t) evts.push(evenement(ctx, t));
  }
  return evts.length ? { ...apres, historique: borneHistorique([...(apres.historique ?? []), ...evts]) } : apres;
}

export function modifierProjet(d: DonneesTaches, id: string, c: ChangementProjet, ctx: Contexte): DonneesTaches {
  const p = d.projets[id];
  if (!vivant(p)) throw new ErreurTaches('Projet introuvable.');
  if (p.auto && c.partage && c.partage !== 'aucun') throw new ErreurTaches('Ce projet est tenu par une autre app : il ne se partage pas.');
  if (c.espaceId !== undefined && !vivant(d.espaces[c.espaceId])) throw new ErreurTaches('Espace introuvable.');
  if (c.debut && c.fin && c.fin < c.debut) throw new ErreurTaches('La fin du projet est avant son début.');
  const propre: Record<string, unknown> = { ...c };
  if (c.nom !== undefined) propre.nom = nomPropre(c.nom, p.nom);
  if (c.description !== undefined) propre.description = c.description.trim().slice(0, 2000) || undefined;
  if (c.icone !== undefined) propre.icone = c.icone.trim().slice(0, 8) || undefined;
  if (c.etiquettes !== undefined) {
    const e = [...new Set(c.etiquettes.map(normaliserEtiquette).filter(Boolean))].slice(0, 30);
    propre.etiquettes = e.length ? e : undefined;
  }
  const apres = historiserProjet(d, p, changerChamps(p, propre, ctx), Object.keys(propre), ctx);
  return { ...d, projets: { ...d.projets, [id]: apres } };
}

export function modifierListe(d: DonneesTaches, id: string, c: Partial<Pick<Liste, 'nom' | 'ordre'>>, ctx: Contexte): DonneesTaches {
  const l = d.listes[id];
  if (!vivant(l)) throw new ErreurTaches('Liste introuvable.');
  return { ...d, listes: { ...d.listes, [id]: changerChamps(l, c.nom !== undefined ? { ...c, nom: nomPropre(c.nom, l.nom) } : c, ctx) } };
}

/**
 * Pierre tombale d'un projet, de ses listes et de ses tâches, toutes du même
 * lot (le projet, ou l'espace supprimé avec lui) : la corbeille les rend
 * ensemble, sans ce qui avait été supprimé avant.
 */
export function supprimerProjet(d: DonneesTaches, id: string, ctx: Contexte, lot: string = id): DonneesTaches {
  if (ctx.auteur !== 'fondateur') throw new ErreurTaches('Seul le Fondateur supprime un projet.');
  const p = d.projets[id];
  if (!vivant(p)) return d;
  const tombe = { supprime: true, lot };
  const listes = { ...d.listes };
  for (const l of Object.values(d.listes)) if (l.projetId === id && !l.supprime) listes[l.id] = changerChamps(l, tombe, ctx);
  const taches = { ...d.taches };
  for (const t of Object.values(d.taches)) if (t.projetId === id && !t.supprime) taches[t.id] = changerChamps(t, tombe, ctx);
  return { ...d, projets: { ...d.projets, [id]: changerChamps(p, tombe, ctx) }, listes, taches };
}

export function supprimerEspace(d: DonneesTaches, id: string, ctx: Contexte): DonneesTaches {
  if (ctx.auteur !== 'fondateur') throw new ErreurTaches('Seul le Fondateur supprime un espace.');
  const e = d.espaces[id];
  if (!vivant(e)) return d;
  let suivant = d;
  for (const p of projetsDe(d, id)) suivant = supprimerProjet(suivant, p.id, ctx, id);
  return { ...suivant, espaces: { ...suivant.espaces, [id]: changerChamps(e, { supprime: true, lot: id }, ctx) } };
}

export function supprimerListe(d: DonneesTaches, id: string, ctx: Contexte): DonneesTaches {
  if (ctx.auteur !== 'fondateur') throw new ErreurTaches('Seul le Fondateur supprime une liste.');
  const l = d.listes[id];
  if (!vivant(l)) return d;
  if (listesDe(d, l.projetId).length <= 1) throw new ErreurTaches('Un projet garde au moins une liste : déplacez ses tâches ou supprimez le projet.');
  const tombe = { supprime: true, lot: id };
  const taches = { ...d.taches };
  for (const t of Object.values(d.taches)) if (t.listeId === id && !t.supprime) taches[t.id] = changerChamps(t, tombe, ctx);
  return { ...d, listes: { ...d.listes, [id]: changerChamps(l, tombe, ctx) }, taches };
}

/**
 * Remplace les statuts d'un projet. Une tâche dont le statut disparaît prend
 * le statut indiqué par `remplacement` (sinon le premier).
 */
export function changerStatuts(d: DonneesTaches, projetId: string, statuts: readonly Statut[], ctx: Contexte, remplacement: Record<string, string> = {}): DonneesTaches {
  const p = d.projets[projetId];
  if (!vivant(p)) throw new ErreurTaches('Projet introuvable.');
  const propres = lireStatuts(statuts.map(s => ({ ...s, nom: s.nom.trim() || 'Statut' })));
  if (!propres.some(s => s.ferme)) throw new ErreurTaches('Gardez au moins un statut « terminé ».');
  if (!propres.some(s => !s.ferme)) throw new ErreurTaches('Gardez au moins un statut ouvert.');
  const ids = new Set(propres.map(s => s.id));
  let suivant: DonneesTaches = { ...d, projets: { ...d.projets, [projetId]: historiserProjet(d, p, changerChamps(p, { statuts: propres }, ctx), ['statuts'], ctx) } };
  for (const t of Object.values(d.taches)) {
    if (t.projetId !== projetId || t.supprime || ids.has(t.statut)) continue;
    const cible = remplacement[t.statut] && ids.has(remplacement[t.statut]) ? remplacement[t.statut] : propres[0].id;
    suivant = modifierTache(suivant, t.id, { statut: cible }, ctx);
  }
  return suivant;
}

export function nouveauStatut(nom: string, statuts: readonly Statut[], alea: () => number = Math.random): Statut {
  const base = sansAccents(nom).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'statut';
  let id = base.length >= 2 ? base : `s-${base}`;
  while (statuts.some(s => s.id === id)) id = `${base}-${Math.floor(alea() * 1000)}`;
  return { id, nom: nom.trim().slice(0, BORNES.nom) || 'Statut', couleur: COULEURS[statuts.length % COULEURS.length], ferme: false };
}

// ------------------------------------------------------------------ Tâches

export interface SaisieTache {
  titre: string;
  listeId: string;
  parentId?: string;
  description?: string;
  statut?: string;
  priorite?: Priorite;
  echeance?: Echeance;
  etiquettes?: string[];
  assigne?: Auteur;
  recurrence?: Recurrence;
  rappels?: number[];
  pourAujourdhui?: string;
  estimation?: number;
  assignes?: Auteur[];
  debut?: string;
  source?: { app: AppLiee; cle: string };
  liensOffice?: LienOffice[];
}

export function evenement(ctx: Contexte, texteEvt: string, avant?: string, id?: string): EvenementHistorique {
  const date = new Date(ctx.maintenant).toISOString();
  return { id: id ?? nouvelId('h', ctx.maintenant, ctx.alea), date, auteur: ctx.auteur, texte: texteEvt.slice(0, 200), ...(avant !== undefined ? { avant: avant.slice(0, BORNES.avant) } : {}) };
}

export function creerTache(d: DonneesTaches, s: SaisieTache, ctx: Contexte, id?: string): { donnees: DonneesTaches; tache: Tache } {
  const liste = d.listes[s.listeId];
  if (!vivant(liste) || !vivant(d.projets[liste.projetId])) throw new ErreurTaches('Liste introuvable.');
  const titre = s.titre.trim().slice(0, BORNES.titre);
  if (!titre) throw new ErreurTaches('Donnez un titre à la tâche.');
  let parentId = s.parentId;
  if (parentId) {
    const parent = d.taches[parentId];
    if (!vivant(parent)) throw new ErreurTaches('Tâche parente introuvable.');
    // Un seul niveau : la sous-tâche d'une sous-tâche est rattachée à la tâche principale.
    if (parent.parentId) parentId = parent.parentId;
  }
  const statuts = statutsDe(d, liste.projetId);
  const statut = s.statut && statuts.some(st => st.id === s.statut) ? s.statut : statuts[0].id;
  const ordre = Math.max(0, ...Object.values(d.taches).filter(t => t.listeId === s.listeId).map(t => t.ordre)) + 1;
  const tache = dater<Tache>({
    id: id ?? nouvelId('t', ctx.maintenant, ctx.alea),
    h: {},
    projetId: liste.projetId,
    listeId: liste.id,
    ...(parentId ? { parentId } : {}),
    titre,
    description: (s.description ?? '').slice(0, BORNES.description),
    statut,
    priorite: s.priorite ?? 'normale',
    ...(s.echeance ? { echeance: s.echeance } : {}),
    etiquettes: [...new Set((s.etiquettes ?? []).map(normaliserEtiquette).filter(Boolean))].slice(0, BORNES.etiquettes),
    ...(s.assigne ? { assigne: s.assigne } : {}),
    ...(s.recurrence ? { recurrence: s.recurrence } : {}),
    rappels: [...new Set(s.rappels ?? [])].sort((a, b) => a - b).slice(0, BORNES.rappels),
    ...(s.pourAujourdhui ? { pourAujourdhui: s.pourAujourdhui } : {}),
    ...(s.estimation ? { estimation: s.estimation } : {}),
    ...(s.assignes?.length ? { assignes: [...new Set(s.assignes)], assigne: s.assignes[0] } : {}),
    ...(s.debut ? { debut: s.debut } : {}),
    ...(s.source ? { source: s.source } : {}),
    ...(s.liensOffice?.length ? { liensOffice: s.liensOffice } : {}),
    ordre,
    creeLe: new Date(ctx.maintenant).toISOString(),
    creePar: ctx.auteur,
    temps: {},
    checklist: {},
    commentaires: {},
    // Identifiant imposé (récurrence) : même événement de création des deux côtés.
    historique: [evenement(ctx, parentId ? 'Sous-tâche créée' : 'Tâche créée', undefined, id ? `h${id}`.slice(0, 48) : undefined)],
  }, ctx);
  return { donnees: { ...d, taches: { ...d.taches, [tache.id]: tache } }, tache };
}

export type ChangementTache = Partial<Pick<Tache, 'titre' | 'description' | 'statut' | 'priorite' | 'echeance' | 'etiquettes' | 'assigne' | 'assignes' | 'recurrence' | 'rappels' | 'pourAujourdhui' | 'ordre' | 'listeId' | 'projetId' | 'parentId' | 'estimation' | 'liensOffice' | 'debut' | 'dependances' | 'jalon' | 'github'>>;

/**
 * Personnes assignées : `assignes` (V3), sinon `assigne` (V1/V2). Si un
 * appareil plus ancien a changé `assigne` après, c'est lui qui compte.
 */
export function assignesDe(t: Pick<Tache, 'assigne' | 'assignes' | 'h'>): Auteur[] {
  if (t.assignes && !((t.h.assigne ?? '') > (t.h.assignes ?? ''))) return t.assignes;
  return t.assigne ? [t.assigne] : [];
}

/**
 * La tâche concerne-t-elle `qui` (rappels, notifications) ? Le Fondateur :
 * les siennes et celles de personne ; un membre : celles qui lui sont assignées.
 */
export function pourQui(t: Pick<Tache, 'assigne' | 'assignes' | 'h'>, qui: Auteur): boolean {
  const l = assignesDe(t);
  return qui === 'fondateur' ? l.length === 0 || l.includes('fondateur') : l.includes(qui);
}

/** Une dépendance créerait-elle une boucle (B attend A qui attend B) ? */
export function creeBoucle(d: DonneesTaches, tacheId: string, avant: string): boolean {
  const vus = new Set<string>();
  const pile = [avant];
  while (pile.length) {
    const x = pile.pop()!;
    if (x === tacheId) return true;
    if (vus.has(x)) continue;
    vus.add(x);
    pile.push(...(d.taches[x]?.dependances ?? []));
  }
  return false;
}

const ou = (v: string | undefined) => v || '—';

/** Texte de l'historique pour un champ changé. */
function decrire(d: DonneesTaches, t: Tache, cle: string, valeur: unknown, noms: Partial<Record<Auteur, string>>): { texte: string; avant?: string } | undefined {
  switch (cle) {
    case 'titre':
      return { texte: 'Titre modifié', avant: t.titre };
    case 'description':
      return { texte: 'Description modifiée', avant: t.description };
    case 'statut': {
      const st = statutsDe(d, t.projetId);
      return { texte: `Statut : ${ou(st.find(s => s.id === t.statut)?.nom)} → ${ou(st.find(s => s.id === valeur)?.nom)}` };
    }
    case 'priorite':
      return { texte: `Priorité : ${LIBELLES_PRIORITE[t.priorite]} → ${LIBELLES_PRIORITE[valeur as Priorite]}` };
    case 'echeance': {
      const e = valeur as Echeance | undefined;
      const lib = (x?: Echeance) => (x ? `${x.jour.split('-').reverse().join('/')}${x.heure ? ` ${x.heure}` : ''}` : '—');
      return { texte: `Échéance : ${lib(t.echeance)} → ${lib(e)}` };
    }
    case 'assigne':
      return undefined;
    case 'assignes': {
      const l = (valeur as Auteur[] | undefined) ?? [];
      return { texte: l.length ? `Assignée à ${l.map(x => noms[x] ?? (x === 'ami' ? 'l’ami' : x === 'fondateur' ? 'le Fondateur' : 'un membre')).join(', ')}` : 'Plus assignée' };
    }
    case 'debut':
      return { texte: `Début : ${valeur ? (valeur as string).split('-').reverse().join('/') : '—'}` };
    case 'dependances':
      return { texte: `Dépendances : ${((valeur as string[] | undefined) ?? []).map(x => `« ${d.taches[x]?.titre ?? '?'} »`).join(', ') || 'aucune'}` };
    case 'jalon':
      return { texte: valeur ? 'Devient un jalon' : 'N’est plus un jalon' };
    case 'github':
      return { texte: valeur ? `Lien GitHub : ${(valeur as LienGithub).depot}${(valeur as LienGithub).pr ? ` #${(valeur as LienGithub).pr}` : ''}` : 'Lien GitHub retiré' };
    case 'etiquettes': {
      const avant = new Set(t.etiquettes);
      const apres = new Set(valeur as string[]);
      const plus = [...apres].filter(e => !avant.has(e)).map(e => `+${e}`);
      const moins = [...avant].filter(e => !apres.has(e)).map(e => `−${e}`);
      return { texte: `Étiquettes : ${[...plus, ...moins].join(' ') || 'réordonnées'}` };
    }
    case 'recurrence':
      return { texte: valeur ? 'Récurrence modifiée' : 'Récurrence retirée' };
    case 'rappels':
      return { texte: 'Rappels modifiés' };
    case 'listeId':
      return { texte: `Déplacée vers la liste « ${ou(d.listes[valeur as string]?.nom)} »` };
    case 'supprime':
      return { texte: valeur ? 'Tâche supprimée' : 'Tâche restaurée' };
    case 'estimation':
      return { texte: valeur ? `Estimation : ${valeur} min` : 'Estimation retirée' };
    default:
      return undefined;
  }
}

export function modifierTache(d: DonneesTaches, id: string, c: ChangementTache & { supprime?: boolean; lot?: string; termineLe?: string; suivante?: string }, ctx: Contexte, noms: Partial<Record<Auteur, string>> = {}): DonneesTaches {
  const t = d.taches[id];
  if (!t) throw new ErreurTaches('Tâche introuvable.');
  const propre: Record<string, unknown> = { ...c };
  if (c.titre !== undefined) {
    propre.titre = c.titre.trim().slice(0, BORNES.titre);
    if (!propre.titre) throw new ErreurTaches('Le titre ne peut pas être vide.');
  }
  if (c.description !== undefined) propre.description = c.description.slice(0, BORNES.description);
  if (c.etiquettes) propre.etiquettes = [...new Set(c.etiquettes.map(normaliserEtiquette).filter(Boolean))].slice(0, BORNES.etiquettes);
  if (c.rappels) propre.rappels = [...new Set(c.rappels)].sort((a, b) => a - b).slice(0, BORNES.rappels);
  // Assignation : `assignes` (V3) et `assigne` (la première, pour les appareils plus anciens) vont ensemble.
  if (c.assignes !== undefined) {
    const l = [...new Set(c.assignes)].slice(0, 20);
    propre.assignes = l.length ? l : undefined;
    propre.assigne = l[0];
  } else if ('assigne' in c) {
    propre.assignes = c.assigne ? [c.assigne] : undefined;
  }
  if (c.dependances !== undefined) {
    const l = [...new Set(c.dependances)].filter(x => x !== id && d.taches[x]);
    for (const x of l) if (!(t.dependances ?? []).includes(x) && creeBoucle(d, id, x)) throw new ErreurTaches('Cette dépendance ferait une boucle.');
    propre.dependances = l.length ? l.slice(0, 30) : undefined;
  }
  if (c.debut !== undefined && c.debut && !jourValide(c.debut)) throw new ErreurTaches('Date de début invalide.');
  if (c.jalon === false) propre.jalon = undefined;
  if (c.listeId !== undefined && c.listeId !== t.listeId) {
    const l = d.listes[c.listeId];
    if (!vivant(l)) throw new ErreurTaches('Liste introuvable.');
    propre.projetId = l.projetId;
    if (l.projetId !== t.projetId) {
      // Changement de projet : statut équivalent (même identifiant) ou le premier.
      const statuts = statutsDe(d, l.projetId);
      if (!statuts.some(s => s.id === (propre.statut ?? t.statut))) propre.statut = statuts[0].id;
    }
  }
  if (propre.statut !== undefined && !statutsDe(d, (propre.projetId as string) ?? t.projetId).some(s => s.id === propre.statut)) {
    throw new ErreurTaches('Statut inconnu pour ce projet.');
  }
  const suivant = changerChamps(t, propre as Partial<Tache>, ctx);
  if (suivant === t) return d;
  // Terminée / rouverte : date de fin.
  const fermeAvant = estTerminee(d, t);
  const fermeApres = estTerminee(d, suivant);
  let finale = suivant;
  if (fermeApres && !fermeAvant && c.termineLe === undefined) finale = changerChamps(finale, { termineLe: new Date(ctx.maintenant).toISOString() }, ctx);
  if (!fermeApres && fermeAvant) finale = changerChamps(finale, { termineLe: undefined }, ctx);
  const evts: EvenementHistorique[] = [];
  for (const cle of Object.keys(propre)) {
    if (JSON.stringify((t as unknown as Record<string, unknown>)[cle]) === JSON.stringify(propre[cle])) continue;
    const desc = decrire(d, t, cle, propre[cle], noms);
    if (desc) evts.push(evenement(ctx, desc.texte, desc.avant));
  }
  if (evts.length) finale = { ...finale, historique: borneHistorique([...finale.historique, ...evts]) };
  let taches = { ...d.taches, [id]: finale };
  // Suppression : les sous-tâches suivent ; déplacement : elles suivent aussi.
  for (const st of Object.values(d.taches)) {
    if (st.parentId !== id) continue;
    if (st.supprime) {
      // Restauration : les sous-tâches supprimées avec elle reviennent avec elle.
      if (c.supprime === false && !st.efface && st.lot === (t.lot ?? id)) taches = { ...taches, [st.id]: changerChamps(st, { supprime: false, lot: undefined }, ctx) };
      continue;
    }
    const cs: Partial<Tache> = {};
    if (c.supprime === true) Object.assign(cs, { supprime: true, lot: c.lot ?? id });
    if (finale.listeId !== st.listeId) Object.assign(cs, { listeId: finale.listeId, projetId: finale.projetId });
    if (finale.projetId !== st.projetId && !statutsDe(d, finale.projetId).some(s => s.id === st.statut)) cs.statut = statutsDe(d, finale.projetId)[0].id;
    if (Object.keys(cs).length) taches = { ...taches, [st.id]: changerChamps(st, cs, ctx) };
  }
  return { ...d, taches };
}

export const supprimerTache = (d: DonneesTaches, id: string, ctx: Contexte, lot: string = id) => modifierTache(d, id, { supprime: true, lot }, ctx);
export const restaurerTache = (d: DonneesTaches, id: string, ctx: Contexte) => modifierTache(d, id, { supprime: false, lot: undefined }, ctx);

// ------------------------------------------------------------------ Checklist, commentaires

function avecTache(d: DonneesTaches, id: string, changer: (t: Tache) => Tache): DonneesTaches {
  const t = d.taches[id];
  if (!vivant(t)) throw new ErreurTaches('Tâche introuvable.');
  return { ...d, taches: { ...d.taches, [id]: changer(t) } };
}

export function ajouterElement(d: DonneesTaches, tacheId: string, texteEl: string, ctx: Contexte): DonneesTaches {
  const t = texteEl.trim().slice(0, BORNES.titre);
  if (!t) throw new ErreurTaches('Élément vide.');
  return avecTache(d, tacheId, tache => {
    const vivants = Object.values(tache.checklist).filter(e => !e.supprime);
    if (vivants.length >= BORNES.checklist) throw new ErreurTaches('Checklist pleine (100 éléments).');
    const id = nouvelId('c', ctx.maintenant, ctx.alea);
    const ordre = Math.max(0, ...vivants.map(e => e.ordre)) + 1;
    return { ...tache, checklist: { ...tache.checklist, [id]: { id, texte: t, fait: false, ordre, h: horodatage(ctx.maintenant, ctx.auteur) } } };
  });
}

export function changerElement(d: DonneesTaches, tacheId: string, id: string, c: Partial<Pick<ElementChecklist, 'texte' | 'fait' | 'supprime'>>, ctx: Contexte): DonneesTaches {
  return avecTache(d, tacheId, tache => {
    const e = tache.checklist[id];
    if (!e) throw new ErreurTaches('Élément introuvable.');
    return { ...tache, checklist: { ...tache.checklist, [id]: { ...e, ...c, ...(c.texte !== undefined ? { texte: c.texte.slice(0, BORNES.titre) } : {}), h: horodatage(ctx.maintenant, ctx.auteur, e.h) } } };
  });
}

export const elementsChecklist = (t: Tache): ElementChecklist[] => Object.values(t.checklist).filter(e => !e.supprime).sort((a, b) => a.ordre - b.ordre || a.id.localeCompare(b.id));

export function ajouterCommentaire(d: DonneesTaches, tacheId: string, texteC: string, ctx: Contexte, mentions: readonly Auteur[] = []): DonneesTaches {
  const t = texteC.trim().slice(0, BORNES.commentaire);
  if (!t) throw new ErreurTaches('Commentaire vide.');
  return avecTache(d, tacheId, tache => {
    const id = nouvelId('m', ctx.maintenant, ctx.alea);
    const date = new Date(ctx.maintenant).toISOString();
    const m = [...new Set(mentions)].filter(x => x !== ctx.auteur).slice(0, 20);
    return { ...tache, commentaires: { ...tache.commentaires, [id]: { id, auteur: ctx.auteur, texte: t, date, h: horodatage(ctx.maintenant, ctx.auteur), ...(m.length ? { mentions: m } : {}) } } };
  });
}

export function supprimerCommentaire(d: DonneesTaches, tacheId: string, id: string, ctx: Contexte): DonneesTaches {
  return avecTache(d, tacheId, tache => {
    const c = tache.commentaires[id];
    if (!c) throw new ErreurTaches('Commentaire introuvable.');
    if (c.auteur !== ctx.auteur && ctx.auteur !== 'fondateur') throw new ErreurTaches('Vous ne pouvez supprimer que vos commentaires.');
    return { ...tache, commentaires: { ...tache.commentaires, [id]: { ...c, supprime: true, h: horodatage(ctx.maintenant, ctx.auteur, c.h) } } };
  });
}

export const commentairesDe = (t: Tache): Commentaire[] => Object.values(t.commentaires).filter(c => !c.supprime).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

// ------------------------------------------------------------------ Vues enregistrées, réglages

export function enregistrerVue(d: DonneesTaches, v: Omit<VueEnregistree, 'id' | 'h'>, ctx: Contexte, id?: string): { donnees: DonneesTaches; vue: VueEnregistree } {
  const existante = id ? d.vues[id] : undefined;
  const propre = { ...v, nom: nomPropre(v.nom, 'Vue') };
  const vue = existante ? changerChamps(existante, propre, ctx) : dater<VueEnregistree>({ ...nouvelleEntite('v', ctx), ...propre }, ctx);
  return { donnees: { ...d, vues: { ...d.vues, [vue.id]: vue } }, vue };
}

export function supprimerVue(d: DonneesTaches, id: string, ctx: Contexte): DonneesTaches {
  const v = d.vues[id];
  if (!vivant(v)) return d;
  return { ...d, vues: { ...d.vues, [id]: changerChamps(v, { supprime: true }, ctx) } };
}

export function changerReglages(d: DonneesTaches, c: Partial<Omit<Reglages, 'id' | 'h'>>, ctx: Contexte): DonneesTaches {
  return { ...d, reglages: changerChamps(d.reglages, c, ctx) };
}

// ------------------------------------------------------------------ Liens dans la description

const MOTIF_LIEN = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

/** Découpe un texte en morceaux et liens (http/https seulement). */
export function decouperLiens(t: string): Array<{ texte: string; lien?: string }> {
  const r: Array<{ texte: string; lien?: string }> = [];
  let dernier = 0;
  for (const m of t.matchAll(MOTIF_LIEN)) {
    const debut = m.index ?? 0;
    if (debut > dernier) r.push({ texte: t.slice(dernier, debut) });
    const lien = m[0].replace(/[.,;:!?]+$/, '');
    r.push({ texte: lien, lien });
    dernier = debut + lien.length;
  }
  if (dernier < t.length) r.push({ texte: t.slice(dernier) });
  return r;
}
