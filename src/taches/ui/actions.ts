/**
 * Ce que les vues de Tâches peuvent demander à la racine (ouvrir, terminer,
 * changer un champ, ouvrir un menu de choix), pour qu'elles restent de
 * simples affichages.
 */

import type { ThemeHub } from '../../hub/themes';
import type { Droits } from '../acces';
import type { Genre } from '../corbeille';
import type { Destination } from '../deplacer';
import type { ChangementTache, Tache } from '../modele';
import type { EtatApp } from './etat';
import type { CacheGithub } from '../github';
import type { Secrets } from '../ia';

/** Ce que l'aide de l'IA peut traiter. */
export type CibleIA = { genre: 'decouper'; tacheId: string } | { genre: 'resumer'; projetId: string; debriefing?: string } | { genre: 'planning' };

/** IA et GitHub (V3, Fondateur) : réglages de l'appareil, état des PR, ouverture de l'aide. */
export interface AidesV3 {
  secrets: Secrets;
  changerSecrets(s: Secrets): void;
  github: CacheGithub;
  /** Relit l'état des PR (au plus toutes les 5 min, sauf `force`). */
  rafraichirGithub(force?: boolean): Promise<void>;
  ouvrirIA(cible: CibleIA): void;
}

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
  /** Ouvre la confirmation de suppression (ce qui part, déplacer le contenu). */
  demanderSuppression(genre: Genre, id: string): void;
  /** Supprime vers la corbeille et propose « Annuler » pendant 10 s. */
  supprimer(genre: Genre, id: string, deplacerVers?: string): void;
  /** Démarre le minuteur sur la tâche (celui qui tournait ailleurs s'arrête), ou l'arrête. */
  minuteur(t: Tache): void;
  /** V3 : IA et GitHub (Fondateur seulement). */
  aides?: AidesV3;
  /** Ouvre la fenêtre « Déplacer » pour ces tâches (mode « parents » : convertir en sous-tâche). */
  demanderDeplacement?(ids: readonly string[], dest?: Destination, mode?: 'auto' | 'parents'): void;
  /** Dépôt d'un glisser sur la barre latérale (« projet:… », « liste:… ») : déplace, ou ouvre la fenêtre s'il y a un choix à faire. */
  deposer?(ids: readonly string[], zone: string): void;
  /** Menu « ⋯ » d'une tâche (déplacer, convertir, sélectionner, supprimer). */
  menuTache?(t: Tache): void;
  /** Multi-sélection (vue Liste) : cases, Maj + clic (plage), Ctrl/Cmd + clic (ajout). */
  selection?: SelectionTaches;
}

export interface SelectionTaches {
  ids: readonly string[];
  /** `ordre` : les tâches affichées, dans l'ordre (pour la plage Maj + clic). */
  basculer(id: string, mode: 'ajout' | 'plage', ordre?: readonly string[]): void;
  /** Tout sélectionner (ou tout désélectionner si tout l'est déjà). */
  tout(ids: readonly string[]): void;
  vider(): void;
}
