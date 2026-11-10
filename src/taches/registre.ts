/**
 * Entrée de Tâches dans le registre du hub (`src/hub/registre.tsx`).
 *
 * Identifiant `taches` : ne pas le changer. Page « Applications ». V3 :
 * l'Administration l'ouvre ou la ferme à un profil comme les autres apps (amis,
 * gestionnaires, administrateurs) ; l'invitation depuis Tâches fait la même
 * chose. Accès et liste des membres ne font qu'un (`accorderAcces`).
 */

import type { AppHub } from '../hub/types';
import { accesTaches, ID_TACHES } from './acces';
import { infoTaches } from './resume';
// Chargé à la demande sur le web (hub/racinesDifferees.web.tsx).
import { Taches } from '../hub/racinesDifferees';

export { ID_TACHES };

export const APP_TACHES: AppHub = {
  id: ID_TACHES,
  nom: 'Tâches',
  categorie: 'Organisation',
  page: 'publique',
  description: 'Projets, listes et tâches : Kanban, calendrier, chronologie, tableau de bord, objectifs, partage avec vos membres.',
  icone: 'taches',
  teinte: 'quatre',
  disponible: accesTaches,
  info: infoTaches,
  Racine: Taches,
};
