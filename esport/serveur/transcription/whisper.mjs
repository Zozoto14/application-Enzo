/**
 * Whisper SUR LE SERVEUR, DANS LE PROCESSUS NODE (Node 22, processeur seulement), avec ONNX Runtime pour Node
 * (`onnxruntime-node`, binaires précompilés pour Linux x64 : rien à compiler, pas de root). C'est le moteur PAR
 * DÉFAUT depuis que l'hébergeur (o2switch) arrête de force les binaires de calcul lancés depuis le dossier personnel
 * (whisper.cpp, llama-server : SIGKILL) alors qu'il laisse calculer le processus `node` (journaux du 29/10 :
 * 28 min d'audio transcrites ici sans incident).
 *
 * Modèles : exports ONNX de Whisper faits par le projet sherpa-onnx (k2-fsa), quantifiés en int8
 * (`<nom>-encoder.int8.onnx`, `<nom>-decoder.int8.onnx`, `<nom>-tokens.txt`), poids d'origine d'OpenAI :
 * « small » (Rapide), « turbo » = large-v3-turbo (Équilibrée), « large-v3 » (Maximale) ; tiny / base / medium
 * aussi lisibles. Téléchargés une fois par esport/serveur/installer-transcription.sh (SHA-256 vérifiés).
 *
 * Ce fichier fait, sans autre dépendance :
 *  - le log-mel spectrogramme de Whisper (80 bandes, ou 128 pour large-v3 et turbo ; 25 ms tous les 10 ms, 30 s) ;
 *  - le découpage en jetons (BPE byte-level de Whisper, rangs = identifiants du fichier tokens.txt) pour le
 *    PROMPT : vocabulaire de la team + texte du morceau précédent (`<|startofprev|>`), comme whisper.cpp
 *    `--carry-initial-prompt` ;
 *  - le décodage par RECHERCHE EN FAISCEAU (beam search, cache clés/valeurs par hypothèse), langue imposée ou
 *    détectée, jetons « non parlés » supprimés (♪, [Musique]…) ;
 *  - les températures de REPLI d'OpenAI : texte en boucle (taux de compression > 2,4) ou peu sûr (log-prob
 *    moyenne < -1) → nouvel essai à 0,2, 0,4… par échantillonnage (`bestOf` candidats) ;
 *  - des garde-fous : morceau silencieux ignoré, « pas de parole » (> 0,6 et décodage peu sûr) → rien, boucles
 *    de répétition coupées.
 *
 * `ort` (le module onnxruntime-node) est fourni par l'appelant (chargé depuis le dossier des modèles, hors du
 * dépôt : voir moteur.mjs) ; un faux `ort` sert aux tests.
 */

import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

export const FREQUENCE = 16000;
export const ECHANTILLONS_30S = 30 * FREQUENCE;
const N_FFT = 400;
const PAS = 160;
const TRAMES = 3000;
const N_MELS = 80;
const BINS = N_FFT / 2 + 1;

// ------------------------------------------------------------------ Métadonnées ONNX

/**
 * Lit les métadonnées (`metadata_props`) d'un fichier ONNX sans le charger : on parcourt seulement les
 * champs de premier niveau du message protobuf `ModelProto` (le graphe, gros, est sauté).
 */
export function metadonneesOnnx(chemin) {
  const fd = openSync(chemin, 'r');
  const taille = statSync(chemin).size;
  const sortie = {};
  const tampon = Buffer.alloc(10);
  let pos = 0;
  const varint = () => {
    readSync(fd, tampon, 0, 10, pos);
    let v = 0;
    let mult = 1;
    for (let i = 0; i < 10; i++) {
      const b = tampon[i];
      v += (b & 0x7f) * mult;
      mult *= 128;
      if (b < 0x80) {
        pos += i + 1;
        return v;
      }
    }
    throw new Error('ONNX illisible.');
  };
  try {
    while (pos < taille) {
      const tag = varint();
      const champ = Math.floor(tag / 8);
      const type = tag % 8;
      if (type === 0) varint();
      else if (type === 1) pos += 8;
      else if (type === 5) pos += 4;
      else if (type === 2) {
        const n = varint();
        if (champ === 14 && n < 1_000_000) {
          const b = Buffer.alloc(n);
          readSync(fd, b, 0, n, pos);
          const [cle, valeur] = lireEntree(b);
          if (cle) sortie[cle] = valeur;
        }
        pos += n;
      } else throw new Error('ONNX illisible.');
    }
  } finally {
    closeSync(fd);
  }
  return sortie;
}

