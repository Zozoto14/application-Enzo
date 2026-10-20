/**
 * Client du planning, des disponibilités et de la présence (phase 2), par
 * l'appel générique du client Esport (`client.requete`). Types miroirs de
 * l'API (esport/noyau/planning/service.mjs).
 *
 * Les heures sont envoyées en heure murale (date + HH:MM + fuseau) : c'est le
 * serveur qui convertit en UTC (changement d'heure compris) et qui rend, pour
 * chaque occurrence, sa date et ses heures locales dans le fuseau demandé.
 */

import type { ClientEsport } from '../client';

export type TypeEvenement = 'scrim' | 'match' | 'training' | 'meeting' | 'tournament' | 'other';
export type Rsvp = 'oui' | 'non' | 'peut_etre' | 'sans_reponse';
export type Reel = 'present' | 'absent' | 'excuse' | 'retard' | 'inconnu';

/**
 * Convocation d'un événement : une RÈGLE (groupes résolus à la lecture) plus
 * des choix nominatifs. Les Propriétaires ne sont convoqués que cochés.
 */
export type GroupeConvocation = 'joueurs' | 'staff' | 'tous';
export interface Convocation {
  groupes: GroupeConvocation[];
  membres: string[];
  exclus: string[];
  proprietaires: string[];
}
/** Membre convocable (formulaire) et son groupe. */
export interface MembreConvocable {
  compte: string;
  pseudo: string;
  groupe: 'joueurs' | 'staff' | 'proprietaire' | 'autres';
}

export interface DroitsPlanning {
  creer: boolean;
  modifier: boolean;
  supprimer: boolean;
  rsvp: boolean;
  marquer: boolean;
  voirPresences: boolean;
  voirDispos: boolean;
  saisirDispos: boolean;
  reglages: boolean;
}

export interface Occurrence {
  evenementId: string;
  /** Instant UTC (ISO) du début d'origine : identifie l'occurrence dans sa série. */
  cle: string;
  type: TypeEvenement;
  titre: string;
  description: string;
  lieu: string;
  debut: string;
  fin: string;
  /** Date et heures dans le fuseau demandé. */
  jour: string;
  heureDebut: string;
  jourFin: string;
  heureFin: string;
  recurrent: boolean;
  modifiee: boolean;
  adversaireId: string | null;
  reviewId: string | null;
  /** Convocation de cette occurrence (la sienne si `convocationPropre`, sinon celle de la série). */
  convocation?: Convocation;
  convocationPropre?: boolean;
  /** Comptes convoqués à cette occurrence (`concernes` : même liste, ancien nom). */
  convoques?: string[];
  concernes: string[];
  convoqueMoi?: boolean;
  concerneMoi?: boolean;
  monRsvp?: Rsvp | null;
  maPresence?: Reel | null;
  reponses?: { oui: number; non: number; peut_etre: number; attendues?: number } | null;
  termine?: boolean;
}

export interface ListePlanning {
  fuseau: string;
  fuseauTeam: string;
  du: string;
  au: string;
  occurrences: Occurrence[];
  droits: DroitsPlanning;
  modules: { presence: boolean; dispos: boolean };
  /** Staff (création, modification) : membres convocables et leur groupe. */
  membres?: MembreConvocable[] | null;
}

export interface Recurrence {
  freq: 'hebdo';
  intervalle: number;
  jours: number[];
  jusqua: string | null;
  nombre: number | null;
}

export interface DetailEvenement {
  id: string;
  type: TypeEvenement;
  titre: string;
  description: string;
  lieu: string;
  debut: string;
  fin: string;
  fuseau: string;
  date: string;
  heureDebut: string;
  heureFin: string;
  recurrence: Recurrence | null;
  adversaireId: string | null;
  reviewId: string | null;
  convocation?: Convocation;
  concernes: string[];
  exceptions: Array<{ occurrence: string; annulee: boolean; titre: string | null; debut: string | null; fin: string | null; convocation?: Convocation | null }>;
  droits: DroitsPlanning;
}

