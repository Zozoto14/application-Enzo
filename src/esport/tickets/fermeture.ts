/**
 * Fermeture automatique des tickets (migration 0055, docs/esport/tickets.md) : réglage d'une catégorie en jours dans
 * l'app, gardé en heures par le serveur (`fermetureAutoH` : null = délai général, 0 = jamais, N heures). Pur, testé.
 */

import { trTk } from '../i18n/tickets';

export type ModeFermeture = 'general' | 'delai' | 'jamais';

/** Heures au plus (90 jours : limite du serveur). */
export const HEURES_MAX = 2160;

export const modeFermeture = (h: number | null | undefined): ModeFermeture => (h === null || h === undefined ? 'general' : h === 0 ? 'jamais' : 'delai');

/** Heures -> jours affichés (deux décimales au plus : 36 h -> « 1.5 »). */
export const joursDeHeures = (h: number): string => String(Math.round((h / 24) * 100) / 100);

/** Jours saisis (virgule ou point) -> heures, ou undefined hors de 1 h à 90 jours. */
export function heuresDeJours(saisie: string): number | undefined {
  const j = Number(saisie.trim().replace(',', '.'));
  if (!saisie.trim() || !Number.isFinite(j)) return undefined;
  const h = Math.round(j * 24);
  return h >= 1 && h <= HEURES_MAX ? h : undefined;
}

/** Délai lisible : « 7 j », « 36 h ». */
export const texteDelai = (h: number): string => (h % 24 === 0 ? trTk('duree.j', { n: h / 24 }) : trTk('duree.h', { n: h }));

/** Valeur envoyée au serveur pour un mode et une saisie en jours (undefined : saisie invalide). */
export function heuresPourMode(mode: ModeFermeture, jours: string): number | null | undefined {
  if (mode === 'general') return null;
  if (mode === 'jamais') return 0;
  return heuresDeJours(jours);
}
