/**
 * Permissions de l'Esport : catalogue, rôles système, anti-escalade.
 * Fonctions PURES (aucune base, aucun réseau) : testées sous Node, reprises
 * telles quelles sur un vrai serveur.
 *
 * Une permission = `module.action` (ex. `planning.create`). Un rôle = un
 * ensemble de permissions, propre à une team. Le Propriétaire a toutes les
 * permissions ; le super admin (Fondateur, jeton maître) aussi, dans toutes
 * les teams, même sans en être membre.
 */

import catalogue from './catalogue.json' with { type: 'json' };

export { catalogue };

export const MODULES = catalogue.modules.map(m => m.cle);
export const GROUPES = catalogue.groupes;
export const TOUTES_PERMISSIONS = GROUPES.flatMap(g => g.permissions.map(p => p.cle));
const ENSEMBLE_PERMISSIONS = new Set(TOUTES_PERMISSIONS);
export const ROLES_SYSTEME = catalogue.rolesSysteme;
export const CLE_PROPRIETAIRE = 'proprietaire';
export const PRESETS = catalogue.presets;
export const JEUX = catalogue.jeux;

/** Module dont dépend une permission (`null` pour le cœur : team, membres et rôles). */
const MODULE_DE = new Map(GROUPES.flatMap(g => g.permissions.map(p => [p.cle, g.module])));

export function moduleDePermission(permission) {
  return MODULE_DE.get(permission) ?? null;
}

export function permissionConnue(permission) {
  return ENSEMBLE_PERMISSIONS.has(permission);
}

export function moduleConnu(module) {
  return MODULES.includes(module);
}

/** Permissions d'un rôle système (le Propriétaire : toutes). */
export function permissionsRoleSysteme(cle) {
  const role = ROLES_SYSTEME.find(r => r.cle === cle);
  if (!role) return [];
  return role.permissions === '*' ? [...TOUTES_PERMISSIONS] : [...role.permissions];
}

/** Liste propre (connues, sans doublon, triée) ; lève si une permission est inconnue. */
export function validerPermissions(liste) {
  if (!Array.isArray(liste)) throw new TypeError('permissions');
  const inconnues = liste.filter(p => !permissionConnue(p));
  if (inconnues.length > 0) {
    const e = new Error(`Permission inconnue : ${inconnues.slice(0, 3).join(', ')}`);
    e.inconnues = inconnues;
    throw e;
  }
  return [...new Set(liste)].sort();
}

/**
 * Permissions effectives d'un acteur dans une team :
 *  - super admin : toutes ;
 *  - membre actif : celles de son rôle (toutes pour un Propriétaire) ;
 *  - sinon (suspendu, absent) : aucune.
 */
export function permissionsEffectives({ superAdmin = false, membre, role, permissionsRole = [] }) {
  if (superAdmin) return new Set(TOUTES_PERMISSIONS);
  if (!membre || membre.statut !== 'actif' || !role) return new Set();
  if (role.cle_systeme === CLE_PROPRIETAIRE) return new Set(TOUTES_PERMISSIONS);
  return new Set(permissionsRole.filter(permissionConnue));
}

/**
 * Anti-escalade : on ne donne (ni ne retire à un rôle, ni n'attribue à un
 * membre) que des permissions que l'on a soi-même. Rend la liste de celles
 * qui manquent (vide : permis).
 */
export function permissionsManquantes(acteur, demandees) {
  return [...new Set(demandees)].filter(p => !acteur.has(p));
}

export function peutAccorder(acteur, demandees) {
  return permissionsManquantes(acteur, demandees).length === 0;
}

/** Une action est-elle permise : la permission, et son module activé (le cœur l'est toujours). */
export function autorise(permissions, modulesActifs, permission) {
  const module = moduleDePermission(permission);
  if (module && !modulesActifs.has(module)) return false;
  return permissions.has(permission);
}

/** Modules d'un preset de création (`personnalise` : ceux choisis, filtrés). */
export function modulesDuPreset(cle, choisis = []) {
  const preset = PRESETS.find(p => p.cle === cle);
  if (!preset) return undefined;
  const liste = preset.modules ?? choisis;
  return [...new Set(liste.filter(moduleConnu))];
}

/**
 * Matrice d'affichage (lignes : groupes ; colonnes : voir, créer, modifier,
 * supprimer, spéciales) pour un ensemble de permissions.
 */
export function matrice(permissions) {
  const coches = new Set(permissions);
  return GROUPES.map(g => ({
    groupe: g.cle,
    nom: g.nom,
    module: g.module,
    cases: g.permissions.map(p => ({ ...p, coche: coches.has(p.cle) })),
  }));
}
