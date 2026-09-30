import type { Lecteur } from '../moteur/resolution';

export interface PropsMedia {
  lecteur: Lecteur;
  titre: string;
  /** Fin de la vidéo (vidéo directe seulement) : enchaîne l'épisode suivant si le réglage le demande. */
  onFin?(): void;
}
