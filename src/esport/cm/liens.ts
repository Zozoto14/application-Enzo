/**
 * Client des liens utiles de l'équipe CM (migration 0044, onglet DATA › Ressources de l'espace CM ; docs/esport/cm.md) :
 * liens https rangés par le club (titre, domaine d'aperçu, description, étiquette, épinglage, ordre), liables à des cartes
 * des tableaux et à des dossiers du Drive. Types miroirs de l'API (esport/noyau/cm/liens.mjs) et règles pures
 * (validation d'adresse, filtre, recherche). Qui voit la ressource (migration 0048) : « toute l'équipe CM » ou
 * restreinte, « Partager avec… », pastille « Nouveau » jusqu'à l'ouverture. Fichiers (migration 0051) : une ressource est
 * un lien OU un fichier (envoyé depuis l'appareil, rangé dans le dossier « Ressources » du Drive du club, ou choisi dans
 * un Drive : la ressource suit sa source) ; aperçu et téléchargement par lien signé.
 */

import type { ClientEsport } from '../client';
import type { GenreAcces, NiveauAcces, RegleAcces, RoleProposeAcces } from './api';
import type { FichierDrive, GenreDrive, MetaDrive } from './drive';

export type GenreLiaison = 'carte' | 'dossier';
/** Visibilité d'une ressource (migration 0048) : toute l'équipe CM, ou restreinte aux personnes et rôles choisis. */
export type AccesLien = 'tous' | 'restreint';
/** Droits du compte sur une ressource qu'il voit (calculés par le serveur). */
export interface DroitsLien {
  modifier: boolean;
  supprimer: boolean;
  /** Régler « Qui voit la ressource » (créateur, cm.gerer, Fondateur). */
  acces: boolean;
  partager: boolean;
}

/** Ressource : un lien (adresse https) ou un fichier (migration 0051). */
export type GenreRessource = 'lien' | 'fichier';
/**
 * Fichier d'une ressource, tel que le compte peut le voir. `etat` 'inaccessible' : choisi dans un Drive que le compte ne
 * voit pas (« Fichier d'un Drive auquel vous n'avez pas accès » : ni nom, ni lien) ; 'supprime' : à la corbeille du Drive.
 */
export type FichierRessource =
  | { source: 'envoi' | 'drive'; etat: 'inaccessible' | 'supprime' }
  | {
      source: 'envoi' | 'drive';
      etat: 'ok';
      /** Élément du Drive. */
      id: string;
      nom: string;
      genre: GenreDrive;
      type: string;
      taille: number;
      version: number;
      meta: MetaDrive;
      majLe: string;
      /** Lien signé (2 h) vers l'image, pour la vignette (images légères seulement). */
      vignette: string | null;
      /** Drive d'origine (choisi dans un Drive). */
      portee: string | null;
      /** Remplacer le fichier (nouvelle version) : droit sur la ressource et, choisi dans un Drive, sur sa source. */
      remplacer: boolean;
    };
export type FichierRessourceLisible = Extract<FichierRessource, { etat: 'ok' }>;

