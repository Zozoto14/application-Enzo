/**
 * Sélecteurs de dates : logique pure (sans React), partagée par tout l'AppDashboard.
 *
 *  - Les jours sont des textes « AAAA-MM-JJ » (jour civil, sans fuseau) : toute l'arithmétique
 *    (jours, mois, grille) se fait en UTC, donc aucun décalage au changement d'heure.
 *  - « Aujourd'hui » se lit dans un fuseau donné (celui de la team, du club) ou, à défaut, dans
 *    celui de l'appareil.
 *  - La saisie au clavier reste libre et tolérante : « 09/11/2026 », « 9/11 », « 9 nov »,
 *    « 9 novembre 2026 », « nov 9 », « 2026-11-09 » (copié-collé), « 09112026 », « demain »…
 *  - Les valeurs rendues aux écrans gardent leur format d'avant : « AAAA-MM-JJ » (format `iso`)
 *    ou « JJ/MM/AAAA » (format `fr`), « HH:MM » pour une heure, « AAAA-MM-JJ HH:MM » pour un
 *    instant en heure murale (le serveur applique le fuseau, comme avant).
 */

export type LangueDates = 'fr' | 'en';
/** Format de la valeur échangée avec l'écran (inchangé par rapport à l'ancien champ texte). */
export type FormatDate = 'iso' | 'fr';

const JOUR_MS = 86_400_000;
const deux = (n: number): string => String(n).padStart(2, '0');

/** Jour « AAAA-MM-JJ » d'année, mois (1-12) et jour, s'il existe vraiment (pas de 31/02). */
export function jourDe(annee: number, mois: number, jour: number): string | undefined {
  if (!Number.isInteger(annee) || !Number.isInteger(mois) || !Number.isInteger(jour)) return undefined;
  if (annee < 1000 || annee > 9999 || mois < 1 || mois > 12 || jour < 1 || jour > 31) return undefined;
  const d = new Date(Date.UTC(annee, mois - 1, jour));
  if (d.getUTCFullYear() !== annee || d.getUTCMonth() !== mois - 1 || d.getUTCDate() !== jour) return undefined;
  return `${annee}-${deux(mois)}-${deux(jour)}`;
}

/** Vrai pour un « AAAA-MM-JJ » qui existe au calendrier. */
export function estJour(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return !!m && jourDe(Number(m[1]), Number(m[2]), Number(m[3])) === v;
}

/** Parties numériques d'un jour valide. */
export function parties(iso: string): { annee: number; mois: number; jour: number } {
  return { annee: Number(iso.slice(0, 4)), mois: Number(iso.slice(5, 7)), jour: Number(iso.slice(8, 10)) };
}

const versMs = (iso: string): number => {
  const p = parties(iso);
  return Date.UTC(p.annee, p.mois - 1, p.jour);
};
const depuisMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Jour + n jours (n négatif accepté). */
export const ajouterJours = (iso: string, n: number): string => depuisMs(versMs(iso) + n * JOUR_MS);

/** Jour + n mois ; le jour est ramené au dernier du mois si besoin (31/01 + 1 mois → 28 ou 29/02). */
export function ajouterMois(iso: string, n: number): string {
  const p = parties(iso);
  const total = p.annee * 12 + (p.mois - 1) + n;
  const annee = Math.floor(total / 12);
  const mois = (total % 12) + 1;
  const dernier = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  return `${annee}-${deux(mois)}-${deux(Math.min(p.jour, dernier))}`;
}

/** Jour de la semaine ISO : 1 = lundi … 7 = dimanche. */
export const jourSemaine = (iso: string): number => ((new Date(versMs(iso)).getUTCDay() + 6) % 7) + 1;

/** Lundi de la semaine du jour. */
export const lundiDe = (iso: string): string => ajouterJours(iso, 1 - jourSemaine(iso));

/** Premier jour du mois. */
export const debutMois = (iso: string): string => `${iso.slice(0, 7)}-01`;

/** Dernier jour du mois. */
export const finMois = (iso: string): string => ajouterJours(ajouterMois(debutMois(iso), 1), -1);

