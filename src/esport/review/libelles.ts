/**
 * Libellés, couleurs et temps de la review vidéo et du scouting (purs, testés),
 * et phrases du journal et des notifications.
 */

import type { CategorieRepere, Reactions, SideTendance } from './api';

export interface InfoCategorie {
  cle: CategorieRepere;
  nom: string;
  /** Teinte fixe (lisible sur fond clair et sombre) ; le glyphe double l'information pour le daltonisme. */
  couleur: string;
  glyphe: string;
}

export const CATEGORIES: readonly InfoCategorie[] = [
  { cle: 'erreur', nom: 'Erreur', couleur: '#E5484D', glyphe: '✕' },
  { cle: 'bonne_action', nom: 'Bonne action', couleur: '#30A46C', glyphe: '✓' },
  { cle: 'utilitaires', nom: 'Utilitaires', couleur: '#3E63DD', glyphe: '◆' },
  { cle: 'placement', nom: 'Placement', couleur: '#F5A524', glyphe: '⌖' },
  { cle: 'comms', nom: 'Comms', couleur: '#AB4ABA', glyphe: '✉' },
];

export const categorie = (cle: string): InfoCategorie => CATEGORIES.find(c => c.cle === cle) ?? CATEGORIES[0];

export const SIDES: ReadonlyArray<readonly [SideTendance, string]> = [
  ['attaque', 'Attaque'],
  ['defense', 'Défense'],
  ['les_deux', 'Les deux'],
];
export const nomSide = (s: string): string => SIDES.find(([c]) => c === s)?.[1] ?? s;

const deux = (n: number) => String(Math.floor(n)).padStart(2, '0');

/** 83.4 → « 01:23 » ; 3725 → « 1:02:05 ». */
export function formatTemps(secondes: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(secondes) ? secondes : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${deux(m)}:${deux(s % 60)}` : `${deux(m)}:${deux(s % 60)}`;
}

/** Saisie « 1:23 », « 1:02:05 », « 83 », « 1m23s » → secondes (ou undefined). */
export function lireTemps(texte: string): number | undefined {
  const t = texte.trim().toLowerCase();
  if (!t) return undefined;
  if (/^\d{1,6}([.,]\d)?$/.test(t)) return Number(t.replace(',', '.'));
  let m = /^(\d{1,2}):(\d{1,2})$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d{1,3}):(\d{1,2}):(\d{1,2})$/.exec(t);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  m = /^(?:(\d{1,3})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s)?$/.exec(t);
  if (m) return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return undefined;
}

/** Repère « actif » à l'instant `t` : le dernier qui a commencé, tant que son intervalle (ou 8 s) n'est pas fini. */
export function repereActif<T extends { debut: number; fin: number | null }>(reperes: readonly T[], t: number, duree = 8): T | undefined {
  let actif: T | undefined;
  for (const r of reperes) {
    if (r.debut <= t + 0.05 && t <= (r.fin ?? r.debut + duree)) actif = r;
  }
  return actif;
}

export type TriReperes = 'instant' | 'likes' | 'dislikes';

export const TRIS_REPERES: ReadonlyArray<readonly [TriReperes, string]> = [
  ['instant', 'Par instant'],
  ['likes', 'Plus likés 👍'],
  ['dislikes', 'Plus dislikés 👎'],
];

/** Tri de la liste des repères : par instant (ordre du serveur), ou par réactions (à égalité, par instant). */
export function trierReperes<T extends { debut: number; reactions?: Reactions }>(reperes: readonly T[], tri: TriReperes): T[] {
  if (tri === 'instant') return [...reperes];
  const cle = tri === 'likes' ? 'like' : 'dislike';
  return [...reperes].sort((a, b) => (b.reactions?.[cle] ?? 0) - (a.reactions?.[cle] ?? 0) || a.debut - b.debut);
}

/** Position (0 à 100 %) d'un instant sur la timeline. */
export const positionPourcent = (t: number, total: number): number => (total > 0 ? Math.max(0, Math.min(100, (t / total) * 100)) : 0);

const texte = (v: unknown, repli = '?') => (typeof v === 'string' && v ? v : repli);

/** Phrase du journal pour les actions de la review et du scouting (undefined : pas la nôtre). */
export function phraseJournalReview(action: string, qui: string, m: Record<string, unknown>): string | undefined {
  switch (action) {
    case 'review.created':
      return `${qui} a créé la review « ${texte(m.titre)} »${m.depuisVod ? ' (depuis une VOD de scouting)' : ''}`;
    case 'review.updated':
      return `${qui} a modifié la review « ${texte(m.titre)} »`;
    case 'review.deleted':
      return `${qui} a supprimé la review « ${texte(m.titre)} »`;
    case 'review.marker_added':
      return `${qui} a ajouté le repère « ${texte(m.titre)} » (${categorie(texte(m.categorie)).nom}, ${formatTemps(Number(m.debut) || 0)}) à « ${texte(m.review)} »`;
    case 'review.marker_updated':
      return `${qui} a modifié le repère « ${texte(m.titre)} » de « ${texte(m.review)} »`;
    case 'review.marker_deleted':
      return `${qui} a supprimé le repère « ${texte(m.titre)} » de « ${texte(m.review)} »`;
    case 'review.comment_added':
      return `${qui} a commenté le repère « ${texte(m.repereTitre)} » de « ${texte(m.titre)} »`;
    case 'review.comment_deleted':
      return `${qui} a supprimé un commentaire de « ${texte(m.titre)} »`;
    case 'review.reaction_changed': {
      const sur = m.cible === 'commentaire' ? `un commentaire du repère « ${texte(m.repereTitre)} »` : `le repère « ${texte(m.repereTitre)} »`;
      const quoi = m.valeur === 'like' ? 'aime 👍' : m.valeur === 'dislike' ? 'n’aime pas 👎' : 'a retiré sa réaction à';
      return `${qui} ${quoi} ${sur} de « ${texte(m.review)} »`;
    }
    case 'opponent.created':
      return `${qui} a créé la fiche adversaire « ${texte(m.nom)} »`;
    case 'opponent.updated':
      return `${qui} a modifié la fiche adversaire « ${texte(m.nom)} »`;
    case 'opponent.deleted':
      return `${qui} a supprimé la fiche adversaire « ${texte(m.nom)} »`;
    case 'opponent.detail_changed': {
      const partie = ({ joueur: 'un joueur', tendance: 'une tendance', vod: 'une VOD' } as Record<string, string>)[texte(m.partie, '')] ?? 'un élément';
      const act = ({ ajout: 'a ajouté', modification: 'a modifié', suppression: 'a supprimé', review: 'a ouvert en review', liaison: 'a lié à une review' } as Record<string, string>)[texte(m.action, '')] ?? 'a changé';
      return `${qui} ${act} ${partie} (« ${texte(m.nom)} ») de la fiche « ${texte(m.adversaire)} »`;
    }
    default:
      return undefined;
  }
}

/** Phrase d'une notification de review (undefined : pas la nôtre). */
export function phraseNotificationReview(type: string, team: string, c: Record<string, unknown>): string | undefined {
  if (type === 'review-nouvelle') return `Nouvelle review « ${texte(c.titre, 'sans titre')} » (${team})`;
  if (type === 'review-commentaire') return `Nouveau commentaire sur votre repère « ${texte(c.repere, 'sans titre')} » (${team})`;
  return undefined;
}
