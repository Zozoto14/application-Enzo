/**
 * Whisper dans le navigateur : seulement sur le site et le PC (`whisper.web.ts`). Sur l'app iOS
 * native, la transcription se lance depuis un PC.
 */

import { tr } from '../i18n';
import type { Transcripteur } from './travail';

export const transcriptionDisponible = false;
export type ModeleWhisper = 'base' | 'small';

export async function creerTranscripteur(_o: { modele?: ModeleWhisper; langue: string; onChargement?(f: number): void }): Promise<Transcripteur> {
  throw new Error(tr('transcription.indisponible'));
}

export async function webgpuDisponible(): Promise<boolean> {
  return false;
}