/** Nombre de jours de `a` à `b` (positif si b est après a). */
export const ecartJours = (a: string, b: string): number => Math.round((versMs(b) - versMs(a)) / JOUR_MS);

/** Jour civil d'un instant dans un fuseau (« Europe/Paris »…) ; sans fuseau, celui de l'appareil. */
export function jourDansFuseau(instant: number, fuseau?: string): string {
  const d = new Date(instant);
  if (fuseau) {
    try {
      const p = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]),
      );
      if (p.year && p.month && p.day) return `${p.year}-${p.month}-${p.day}`;
    } catch {
      // Fuseau inconnu : jour de l'appareil.
    }
  }
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** Aujourd'hui (« AAAA-MM-JJ ») dans le fuseau donné, ou celui de l'appareil. */
export const aujourdhui = (fuseau?: string, maintenant: number = Date.now()): string => jourDansFuseau(maintenant, fuseau);

/** Grille d'un mois : 42 jours (6 semaines), du lundi qui précède le 1er. */
export function grilleMois(annee: number, mois: number): string[] {
  const premier = `${annee}-${deux(mois)}-01`;
  const depart = lundiDe(premier);
  return Array.from({ length: 42 }, (_, i) => ajouterJours(depart, i));
}

/** Le jour est-il dans les bornes et non désactivé ? */
export function jourPermis(iso: string, bornes: { min?: string; max?: string; desactive?: (iso: string) => boolean }): boolean {
  if (bornes.min && estJour(bornes.min) && iso < bornes.min) return false;
  if (bornes.max && estJour(bornes.max) && iso > bornes.max) return false;
  return !bornes.desactive?.(iso);
}

/** Ramène un jour dans les bornes. */
export function borner(iso: string, min?: string, max?: string): string {
  if (min && estJour(min) && iso < min) return min;
  if (max && estJour(max) && iso > max) return max;
  return iso;
}

// --- Noms --------------------------------------------------------------------------------------

