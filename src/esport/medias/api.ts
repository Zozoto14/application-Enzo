/**
 * Client des médias de l'Esport (vidéos et enregistrements déposés, transcription, espace utilisé), par
 * l'appel générique du client (`client.requete`). Types miroirs de esport/noyau/medias/ et resumes.mjs.
 */

import type { ClientEsport, FichierMedia, ModeTranscription, Personne, StatutTranscription, TravailServeur } from '../client';
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
  /** Transcription sur le serveur installée (migration 0016). */
  serveur?: boolean;
  /** Travail de la file du serveur (progression, temps restant), s'il y en a un. */
  travail?: TravailServeur | null;
}

/** Mode de transcription de la team (Paramètres) et modes disponibles sur ce serveur. */
export interface ReglagesTranscription {
  /** Mode effectif (celui choisi s'il marche, sinon le serveur, sinon le navigateur). */
  mode: ModeTranscription;
  /** Mode choisi par la team (null : celui du serveur). */
  choisi: ModeTranscription | null;
  defautServeur: ModeTranscription;
  disponibles: Record<ModeTranscription, boolean>;
  modele: string;
  modifiable: boolean;
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
    demanderTranscriptionServeur: (depotId: string, langue: string) => client.requete<Transcription>(`${r(depotId)}/transcription/serveur`, 'POST', { langue }),
    annulerTranscriptionServeur: (depotId: string) => client.requete<Transcription>(`${r(depotId)}/transcription/serveur`, 'DELETE'),
    reglagesTranscription: () => client.requete<ReglagesTranscription>(`${t}/resumes/reglages-transcription`),
    changerModeTranscription: (mode: ModeTranscription | null) => client.requete<ReglagesTranscription>(`${t}/resumes/reglages-transcription`, 'PATCH', { mode }),
    espace: () => client.requete<EspaceUtilise>(`${t}/espace`),
    supprimerFichier: (fichierId: string) => client.requete<EspaceUtilise>(`${t}/espace/${e(fichierId)}`, 'DELETE'),
  };
}
export type ApiMedias = ReturnType<typeof apiMedias>;
