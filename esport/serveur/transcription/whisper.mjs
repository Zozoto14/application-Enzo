/**
 * Whisper SUR LE SERVEUR (Node 22, processeur seulement), avec ONNX Runtime pour Node
 * (`onnxruntime-node`, binaires précompilés pour Linux x64 : rien à compiler, pas de root).
 *
 * Modèles : export ONNX de Whisper fait par le projet sherpa-onnx (k2-fsa), quantifié en int8
 * (`<nom>-encoder.int8.onnx`, `<nom>-decoder.int8.onnx`, `<nom>-tokens.txt`), téléchargé une fois par
 * esport/serveur/installer-transcription.sh. Ce sont les poids d'origine d'OpenAI : mêmes résultats
 * que Whisper « tiny », « base » ou « small » ailleurs.
 *
 * Ce fichier fait, sans autre dépendance :
 *  - le log-mel spectrogramme de Whisper (80 bandes, fenêtres de 25 ms tous les 10 ms, 30 s) ;
 *  - le décodage glouton (« greedy ») avec cache clés/valeurs, langue imposée ou détectée,
 *    sans horodatage par mot (un segment = un morceau d'au plus 30 s) ;
 *  - des garde-fous contre les « hallucinations » de Whisper : morceau silencieux ignoré,
 *    probabilité « pas de parole » élevée, boucles de répétition coupées.
 *
 * `ort` (le module onnxruntime-node) est fourni par l'appelant (chargé depuis le dossier des modèles,
 * hors du dépôt : voir moteur.mjs).
 */

import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';

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

let filtresMel;
let tablesDft;

