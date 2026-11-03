/**
 * Client du centre de notifications (migration 0038), par l'appel générique du client Esport. Types miroirs de
 * l'API (esport/noyau/notifications/). Voir docs/esport/notifications.md.
 *
 * Temps réel : `signalerNotifications()` (ou `signalerNotifications(n)` avec le nouveau compteur) prévient la
 * cloche et la page ouverte qu'il y a du nouveau ; le module temps réel l'appelle quand le serveur annonce une
 * notification pour le compte connecté. Sans lui, la cloche relit le compteur toutes les minutes et au retour
 * sur l'onglet.
 */

import { requeteUrl, type ClientEsport } from '../client';

export const CATEGORIES_NOTIFICATIONS = ['planning', 'competition', 'resultats', 'cm', 'drive', 'sponsors', 'membres', 'discord', 'reunions', 'objectifs', 'jeu', 'devblog', 'systeme'] as const;
export type CategorieNotification = (typeof CATEGORIES_NOTIFICATIONS)[number];

/** Où mène une notification (écran de l'app Esport). */
export type LienNotification =
  | { vue: 'team'; section: string }
  | { vue: 'cm'; onglet: string }
  | { vue: 'membres'; sous: 'trombi' | 'tous' | 'roles' }
  | { vue: 'devblog' }
  | { vue: 'jeux' };

export interface NotificationCentre {
  id: string;
  /** `fil` : élément visible selon le rôle ; `perso` : notification adressée au compte. */
  source: 'fil' | 'perso';
  /** Type de la notification (événement du bus pour le fil, type personnel sinon). */
  type: string;
  /** Événement d'origine (`event.created`…), ou null. */
  evenement: string | null;
  categorie: CategorieNotification;
  team: { id: string; nom: string | null } | null;
  acteur: string | null;
  entite: { type: string; id: string | null } | null;
  lien: LienNotification | null;
  charge: Record<string, unknown>;
  lue: boolean;
  date: string;
}

export interface PageNotifications {
  liste: NotificationCentre[];
  noms: Record<string, string | null>;
  suite: string | null;
  nonLues: number;
  categories: CategorieNotification[];
  teams: Array<{ id: string; nom: string }>;
}

export interface FiltresNotifications {
  categories?: CategorieNotification[];
  team?: string;
  auteur?: string;
  du?: string;
  au?: string;
  nonLues?: boolean;
  ordre?: 'desc' | 'asc';
  suite?: string;
  limite?: number;
}

export interface PreferencesNotifications {
  masquees: CategorieNotification[];
  silencieuses: CategorieNotification[];
  teams: string[];
  categories: CategorieNotification[];
}

export function apiNotifications(client: ClientEsport) {
  const r = <T>(chemin: string, methode = 'GET', corps?: unknown) => client.requete<T>(chemin, methode, corps);
  return {
    liste: (f: FiltresNotifications = {}) =>
      r<PageNotifications>(
        `/notifications/centre${requeteUrl({
          categories: f.categories?.length ? f.categories.join(',') : undefined,
          team: f.team,
          auteur: f.auteur,
          du: f.du,
          au: f.au,
          nonLues: f.nonLues ? 1 : undefined,
          ordre: f.ordre === 'asc' ? 'asc' : undefined,
          suite: f.suite,
          limite: f.limite,
        })}`,
      ),
    compteur: () => r<{ nonLues: number }>('/notifications/compteur'),
    marquerLues: (ids: string[]) => r<{ nonLues: number }>('/notifications/centre/lues', 'POST', { ids }),
    toutMarquerLu: () => r<{ nonLues: number }>('/notifications/centre/lues', 'POST', { tout: true }),
    preferences: () => r<PreferencesNotifications>('/notifications/preferences'),
    changerPreferences: (p: Partial<Pick<PreferencesNotifications, 'masquees' | 'silencieuses' | 'teams'>>) => r<PreferencesNotifications>('/notifications/preferences', 'PUT', p),
  };
}

// ------------------------------------------------------------------ Signal « du nouveau » (temps réel)

type Ecouteur = (nonLues?: number) => void;
const ecouteurs = new Set<Ecouteur>();

/** Abonnement au signal « nouvelles notifications » (rend la fonction de désabonnement). */
export function surNotifications(fn: Ecouteur): () => void {
  ecouteurs.add(fn);
  return () => {
    ecouteurs.delete(fn);
  };
}

/** Il y a du nouveau (annonce du serveur, lecture ailleurs) : la cloche et la page se relisent. */
export function signalerNotifications(nonLues?: number): void {
  for (const fn of [...ecouteurs]) fn(nonLues);
}