function lireEntree(b) {
  let pos = 0;
  let cle = '';
  let valeur = '';
  const varint = () => {
    let v = 0;
    let mult = 1;
    for (;;) {
      const x = b[pos++];
      v += (x & 0x7f) * mult;
      mult *= 128;
      if (x < 0x80) return v;
    }
  };
  while (pos < b.length) {
    const tag = varint();
    const n = tag % 8 === 2 ? varint() : 0;
    const texte = b.subarray(pos, pos + n).toString('utf8');
    if (tag >> 3 === 1) cle = texte;
    else if (tag >> 3 === 2) valeur = texte;
    pos += n;
  }
  return [cle, valeur];
}

const nombres = v =>
  String(v ?? '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .map(Number);

// ------------------------------------------------------------------ Log-mel spectrogramme

const filtresMel = new Map();
let tablesDft;

/** Filtres mel « Slaney » de librosa (ceux de Whisper) : `n` × 201 (n = 80, ou 128 pour large-v3 et turbo). */
export function filtres(n = N_MELS) {
  if (filtresMel.has(n)) return filtresMel.get(n);
  const versMel = hz => (hz < 1000 ? (3 * hz) / 200 : 15 + Math.log(hz / 1000) / (Math.log(6.4) / 27));
  const versHz = mel => (mel < 15 ? (200 * mel) / 3 : 1000 * Math.exp((Math.log(6.4) / 27) * (mel - 15)));
  const melMax = versMel(FREQUENCE / 2);
  const points = Array.from({ length: n + 2 }, (_, i) => versHz((melMax * i) / (n + 1)));
  const f = new Float32Array(n * BINS);
  for (let m = 0; m < n; m++) {
    const [g, c, d] = [points[m], points[m + 1], points[m + 2]];
    const norme = 2 / (d - g);
    for (let k = 0; k < BINS; k++) {
      const hz = (k * FREQUENCE) / N_FFT;
      const v = Math.max(0, Math.min((hz - g) / (c - g), (d - hz) / (d - c)));
      f[m * BINS + k] = v * norme;
    }
  }
  filtresMel.set(n, f);
  return f;
}

function tables() {
  if (tablesDft) return tablesDft;
  const cos = new Float64Array(N_FFT);
  const sin = new Float64Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / N_FFT);
    sin[i] = Math.sin((2 * Math.PI * i) / N_FFT);
  }
  const fenetre = new Float64Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) fenetre[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT);
  tablesDft = { cos, sin, fenetre };
  return tablesDft;
}

/**
 * FFT réelle de 400 points (400 = 16 × 25) par Cooley-Tukey à facteurs mixtes (2 et 5), récursive sur
 * des tableaux préalloués. Rend la puissance |X(k)|² pour k = 0…200.
 */
