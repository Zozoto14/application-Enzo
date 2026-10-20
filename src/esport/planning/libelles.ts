/**
 * Libellés, couleurs et dates du planning (purs, testés). Les dates civiles
 * sont des textes « AAAA-MM-JJ » : l'arithmétique se fait en UTC, sans fuseau
 * (le serveur rend déjà les dates locales de chaque occurrence).
 */

import type { Recurrence, Reel, Rsvp, TypeEvenement } from './api';
import { formaterDate, tr } from '../i18n';

/** Types d'événements : libellé et couleur (lisible sur fond clair comme sombre). */
export const TYPES_EVENEMENT: ReadonlyArray<{ cle: TypeEvenement; nom: string; couleur: string }> = [
  { cle: 'training', get nom() {
      return tr('planning.libelles.entrainement');
    }, couleur: '#2563eb' },
  { cle: 'scrim', get nom() {
      return tr('planning.disponibilites.scrim');
    }, couleur: '#7c3aed' },
  { cle: 'match', get nom() {
      return tr('planning.libelles.match');
    }, couleur: '#dc2626' },
  { cle: 'tournament', get nom() {
      return tr('planning.libelles.tournoi');
    }, couleur: '#d97706' },
  { cle: 'meeting', get nom() {
      return tr('planning.libelles.reunion');
    }, couleur: '#0891b2' },
  { cle: 'other', get nom() {
      return tr('planning.libelles.autre');
    }, couleur: '#64748b' },
];

export const typeEvenement = (cle: string) => TYPES_EVENEMENT.find(t => t.cle === cle) ?? TYPES_EVENEMENT[TYPES_EVENEMENT.length - 1];

export const LIBELLES_RSVP: Record<Rsvp, string> = { get oui() {
      return tr('objectifs.oui');
    }, get peut_etre() {
      return tr('planning.libelles.peut_etre');
    }, get non() {
      return tr('planning.libelles.non');
    }, get sans_reponse() {
      return tr('planning.libelles.sans_reponse');
    } };
export const LIBELLES_REEL: Record<Reel, string> = { get present() {
      return tr('planning.libelles.present');
    }, get retard() {
      return tr('libelles.en_retard');
    }, get absent() {
      return tr('planning.libelles.absent');
    }, get excuse() {
      return tr('planning.libelles.excuse');
    }, get inconnu() {
      return tr('planning.libelles.non_marque');
    } };

/** Nom d'un jour ISO (1 = lundi … 7 = dimanche) dans la langue courante. */
export const nomJour = (iso: number, style: 'long' | 'short' | 'narrow' = 'long'): string => formaterDate(Date.UTC(2024, 0, iso), { weekday: style, timeZone: 'UTC' });
/** Les sept jours, du lundi au dimanche : « lundi » … ou « Monday » … */
export const joursSemaine = (): string[] => [1, 2, 3, 4, 5, 6, 7].map(i => nomJour(i));
/** Initiales des jours : « L M M J V S D » ou « M T W T F S S ». */
export const joursCourts = (): string[] => [1, 2, 3, 4, 5, 6, 7].map(i => nomJour(i, 'narrow'));
const nomDuMois = (m: number): string => formaterDate(Date.UTC(2024, m - 1, 1), { month: 'long', timeZone: 'UTC' });

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
/** « octobre 2026 » / « October 2026 » */
export const nomMois = (d: string): string => {
  const [a, m] = parties(d);
  return `${nomDuMois(m)} ${a}`;
};
/** « mardi 20 octobre » / « Tuesday 20 October » */
export const dateLongue = (d: string): string => {
  const [, m, j] = parties(d);
  return `${nomJour(jourSemaine(d))} ${j} ${nomDuMois(m)}`;
};
/** « mar. 20/10 » / « Tue 20/10 » */
export const dateCourteJour = (d: string): string => `${nomJour(jourSemaine(d), 'short')} ${d.slice(8, 10)}/${d.slice(5, 7)}`;

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
  if (!r) return tr('planning.libelles.une_seule_fois');
  const jours = r.jours.map(j => nomJour(j)).join(', ');
  const rythme = r.intervalle > 1 ? tr('planning.libelles.toutes_les_semaines', { intervalle: r.intervalle }) : tr('planning.libelles.chaque_semaine');
  const fin = r.jusqua ? tr('planning.libelles.jusqu_au', { jour: r.jusqua.slice(8, 10), mois: r.jusqua.slice(5, 7), annee: r.jusqua.slice(0, 4) }) : r.nombre ? tr('planning.libelles.n_fois', { n: r.nombre }) : '';
  return tr('planning.libelles.recurrence', { rythme, jours, fin });
}

const texte = (v: unknown): string => (typeof v === 'string' ? v : '?');

/** Phrase du journal pour une action du planning (ou `undefined`). */
export function phraseJournalPlanning(action: string, qui: string, m: Record<string, unknown>, nom: (id: unknown) => string): string | undefined {
  switch (action) {
    case 'event.created':
      return tr(m.recurrent ? 'planning.libelles.a_cree_recurrent' : 'planning.libelles.a_cree', { qui, titre: texte(m.titre), type: typeEvenement(texte(m.type)).nom });
    case 'event.updated':
      return tr('planning.libelles.a_modifie', { qui, v: texte(m.titre) });
    case 'event.deleted':
      return tr('planning.libelles.a_supprime', { qui, v: texte(m.titre) });
    case 'event.occurrence_updated':
      return tr('planning.libelles.a_modifie_une_date', { qui, v: texte(m.titre) });
    case 'event.occurrence_cancelled':
      return m.suivantes ? tr('planning.libelles.a_arrete_la_serie', { qui, v: texte(m.titre) }) : tr('planning.libelles.a_annule_une_date', { qui, v: texte(m.titre) });
    case 'attendance.rsvp':
      return tr('planning.libelles.a_repondu', { qui, reponse: LIBELLES_RSVP[m.rsvp as Rsvp] ?? '?', titre: texte(m.titre) });
    case 'attendance.marked':
      return tr('planning.libelles.a_marque_la_presence', { qui, v: texte(m.titre) });
    case 'attendance.reminder':
      return tr('planning.libelles.rappel_de_reponse_envoye', { v: nom(m.compte), v2: texte(m.titre) });
    case 'availability.updated':
      return tr('planning.libelles.a_mis_a_jour', { qui });
    case 'availability.settings_changed':
      return tr('planning.libelles.reglages_changes', { qui, min: String(m.effectifMin ?? '?') });
    case 'ical.token_created':
      return tr('planning.libelles.a_cree_un_abonnement', { qui });
    case 'ical.token_revoked':
      return tr('planning.libelles.a_revoque_un_abonnement', { qui });
    default:
      return undefined;
  }
}

/** Phrase d'une notification du planning (ou `undefined`). */
export function phraseNotificationPlanning(type: string, team: string, c: Record<string, unknown>): string | undefined {
  const quand = typeof c.debut === 'string' ? ` (${formaterDate(new Date(c.debut), { weekday: 'short', day: 'numeric', month: 'short' })})` : '';
  switch (type) {
    case 'evenement-nouveau':
      return tr('planning.libelles.nouvel_evenement_dans', { team, v: texte(c.titre), quand });
    case 'evenement-modifie':
      return tr('planning.libelles.a_change', { team, v: texte(c.titre), quand });
    case 'evenement-annule':
      return tr('planning.libelles.est_annule', { team, v: texte(c.titre), quand });
    case 'rappel-rsvp':
      return tr('planning.libelles.serez_vous_la', { v: texte(c.titre), quand, team });
    default:
      return undefined;
  }
}
