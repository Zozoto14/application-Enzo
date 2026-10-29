/**
 * Client de la page Membres › Rôles et permissions (migration 0033), par l'appel générique du client Esport.
 * Types miroirs de l'API (esport/noyau/roles/service.mjs). Voir docs/esport/roles-permissions.md.
 * Les permissions (descriptions FR/EN, catégories, sensibles) viennent du catalogue : `descriptionPermission`.
 */

import { CATALOGUE, type ClientEsport } from '../client';
import { langueCourante } from '../i18n';

export interface CompteRole {
  compte: string;
  pseudo: string | null;
  depuis?: string;
}
export interface RoleGlobal {
  id: string;
  nom: string;
  couleur: string;
  systeme: boolean;
  cle: string | null;
  permissions: string[];
  comptes: CompteRole[];
  permissionsParDefaut?: string[];
  modifie?: boolean;
}
export interface RoleModele {
  cle: string;
  nom: string;
  couleur: string;
  permissions: string[];
  permissionsParDefaut: string[];
  modifie: boolean;
}
export interface VueRoles {
  moi: { fondateur: boolean; permissions: string[] };
  globaux: { roles: RoleGlobal[]; permissions: string[]; reservees: string[] };
  cm: { permissions: string[] };
  modele: { roles: RoleModele[]; permissions: string[]; modifiable: boolean };
  teams: Array<{ id: string; nom: string; slug: string }>;
  comptes: Array<{ compte: string; pseudo: string }>;
}
export interface EntreeJournalRoles {
  id: string;
  acteur: string | null;
  action: string;
  entiteId: string | null;
  meta: { nom?: string; cle?: string; compte?: string; role?: string; ajoutees?: string[]; retirees?: string[]; retabli?: boolean };
  team: { id: string; nom: string | null } | null;
  date: string;
}

interface DescriptionCatalogue {
  categorie: string;
  fr: string;
  en: string;
  sensible?: boolean;
}
type CatalogueRoles = {
  categories: Array<{ cle: string; fr: string; en: string }>;
  descriptions: Record<string, DescriptionCatalogue>;
  permissionsGlobales: Array<{ cle: string; fondateurSeul?: boolean }>;
};
const CAT = CATALOGUE as unknown as CatalogueRoles;

/** Catégories, dans l'ordre d'affichage (Membres, Teams, Agenda, Jeu, Compétition, CM, Drive, Sponsors, Discord, Jeux & IA, Administration). */
export const CATEGORIES: ReadonlyArray<{ cle: string; fr: string; en: string }> = CAT.categories ?? [];
export const nomCategorie = (cle: string): string => {
  const c = CATEGORIES.find(x => x.cle === cle);
  return c ? c[langueCourante()] : cle;
};
/** Description d'une permission dans la langue courante (la clé si elle n'est pas au catalogue). */
export const descriptionPermission = (p: string): string => CAT.descriptions?.[p]?.[langueCourante()] ?? p;
export const categoriePermission = (p: string): string => CAT.descriptions?.[p]?.categorie ?? 'administration';
export const permissionSensible = (p: string): boolean => Boolean(CAT.descriptions?.[p]?.sensible);
export const permissionReservee = (p: string): boolean => Boolean(CAT.permissionsGlobales?.find(x => x.cle === p)?.fondateurSeul);

const e = encodeURIComponent;

export function apiRoles(client: ClientEsport) {
  const r = <T>(chemin: string, methode = 'GET', corps?: unknown) => client.requete<T>(chemin, methode, corps);
  return {
    vue: () => r<VueRoles>('/roles-permissions'),
    creer: (x: { nom: string; couleur: string; permissions: string[] }) => r<RoleGlobal>('/roles-permissions/globaux', 'POST', x),
    modifier: (id: string, x: Partial<{ nom: string; couleur: string; permissions: string[] }>) => r<RoleGlobal>(`/roles-permissions/globaux/${e(id)}`, 'PATCH', x),
    retablir: (id: string) => r<RoleGlobal>(`/roles-permissions/globaux/${e(id)}/retablir`, 'POST'),
    supprimer: (id: string) => r<{ ok: true }>(`/roles-permissions/globaux/${e(id)}`, 'DELETE'),
    attribuer: (id: string, compte: string) => r<RoleGlobal>(`/roles-permissions/globaux/${e(id)}/comptes`, 'POST', { compte }),
    retirer: (id: string, compte: string) => r<RoleGlobal>(`/roles-permissions/globaux/${e(id)}/comptes/${e(compte)}`, 'DELETE'),
    modifierModele: (cle: string, permissions: string[]) => r<RoleModele>(`/roles-permissions/modele/${e(cle)}`, 'PUT', { permissions }),
    retablirModele: (cle: string) => r<RoleModele>(`/roles-permissions/modele/${e(cle)}/retablir`, 'POST'),
    journal: (avant?: string) => r<{ entrees: EntreeJournalRoles[]; noms: Record<string, string> }>(`/roles-permissions/journal${avant ? `?avant=${e(avant)}` : ''}`),
  };
}
export type ApiRoles = ReturnType<typeof apiRoles>;
