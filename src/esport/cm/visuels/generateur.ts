/**
 * Rendu d'un visuel en image : sur l'app iPhone / Android (sans canevas Konva), pas de rendu — les visuels se
 * génèrent sur le site ou l'app PC (generateur.web.ts). L'app mobile consulte les rendus et retouche les textes.
 */

import type { OptionsRendu } from './generation';

export const renduDisponible = false;

export async function rendreImage(_o: OptionsRendu): Promise<Blob | null> {
  return null;
}

export async function rendreMiniature(_o: OptionsRendu, _largeur = 320): Promise<string | null> {
  return null;
}
