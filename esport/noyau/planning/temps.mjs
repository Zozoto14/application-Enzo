/**
 * Fuseaux horaires sans bibliothèque (Intl, disponible sous Node et dans les
 * navigateurs). Fonctions PURES.
 *
 * Règle de stockage de l'Esport : tout instant est stocké en UTC (ISO 8601).
 * Une heure « murale » (20:00 à Paris tous les mardis) n'est PAS un instant :
 * elle est gardée avec son fuseau, et convertie en UTC date par date. C'est ce
 * qui garde un entraînement hebdomadaire à 20:00 heure de Paris des deux côtés
 * du changement d'heure (18:00 UTC en été, 19:00 UTC en hiver).
 */

const MOTIF_FUSEAU = /^(UTC|[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2})$/;
const MOTIF_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MOTIF_HEURE = /^([01]\d|2[0-4]):([0-5]\d)$/;
const formateurs = new Map();

function formateur(fuseau) {
  let f = formateurs.get(fuseau);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: fuseau,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formateurs.set(fuseau, f);
  }
  return f;
}

/** Fuseau IANA reconnu par le moteur (« Europe/Paris », « America/New_York », « UTC »). */
export function fuseauValide(fuseau) {
  if (typeof fuseau !== 'string' || fuseau.length > 60 || !MOTIF_FUSEAU.test(fuseau)) return false;
  try {
    formateur(fuseau);
    return true;
  } catch {
    return false;
  }
}

const JOURS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Parties locales d'un instant : `{ annee, mois, jour, heure, minute, jourSemaine }` (jourSemaine ISO : 1 = lundi). */
export function partiesLocales(fuseau, ms) {
  const p = {};
  for (const { type, value } of formateur(fuseau).formatToParts(new Date(ms))) p[type] = value;
  return {
    annee: Number(p.year),
    mois: Number(p.month),
    jour: Number(p.day),
    heure: Number(p.hour) % 24,
    minute: Number(p.minute),
    seconde: Number(p.second),
    jourSemaine: JOURS[p.weekday],
  };
}

/** Décalage du fuseau à cet instant, en minutes (Paris l'été : +120). */
export function decalage(fuseau, ms) {
  const l = partiesLocales(fuseau, ms);
  const commeUtc = Date.UTC(l.annee, l.mois - 1, l.jour, l.heure, l.minute, l.seconde);
  return Math.round((commeUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/**
 * Heure murale → instant UTC (ms). Heure qui n'existe pas (passage à l'heure
 * d'été : 02:30 à Paris le dernier dimanche de mars) : décalée vers l'avant
 * (03:30). Heure ambiguë (passage à l'heure d'hiver : 02:30 deux fois) : la
 * première.
 */
export function versUtc(fuseau, { annee, mois, jour, heure = 0, minute = 0 }) {
  const naif = Date.UTC(annee, mois - 1, jour, heure, minute);
  // Deux candidats : avec le décalage d'avant et d'après une éventuelle transition.
  const avant = decalage(fuseau, naif - 86_400_000 / 2);
  const apres = decalage(fuseau, naif + 86_400_000 / 2);
  const candidats = [...new Set([avant, apres])].map(d => naif - d * 60_000).sort((a, b) => a - b);
  for (const c of candidats) {
    const l = partiesLocales(fuseau, c);
    if (l.annee === annee && l.mois === mois && l.jour === jour && l.heure === heure % 24 && l.minute === minute) return c;
  }
  // Trou (heure d'été) : l'heure murale n'existe pas ; on garde le décalage d'avant (heure décalée vers l'avant).
  return naif - avant * 60_000;
}

// ------------------------------------------------------------------ Dates civiles (sans fuseau)

export function lireDate(texte) {
  const m = MOTIF_DATE.exec(String(texte ?? ''));
  if (!m) return undefined;
  const [annee, mois, jour] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(annee, mois - 1, jour));
  if (d.getUTCFullYear() !== annee || d.getUTCMonth() !== mois - 1 || d.getUTCDate() !== jour) return undefined;
  return { annee, mois, jour };
}

/** « HH:MM » → minutes depuis minuit (« 24:00 » → 1440). */
export function lireHeure(texte) {
  const m = MOTIF_HEURE.exec(String(texte ?? ''));
  if (!m) return undefined;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes > 1440 ? undefined : minutes;
}

export const deux = n => String(n).padStart(2, '0');
export const texteDate = ({ annee, mois, jour }) => `${annee}-${deux(mois)}-${deux(jour)}`;
export const texteHeure = minutes => `${deux(Math.floor(minutes / 60))}:${deux(minutes % 60)}`;

/** Date civile + n jours. */
export function ajouterJours({ annee, mois, jour }, n) {
  const d = new Date(Date.UTC(annee, mois - 1, jour + n));
  return { annee: d.getUTCFullYear(), mois: d.getUTCMonth() + 1, jour: d.getUTCDate() };
}

/** Jour de la semaine ISO d'une date civile (1 = lundi … 7 = dimanche). */
export function jourSemaine({ annee, mois, jour }) {
  const j = new Date(Date.UTC(annee, mois - 1, jour)).getUTCDay();
  return j === 0 ? 7 : j;
}

/** Nombre de jours entre deux dates civiles (b − a). */
export function ecartJours(a, b) {
  return Math.round((Date.UTC(b.annee, b.mois - 1, b.jour) - Date.UTC(a.annee, a.mois - 1, a.jour)) / 86_400_000);
}

/** Lundi de la semaine d'une date civile. */
export const lundiDe = date => ajouterJours(date, 1 - jourSemaine(date));

/** Date civile locale d'un instant. */
export function dateLocale(fuseau, ms) {
  const l = partiesLocales(fuseau, ms);
  return { annee: l.annee, mois: l.mois, jour: l.jour };
}

/** Date civile + minutes depuis minuit (peut dépasser 1440 : jour suivant) → instant UTC. */
export function instantMural(fuseau, date, minutes) {
  const d = ajouterJours(date, Math.floor(minutes / 1440));
  const reste = ((minutes % 1440) + 1440) % 1440;
  return versUtc(fuseau, { ...d, heure: Math.floor(reste / 60), minute: reste % 60 });
}
