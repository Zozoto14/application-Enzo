/**
 * Lancement d'une transcription depuis l'interface (chargé par import dynamique : rien de tout cela,
 * ni Whisper, ni l'extraction audio, n'est dans le paquet principal de l'app).
 *
 * Reprise : si une transcription partielle existe (onglet fermé, coupure), on repart du segment entamé
 * et on garde ce qui est fait. La source audio est le fichier encore ouvert sur cet appareil (juste
 * après le dépôt), sinon l'enregistrement sur le serveur (lien signé).
 */

import type { ClientEsport, Depot } from '../client';
import { apiMedias } from '../medias/api';
import { repriseAlignee } from './audio';
import { ouvrirSourceAudio } from './extraction';
import { travaux, type TravailTranscription } from './travail';
import { creerTranscripteur, type ModeleWhisper } from './whisper';

export interface OptionsLancement {
  client: ClientEsport;
  teamId: string;
  depot: Pick<Depot, 'id' | 'titre' | 'enregistrement'>;
  /** Fichier encore ouvert sur l'appareil (évite de retélécharger l'enregistrement). */
  fichier?: Blob;
  langue?: string;
  modele?: ModeleWhisper;
  /** Recommencer de zéro au lieu de reprendre une transcription partielle. */
  recommencer?: boolean;
}

export async function lancerTranscription({ client, teamId, depot, fichier, langue = 'fr', modele = 'base', recommencer = false }: OptionsLancement): Promise<TravailTranscription> {
  const deja = travaux.de(depot.id);
  if (deja?.enCours) return deja;
  const api = apiMedias(client, teamId);
  const actuelle = await api.transcription(depot.id);
  const reprise = !recommencer && actuelle.partielle && actuelle.statut === 'en_cours' && actuelle.segments.length > 0;
  const depuis = reprise ? repriseAlignee(actuelle.progression) : 0;
  return travaux.lancer(
    { reunionId: depot.id, teamId, titre: depot.titre, langue: reprise ? actuelle.langue : langue, existants: reprise ? actuelle.segments : [], depuis },
    {
      creerTranscripteur: onChargement => creerTranscripteur({ modele, langue, onChargement }),
      ouvrirSource: async () => (fichier ? ouvrirSourceAudio({ fichier }) : ouvrirSourceAudio({ url: (await api.lienEnregistrement(depot.id)).url, taille: depot.enregistrement?.taille })),
      sauver: async corps => {
        await api.enregistrerTranscription(depot.id, corps);
      },
    },
  );
}
