/**
 * Entrée de l'Esport dans le registre du hub (`src/hub/registre.tsx`).
 *
 * Identifiant `esport` : ne pas le changer (il est enregistré dans les
 * autorisations des comptes). Page « Applications ». Un membre d'une team est
 * un compte Ami dont la seule app est `esport` (modèle « Esport seulement » de
 * l'Administration) : le hub ne lui montre que cette tuile.
 */

import type { AppHub } from '../hub/types';
import { ID_ESPORT } from './acces';
import { Esport } from './ui/RacineEsport';

export { ID_ESPORT };

export const APP_ESPORT: AppHub = {
  id: ID_ESPORT,
  nom: 'Esport',
  categorie: 'Esport',
  page: 'publique',
  description: 'Teams, membres et rôles, invitations, journal, résumés de réunions, objectifs et tâches ; planning, review et strats à venir.',
  icone: '◆',
  teinte: 'anime',
  Racine: Esport,
};
