/**
 * Position de lecture DANS l'épisode (ou le film) en cours, par titre :
 * rangée dans la base du profil (`tsuzuku.positions`) et synchronisée avec le
 * coffre serveur du compte (une entrée par titre ; la plus récente gagne).
 * On reprend ainsi un épisode là où on l'avait laissé, sur un autre appareil
 * aussi.
 *
 * Seulement pour une vidéo directe (mp4, m3u8…) : le lecteur intégré d'un
 * autre site (iframe) ne dit pas où il en est. Enregistrée au plus toutes les
 * 30 s pendant la lecture, et en quittant le lecteur ; effacée quand
 * l'épisode est fini (moins de 30 s avant la fin).
 */

import { CLES } from '../plateforme/stockage';
import type { ServicesTsuzuku } from './services';

export interface PositionLecture {
  /** Épisode (1 pour un film). */
  ep: number;
  /** Secondes depuis le début. */
  s: number;
  /** Date de l'enregistrement (ms). */
  a: number;
}

export const POSITIONS_MAX = 300;
/** En deçà, rien à reprendre ; à moins de ceci de la fin, l'épisode est fini. */
export const SECONDES_MIN = 5;
export const MARGE_FIN_S = 30;
export const INTERVALLE_ENREGISTREMENT_MS = 30_000;

export function positionValide(v: unknown): PositionLecture | undefined {
  const p = v as Partial<PositionLecture> | null;
  if (!p || typeof p !== 'object') return undefined;
  const ep = Number(p.ep);
  const s = Number(p.s);
  const a = Number(p.a);
  if (!Number.isInteger(ep) || ep < 1 || ep > 100_000 || !Number.isFinite(s) || s < 0 || s > 86_400 || !Number.isFinite(a) || a < 0) return undefined;
  return { ep, s: Math.round(s), a };
}

export function lirePositions(texte: string | null | undefined): Record<string, PositionLecture> {
  try {
    const o = texte ? (JSON.parse(texte) as unknown) : {};
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const sortie: Record<string, PositionLecture> = {};
    for (const [cle, v] of Object.entries(o as Record<string, unknown>)) {
      const p = positionValide(v);
      if (p && cle.length <= 120) sortie[cle] = p;
    }
    return sortie;
  } catch {
    return {};
  }
}

/** Les plus récentes d'abord gardées, au plus `POSITIONS_MAX`. */
export function bornerPositions(toutes: Record<string, PositionLecture>): Record<string, PositionLecture> {
  return Object.fromEntries(
    Object.entries(toutes)
      .sort((x, y) => y[1].a - x[1].a)
      .slice(0, POSITIONS_MAX),
  );
}

type Acces = Pick<ServicesTsuzuku, 'stockage'>;

/** Position où reprendre ce titre à cet épisode, s'il y en a une. */
export async function positionReprise(s: Acces, cle: string, ep: number): Promise<number | undefined> {
  try {
    const p = lirePositions(await s.stockage.lire(CLES.positions))[cle];
    return p && p.ep === ep && p.s > SECONDES_MIN ? p.s : undefined;
  } catch {
    return undefined;
  }
}

/** Retient la position (ou l'efface : épisode fini). `duree` : durée de la vidéo si connue. Jamais d'erreur. */
export async function enregistrerPosition(s: Acces, cle: string, ep: number, secondes: number, duree?: number, maintenant = Date.now()): Promise<void> {
  try {
    const toutes = lirePositions(await s.stockage.lire(CLES.positions));
    const finie = duree !== undefined && Number.isFinite(duree) && duree > 0 && secondes >= duree - MARGE_FIN_S;
    if (finie || secondes <= SECONDES_MIN) {
      if (!(cle in toutes) || toutes[cle].ep !== ep) return;
      delete toutes[cle];
    } else {
      const avant = toutes[cle];
      if (avant && avant.ep === ep && Math.abs(avant.s - secondes) < 1) return;
      toutes[cle] = { ep, s: Math.round(secondes), a: maintenant };
    }
    await s.stockage.ecrire(CLES.positions, JSON.stringify(bornerPositions(toutes)));
  } catch {
    // Facultatif : la lecture continue.
  }
}
