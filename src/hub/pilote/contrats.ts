/**
 * Pilote automatique de semaine : CONTRATS du hub.
 *
 * Le hub définit ici ce qu'il sait planifier (tâches, événements à date fixe,
 * épisodes en récompense) et ce qu'il rend (une semaine rangée en jours et en
 * créneaux). Il ne connaît aucune app : chaque app remplit ces structures côté
 * hôte (`src/taches/pilote/hote.ts` lit Tâches, Prospects, Abonnements,
 * Portefeuille et Tsuzuku) et applique le résultat. Rien ici n'importe un
 * module d'app ; tout est pur et sérialisable (JSON).
 */

import { heureValide, minutesDe } from './jours';

export type PrioritePilote = 'urgente' | 'haute' | 'normale' | 'basse';
export const RANG_PRIORITE_PILOTE: Record<PrioritePilote, number> = { urgente: 0, haute: 1, normale: 2, basse: 3 };

// ------------------------------------------------------------------ Réglages

export interface CreneauTravail {
  debut: string;
  fin: string;
}

export interface ReglagesPilote {
  /** Proposition automatique (notification + écran « Ta semaine »). */
  actif: boolean;
  /** Jour de la proposition : 1 = lundi … 7 = dimanche. La semaine proposée est celle qui suit ce jour. */
  jour: number;
  /** Heure de la proposition (« HH:MM »). */
  heure: string;
  /** Créneaux de travail d'une journée (1 à 4, triés, sans chevauchement). */
  creneaux: CreneauTravail[];
  /** Charge maximale par jour, en minutes. */
  chargeMax: number;
  /** Jours sans travail (1 à 7). */
  joursOff: number[];
  /** Durée supposée d'une tâche sans estimation, en minutes. */
  dureeDefaut: number;
  /** Placer des épisodes Tsuzuku en récompense. */
  recompenses: boolean;
  /** Les épisodes se regardent à partir de cette heure. */
  soirDebut: string;
  /** Épisodes au plus par soirée. */
  episodesParJour: number;
  /** Ajouter le versement mensuel et les dividendes du Portefeuille. */
  portefeuille: boolean;
  /** Notification (système et pastille) à l'heure de la proposition. */
  notification: boolean;
}

export const FIN_SOIREE = '23:30';
export const BORNES_PILOTE = { chargeMin: 60, chargeMax: 720, dureeMin: 5, dureeMax: 240, creneaux: 4, episodes: 4 } as const;

export const REGLAGES_PILOTE_DEFAUT: ReglagesPilote = {
  actif: true,
  jour: 7,
  heure: '18:00',
  creneaux: [
    { debut: '09:00', fin: '12:00' },
    { debut: '14:00', fin: '18:00' },
  ],
  chargeMax: 360,
  joursOff: [6, 7],
  dureeDefaut: 30,
  recompenses: true,
  soirDebut: '20:00',
  episodesParJour: 2,
  portefeuille: true,
  notification: true,
};

const dict = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const entier = (v: unknown, defaut: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : defaut);

/** Créneaux valides : triés, bornés à la journée, sans chevauchement (les mauvais sont écartés). */
export function creneauxValides(brut: unknown): CreneauTravail[] {
  const liste = (Array.isArray(brut) ? brut : [])
    .map(dict)
    .filter(c => heureValide(c.debut) && heureValide(c.fin) && minutesDe(c.fin as string) - minutesDe(c.debut as string) >= 15)
    .map(c => ({ debut: c.debut as string, fin: c.fin as string }))
    .sort((a, b) => minutesDe(a.debut) - minutesDe(b.debut));
  const sortie: CreneauTravail[] = [];
  for (const c of liste) {
    const dernier = sortie[sortie.length - 1];
    if (dernier && minutesDe(c.debut) < minutesDe(dernier.fin)) continue;
    sortie.push(c);
  }
  return sortie.slice(0, BORNES_PILOTE.creneaux);
}

/** Lit des réglages non sûrs : tout ce qui manque ou est invalide prend la valeur par défaut. */
export function lireReglagesPilote(brut: unknown): ReglagesPilote {
  const o = dict(brut);
  const D = REGLAGES_PILOTE_DEFAUT;
  const lus = Array.isArray(o.creneaux) ? creneauxValides(o.creneaux) : [];
  const creneaux = lus.length ? lus : D.creneaux;
  const off = Array.isArray(o.joursOff) ? [...new Set((o.joursOff as unknown[]).filter((j): j is number => Number.isInteger(j) && (j as number) >= 1 && (j as number) <= 7))].sort() : D.joursOff;
  return {
    actif: o.actif !== false,
    jour: entier(o.jour, D.jour, 1, 7),
    heure: heureValide(o.heure) ? o.heure : D.heure,
    creneaux,
    chargeMax: entier(o.chargeMax, D.chargeMax, BORNES_PILOTE.chargeMin, BORNES_PILOTE.chargeMax),
    joursOff: off.length >= 7 ? D.joursOff : off,
    dureeDefaut: entier(o.dureeDefaut, D.dureeDefaut, BORNES_PILOTE.dureeMin, BORNES_PILOTE.dureeMax),
    recompenses: o.recompenses !== false,
    soirDebut: heureValide(o.soirDebut) ? o.soirDebut : D.soirDebut,
    episodesParJour: entier(o.episodesParJour, D.episodesParJour, 1, BORNES_PILOTE.episodes),
    portefeuille: o.portefeuille !== false,
    notification: o.notification !== false,
  };
}

