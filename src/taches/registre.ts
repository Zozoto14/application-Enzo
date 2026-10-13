/**
 * Entrée de Tâches dans le registre du hub (`src/hub/registre.tsx`).
 *
 * Identifiant `taches` : ne pas le changer. Page « Applications ». L'app
 * choisit elle-même à qui elle s'ouvre (`attribueeParApp`) : le Fondateur, et
 * l'ami qu'il désigne dans ses réglages ; l'Administration ne la propose pas
 * en case à cocher (un seul ami en V1).
 */

import type { AppHub } from '../hub/types';
import { accesTaches, ID_TACHES } from './acces';
import { infoTaches } from './resume';
import { Taches } from './ui/RacineTaches';

export { ID_TACHES };

export const APP_TACHES: AppHub = {
  id: ID_TACHES,
  nom: 'Tâches',
  categorie: 'Organisation',
  page: 'publique',
  description: 'Projets, listes et tâches : Kanban, calendrier, Ma journée, rappels, partage avec un ami.',
  icone: '☑︎',
  teinte: 'quatre',
  attribueeParApp: true,
  disponible: accesTaches,
  info: infoTaches,
  Racine: Taches,
};
