/**
 * Allègement d'une capture d'écran avant l'envoi. App iPhone : rien (le dépôt se fait depuis le site ou le PC).
 * Site et app PC : `image.web.ts`.
 */

import type { FichierNavigateur } from '../medias/choixFichier';

export async function allegerImage(f: FichierNavigateur): Promise<FichierNavigateur> {
  return f;
}
