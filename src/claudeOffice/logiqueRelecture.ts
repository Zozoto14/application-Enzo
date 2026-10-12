/**
 * Claude Office, onglet « Bureau » (v4) : « Relecture de la journée » — logique
 * pure (sans React), testée dans scene.test.tsx.
 *
 * On rejoue l'activité du jour en accéléré (×10, ×60) à partir de ce que le
 * bureau a déjà en mémoire (journal du PC ou copie chiffrée reçue) : à chaque
 * instant t, le bureau est RECONSTRUIT comme s'il était t (seuls les
 * événements d'avant t comptent, l'état est calculé à t). Rien n'est relu ni
 * écrit en plus.
 */

import { deduireBureau, type Bureau, type OptionsBureau } from './logiqueBureau';
import type { EntreeHistorique } from './logiqueHistorique';

export const VITESSES_RELECTURE = [10, 60] as const;
export type VitesseRelecture = (typeof VITESSES_RELECTURE)[number];
/** Cadence de la relecture (ms réelles entre deux images du bureau rejoué). */
export const PAS_RELECTURE_MS = 250;

export interface Relecture {
  debut: number;
  fin: number;
  t: number;
  lecture: boolean;
  vitesse: VitesseRelecture;
}

const minuit = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Événements triés par date (copie). */
export const trierEntrees = (entrees: readonly EntreeHistorique[]): EntreeHistorique[] =>
  [...entrees].filter(e => Number.isFinite(Date.parse(e.ts))).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

/**
 * Bornes de la journée à rejouer : du premier événement du jour (un peu avant)
 * jusqu'à maintenant ; sans activité aujourd'hui, les deux dernières heures.
 */
export function bornesJournee(entrees: readonly EntreeHistorique[], maintenant: number): { debut: number; fin: number } {
  const depuis = minuit(maintenant);
  let premier: number | undefined;
  for (const e of entrees) {
    const t = Date.parse(e.ts);
    if (t >= depuis && t <= maintenant && (premier === undefined || t < premier)) premier = t;
  }
  const debut = premier === undefined ? maintenant - 2 * 3_600_000 : Math.max(depuis, premier - 60_000);
  return { debut, fin: Math.max(debut + 60_000, maintenant) };
}

/** Les événements d'avant `t` (tableau trié : recherche dichotomique). */
export function entreesAvant(triees: readonly EntreeHistorique[], t: number): EntreeHistorique[] {
  let a = 0;
  let b = triees.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (Date.parse(triees[m].ts) <= t) a = m + 1;
    else b = m;
  }
  return triees.slice(0, a);
}

/**
 * Le bureau tel qu'il était à l'instant `t` : seuls les événements d'avant
 * comptent, l'état est calculé à `t` (jamais figé : on rejoue, ce n'est pas
 * une copie ancienne).
 */
export function bureauA(triees: readonly EntreeHistorique[], t: number, o: Omit<OptionsBureau, 'maintenant' | 'references'> = {}): Bureau {
  return deduireBureau(entreesAvant(triees, t), { ...o, maintenant: t });
}

/** Activité de la journée par tranche (barres derrière le curseur). */
export function densite(entrees: readonly EntreeHistorique[], debut: number, fin: number, tranches = 48): number[] {
  const res = new Array<number>(tranches).fill(0);
  const duree = Math.max(1, fin - debut);
  for (const e of entrees) {
    const t = Date.parse(e.ts);
    if (t < debut || t > fin) continue;
    res[Math.min(tranches - 1, Math.floor(((t - debut) / duree) * tranches))]++;
  }
  return res;
}

/** Une image de plus : le temps rejoué avance de `dtReel × vitesse` ; arrivé au bout, la lecture s'arrête. */
export function avancerRelecture(r: Relecture, dtReel: number): Relecture {
  if (!r.lecture) return r;
  const t = Math.min(r.fin, r.t + dtReel * r.vitesse);
  return { ...r, t, lecture: t < r.fin };
}

/** Nouvelle relecture : au début de la journée, en lecture, ×60. */
export function demarrerRelecture(entrees: readonly EntreeHistorique[], maintenant: number, vitesse: VitesseRelecture = 60): Relecture {
  const { debut, fin } = bornesJournee(entrees, maintenant);
  return { debut, fin, t: debut, lecture: true, vitesse };
}

/** Heure affichée sur le curseur (HH:MM:SS). */
export const heureRelecture = (t: number): string => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