function creerFft() {
  const { cos, sin } = tables();
  // Plan : facteurs successifs (le plus petit d'abord).
  const facteurs = [];
  let n = N_FFT;
  for (const p of [2, 5]) while (n % p === 0) (facteurs.push(p), (n /= p));
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  const tmpRe = new Float64Array(N_FFT);
  const tmpIm = new Float64Array(N_FFT);
  // Transformée de x[debut + pas*i], i < n, écrite dans re/im[sortie … sortie+n-1].
  function rec(x, debut, pas, n, sortie, niveau) {
    if (n === 1) {
      re[sortie] = x[debut];
      im[sortie] = 0;
      return;
    }
    const p = facteurs[niveau];
    const m = n / p;
    for (let r = 0; r < p; r++) rec(x, debut + r * pas, pas * p, m, sortie + r * m, niveau + 1);
    // Combinaison : X[k + q·m] = Σ_r W_n^{r(k + q·m)} · Y_r[k]
    const pasTable = N_FFT / n;
    for (let k = 0; k < m; k++) {
      for (let q = 0; q < p; q++) {
        let sr = 0;
        let si = 0;
        const kk = k + q * m;
        for (let r = 0; r < p; r++) {
          const idx = ((r * kk) % n) * pasTable;
          const c = cos[idx];
          const s = -sin[idx];
          const yr = re[sortie + r * m + k];
          const yi = im[sortie + r * m + k];
          sr += yr * c - yi * s;
          si += yr * s + yi * c;
        }
        tmpRe[sortie + kk] = sr;
        tmpIm[sortie + kk] = si;
      }
    }
    for (let i = 0; i < n; i++) {
      re[sortie + i] = tmpRe[sortie + i];
      im[sortie + i] = tmpIm[sortie + i];
    }
  }
  return (trame, puissance) => {
    rec(trame, 0, 1, N_FFT, 0, 0);
    for (let k = 0; k < BINS; k++) puissance[k] = re[k] * re[k] + im[k] * im[k];
  };
}

/**
 * Log-mel spectrogramme de Whisper pour un morceau d'au plus 30 s (mono 16 kHz, valeurs -1…1) :
 * complété par du silence jusqu'à 30 s, rend un Float32Array de `nMels` × 3000 (forme [1, nMels, 3000]).
 */
export function logMel(pcm, nMels = N_MELS) {
  const N_MELS = nMels;
  const { fenetre } = tables();
  const f = filtres(nMels);
  const fft = creerFft();
  const longueur = ECHANTILLONS_30S;
  // Remplissage « reflect » de 200 échantillons de chaque côté (center=True de torch.stft).
  const moitie = N_FFT / 2;
  const x = new Float64Array(longueur + N_FFT);
  for (let i = 0; i < longueur; i++) x[i + moitie] = i < pcm.length ? pcm[i] : 0;
  for (let i = 1; i <= moitie; i++) {
    x[moitie - i] = x[moitie + i];
    x[moitie + longueur - 1 + i] = x[moitie + longueur - 1 - i];
  }
  const mel = new Float32Array(N_MELS * TRAMES);
  const trame = new Float64Array(N_FFT);
  const puissance = new Float64Array(BINS);
  // Trames entièrement dans le silence ajouté : puissance nulle, inutile de calculer.
  const derniereUtile = Math.min(TRAMES - 1, Math.ceil((pcm.length + moitie) / PAS));
  let max = -Infinity;
  for (let t = 0; t < TRAMES; t++) {
    if (t <= derniereUtile) {
      const debut = t * PAS;
      for (let i = 0; i < N_FFT; i++) trame[i] = x[debut + i] * fenetre[i];
      fft(trame, puissance);
    } else puissance.fill(0);
    for (let m = 0; m < N_MELS; m++) {
      let s = 0;
      const base = m * BINS;
      for (let k = 0; k < BINS; k++) s += f[base + k] * puissance[k];
      const v = Math.log10(Math.max(s, 1e-10));
      mel[m * TRAMES + t] = v;
      if (v > max) max = v;
    }
  }
  const plancher = max - 8;
  for (let i = 0; i < mel.length; i++) mel[i] = (Math.max(mel[i], plancher) + 4) / 4;
  return mel;
}


// ------------------------------------------------------------------ Jetons

