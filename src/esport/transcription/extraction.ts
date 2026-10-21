/**
 * Extraction de l'audio : seulement sur le site et le PC (Web Audio API, `extraction.web.ts`). Sur
 * l'app iOS native, la transcription se lance depuis un PC.
 */

import { tr } from '../i18n';
import type { SourceAudio } from './travail';

export const SEUIL_DECODAGE = 0;

export async function ouvrirSourceAudio(_entree: { fichier?: unknown; url?: string; taille?: number }): Promise<SourceAudio> {
  throw new Error(tr('transcription.indisponible'));
}
