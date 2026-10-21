/**
 * Client de la review vidéo et du scouting (phase 5), par l'appel générique
 * du client Esport (`client.requete`). Types miroirs de l'API
 * (esport/noyau/review/service.mjs, esport/noyau/scouting/service.mjs).
 */

import type { ClientEsport, FichierMedia } from '../client';
import type { Dessin } from './dessin';

export type CategorieRepere = 'erreur' | 'bonne_action' | 'utilitaires' | 'placement' | 'comms';
export type SideTendance = 'attaque' | 'defense' | 'les_deux';

export interface PersonneReview {
  compte: string;
  pseudo: string | null;
}

export interface ReviewListee {
  id: string;
  titre: string;
  /** YouTube (url, videoId) ou vidéo déposée sur le site (`video`). */
  source?: 'youtube' | 'fichier';
  url: string;
  videoId: string;
  video?: FichierMedia | null;
  reference: string;
  creePar: PersonneReview | null;
  creeLe: string;
  majLe: string;
  reperes: number;
}

export interface DroitsReview {
  creer: boolean;
  annoter: boolean;
  supprimer: boolean;
  /** Réagir (👍 / 👎) aux repères et aux commentaires (video_review.react). */
  reagir?: boolean;
}

export type ValeurReaction = 'like' | 'dislike';

/** Réactions d'un repère ou d'un commentaire : compteurs, la mienne, et qui a réagi. */
export interface Reactions {
  like: number;
  dislike: number;
  moi: ValeurReaction | null;
  qui: { like: PersonneReview[]; dislike: PersonneReview[] };
}

export const SANS_REACTION: Reactions = { like: 0, dislike: 0, moi: null, qui: { like: [], dislike: [] } };

export interface CommentaireRepere {
  id: string;
  texte: string;
  auteur: PersonneReview | null;
  creeLe: string;
  peutSupprimer: boolean;
  reactions?: Reactions;
}

export interface Repere {
  id: string;
  debut: number;
  fin: number | null;
  categorie: CategorieRepere;
  titre: string;
  note: string;
  /** Dessin posé sur la vidéo à cet instant (coordonnées relatives), ou null. */
  dessin?: Dessin | null;
  cible: PersonneReview | null;
  auteur: PersonneReview | null;
  creeLe: string;
  majLe: string;
  peutModifier: boolean;
  peutSupprimer: boolean;
  reactions?: Reactions;
  commentaires: CommentaireRepere[];
}

export interface DetailReview {
  review: Omit<ReviewListee, 'reperes'>;
  reperes: Repere[];
  membres: Array<{ compte: string; pseudo: string }>;
  droits: DroitsReview;
  moi: string;
  equipe: string;
}

export interface SaisieRepere {
  debut: number;
  fin?: number | null;
  duree?: number | null;
  categorie: CategorieRepere;
  titre: string;
  note?: string;
  cible?: string | null;
  dessin?: Dessin | null;
}

export interface FichierExporte {
  nom: string;
  type: string;
  contenu: string;
}

export interface AdversaireListe {
  id: string;
  nom: string;
  logoUrl: string | null;
  notes: string;
  creeLe: string;
  majLe: string;
  joueurs: number;
  vods: number;
  confrontations: number | null;
  derniere: string | null;
}

export interface JoueurAdverse {
  id: string;
  pseudo: string;
  riotId: string;
  role: string;
  agents: string[];
  notes: string;
}

export interface TendanceMap {
  id: string;
  map: string;
  side: SideTendance;
  notes: string;
  tauxVictoire: number | null;
  compos: string[][];
}

export interface VodAdverse {
  id: string;
  url: string;
  titre: string;
  youtube: boolean;
  reviewId: string | null;
}

export interface Confrontation {
  id: string;
  titre: string;
  type: string;
  debut: string;
  fin: string;
  fuseau: string;
  recurrent: boolean;
  reviewId: string | null;
}

export interface DetailAdversaire {
  adversaire: { id: string; nom: string; logoUrl: string | null; notes: string; creeLe: string; majLe: string };
  joueurs: JoueurAdverse[];
  tendances: TendanceMap[];
  vods: VodAdverse[];
  /** `null` : l'acteur ne voit pas le planning. */
  confrontations: Confrontation[] | null;
  droits: { gerer: boolean; creerReview: boolean; voirReview: boolean };
}

export interface SaisieJoueur {
  pseudo: string;
  riotId?: string;
  role?: string;
  agents?: string[];
  notes?: string;
}
export interface SaisieTendance {
  map: string;
  side: SideTendance;
  notes?: string;
  tauxVictoire?: number | null;
  compos?: string[][];
}
export interface SaisieVod {
  url: string;
  titre: string;
}

const e = encodeURIComponent;

