/**
 * Extraction de l'audio d'un enregistrement DANS LE NAVIGATEUR (site, app PC), avec la Web Audio API :
 *
 *  - fichier raisonnable (jusqu'à 700 Mo) : décodage complet par un OfflineAudioContext réglé à 16 kHz
 *    (le navigateur décode la piste son, même d'une vidéo, et rééchantillonne), mélange en mono, puis
 *    découpe en segments de 30 s ;
 *  - gros fichier : lecture ACCÉLÉRÉE (×4, son coupé) dans un élément <audio> branché sur un
 *    AudioContext à 64 kHz : chaque échantillon capté correspond à un échantillon à 16 kHz de la
 *    réunion. La mémoire reste constante ; la lecture se met en pause pendant que Whisper travaille.
 *
 * La source est le fichier choisi (rien n'est retéléchargé) ou l'enregistrement sur le serveur (lien
 * signé, pour « Transcrire » plus tard depuis un autre appareil).
 */

import { tr } from '../i18n';
import { Accumulateur, DUREE_SEGMENT, FREQUENCE, decouper, reechantillonner, versMono, type SegmentAudio } from './audio';
import type { SourceAudio } from './travail';

export const SEUIL_DECODAGE = 700 * 1024 * 1024;
const ACCELERATION = 4;

type CtxHorsLigne = { decodeAudioData(b: ArrayBuffer): Promise<{ numberOfChannels: number; sampleRate: number; duration: number; getChannelData(i: number): Float32Array }> };
type G = {
  OfflineAudioContext?: new (canaux: number, longueur: number, frequence: number) => CtxHorsLigne;
  webkitOfflineAudioContext?: new (canaux: number, longueur: number, frequence: number) => CtxHorsLigne;
  AudioContext?: new (o?: { sampleRate?: number }) => AudioContext;
  webkitAudioContext?: new (o?: { sampleRate?: number }) => AudioContext;
  document?: Document;
  fetch: typeof fetch;
};
const g = globalThis as unknown as G;

/** Décode tout le fichier et rend le signal mono 16 kHz. */
export async function decoderEntier(octets: ArrayBuffer): Promise<Float32Array> {
  const Ctx = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
  if (!Ctx) throw new Error(tr('transcription.web_audio'));
  const audio = await new Ctx(1, 1, FREQUENCE).decodeAudioData(octets);
  const canaux = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  const mono = versMono(canaux);
  return audio.sampleRate === FREQUENCE ? mono : reechantillonner(mono, audio.sampleRate);
}

function sourceDecodee(pcm: Float32Array): SourceAudio {
  return {
    duree: pcm.length / FREQUENCE,
    async *segments(depuis: number) {
      for (const s of decouper(pcm, { depuis })) yield s;
    },
    fermer: () => undefined,
  };
}

/** Lecture accélérée d'un média (fichier local ou lien) captée par la Web Audio API. */
function sourceEnFlux(url: string, liberer: () => void): Promise<SourceAudio> {
  const doc = g.document;
  const Ctx = g.AudioContext ?? g.webkitAudioContext;
  if (!doc || !Ctx) return Promise.reject(new Error(tr('transcription.web_audio')));
  const media = doc.createElement('audio') as HTMLAudioElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
  media.crossOrigin = 'anonymous';
  media.preload = 'auto';
  media.src = url;
  let ctx: AudioContext;
  try {
    ctx = new Ctx({ sampleRate: FREQUENCE * ACCELERATION });
  } catch {
    ctx = new Ctx();
  }
  // Fréquence « réelle » des échantillons captés : celle du contexte divisée par l'accélération.
  const effective = ctx.sampleRate / ACCELERATION;
  const noeud = ctx.createMediaElementSource(media);
  const processeur = ctx.createScriptProcessor(4096, 1, 1);
  const muet = ctx.createGain();
  muet.gain.value = 0;
  noeud.connect(processeur);
  processeur.connect(muet);
  muet.connect(ctx.destination);
  let fini = false;
  let actif = false;
  let accumulateur = new Accumulateur(FREQUENCE, DUREE_SEGMENT, 0);
  const file: SegmentAudio[] = [];
  let reveil: (() => void) | undefined;
  const prevenir = () => {
    reveil?.();
    reveil = undefined;
  };
  processeur.onaudioprocess = e => {
    if (!actif || media.paused) return;
    const bloc = new Float32Array(e.inputBuffer.getChannelData(0));
    file.push(...accumulateur.ajouter(effective === FREQUENCE ? bloc : reechantillonner(bloc, effective)));
    if (file.length) {
      media.pause();
      prevenir();
    }
  };
  media.addEventListener('ended', () => {
    fini = true;
    const dernier = accumulateur.vider();
    if (dernier) file.push(dernier);
    prevenir();
  });
  media.addEventListener('error', () => {
    fini = true;
    prevenir();
  });
  const fermer = () => {
    actif = false;
    media.pause();
    media.removeAttribute('src');
    processeur.disconnect();
    void ctx.close().catch(() => undefined);
    liberer();
  };
  return new Promise((ok, ko) => {
    media.addEventListener(
      'loadedmetadata',
      () =>
        ok({
          duree: Number.isFinite(media.duration) ? media.duration : 0,
          suspendre: () => media.pause(),
          fermer,
          async *segments(depuis: number) {
            const debut = Math.floor(Math.max(0, depuis) / DUREE_SEGMENT) * DUREE_SEGMENT;
            accumulateur = new Accumulateur(FREQUENCE, DUREE_SEGMENT, debut);
            media.currentTime = debut;
            media.playbackRate = ACCELERATION;
            media.preservesPitch = false;
            media.webkitPreservesPitch = false;
            media.mozPreservesPitch = false;
            await ctx.resume().catch(() => undefined);
            actif = true;
            for (;;) {
              if (!file.length && !fini) {
                await media.play().catch(() => undefined);
                await new Promise<void>(r => (reveil = r));
              }
              const s = file.shift();
              if (s) {
                yield s;
                continue;
              }
              if (fini) return;
            }
          },
        }),
      { once: true },
    );
    media.addEventListener('error', () => ko(new Error(tr('transcription.lecture_impossible'))), { once: true });
  });
}

/**
 * Ouvre l'audio d'un enregistrement : `fichier` (choisi sur cet appareil) ou `url` (lien signé). La
 * taille décide du décodage complet ou de la lecture accélérée.
 */
export async function ouvrirSourceAudio({ fichier, url, taille }: { fichier?: Blob; url?: string; taille?: number }): Promise<SourceAudio> {
  const octetsTotal = fichier?.size ?? taille ?? 0;
  if (octetsTotal > 0 && octetsTotal <= SEUIL_DECODAGE) {
    try {
      const octets = fichier ? await fichier.arrayBuffer() : await (await g.fetch(String(url))).arrayBuffer();
      return sourceDecodee(await decoderEntier(octets));
    } catch {
      // Décodage complet impossible (format, mémoire) : lecture accélérée.
    }
  }
  if (fichier) {
    const lien = URL.createObjectURL(fichier);
    return sourceEnFlux(lien, () => URL.revokeObjectURL(lien));
  }
  return sourceEnFlux(String(url), () => undefined);
}
