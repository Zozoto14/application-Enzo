/** Propriétés communes des deux éditeurs (natif en lecture seule, web complet). */

import type { ThemeHub } from '../../../hub/themes';
import type { ApiStrats } from '../../strats/api';
import type { Assets } from '../../strats/assets';

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
}
