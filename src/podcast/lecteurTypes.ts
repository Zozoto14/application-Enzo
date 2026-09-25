/** Contrat du lecteur vocal, commun au bureau et au téléphone. */

export interface PhraseALire {
  texte: string;
  langue: 'fr' | 'en';
}

export interface VoixDisponible {
  id: string;
  nom: string;
  langue: string;
  /** Voix neuronale, lue en ligne : bien plus naturelle que celles de Windows. */
  naturelle?: boolean;
}

export interface Lecteur {
  disponible: boolean;
  voix(): VoixDisponible[];
  /** Prévient quand la liste des voix change (elle arrive après coup sur le bureau). */
  surChangementVoix(rappel: () => void): () => void;
  /** Lit la file à partir de `depuis`, et appelle `surPhrase` à chaque phrase entamée. */
  lire(
    file: readonly PhraseALire[],
    depuis: number,
    options: { vitesse: number; voixFrancaise?: string },
    rappels: {
      surPhrase(index: number): void;
      surFin(): void;
      /** La voix choisie a échoué : la lecture continue avec une voix de Windows. */
      surErreur?(message: string): void;
    },
  ): void;
  pause(): void;
  reprendre(): void;
  arreter(): void;
}