/** Filtres mel « Slaney » de librosa (ceux de Whisper) : 80 × 201. */
export function filtres() {
  if (filtresMel) return filtresMel;
  const versMel = hz => (hz < 1000 ? (3 * hz) / 200 : 15 + Math.log(hz / 1000) / (Math.log(6.4) / 27));
  const versHz = mel => (mel < 15 ? (200 * mel) / 3 : 1000 * Math.exp((Math.log(6.4) / 27) * (mel - 15)));
  const melMax = versMel(FREQUENCE / 2);
  const points = Array.from({ length: N_MELS + 2 }, (_, i) => versHz((melMax * i) / (N_MELS + 1)));
  const f = new Float32Array(N_MELS * BINS);
  for (let m = 0; m < N_MELS; m++) {
    const [g, c, d] = [points[m], points[m + 1], points[m + 2]];
    const norme = 2 / (d - g);
    for (let k = 0; k < BINS; k++) {
      const hz = (k * FREQUENCE) / N_FFT;
      const v = Math.max(0, Math.min((hz - g) / (c - g), (d - hz) / (d - c)));
      f[m * BINS + k] = v * norme;
    }
  }
  filtresMel = f;
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
 * complété par du silence jusqu'à 30 s, rend un Float32Array de 80 × 3000 (forme [1, 80, 3000]).
 */
export function logMel(pcm) {
  const { fenetre } = tables();
  const f = filtres();
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

// ------------------------------------------------------------------ Décodage

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

/**
 * Charge un modèle Whisper (sherpa-onnx, int8). Options : `dossier` (contenant les 3 fichiers),
 * `nom` (tiny, base, small…), `threads` (1 ou 2 conseillé sur un hébergement mutualisé), `ort`.
 * Rend `{ transcrireMorceau(pcm, { langue }), liberer(), infos }`.
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
  const codes = String(m.all_language_codes ?? '').split(',').filter(Boolean);
  const idsLangues = nombres(m.all_language_tokens);
  if (!couches || !contexte || !etat || !sot || !eot) throw new Error(`Modèle Whisper illisible (${enc}) : métadonnées absentes.`);
  const multilingue = String(m.is_multilingual ?? '1') !== '0';
  const jetons = lireJetons(`${dossier}/${nom}-tokens.txt`);
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
    const sortie = await encodeur.run({ mel: T('float32', logMel(pcm), [1, N_MELS, TRAMES]) });
    return { k: sortie.n_layer_cross_k, v: sortie.n_layer_cross_v };
  }

  async function etape(jetonsEntree, cacheK, cacheV, croise, decalage) {
    const r = await decodeur.run({
      tokens: T('int64', BigInt64Array.from(jetonsEntree.map(BigInt)), [1, jetonsEntree.length]),
      in_n_layer_self_k_cache: cacheK,
      in_n_layer_self_v_cache: cacheV,
      n_layer_cross_k: croise.k,
      n_layer_cross_v: croise.v,
      offset: T('int64', BigInt64Array.from([BigInt(decalage)]), [1]),
    });
    return r;
  }

  const cacheVide = () => T('float32', new Float32Array(tailleCache), [couches, 1, contexte, etat]);
  const vocab = () => jetons.length;

  /** Détection de la langue (mode « auto ») : un pas de décodage après <|startoftranscript|>. */
  async function detecterLangue(croise) {
    const r = await etape([sot], cacheVide(), cacheVide(), croise, 0);
    const logits = r.logits.data;
    let meilleur = 0;
    for (let i = 1; i < idsLangues.length; i++) if (logits[idsLangues[i]] > logits[idsLangues[meilleur]]) meilleur = i;
    return codes[meilleur] ?? 'en';
  }

  /**
   * Transcrit un morceau (≤ 30 s). Rend `{ texte, langue, pasDeParole, logprob }` ; texte vide si le
   * morceau est silencieux ou jugé sans parole.
   */
  async function transcrireMorceau(pcm, { langue = 'fr' } = {}) {
    if (pcm.length > ECHANTILLONS_30S) pcm = pcm.subarray(0, ECHANTILLONS_30S);
    if (rms(pcm) < SEUIL_SILENCE) return { texte: '', langue, pasDeParole: 1, logprob: 0, silence: true };
    const croise = await encoder(pcm);
    let code = langue;
    if (multilingue && (langue === 'auto' || langueVersJeton(langue) === null)) code = await detecterLangue(croise);
    const invite = multilingue ? [sot, langueVersJeton(code), transcribe, pasDHorodatage] : [sot, pasDHorodatage];
    let r = await etape(invite, cacheVide(), cacheVide(), croise, 0);
    const V = r.logits.dims[2];
    // Probabilité « pas de parole » : prédiction juste après <|startoftranscript|>.
    const pNoSpeech = Number.isFinite(pasDeParole) && pasDeParole < V ? softmaxEn(r.logits.data, 0, V, pasDeParole) : 0;
    const produits = [];
    let somme = 0;
    const maxJetons = Math.min(224, contexte - invite.length - 1);
    let position = invite.length;
    let ligne = invite.length - 1;
    for (let pas = 0; pas < maxJetons; pas++) {
      const d = r.logits.data;
      const base = ligne * V;
      // Jetons spéciaux interdits (sauf la fin), et pas de blanc en tout premier.
      let meilleur = -1;
      let valeur = -Infinity;
      for (let i = 0; i < V; i++) {
        if (i > eot) break;
        if (pas === 0 && (i === eot || i === 220)) continue;
        const x = d[base + i];
        if (x > valeur) {
          valeur = x;
          meilleur = i;
        }
      }
      somme += valeur - logSommeExp(d, base, V);
      if (meilleur === eot || meilleur < 0) break;
      produits.push(meilleur);
      // Boucle de répétition : on coupe et on s'arrête.
      if (produits.length >= 16 && produits.length % 4 === 0) {
        const c = couperRepetitions(produits);
        if (c.coupe) {
          produits.length = 0;
          produits.push(...c.ids);
          break;
        }
      }
      r = await etape([meilleur], r.out_n_layer_self_k_cache, r.out_n_layer_self_v_cache, croise, position);
      position += 1;
      ligne = 0;
    }
    const logprob = somme / Math.max(1, produits.length + 1);
    const texte = Buffer.concat(produits.filter(i => i < eot && jetons[i]).map(i => jetons[i]))
      .toString('utf8')
      .replace(/\s+/g, ' ')
      .trim();
    // Règle d'OpenAI : forte probabilité de silence ET décodage peu sûr = pas de parole.
    if (pNoSpeech > 0.6 && logprob < -1) return { texte: '', langue: code, pasDeParole: pNoSpeech, logprob };
    return { texte, langue: code, pasDeParole: pNoSpeech, logprob };
  }

  return {
    transcrireMorceau,
    async liberer() {
      await encodeur.release?.();
      await decodeur.release?.();
    },
    infos: { nom, couches, contexte, etat, multilingue, threads: options.intraOpNumThreads, vocab: vocab() },
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
