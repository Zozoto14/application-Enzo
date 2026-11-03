/**
 * Client des visuels de la section CM (migration 0025), par l'appel générique du client Esport. Types
 * miroirs de l'API (esport/noyau/cm/visuels/service.mjs). Voir docs/esport/visuels.md.
 */

import type { ClientEsport } from '../../client';
import type { Charte, CleFormat, DocumentVisuel, DonneesVisuel, Langue, SourceVisuel, TypeVisuel } from './types';

export interface ReponseCharte {
  charte: Charte;
  version: number;
  majLe: string | null;
  defaut: Charte;
  gerer: boolean;
  teams: Array<{ id: string; nom: string | null }>;
}
export interface ModeleResume {
  id: string;
  portee: string;
  teamId: string | null;
  nom: string;
  type: TypeVisuel;
  base: string | null;
  formats: CleFormat[];
  /** Dossier (migration 0041 ; null : racine). */
  dossierId?: string | null;
  version: number;
  creePar: string | null;
  majPar: string | null;
  majLe: string;
}
export interface ModeleComplet extends ModeleResume {
  documents: Partial<Record<CleFormat, DocumentVisuel>>;
  noms: Record<string, string | null>;
}
export interface ListeModeles {
  modeles: ModeleResume[];
  noms: Record<string, string | null>;
  editer: { club: boolean; teams: string[] };
}
export interface Visuel {
  id: string;
  portee: string;
  teamId: string | null;
  carteId: string | null;
  pieceId: string | null;
  fichierId: string | null;
  nom: string;
  /** « defaut:<type> » ou l'identifiant d'un modèle du club. */
  modele: string;
  type: TypeVisuel;
  format: CleFormat;
  langue: Langue;
  source: SourceVisuel;
  retouche: boolean;
  /** Dossier (migration 0041 ; null : racine). */
  dossierId?: string | null;
  document?: DocumentVisuel | null;
  donnees?: DonneesVisuel | null;
  erreurDonnees?: string | null;
  perime?: { donnees: boolean; charte: boolean; modele: boolean } | null;
  renduLe: string | null;
  version: number;
  creePar: string | null;
  majLe: string;
}
export interface VisuelsCarte {
  visuels: Visuel[];
  proposition: { type: TypeVisuel; source: SourceVisuel } | null;
  suggestion: string | null;
  portee: string;
  editer: boolean;
}
export interface ImageImportee {
  fichierId: string;
  nom: string;
  largeur: number | null;
  hauteur: number | null;
  portee: string;
}

/** Dossiers par défaut des visuels (migration 0041). */
export type CleDossierVisuel = 'annonces' | 'resultats' | 'recrues' | 'programmes' | 'sponsors' | 'divers';
export interface DossierVisuel {
  id: string;
  portee: string;
  parentId: string | null;
  /** null : dossier par défaut, nom traduit par l'app (`cle`). */
  nom: string | null;
  cle: CleDossierVisuel | null;
  systeme: boolean;
  modeles: number;
  visuels: number;
  creeLe: string;
  majLe: string;
}
/** `defaut` : modèle par défaut (id : son type) ; seul son rangement est mémorisé. */
export type ElementVisuel = { genre: 'modele' | 'visuel' | 'dossier' | 'defaut'; id: string };

