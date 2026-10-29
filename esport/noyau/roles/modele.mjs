/**
 * Modèle des rôles système des NOUVELLES teams (migration 0033, table `roles_modele`) : réglé par le Fondateur
 * depuis la page Rôles et permissions. Sans ligne pour un rôle, ses permissions par défaut du catalogue.
 * Les teams existantes ne changent pas (chacune a sa copie, modifiable dans ses Paramètres › Rôles).
 */

import { jsonOu } from '../outils.mjs';
import { permissionConnue } from '../permissions.mjs';

/** `{ manager: [...], coach: [...] }` : seulement les rôles dont le modèle a été modifié. */
export async function modeleRolesTeam(base) {
  const sortie = {};
  for (const l of await base.tous('SELECT cle_systeme, permissions FROM roles_modele', [])) {
    const liste = jsonOu(l.permissions, []);
    if (Array.isArray(liste)) sortie[l.cle_systeme] = [...new Set(liste.filter(p => typeof p === 'string' && permissionConnue(p)))].sort();
  }
  return sortie;
}
