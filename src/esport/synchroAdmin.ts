/**
 * Une seule source de vérité pour les comptes : l'Administration du hub.
 *
 * Quand le Fondateur supprime un compte dans l'Administration, l'Esport en
 * est averti tout de suite (`DELETE /admin/comptes/:id/hub`, super admin) : le
 * compte quitte toutes ses teams et ses données personnelles Esport sont
 * effacées. Si le serveur Esport est injoignable à ce moment-là, la page
 * Membres de l'Esport (Fondateur) signale le compte orphelin et propose de le
 * retirer (`comptesOrphelins`).
 */

import type { Profil } from '../profils/profils';
import { estInactif, trouverConfig, type CompteEsport } from './client';
import { fabrique } from './fabrique';

export interface BilanRetrait {
  /** Le compte avait un profil ou des teams dans l'Esport, maintenant retirés. */
  retire: boolean;
  teams: number;
  /** Esport pas activé sur ce relais : rien à faire. */
  inactif?: boolean;
}

/** Retire de l'Esport un compte supprimé dans l'Administration. Lève si le serveur refuse ou ne répond pas. */
export async function retirerCompteEsport(id: string): Promise<BilanRetrait> {
  const { config } = await trouverConfig(fabrique.relais());
  if (!config) return { retire: false, teams: 0, inactif: true };
  const client = fabrique.client(config);
  try {
    const r = await client.retirerCompte(id);
    return { retire: r.retire, teams: r.teams };
  } catch (e) {
    if (estInactif(e)) return { retire: false, teams: 0, inactif: true };
    throw e;
  }
}

/**
 * Comptes connus de l'Esport mais absents de l'Administration (supprimés
 * pendant que l'Esport était injoignable). Seulement avec la liste COMPLÈTE
 * des comptes (Fondateur, appareil non restreint) : sinon, rien.
 */
export function comptesOrphelins(comptes: readonly CompteEsport[], profils: readonly Pick<Profil, 'id'>[] | undefined, complete: boolean): CompteEsport[] {
  if (!profils || !complete || profils.length === 0) return [];
  const connus = new Set(profils.map(p => p.id));
  return comptes.filter(c => c.compte !== 'principal' && !connus.has(c.compte));
}
