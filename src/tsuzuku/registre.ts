/**
 * Entrée de Tsuzuku dans le registre du hub (`src/hub/registre.tsx`).
 *
 * L'identifiant `tsuzuku` est enregistré dans les autorisations des profils :
 * ne le changez pas. L'accès est réglé par l'Administration comme pour toute app
 * (un ami sans `tsuzuku` ne voit pas la tuile) ; la politique globale
 * (désactivation, maintenance) s'applique sans code propre.
 */

import type { AppHub } from '../hub/types';
// Chargé à la demande sur le web (hub/racinesDifferees.web.tsx).
import { Tsuzuku } from '../hub/racinesDifferees';
import { infoTsuzuku } from './app/resume';

export const ID_TSUZUKU = 'tsuzuku';

export const APP_TSUZUKU: AppHub = {
  id: ID_TSUZUKU,
  nom: 'Tsuzuku',
  categorie: 'Animés · Films',
  page: 'publique',
  description: 'Animés et films : catalogue, lecture, bibliothèque, sans serveur.',
  icone: 'tele',
  teinte: 'anime',
  info: contexte => infoTsuzuku(contexte.tsuzuku),
  Racine: Tsuzuku,
};