const MOIS: Record<LangueDates, string[]> = {
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const MOIS_COURTS: Record<LangueDates, string[]> = {
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const JOURS_COURTS: Record<LangueDates, string[]> = {
  fr: ['L', 'M', 'M', 'J', 'V', 'S', 'D'],
  en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
};
const JOURS: Record<LangueDates, string[]> = {
  fr: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};
const JOURS_ABREGES: Record<LangueDates, string[]> = {
  fr: ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};

export const nomMois = (mois: number, langue: LangueDates): string => MOIS[langue][mois - 1] ?? '';
export const joursCourts = (langue: LangueDates): readonly string[] => JOURS_COURTS[langue];
export const nomJour = (iso: string, langue: LangueDates): string => JOURS[langue][jourSemaine(iso) - 1];

/** « novembre 2026 » / « November 2026 ». */
export const titreMois = (annee: number, mois: number, langue: LangueDates): string => `${nomMois(mois, langue)} ${annee}`;

/** Saisie affichée dans le champ : « 09/11/2026 » (jour en premier, dans les deux langues). */
export function formaterSaisie(iso: string): string {
  if (!estJour(iso)) return '';
  const p = parties(iso);
  return `${deux(p.jour)}/${deux(p.mois)}/${p.annee}`;
}

/** Jour lisible : « lun. 9 nov. 2026 » / « Mon 9 Nov 2026 ». */
export function formaterLisible(iso: string, langue: LangueDates, avecAnnee = true): string {
  if (!estJour(iso)) return '';
  const p = parties(iso);
  const court = MOIS_COURTS[langue][p.mois - 1];
  return `${JOURS_ABREGES[langue][jourSemaine(iso) - 1]} ${p.jour} ${court}${avecAnnee ? ` ${p.annee}` : ''}`;
}

/** Libellé complet lu par les lecteurs d'écran : « lundi 9 novembre 2026 ». */
export function formaterComplet(iso: string, langue: LangueDates): string {
  if (!estJour(iso)) return '';
  const p = parties(iso);
  return langue === 'fr' ? `${nomJour(iso, 'fr')} ${p.jour} ${nomMois(p.mois, 'fr')} ${p.annee}` : `${nomJour(iso, 'en')} ${p.jour} ${nomMois(p.mois, 'en')} ${p.annee}`;
}

// --- Saisie au clavier -------------------------------------------------------------------------

const sansAccents = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Mois écrit en toutes lettres (français ou anglais, abrégé dès 3 lettres) → 1-12. */
export function moisEcrit(mot: string): number | undefined {
  const m = sansAccents(mot.toLowerCase()).replace(/\.$/, '');
  if (m.length < 3) return undefined;
  if (m === 'mai' || m === 'may') return 5;
  if (m.startsWith('juil') || m.startsWith('jul')) return 7;
  if (m.startsWith('juin') || m === 'jun' || m === 'june') return 6;
  const listes = [MOIS.fr, MOIS.en].map(l => l.map(n => sansAccents(n.toLowerCase())));
  for (const liste of listes) {
    const i = liste.findIndex(n => n.startsWith(m) || (m.length >= 4 && m.startsWith(n.slice(0, 4))));
    if (i >= 0) return i + 1;
  }
  return undefined;
}

const annee4 = (t: string | undefined, reference: string): number => {
  if (!t) return parties(reference).annee;
  const n = Number(t);
  return t.length <= 2 ? 2000 + n : n;
};

/**
 * Texte saisi → « AAAA-MM-JJ », ou `undefined` s'il est illisible.
 * Sans année (« 9/11 », « 9 nov »), l'année de la référence (aujourd'hui).
 */
export function analyserDate(texte: string, reference: string = aujourdhui()): string | undefined {
  const t = sansAccents(texte.trim().toLowerCase()).replace(/\s+/g, ' ');
  if (!t) return undefined;
  if (['aujourd’hui', "aujourd'hui", 'aujourdhui', 'auj', 'today', 'now'].includes(t)) return reference;
  if (['demain', 'tomorrow', 'tmrw'].includes(t)) return ajouterJours(reference, 1);
  if (['hier', 'yesterday'].includes(t)) return ajouterJours(reference, -1);
  // ISO collé, éventuellement suivi d'une heure (« 2026-11-09T18:00:00Z », « 2026-11-09 18:00 »).
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[t ].*)?$/.exec(t);
  if (m) return jourDe(Number(m[1]), Number(m[2]), Number(m[3]));
  // 2026/11/09
  m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(t);
  if (m) return jourDe(Number(m[1]), Number(m[2]), Number(m[3]));
  // JJ/MM[/AAAA], JJ.MM.AA, JJ-MM-AAAA, JJ MM AAAA
  m = /^(\d{1,2})[/.\- ](\d{1,2})(?:[/.\- ](\d{2}|\d{4}))?$/.exec(t);
  if (m) return jourDe(annee4(m[3], reference), Number(m[2]), Number(m[1]));
  // Chiffres collés : JJMMAAAA, JJMMAA.
  m = /^(\d{2})(\d{2})(\d{4}|\d{2})$/.exec(t);
  if (m) return jourDe(annee4(m[3], reference), Number(m[2]), Number(m[1]));
  // « lundi 9 novembre 2026 », « 9 nov », « 9 nov. 26 », « 9th november »
  const mots = t.replace(/,/g, ' ').replace(/\s+/g, ' ').split(' ').filter(Boolean);
  const sansJourSemaine = mots.filter(x => !JOURS.fr.concat(JOURS.en, JOURS_ABREGES.fr, JOURS_ABREGES.en).some(j => sansAccents(j.toLowerCase()).replace(/\.$/, '') === x.replace(/\.$/, '')));
  if (sansJourSemaine.length >= 2 && sansJourSemaine.length <= 3) {
    const [a, b, c] = sansJourSemaine;
    const num = (x: string) => /^(\d{1,2})(?:er|st|nd|rd|th)?$/.exec(x)?.[1];
    const an = (x: string | undefined) => (x && /^(\d{2}|\d{4})$/.test(x) ? x : undefined);
    if (num(a) && moisEcrit(b) && (c === undefined || an(c))) return jourDe(annee4(an(c), reference), moisEcrit(b)!, Number(num(a)));
    if (moisEcrit(a) && num(b) && (c === undefined || an(c))) return jourDe(annee4(an(c), reference), moisEcrit(a)!, Number(num(b)));
  }
  return undefined;
}

/** Valeur de l'écran (format `iso` ou `fr`) → jour « AAAA-MM-JJ », ou `undefined`. */
export function lireValeur(valeur: string | null | undefined, format: FormatDate): string | undefined {
  if (!valeur) return undefined;
  if (format === 'iso') return estJour(valeur.trim()) ? valeur.trim() : undefined;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(valeur.trim());
  return m ? jourDe(Number(m[3]), Number(m[2]), Number(m[1])) : undefined;
}

/** Jour « AAAA-MM-JJ » → valeur de l'écran. */
export const ecrireValeur = (iso: string, format: FormatDate): string => (format === 'iso' ? iso : formaterSaisie(iso));

// --- Heures ------------------------------------------------------------------------------------

/** Vrai pour « HH:MM » (00:00 à 23:59). */
export const estHeure = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/**
 * Heure saisie → « HH:MM » : « 14:30 », « 14h30 », « 14h », « 14 h 30 », « 1430 », « 930 », « 9 »,
 * « 14.30 », « 2pm », « 2:30 pm », « midi », « minuit ».
 */
export function analyserHeure(texte: string): string | undefined {
  let t = sansAccents(texte.trim().toLowerCase()).replace(/\s+/g, '');
  if (!t) return undefined;
  if (t === 'midi' || t === 'noon') return '12:00';
  if (t === 'minuit' || t === 'midnight') return '00:00';
  t = t.replace(/^a(?=\d)/, '');
  let suffixe: 'am' | 'pm' | undefined;
  const ap = /^(.*?)(am|pm|a\.m\.|p\.m\.)$/.exec(t);
  if (ap) {
    t = ap[1];
    suffixe = ap[2].startsWith('a') ? 'am' : 'pm';
  }
  let h: number;
  let min: number;
  let m = /^(\d{1,2})(?:[:h.](\d{1,2})?)?(?:min)?$/.exec(t);
  if (m) {
    h = Number(m[1]);
    min = m[2] === undefined ? 0 : Number(m[2].length === 1 ? `${m[2]}0` : m[2]);
  } else if ((m = /^(\d{1,2})(\d{2})$/.exec(t))) {
    h = Number(m[1]);
    min = Number(m[2]);
  } else return undefined;
  if (suffixe) {
    if (h < 1 || h > 12) return undefined;
    h = (h % 12) + (suffixe === 'pm' ? 12 : 0);
  }
  if (h > 23 || min > 59) return undefined;
  return `${deux(h)}:${deux(min)}`;
}

/** Minutes d'une heure « HH:MM ». */
export const minutesDe = (h: string): number => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
/** « HH:MM » de minutes (bornées à la journée). */
export const heureDe = (min: number): string => {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));
  return `${deux(Math.floor(m / 60))}:${deux(m % 60)}`;
};

