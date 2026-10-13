/**
 * Tâches : jours civils (« AAAA-MM-JJ », heure locale), heures (« HH:MM ») et
 * lecture des dates écrites en français (« demain », « lundi », « 15/11 »,
 * « dans 3 jours », « 15 novembre », « à 14h30 »).
 *
 * Tout est pur : l'horloge est toujours passée en paramètre (`aujourdhui`).
 */

export const JOURS_SEMAINE = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;
export const JOURS_COURTS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'] as const;
export const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'] as const;

const MOTIF_JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;
const MOTIF_HEURE = /^([01]\d|2[0-3]):([0-5]\d)$/;

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

export const heureValide = (heure: unknown): heure is string => typeof heure === 'string' && MOTIF_HEURE.test(heure);

/** Date locale à midi (à l'abri des changements d'heure). */
function midi(jour: string): Date {
  const [a, m, j] = jour.split('-').map(Number);
  return new Date(a, m - 1, j, 12);
}

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

/** Lundi de la semaine du jour. */
export const debutSemaine = (jour: string): string => ajouterJours(jour, 1 - jourSemaine(jour));

export function joursDansMois(annee: number, mois: number): number {
  return new Date(annee, mois, 0).getDate();
}

/** Même jour N (borné au dernier jour du mois), `n` mois plus tard. */
export function ajouterMois(jour: string, n: number, jourVoulu?: number): string {
  const [a, m, j] = jour.split('-').map(Number);
  const total = a * 12 + (m - 1) + n;
  const annee = Math.floor(total / 12);
  const mois = (total % 12) + 1;
  const jj = Math.min(jourVoulu ?? j, joursDansMois(annee, mois));
  return `${annee}-${deux(mois)}-${deux(jj)}`;
}

export function ecartJours(de: string, a: string): number {
  return Math.round((midi(a).getTime() - midi(de).getTime()) / 86_400_000);
}

/** Instant (ms) d'une échéance ; sans heure : 9 h du matin. */
export function instantDe(jour: string, heure?: string): number {
  const [a, m, j] = jour.split('-').map(Number);
  const [h, mi] = (heure && heureValide(heure) ? heure : '09:00').split(':').map(Number);
  return new Date(a, m - 1, j, h, mi).getTime();
}

