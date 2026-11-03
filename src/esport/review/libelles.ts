/**
 * Libellés, couleurs et temps de la review vidéo et du scouting (purs, testés),
 * et phrases du journal et des notifications.
 */

import type { CategorieRepere, Reactions, SideTendance } from './api';
import { tr, type Cle } from '../i18n';

export interface InfoCategorie {
  cle: CategorieRepere;
  nom: string;
  /** Teinte fixe (lisible sur fond clair et sombre) ; le glyphe double l'information pour le daltonisme. */
  couleur: string;
  glyphe: string;
}

export const CATEGORIES: readonly InfoCategorie[] = [
  { cle: 'erreur', get nom() {
      return tr('review.libelles.erreur');
    }, couleur: '#E5484D', glyphe: '✕' },
  { cle: 'bonne_action', get nom() {
      return tr('review.libelles.bonne_action');
    }, couleur: '#30A46C', glyphe: '✓' },
  { cle: 'utilitaires', get nom() {
      return tr('review.libelles.utilitaires');
    }, couleur: '#3E63DD', glyphe: '◆' },
  { cle: 'placement', get nom() {
      return tr('review.libelles.placement');
    }, couleur: '#F5A524', glyphe: '⌖' },
  { cle: 'comms', get nom() {
      return tr('review.libelles.comms');
    }, couleur: '#AB4ABA', glyphe: '✉︎' },
];

export const categorie = (cle: string): InfoCategorie => CATEGORIES.find(c => c.cle === cle) ?? CATEGORIES[0];

export const sidesTendance = (): ReadonlyArray<readonly [SideTendance, string]> => [
  ['attaque', tr('strats.editeur.attaque')],
  ['defense', tr('strats.editeur.defense')],
  ['les_deux', tr('strats.playbook.les_deux')],
];
export const nomSide = (s: string): string => sidesTendance().find(([c]) => c === s)?.[1] ?? s;

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

export const trisReperes = (): ReadonlyArray<readonly [TriReperes, string]> => [
  ['instant', tr('review.libelles.par_instant')],
  ['likes', tr('review.libelles.plus_likes')],
  ['dislikes', tr('review.libelles.plus_dislikes')],
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
      return tr('review.libelles.a_cree_la_review', { qui, titre: texte(m.titre), vod: m.depuisVod ? tr('review.libelles.depuis_une_vod_de') : '' });
    case 'review.updated':
      return tr('review.libelles.a_modifie_la_review', { qui, v: texte(m.titre) });
    case 'review.deleted':
      return tr('review.libelles.a_supprime_la_review', { qui, v: texte(m.titre) });
    case 'review.marker_added':
      return tr('review.libelles.a_ajoute_le_repere', { qui, titre: texte(m.titre), categorie: categorie(texte(m.categorie)).nom, temps: formatTemps(Number(m.debut) || 0), review: texte(m.review) });
    case 'review.marker_updated':
      return tr('review.libelles.a_modifie_le_repere', { qui, v: texte(m.titre), v2: texte(m.review) });
    case 'review.marker_deleted':
      return tr('review.libelles.a_supprime_le_repere', { qui, v: texte(m.titre), v2: texte(m.review) });
    case 'review.comment_added':
      return tr('review.libelles.a_commente_le_repere', { qui, v: texte(m.repereTitre), v2: texte(m.titre) });
    case 'review.comment_deleted':
      return tr('review.libelles.a_supprime_un_commentaire', { qui, v: texte(m.titre) });
    case 'review.reaction_changed': {
      const cle = m.valeur === 'like' ? 'like' : m.valeur === 'dislike' ? 'dislike' : 'retrait';
      return tr(`review.libelles.reaction_${cle}_${m.cible === 'commentaire' ? 'commentaire' : 'repere'}` as Cle, { qui, repere: texte(m.repereTitre), review: texte(m.review) });
    }
    case 'opponent.created':
      return tr('review.libelles.a_cree_la_fiche', { qui, v: texte(m.nom) });
    case 'opponent.updated':
      return tr('review.libelles.a_modifie_la_fiche', { qui, v: texte(m.nom) });
    case 'opponent.deleted':
      return tr('review.libelles.a_supprime_la_fiche', { qui, v: texte(m.nom) });
    case 'opponent.detail_changed': {
      const partie = ({ joueur: tr('review.libelles.un_joueur'), tendance: tr('review.libelles.une_tendance'), vod: tr('review.libelles.une_vod') } as Record<string, string>)[texte(m.partie, '')] ?? tr('review.libelles.un_element');
      const act = ['ajout', 'modification', 'suppression', 'review', 'liaison'].includes(texte(m.action, '')) ? texte(m.action, '') : 'autre';
      return tr(`review.libelles.fiche_${act}` as Cle, { qui, partie, nom: texte(m.nom), adversaire: texte(m.adversaire) });
    }
    default:
      return undefined;
  }
}

/** Phrase d'une notification de review (undefined : pas la nôtre). */
export function phraseNotificationReview(type: string, team: string, c: Record<string, unknown>): string | undefined {
  if (type === 'review-nouvelle') return tr('review.libelles.nouvelle_review', { titre: texte(c.titre, tr('review.libelles.sans_titre')), team });
  if (type === 'review-commentaire') return tr('review.libelles.nouveau_commentaire', { repere: texte(c.repere, tr('review.libelles.sans_titre')), team });
  return undefined;
}
