/**
 * Règle d'ouverture d'une app réservée (`adminSeulement`) à un rang, partagée
 * par `permissions.ts` (tuiles) et `admin/comptes.ts` (niveaux d'accès).
 * Aucune dépendance : pure, testée avec les permissions.
 */

import type { RoleProfil } from '../profils/profils';
import type { AppHub } from './types';

/** Rang (autre que le compte historique) qui ouvre l'Administration. */
export function rangAdministration(role: RoleProfil | undefined): boolean {
  return role === 'gestionnaire' || role === 'administrateur' || role === 'fondateur';
}

/**
 * Une app réservée s'ouvre-t-elle à ce rang ? Avec `rangs`, seulement aux
 * rangs listés ; sinon, aux rangs d'administration si elle se déclare ouverte
 * aux gestionnaires (l'Administration, en version limitée).
 */
export function reserveeOuverteAuRang(app: Pick<AppHub, 'gestionnaire' | 'rangs'>, role: RoleProfil | undefined): boolean {
  if (app.rangs) {
    return role !== undefined && app.rangs.includes(role);
  }
  return rangAdministration(role) && app.gestionnaire === true;
}
