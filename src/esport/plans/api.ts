/**
 * Client du module Plan de match (esport/noyau/plans/, migration 0083), par l'appel générique du client Esport.
 * Types miroirs de l'API. Contenu TACTIQUE : aucun de ces champs ne passe par l'assistant d'écriture.
 */

import { requeteUrl, type ClientEsport } from '../client';
import type { Reference } from '../lineups/api';
import type { Personne } from '../strats/api';
import type { ModeleStrat } from '../strats/modeles';

export type StatutPlan = 'brouillon' | 'pret' | 'joue';
export const STATUTS_PLAN: readonly StatutPlan[] = ['brouillon', 'pret', 'joue'];
export type FormatPlan = '' | 'bo1' | 'bo3' | 'bo5';
export const FORMATS_PLAN: readonly FormatPlan[] = ['', 'bo1', 'bo3', 'bo5'];
export type ActionVeto = 'ban' | 'pick' | 'decider';
export const ACTIONS_VETO: readonly ActionVeto[] = ['ban', 'pick', 'decider'];
export type CampVeto = 'nous' | 'eux';
export type TypeRound = 'pistol' | 'eco' | 'force' | 'bonus' | 'defaut' | 'execution' | 'retake' | 'autre';
export const TYPES_ROUND: readonly TypeRound[] = ['pistol', 'eco', 'force', 'bonus', 'defaut', 'execution', 'retake', 'autre'];

/** Étape du veto : qui (nous, eux), quoi (ban, pick, decider), la map visée et les replis si elle n'est plus libre. */
export interface EtapeVeto {
  id: string;
  action: ActionVeto;
  camp: CampVeto;
  carte: Reference | null;
  replis: Reference[];
  note: string;
}
/** Ligne de composition : un membre de la team (ou un nom libre), son personnage et son rôle. */
export interface LigneCompo {
  id: string;
  /** Identifiant du compte du membre ; null : nom libre (remplaçant, stand-in). */
  membre: string | null;
  /** Lecture : pseudo actuel du membre. */
  pseudo?: string | null;
  /** Lecture : c'est le lecteur. */
  moi?: boolean;
  nom: string;
  personnage: Reference | null;
  /** IGL, entry, lurk, support… (texte court). */
  role: string;
  /** The Finals : arme, spécialisation, trois gadgets, réserve. */
  arme: string;
  specialisation: string;
  gadgets: string[];
  reserve: string[];
  note: string;
}
/** Strat prévue : une strat de la team, une entrée du playbook, ou un simple titre. */
export interface StratPlan {
  id: string;
  /** « attaque », « defense », clé d'un mode du jeu, ou vide. */
  side: string;
  type: TypeRound;
  strat: string | null;
  playbook: string | null;
  titre: string;
  note: string;
  /** Lecture : le lecteur peut ouvrir la strat (elle existe encore et il la voit). */
  ouvrable?: boolean;
}
/** Lineup clé d'une map (lecture). */
export interface LineupPlan {
  id: string;
  titre: string;
  personnage: string | null;
  capacite: string | null;
  zone: string | null;
  ouvrable: boolean;
}
export interface CartePlan<L = LineupPlan> {
  id: string;
  carte: Reference;
  /** The Finals : mode attendu sur cette arène (clé du modèle ou texte). */
  mode: string;
  compo: LigneCompo[];
  strats: StratPlan[];
  lineups: L[];
  conditions: string;
  tendances: string;
  calls: string;
  notes: string;
}
export interface ElementChecklist {
  id: string;
  texte: string;
}
export interface ContenuPlan<L = LineupPlan> {
  veto: EtapeVeto[];
  cartes: Array<CartePlan<L>>;
  checklist: ElementChecklist[];
  notes: string;
}
/** Contenu envoyé au serveur : les lineups par leur identifiant. */
export type SaisieContenu = ContenuPlan<string>;

export interface EvenementLie {
  id: string;
  occurrence: string;
  titre: string;
  type: string;
  debut: string;
  /** Heure de début dans le fuseau de la team (HH:MM). */
  heure: string;
}
export interface ResumePlan {
  id: string;
  titre: string;
  statut: StatutPlan;
  estModele: boolean;
  /** Jour du match (AAAA-MM-JJ), ou null. */
  dateMatch: string | null;
  /** Début de l'événement lié (instant ISO), ou null. */
  debut: string | null;
  adversaire: { id: string | null; nom: string } | null;
  format: FormatPlan;
  /** Noms des maps prévues, dans l'ordre. */
  cartes: string[];
  evenement: EvenementLie | null;
  checklist: { faits: number; total: number };
  creePar: Personne;
  majLe: string;
}
export interface TendanceScouting {
  map: string;
  side: 'attaque' | 'defense' | 'les_deux';
  notes: string;
  tauxVictoire: number | null;
}
export interface Plan extends ResumePlan {
  jeu: string;
  modele: ModeleStrat;
  contenu: ContenuPlan;
  /** Éléments cochés de la checklist. */
  coches: string[];
  tournoiMatch: { id: string; tournoi: string; tour: string } | null;
  resultat: { id: string; date: string; issue: 'victoire' | 'defaite' | 'nul' | null; score: string } | null;
  debrief: { id: string; debut: string } | null;
  /** Fiche de scouting de l'adversaire (lecture seule) ; null sans fiche ou sans le droit de la voir. */
  scouting: { nom: string; notes: string; tendances: TendanceScouting[] } | null;
  pretLe: string | null;
  moi: { editer: boolean; debrief: boolean };
}
export interface ListePlans {
  plans: ResumePlan[];
  modeles: ResumePlan[];
  droits: { editer: boolean };
}
export interface PlanCorbeille {
  id: string;
  titre: string;
  supprimeLe: string;
  supprimePar: Personne | null;
}