/** Minutes proposées pour un pas (5 → 00, 05 … 55 ; 15 → 00, 15, 30, 45). */
export const minutesProposees = (pas: number): number[] => Array.from({ length: Math.max(1, Math.floor(60 / pas)) }, (_, i) => i * pas);

/** Heure arrondie au pas le plus proche (sans changer de jour). */
export const arrondirHeure = (h: string, pas: number): string => heureDe(Math.min(23 * 60 + 60 - pas, Math.round(minutesDe(h) / pas) * pas));

/** Instant mural « AAAA-MM-JJ HH:MM » → parties, ou `undefined`. */
export function lireInstantMural(v: string | null | undefined): { date: string; heure: string } | undefined {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec((v ?? '').trim());
  if (!m || !estJour(m[1]) || !estHeure(m[2])) return undefined;
  return { date: m[1], heure: m[2] };
}

// --- Raccourcis --------------------------------------------------------------------------------

export type IdRaccourci = 'aujourdhui' | 'demain' | 'lundi' | 'semaine';

/** Jour visé par un raccourci ; « +1 semaine » part du jour choisi (sinon d'aujourd'hui). */
export function jourRaccourci(id: IdRaccourci, reference: string, choisi?: string): string {
  switch (id) {
    case 'aujourdhui':
      return reference;
    case 'demain':
      return ajouterJours(reference, 1);
    case 'lundi':
      return ajouterJours(lundiDe(reference), 7);
    case 'semaine':
      return ajouterJours(choisi && estJour(choisi) ? choisi : reference, 7);
  }
}