function lireJetons(chemin) {
  const jetons = [];
  for (const ligne of readFileSync(chemin, 'utf8').split('\n')) {
    const [b64, id] = ligne.trim().split(/\s+/);
    if (b64 === undefined || id === undefined) continue;
    jetons[Number(id)] = Buffer.from(b64, 'base64');
  }
  return jetons;
}

/** Découpe du texte de GPT-2 / Whisper avant le BPE (contractions anglaises, lettres, chiffres, ponctuation, blancs). */
const MOTIF_BPE = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

/**
 * Encodeur texte → jetons de Whisper (BPE « byte-level » de tiktoken) : dans le vocabulaire de Whisper, le RANG
 * d'une fusion est l'identifiant du jeton (fichier tokens.txt de sherpa-onnx : octets en base64 + identifiant), donc
 * le découpage exact se refait sans la table des fusions. Seuls les jetons de texte (< `limite`, l'identifiant de
 * <|endoftext|>) servent. Rend `texte => number[]`.
 */
export function creerEncodeur(jetons, limite = jetons.length) {
  const rangs = new Map();
  for (let id = 0; id < Math.min(limite, jetons.length); id++) if (jetons[id]?.length) rangs.set(jetons[id].toString('latin1'), id);
  const cache = new Map();
  function bpe(morceau) {
    const entier = rangs.get(morceau);
    if (entier !== undefined) return [entier];
    const parts = [...morceau];
    for (;;) {
      let meilleur = -1;
      let rang = Infinity;
      for (let i = 0; i < parts.length - 1; i++) {
        const r = rangs.get(parts[i] + parts[i + 1]);
        if (r !== undefined && r < rang) {
          rang = r;
          meilleur = i;
        }
      }
      if (meilleur < 0) break;
      parts.splice(meilleur, 2, parts[meilleur] + parts[meilleur + 1]);
    }
    return parts.map(p => rangs.get(p)).filter(x => x !== undefined);
  }
  return texte => {
    const ids = [];
    for (const m of String(texte ?? '').matchAll(MOTIF_BPE)) {
      const octets = Buffer.from(m[0], 'utf8').toString('latin1');
      let r = cache.get(octets);
      if (!r) {
        r = bpe(octets);
        if (cache.size < 20_000) cache.set(octets, r);
      }
      ids.push(...r);
    }
    return ids;
  };
}

/** Jetons → texte (les jetons spéciaux, ≥ `eot`, sont ignorés). */
export function texteDesJetons(jetons, ids, eot = Infinity) {
  return Buffer.concat(ids.filter(i => i < eot && jetons[i]).map(i => jetons[i]))
    .toString('utf8')
    .replace(/\s+/g, ' ')
    .trim();
}

// ------------------------------------------------------------------ Garde-fous

/** Énergie moyenne (RMS) d'un morceau : sous ce seuil, c'est du silence (Whisper y invente du texte). */
export const SEUIL_SILENCE = 0.003;

export function rms(pcm, debut = 0, fin = pcm.length) {
  let s = 0;
  for (let i = debut; i < fin; i++) s += pcm[i] * pcm[i];
  return fin > debut ? Math.sqrt(s / (fin - debut)) : 0;
}

/** Coupe une boucle de répétition en fin de séquence (« merci merci merci… », même phrase répétée). */
export function couperRepetitions(ids, { min = 4 } = {}) {
  for (let n = 1; n <= 30 && n * min <= ids.length; n++) {
    const fois = n === 1 ? Math.max(min, 8) : min;
    if (n * fois > ids.length) continue;
    let repete = true;
    const fin = ids.length;
    for (let r = 1; r < fois && repete; r++) {
      for (let i = 0; i < n; i++) {
        if (ids[fin - 1 - i] !== ids[fin - 1 - i - r * n]) {
          repete = false;
          break;
        }
      }
    }
    if (repete) {
      // Garder une seule occurrence du bloc répété.
      let debut = fin - fois * n;
      while (debut - n >= 0 && ids.slice(debut - n, debut).every((x, i) => x === ids[debut + i])) debut -= n;
      return { ids: ids.slice(0, debut + n), coupe: true };
    }
  }
  return { ids, coupe: false };
}

