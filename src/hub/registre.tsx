/**
 * Registre des apps du hub.
 *
 * **Ajouter une app = ajouter une entrée ici** : identifiant, nom, icône,
 * teinte, **catégorie de page** (`page` : « publique » → page « Applications »,
 * « administration » → page « Administration », voir `pages.ts`), droits
 * (`adminSeulement`, `rangs`), information en direct et écran racine. Le hub
 * en fait une tuile sur la bonne page, l'Administration une case
 * d'autorisation (apps publiques), sans autre modification.
 *
 * L'identifiant est enregistré dans les autorisations des profils : ne le
 * changez pas une fois l'app livrée.
 */

import { Administration } from './Administration';
import { infoAdministration, infoPortefeuille } from './infos';
import { APP_TSUZUKU } from '../tsuzuku/registre';
import { APP_ABONNEMENTS } from './abonnements/registre';
import { APP_PROSPECTS } from '../prospects/registre';
import { APP_CLAUDE_OFFICE } from '../claudeOffice/registre';
import type { AppHub } from './types';

export const ID_PORTEFEUILLE = 'portefeuille';
export const ID_ADMINISTRATION = 'administration';

export const REGISTRE: readonly AppHub[] = [
  {
    id: ID_PORTEFEUILLE,
    nom: 'Portefeuille',
    categorie: 'Finance',
    page: 'publique',
    description: 'Positions, performance, alertes et podcast du jour.',
    icone: '↗',
    teinte: 'portefeuille',
    info: contexte => infoPortefeuille(contexte.portefeuille),
    // Pas de Racine : l'arbre du portefeuille est celui d'App, déjà monté.
  },
  APP_TSUZUKU,
  {
    id: ID_ADMINISTRATION,
    nom: 'Administration',
    categorie: 'Admin',
    page: 'administration',
    description: 'Comptes des amis, identifiants et accès aux apps.',
    icone: '⚙︎',
    teinte: 'admin',
    adminSeulement: true,
    // Les gestionnaires (amis promus) l'ouvrent en version limitée : voir `admin/roles.ts`.
    gestionnaire: true,
    // Il faut une plateforme qui sache créer le coffre d'un autre profil.
    disponible: contexte => Boolean(contexte.profils?.onCreerCompte),
    info: contexte => infoAdministration(contexte.profils?.gestion?.comptes ?? contexte.profils?.tous),
    Racine: Administration,
  },
  APP_ABONNEMENTS,
  APP_PROSPECTS,
  APP_CLAUDE_OFFICE,
];