export interface SaisieEvenement {
  type: TypeEvenement;
  titre: string;
  description?: string;
  lieu?: string;
  date: string;
  heureDebut: string;
  heureFin: string;
  fuseau?: string;
  recurrence?: Partial<Recurrence> | null;
  /** Convoqués (aucun choix : les joueurs ; `null` pour une date : reprendre la liste de la série). */
  convocation?: Convocation | null;
  concernes?: string[];
  adversaireId?: string | null;
}

export type Alerte = Occurrence & { genre: 'rsvp' | 'a-marquer' | 'sans-reponse'; nonMarques?: number; sansReponse?: number };

export interface AccueilPlanning {
  fuseau: string;
  prochains: Occurrence[];
  alertes: Alerte[];
  droits: DroitsPlanning;
  modules: { presence: boolean };
}

export interface LignePresence {
  compte: string;
  pseudo: string;
  rsvp: Rsvp;
  reel: Reel;
  note: string;
  marqueLe: string | null;
}

export interface PresenceOccurrence {
  occurrence: Occurrence;
  lignes: LignePresence[];
  droits: DroitsPlanning;
}

export interface CompteurPresence {
  evenements: number;
  marques: number;
  present: number;
  retard: number;
  absent: number;
  excuse: number;
  rsvpOui: number;
  rsvpRepondus: number;
  taux: number | null;
  ponctualite: number | null;
  tauxReponse: number | null;
}

export interface StatsPresence {
  debut: string;
  fin: string;
  fuseau: string;
  tout: boolean;
  noms: Record<string, string | null>;
  global: CompteurPresence;
  joueurs: Array<CompteurPresence & { compte: string }>;
  parType: Array<CompteurPresence & { type: TypeEvenement }>;
  parPeriode: Array<CompteurPresence & { periode: string }>;
}

export interface RegleDispo {
  id?: string;
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
  type: 'disponible' | 'indisponible';
  note: string;
  jour: string;
  heureDebut: string;
  jourFin: string;
  heureFin: string;
}

export interface MesDispos {
  fuseau: string;
  fuseauTeam: string;
  regles: RegleDispo[];
  exceptions: ExceptionDispo[];
  droits: DroitsPlanning;
}

export interface CelluleCarte {
  debut: string;
  fin: string;
  n: number;
  comptes: string[];
  atteint: boolean;
}

export interface CarteDispos {
  fuseau: string;
  fuseauTeam: string;
  pas: number;
  seuil: number;
  total: number;
  renseignes: number;
  noms: Record<string, string>;
  jours: string[];
  creneaux: string[];
  cellules: Array<Array<CelluleCarte | null>>;
  plages: Array<{ jour: string; debut: string; fin: string; n: number; heureDebut: string; heureFin: string }>;
  droits: DroitsPlanning;
}

export interface ReglagesPlanning {
  effectifMin: number;
  rappelHeures: number;
  fuseau: string;
  droits: DroitsPlanning;
}

export interface AbonnementIcal {
  id: string;
  libelle: string;
  creeLe: string;
  dernierAcces: string | null;
  revoque: boolean;
}

export interface Fichier {
  nom: string;
  type: string;
  contenu: string;
}

const q = (params: Record<string, string | number | undefined | null>): string => {
  const p = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return p ? `?${p}` : '';
};

