/** Capacités de l'appareil pour la transcription : l'app iOS native ne transcrit pas (version web : `appareil.web.ts`). */

import type { CapaciteAppareil } from './typesAppareil';

export type { CapaciteAppareil } from './typesAppareil';

export function capaciteAppareil(): CapaciteAppareil {
  return { transcription: false, iphone: true, faible: true };
}
