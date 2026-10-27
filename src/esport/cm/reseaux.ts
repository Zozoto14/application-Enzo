/**
 * Réseaux de la section CM et compteur de caractères en direct : même logique que le serveur
 * (esport/noyau/cm/reseaux.mjs, seul juge à la soumission). Ajouter un réseau : ici, côté serveur, et ses
 * libellés (i18n/cm.ts).
 */

import type { Reseau } from './api';

export const RESEAUX: Readonly<Record<Reseau, { nom: string; limite: number; pondere: boolean; hashtagsMax: number | null; couleur: string; glyphe: string }>> = {
  x: { nom: 'X', limite: 280, pondere: true, hashtagsMax: null, couleur: '#0f1419', glyphe: '𝕏' },
  instagram: { nom: 'Instagram', limite: 2200, pondere: false, hashtagsMax: 30, couleur: '#d62976', glyphe: '◎' },
  tiktok: { nom: 'TikTok', limite: 4000, pondere: false, hashtagsMax: null, couleur: '#25f4ee', glyphe: '♪' },
};
export const CLES_RESEAUX: readonly Reseau[] = ['x', 'instagram', 'tiktok'];

const MOTIF_URL = /https?:\/\/[^\s<>"']+/giu;
const MOTIF_HASHTAG = /(^|[^\p{L}\p{N}_&/])#([\p{L}\p{N}_]{1,100})/gu;
const MOTIF_MENTION = /(^|[^\p{L}\p{N}_.@/])@([A-Za-z0-9_.]{1,40})/gu;

function poidsX(point: number): number {
  if (point <= 0x10ff) return 1;
  if (point >= 0x2000 && point <= 0x200d) return 1;
  if (point >= 0x2010 && point <= 0x201f) return 1;
  if (point >= 0x2032 && point <= 0x2037) return 1;
  return 2;
}

/** Nombre de caractères pour un réseau (X : pondéré, adresses à 23). */
export function compterCaracteres(texte: string, reseau: Reseau): number {
  const t = (texte ?? '').normalize('NFC');
  if (!RESEAUX[reseau]?.pondere) return [...t].length;
  let total = 0;
  let reste = t;
  for (const url of t.match(MOTIF_URL) ?? []) {
    total += 23;
    reste = reste.replace(url, '');
  }
  const sansJointures = reste.replace(/‍[\p{Extended_Pictographic}]/gu, '').replace(/[︎️]/g, '').replace(/[\u{1f3fb}-\u{1f3ff}]/gu, '');
  for (const c of sansJointures) total += poidsX(c.codePointAt(0) ?? 0);
  return total;
}

export function hashtags(texte: string): string[] {
  const vus = new Set<string>();
  const sortie: string[] = [];
  for (const m of (texte ?? '').matchAll(MOTIF_HASHTAG)) {
    const k = m[2].toLowerCase();
    if (/^\d+$/.test(m[2]) || vus.has(k)) continue;
    vus.add(k);
    sortie.push(m[2]);
  }
  return sortie;
}

export function mentions(texte: string): string[] {
  const vus = new Set<string>();
  const sortie: string[] = [];
  for (const m of (texte ?? '').matchAll(MOTIF_MENTION)) {
    const brut = m[2].replace(/\.+$/, '');
    const k = brut.toLowerCase();
    if (!k || vus.has(k)) continue;
    vus.add(k);
    sortie.push(brut);
  }
  return sortie;
}

export interface AnalyseTexte {
  longueur: number;
  limite: number;
  hashtags: string[];
  mentions: string[];
  tropLong: boolean;
  tropDeHashtags: boolean;
}

export function analyserTexte(texte: string, reseau: Reseau): AnalyseTexte {
  const r = RESEAUX[reseau];
  const longueur = compterCaracteres(texte, reseau);
  const tags = hashtags(texte);
  return { longueur, limite: r.limite, hashtags: tags, mentions: mentions(texte), tropLong: longueur > r.limite, tropDeHashtags: Boolean(r.hashtagsMax && tags.length > r.hashtagsMax) };
}

/** Adresse d'un post publié : https sur le domaine du réseau (contrôle indicatif ; le serveur décide). */
export function urlPostPlausible(url: string, reseau: Reseau): boolean {
  const hotes: Record<Reseau, string[]> = { x: ['x.com', 'twitter.com'], instagram: ['instagram.com'], tiktok: ['tiktok.com'] };
  const m = /^https:\/\/([^/\s?#]+)/i.exec(url.trim());
  if (!m) return false;
  const hote = m[1].toLowerCase();
  return hotes[reseau].some(h => hote === h || hote.endsWith(`.${h}`));
}
