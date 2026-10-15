/**
 * Journal : jours civils (« AAAA-MM-JJ », heure locale), semaines (du lundi au
 * dimanche) et mois. Tout est pur : l'horloge est toujours passée en paramètre.
 */

export const JOURS_SEMAINE = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;
export const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'] as const;

const MOTIF_JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;
const MOTIF_MOIS = /^\d{4}-(0[1-9]|1[0-2])$/;
const deux = (n: number) => String(n).padStart(2, '0');

/** Jour civil local d'un instant. */
export function jourDe(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** Heure locale « HH:MM » d'un instant. */
export function heureDe(ms: number): string {
  const d = new Date(ms);
  return `${deux(d.getHours())}:${deux(d.getMinutes())}`;
}

export function jourValide(jour: unknown): jour is string {
  if (typeof jour !== 'string') return false;
  const m = MOTIF_JOUR.exec(jour);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

export const moisValide = (mois: unknown): mois is string => typeof mois === 'string' && MOTIF_MOIS.test(mois);

/** Date locale à midi (à l'abri des changements d'heure). */
export function midi(jour: string): Date {
  const [a, m, j] = jour.split('-').map(Number);
  return new Date(a, m - 1, j, 12);
}

export function ajouterJours(jour: string, n: number): string {
  const d = midi(jour);
  d.setDate(d.getDate() + n);
  return jourDe(d.getTime());
}

/** Instant (ms) de `heure` heures, minute 0, ce jour-là en heure locale. */
export function instantDu(jour: string, heure: number): number {
  const [a, m, j] = jour.split('-').map(Number);
  return new Date(a, m - 1, j, heure, 0, 0, 0).getTime();
}

/** 1 = lundi … 7 = dimanche. */
export function jourSemaine(jour: string): number {
  const j = midi(jour).getDay();
  return j === 0 ? 7 : j;
}

export const debutSemaine = (jour: string): string => ajouterJours(jour, 1 - jourSemaine(jour));
export const finSemaine = (jour: string): string => ajouterJours(debutSemaine(jour), 6);
export const moisDe = (jour: string): string => jour.slice(0, 7);
export const debutMois = (jour: string): string => `${moisDe(jour)}-01`;

export function joursDansMois(mois: string): number {
  const [a, m] = mois.split('-').map(Number);
  return new Date(a, m, 0).getDate();
}
export const finMois = (jour: string): string => `${moisDe(jour)}-${deux(joursDansMois(moisDe(jour)))}`;

export function ajouterMois(mois: string, n: number): string {
  const [a, m] = mois.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1, 12);
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}`;
}

/** Tous les jours de `du` à `au` inclus (borné pour ne jamais boucler sans fin). */
export function joursEntre(du: string, au: string, max = 800): string[] {
  const sortie: string[] = [];
  for (let j = du; j <= au && sortie.length < max; j = ajouterJours(j, 1)) sortie.push(j);
  return sortie;
}

const majuscule = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** « mardi 13 octobre 2026 ». */
export function jourLong(jour: string, avecAnnee = true): string {
  const d = midi(jour);
  const base = `${JOURS_SEMAINE[jourSemaine(jour) - 1]} ${d.getDate() === 1 ? '1er' : d.getDate()} ${MOIS[d.getMonth()]}`;
  return avecAnnee ? `${base} ${d.getFullYear()}` : base;
}

export const jourLongMaj = (jour: string, avecAnnee = true): string => majuscule(jourLong(jour, avecAnnee));

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'] as const;

/** « 13 oct. » pour une liste. */
export function jourCourt(jour: string): string {
  const d = midi(jour);
  return `${d.getDate()} ${MOIS_COURTS[d.getMonth()]}`;
}

/** « octobre 2026 ». */
export function moisLong(mois: string): string {
  const [a, m] = mois.split('-').map(Number);
  return `${MOIS[m - 1]} ${a}`;
}

/** « semaine du 12 au 18 octobre 2026 ». */
export function semaineLongue(jour: string): string {
  const d = midi(debutSemaine(jour));
  const f = midi(finSemaine(jour));
  const premier = d.getDate() === 1 ? '1er' : d.getDate();
  if (d.getMonth() === f.getMonth()) return `semaine du ${premier} au ${f.getDate()} ${MOIS[f.getMonth()]} ${f.getFullYear()}`;
  return `semaine du ${premier} ${MOIS[d.getMonth()]} au ${f.getDate()} ${MOIS[f.getMonth()]} ${f.getFullYear()}`;
}

/** Grille d'un mois : semaines (lundi en tête), cases vides (`null`) avant le 1er et après le dernier jour. */
export function grilleDuMois(mois: string): Array<Array<string | null>> {
  const premier = `${mois}-01`;
  const decalage = jourSemaine(premier) - 1;
  const cases: Array<string | null> = Array.from({ length: decalage }, () => null);
  for (const j of joursEntre(premier, `${mois}-${deux(joursDansMois(mois))}`)) cases.push(j);
  while (cases.length % 7 !== 0) cases.push(null);
  const semaines: Array<Array<string | null>> = [];
  for (let i = 0; i < cases.length; i += 7) semaines.push(cases.slice(i, i + 7));
  return semaines;
}
