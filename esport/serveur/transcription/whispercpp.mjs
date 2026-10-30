/**
 * Moteur en OPTION de la transcription sur le serveur (le défaut est ONNX dans le processus Node, whisper.mjs :
 * l'hébergeur o2switch arrête de force — SIGKILL — les binaires de calcul externes) : whisper.cpp (ggml-org/whisper.cpp), compilé SANS root
 * sur le serveur par installer-transcription.sh (même compilateur figé que l'IA locale), version figée et
 * commit vérifié, avec les modèles GGML d'OpenAI Whisper (large-v3-turbo quantifié par défaut).
 *
 * Pourquoi whisper.cpp plutôt que l'ancien moteur ONNX (gardé en repli, whisper.mjs) :
 *  - modèles bien plus grands utilisables sur processeur : large-v3-turbo q5_0 (≈ 550 Mo, ≈ 1 Go de mémoire) ;
 *  - décodage complet : beam search, températures de repli, seuils anti-hallucination (entropie, log-prob,
 *    « pas de parole »), horodatage par segment, prompt initial (vocabulaire de la team) répété à chaque fenêtre ;
 *  - détection de la parole intégrée (Silero VAD) : silences et bruits ne passent pas au modèle ;
 *  - un seul binaire autonome (glibc 2.27 suffit), lancé à la demande en priorité basse, rien dans Node.
 *
 * Ce fichier : versions et empreintes figées, arguments de `whisper-cli`, lecture de sa sortie JSON, et le
 * transcripteur `transcrireBloc(pcm, { langue, prompt, decalage })` utilisé par le processus de fond.
 */

import { spawn as spawnNode } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ecrireWav } from './audio.mjs';
import { memoireProcessus } from '../ia-locale/processus.mjs';

/** whisper.cpp : version figée (tag v1.9.5 du 6 octobre 2026), commit vérifié après le clonage. */
export const WHISPER_CPP = {
  version: 'v1.9.5',
  commit: 'd1be6fde11ac6e0407606b4e42fe72d34add8037',
  depotGit: 'https://github.com/ggml-org/whisper.cpp.git',
  // Ce que `whisper-cli --version` affiche pour cette version.
  versionAffichee: '1.9.5',
};

/**
 * Modèles GGML proposés (dépôt Hugging Face ggerganov/whisper.cpp). `sha1` : empreinte publiée dans
 * models/README.md de whisper.cpp v1.9.5 (vérifiée APRÈS le téléchargement, en plus du SHA-256 publié par
 * Hugging Face pour la révision téléchargée). `memoireMo` : mémoire de calcul approximative (beam 5).
 */
export const MODELES_GGML = {
  small: { fichier: 'ggml-small.bin', sha1: '55356645c2b361a969dfd0ef2c5a50d530afd8d5', tailleApprox: 488e6, memoireMo: 900, nom: 'Whisper small' },
  medium: { fichier: 'ggml-medium.bin', sha1: 'fd9727b6e1217c2f614f9b698455c4ffd82463b4', tailleApprox: 1533e6, memoireMo: 2100, nom: 'Whisper medium' },
  'large-v3-turbo-q5_0': { fichier: 'ggml-large-v3-turbo-q5_0.bin', sha1: 'e050f7970618a659205450ad97eb95a18d69c9ee', tailleApprox: 574e6, memoireMo: 1200, nom: 'Whisper large-v3-turbo (q5_0)' },
  'large-v3-turbo': { fichier: 'ggml-large-v3-turbo.bin', sha1: '4af2b29d7ec73d781377bfd1758ca957a807e941', tailleApprox: 1624e6, memoireMo: 2300, nom: 'Whisper large-v3-turbo' },
  'large-v3-q5_0': { fichier: 'ggml-large-v3-q5_0.bin', sha1: 'e6e2ed78495d403bef4b7cff42ef4aaadcfea8de', tailleApprox: 1081e6, memoireMo: 2000, nom: 'Whisper large-v3 (q5_0)' },
};
export const DEPOT_MODELES_GGML = 'ggerganov/whisper.cpp';

/**
 * Détection de la parole : Silero VAD v6.2.0 au format GGML. Le fichier est pris DANS les sources de whisper.cpp
 * au commit vérifié (models/for-tests-silero-v6.2.0-ggml.bin, le vrai modèle, utilisé par les tests du projet),
 * puis son SHA-256 est comparé à celui-ci : aucun téléchargement de plus.
 */
