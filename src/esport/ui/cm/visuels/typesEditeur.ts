/**
 * Ce que l'éditeur de visuels ouvre : un modèle (par défaut ou du club, tous ses formats) ou un visuel
 * généré (un format, une langue, les données de sa source).
 */

import type { ThemeHub } from '../../../../hub/themes';
import type { ApiVisuels, ModeleComplet, Visuel } from '../../../cm/visuels/api';
import type { Charte, TypeVisuel } from '../../../cm/visuels/types';

export type CibleEditeur = { genre: 'modele'; type: TypeVisuel; modele: ModeleComplet | null; portee: string } | { genre: 'visuel'; visuel: Visuel; modele: ModeleComplet | null };

export interface PropsEditeurVisuel {
  theme: ThemeHub;
  api: ApiVisuels;
  large: boolean;
  charte: Charte;
  cible: CibleEditeur;
  /** `change` : quelque chose a été enregistré (la liste appelante se recharge). */
  onFermer(change: boolean): void;
}
