/**
 * Qui ouvre Tâches, et avec quels droits.
 *
 *  - le Fondateur du compte historique (`contexte.admin` présent, rang
 *    Fondateur, profil administrateur) : tout ;
 *  - l'ami qu'il a choisi dans les réglages de l'app (un seul en V1) : l'app
 *    lui est ouverte par ce choix (son accès `taches`, que l'Administration ne
 *    propose pas en case à cocher) ; il ne voit que les projets partagés avec
 *    lui, modifie seulement ceux partagés en écriture, ne supprime jamais un
 *    projet ;
 *  - tout autre compte : ni tuile, ni données.
 */

import { rangDe } from '../hub/admin/roles';
import type { ContexteHub } from '../hub/types';
import type { Auteur, DonneesTaches, ModePartage } from './modele';
import { CLES_TACHES, lireCopie, modeProjet } from './partage';
import type { BasePrefs } from '../tsuzuku/plateforme/stockage';

export const ID_TACHES = 'taches';

export type RoleTaches = Auteur;

/**
 * Rôle du compte ouvert. L'ami doit avoir l'accès `taches` (donné par le
 * Fondateur en le choisissant) ET avoir reçu le dépôt scellé pour lui (qui
 * porte la clé de partage) : un compte à qui l'accès aurait été donné
 * autrement, ou un ancien ami (dépôt retiré), ne voit rien.
 */
export function roleTaches(contexte: Pick<ContexteHub, 'profil' | 'admin' | 'baseProfil'>): RoleTaches | undefined {
  const profil = contexte.profil;
  if (contexte.admin && rangDe(profil) === 'fondateur' && (!profil || profil.admin)) return 'fondateur';
  if (profil && !profil.admin && profil.actif !== false && (profil.apps ?? []).includes(ID_TACHES) && amiDesigne(contexte.baseProfil)) return 'ami';
  return undefined;
}

/** La copie de l'ami porte la clé de partage : le Fondateur l'a bien désigné. */
export function amiDesigne(base: Pick<BasePrefs, 'lire'> | undefined): boolean {
  try {
    return Boolean(lireCopie(base?.lire(CLES_TACHES.copie)).cle);
  } catch {
    return false;
  }
}

export const accesTaches = (contexte: Pick<ContexteHub, 'profil' | 'admin' | 'baseProfil'>): boolean => roleTaches(contexte) !== undefined;

/** Droits sur un projet donné. */
export interface Droits {
  voir: boolean;
  /** Créer, modifier, terminer, commenter des tâches. */
  modifier: boolean;
  /** Listes, statuts, partage, renommage, suppression du projet. */
  gerer: boolean;
  supprimerProjet: boolean;
  mode: ModePartage | 'proprietaire';
}

export function droitsProjet(role: RoleTaches | undefined, d: DonneesTaches, projetId: string): Droits {
  if (role === 'fondateur') return { voir: Boolean(d.projets[projetId]), modifier: true, gerer: true, supprimerProjet: true, mode: 'proprietaire' };
  if (role === 'ami') {
    const mode = modeProjet(d, projetId);
    return { voir: mode !== 'aucun', modifier: mode === 'ecriture', gerer: false, supprimerProjet: false, mode };
  }
  return { voir: false, modifier: false, gerer: false, supprimerProjet: false, mode: 'aucun' };
}
