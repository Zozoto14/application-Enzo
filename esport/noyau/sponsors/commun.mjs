/**
 * Sponsors & partenaires : droits et lectures communes.
 *
 * Deux permissions du CLUB, portées par les rôles CM (Esport › CM › Équipe CM) : `sponsors.voir` (lire le
 * pipeline, les fiches, le tableau de bord) et `sponsors.gerer` (tout écrire : prospects, partenaires,
 * contrats, obligations, étapes, import / export, RGPD des contacts). Elles ne valent QUE par une affectation
 * « club » : une affectation de team, un rôle de team ou l'appartenance à une team n'ouvrent jamais rien ici.
 * Le Fondateur a tout. Par défaut (migration 0024) : le rôle système « Responsable CM ».
 *
 * Un compte sans `sponsors.voir` reçoit 404 sur toute la rubrique (on ne dit pas qu'elle existe).
 */

import { echec } from '../outils.mjs';
import { PERMISSIONS_CM } from '../cm/commun.mjs';

export const PERMISSIONS_SPONSORS = Object.freeze(['sponsors.voir', 'sponsors.gerer']);
export const PORTEE_SPONSORS = 'sponsors';
/** Permissions qu'un rôle CM peut porter (Équipe CM) : celles du CM et celles des Sponsors. */
export const PERMISSIONS_ROLES_CM = Object.freeze([...PERMISSIONS_CM, ...PERMISSIONS_SPONSORS]);

/** Permissions Sponsors d'un acteur (Set) : Fondateur, ou affectations « club » à un rôle CM qui les porte. */
export async function droitsSponsors(base, acteur) {
  if (acteur?.superAdmin) return new Set(PERMISSIONS_SPONSORS);
  if (!acteur?.compte) return new Set();
  const lignes = await base.tous(
    "SELECT DISTINCT rp.permission FROM cm_affectations a JOIN cm_role_permissions rp ON rp.role_id = a.role_id WHERE a.compte_id = ? AND a.portee = 'club' AND rp.permission IN ('sponsors.voir', 'sponsors.gerer')",
    [acteur.compte],
  );
  const s = new Set(lignes.map(l => l.permission));
  // Gérer sans voir n'a pas de sens : gérer implique voir.
  if (s.has('sponsors.gerer')) s.add('sponsors.voir');
  return s;
}

/** Contexte Sponsors : 404 sans `sponsors.voir`, 403 si `gerer` est demandé sans la permission. */
export async function contexteSponsors(base, acteur, { gerer = false } = {}) {
  const permissions = await droitsSponsors(base, acteur);
  if (!permissions.has('sponsors.voir')) throw echec(404, 'route', 'Adresse inconnue.');
  if (gerer && !permissions.has('sponsors.gerer')) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
  return { acteur, permissions, gerer: permissions.has('sponsors.gerer') };
}

/** Comptes qui ont une permission Sponsors (affectations « club ») ; le Fondateur s'il a un profil. */
export async function comptesSponsors(base, permission = 'sponsors.gerer') {
  const voulues = permission === 'sponsors.voir' ? ['sponsors.voir', 'sponsors.gerer'] : ['sponsors.gerer'];
  const lignes = await base.tous(
    `SELECT DISTINCT a.compte_id FROM cm_affectations a JOIN cm_role_permissions rp ON rp.role_id = a.role_id WHERE a.portee = 'club' AND rp.permission IN (${voulues.map(() => '?').join(', ')})`,
    voulues,
  );
  const s = new Set(lignes.map(l => l.compte_id));
  if (await base.premier("SELECT id FROM comptes WHERE id = 'principal'", [])) s.add('principal');
  return s;
}