export type IdRaccourciPeriode = '7j' | '30j' | 'mois' | 'mois-precedent' | 'annee';

/** Période (bornes incluses) d'un raccourci de filtre. */
export function periodeRaccourci(id: IdRaccourciPeriode, reference: string): { du: string; au: string } {
  switch (id) {
    case '7j':
      return { du: ajouterJours(reference, -6), au: reference };
    case '30j':
      return { du: ajouterJours(reference, -29), au: reference };
    case 'mois':
      return { du: debutMois(reference), au: finMois(reference) };
    case 'mois-precedent': {
      const debut = ajouterMois(debutMois(reference), -1);
      return { du: debut, au: finMois(debut) };
    }
    case 'annee':
      return { du: `${reference.slice(0, 4)}-01-01`, au: `${reference.slice(0, 4)}-12-31` };
  }
}

// --- Textes ------------------------------------------------------------------------------------

const TEXTES = {
  fr: {
    ouvrir: 'Choisir dans le calendrier',
    ouvrirHeure: 'Choisir l’heure',
    precedent: 'Mois précédent',
    suivant: 'Mois suivant',
    aujourdhui: 'Aujourd’hui',
    demain: 'Demain',
    lundi: 'Lundi prochain',
    semaine: '+1 semaine',
    effacer: 'Effacer',
    fermer: 'Fermer',
    valider: 'Valider',
    heures: 'Heures',
    minutes: 'Minutes',
    heure: 'Heure',
    date: 'Date',
    du: 'Du',
    au: 'Au',
    invalide: 'Date illisible : écris par ex. 09/11/2026, 9/11 ou 9 nov.',
    invalideHeure: 'Heure illisible : écris par ex. 18:30, 18h30 ou 1830.',
    horsBornes: 'Date hors des limites permises.',
    indisponible: 'indisponible',
    choisirDebut: 'Choisis le premier jour',
    choisirFin: 'Choisis le dernier jour',
    '7j': '7 derniers jours',
    '30j': '30 derniers jours',
    mois: 'Ce mois-ci',
    'mois-precedent': 'Mois dernier',
    annee: 'Cette année',
    placeholder: 'JJ/MM/AAAA',
    placeholderHeure: 'HH:MM',
  },
  en: {
    ouvrir: 'Pick from the calendar',
    ouvrirHeure: 'Pick the time',
    precedent: 'Previous month',
    suivant: 'Next month',
    aujourdhui: 'Today',
    demain: 'Tomorrow',
    lundi: 'Next Monday',
    semaine: '+1 week',
    effacer: 'Clear',
    fermer: 'Close',
    valider: 'Done',
    heures: 'Hours',
    minutes: 'Minutes',
    heure: 'Time',
    date: 'Date',
    du: 'From',
    au: 'To',
    invalide: 'Unreadable date: type e.g. 09/11/2026, 9/11 or 9 Nov.',
    invalideHeure: 'Unreadable time: type e.g. 18:30, 6:30pm or 1830.',
    horsBornes: 'Date outside the allowed range.',
    indisponible: 'unavailable',
    choisirDebut: 'Pick the first day',
    choisirFin: 'Pick the last day',
    '7j': 'Last 7 days',
    '30j': 'Last 30 days',
    mois: 'This month',
    'mois-precedent': 'Last month',
    annee: 'This year',
    placeholder: 'DD/MM/YYYY',
    placeholderHeure: 'HH:MM',
  },
} as const;

export type CleTexteDates = keyof (typeof TEXTES)['fr'];
export const texteDates = (langue: LangueDates, cle: CleTexteDates): string => TEXTES[langue][cle];