export function apiPlanning(client: ClientEsport, teamId: string) {
  const t = `/teams/${encodeURIComponent(teamId)}`;
  const o = (evenementId: string, cle: string) => `${t}/planning/${encodeURIComponent(evenementId)}/occurrences/${encodeURIComponent(cle)}`;
  return {
    liste: (p: { debut: string; fin: string; fuseau?: string; types?: string[]; membre?: string }) =>
      client.requete<ListePlanning>(`${t}/planning${q({ debut: p.debut, fin: p.fin, fuseau: p.fuseau, types: p.types?.join(','), membre: p.membre })}`),
    detail: (id: string) => client.requete<DetailEvenement>(`${t}/planning/${encodeURIComponent(id)}`),
    creer: (s: SaisieEvenement) => client.requete<DetailEvenement>(`${t}/planning`, 'POST', s),
    modifier: (id: string, s: Partial<SaisieEvenement>) => client.requete<DetailEvenement>(`${t}/planning/${encodeURIComponent(id)}`, 'PATCH', s),
    modifierOccurrence: (id: string, cle: string, s: Partial<SaisieEvenement>) => client.requete<DetailEvenement>(o(id, cle), 'PATCH', s),
    supprimer: (id: string, portee: 'serie' | 'occurrence' | 'suivantes' = 'serie', cle?: string) =>
      client.requete<{ ok: true }>(`${t}/planning/${encodeURIComponent(id)}${q({ portee, occurrence: cle })}`, 'DELETE'),
    accueil: (fuseau?: string) => client.requete<AccueilPlanning>(`${t}/planning/accueil${q({ fuseau })}`),
    reglages: () => client.requete<ReglagesPlanning>(`${t}/planning/reglages`),
    changerReglages: (r: { effectifMin?: number; rappelHeures?: number }) => client.requete<ReglagesPlanning>(`${t}/planning/reglages`, 'PUT', r),
    repondre: (id: string, cle: string, rsvp: Rsvp) => client.requete<{ ok: true; rsvp: Rsvp }>(`${o(id, cle)}/rsvp`, 'PUT', { rsvp }),
    presence: (id: string, cle: string) => client.requete<PresenceOccurrence>(`${o(id, cle)}/presence`),
    marquer: (id: string, cle: string, marques: Array<{ compte: string; reel: Reel; note?: string }>) => client.requete<PresenceOccurrence>(`${o(id, cle)}/presence`, 'PUT', { marques }),
    stats: (p: { debut: string; fin: string; types?: string[]; granularite?: 'mois' | 'semaine'; fuseau?: string }) =>
      client.requete<StatsPresence>(`${t}/presence/stats${q({ debut: p.debut, fin: p.fin, types: p.types?.join(','), granularite: p.granularite, fuseau: p.fuseau })}`),
    exportCsv: (p: { debut: string; fin: string }) => client.requete<Fichier>(`${t}/presence/export.csv${q({ ...p, format: 'json' })}`),
    exportIcs: () => client.requete<Fichier>(`${t}/planning/export.ics?format=json`),
    abonnements: async () => (await client.requete<{ abonnements: AbonnementIcal[] }>(`${t}/planning/ical`)).abonnements,
    creerAbonnement: (libelle: string) => client.requete<{ jeton: string; chemin: string; abonnement: AbonnementIcal }>(`${t}/planning/ical`, 'POST', { libelle }),
    revoquerAbonnement: (id: string) => client.requete<{ ok: true }>(`${t}/planning/ical/${encodeURIComponent(id)}`, 'DELETE'),
    mesDispos: (fuseau?: string) => client.requete<MesDispos>(`${t}/dispos/moi${q({ fuseau })}`),
    remplacerRegles: (regles: RegleDispo[], fuseau: string) => client.requete<MesDispos>(`${t}/dispos/moi/regles`, 'PUT', { regles, fuseau }),
    ajouterException: (x: { date: string; heureDebut: string; heureFin: string; fuseau: string; type: 'disponible' | 'indisponible'; note?: string }) =>
      client.requete<MesDispos>(`${t}/dispos/moi/exceptions`, 'POST', x),
    supprimerException: (id: string) => client.requete<MesDispos>(`${t}/dispos/moi/exceptions/${encodeURIComponent(id)}`, 'DELETE'),
    /** Adversaires du scouting (sélecteur du formulaire) ; vide si le scouting n'est pas accessible. */
    adversaires: async () => (await client.requete<{ adversaires?: Array<{ id: string; nom: string }> }>(`${t}/scouting/adversaires`)).adversaires ?? [],
    carte: (p: { semaine: string; fuseau?: string; pas?: 30 | 60 }) => client.requete<CarteDispos>(`${t}/dispos/carte${q(p)}`),
  };
}

export type ApiPlanning = ReturnType<typeof apiPlanning>;
