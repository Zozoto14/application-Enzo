/** Capacités de l'appareil pour la transcription : l'app iOS native ne transcrit pas (version web : `appareil.web.ts`). */

export interface CapaciteAppareil {
  transcription: boolean;
  iphone: boolean;
  faible: boolean;
}

export function capaciteAppareil(): CapaciteAppareil {
  return { transcription: false, iphone: true, faible: true };
}
