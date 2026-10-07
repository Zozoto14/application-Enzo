/**
 * Qui ouvre Prospects : le Fondateur du compte historique, seul. Comme les
 * Abonnements, le carnet vit dans la base chiffrée de l'administration
 * (`contexte.admin`, présent seulement pour lui) : un ami, un gestionnaire ou
 * un administrateur n'a ni la tuile (`adminSeulement` dans le registre) ni
 * les données, même si sa liste d'apps a été retouchée.
 */

import { rangDe } from '../hub/admin/roles';
import { chargerDonnees } from '../hub/admin/donnees';
import type { ContexteHub, InfoLive } from '../hub/types';
import { compter, jourDe, type DonneesProspects } from './prospects';

export function accesProspects(contexte: Pick<ContexteHub, 'profil' | 'admin'>): boolean {
  const profil = contexte.profil;
  return Boolean(contexte.admin) && rangDe(profil) === 'fondateur' && (!profil || profil.admin);
}

/** Carnet du Fondateur, ou undefined pour tout autre compte. */
export function lireCarnet(contexte: Pick<ContexteHub, 'profil' | 'admin'>): DonneesProspects | undefined {
  if (!accesProspects(contexte) || !contexte.admin) return undefined;
  return chargerDonnees(contexte.admin.stockage).prospects;
}

/** Information en direct de la tuile : relances du jour et nombre de fiches. */
export function infoProspects(contexte: ContexteHub): InfoLive | undefined {
  const carnet = lireCarnet(contexte);
  if (!carnet) return undefined;
  const c = compter(Object.values(carnet.prospects), jourDe(contexte.maintenant ?? Date.now()));
  return {
    sousTitre: c.total === 0 ? 'Carnet vide' : c.aRelancer > 0 ? `${c.aRelancer} à relancer aujourd’hui` : 'Aucune relance aujourd’hui',
    indicateurs: [
      { libelle: 'Fiches', valeur: String(c.total) },
      { libelle: 'À relancer', valeur: String(c.aRelancer), tendance: c.aRelancer > 0 ? 'hausse' : 'neutre' },
    ],
  };
}
