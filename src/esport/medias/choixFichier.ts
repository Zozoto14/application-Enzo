/**
 * Choix d'un fichier vidéo ou audio. Sur iPhone et iPad (app native), pas de sélecteur de fichiers
 * intégré : l'interface invite à déposer depuis le site ou le PC. Version web : `choixFichier.web.ts`.
 */

import type { FichierLocal } from './envoi';

export const choixFichierDisponible = false;

export interface FichierNavigateur extends FichierLocal {
  fichier: unknown;
}

export async function choisirFichier(_accept: string, _testID?: string): Promise<FichierNavigateur | undefined> {
  return undefined;
}

export const ACCEPT_VIDEO = '';
export const ACCEPT_REUNION = '';
