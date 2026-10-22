import type { Lecteur } from '../moteur/resolution';

export interface PropsMedia {
  lecteur: Lecteur;
  titre: string;
  /** Fin de la vidéo (vidéo directe seulement) : enchaîne l'épisode suivant si le réglage le demande. */
  onFin?(): void;
  /** Position de départ en secondes (vidéo directe : reprise après un changement de langue, ou là où on s'était arrêté). */
  debut?: number;
  /** Position courante (vidéo directe) et durée si connue : reprise dans l'autre langue, position enregistrée. */
  onPosition?(secondes: number, duree?: number): void;
  /** Signe de vie : la page de l'hôte est chargée, ou la vidéo a ses métadonnées (lecteur qui marche). */
  onVivant?(): void;
  /** Le lecteur ne marche pas (erreur, adresse invalide, page d'erreur, délai sans signe de vie) : la bascule prend le suivant. */
  onEchec?(raison: string): void;
}
