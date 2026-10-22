/**
 * Choix d'un fichier vidéo ou audio sur le site et le PC (champ de fichier du navigateur). Le fichier
 * n'est JAMAIS lu en entier : `lire(debut, fin)` en découpe une tranche (`File.slice`), pour l'envoi par
 * morceaux et l'extraction de l'audio.
 */

import type { FichierLocal } from './envoi';

export const choixFichierDisponible = true;

/** Fichier local du navigateur, et l'objet `File` d'origine (lecteur, décodage audio). */
export interface FichierNavigateur extends FichierLocal {
  fichier: File;
}

export function depuisFile(f: File): FichierNavigateur {
  return {
    nom: f.name,
    taille: f.size,
    type: f.type,
    derniereModif: f.lastModified,
    fichier: f,
    lire: async (debut, fin) => new Uint8Array(await f.slice(debut, fin).arrayBuffer()),
  };
}

/** `accept` : types proposés par le sélecteur (le serveur vérifie de toute façon les octets). */
export function choisirFichier(accept: string, testID = 'esport-fichier-champ'): Promise<FichierNavigateur | undefined> {
  return new Promise(resoudre => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) {
      resoudre(undefined);
      return;
    }
    const champ = doc.createElement('input');
    champ.type = 'file';
    champ.accept = accept;
    champ.style.display = 'none';
    champ.setAttribute('data-testid', testID);
    champ.addEventListener('change', () => {
      const f = champ.files?.[0];
      champ.remove();
      resoudre(f ? depuisFile(f) : undefined);
    });
    champ.addEventListener('cancel', () => {
      champ.remove();
      resoudre(undefined);
    });
    doc.body.appendChild(champ);
    champ.click();
  });
}

export const ACCEPT_VIDEO = 'video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.m4v,.mov,.webm,.mkv';
export const ACCEPT_REUNION = `${ACCEPT_VIDEO},audio/*,.m4a,.mp3,.aac,.wav,.ogg,.opus,.flac`;
/** Ressources : PDF, images, vidéos, archives (jamais de SVG ni de HTML : refusés par le serveur). */
export const ACCEPT_RESSOURCE = `application/pdf,.pdf,image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp,${ACCEPT_VIDEO},.zip,.7z,.rar,application/zip,application/x-7z-compressed,application/vnd.rar`;
