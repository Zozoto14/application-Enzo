/**
 * Photo du trombinoscope : sur iPhone, iPad et Android (app native), pas de recadrage dans l'app ; l'interface
 * invite à ajouter la photo depuis le site ou l'app PC. Version web : `photo.web.ts`.
 */

import type { PhotoEnvoyee } from './api';

export const photoDisponible = false;
export type Cadrage = 'centre' | 'haut';

export async function choisirPhoto(_cadrage: Cadrage): Promise<{ envoi: PhotoEnvoyee; apercu: string } | undefined> {
  return undefined;
}

/** Télécharger la photo (site et app PC seulement). */
export function telechargerPhoto(_url: string, _nom: string): boolean {
  return false;
}
