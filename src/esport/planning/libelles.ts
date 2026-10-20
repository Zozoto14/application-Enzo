/**
 * Libellés, couleurs et dates du planning (purs, testés). Les dates civiles
 * sont des textes « AAAA-MM-JJ » : l'arithmétique se fait en UTC, sans fuseau
 * (le serveur rend déjà les dates locales de chaque occurrence).
 */

import type { Recurrence, Reel, Rsvp, TypeEvenement } from './api';

/** Types d'événements : libellé et couleur (lisible sur fond clair comme sombre). */
export const TYPES_EVENEMENT: ReadonlyArray<{ cle: TypeEvenement; nom: string; couleur: string }> = [
  { cle: 'training', nom: 'Entraînement', couleur: '#2563eb' },
  { cle: 'scrim', nom: 'Scrim', couleur: '#7c3aed' },
  { cle: 'match', nom: 'Match', couleur: '#dc2626' },
  { cle: 'tournament', nom: 'Tournoi', couleur: '#d97706' },
  { cle: 'meeting', nom: 'Réunion', couleur: '#0891b2' },
  { cle: 'other', nom: 'Autre', couleur: '#64748b' },
];

export const typeEvenement = (cle: string) => TYPES_EVENEMENT.find(t => t.cle === cle) ?? TYPES_EVENEMENT[TYPES_EVENEMENT.length - 1];

export const LIBELLES_RSVP: Record<Rsvp, string> = { oui: 'Oui', peut_etre: 'Peut-être', non: 'Non', sans_reponse: 'Sans réponse' };
export const LIBELLES_REEL: Record<Reel, string> = { present: 'Présent', retard: 'En retard', absent: 'Absent', excuse: 'Excusé', inconnu: 'Non marqué' };

export const JOURS_COURTS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
export const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// ------------------------------------------------------------------ Dates civiles

const parties = (d: string) => d.split('-').map(Number) as [number, number, number];
const versTexte = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utc = (d: string) => {
  const [a, m, j] = parties(d);
  return Date.UTC(a, m - 1, j);
};

