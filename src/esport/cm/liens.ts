/**
 * Client des liens utiles de l'équipe CM (migration 0044, onglet DATA › Ressources de l'espace CM ; docs/esport/cm.md) :
 * liens https rangés par le club (titre, domaine d'aperçu, description, étiquette, épinglage, ordre), liables à des cartes
 * des tableaux et à des dossiers du Drive. Types miroirs de l'API (esport/noyau/cm/liens.mjs) et règles pures
 * (validation d'adresse, filtre, recherche).
 */

import type { ClientEsport } from '../client';

export type GenreLiaison = 'carte' | 'dossier';

export interface LienCm {
  id: string;
  titre: string;
  url: string;
  /** Domaine affiché (sans « www. »). Aucune image externe n'est chargée : l'icône est locale. */
  hote: string;
  description: string;
  categorie: string | null;
  epingle: boolean;
  position: number;
  team: { id: string; nom: string } | null;
  creeLe: string;
  majLe: string;
  /** Nombre de cartes et de dossiers liés que le compte voit (liste seulement). */
  liaisons?: number;
}
export interface ListeLiens {
  liens: LienCm[];
  categories: string[];
  teams: Array<{ id: string; nom: string }>;
  droits: { editer: boolean; gerer: boolean };
  max: number;
}
export interface CarteLiee {
  id: string;
  titre: string;
  tableauId: string;
  tableau: string | null;
  portee: string;
  modifier: boolean;
}
export interface DossierLie {
  id: string;
  nom: string;
  portee: string;
  chemin: string[];
  modifier: boolean;
}
export interface Liaisons {
  cartes: CarteLiee[];
  dossiers: DossierLie[];
  droits: { editer: boolean };
}
export interface SaisieLien {
  titre?: string;
  url?: string;
  description?: string;
  categorie?: string | null;
  teamId?: string | null;
  epingle?: boolean;
}

const e = encodeURIComponent;

export function apiLiens(client: ClientEsport) {
  const r = <T>(chemin: string, methode = 'GET', corps?: unknown) => client.requete<T>(chemin, methode, corps);
  return {
    client,
    lister: () => r<ListeLiens>('/cm/liens'),
    creer: (s: SaisieLien) => r<{ lien: LienCm }>('/cm/liens', 'POST', s),
    modifier: (id: string, s: SaisieLien) => r<{ lien: LienCm }>(`/cm/liens/${e(id)}`, 'PATCH', s),
    supprimer: (id: string) => r<{ ok: true }>(`/cm/liens/${e(id)}`, 'DELETE'),
    ordonner: (ids: string[]) => r<ListeLiens>('/cm/liens/ordre', 'PUT', { ids }),
    liaisons: (id: string) => r<Liaisons>(`/cm/liens/${e(id)}/liaisons`),
    lier: (id: string, genre: GenreLiaison, cibleId: string) => r<Liaisons>(`/cm/liens/${e(id)}/liaisons`, 'POST', { genre, cibleId }),
    delier: (id: string, genre: GenreLiaison, cibleId: string) => r<Liaisons>(`/cm/liens/${e(id)}/liaisons/${genre}/${e(cibleId)}`, 'DELETE'),
    deLaCible: (genre: GenreLiaison, id: string) => r<{ liens: LienCm[]; droits: { lier: boolean; creer: boolean } }>(`/cm/liens/cible/${genre}/${e(id)}`),
  };
}
export type ApiLiens = ReturnType<typeof apiLiens>;

/**
 * Vérification de l'adresse avant l'envoi (le serveur refait la sienne) : https, hôte public (pas d'adresse locale ni
 * d'IP), sans identifiants. Rend l'adresse normalisée ou `null`.
 */
export function adresseLienValide(brut: string): string | null {
  const texte = brut.trim();
  if (!texte || texte.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(texte);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const hote = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hote.includes('.') || hote === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hote) || hote.includes(':') || hote.startsWith('[')) return null;
  if (['.local', '.internal', '.intranet', '.lan', '.home', '.corp'].some(s => hote.endsWith(s))) return null;
  return url.href;
}

const sansAccents = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface FiltreLiens {
  q?: string;
  categorie?: string;
  /** Identifiant d'une team, ou `club` : liens sans rattachement. */
  team?: string;
  epingles?: boolean;
}

/** Filtre combiné : texte (titre, description, étiquette, domaine, team ; sans accents ni casse), étiquette, team, épinglés. */
export function filtrerLiens(liens: LienCm[], f: FiltreLiens): LienCm[] {
  const mots = sansAccents(f.q ?? '').split(/\s+/).filter(Boolean);
  return liens.filter(l => {
    if (f.categorie && l.categorie !== f.categorie) return false;
    if (f.team === 'club' ? l.team !== null : f.team && l.team?.id !== f.team) return false;
    if (f.epingles && !l.epingle) return false;
    if (!mots.length) return true;
    const texte = sansAccents([l.titre, l.description, l.categorie, l.hote, l.team?.nom].filter(Boolean).join(' '));
    return mots.every(m => texte.includes(m));
  });
}

/** Nouvel ordre après avoir déplacé `id` d'un cran (`-1` : vers le haut) parmi les liens de même épinglage. */
export function deplacerLien(liens: LienCm[], id: string, sens: -1 | 1): string[] | null {
  const i = liens.findIndex(l => l.id === id);
  if (i < 0) return null;
  const j = i + sens;
  if (j < 0 || j >= liens.length || liens[j].epingle !== liens[i].epingle) return null;
  const ids = liens.map(l => l.id);
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return ids;
}
