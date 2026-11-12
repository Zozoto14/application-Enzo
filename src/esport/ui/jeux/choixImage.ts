/** Choix d'une image (fond de map) : sur l'app mobile, l'édition des maps se fait sur le site ou l'app PC. */

export interface ImageChoisie {
  type: string;
  /** Contenu en base64 (sans en-tête « data: »). */
  donnees: string;
  nom: string;
  taille: number;
}

export const choixImageDisponible = false;

export function choisirImage(): Promise<ImageChoisie | undefined> {
  return Promise.resolve(undefined);
}
