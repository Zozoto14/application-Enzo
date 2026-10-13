/**
 * Ce que les vues de Tâches peuvent demander à la racine (ouvrir, terminer,
 * changer un champ, ouvrir un menu de choix), pour qu'elles restent de
 * simples affichages.
 */

import type { ThemeHub } from '../../hub/themes';
import type { Droits } from '../acces';
import type { ChangementTache, Tache } from '../modele';
import type { EtatApp } from './etat';

export interface Actions {
  theme: ThemeHub;
  mobile: boolean;
  etat: EtatApp;
  ouvrir(id: string): void;
  /** Termine (récurrence comprise) ou rouvre. */
  basculer(id: string): void;
  changer(id: string, c: ChangementTache): void;
  droits(projetId: string): Droits;
  menuStatut(t: Tache): void;
  menuPriorite(t: Tache): void;
  menuEcheance(t: Tache): void;
  menuAssigne(t: Tache): void;
  /** Change de statut par une colonne (Kanban sans projet : statut du même nom). */
  versColonne(t: Tache, colonne: string): void;
  /** Ajoute à « Ma journée » (ou l'en retire). */
  basculerJournee(t: Tache): void;
}
