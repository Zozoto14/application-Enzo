/**
 * Accès à l'Esport dans le hub.
 *
 * Un membre d'une team est un compte du hub invité par le Fondateur (système
 * d'invitation habituel), de rang Ami, dont la liste d'apps est `['esport']` :
 * son périmètre est « Esport seulement » (modèle de permissions du même nom
 * dans l'Administration). Le hub ne lui montre que l'Esport (règle générale de
 * `hub/permissions.ts`), le relais ne lui ouvre que son espace, et le serveur Esport
 * Esport ne sert que l'Esport. L'interface Esport ne touche jamais aux rangs
 * du hub : rôles d'équipe et rangs du hub sont deux mondes séparés.
 */

import type { Profil } from '../profils/profils';
import { rangDe } from '../hub/admin/roles';

export const ID_ESPORT = 'esport';

/** Compte limité à l'Esport (badge « Esport » de l'Administration). */
export function perimetreEsportSeul(profil: Pick<Profil, 'admin' | 'apps' | 'role'> | undefined): boolean {
  if (!profil || profil.admin || rangDe(profil) !== 'ami') return false;
  const apps = profil.apps ?? [];
  return apps.length > 0 && apps.every(id => id === ID_ESPORT);
}

/** Compte qui a l'Esport parmi ses apps (ou l'administrateur). */
export function aAccesEsport(profil: Pick<Profil, 'admin' | 'apps'> | undefined): boolean {
  return !profil || profil.admin || (profil.apps ?? []).includes(ID_ESPORT);
}
