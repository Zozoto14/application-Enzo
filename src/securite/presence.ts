/**
 * Présence : un lecteur (film, épisode) déclare qu'une lecture est en cours pour que
 * le verrouillage automatique demande « Êtes-vous toujours là ? » au lieu de verrouiller.
 * Module neutre : les apps (Tsuzuku) l'appellent sans dépendre du hub.
 */

import { createContext, useContext, useEffect } from 'react';

export interface Presence {
  /** Un lecteur déclare (true) qu'une lecture commence, puis (false) qu'elle s'arrête. Cumulatif. */
  declarerLecture(enCours: boolean): void;
}

const AUCUNE_PRESENCE: Presence = { declarerLecture: () => undefined };
export const ContextePresence = createContext<Presence>(AUCUNE_PRESENCE);

/** Hors `GardeInactivite` (tests d'un écran seul), les déclarations sont sans effet. */
export function utiliserPresence(): Presence {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- hook nommé en français (API demandée : utiliserPresence).
  return useContext(ContextePresence);
}

/** Déclare une lecture en cours tant que `enCours` est vrai (et jusqu'au démontage). */
export function utiliserLectureEnCours(enCours: boolean): void {
  const { declarerLecture } = utiliserPresence();
  // eslint-disable-next-line react-hooks/rules-of-hooks -- idem.
  useEffect(() => {
    if (!enCours) {
      return undefined;
    }
    declarerLecture(true);
    return () => declarerLecture(false);
  }, [enCours, declarerLecture]);
}

