/**
 * Client de l'assistant d'écriture (serveur : esport/noyau/ia/ecriture.mjs ; docs/esport/ia-api.md, « Assistant
 * d'écriture ») et logique pure de l'aperçu (différences mot à mot).
 *
 * Seul le texte du champ part (jamais la conversation d'un ticket ni d'autre contexte), et seulement au clic.
 */

import type { ClientEsport } from '../client';

export type ModeEcriture = 'corriger' | 'traduire-en' | 'traduire-fr' | 'reformuler';
export const MODES_ECRITURE: readonly ModeEcriture[] = ['corriger', 'traduire-en', 'traduire-fr', 'reformuler'];

/**
 * Champs où l'assistant est permis (même liste que le serveur). Les champs confidentiels (notes de réunion,
 * transcriptions, résumés, notes du staff, strats, notes internes des tickets, journal) n'en ont pas : le serveur
 * les refuse de toute façon.
 */
export type ChampEcriture =
  | 'tickets.reponse'
  | 'tickets.mention'
  | 'tickets.messages'
  | 'cm.post'
  | 'cm.carte'
  | 'cm.commentaire'
  | 'discord.annonce'
  | 'devblog'
  | 'evenements.description'
  | 'planning.description'
  | 'team.description'
  | 'messagerie';

export interface EtatEcriture {
  actif: boolean;
  autorise: boolean;
  disponible: boolean;
  champs: string[];
  tailleMax: number;
  modes: ModeEcriture[];
}
export interface ResultatEcriture {
  texte: string;
  mode: ModeEcriture;
  moteur: 'api' | 'api2' | 'claude' | 'local' | null;
  fournisseur: string | null;
  inchange: boolean;
}
export interface ReglagesEcriture {
  actif: boolean;
  groupes: string[];
  /** Personnes ajoutées une à une (comptes) ; par défaut aucune : le Fondateur seul. */
  comptes?: string[];
  groupesPossibles: Array<{ cle: string; libelle: string }>;
}

export const TAILLE_MAX_ECRITURE = 6000;
/** Attente maximale de la réponse de l'IA (le serveur coupe à 75 s). */
export const DELAI_ECRITURE_MS = 90_000;

export function apiEcriture(client: ClientEsport) {
  return {
    etat: () => client.requete<EtatEcriture>('/ia/ecriture'),
    traiter: (mode: ModeEcriture, champ: ChampEcriture, texte: string) => client.requete<ResultatEcriture>('/ia/ecriture', 'POST', { mode, champ, texte }, { delai: DELAI_ECRITURE_MS }),
    reglages: () => client.requete<ReglagesEcriture>('/ia/ecriture/reglages'),
    regler: (r: { actif?: boolean; groupes?: string[]; comptes?: string[] }) => client.requete<ReglagesEcriture>('/ia/ecriture/reglages', 'PUT', r),
  };
}

/** État de l'assistant pour ce client : une seule requête par client (partagée par tous les champs de la page). */
const etats = new WeakMap<ClientEsport, Promise<EtatEcriture | null>>();
export function etatEcriture(client: ClientEsport, forcer = false): Promise<EtatEcriture | null> {
  const connu = etats.get(client);
  if (connu && !forcer) return connu;
  const p = Promise.resolve()
    .then(() => apiEcriture(client).etat())
    .then(e => (e && typeof e === 'object' ? e : null))
    .catch(() => null);
  etats.set(client, p);
  return p;
}

/** Morceau de l'aperçu : identique, ajouté (ou corrigé) ou retiré. */
export interface MorceauDiff {
  genre: 'egal' | 'ajout' | 'retrait';
  texte: string;
}

/** Découpe en mots ET séparateurs (espaces, retours à la ligne), gardés tels quels. */
const decouper = (t: string): string[] => t.match(/\s+|[^\s]+/g) ?? [];

/**
 * Différences mot à mot entre l'original et la proposition (plus longue sous-suite commune). Au-delà de
 * 1500 morceaux de chaque côté (texte très long), un seul bloc retiré puis ajouté : l'aperçu reste lisible.
 */
export function diffMots(avant: string, apres: string): MorceauDiff[] {
  const a = decouper(avant);
  const b = decouper(apres);
  if (a.length > 1500 || b.length > 1500) return [...(avant ? [{ genre: 'retrait' as const, texte: avant }] : []), ...(apres ? [{ genre: 'ajout' as const, texte: apres }] : [])];
  const n = a.length;
  const m = b.length;
  // Table des longueurs (de la fin vers le début).
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const sortie: MorceauDiff[] = [];
  const pousser = (genre: MorceauDiff['genre'], texte: string) => {
    const dernier = sortie[sortie.length - 1];
    if (dernier?.genre === genre) dernier.texte += texte;
    else sortie.push({ genre, texte });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pousser('egal', a[i]);
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) pousser('retrait', a[i++]);
    else pousser('ajout', b[j++]);
  }
  while (i < n) pousser('retrait', a[i++]);
  while (j < m) pousser('ajout', b[j++]);
  return sortie;
}

/** Texte avec la proposition ajoutée en dessous (version bilingue FR + EN). */
export function insererDessous(original: string, ajout: string): string {
  const base = original.replace(/\s+$/, '');
  return base ? `${base}\n\n${ajout.replace(/^\s+/, '')}` : ajout;
}

/** Raccourci « corriger » : Ctrl+Maj+K (Cmd+Maj+K sur Mac). */
export function estRaccourciCorriger(e: { key?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): boolean {
  return Boolean(e.shiftKey && (e.ctrlKey || e.metaKey) && (e.key === 'K' || e.key === 'k'));
}
