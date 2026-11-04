/**
 * Client du Drive de la section CM (migration 0027, esport/noyau/cm/drive/). Voir docs/esport/drive.md.
 * Les écritures PATCH / PUT / DELETE passent par `client.requete`, qui les envoie en POST + X-Methode quand
 * l'hébergement mutualisé les bloque.
 */

import type { NomIcone } from '../../ui/icones/traces';
import { requeteUrl, type ClientEsport } from '../client';
import { PORTEE_CLUB, type TeamCm } from './api';

export type GenreDrive = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'police' | 'creation' | 'texte';
export const GENRES_DRIVE: readonly GenreDrive[] = ['image', 'video', 'audio', 'document', 'archive', 'police', 'creation', 'texte'];
/** « ressources » : dossier système du Drive du club, fichiers de DATA › Ressources (migration 0051, restreint). */
export type CleDossier = 'logos' | 'photos' | 'clips' | 'visuels' | 'sponsors' | 'bruts' | 'depot' | 'ressources';

export interface DroitsDrive {
  voir: boolean;
  envoyer: boolean;
  gerer: boolean;
  /** Dépôt des joueurs seulement (leurs propres fichiers, dossier « Dépôt joueurs »). */
  depot: boolean;
}
export interface QuotaDrive {
  utilise: number;
  enCours: number;
  limite: number;
  pourcent: number;
  alerte: boolean;
  fichierMax: number;
  zipMax: number;
}
export interface ReglagesDrive {
  rangementVisuels: boolean;
  rangementClips: boolean;
}
export interface PorteeDrive {
  portee: string;
  team: TeamCm | null;
  droits: DroitsDrive;
}
export interface MetaDrive {
  format: string | null;
  nomFormat: string | null;
  largeur: number | null;
  hauteur: number | null;
  duree: number | null;
  codecVideo: string | null;
  codecAudio: string | null;
}
export interface FichierDrive {
  id: string;
  portee: string;
  dossierId: string | null;
  nom: string;
  genre: GenreDrive;
  type: string;
  taille: number;
  version: number;
  meta: MetaDrive;
  tags: string[];
  favori: boolean;
  origine: 'envoi' | 'copie' | 'visuel' | 'clip' | 'ressource';
  /** Fichier d'une ressource de DATA › Ressources (migration 0051) : il se gère depuis la ressource (ni déplacé, ni copié, ni jeté ici). */
  ressource?: boolean;
  creePar: string | null;
  creeLe: string;
  majPar: string | null;
  majLe: string;
  /** Lien signé (2 h) vers l'image, pour la vignette (images légères seulement). */
  vignette: string | null;
  modifiable: boolean;
  supprimeLe?: string;
  supprimePar?: string | null;
}
export interface DossierDrive {
  id: string;
  portee: string;
  parentId: string | null;
  /** null : dossier par défaut, nom traduit par l'app (`cle`). */
  nom: string | null;
  cle: CleDossier | null;
  restreint: boolean;
  fichiers: number;
  favori: boolean;
  creePar: string | null;
  creeLe: string;
  majLe: string;
  modifiable: boolean;
  systeme: boolean;
  supprimeLe?: string;
  supprimePar?: string | null;
}
export interface MaillonDrive {
  id: string;
  nom: string | null;
  cle: CleDossier | null;
}
/** Nouveautés d'un Drive pour le compte (migration 0041) : total, éléments à la racine, compteur par dossier (sous-dossiers compris). */
export interface NouveautesDrive {
  total: number;
  racine: number;
  dossiers: Record<string, number>;
}
export interface ContenuDrive {
  portee: string;
  /** Présent quand le dossier est ouvert avec `vu` (il est alors marqué vu). */
  nouveautes?: NouveautesDrive | null;
  team: { id: string; nom: string } | null;
  droits: DroitsDrive;
  dossier: DossierDrive | null;
  chemin: MaillonDrive[];
  dossiers: DossierDrive[];
  fichiers: FichierDrive[];
  noms: Record<string, string | null>;
  tronque: boolean;
  quota: QuotaDrive;
}
export interface ResultatRechercheDrive {
  portee: string;
  droits: DroitsDrive;
  fichiers: FichierDrive[];
  dossiers: DossierDrive[];
  noms: Record<string, string | null>;
  chemins: Record<string, MaillonDrive[]>;
}
export interface VersionDrive {
  version: number;
  nom: string;
  type: string;
  taille: number;
  creePar: string | null;
  creeLe: string;
  actuelle: boolean;
  meta: MetaDrive;
}
export interface DetailFichierDrive {
  fichier: FichierDrive;
  chemin: MaillonDrive[];
  versions: VersionDrive[];
  /** `cartesMasquees` : cartes de tableaux restreints que le lecteur ne voit pas (migration 0046), comptées sans titre. */
  utilisations: { cartes: Array<{ id: string; titre: string; tableauId: string }>; cartesMasquees?: number; visuels: number; sponsors: number };
  droits: DroitsDrive & { modifier: boolean };
  noms: Record<string, string | null>;
}
export type ElementCorbeille = ({ element: 'fichier' } & FichierDrive) | ({ element: 'dossier'; contenu: { n: number; octets: number } } & DossierDrive);
export interface CorbeilleDrive {
  portee: string;
  droits: DroitsDrive;
  elements: Array<ElementCorbeille & { expireLe: string; restaurable: boolean }>;
  noms: Record<string, string | null>;
  dureeJours: number;
}
export interface FiltresRecherche {
  q?: string;
  genre?: GenreDrive;
  tag?: string;
  auteur?: string;
  du?: string;
  au?: string;
  favoris?: boolean;
  dossier?: string;
}
export type ElementDrive = { genre: 'fichier' | 'dossier'; id: string };

