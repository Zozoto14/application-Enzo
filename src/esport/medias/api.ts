/**
 * Client des médias de l'Esport (vidéos et enregistrements déposés, transcription, espace utilisé), par
 * l'appel générique du client (`client.requete`). Types miroirs de esport/noyau/medias/ et resumes.mjs.
 */

import type { ClientEsport, FichierMedia, Personne, StatutTranscription } from '../client';
import type { EtatEnvoi } from './envoi';

export interface SegmentTranscription {
  debut: number;
  fin: number;
  texte: string;
}

export interface Transcription {
  statut: StatutTranscription;
  langue: string;
  moteur: string;
  segments: SegmentTranscription[];
  duree: number | null;
  progression: number;
  partielle: boolean;
  preResume: Array<{ debut: number; texte: string }>;
  erreur: string | null;
  pdf: FichierMedia | null;
  auteur: Personne | null;
  modifiePar: Personne | null;
  majLe: string | null;
  enregistrement: FichierMedia | null;
  peutModifier: boolean;
  /** Transcription par une API externe activée sur le serveur (facultatif). */
  externe: boolean;
}

export type NatureFichier = 'video' | 'enregistrement' | 'transcription' | 'resume' | 'miniature' | 'autre';

export interface FichierEspace extends FichierMedia {
  nature: NatureFichier;
  ancienneVersion: boolean;
  cible: { type: string; id: string; titre: string | null };
  deposePar: Personne;
  peutSupprimer: boolean;
}

export interface EspaceUtilise {
  total: number;
  parNature: Partial<Record<NatureFichier | 'envois', number>>;
  fichiers: FichierEspace[];
  envois: Array<EtatEnvoi & { compte: Personne; majLe: string }>;
  plafond: number;
  tailleMorceau: number;
  delaiAbandonHeures: number;
}

const e = encodeURIComponent;

export function apiMedias(client: ClientEsport, teamId: string) {
  const t = `/teams/${e(teamId)}`;
  const r = (depotId: string) => `${t}/resumes/${e(depotId)}`;
  return {
    transcription: (depotId: string) => client.requete<Transcription>(`${r(depotId)}/transcription`),
    enregistrerTranscription: (depotId: string, corps: { segments: SegmentTranscription[]; langue: string; moteur: string; duree?: number; partielle?: boolean; progression?: number }) =>
      client.requete<Transcription>(`${r(depotId)}/transcription`, 'PUT', corps),
    lienTranscription: (depotId: string, telecharger = false) => client.requete<{ url: string; expire: string }>(`${r(depotId)}/transcription/lien`, 'POST', { telecharger }),
    lienEnregistrement: (depotId: string) => client.requete<{ url: string; expire: string }>(`${r(depotId)}/enregistrement/lien`, 'POST', {}),
    demanderTranscriptionExterne: (depotId: string, langue: string) => client.requete<Transcription>(`${r(depotId)}/transcription/externe`, 'POST', { langue }),
    espace: () => client.requete<EspaceUtilise>(`${t}/espace`),
    supprimerFichier: (fichierId: string) => client.requete<EspaceUtilise>(`${t}/espace/${e(fichierId)}`, 'DELETE'),
  };
}
export type ApiMedias = ReturnType<typeof apiMedias>;