/** « lun. 15 nov. », « aujourd’hui », « demain », « hier ». */
export function jourLisible(jour: string, aujourdhui: string, long = false): string {
  const e = ecartJours(aujourdhui, jour);
  if (e === 0) return 'aujourd’hui';
  if (e === 1) return 'demain';
  if (e === -1) return 'hier';
  const d = midi(jour);
  const mois = MOIS[d.getMonth()];
  const nomJour = long ? JOURS_SEMAINE[jourSemaine(jour) - 1] : JOURS_COURTS[jourSemaine(jour) - 1];
  const annee = d.getFullYear() !== midi(aujourdhui).getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${nomJour} ${d.getDate()} ${long ? mois : mois.length > 4 ? `${mois.slice(0, mois.startsWith('juil') ? 4 : 3)}.` : mois}${annee}`;
}

export const jourCourtFr = (jour: string): string => {
  const [a, m, j] = jour.split('-');
  return `${j}/${m}/${a}`;
};

/** Minuscules sans accents (comparaisons et recherche). */
export function sansAccents(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// ------------------------------------------------------------------ Lecture du français

export interface DateLue {
  jour: string;
  heure?: string;
  /** Morceau du texte reconnu (retiré du titre par l'ajout rapide). */
  texte: string;
}

const NOMBRES: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, quinze: 15 };

function nombre(mot: string): number | undefined {
  if (/^\d{1,3}$/.test(mot)) return Number(mot);
  return NOMBRES[mot];
}

const indexMois = (mot: string): number => {
  const s = sansAccents(mot).replace(/\.$/, '');
  if (s.length < 3) return -1;
  return MOIS.findIndex(m => sansAccents(m).startsWith(s));
};

/** Jour d'une date « JJ/MM[/AAAA] » ou « JJ mois [AAAA] » ; année suivante si déjà passée. */
function jourPrecis(j: number, m: number, a: number | undefined, aujourdhui: string): string | undefined {
  const anneeCourante = Number(aujourdhui.slice(0, 4));
  let annee = a === undefined ? anneeCourante : a < 100 ? 2000 + a : a;
  const candidat = (y: number) => `${y}-${deux(m)}-${deux(j)}`;
  if (!jourValide(candidat(annee))) {
    // 29 février d'une année non bissextile : l'année suivante qui l'a.
    if (a !== undefined) return undefined;
    for (let y = annee + 1; y <= annee + 8; y++) if (jourValide(candidat(y))) return candidat(y);
    return undefined;
  }
  if (a === undefined && candidat(annee) < aujourdhui) {
    annee += 1;
    while (!jourValide(candidat(annee))) annee += 1;
  }
  return candidat(annee);
}

/** Heure écrite « 14h », « 14h30 », « 14:30 », « à 9h » → « HH:MM ». */
export function lireHeure(texte: string): string | undefined {
  const m = /^(?:à\s*)?([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?$/i.exec(texte.trim());
  if (!m) return undefined;
  return `${deux(Number(m[1]))}:${m[2] ?? '00'}`;
}

/**
 * Cherche UNE date en français dans le texte (la première reconnue) et
 * l'heure qui la suit éventuellement. Rend aussi le morceau reconnu.
 */
export function trouverDate(texte: string, aujourdhui: string): DateLue | undefined {
  const mots = texte.split(/\s+/).filter(Boolean);
  const bas = mots.map(m => sansAccents(m).replace(/[,;]$/, ''));
  for (let i = 0; i < mots.length; i++) {
    const r = dateA(bas, i, aujourdhui);
    if (!r) continue;
    let fin = r.fin;
    let heure: string | undefined;
    // Heure qui suit : « à 14h », « 14h30 », « 9:00 ».
    if (bas[fin] === 'a' && bas[fin + 1] && lireHeure(bas[fin + 1])) {
      heure = lireHeure(bas[fin + 1]);
      fin += 2;
    } else if (bas[fin] && lireHeure(bas[fin])) {
      heure = lireHeure(bas[fin]);
      fin += 1;
    }
    return { jour: r.jour, ...(heure ? { heure } : {}), texte: mots.slice(i, fin).join(' ') };
  }
  // Heure seule : aujourd'hui (ou demain si elle est passée, laissé à l'appelant).
  for (let i = 0; i < mots.length; i++) {
    if (bas[i] === 'a' && bas[i + 1] && lireHeure(bas[i + 1]) && /h|:/.test(bas[i + 1])) {
      return { jour: aujourdhui, heure: lireHeure(bas[i + 1]), texte: mots.slice(i, i + 2).join(' ') };
    }
  }
  return undefined;
}

function dateA(bas: string[], i: number, aujourdhui: string): { jour: string; fin: number } | undefined {
  const mot = bas[i];
  if (mot === "aujourd'hui" || mot === 'aujourd’hui' || mot === 'aujourdhui' || mot === 'auj') return { jour: aujourdhui, fin: i + 1 };
  if (mot === 'ce' && bas[i + 1] === 'soir') return { jour: aujourdhui, fin: i + 2 };
  if (mot === 'demain') return { jour: ajouterJours(aujourdhui, 1), fin: i + 1 };
  if (mot === 'apres-demain' || (mot === 'apres' && bas[i + 1] === 'demain')) return { jour: ajouterJours(aujourdhui, 2), fin: mot === 'apres' ? i + 2 : i + 1 };
  if (mot === 'hier') return { jour: ajouterJours(aujourdhui, -1), fin: i + 1 };
  // « dans 3 jours », « dans deux semaines », « dans 1 mois », « dans un an »
  if (mot === 'dans' && bas[i + 1] && bas[i + 2]) {
    const n = nombre(bas[i + 1]);
    const unite = bas[i + 2];
    if (n !== undefined && n > 0 && n <= 999) {
      if (/^jours?$/.test(unite)) return { jour: ajouterJours(aujourdhui, n), fin: i + 3 };
      if (/^semaines?$/.test(unite)) return { jour: ajouterJours(aujourdhui, 7 * n), fin: i + 3 };
      if (unite === 'mois') return { jour: ajouterMois(aujourdhui, n), fin: i + 3 };
      if (/^ans?$/.test(unite)) return { jour: ajouterMois(aujourdhui, 12 * n), fin: i + 3 };
    }
  }
  // « semaine prochaine » : lundi suivant.
  if (mot === 'semaine' && bas[i + 1] === 'prochaine') return { jour: ajouterJours(debutSemaine(aujourdhui), 7), fin: i + 2 };
  // « lundi », « lundi prochain » : le prochain (jamais aujourd'hui).
  const iJour = JOURS_SEMAINE.indexOf(mot as (typeof JOURS_SEMAINE)[number]);
  if (iJour >= 0) {
    const cible = iJour + 1;
    let ecart = (cible - jourSemaine(aujourdhui) + 7) % 7;
    if (ecart === 0) ecart = 7;
    const prochain = bas[i + 1] === 'prochain';
    return { jour: ajouterJours(aujourdhui, ecart), fin: prochain ? i + 2 : i + 1 };
  }
  // « 15/11 », « 15/11/2026 », « 15-11 », « 15.11.26 »
  const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(mot);
  if (m) {
    const jour = jourPrecis(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined, aujourdhui);
    return jour ? { jour, fin: i + 1 } : undefined;
  }
  // « 2026-11-15 »
  if (jourValide(mot)) return { jour: mot, fin: i + 1 };
  // « 15 novembre », « 1er mars 2027 », « le 3 juin »
  const n = /^(\d{1,2})(?:er)?$/.exec(mot);
  if (n && bas[i + 1]) {
    const im = indexMois(bas[i + 1]);
    if (im >= 0) {
      const annee = bas[i + 2] && /^\d{4}$/.test(bas[i + 2]) ? Number(bas[i + 2]) : undefined;
      const jour = jourPrecis(Number(n[1]), im + 1, annee, aujourdhui);
      if (jour) return { jour, fin: i + (annee ? 3 : 2) };
    }
  }
  return undefined;
}

/** Lit un champ « date » saisi librement (« demain », « 15/11 », « 2026-11-15 ») ; rien si illisible. */
export function lireDateLibre(texte: string, aujourdhui: string): { jour: string; heure?: string } | undefined {
  const t = texte.trim();
  if (!t) return undefined;
  const r = trouverDate(t, aujourdhui);
  if (!r) return undefined;
  // Tout le texte doit être compris (« demain » oui, « demain matin peut-être » non).
  const reste = sansAccents(t).replace(sansAccents(r.texte), '').replace(/^le\s+/, '').trim();
  if (reste && reste !== 'le') return undefined;
  return { jour: r.jour, ...(r.heure ? { heure: r.heure } : {}) };
}
