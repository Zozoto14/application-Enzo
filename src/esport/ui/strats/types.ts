/** Propriétés communes des deux éditeurs (natif en lecture seule, web complet). */

import type React from 'react';
import type { ThemeHub } from '../../../hub/themes';
import type { ApiStrats } from '../../strats/api';
import type { Assets } from '../../strats/assets';
import type { ClientEsport } from '../../client';

export interface PropsEditeur {
  theme: ThemeHub;
  api: ApiStrats;
  teamId: string;
  stratId: string;
  large: boolean;
  assets: Assets | undefined;
  onRetour(): void;
  /** Ouvrir une autre strat (copie fraîchement dupliquée). */
  onOuvrir(id: string): void;
  /** La strat vient d'être supprimée (corbeille) : la liste revient avec le toast « Annuler ». */
  onSupprimee(strat: { id: string; titre: string }): void;
  /** Temps réel : prévenir quand quelqu'un d'autre enregistre la strat ouverte (absent : sans temps réel). */
  client?: ClientEsport;
  /** Ouvrir Administration › Jeux (calibrer la map) ; absent : ce compte n'y a pas accès. */
  onAdminJeux?(): void;
  /**
   * Section ajoutée dans le tiroir de l'atelier, sous l'onglet « Étape » (lineups liés à la strat). `sortir` : à
   * appeler pour quitter l'atelier vers un autre écran (ce qui reste à enregistrer part d'abord).
   */
  extrasTiroir?(sortir: (suite: () => void) => void): React.ReactNode;
}
