/**
 * Whisper DANS LE NAVIGATEUR (site, app PC) avec transformers.js (@huggingface/transformers), chargé À
 * LA DEMANDE (import dynamique, seulement quand une transcription démarre) : rien dans le paquet
 * principal de l'app.
 *
 *  - Bibliothèque : version FIGÉE, téléchargée une fois depuis jsDelivr, VÉRIFIÉE par son empreinte
 *    SHA-256 (un fichier modifié est refusé), gardée dans le cache du navigateur (Cache API), puis
 *    importée. Pourquoi pas une dépendance npm : le paquet entraîne ~450 Mo de binaires (ONNX Runtime
 *    pour Node, sharp) inutiles au navigateur, dans chaque installation et chaque CI.
 *  - Modèle : Whisper multilingue (« base » par défaut ; « small », plus précis et plus lent),
 *    téléchargé une fois depuis Hugging Face et mis en cache par transformers.js (Cache API).
 *  - Calcul : WebGPU si le navigateur l'a (bien plus rapide), sinon WebAssembly (processeur).
 *
 * Tests de bout en bout : un faux transcripteur se branche par `globalThis.__esportTranscripteurFactice`
 * (aucun téléchargement, aucun modèle).
 */

import { tr } from '../i18n';
import type { MorceauWhisper } from './audio';
import type { Transcripteur } from './travail';

export const transcriptionDisponible = true;
export type ModeleWhisper = 'base' | 'small';

export const VERSION_TRANSFORMERS = '4.2.0';
export const URL_TRANSFORMERS = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${VERSION_TRANSFORMERS}/dist/transformers.min.js`;
/** SHA-256 de dist/transformers.min.js du paquet npm 4.2.0 (jsDelivr sert le fichier tel quel). */
export const SHA256_TRANSFORMERS = 'e74bd32ed4453369ebb0edcaa27f6bc6204004a949a0233cdb87b62dda8d6978';
export const MODELES: Record<ModeleWhisper, string> = { base: 'onnx-community/whisper-base', small: 'onnx-community/whisper-small' };
const CACHE = 'esport-transcription-v1';
const LANGUES: Record<string, string> = { fr: 'french', en: 'english', es: 'spanish', de: 'german', it: 'italian', pt: 'portuguese', nl: 'dutch' };

type FabriqueFactice = (o: { modele: ModeleWhisper; langue: string }) => Transcripteur | Promise<Transcripteur>;
type G = { __esportTranscripteurFactice?: FabriqueFactice; caches?: CacheStorage; navigator?: { gpu?: { requestAdapter(): Promise<unknown> } }; crypto: Crypto; fetch: typeof fetch };
const g = globalThis as unknown as G;

interface BibliothequeTransformers {
  env: { allowLocalModels: boolean; useBrowserCache: boolean };
  pipeline(tache: string, modele: string, options: Record<string, unknown>): Promise<(audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string; chunks?: MorceauWhisper[] }> & { dispose?(): Promise<void> }>;
}

let bibliotheque: Promise<BibliothequeTransformers> | undefined;

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');

/** Télécharge (ou relit dans le cache) transformers.js, vérifie son empreinte, l'importe. */
export function chargerTransformers(): Promise<BibliothequeTransformers> {
  bibliotheque ??= (async () => {
    let cache: Cache | undefined;
    try {
      cache = await g.caches?.open(CACHE);
    } catch {
      cache = undefined;
    }
    let reponse = await cache?.match(URL_TRANSFORMERS);
    if (!reponse) {
      reponse = await g.fetch(URL_TRANSFORMERS, { mode: 'cors', credentials: 'omit' });
      if (!reponse.ok) throw new Error(tr('transcription.telechargement_impossible', { v: reponse.status }));
      await cache?.put(URL_TRANSFORMERS, reponse.clone()).catch(() => undefined);
    }
    const octets = await reponse.arrayBuffer();
    if (hex(await g.crypto.subtle.digest('SHA-256', octets)) !== SHA256_TRANSFORMERS) {
      await cache?.delete(URL_TRANSFORMERS).catch(() => undefined);
      throw new Error(tr('transcription.bibliotheque_refusee'));
    }
    const lien = URL.createObjectURL(new Blob([octets], { type: 'text/javascript' }));
    try {
      const module = (await import(/* @vite-ignore */ lien)) as BibliothequeTransformers;
      module.env.allowLocalModels = false;
      module.env.useBrowserCache = true;
      return module;
    } finally {
      URL.revokeObjectURL(lien);
    }
  })().catch(e => {
    bibliotheque = undefined;
    throw e;
  });
  return bibliotheque;
}

export async function webgpuDisponible(): Promise<boolean> {
  try {
    return Boolean(await g.navigator?.gpu?.requestAdapter());
  } catch {
    return false;
  }
}

/**
 * Crée le transcripteur (modèle téléchargé une seule fois, puis en cache). `onChargement` : fraction du
 * téléchargement du modèle (0 à 1).
 */
export async function creerTranscripteur({ modele = 'base', langue, onChargement }: { modele?: ModeleWhisper; langue: string; onChargement?(f: number): void }): Promise<Transcripteur> {
  if (g.__esportTranscripteurFactice) return g.__esportTranscripteurFactice({ modele, langue });
  const { pipeline } = await chargerTransformers();
  const gpu = await webgpuDisponible();
  const recus = new Map<string, { charge: number; total: number }>();
  const asr = await pipeline('automatic-speech-recognition', MODELES[modele], {
    device: gpu ? 'webgpu' : 'wasm',
    dtype: gpu ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file || !p.total) return;
      recus.set(p.file, { charge: p.loaded ?? 0, total: p.total });
      const t = [...recus.values()].reduce((a, x) => ({ charge: a.charge + x.charge, total: a.total + x.total }), { charge: 0, total: 0 });
      onChargement?.(t.total ? t.charge / t.total : 0);
    },
  });
  return {
    nom: `Whisper ${modele} (${gpu ? 'navigateur, WebGPU' : 'navigateur, WASM'})`,
    async transcrire(pcm) {
      const r = await asr(pcm, { task: 'transcribe', return_timestamps: true, chunk_length_s: 30, ...(LANGUES[langue] ? { language: LANGUES[langue] } : {}) });
      return r.chunks?.length ? r.chunks : r.text ? [{ timestamp: [0, null], text: r.text }] : [];
    },
    liberer: () => void (asr as { dispose?(): Promise<void> }).dispose?.().catch(() => undefined),
  };
}