export function apiReview(client: ClientEsport, teamId: string) {
  const t = `/teams/${e(teamId)}/review`;
  return {
    liste: () => client.requete<{ reviews: ReviewListee[]; droits: DroitsReview }>(t),
    /** YouTube (`url`) ou vidéo déposée (`envoi` : envoi par morceaux terminé). */
    creer: (s: { titre: string; url?: string; envoi?: string; reference?: string }) => client.requete<ReviewListee & { depart: number | null }>(t, 'POST', s),
    /** Lien signé (2 h) de la vidéo déposée (lecture en streaming). */
    lienVideo: (id: string) => client.requete<{ url: string; expire: string }>(`${t}/${e(id)}/video/lien`, 'POST', {}),
    detail: (id: string) => client.requete<DetailReview>(`${t}/${e(id)}`),
    modifier: (id: string, s: { titre?: string; reference?: string }) => client.requete<ReviewListee>(`${t}/${e(id)}`, 'PATCH', s),
    supprimer: (id: string) => client.requete<{ ok: true }>(`${t}/${e(id)}`, 'DELETE'),
    ajouterRepere: (id: string, s: SaisieRepere) => client.requete<Repere>(`${t}/${e(id)}/reperes`, 'POST', s),
    modifierRepere: (id: string, repere: string, s: Partial<SaisieRepere>) => client.requete<Repere>(`${t}/${e(id)}/reperes/${e(repere)}`, 'PATCH', s),
    supprimerRepere: (id: string, repere: string) => client.requete<{ ok: true }>(`${t}/${e(id)}/reperes/${e(repere)}`, 'DELETE'),
    commenter: (id: string, repere: string, texte: string) => client.requete<Repere>(`${t}/${e(id)}/reperes/${e(repere)}/commentaires`, 'POST', { texte }),
    supprimerCommentaire: (id: string, repere: string, commentaire: string) =>
      client.requete<Repere>(`${t}/${e(id)}/reperes/${e(repere)}/commentaires/${e(commentaire)}`, 'DELETE'),
    exporter: (id: string) => client.requete<FichierExporte>(`${t}/${e(id)}/export.md?format=json`),
    /** Réaction au repère (`null` : retirer). */
    reagir: (id: string, repere: string, valeur: ValeurReaction | null) => client.requete<Repere>(`${t}/${e(id)}/reperes/${e(repere)}/reaction`, 'PUT', { valeur }),
    /** Réaction à un commentaire du repère (`null` : retirer). */
    reagirCommentaire: (id: string, repere: string, commentaire: string, valeur: ValeurReaction | null) =>
      client.requete<Repere>(`${t}/${e(id)}/reperes/${e(repere)}/commentaires/${e(commentaire)}/reaction`, 'PUT', { valeur }),
  };
}
export type ApiReview = ReturnType<typeof apiReview>;

export function apiScouting(client: ClientEsport, teamId: string) {
  const t = `/teams/${e(teamId)}/scouting/adversaires`;
  const a = (id: string) => `${t}/${e(id)}`;
  return {
    liste: () => client.requete<{ adversaires: AdversaireListe[]; droits: { gerer: boolean } }>(t),
    creer: (s: { nom: string; logoUrl?: string | null; notes?: string }) => client.requete<DetailAdversaire['adversaire']>(t, 'POST', s),
    detail: (id: string) => client.requete<DetailAdversaire>(a(id)),
    modifier: (id: string, s: { nom?: string; logoUrl?: string | null; notes?: string }) => client.requete<DetailAdversaire['adversaire']>(a(id), 'PATCH', s),
    supprimer: (id: string) => client.requete<{ ok: true }>(a(id), 'DELETE'),
    ajouterJoueur: (id: string, s: SaisieJoueur) => client.requete<{ id: string }>(`${a(id)}/joueurs`, 'POST', s),
    modifierJoueur: (id: string, x: string, s: Partial<SaisieJoueur>) => client.requete<{ id: string }>(`${a(id)}/joueurs/${e(x)}`, 'PATCH', s),
    supprimerJoueur: (id: string, x: string) => client.requete<{ ok: true }>(`${a(id)}/joueurs/${e(x)}`, 'DELETE'),
    ajouterTendance: (id: string, s: SaisieTendance) => client.requete<{ id: string }>(`${a(id)}/tendances`, 'POST', s),
    modifierTendance: (id: string, x: string, s: Partial<SaisieTendance>) => client.requete<{ id: string }>(`${a(id)}/tendances/${e(x)}`, 'PATCH', s),
    supprimerTendance: (id: string, x: string) => client.requete<{ ok: true }>(`${a(id)}/tendances/${e(x)}`, 'DELETE'),
    ajouterVod: (id: string, s: SaisieVod) => client.requete<{ id: string }>(`${a(id)}/vods`, 'POST', s),
    modifierVod: (id: string, x: string, s: Partial<SaisieVod>) => client.requete<{ id: string }>(`${a(id)}/vods/${e(x)}`, 'PATCH', s),
    supprimerVod: (id: string, x: string) => client.requete<{ ok: true }>(`${a(id)}/vods/${e(x)}`, 'DELETE'),
    ouvrirVodEnReview: (id: string, x: string, reviewId?: string) => client.requete<{ reviewId: string; cree: boolean }>(`${a(id)}/vods/${e(x)}/review`, 'POST', reviewId ? { reviewId } : {}),
  };
}
export type ApiScouting = ReturnType<typeof apiScouting>;
