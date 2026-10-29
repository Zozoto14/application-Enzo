/**
 * Permissions du CLUB (globales, hors team) d'un compte : migration 0033, docs/esport/roles-permissions.md.
 *
 * Elles viennent de la vue `permissions_club` : affectations CM « club », rôles du club (`roles_globaux`, dont
 * « Second CEO ») et accords directs (`permissions_globales`, migration 0021 : jeux.gerer). Le Fondateur (super
 * admin, jeton maître) les a toutes, d'office : rien n'est stocké pour lui, rien ne peut les lui retirer.
 *
 * Module FEUILLE (n'importe que le catalogue) : la section CM, les Sponsors, le trombinoscope et le cœur s'en servent
 * sans dépendance circulaire.
 */

import catalogue from '../catalogue.json' with { type: 'json' };

/** Permissions propres au club (catalogue.json, `permissionsGlobales`). */
export const PERMISSIONS_GLOBALES = Object.freeze(catalogue.permissionsGlobales.map(p => p.cle));
/** Permissions qu'un délégué ne peut ni accorder ni retirer : seul le Fondateur y touche. */
export const PERMISSIONS_FONDATEUR_SEUL = Object.freeze(catalogue.permissionsGlobales.filter(p => p.fondateurSeul).map(p => p.cle));
/** Toutes les permissions décrites au catalogue (team, CM, club). */
export const PERMISSIONS_DECRITES = Object.freeze(Object.keys(catalogue.descriptions));

/** Permissions du club d'un acteur (Set). Fondateur : toutes celles du catalogue. */
export async function permissionsGlobalesDe(base, acteur) {
  if (acteur?.superAdmin) return new Set(PERMISSIONS_DECRITES);
  if (!acteur?.compte) return new Set();
  const lignes = await base.tous('SELECT DISTINCT permission FROM permissions_club WHERE compte_id = ?', [acteur.compte]);
  return new Set(lignes.map(l => l.permission));
}

/** L'acteur a-t-il cette permission du club (Fondateur : toujours) ? */
export async function aGlobale(base, acteur, permission) {
  if (acteur?.superAdmin) return true;
  if (!acteur?.compte) return false;
  return Boolean(await base.premier('SELECT compte_id FROM permissions_club WHERE compte_id = ? AND permission = ?', [acteur.compte, permission]));
}

/** Comptes qui ont une permission du club (hors Fondateur). */
export async function comptesAvecGlobale(base, permission) {
  return new Set((await base.tous('SELECT DISTINCT compte_id FROM permissions_club WHERE permission = ?', [permission])).map(l => l.compte_id));
}