export interface LienCm {
  id: string;
  /** Absent (anciennes réponses) : un lien. */
  genre?: GenreRessource;
  /** Ressource « fichier » : son fichier (url et hote sont vides). */
  fichier?: FichierRessource;
  titre: string;
  url: string;
  /** Domaine affiché (sans « www. »). Aucune image externe n'est chargée : l'icône est locale. */
  hote: string;
  description: string;
  categorie: string | null;
  epingle: boolean;
  position: number;
  team: { id: string; nom: string } | null;
  acces?: AccesLien;
  creeLe: string;
  majLe: string;
  /** Nombre de cartes et de dossiers liés que le compte voit (liste seulement). */
  liaisons?: number;
  /** Restreinte : premières personnes autorisées (le Fondateur, toujours autorisé, n'est pas listé). */
  autorises?: { total: number; personnes: Array<{ compte: string; pseudo: string }> } | null;
  /** Partagée avec le compte (« Partager avec… » ou nommé dans l'accès). */
  partageAvecMoi?: boolean;
  /** Partagée avec le compte et pas encore ouverte. */
  nouveau?: boolean;
  droits?: DroitsLien;
}
/** Réglage « Qui voit la ressource » (ou options d'une nouvelle ressource : `lien` null). */
export interface ReglageAccesLien {
  lien: { id: string; titre: string; creePar: string | null; team: string | null } | null;
  acces: AccesLien;
  regles: RegleAcces[];
  /** Qui la voit aujourd'hui (restreinte) ; null si elle est ouverte. */
  effectifs: Array<{ compte: string; pseudo: string; niveau: NiveauAcces }> | null;
  options: { personnes: Array<{ compte: string; pseudo: string }>; rolesCm: RoleProposeAcces[]; rolesClub: RoleProposeAcces[]; rolesTeam: RoleProposeAcces[] };
  moi: string;
}
export interface ListeLiens {
  liens: LienCm[];
  categories: string[];
  teams: Array<{ id: string; nom: string }>;
  droits: { editer: boolean; gerer: boolean };
  /** Ressources partagées avec le compte, pas encore ouvertes. */
  nouveaux?: number;
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
  /** Création : 'fichier' avec `envoi` (envoi terminé, portée « ressources ») ou `elementId` (fichier d'un Drive). */
  genre?: GenreRessource;
  envoi?: string;
  elementId?: string;
  titre?: string;
  url?: string;
  description?: string;
  categorie?: string | null;
  teamId?: string | null;
  epingle?: boolean;
  /** Création seulement : visibilité et règles (migration 0048). */
  acces?: AccesLien;
  regles?: Array<{ genre: GenreAcces; cible: string; niveau: NiveauAcces }>;
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
    /** Qui voit la ressource (migration 0048). */
    optionsAcces: (teamId?: string | null) => r<ReglageAccesLien>(`/cm/liens/acces${teamId ? `?team=${e(teamId)}` : ''}`),
    acces: (id: string) => r<ReglageAccesLien>(`/cm/liens/${e(id)}/acces`),
    changerAcces: (id: string, acces: AccesLien, regles: RegleAcces[]) => r<ReglageAccesLien>(`/cm/liens/${e(id)}/acces`, 'PUT', { acces, regles: regles.map(x => ({ genre: x.genre, cible: x.cible, niveau: x.niveau })) }),
    partager: (id: string, comptes: string[], niveau: NiveauAcces = 'voir') => r<{ ok: true; partages: number }>(`/cm/liens/${e(id)}/partage`, 'POST', { comptes, niveau }),
    vu: (id: string) => r<{ ok: true }>(`/cm/liens/${e(id)}/vu`, 'POST', {}),
    /** Fichiers (migration 0051) : remplacer (nouvelle version) ; lien signé (2 h) pour l'aperçu ou le téléchargement. */
    remplacerFichier: (id: string, envoi: string, version?: number) => r<{ lien: LienCm }>(`/cm/liens/${e(id)}/fichier`, 'POST', { envoi, version }),
    lienFichier: (id: string, o: { telecharger?: boolean; version?: number } = {}) => r<{ url: string; expire: string }>(`/cm/liens/${e(id)}/fichier/lien`, 'POST', o),
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

/** Filtre par type (migration 0051). Documents : PDF, textes, archives, polices, créations (PSD). */
export type TypeRessource = 'liens' | 'fichiers' | 'images' | 'documents' | 'videos';
export const TYPES_RESSOURCE: readonly TypeRessource[] = ['liens', 'fichiers', 'images', 'documents', 'videos'];

/** La ressource est-elle de ce type ? Un fichier inaccessible n'est que « Fichiers » (son genre n'est pas connu). */
export function estDeType(l: LienCm, t: TypeRessource): boolean {
  const fichier = l.genre === 'fichier';
  if (t === 'liens') return !fichier;
  if (!fichier) return false;
  if (t === 'fichiers') return true;
  const g = l.fichier?.etat === 'ok' ? l.fichier.genre : null;
  if (t === 'images') return g === 'image';
  if (t === 'videos') return g === 'video' || g === 'audio';
  return g !== null && g !== 'image' && g !== 'video' && g !== 'audio';
}

/** Fichier lisible d'une ressource, ou undefined. */
export const fichierLisible = (l: LienCm): FichierRessourceLisible | undefined => (l.genre === 'fichier' && l.fichier?.etat === 'ok' ? l.fichier : undefined);

/** Fichier d'une ressource sous la forme attendue par l'aperçu du Drive (image, vidéo, PDF, son…). */
export function fichierPourApercu(l: LienCm, f: FichierRessourceLisible): FichierDrive {
  return { id: `${l.id}-${f.id}`, portee: f.portee ?? 'club', dossierId: null, nom: f.nom, genre: f.genre, type: f.type, taille: f.taille, version: f.version, meta: f.meta, tags: [], favori: false, origine: 'envoi', creePar: null, creeLe: f.majLe, majPar: null, majLe: f.majLe, vignette: f.vignette, modifiable: false };
}

export interface FiltreLiens {
  /** Liens, fichiers, images, documents, vidéos (migration 0051). */
  type?: TypeRessource;
  q?: string;
  categorie?: string;
  /** Identifiant d'une team, ou `club` : liens sans rattachement. */
  team?: string;
  epingles?: boolean;
  /** « Partagé avec moi » (migration 0048). */
  partages?: boolean;
}

/** Filtre combiné : texte (titre, description, étiquette, domaine, team, nom du fichier ; sans accents ni casse), étiquette, team, épinglés, type. */
export function filtrerLiens(liens: LienCm[], f: FiltreLiens): LienCm[] {
  const mots = sansAccents(f.q ?? '').split(/\s+/).filter(Boolean);
  return liens.filter(l => {
    if (f.categorie && l.categorie !== f.categorie) return false;
    if (f.team === 'club' ? l.team !== null : f.team && l.team?.id !== f.team) return false;
    if (f.epingles && !l.epingle) return false;
    if (f.partages && !l.partageAvecMoi) return false;
    if (f.type && !estDeType(l, f.type)) return false;
    if (!mots.length) return true;
    const texte = sansAccents([l.titre, l.description, l.categorie, l.hote, l.team?.nom, fichierLisible(l)?.nom].filter(Boolean).join(' '));
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
