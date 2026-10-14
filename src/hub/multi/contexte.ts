/**
 * Ce que l'hôte des onglets dit aux apps et à la coque du hub.
 *
 *  - `useInfoOnglet()` : pour une app, son onglet est-il affiché, et partage-t-il
 *    l'écran avec une autre app (côte à côte) ? Les apps sensibles s'en servent
 *    pour que leur verrouillage sur inactivité ne compte que l'activité faite
 *    chez elles. Hors onglets (tests, appareil sans hub) : affiché, seul.
 *  - `useOngletsHub()` : la barre d'onglets elle-même (sélecteur compact du
 *    téléphone, dans l'en-tête des apps et du hub).
 *
 * Les onglets masqués sont rendus sous `<Activity mode="hidden">` : leur état
 * est gardé, mais leurs effets (minuteurs, sondages, écouteurs du clavier,
 * animations) sont suspendus jusqu'à leur retour à l'écran.
 */

import { createContext, useContext } from 'react';
import type { AppHub } from '../types';
import type { EtatOnglets } from './onglets';

export interface InfoOnglet {
  /** L'onglet est à l'écran. */
  affiche: boolean;
  /** Deux apps partagent l'écran (côte à côte). */
  partage: boolean;
  /** Élément racine de l'onglet (web) : l'activité faite ailleurs ne compte pas pour lui. */
  racine?(): unknown;
}

const PAR_DEFAUT: InfoOnglet = { affiche: true, partage: false };

export const InfoOngletContexte = createContext<InfoOnglet>(PAR_DEFAUT);

export function useInfoOnglet(): InfoOnglet {
  return useContext(InfoOngletContexte);
}

export interface ControleOnglets {
  etat: EtatOnglets;
  /** Apps des onglets ouverts, dans l'ordre de la barre. */
  apps: readonly AppHub[];
  activer(id: string | undefined): void;
  fermer(id: string): void;
}

export const OngletsHubContexte = createContext<ControleOnglets | undefined>(undefined);

export function useOngletsHub(): ControleOnglets | undefined {
  return useContext(OngletsHubContexte);
}
