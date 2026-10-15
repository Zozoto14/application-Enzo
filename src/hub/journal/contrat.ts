/**
 * Contrat « source d'événements du journal ».
 *
 * Le Journal automatique (`src/journal/`) écrit chaque soir une page à partir de
 * ce qui s'est passé dans les apps du hub. Il ne connaît aucune app : chacune
 * remplit côté hôte une `SourceJournal` (son dossier, `sourceJournal.ts`) qui
 * lit SES données locales, déjà synchronisées, et rend des `EvenementJournal`
 * d'un jour donné. Le journal n'écrit jamais sur le relais : une source ne fait
 * que lire.
 *
 * Ajouter une source = écrire une `SourceJournal` et l'ajouter à
 * `src/journal/sources.ts`. Une app qui n'a pas de source (ou une app qui
 * n'existe pas encore, comme le coach de décisions ou la météo) peut quand même
 * apparaître dans le journal en déposant ses événements dans la boîte du
 * journal (`boite.ts`).
 *
 * Confidentialité : une source ne rend QUE ce que le profil ouvert a le droit
 * de voir dans l'app concernée (un ami n'obtient jamais les prospects ni les
 * abonnements du Fondateur). Aucune dépendance au portefeuille ni aux apps.
 */

import type { ContexteHub } from '../types';

/** Famille d'un événement : une par app (ou une boîte « autre »). Fixe l'icône et la section du texte. */
export type FamilleEvenement = 'taches' | 'office' | 'tsuzuku' | 'portefeuille' | 'abonnements' | 'prospects' | 'decisions' | 'meteo' | 'autre';

export const FAMILLES: readonly FamilleEvenement[] = ['taches', 'office', 'tsuzuku', 'portefeuille', 'abonnements', 'prospects', 'decisions', 'meteo', 'autre'];

export type GenreEvenement =
  | 'tache-terminee'
  | 'tache-creee'
  | 'session-office'
  | 'episode-vu'
  | 'operation-bourse'
  | 'variation-portefeuille'
  | 'paiement-abonnement'
  | 'relance-prospect'
  | 'decision'
  | 'meteo'
  | 'autre';

export const GENRES: readonly GenreEvenement[] = [
  'tache-terminee',
  'tache-creee',
  'session-office',
  'episode-vu',
  'operation-bourse',
  'variation-portefeuille',
  'paiement-abonnement',
  'relance-prospect',
  'decision',
  'meteo',
  'autre',
];

/** Ce qui s'est passé, en une ligne. Tout est facultatif sauf l'identité, le jour et le titre. */
export interface EvenementJournal {
  /** Stable pour un même fait (relu deux fois, il n'est compté qu'une fois). Unique dans sa source. */
  id: string;
  /** Identifiant de la source (`SourceJournal.id`). */
  source: string;
  famille: FamilleEvenement;
  genre: GenreEvenement;
  /** Jour civil local (AAAA-MM-JJ). */
  jour: string;
  /** Heure locale (HH:MM), si elle est connue. */
  heure?: string;
  /** Phrase courte, sans point final : « Relire le contrat Atelier Lune ». */
  titre: string;
  detail?: string;
  /** Projet, série, compte… : sert à regrouper (« 3 épisodes de … »). */
  groupe?: string;
  /** Numéro d'épisode, quantité de titres, durée en minutes (selon le genre). */
  nombre?: number;
  /** Montant en euros, signé (jamais masqué ici : le mode discret s'applique à l'affichage). */
  montant?: number;
  /** Variation en pourcentage, signée. */
  pourcentage?: number;
  /** Importance 0–100 : le plus élevé du jour devient le « fait marquant ». Défaut : voir `agregation.ts`. */
  poids?: number;
}

export interface SourceJournal {
  /** Identifiant stable de la source (≠ identifiant d'app obligatoire, mais le plus simple). */
  id: string;
  nom: string;
  famille: FamilleEvenement;
  /**
   * Événements du jour pour le profil ouvert. Peut être asynchrone (historique
   * de Claude Office). Peut lever : le journal note l'échec de cette source et
   * écrit quand même la page avec les autres.
   */
  lire(jour: string, contexte: ContexteHub): EvenementJournal[] | Promise<EvenementJournal[]>;
}

// ------------------------------------------------------------------ Portefeuille

/** Une opération du portefeuille, déjà lisible (l'hôte connaît ses titres). */
export interface OperationJournal {
  id: string;
  type: 'ACHAT' | 'VENTE' | 'DIVIDENDE' | 'VERSEMENT' | 'RETRAIT' | 'FRAIS';
  /** Nom du titre ou du compte. */
  libelle: string;
  /** Quantité de titres (achat, vente). */
  quantite?: number;
  /** Montant total en euros (positif). */
  montant?: number;
}

/**
 * Ce que l'hôte donne au journal sur le portefeuille (voir `ContexteHub.journalPortefeuille`) :
 * lu dans la base locale, jamais envoyé nulle part.
 */
export interface LecteurPortefeuilleJournal {
  operations(jour: string): OperationJournal[];
  /** Variation de la valeur du portefeuille ce jour-là (versements neutralisés), si l'historique la permet. */
  variation(jour: string): { pourcentage: number; montant?: number } | undefined;
}

// ------------------------------------------------------------------ Rédaction par IA (point d'extension)

/**
 * Point d'extension : un rédacteur qui remplace les modèles de phrases (IA
 * locale ou distante, plus tard). Désactivé par défaut (`journal.reglages`,
 * champ `ia`), jamais appelé sans que l'utilisateur l'ait activé, et il ne
 * reçoit que le résumé du jour déjà agrégé. S'il échoue ou ne répond pas à
 * temps, le journal retombe sur les modèles : aucune page n'est perdue.
 */
export interface RedacteurExterne {
  id: string;
  nom: string;
  /** Rend le texte des sections ; `undefined` : laisser les modèles faire. */
  rediger(resume: ResumeExterne): Promise<TexteExterne | undefined>;
}

/** Résumé transmis à un rédacteur externe : des faits, jamais de secret ni de montant brut non masquable. */
export interface ResumeExterne {
  jour: string;
  evenements: ReadonlyArray<Pick<EvenementJournal, 'famille' | 'genre' | 'heure' | 'titre' | 'groupe' | 'nombre' | 'pourcentage'>>;
}

export interface TexteExterne {
  intro: string;
  sections: ReadonlyArray<{ id: string; titre: string; paragraphes: readonly string[] }>;
  cloture?: string;
}
