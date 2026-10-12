import type { Lecteur } from '../moteur/resolution';

export interface PropsMedia {
  lecteur: Lecteur;
  titre: string;
  /** Fin de la vidéo (vidéo directe seulement) : enchaîne l'épisode suivant si le réglage le demande. */
  onFin?(): void;
  /** Position de départ en secondes (vidéo directe : reprise après un changement de langue). */
  debut?: number;
  /** Position courante (vidéo directe), pour la reprendre dans l'autre langue. */
  onPosition?(secondes: number): void;
}
