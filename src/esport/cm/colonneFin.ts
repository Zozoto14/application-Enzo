/**
 * Colonnes de fin des tableaux CM (migration 0050) : une carte déposée dans une colonne de fin est terminée.
 * Pur, testé (CmColonneFin.test.tsx). Même détection de nom que le serveur (esport/noyau/cm/colonneFin.mjs).
 */

import type { CarteResume, ListeCm } from './api';

const SANS_ACCENT = (s: string | null | undefined): string => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

const MOTIF_FIN = /^(?:fini|finie|finis|finies|termine|terminee|termines|terminees|fait|faite|faits|faites|done|finished|complete|completed|publie|publiee|publies|publiees|published|livre|livree|archive)\b/;

/** Le nom d'une colonne ressemble-t-il à une colonne de fin (« Fini », « Terminé », « Fait », « Done », « Publié »…) ? */
export const nomColonneDeFin = (nom: string | null | undefined): boolean => MOTIF_FIN.test(SANS_ACCENT(nom));

/** Colonnes ouvertes dont le nom évoque une colonne de fin et que personne n'a encore marquées ni refusées. */
export function colonnesAProposer(listes: ListeCm[]): ListeCm[] {
  return listes.filter(l => !l.archive && !l.fin && !l.finIgnoree && nomColonneDeFin(l.nom));
}

/** Carte terminée ? (serveur ancien : jamais). */
export const estTerminee = (c: Pick<CarteResume, 'terminee'>): boolean => c.terminee === true;

/** Échéance dépassée et carte encore ouverte ? Une carte terminée n'est jamais en retard. */
export const enRetard = (c: Pick<CarteResume, 'echeance' | 'echeanceFaite' | 'terminee'>, maintenant: number): boolean =>
  Boolean(c.echeance) && !c.echeanceFaite && !c.terminee && Date.parse(c.echeance as string) < maintenant;