export const VAD_SILERO = {
  nom: 'Silero VAD v6.2.0',
  source: 'models/for-tests-silero-v6.2.0-ggml.bin',
  fichier: 'ggml-silero-v6.2.0.bin',
  sha256: '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987',
  taille: 885_098,
};

/** Codes de langue acceptés par Whisper parmi ceux de l'app (« auto » : détection). */
const LANGUES = new Set(['fr', 'en', 'es', 'de', 'it', 'pt', 'nl', 'auto']);

/**
 * Arguments de `whisper-cli` (v1.9.5) pour un bloc d'audio. Réglages :
 *  - beam search (`beam`) et `bestOf` candidats aux températures de repli (0 → 0,2 → … : relance d'une
 *    fenêtre ratée) ; seuils d'OpenAI : entropie 2,4 (équivalent du « compression ratio » : texte en boucle),
 *    log-prob moyenne -1, « pas de parole » 0,6 ;
 *  - `prompt` : vocabulaire de la team, gardé pour TOUTES les fenêtres (`--carry-initial-prompt`) ;
 *  - jetons « non parlés » supprimés (`-sns` : pas de [Musique], ♪…) ;
 *  - VAD Silero : parole ≥ 250 ms, silence ≥ 500 ms pour couper, 200 ms de marge, fenêtres de parole ≤ 30 s ;
 *  - sortie JSON complète dans `<sortie>.json`, rien à l'écran.
 */
export function argumentsWhisperCli({ fichierModele, wav, sortie, langue = 'fr', prompt = '', threads = 8, beam = 5, bestOf = 5, vad = null }) {
  const l = LANGUES.has(langue) ? langue : 'fr';
  const a = [
    '-m', fichierModele,
    '-f', wav,
    '-l', l,
    '-t', String(Math.max(1, Math.min(64, Math.floor(threads) || 1))),
    '-bs', String(Math.max(1, beam)),
    '-bo', String(Math.max(1, bestOf)),
    '-tp', '0',
    '-tpi', '0.2',
    '-et', '2.4',
    '-lpt', '-1.0',
    '-nth', '0.6',
    '-sns',
    '-ojf',
    '-of', sortie,
    '-np',
  ];
  if (prompt) a.push('--prompt', prompt, '--carry-initial-prompt');
  if (vad) a.push('--vad', '-vm', vad, '-vt', '0.5', '-vspd', '250', '-vsd', '500', '-vp', '200', '-vmsd', '30');
  return a;
}

const enSecondes = ms => Math.round((Number(ms) / 1000) * 100) / 100;

/**
 * Lit la sortie JSON de whisper-cli (`-ojf`) : segments `[[début, fin, texte]]` en secondes ABSOLUES
 * (`decalage` = début du bloc dans l'enregistrement) et langue détectée. Texte illisible : erreur claire.
 */
