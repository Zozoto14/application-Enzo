/**
 * Appariement de titres : retrouver, parmi les resultats d'un site, la
 * serie ou le film que le catalogue designe. Logique pure, portee de
 * l'ancien scrapers/provider.js.
 */

import { normaliserTexte } from './outils';

/** Marqueurs de langue, ecartes de la comparaison (traites par la preference VF/VOSTFR). */
const BRUIT = new Set(['vf', 'vostfr', 'vo', 'vosta', 'fr']);

/** En dessous, le titre trouve n'est ni identique ni un prefixe : correspondance non fiable. */
export const SCORE_MINIMAL = 600;

export type LangueDetectee = 'vf' | 'vostfr' | null;
export type PreferenceLangue = 'vf' | 'vostfr' | 'indifferent';

export function detecterLangue(texte: unknown): LangueDetectee {
  const norm = ` ${String(texte ?? '').toLowerCase().replace(/[^a-z]+/g, ' ')} `;
  if (/ vf /.test(norm)) {
    return 'vf';
  }
  if (/ (vostfr|vosta|vo) /.test(norm)) {
    return 'vostfr';
  }
  return null;
}

const mots = (valeur: unknown): string[] =>
  normaliserTexte(valeur)
    .split(' ')
    .filter(t => t && !BRUIT.has(t));

/**
 * Compare un titre candidat aux titres connus. Un mot EN TROP dans le titre
 * trouve designe presque toujours une autre oeuvre (« One Piece Heroines ») :
 * penalite forte. Un mot MANQUANT reste acceptable (abreviation).
 */
export function scoreTitre(candidat: string, cibles: readonly string[]): number {
  const tc = mots(candidat);
  const nc = tc.join(' ');
  if (!nc) {
    return -Infinity;
  }
  let meilleur = -Infinity;
  for (const cible of cibles) {
    const tt = mots(cible);
    const nt = tt.join(' ');
    if (!nt) {
      continue;
    }
    let score: number;
    if (nc === nt) {
      score = 1000;
    } else if (nc.startsWith(nt) || nt.startsWith(nc)) {
      score = 700 - Math.abs(tc.length - tt.length) * 30;
    } else {
      const communs = tc.filter(t => tt.includes(t)).length;
      if (!communs) {
        continue;
      }
      score = 300 * (communs / tt.length);
    }
    score -= tc.filter(t => !tt.includes(t)).length * 150;
    meilleur = Math.max(meilleur, score);
  }
  return meilleur;
}

const MARQUEURS_SAISON = /\b(?:saison|season|cour|partie|part)\s*\d+\b|\b\d+(?:st|nd|rd|th)\s+season\b/gi;

/** « Mushoku Tensei: Jobless Reincarnation Season 2 Part 2 » -> « Mushoku Tensei ». */
export function titreDeBase(titre: unknown): string {
  let t = String(titre ?? '').replace(MARQUEURS_SAISON, ' ');
  t = t.split(/[:–—]/)[0];
  t = t.replace(/\s+\b(?:i{1,3}|iv|v|vi)\b\s*$/i, ' ');
  t = t.replace(/\s+\d+\s*$/, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** Titres a essayer dans la recherche d'un site : complets puis reduits, sans doublon (6 max). */
export function variantesDeRecherche(titres: string | readonly (string | null | undefined)[]): string[] {
  const liste = (Array.isArray(titres) ? titres : [titres]) as (string | null | undefined)[];
  const candidats: string[] = [];
  for (const t of liste) {
    if (!t) {
      continue;
    }
    candidats.push(t);
    const base = titreDeBase(t);
    if (base && base.length >= 3) {
      candidats.push(base);
    }
  }
  const vus = new Set<string>();
  return candidats
    .filter(t => {
      const cle = normaliserTexte(t);
      if (!cle || vus.has(cle)) {
        return false;
      }
      vus.add(cle);
      return true;
    })
    .slice(0, 6);
}

export interface ResultatBrut {
  title: string;
  url: string;
  image?: string | null;
  year?: string | null;
}

export interface ResultatClasse extends ResultatBrut {
  language: LangueDetectee;
  /** Score de titre seul (compare au seuil). */
  baseScore: number;
  /** Score avec preference de langue (sert au tri). */
  score: number;
}

export function classerResultats<T extends ResultatBrut>(
  resultats: readonly T[],
  titres: string | readonly (string | null | undefined)[],
  preference: PreferenceLangue = 'indifferent',
): (T & ResultatClasse)[] {
  const cibles = ((Array.isArray(titres) ? titres : [titres]) as (string | null | undefined)[]).filter(Boolean) as string[];
  return resultats
    .map(r => {
      const language = detecterLangue(r.title) || detecterLangue(r.url);
      const baseScore = scoreTitre(r.title, cibles);
      let score = baseScore;
      // La preference ne sert qu'a departager deux titres equivalents : elle
      // reste hors du score de reference (seul compare au seuil).
      if (preference === 'vf') {
        score += language === 'vf' ? 60 : -60;
      } else if (preference === 'vostfr') {
        score += language === 'vf' ? -60 : 60;
      }
      return { ...r, language, baseScore: Math.round(baseScore), score: Math.round(score) };
    })
    .sort((a, b) => b.score - a.score);
}

/** Dernier nombre du dernier segment : « shangri-la-frontier-2-25-vf » -> 25. */
export function numeroDepuisAdresse(href: string | null | undefined): number | null {
  if (!href) {
    return null;
  }
  const chemin = String(href).replace(/[?#].*$/, '').replace(/\/+$/, '');
  const slug = chemin.split('/').pop() || '';
  const nombres = slug.match(/\d{1,4}/g);
  return nombres?.length ? Number(nombres[nombres.length - 1]) : null;
}
