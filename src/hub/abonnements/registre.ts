/**
 * Entrée de l'app « Abonnements » dans le registre du hub (`../registre.tsx`).
 *
 * Page « Administration », réservée aux Fondateurs (comme l'était la section
 * Abonnements de l'Administration) : `adminSeulement` + `rangs`. L'identifiant
 * `abonnements` peut figurer dans la politique globale (activation,
 * maintenance) : ne le changez pas.
 */

import type { AppHub, ContexteHub, InfoLive } from '../types';
import { resumeAdminDuContexte } from './BandeauAbonnement';
import { AppAbonnements } from './AppAbonnements';
import { ID_ABONNEMENTS } from './actionsAbo';

export { ID_ABONNEMENTS };

/** Information en direct de la tuile : retards et échéances de la semaine. */
export function infoAbonnements(contexte: ContexteHub): InfoLive | undefined {
  try {
    const admin = resumeAdminDuContexte(contexte, contexte.maintenant ?? Date.now());
    if (!admin) return undefined;
    return {
      sousTitre: admin.resume.texte ? `${admin.resume.texte[0].toUpperCase()}${admin.resume.texte.slice(1)}` : 'Aucun retard, aucune échéance cette semaine',
      indicateurs: [
        { libelle: 'En retard', valeur: String(admin.resume.retard), tendance: admin.resume.retard > 0 ? 'baisse' : 'neutre' },
        { libelle: 'Cette semaine', valeur: String(admin.resume.semaine) },
      ],
    };
  } catch {
    return undefined;
  }
}

export const APP_ABONNEMENTS: AppHub = {
  id: ID_ABONNEMENTS,
  nom: 'Abonnements',
  categorie: 'Admin',
  page: 'administration',
  description: 'Qui a payé, échéances et rappels (suivi manuel).',
  icone: 'carte-bancaire',
  teinte: 'quatre',
  adminSeulement: true,
  rangs: ['fondateur'],
  // Les données vivent dans la base de l'Administration : il faut ses services.
  disponible: contexte => Boolean(contexte.admin && contexte.profils),
  info: infoAbonnements,
  Racine: AppAbonnements,
};