// ------------------------------------------------------------------ Entrées (remplies par chaque app côté hôte)

/** Une tâche à placer (l'hôte n'envoie que celles de l'utilisateur, ouvertes, qu'il peut modifier). */
export interface TachePlanifiable {
  id: string;
  titre: string;
  priorite: PrioritePilote;
  /** Échéance d'origine (jour ; l'heure n'est pas une contrainte de placement). */
  echeance?: string;
  /** Jour avant lequel on ne commence pas. */
  debut?: string;
  /** Durée estimée, en minutes. */
  dureeMin?: number;
  /** Tâche récurrente : les autres jours de la semaine où elle revient (après `echeance`). */
  repetitions?: string[];
  /** Nom du projet (affichage). */
  projet?: string;
}

export type GenreEvenement = 'relance' | 'paiement' | 'versement' | 'dividende';

/** Un événement à date fixe d'une autre app (relance prospect, paiement, versement, dividende). */
export interface EvenementFixe {
  id: string;
  genre: GenreEvenement;
  titre: string;
  detail?: string;
  jour: string;
  /** Heure imposée (« HH:MM ») ; sans elle, l'événement se range dans les créneaux du jour. */
  heure?: string;
  dureeMin?: number;
  /** Date dépassée : l'événement est ramené au premier jour de travail. */
  retard?: boolean;
}

/** Un épisode à regarder en récompense (dans l'ordre où l'hôte veut qu'on les regarde). */
export interface EpisodeRecompense {
  id: string;
  animeId: string;
  titre: string;
  episode: number;
  dureeMin: number;
}

export interface EntreePilote {
  /** Lundi de la semaine à planifier. */
  debut: string;
  /** Jour courant : on ne place rien avant. */
  aujourdhui: string;
  reglages: ReglagesPilote;
  taches: readonly TachePlanifiable[];
  evenements: readonly EvenementFixe[];
  episodes: readonly EpisodeRecompense[];
}

// ------------------------------------------------------------------ Sortie

export type GenreElement = 'tache' | 'repetition' | GenreEvenement | 'episode';

export type RaisonNonPlace = 'charge' | 'jours-off' | 'retire';

export interface ElementSemaine {
  /** Identifiant stable : `<genre>:<id source>` (et `@jour` pour une répétition). */
  id: string;
  genre: GenreElement;
  /** Identifiant dans l'app source (tâche, prospect, épisode…). */
  refId: string;
  titre: string;
  detail?: string;
  /** Jour placé ; vide pour un élément non placé. */
  jour: string;
  /** Créneau (« HH:MM ») ; absent : journée entière, ou pas de place ce jour-là. */
  debut?: string;
  fin?: string;
  dureeMin: number;
  priorite?: PrioritePilote;
  /** Échéance d'origine de la tâche. */
  echeance?: string;
  /** Date d'origine dépassée (relance, paiement). */
  retard?: boolean;
  /** Heure imposée par la source : elle ne bouge pas dans la journée. */
  epingle?: boolean;
  /** Dépasse la charge max ou les créneaux du jour (après un déplacement). */
  surcharge?: boolean;
  /** Placé un jour sans travail. */
  jourOff?: boolean;
  /** Placé après l'échéance d'origine. */
  apresEcheance?: boolean;
  /** Durée plafonnée à la charge max / au plus long créneau. */
  plafonnee?: boolean;
  /** Rang dans la journée. */
  ordre: number;
  /** Anime (épisode) : pour regrouper. */
  animeId?: string;
  episode?: number;
  raison?: RaisonNonPlace;
}

export interface Semaine {
  /** Lundi. */
  debut: string;
  /** Instant de génération (ms). */
  genereLe: number;
  elements: ElementSemaine[];
  /** Éléments que l'algorithme n'a pas pu placer (charge, jours off) : à arbitrer. */
  nonPlaces: ElementSemaine[];
  /** Éléments retirés par l'utilisateur (on peut les remettre). */
  retires: ElementSemaine[];
}

export interface BilanJour {
  jour: string;
  /** Minutes de travail et d'événements placés (hors épisodes). */
  charge: number;
  /** Charge maximale du jour (0 un jour off). */
  capacite: number;
  off: boolean;
  depasse: boolean;
  episodes: number;
}
