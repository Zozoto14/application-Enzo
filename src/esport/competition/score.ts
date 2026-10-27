/**
 * Aperçu du score pendant la saisie d'un résultat (fonctions pures). Le serveur reste seul juge
 * (esport/noyau/competition/score.mjs) : l'app montre l'issue probable et les totaux, sans bloquer.
 */

import type { FormatTournoi, Issue, SaisieManche, ScoreProfil, Systeme } from './api';

const nombre = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v)) return Number(v);
  return null;
};

/** Système d'un match selon le profil : classement (plus de deux équipes ou score « placement »), sinon série. */
export function systemeDe(format: FormatTournoi | null | undefined, score: ScoreProfil | null | undefined, repli: Systeme = 'serie'): Systeme {
  if (format && format.equipes > 2) return 'classement';
  if (score?.type === 'placement') return 'classement';
  if (format || score) return 'serie';
  return repli;
}

/** Totaux d'une manche saisie (mi-temps et prolongations comprises). */
export function totauxManche(m: SaisieManche): { nous: number | null; eux: number | null } {
  if (m.miTemps?.length) {
    const ot = m.prolongations ?? [0, 0];
    const somme = (i: 0 | 1) => m.miTemps!.reduce((s, h) => s + (nombre(h[i]) ?? 0), 0) + (nombre(ot[i]) ?? 0);
    return { nous: somme(0), eux: somme(1) };
  }
  return { nous: nombre(m.nous), eux: nombre(m.eux) };
}

/** Issue d'une manche saisie (null : pas encore lisible). */
export function issueManche(m: SaisieManche): Issue | null {
  const { nous, eux } = totauxManche(m);
  if (nous === null || eux === null) return m.issue ?? null;
  return nous > eux ? 'victoire' : nous < eux ? 'defaite' : 'nul';
}

/** Aperçu d'une série : manches gagnées et issue (null tant que la série n'est pas décidée). */
export function apercuSerie(manches: SaisieManche[], bo: number, score?: ScoreProfil | null): { nous: number; eux: number; issue: Issue | null } {
  const besoin = score?.type === 'manches' && score.manchesGagnantes ? score.manchesGagnantes : Math.floor(bo / 2) + 1;
  let nous = 0;
  let eux = 0;
  for (const m of manches) {
    const i = issueManche(m);
    if (i === 'victoire') nous++;
    else if (i === 'defaite') eux++;
  }
  const issue: Issue | null = nous >= besoin ? 'victoire' : eux >= besoin ? 'defaite' : manches.length >= bo ? (nous > eux ? 'victoire' : nous < eux ? 'defaite' : 'nul') : null;
  return { nous, eux, issue };
}

/** Points d'une place selon le barème du profil. */
export function pointsBareme(score: ScoreProfil | null | undefined, place: number | null): number | null {
  if (!place) return null;
  return score?.bareme?.find(b => b.place === place)?.points ?? null;
}

/** Statistiques libres saisies « kills=24, acs=268 » (une par ligne ou séparées par des virgules). */
export function lireStatsTexte(texte: string): Record<string, number | string> {
  const sortie: Record<string, number | string> = {};
  for (const morceau of texte.split(/[\n,;]/)) {
    const [k, ...reste] = morceau.split(/[=:]/);
    const cle = (k ?? '').trim().slice(0, 24);
    const valeur = reste.join(':').trim().slice(0, 40);
    if (!cle || !valeur) continue;
    sortie[cle] = /^-?\d+([.,]\d+)?$/.test(valeur) ? Number(valeur.replace(',', '.')) : valeur;
  }
  return sortie;
}

export const statsEnTexte = (s: Record<string, number | string>): string =>
  Object.entries(s)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
