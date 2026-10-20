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
// Chargé à la demande sur le web (ui/differe.web.tsx) : le hub n'embarque pas le code de l'Esport.
import { EsportDiffere } from './ui/racineDifferee';
import { tr } from './i18n';

export { ID_ESPORT };

export const APP_ESPORT: AppHub = {
  id: ID_ESPORT,
  nom: 'Esport',
  categorie: 'Esport',
  page: 'publique',
  get description() {
      return tr('registre.teams_membres_et_roles');
    },
  icone: '◆',
  teinte: 'anime',
  Racine: EsportDiffere,
};
