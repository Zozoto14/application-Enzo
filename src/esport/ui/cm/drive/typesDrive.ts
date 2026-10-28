/** Propriétés communes aux versions native et web des briques du Drive (aperçu, zone de dépôt). */

import type React from 'react';
import type { ThemeHub } from '../../../../hub/themes';
import type { FichierDrive } from '../../../cm/drive';
import type { FichierNavigateur } from '../../../medias/choixFichier';

export interface PropsApercuDrive {
  theme: ThemeHub;
  fichier: FichierDrive;
  /** Lien signé (2 h) vers la version affichée. */
  obtenirUrl(): Promise<string>;
}

export interface PropsZoneDepot {
  theme: ThemeHub;
  actif: boolean;
  onFichiers(f: FichierNavigateur[]): void;
  children: React.ReactNode;
  testID?: string;
}