export function lireSortieWhisperCli(texte, { decalage = 0 } = {}) {
  let j;
  try {
    j = typeof texte === 'string' ? JSON.parse(texte) : texte;
  } catch {
    throw new Error('Sortie de whisper.cpp illisible.');
  }
  const segments = [];
  for (const s of Array.isArray(j?.transcription) ? j.transcription : []) {
    const t = String(s?.text ?? '')
      .replace(/\[_[A-Z]+_?\d*\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) continue;
    const d = Number(s?.offsets?.from);
    const f = Number(s?.offsets?.to);
    if (!Number.isFinite(d)) continue;
    segments.push([enSecondes(d) + decalage, enSecondes(Number.isFinite(f) && f >= d ? f : d) + decalage, t]);
  }
  return { segments, langue: typeof j?.result?.language === 'string' ? j.result.language : null };
}

/** Environnement minimal du moteur : aucun secret de esport.env ne lui est transmis. */
export const environnementWhisper = (env = process.env) => ({ PATH: '/usr/local/bin:/usr/bin:/bin', HOME: env.HOME ?? '/tmp', LANG: 'C.UTF-8' });

function trouverNice() {
  for (const c of ['/usr/bin/nice', '/bin/nice']) if (existsSync(c)) return c;
  return null;
}

/**
 * Transcripteur whisper.cpp : `{ moteur, transcrireBloc(pcm, { langue, prompt, decalage }), arreter(), liberer(),
 * memoireMaxMo }`. Chaque bloc est écrit en WAV 16 kHz dans `dossierTravail`, passé à `whisper-cli` (processus
 * enfant, priorité basse `nice`), puis la sortie JSON est lue et les fichiers temporaires effacés. `spawn`
 * injectable (tests : faux binaire).
 */
export function creerTranscripteurWhisperCpp({ binaire, fichierModele, nomModele, vad = null, threads = 8, decodage = { beam: 5, bestOf: 5 }, dossierTravail, nice = 19, spawn = spawnNode, lireMemoire = memoireProcessus, surProcessus = () => undefined }) {
  let enfant = null;
  let memoireMaxMo = 0;
  // Arrêt demandé par NOUS (signal reçu par le processus de fond) : un SIGKILL sans cela vient de l'extérieur.
  let arretDemande = false;
  async function transcrireBloc(pcm, { langue = 'fr', prompt = '', decalage = 0, surProcessus: surBloc = null } = {}) {
    const base = join(dossierTravail, `bloc-${process.pid}-${randomBytes(4).toString('hex')}`);
    const wav = `${base}.wav`;
    const json = `${base}.json`;
    ecrireWav(wav, pcm);
    try {
      const args = argumentsWhisperCli({ fichierModele, wav, sortie: base, langue, prompt, threads, beam: decodage.beam, bestOf: decodage.bestOf, vad });
      const niceBin = nice > 0 ? trouverNice() : null;
      const { code, signal, erreurs } = await new Promise((ok, ko) => {
        let tampon = '';
        const p = spawn(niceBin ?? binaire, niceBin ? ['-n', String(Math.min(19, nice)), binaire, ...args] : args, { stdio: ['ignore', 'ignore', 'pipe'], env: environnementWhisper(), cwd: dossierTravail });
        enfant = p;
        surProcessus(p.pid ?? null);
        surBloc?.(p.pid ?? null);
        const releve = setInterval(() => {
          const m = p.pid ? lireMemoire(p.pid) : null;
          if (m) memoireMaxMo = Math.max(memoireMaxMo, m.picMo ?? m.rssMo ?? 0);
        }, 1000);
        releve.unref?.();
        p.stderr?.on('data', d => {
          tampon = `${tampon}${d}`.slice(-4000);
        });
        p.on('error', e => {
          clearInterval(releve);
          ko(e);
        });
        p.on('close', (c, s) => {
          clearInterval(releve);
          ok({ code: c, signal: s, erreurs: tampon });
        });
      });
      enfant = null;
      surProcessus(null);
      if (code !== 0 || !existsSync(json)) {
        const derniere = erreurs.trim().split('\n').filter(l => !/^whisper_|^ggml_|^system_info|^main:|^read_audio/.test(l)).pop() ?? erreurs.trim().split('\n').pop() ?? '';
        throw Object.assign(new Error(`whisper.cpp s’est arrêté (${signal ? `signal ${signal}` : `code ${code}`})${derniere ? ` : ${derniere.replace(/\/home\/[^\s)]+/g, '…').slice(0, 200)}` : ''}.`), {
          signal: signal ?? null,
          // Arrêté de force par l'hébergeur (ou un autre programme) : le processus de fond bascule sur ONNX.
          tueExterne: signal === 'SIGKILL' && !arretDemande,
        });
      }
      return lireSortieWhisperCli(readFileSync(json, 'utf8'), { decalage });
    } finally {
      rmSync(wav, { force: true });
      rmSync(json, { force: true });
    }
  }
  return {
    moteur: `whisper.cpp ${MODELES_GGML[nomModele]?.nom?.replace(/^Whisper /, '') ?? nomModele} (serveur)`,
    nomModele,
    transcrireBloc,
    /** Arrêt du bloc en cours (signal reçu par le processus de fond). */
    arreter() {
      arretDemande = true;
      try {
        enfant?.kill('SIGTERM');
      } catch {
        // Déjà fini.
      }
    },
    liberer: async () => undefined,
    get memoireMaxMo() {
      return memoireMaxMo;
    },
  };
}
