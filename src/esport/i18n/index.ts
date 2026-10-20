/**
 * Petit système d'internationalisation de l'Esport (français / anglais), sans dépendance.
 *
 *  - Dictionnaires typés `fr.ts` (référence) et `en.ts` (TypeScript refuse un `en` qui
 *    ne contient pas toutes les clés de `fr`).
 *  - `tr('cle', { nom })` : interpolation `{nom}` ; `trn('cle', 3)` : pluriel (clés `cle.one` /
 *    `cle.other`, `{n}` est fourni automatiquement), règles `Intl.PluralRules` de la langue.
 *  - La langue courante est un état global (lu à chaque rendu) : `definirLangue` prévient les
 *    abonnés et `useLangue()` re-rend le composant racine de l'Esport : changement instantané,
 *    sans recharger.
 *  - Formats de dates et de nombres selon la langue (`Intl`).
 *
 * La langue du compte est enregistrée côté serveur (`PUT /moi { langue }`, migration 0012) pour que
 * le bot Discord et les notifications la connaissent ; sans choix, la langue de l'appareil
 * (anglais si elle commence par « en », sinon français).
 */

import { useSyncExternalStore } from 'react';
import { en } from './en';
import { fr, type Cle } from './fr';

export type { Cle } from './fr';
export type Langue = 'fr' | 'en';
export const LANGUES: readonly Langue[] = ['fr', 'en'];
export const NOM_LANGUE: Record<Langue, string> = { fr: 'Français', en: 'English' };

const DICTIONNAIRES: Record<Langue, Record<Cle, string>> = { fr, en };
const LOCALES: Record<Langue, string> = { fr: 'fr-FR', en: 'en-GB' };

export const estLangue = (v: unknown): v is Langue => v === 'fr' || v === 'en';

/** Langue de l'appareil : « en… » → anglais, tout le reste → français. */
export function langueAppareil(): Langue {
  const g = globalThis as { __ESPORT_LANGUE_APPAREIL__?: string; navigator?: { language?: string; languages?: readonly string[] } };
  let brut = g.__ESPORT_LANGUE_APPAREIL__ ?? g.navigator?.languages?.[0] ?? g.navigator?.language;
  if (!brut) {
    try {
      brut = Intl.DateTimeFormat().resolvedOptions().locale;
    } catch {
      brut = undefined;
    }
  }
  return typeof brut === 'string' && /^en([-_]|$)/i.test(brut) ? 'en' : 'fr';
}

let courante: Langue = langueAppareil();
const abonnes = new Set<() => void>();

export const langueCourante = (): Langue => courante;
export const localeCourante = (): string => LOCALES[courante];
export const localeDe = (l: Langue): string => LOCALES[l];

/** Change la langue et prévient les abonnés (rendu instantané). */
export function definirLangue(l: Langue): void {
  if (l === courante) return;
  courante = l;
  for (const f of [...abonnes]) f();
}
export function abonnerLangue(f: () => void): () => void {
  abonnes.add(f);
  return () => {
    abonnes.delete(f);
  };
}

export type Variables = Record<string, string | number | null | undefined>;

export function interpoler(modele: string, vars?: Variables): string {
  if (!vars) return modele;
  return modele.replace(/\{(\w+)\}/g, (brut, nom: string) => (nom in vars && vars[nom] != null ? String(vars[nom]) : brut));
}

/** Traduit une clé dans une langue donnée (secours : français, puis la clé). */
export function traduire(langue: Langue, cle: Cle, vars?: Variables): string {
  return interpoler(DICTIONNAIRES[langue][cle] ?? fr[cle] ?? cle, vars);
}

/** La clé existe-t-elle dans le dictionnaire français (donc dans les deux) ? */
export const existe = (cle: string): cle is Cle => Object.prototype.hasOwnProperty.call(fr, cle);

/** Clé calculée (catalogue, codes d'erreur…) : `secours` si elle n'existe pas. */
export function trOu(cle: string, secours: string, vars?: Variables): string {
  return existe(cle) ? tr(cle, vars) : secours;
}

/** Traduit une clé dans la langue courante. */
export function tr(cle: Cle, vars?: Variables): string {
  return traduire(courante, cle, vars);
}

/** Clés « pluriel » : `x.one` / `x.other` s'appellent avec `tn('x', n)`. */
export type CleNombre = Cle extends infer K ? (K extends `${infer B}.other` ? B : never) : never;

export function categoriePluriel(langue: Langue, n: number): 'one' | 'other' {
  return new Intl.PluralRules(LOCALES[langue]).select(n) === 'one' ? 'one' : 'other';
}

/** Pluriel : `tn('joueurs', 1)` → « 1 joueur », `tn('joueurs', 2)` → « 2 joueurs ». */
export function traduireNombre(langue: Langue, cle: CleNombre, n: number, vars?: Variables): string {
  const k = `${cle}.${categoriePluriel(langue, n)}` as Cle;
  return traduire(langue, k, { n: formaterNombre(n, undefined, langue), ...vars });
}
export function trn(cle: CleNombre, n: number, vars?: Variables): string {
  return traduireNombre(courante, cle, n, vars);
}

// ------------------------------------------------------------------ Dates et nombres

export function formaterNombre(n: number, options?: Intl.NumberFormatOptions, langue: Langue = courante): string {
  return new Intl.NumberFormat(LOCALES[langue], options).format(n);
}

export function formaterDate(d: Date | number | string, options: Intl.DateTimeFormatOptions, langue: Langue = courante): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return typeof d === 'string' ? d : '';
  return new Intl.DateTimeFormat(LOCALES[langue], options).format(date);
}

/** Minuscules selon la langue (recherches, comparaisons de pseudos). */
export const minuscules = (s: string): string => s.toLocaleLowerCase(LOCALES[courante]);
export const comparer = (a: string, b: string): number => a.localeCompare(b, courante);

// ------------------------------------------------------------------ React

/**
 * Re-rend le composant quand la langue change. Le composant racine de l'Esport l'appelle : tous
 * ses enfants se re-rendent, relisent leurs chaînes avec `t` et la langue change sans recharger.
 */
export function useLangue(): Langue {
  return useSyncExternalStore(abonnerLangue, langueCourante, langueCourante);
}