/** Seuils d'OpenAI (transcribe.py) : texte en boucle, décodage peu sûr, silence. */
export const SEUIL_COMPRESSION = 2.4;
export const SEUIL_LOGPROB = -1;
export const SEUIL_PAS_DE_PAROLE = 0.6;
/** Températures de repli : 0 (recherche en faisceau), puis échantillonnage de plus en plus libre. */
export const TEMPERATURES = [0, 0.2, 0.4, 0.6, 0.8, 1];

/** Taux de compression (zlib) d'un texte : au-delà de 2,4, il tourne en boucle. */
export function tauxCompression(texte) {
  const b = Buffer.from(String(texte ?? ''), 'utf8');
  return b.length ? b.length / deflateSync(b).length : 0;
}

/** Générateur pseudo-aléatoire reproductible (échantillonnage aux températures de repli). */
export function alea(graine = 1) {
  let x = graine >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

function logSommeExp(d, base, n) {
  let max = -Infinity;
  for (let i = 0; i < n; i++) if (d[base + i] > max) max = d[base + i];
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.exp(d[base + i] - max);
  return max + Math.log(s);
}

function softmaxEn(d, base, n, i) {
  return Math.exp(d[base + i] - logSommeExp(d, base, n));
}

// ------------------------------------------------------------------ Décodage

/**
 * Charge un modèle Whisper (sherpa-onnx, int8). Options : `dossier` (contenant les 3 fichiers), `nom` (tiny, base,
 * small, medium, turbo, large-v3…), `threads` (fils de calcul d'ONNX Runtime), `ort`.
 * Rend `{ transcrireMorceau(pcm, options), encoder(texte), liberer(), infos }`.
 */
export async function chargerWhisper({ ort, dossier, nom = 'base', threads = 1 }) {
  const enc = `${dossier}/${nom}-encoder.int8.onnx`;
  const dec = `${dossier}/${nom}-decoder.int8.onnx`;
  const meta = metadonneesOnnx(enc);
  const metaDec = metadonneesOnnx(dec);
  const m = { ...metaDec, ...meta };
  const couches = Number(m.n_text_layer);
  const contexte = Number(m.n_text_ctx);
  const etat = Number(m.n_text_state);
  const sot = Number(m.sot);
  const eot = Number(m.eot);
  const transcribe = Number(m.transcribe);
  const pasDHorodatage = Number(m.no_timestamps);
  const pasDeParole = Number(m.no_speech);
  const sotPrev = Number(m.sot_prev);
  const blanc = Number.isFinite(Number(m.blank_id)) ? Number(m.blank_id) : 220;
  const nMels = Number(m.n_mels) || N_MELS;
  const codes = String(m.all_language_codes ?? '').split(',').filter(Boolean);
  const idsLangues = nombres(m.all_language_tokens);
  if (!couches || !contexte || !etat || !sot || !eot) throw new Error(`Modèle Whisper illisible (${nom}) : métadonnées absentes.`);
  const multilingue = String(m.is_multilingual ?? '1') !== '0';
  const jetons = lireJetons(`${dossier}/${nom}-tokens.txt`);
  const encoderTexte = creerEncodeur(jetons, eot);
  // Jetons « non parlés » (♪, [, (…) supprimés comme le fait Whisper par défaut (suppress_tokens = -1).
  const interdits = new Set(nombres(m.non_speech_tokens).filter(i => i < eot));
  const options = {
    executionProviders: ['cpu'],
    intraOpNumThreads: Math.max(1, Number(threads) || 1),
    interOpNumThreads: 1,
    executionMode: 'sequential',
    graphOptimizationLevel: 'all',
    // Mémoire : pas de réserve (« arena ») gardée entre deux appels, plus sobre sur un mutualisé.
    enableCpuMemArena: false,
    enableMemPattern: false,
  };
  const encodeur = await ort.InferenceSession.create(enc, options);
  const decodeur = await ort.InferenceSession.create(dec, options);
  const tailleCache = couches * contexte * etat;
  const T = (type, donnees, forme) => new ort.Tensor(type, donnees, forme);

  function langueVersJeton(langue) {
    if (!multilingue) return null;
    const i = codes.indexOf(langue);
    return i >= 0 ? idsLangues[i] : null;
  }

  async function encoder(pcm) {
    const sortie = await encodeur.run({ mel: T('float32', logMel(pcm, nMels), [1, nMels, TRAMES]) });
    return { k: sortie.n_layer_cross_k, v: sortie.n_layer_cross_v };
  }

  function etape(jetonsEntree, cacheK, cacheV, croise, decalage) {
    return decodeur.run({
      tokens: T('int64', BigInt64Array.from(jetonsEntree.map(BigInt)), [1, jetonsEntree.length]),
      in_n_layer_self_k_cache: cacheK,
      in_n_layer_self_v_cache: cacheV,
      n_layer_cross_k: croise.k,
      n_layer_cross_v: croise.v,
      offset: T('int64', BigInt64Array.from([BigInt(decalage)]), [1]),
    });
  }

  const cacheVide = () => T('float32', new Float32Array(tailleCache), [couches, 1, contexte, etat]);

  /** Détection de la langue (mode « auto ») : un pas de décodage après <|startoftranscript|>. */
  async function detecterLangue(croise) {
    const r = await etape([sot], cacheVide(), cacheVide(), croise, 0);
    const logits = r.logits.data;
    let meilleur = 0;
    for (let i = 1; i < idsLangues.length; i++) if (logits[idsLangues[i]] > logits[idsLangues[meilleur]]) meilleur = i;
    return codes[meilleur] ?? 'en';
  }

  const permis = (i, premier) => i <= eot && !interdits.has(i) && !(premier && (i === eot || i === blanc));

  /** Log-somme-exp des jetons permis et les `k` meilleurs (identifiant, logit) d'une ligne de logits. */
  function meilleurs(d, base, premier, k) {
    let max = -Infinity;
    const top = [];
    for (let i = 0; i <= eot; i++) {
      if (!permis(i, premier)) continue;
      const x = d[base + i];
      if (x > max) max = x;
      if (top.length < k || x > top[top.length - 1][1]) {
        let j = top.length < k ? top.length : top.length - 1;
        top[j] = [i, x];
        while (j > 0 && top[j][1] > top[j - 1][1]) {
          [top[j], top[j - 1]] = [top[j - 1], top[j]];
          j -= 1;
        }
      }
    }
    let s = 0;
    for (let i = 0; i <= eot; i++) if (permis(i, premier)) s += Math.exp(d[base + i] - max);
    return { lse: max + Math.log(s), top };
  }

  /**
   * Recherche en faisceau (température 0 ; `beam` = 1 : décodage glouton). Chaque hypothèse garde son propre cache
   * clés/valeurs (sorties du décodeur, jamais modifiées : une hypothèse fille repart de celles de sa mère). Rend
   * `{ ids, somme }` (somme des log-probabilités), la meilleure selon la log-prob moyenne (règle d'OpenAI).
   */
  async function faisceau(r0, croise, invite, { beam, maxJetons }) {
    let vivantes = [{ ids: [], somme: 0, sortie: r0, ligne: invite.length - 1 }];
    const finies = [];
    let position = invite.length;
    for (let pas = 0; pas < maxJetons && vivantes.length; pas++) {
      const candidats = [];
      for (const h of vivantes) {
        const V = h.sortie.logits.dims[2];
        const { lse, top } = meilleurs(h.sortie.logits.data, h.ligne * V, pas === 0, beam + 1);
        for (const [id, x] of top) candidats.push({ mere: h, id, somme: h.somme + (x - lse) });
      }
      candidats.sort((a, b) => b.somme - a.somme);
      const suivantes = [];
      for (const c of candidats) {
        if (c.id === eot) {
          if (finies.length < beam) finies.push({ ids: c.mere.ids, somme: c.somme });
        } else suivantes.push(c);
        if (suivantes.length >= beam) break;
      }
      if (finies.length >= beam) break;
      const nouvelles = [];
      for (const c of suivantes) {
        const ids = [...c.mere.ids, c.id];
        if (ids.length >= 16 && ids.length % 4 === 0) {
          const coupe = couperRepetitions(ids);
          if (coupe.coupe) {
            // Boucle : l'hypothèse s'arrête (sa log-prob reste celle de la boucle : elle sera rarement choisie).
            finies.push({ ids: coupe.ids, somme: c.somme, boucle: true });
            continue;
          }
        }
        const sortie = await etape([c.id], c.mere.sortie.out_n_layer_self_k_cache, c.mere.sortie.out_n_layer_self_v_cache, croise, position);
        nouvelles.push({ ids, somme: c.somme, sortie, ligne: 0 });
      }
      vivantes = nouvelles;
      position += 1;
    }
    const choix = finies.length ? finies : vivantes;
    let meilleure = choix[0] ?? { ids: [], somme: 0 };
    for (const h of choix) if (h.somme / (h.ids.length + 1) > meilleure.somme / (meilleure.ids.length + 1)) meilleure = h;
    return { ids: meilleure.ids, somme: meilleure.somme, boucle: Boolean(meilleure.boucle) };
  }

  /** Échantillonnage à la température `t` (repli) : un candidat. */
  async function echantillon(r0, croise, invite, { t, maxJetons, hasard }) {
    let r = r0;
    let ligne = invite.length - 1;
    let position = invite.length;
    const ids = [];
    let somme = 0;
    const poids = new Float64Array(eot + 1);
    for (let pas = 0; pas < maxJetons; pas++) {
      const d = r.logits.data;
      const base = ligne * r.logits.dims[2];
      const { lse, top } = meilleurs(d, base, pas === 0, 1);
      const max = top[0]?.[1] ?? 0;
      let total = 0;
      for (let i = 0; i <= eot; i++) {
        poids[i] = permis(i, pas === 0) ? Math.exp((d[base + i] - max) / t) : 0;
        total += poids[i];
      }
      let tirage = hasard() * total;
      let id = eot;
      for (let i = 0; i <= eot; i++) {
        tirage -= poids[i];
        if (tirage <= 0 && poids[i] > 0) {
          id = i;
          break;
        }
      }
      somme += d[base + id] - lse;
      if (id === eot) break;
      ids.push(id);
      if (ids.length >= 16 && ids.length % 4 === 0 && couperRepetitions(ids).coupe) return { ids: couperRepetitions(ids).ids, somme, boucle: true };
      r = await etape([id], r.out_n_layer_self_k_cache, r.out_n_layer_self_v_cache, croise, position);
      position += 1;
      ligne = 0;
    }
    return { ids, somme };
  }

  /** Jetons du prompt (vocabulaire), mis en cache : le même pour tous les morceaux d'une réunion. */
  let dernierPrompt = null;
  const jetonsPrompt = texte => {
    if (dernierPrompt?.texte !== texte) dernierPrompt = { texte, ids: texte ? encoderTexte(` ${String(texte).trim()}`) : [] };
    return dernierPrompt.ids;
  };

  /**
   * Transcrit un morceau (≤ 30 s). Options :
   *  - `langue` (« fr », « en »…, « auto » : détectée) ;
   *  - `prompt` : vocabulaire de la team (gardé pour chaque morceau) ; `precedent` : jetons du texte du morceau
   *    précédent (contexte, comme Whisper) ; ensemble au plus 223 jetons (le vocabulaire est gardé en priorité) ;
   *  - `beam` (1 = glouton), `bestOf` (candidats échantillonnés aux températures de repli), `temperatures`.
   * Rend `{ texte, ids, langue, pasDeParole, logprob, compression, temperature }` ; texte vide si le morceau est
   * silencieux ou jugé sans parole.
   */
  async function transcrireMorceau(pcm, { langue = 'fr', prompt = '', precedent = null, beam = 1, bestOf = 1, temperatures = [0], graine = 1 } = {}) {
    if (pcm.length > ECHANTILLONS_30S) pcm = pcm.subarray(0, ECHANTILLONS_30S);
    if (rms(pcm) < SEUIL_SILENCE) return { texte: '', ids: [], langue, pasDeParole: 1, logprob: 0, compression: 0, temperature: 0, silence: true };
    const croise = await encoder(pcm);
    let code = langue;
    if (multilingue && (langue === 'auto' || langueVersJeton(langue) === null)) code = await detecterLangue(croise);
    const voc = jetonsPrompt(prompt).slice(0, 150);
    const prec = Array.isArray(precedent) && sotPrev ? precedent.filter(i => Number.isInteger(i) && i < eot).slice(-Math.max(0, 223 - voc.length)) : [];
    const contexteTexte = sotPrev ? [...voc, ...prec] : [];
    const debutSot = contexteTexte.length ? contexteTexte.length + 1 : 0;
    const invite = [...(contexteTexte.length ? [sotPrev, ...contexteTexte] : []), ...(multilingue ? [sot, langueVersJeton(code), transcribe, pasDHorodatage] : [sot, pasDHorodatage])];
    const r0 = await etape(invite, cacheVide(), cacheVide(), croise, 0);
    const V = r0.logits.dims[2];
    // Probabilité « pas de parole » : prédiction juste après <|startoftranscript|>.
    const pNoSpeech = Number.isFinite(pasDeParole) && pasDeParole < V ? softmaxEn(r0.logits.data, debutSot * V, V, pasDeParole) : 0;
    const maxJetons = Math.max(1, Math.min(224, contexte - invite.length - 1));
    const hasard = alea(graine);
    let resultat = null;
    for (const t of temperatures.length ? temperatures : [0]) {
      let r;
      if (t === 0) r = await faisceau(r0, croise, invite, { beam: Math.max(1, beam), maxJetons });
      else {
        for (let k = 0; k < Math.max(1, bestOf); k++) {
          const x = await echantillon(r0, croise, invite, { t, maxJetons, hasard });
          if (!r || x.somme / (x.ids.length + 1) > r.somme / (r.ids.length + 1)) r = x;
        }
      }
      const coupe = couperRepetitions(r.ids);
      const texte = texteDesJetons(jetons, coupe.ids, eot);
      const logprob = r.somme / (r.ids.length + 1);
      const compression = tauxCompression(texte);
      const boucle = Boolean(r.boucle || coupe.coupe);
      resultat = { texte, ids: coupe.ids, langue: code, pasDeParole: pNoSpeech, logprob, compression, temperature: t, boucle };
      // Règle d'OpenAI : forte probabilité de silence ET décodage peu sûr = pas de parole (pas de repli).
      if (pNoSpeech > SEUIL_PAS_DE_PAROLE && logprob < SEUIL_LOGPROB) return { ...resultat, texte: '', ids: [], silence: true };
      // Texte en boucle (coupée, ou taux de compression trop haut) ou peu sûr : température suivante.
      if (!boucle && !(compression > SEUIL_COMPRESSION) && !(logprob < SEUIL_LOGPROB)) break;
    }
    return resultat;
  }

  return {
    transcrireMorceau,
    encoder: encoderTexte,
    async liberer() {
      await encodeur.release?.();
      await decodeur.release?.();
    },
    infos: { nom, couches, contexte, etat, multilingue, nMels, threads: options.intraOpNumThreads, vocab: jetons.length },
  };
}