/** Ce qu'un plan peut lier (chargé à l'ouverture de l'éditeur) : chaque liste selon les droits du lecteur. */
export interface LiensPlan {
  evenements: Array<{ id: string; occurrence: string; titre: string; type: string; debut: string; jour: string; heure: string; adversaireId: string | null }>;
  adversaires: Array<{ id: string; nom: string }>;
  matchs: Array<{ id: string; tournoi: string; tour: string; debut: string | null; evenementId: string | null }>;
  resultats: Array<{ id: string; date: string; adversaire: string; issue: 'victoire' | 'defaite' | 'nul' | null; score: string; evenementId: string | null }>;
  membres: Array<{ compte: string; pseudo: string }>;
  strats: Array<{ id: string; titre: string; carte: string; side: string }>;
  playbook: Array<{ id: string; titre: string; carte: string | null; side: string | null }>;
  lineups: Array<{ id: string; titre: string; carte: string; personnage: string | null; capacite: string | null }>;
}

export interface SaisiePlan {
  titre?: string;
  statut?: StatutPlan;
  /** AAAA-MM-JJ (ignoré quand un événement est lié : sa date fait foi). */
  date?: string | null;
  format?: FormatPlan;
  evenementId?: string | null;
  occurrence?: string | null;
  adversaireId?: string | null;
  adversaireNom?: string;
  tournoiMatchId?: string | null;
  resultatId?: string | null;
  contenu?: SaisieContenu;
  /** Création : plan ou modèle à recopier. */
  depuis?: string;
}

export interface FiltresPlans {
  statut?: StatutPlan;
  adversaire?: string;
  carte?: string;
}

const B = (teamId: string) => `/teams/${teamId}/plans`;

export function apiPlans(client: ClientEsport) {
  const appel = <T>(chemin: string, options?: { methode?: string; corps?: unknown }) => client.requete<T>(chemin, options?.methode, options?.corps);
  return {
    liste: (teamId: string) => appel<ListePlans>(B(teamId)),
    /** Plan d'un événement du planning (une occurrence) ; null : pas encore de plan. */
    pourEvenement: (teamId: string, evenementId: string, occurrence: string) => appel<{ plan: ResumePlan | null; droits: { editer: boolean } }>(`${B(teamId)}/evenement${requeteUrl({ evenement: evenementId, occurrence })}`),
    /** Prochain plan lié à un événement à venir (carte de l'accueil de la team). */
    prochain: (teamId: string) => appel<{ plan: ResumePlan | null }>(`${B(teamId)}/prochain`),
    liens: (teamId: string) => appel<LiensPlan>(`${B(teamId)}/liens`),
    detail: async (teamId: string, id: string) => (await appel<{ plan: Plan }>(`${B(teamId)}/${id}`)).plan,
    creer: async (teamId: string, corps: SaisiePlan) => (await appel<{ plan: Plan }>(B(teamId), { methode: 'POST', corps })).plan,
    modifier: async (teamId: string, id: string, corps: SaisiePlan) => (await appel<{ plan: Plan }>(`${B(teamId)}/${id}`, { methode: 'PATCH', corps })).plan,
    cocher: async (teamId: string, id: string, coches: string[]) => (await appel<{ plan: Plan }>(`${B(teamId)}/${id}/coches`, { methode: 'PUT', corps: { coches } })).plan,
    dupliquer: async (teamId: string, id: string, corps: { modele?: boolean; titre?: string }) => (await appel<{ plan: Plan }>(`${B(teamId)}/${id}/dupliquer`, { methode: 'POST', corps })).plan,
    debrief: async (teamId: string, id: string, corps: { date: string; heureDebut: string; heureFin: string }) => (await appel<{ plan: Plan }>(`${B(teamId)}/${id}/debrief`, { methode: 'POST', corps })).plan,
    supprimer: (teamId: string, id: string) => appel<{ ok: true }>(`${B(teamId)}/${id}`, { methode: 'DELETE' }),
    corbeille: async (teamId: string) => (await appel<{ plans: PlanCorbeille[] }>(`${B(teamId)}/corbeille`)).plans,
    restaurer: async (teamId: string, id: string) => (await appel<{ plan: Plan }>(`${B(teamId)}/${id}/restaurer`, { methode: 'POST' })).plan,
  };
}
export type ApiPlans = ReturnType<typeof apiPlans>;
