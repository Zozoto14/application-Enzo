/**
 * Page « Réseaux » de l'espace CM : droits.
 *
 * Mêmes permissions que la section CM (cm/commun.mjs), sur la portée de chaque élément :
 *  - CONSULTER (comptes, publications, relevés, tableaux de bord, export CSV) : `cm.voir` du club (tout), ou
 *    `cm.voir` d'une team (ses comptes et publications seulement ; module CM activé) ;
 *  - SAISIR des statistiques (relevés, publications ajoutées à la main, import CSV) : `cm.editer` sur la portée ;
 *  - CONFIGURER (comptes, salons Discord du club, annonces, message de test, réglages) : `cm.gerer` du CLUB.
 * Sans `cm.voir` nulle part : 404 sur toute la page (on ne dit pas qu'elle existe). Page de l'espace « CM du club » :
 * seules les permissions de l'équipe CM comptent (club, affectations), jamais celles d'un rôle de team (Manager).
 */

import { echec } from '../outils.mjs';
import { espaceCm, porteesDe, voitEspaceCm } from '../cm/commun.mjs';

/** Droits Réseaux d'un acteur : `{ club: Set, teams: Map<teamId, Set>, noms: Map }` (portées CM). */
export async function droitsReseaux(base, acteur) {
  const p = espaceCm(await porteesDe(base, acteur));
  if (!voitEspaceCm(p)) throw echec(404, 'route', 'Adresse inconnue.');
  return p;
}

/** L'acteur a-t-il `permission` pour un élément de la team `teamId` (null : du club) ? */
export function peutSur(d, permission, teamId) {
  if (d.club.has(permission)) return true;
  return Boolean(teamId && d.teams.get(teamId)?.has(permission));
}

export function exigerSur(d, permission, teamId) {
  if (!peutSur(d, permission, teamId)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
}

/** Configuration (comptes, salons, annonces) : `cm.gerer` du club. */
export function exigerGerer(d) {
  if (!d.club.has('cm.gerer')) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
}

/** Filtre SQL des éléments visibles : tout (club), ou les teams où l'acteur a `cm.voir` (jamais ceux du club). */
export function teamsVisibles(d, permission = 'cm.voir') {
  if (d.club.has(permission)) return null;
  return [...d.teams].filter(([, s]) => s.has(permission)).map(([id]) => id);
}
