/**
 * Pilote de semaine : jours civils (« AAAA-MM-JJ », heure locale) et heures
 * (« HH:MM »). Petits utilitaires purs, propres au module : le hub ne dépend
 * d'aucune app.
 */

export const JOURS_NOMS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;
export const JOURS_ABREGES = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'] as const;
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'] as const;
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'] as const;

const deux = (n: number) => String(n).padStart(2, '0');

export function jourDe(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** Date locale à midi (à l'abri des changements d'heure). */
function midi(jour: string): Date {
  const [a, m, j] = jour.split('-').map(Number);
  return new Date(a, m - 1, j, 12);
}

export const jourValide = (jour: unknown): jour is string => {
  if (typeof jour !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(jour)) return false;
  return jourDe(midi(jour).getTime()) === jour;
};

export function ajouterJours(jour: string, n: number): string {
  const d = midi(jour);
  d.setDate(d.getDate() + n);
  return jourDe(d.getTime());
}

/** 1 = lundi … 7 = dimanche. */
export function jourSemaine(jour: string): number {
  const j = midi(jour).getDay();
  return j === 0 ? 7 : j;
}

export const lundiDe = (jour: string): string => ajouterJours(jour, 1 - jourSemaine(jour));

export const ecartJours = (de: string, a: string): number => Math.round((midi(a).getTime() - midi(de).getTime()) / 86_400_000);

/** Les sept jours de la semaine qui commence ce lundi. */
export const septJours = (lundi: string): string[] => Array.from({ length: 7 }, (_, i) => ajouterJours(lundi, i));

export const heureValide = (h: unknown): h is string => typeof h === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(h);

export const minutesDe = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function heureDeMinutes(min: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  return `${deux(Math.floor(m / 60))}:${deux(m % 60)}`;
}

/** Instant local d'un jour à une heure. */
export function instantLocal(jour: string, hhmm: string): number {
  const [a, m, j] = jour.split('-').map(Number);
  return new Date(a, m - 1, j, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5))).getTime();
}

/** « lundi 19 octobre ». */
export function jourLong(jour: string): string {
  const [, m, j] = jour.split('-').map(Number);
  return `${JOURS_NOMS[jourSemaine(jour) - 1]} ${j === 1 ? '1er' : j} ${MOIS[m - 1]}`;
}

/** « 19 oct. ». */
export function jourCourt(jour: string): string {
  const [, m, j] = jour.split('-').map(Number);
  return `${j === 1 ? '1er' : j} ${MOIS_COURTS[m - 1]}`;
}

/** « 19 au 25 octobre » ou « 26 octobre au 1er novembre ». */
export function plageSemaine(lundi: string): string {
  const fin = ajouterJours(lundi, 6);
  const [, m1, j1] = lundi.split('-').map(Number);
  const [, m2, j2] = fin.split('-').map(Number);
  const n = (j: number) => (j === 1 ? '1er' : String(j));
  return m1 === m2 ? `${n(j1)} au ${n(j2)} ${MOIS[m2 - 1]}` : `${n(j1)} ${MOIS[m1 - 1]} au ${n(j2)} ${MOIS[m2 - 1]}`;
}

/** « 2 h 30 », « 45 min », « 1 h ». */
export function dureeTexte(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${deux(r)}` : `${h} h`;
}