export const dateValide = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d) && versTexte(utc(d)) === d;
export const heureValide = (h: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(h) || h === '24:00';
export const ajouterJours = (d: string, n: number): string => versTexte(utc(d) + n * 86_400_000);
/** Jour ISO : 1 = lundi … 7 = dimanche. */
export const jourSemaine = (d: string): number => new Date(utc(d)).getUTCDay() || 7;
export const lundiDe = (d: string): string => ajouterJours(d, 1 - jourSemaine(d));
export const premierDuMois = (d: string): string => `${d.slice(0, 8)}01`;
export function moisVoisin(d: string, n: number): string {
  const [a, m] = parties(d);
  const x = new Date(Date.UTC(a, m - 1 + n, 1));
  return versTexte(x.getTime());
}
/** Les 42 jours (6 semaines, du lundi) qui couvrent le mois de `d`. */
export const grilleMois = (d: string): string[] => {
  const debut = lundiDe(premierDuMois(d));
  return Array.from({ length: 42 }, (_, i) => ajouterJours(debut, i));
};
export const nomMois = (d: string): string => {
  const [a, m] = parties(d);
  return `${MOIS[m - 1]} ${a}`;
};
/** « mardi 20 octobre » */
export const dateLongue = (d: string): string => {
  const [, m, j] = parties(d);
  return `${JOURS[jourSemaine(d) - 1]} ${j} ${MOIS[m - 1]}`;
};
/** « mar. 20/10 » */
export const dateCourteJour = (d: string): string => `${JOURS[jourSemaine(d) - 1].slice(0, 3)}. ${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Fuseau de l'appareil (IANA), « UTC » à défaut. */
export function fuseauAppareil(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Date civile d'aujourd'hui dans un fuseau. */
export function aujourdhui(fuseau: string, maintenant: number = Date.now()): string {
  try {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(maintenant)).map(x => [x.type, x.value]),
    );
    if (p.year && p.month && p.day) return `${p.year}-${p.month}-${p.day}`;
  } catch {
    // Fuseau inconnu du moteur : date de l'appareil.
  }
  const d = new Date(maintenant);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Nom court d'un fuseau : « Europe/Paris » → « Paris ». */
export const nomFuseau = (f: string): string => (f.split('/').pop() ?? f).replace(/_/g, ' ');

// ------------------------------------------------------------------ Textes

export const pourcentage = (taux: number | null | undefined): string => (taux === null || taux === undefined ? '—' : `${Math.round(taux * 100)} %`);

export function resumeRecurrence(r: Recurrence | null | undefined): string {
  if (!r) return 'Une seule fois';
  const jours = r.jours.map(j => JOURS[j - 1]).join(', ');
  const rythme = r.intervalle > 1 ? `Toutes les ${r.intervalle} semaines` : 'Chaque semaine';
  const fin = r.jusqua ? ` · jusqu’au ${r.jusqua.slice(8, 10)}/${r.jusqua.slice(5, 7)}/${r.jusqua.slice(0, 4)}` : r.nombre ? ` · ${r.nombre} fois` : '';
  return `${rythme} : ${jours}${fin}`;
}

const texte = (v: unknown): string => (typeof v === 'string' ? v : '?');

/** Phrase du journal pour une action du planning (ou `undefined`). */
export function phraseJournalPlanning(action: string, qui: string, m: Record<string, unknown>, nom: (id: unknown) => string): string | undefined {
  switch (action) {
    case 'event.created':
      return `${qui} a créé « ${texte(m.titre)} » (${typeEvenement(texte(m.type)).nom}${m.recurrent ? ', récurrent' : ''})`;
    case 'event.updated':
      return `${qui} a modifié « ${texte(m.titre)} »`;
    case 'event.deleted':
      return `${qui} a supprimé « ${texte(m.titre)} »`;
    case 'event.occurrence_updated':
      return `${qui} a modifié une date de « ${texte(m.titre)} »`;
    case 'event.occurrence_cancelled':
      return m.suivantes ? `${qui} a arrêté la série « ${texte(m.titre)} »` : `${qui} a annulé une date de « ${texte(m.titre)} »`;
    case 'attendance.rsvp':
      return `${qui} a répondu « ${LIBELLES_RSVP[m.rsvp as Rsvp] ?? '?'} » pour « ${texte(m.titre)} »`;
    case 'attendance.marked':
      return `${qui} a marqué la présence de « ${texte(m.titre)} »`;
    case 'attendance.reminder':
      return `Rappel de réponse envoyé à ${nom(m.compte)} pour « ${texte(m.titre)} »`;
    case 'availability.updated':
      return `${qui} a mis à jour ses disponibilités`;
    case 'availability.settings_changed':
      return `${qui} a changé les réglages du planning (effectif minimum ${String(m.effectifMin ?? '?')})`;
    case 'ical.token_created':
      return `${qui} a créé un abonnement au calendrier`;
    case 'ical.token_revoked':
      return `${qui} a révoqué un abonnement au calendrier`;
    default:
      return undefined;
  }
}

/** Phrase d'une notification du planning (ou `undefined`). */
export function phraseNotificationPlanning(type: string, team: string, c: Record<string, unknown>): string | undefined {
  const quand = typeof c.debut === 'string' ? ` (${new Date(c.debut).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })})` : '';
  switch (type) {
    case 'evenement-nouveau':
      return `Nouvel événement dans ${team} : ${texte(c.titre)}${quand}`;
    case 'evenement-modifie':
      return `${team} : « ${texte(c.titre)} » a changé${quand}`;
    case 'evenement-annule':
      return `${team} : « ${texte(c.titre)} » est annulé${quand}`;
    case 'rappel-rsvp':
      return `Serez-vous là ? ${texte(c.titre)}${quand} · ${team}`;
    default:
      return undefined;
  }
}