/** Lien interne vers un élément du Drive (à coller dans la recherche du Drive : il l'ouvre si on y a accès). */
export const PREFIXE_LIEN_DRIVE = 'drive:';
export const lienInterneDrive = (id: string): string => `${PREFIXE_LIEN_DRIVE}${id}`;
/** Identifiant d'un lien interne collé (« drive:<uuid> »), sinon undefined. */
export function lireLienDrive(texte: string): string | undefined {
  const m = /^\s*drive:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/i.exec(texte);
  return m ? m[1].toLowerCase() : undefined;
}

const e = encodeURIComponent;

export function apiDrive(client: ClientEsport) {
  const r = <T>(chemin: string, methode = 'GET', corps?: unknown) => client.requete<T>(chemin, methode, corps);
  return {
    client,
    portees: () => r<{ portees: PorteeDrive[]; quota: QuotaDrive | null; reglages: ReglagesDrive | null }>('/cm/drive/portees'),
    /** `vu` : ouverture par l'écran du Drive (le dossier est marqué vu ; la réponse porte les nouveautés). */
    lister: (portee: string, dossier?: string | null, o: { vu?: boolean } = {}) => r<ContenuDrive>(`/cm/drive${requeteUrl({ portee, dossier: dossier ?? undefined, vu: o.vu ? 1 : undefined })}`),
    nouveautes: (portee: string) => r<NouveautesDrive & { portee: string }>(`/cm/drive/nouveautes${requeteUrl({ portee })}`),
    nouveautesGlobales: () => r<{ total: number; portees: Array<{ portee: string; total: number }> }>('/cm/drive/nouveautes'),
    vu: (portee: string, dossierId: string | null) => r<NouveautesDrive & { portee: string }>('/cm/drive/vu', 'POST', { portee, dossierId }),
    toutVu: (portee?: string) => r<{ ok: true; portees: string[] }>('/cm/drive/tout-vu', 'POST', portee ? { portee } : {}),
    arbre: (portee: string) => r<{ portee: string; dossiers: Array<{ id: string; parentId: string | null; nom: string | null; cle: CleDossier | null; restreint: boolean }> }>(`/cm/drive/arbre${requeteUrl({ portee })}`),
    filtres: (portee: string) => r<{ tags: Array<{ tag: string; n: number }>; auteurs: Array<{ compte: string; pseudo: string | null }>; genres: GenreDrive[] }>(`/cm/drive/filtres${requeteUrl({ portee })}`),
    renommerTag: (c: { portee: string; tag: string; nom: string }) => r<{ ok: true; fichiers: number }>('/cm/drive/tags', 'PATCH', c),
    supprimerTag: (portee: string, tag: string) => r<{ ok: true; fichiers: number }>(`/cm/drive/tags${requeteUrl({ portee, tag })}`, 'DELETE'),
    rechercher: (portee: string, f: FiltresRecherche) => r<ResultatRechercheDrive>(`/cm/drive/recherche${requeteUrl({ portee, ...f, favoris: f.favoris ? 1 : undefined })}`),
    element: (id: string) => r<{ genre: 'fichier' | 'dossier'; id: string; portee: string; dossierId: string | null }>(`/cm/drive/elements/${e(id)}`),
    ajouter: (c: { portee: string; dossierId: string | null; envoi: string; nom?: string; tags?: string[] }) => r<{ fichier: FichierDrive }>('/cm/drive/fichiers', 'POST', c),
    detail: (id: string) => r<DetailFichierDrive>(`/cm/drive/fichiers/${e(id)}`),
    modifier: (id: string, c: { nom?: string; dossierId?: string | null; tags?: string[] }) => r<DetailFichierDrive>(`/cm/drive/fichiers/${e(id)}`, 'PATCH', c),
    corbeilleFichier: (id: string) => r<{ ok: true }>(`/cm/drive/fichiers/${e(id)}`, 'DELETE'),
    copier: (id: string, c: { dossierId: string | null; portee?: string }) => r<{ id: string }>(`/cm/drive/fichiers/${e(id)}/copier`, 'POST', c),
    nouvelleVersion: (id: string, envoi: string, version?: number) => r<DetailFichierDrive>(`/cm/drive/fichiers/${e(id)}/versions`, 'POST', { envoi, version }),
    restaurerVersion: (id: string, v: number) => r<DetailFichierDrive>(`/cm/drive/fichiers/${e(id)}/versions/${v}/restaurer`, 'POST', {}),
    supprimerVersion: (id: string, v: number) => r<DetailFichierDrive>(`/cm/drive/fichiers/${e(id)}/versions/${v}`, 'DELETE'),
    lien: (id: string, o: { telecharger?: boolean; version?: number } = {}) => r<{ url: string; expire: string }>(`/cm/drive/fichiers/${e(id)}/lien`, 'POST', o),
    creerDossier: (c: { portee: string; parentId: string | null; nom: string; restreint?: boolean }) => r<{ id: string }>('/cm/drive/dossiers', 'POST', c),
    modifierDossier: (id: string, c: { nom?: string | null; parentId?: string | null; restreint?: boolean }) => r<{ ok: true }>(`/cm/drive/dossiers/${e(id)}`, 'PATCH', c),
    corbeilleDossier: (id: string) => r<{ ok: true }>(`/cm/drive/dossiers/${e(id)}`, 'DELETE'),
    zip: (id: string) => r<{ url: string; expire: string; taille: number }>(`/cm/drive/dossiers/${e(id)}/zip`, 'POST', {}),
    corbeille: (portee: string) => r<CorbeilleDrive>(`/cm/drive/corbeille${requeteUrl({ portee })}`),
    restaurer: (id: string) => r<{ ok: true; genre: string; dossierId: string | null }>(`/cm/drive/corbeille/${e(id)}/restaurer`, 'POST', {}),
    supprimerDefinitivement: (id: string) => r<{ ok: true }>(`/cm/drive/corbeille/${e(id)}`, 'DELETE'),
    viderCorbeille: (portee: string) => r<{ ok: true; elements: number }>('/cm/drive/corbeille/vider', 'POST', { portee }),
    lot: (c: { action: 'deplacer' | 'copier' | 'corbeille'; elements: ElementDrive[]; dossierId?: string | null; portee?: string }) =>
      r<{ faits: string[]; erreurs: Array<{ id: string | null; code: string; erreur: string }>; avant?: Record<string, string | null> }>('/cm/drive/lot', 'POST', c),
    favori: (genre: 'fichier' | 'dossier', id: string, favori: boolean) => r<{ ok: true }>('/cm/drive/favoris', 'POST', { genre, id, favori }),
    reglages: () => r<ReglagesDrive>('/cm/drive/reglages'),
    changerReglages: (c: Partial<ReglagesDrive>) => r<ReglagesDrive>('/cm/drive/reglages', 'PUT', c),
  };
}