export function apiVisuels(client: ClientEsport) {
  const r = <T>(chemin: string, methode = 'GET', corps?: unknown) => client.requete<T>(chemin, methode, corps);
  const e = encodeURIComponent;
  const qs = (o: Record<string, string | null | undefined>) => {
    const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '');
    return p.length ? `?${p.map(([k, v]) => `${k}=${e(v as string)}`).join('&')}` : '';
  };
  return {
    client,
    charte: () => r<ReponseCharte>('/cm/charte'),
    changerCharte: (charte: Partial<Charte>, version?: number) => r<ReponseCharte>('/cm/charte', 'PUT', { charte, version }),
    reinitialiserCharte: () => r<ReponseCharte>('/cm/charte', 'PUT', { reinitialiser: true }),
    importerImage: (portee: string, envoi: string) => r<ImageImportee>('/cm/visuels/images', 'POST', { portee, envoi }),
    /** Image prise dans le Drive (portée de l'éditeur ou Drive du club) : aucun octet copié. */
    importerImageDepuisDrive: (portee: string, fichierDrive: string) => r<ImageImportee>('/cm/visuels/images', 'POST', { portee, drive: fichierDrive }),
    images: (portee: string) => r<{ images: ImageImportee[] }>(`/cm/visuels/images${qs({ portee })}`),
    lienFichier: (id: string) => r<{ url: string; expire: string }>(`/cm/visuels/fichiers/${e(id)}/lien`, 'POST', {}),
    modeles: (portee?: string) => r<ListeModeles>(`/cm/modeles${qs({ portee })}`),
    modele: (id: string) => r<{ modele: ModeleComplet }>(`/cm/modeles/${e(id)}`),
    dossiers: (portee: string) => r<{ portee: string; editer: boolean; dossiers: DossierVisuel[]; /** Dossier de chaque modèle par défaut rangé (type → dossier). */ defauts?: Record<string, string> }>(`/cm/visuels/dossiers${qs({ portee })}`),
    creerDossier: (d: { portee: string; parentId: string | null; nom: string }) => r<{ id: string }>('/cm/visuels/dossiers', 'POST', d),
    modifierDossier: (id: string, d: { nom?: string | null; parentId?: string | null }) => r<{ ok: true }>(`/cm/visuels/dossiers/${e(id)}`, 'PATCH', d),
    supprimerDossier: (id: string) => r<{ ok: true; parentId: string | null }>(`/cm/visuels/dossiers/${e(id)}`, 'DELETE'),
    deplacer: (c: { elements: ElementVisuel[]; dossierId: string | null; portee?: string }) => r<{ faits: string[]; erreurs: Array<{ id: string | null; code: string; erreur: string }>; avant: Record<string, string | null> }>('/cm/visuels/deplacer', 'POST', c),
    reinitialiserDefauts: (portee: string) => r<{ ok: true; n: number }>('/cm/visuels/defauts/reinitialiser', 'POST', { portee }),
    creerModele: (m: { portee: string; nom: string; type: TypeVisuel; base?: string | null; documents: Partial<Record<CleFormat, DocumentVisuel>>; dossierId?: string | null }) => r<{ modele: ModeleComplet }>('/cm/modeles', 'POST', m),
    modifierModele: (id: string, version: number, m: { nom?: string; documents?: Partial<Record<CleFormat, DocumentVisuel>> }) => r<{ modele: ModeleComplet }>(`/cm/modeles/${e(id)}`, 'PATCH', { version, ...m }),
    supprimerModele: (id: string) => r<{ ok: true }>(`/cm/modeles/${e(id)}`, 'DELETE'),
    dupliquerModele: (id: string, o: { nom?: string; portee?: string; dossierId?: string | null } = {}) => r<{ modele: ModeleComplet }>(`/cm/modeles/${e(id)}/dupliquer`, 'POST', o),
    versionsModele: (id: string) => r<{ actuelle: number; versions: Array<{ version: number; nom: string; auteur: string | null; date: string }>; noms: Record<string, string | null> }>(`/cm/modeles/${e(id)}/versions`),
    restaurerModele: (id: string, version: number, actuelle: number) => r<{ modele: ModeleComplet }>(`/cm/modeles/${e(id)}/versions/${version}/restaurer`, 'POST', { version: actuelle }),
    donnees: (portee: string, source: Partial<SourceVisuel>) => r<{ source: SourceVisuel; donnees: DonneesVisuel }>(`/cm/visuels/donnees${qs({ portee, genre: source.genre, teamId: source.teamId, id: source.id, date: source.date })}`),
    visuels: (o: { portee?: string; carte?: string } = {}) => r<{ visuels: Visuel[] }>(`/cm/visuels${qs(o)}`),
    visuel: (id: string) => r<{ visuel: Visuel }>(`/cm/visuels/${e(id)}`),
    creerVisuel: (v: { portee?: string; carteId?: string; modele: string; format: CleFormat; langue: Langue; source: Partial<SourceVisuel>; nom?: string; dossierId?: string | null }) => r<{ visuel: Visuel }>('/cm/visuels', 'POST', v),
    modifierVisuel: (id: string, version: number, v: { nom?: string; document?: DocumentVisuel | null; format?: CleFormat; langue?: Langue; modele?: string; source?: Partial<SourceVisuel> }) => r<{ visuel: Visuel }>(`/cm/visuels/${e(id)}`, 'PATCH', { version, ...v }),
    supprimerVisuel: (id: string) => r<{ ok: true }>(`/cm/visuels/${e(id)}`, 'DELETE'),
    rendu: (id: string, envoi: string, empreinte: string) => r<{ visuel: Visuel }>(`/cm/visuels/${e(id)}/rendu`, 'POST', { envoi, empreinte }),
    lierCarte: (id: string, carteId: string) => r<{ visuel: Visuel }>(`/cm/visuels/${e(id)}/carte`, 'POST', { carteId }),
    lienRendu: (id: string, telecharger = false) => r<{ url: string; expire: string }>(`/cm/visuels/${e(id)}/lien`, 'POST', { telecharger }),
    visuelsCarte: (carteId: string) => r<VisuelsCarte>(`/cm/cartes/${e(carteId)}/visuels`),
  };
}

export type ApiVisuels = ReturnType<typeof apiVisuels>;

/** Référence du modèle par défaut d'un genre. */
export const refDefaut = (type: TypeVisuel): string => `defaut:${type}`;
export const estRefDefaut = (ref: string): boolean => ref.startsWith('defaut:');
