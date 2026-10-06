/**
 * Entrée de Prospects dans le registre du hub (`src/hub/registre.tsx`).
 *
 * Identifiant `prospects` : ne pas le changer. Réservée au Fondateur du compte
 * historique (`adminSeulement`, sans ouverture aux gestionnaires) : elle
 * n'apparaît jamais dans les autorisations d'un ami.
 */

import type { AppHub } from '../hub/types';
import { accesProspects, infoProspects } from './acces';
import { Prospects } from './Prospects';

export const ID_PROSPECTS = 'prospects';

export const APP_PROSPECTS: AppHub = {
  id: ID_PROSPECTS,
  nom: 'Prospects',
  categorie: 'Admin',
  description: 'Carnet de prospection : contacts, relances, modèles de messages.',
  icone: '✉︎',
  teinte: 'quatre',
  adminSeulement: true,
  disponible: accesProspects,
  info: infoProspects,
  Racine: Prospects,
};