export type ApiDrive = ReturnType<typeof apiDrive>;

export { PORTEE_CLUB };

/** Formats d'image que l'éditeur de visuels accepte (fichiers pris dans le Drive). */
export const IMAGES_DRIVE: readonly string[] = ['png', 'jpeg', 'gif', 'webp'];

/** Tri d'une liste de fichiers. */
export type TriDrive = 'nom' | 'date' | 'taille' | 'type';
export function trierFichiers(fichiers: readonly FichierDrive[], tri: TriDrive, inverse = false): FichierDrive[] {
  const cle = (f: FichierDrive): string | number => (tri === 'nom' ? f.nom.toLocaleLowerCase() : tri === 'date' ? f.majLe : tri === 'taille' ? f.taille : `${f.genre}|${f.nom.toLocaleLowerCase()}`);
  const s = [...fichiers].sort((a, b) => {
    const x = cle(a);
    const y = cle(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return c || a.id.localeCompare(b.id);
  });
  // La date se lit du plus récent au plus ancien par défaut.
  return (tri === 'date') !== inverse ? s.reverse() : s;
}

/** Durée lisible d'un média (« 1:05 », « 1:02:03 »). */
export function dureeLisible(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return '';
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Icône monochrome d'un genre de fichier (grille, liste : src/ui/icones). */
export const GLYPHES_DRIVE: Record<GenreDrive | 'dossier', NomIcone> = {
  dossier: 'dossier',
  image: 'image',
  video: 'video',
  audio: 'musique',
  document: 'document',
  archive: 'archive',
  police: 'police',
  creation: 'palette',
  texte: 'note',
};

// ------------------------------------------------------------------ Déplacer (glisser-déposer, menu)

/** Élément à déplacer, tel que l'écran le connaît (emplacement actuel, droits rendus par le serveur). */
export interface ElementDeplacable {
  genre: 'fichier' | 'dossier';
  id: string;
  /** Dossier actuel (null : racine). */
  parentId: string | null;
  modifiable: boolean;
  /** Dossier par défaut (reste à la racine). */
  systeme?: boolean;
}
export type RefusDeplacement = 'permission' | 'systeme' | 'boucle' | 'meme';

/** Descendants d'un dossier (lui compris) dans un arbre `{ id, parentId }`. */
export function descendantsDe(arbre: ReadonlyArray<{ id: string; parentId: string | null }>, id: string): Set<string> {
  const sortie = new Set([id]);
  let ajout = true;
  while (ajout) {
    ajout = false;
    for (const d of arbre) {
      if (d.parentId && sortie.has(d.parentId) && !sortie.has(d.id)) {
        sortie.add(d.id);
        ajout = true;
      }
    }
  }
  return sortie;
}

/**
 * Le déplacement est-il permis ? (vérifié aussi par le serveur ; ici pour refuser clairement pendant le glisser).
 * `cible` : dossier de destination (null : racine). Rend la raison du refus, ou null.
 */
export function refusDeplacement(elements: readonly ElementDeplacable[], cible: string | null, arbre: ReadonlyArray<{ id: string; parentId: string | null }>): RefusDeplacement | null {
  if (!elements.length) return 'meme';
  if (elements.some(e => !e.modifiable)) return 'permission';
  if (elements.some(e => e.genre === 'dossier' && e.systeme && cible !== null)) return 'systeme';
  if (cible !== null && elements.some(e => e.genre === 'dossier' && descendantsDe(arbre, e.id).has(cible))) return 'boucle';
  if (elements.every(e => e.parentId === cible)) return 'meme';
  return null;
}

/** « Annuler » un déplacement : les éléments regroupés par emplacement d'origine (un appel par groupe). */
export function groupesAnnulation<E extends { id: string }>(elements: readonly E[], avant: Record<string, string | null>): Array<{ dossierId: string | null; elements: E[] }> {
  const groupes = new Map<string | null, E[]>();
  for (const e of elements) {
    if (!(e.id in avant)) continue;
    const o = avant[e.id] ?? null;
    if (!groupes.has(o)) groupes.set(o, []);
    groupes.get(o)?.push(e);
  }
  return [...groupes].map(([dossierId, els]) => ({ dossierId, elements: els }));
}
