/**
 * Audio pour la transcription sur le serveur :
 *
 *  - `decoderVersPcm` : l'enregistrement (vidéo ou audio : MP4, MOV, MKV, WebM, M4A, MP3, WAV, OGG,
 *    FLAC…) est converti UNE FOIS en un fichier brut mono 16 kHz, 16 bits (≈ 115 Mo par heure), dans le
 *    dossier de travail. Avec ffmpeg (paquet npm `ffmpeg-static` : binaire autonome, rien à installer
 *    sur le système) ; sans ffmpeg, seuls les fichiers WAV sont lus (décodeur maison ci-dessous).
 *  - `lirePcm` : lit une tranche de ce fichier (jamais tout en mémoire) ;
 *  - PRÉTRAITEMENT (par défaut) : filtre passe-haut à 80 Hz (souffle, ronflement des micros Discord) et
 *    normalisation dynamique du volume (un joueur qui parle bas est remonté) ; avec ffmpeg (`highpass`,
 *    `dynaudnorm`), sinon un équivalent simple ici (`pretraiterPcm` : passe-haut + gain global + limiteur) ;
 *  - `fenetreSuivante` : découpe en morceaux (30 s pour le repli ONNX, quelques minutes pour whisper.cpp),
 *    coupés dans le moment le plus calme de la fin du morceau (on évite de couper un mot) ; la découpe ne
 *    dépend que de l'audio, donc une reprise après interruption retombe sur les mêmes morceaux.
 */

import { spawn } from 'node:child_process';
import { closeSync, openSync, readSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';

export const FREQUENCE = 16000;
const OCTETS_PAR_S = FREQUENCE * 2;

/** Les premiers octets annoncent-ils un WAV (RIFF…WAVE) ? */
export function estWav(chemin) {
  const fd = openSync(chemin, 'r');
  try {
    const b = Buffer.alloc(12);
    readSync(fd, b, 0, 12, 0);
    return b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE';
  } finally {
    closeSync(fd);
  }
}

/**
 * Convertit `source` en PCM brut (s16le, mono, 16 kHz) dans `sortie`. Rend `{ duree }` (secondes).
 * Écrit d'abord `<sortie>.partiel` puis renomme : un fichier `sortie` présent est toujours complet.
 */
export async function decoderVersPcm({ source, sortie, ffmpeg, threads = 1, signal, pretraitement = true }) {
  const partiel = `${sortie}.partiel`;
  rmSync(partiel, { force: true });
  if (ffmpeg) await avecFfmpeg({ ffmpeg, source, sortie: partiel, threads, signal, filtres: pretraitement });
  else if (estWav(source)) {
    wavVersPcm(source, partiel);
    if (pretraitement) pretraiterPcm(partiel);
  } else throw Object.assign(new Error('Format non lisible sans ffmpeg : relancez esport/serveur/installer-transcription.sh (ou déposez un WAV).'), { code: 'format' });
  renameSync(partiel, sortie);
  return { duree: dureePcm(sortie) };
}

/**
 * Filtres ffmpeg du prétraitement : passe-haut 80 Hz, puis normalisation DYNAMIQUE du volume (fenêtres de
 * 250 ms, gain au plus × 15 : voix faibles remontées sans pomper le bruit dans les silences).
 */
export const FILTRES_FFMPEG = 'highpass=f=80,dynaudnorm=f=250:g=15:p=0.9:m=15';

export const dureePcm = chemin => statSync(chemin).size / OCTETS_PAR_S;

function avecFfmpeg({ ffmpeg, source, sortie, threads, signal, filtres = true }) {
  return new Promise((ok, ko) => {
    const p = spawn(
      ffmpeg,
      ['-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', String(threads), '-i', source, '-vn', '-sn', '-dn', ...(filtres ? ['-af', FILTRES_FFMPEG] : []), '-ac', '1', '-ar', String(FREQUENCE), '-acodec', 'pcm_s16le', '-f', 's16le', '-y', sortie],
      { stdio: ['ignore', 'ignore', 'pipe'], signal },
    );
    let erreurs = '';
    p.stderr.on('data', d => {
      if (erreurs.length < 2000) erreurs += d;
    });
    p.on('error', ko);
    p.on('close', (code, signal) => {
      if (code === 0) ok();
      // Arrêté de force (hébergeur) : ce n'est pas le fichier qui est en cause, un nouvel essai aura lieu.
      else if (signal) ko(Object.assign(new Error(`ffmpeg a été arrêté (signal ${signal}${signal === 'SIGKILL' ? ' : arrêt de force par l’hébergeur ou un autre programme' : ''}) pendant la lecture de l’enregistrement.`), { signal, tueExterne: signal === 'SIGKILL' }));
      else ko(Object.assign(new Error(`ffmpeg n’a pas pu lire l’enregistrement (${erreurs.trim().split('\n').pop() || `code ${code}`}).`), { code: 'format' }));
    });
  });
}

// ------------------------------------------------------------------ WAV sans ffmpeg

/** Lit l'en-tête d'un WAV : format (PCM entier 8/16/24/32 bits ou flottant 32/64), canaux, fréquence, données. */
export function enteteWav(fd) {
  const b = Buffer.alloc(12);
  readSync(fd, b, 0, 12, 0);
  let pos = 12;
  let fmt = null;
  const tete = Buffer.alloc(8);
  for (let i = 0; i < 64; i++) {
    if (readSync(fd, tete, 0, 8, pos) < 8) break;
    const id = tete.toString('latin1', 0, 4);
    const n = tete.readUInt32LE(4);
    if (id === 'fmt ') {
      const f = Buffer.alloc(Math.min(n, 40));
      readSync(fd, f, 0, f.length, pos + 8);
      let format = f.readUInt16LE(0);
      if (format === 0xfffe && f.length >= 26) format = f.readUInt16LE(24);
      fmt = { format, canaux: f.readUInt16LE(2), frequence: f.readUInt32LE(4), bits: f.readUInt16LE(14) };
    } else if (id === 'data') {
      if (!fmt) break;
      return { ...fmt, debut: pos + 8, taille: n };
    }
    pos += 8 + n + (n % 2);
  }
  throw Object.assign(new Error('WAV illisible.'), { code: 'format' });
}

/** WAV (quelconque) → PCM mono 16 kHz s16le, par blocs (mémoire constante), rééchantillonnage linéaire. */
export function wavVersPcm(source, sortie) {
  const fd = openSync(source, 'r');
  const out = openSync(sortie, 'w');
  try {
    const h = enteteWav(fd);
    const octets = h.bits / 8;
    if (!((h.format === 1 && [8, 16, 24, 32].includes(h.bits)) || (h.format === 3 && [32, 64].includes(h.bits))) || !h.canaux || !h.frequence) {
      throw Object.assign(new Error('WAV non pris en charge (PCM ou flottant attendu).'), { code: 'format' });
    }
    const trame = octets * h.canaux;
    const tailleReelle = Math.min(h.taille || Infinity, statSync(source).size - h.debut);
    const total = Math.floor(tailleReelle / trame);
    const echantillon = (buf, o) => {
      if (h.format === 3) return h.bits === 32 ? buf.readFloatLE(o) : buf.readDoubleLE(o);
      if (h.bits === 8) return (buf[o] - 128) / 128;
      if (h.bits === 16) return buf.readInt16LE(o) / 32768;
      if (h.bits === 24) return buf.readIntLE(o, 3) / 8388608;
      return buf.readInt32LE(o) / 2147483648;
    };
    const ratio = h.frequence / FREQUENCE;
    const bloc = 65536;
    const entree = Buffer.alloc(bloc * trame);
    let lus = 0;
    let precedent = 0;
    let tPos = 0; // position (en échantillons source) du prochain échantillon de sortie
    const mono = new Float64Array(bloc);
    while (lus < total) {
      const n = Math.min(bloc, total - lus);
      readSync(fd, entree, 0, n * trame, h.debut + lus * trame);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < h.canaux; c++) s += echantillon(entree, i * trame + c * octets);
        mono[i] = s / h.canaux;
      }
      const sortieBloc = [];
      while (tPos < lus + n) {
        const i = Math.floor(tPos) - lus;
        const frac = tPos - Math.floor(tPos);
        const a = i < 0 ? precedent : mono[i];
        const b2 = i + 1 < n ? mono[i + 1] : a;
        sortieBloc.push(a + (b2 - a) * frac);
        tPos += ratio;
      }
      precedent = mono[n - 1];
      const buf = Buffer.alloc(sortieBloc.length * 2);
      for (let i = 0; i < sortieBloc.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sortieBloc[i] * 32767))), i * 2);
      writeSync(out, buf);
      lus += n;
    }
  } finally {
    closeSync(fd);
    closeSync(out);
  }
}

/**
 * Prétraitement SANS ffmpeg d'un fichier PCM brut (s16le, mono, 16 kHz), sur place, par blocs (mémoire
 * constante) : passe-haut du premier ordre à 80 Hz, puis gain global qui amène le niveau de la parole (95e
 * centile de l'énergie par 100 ms) vers -20 dBFS (gain entre × 0,5 et × 20), avec un limiteur doux (pas de
 * saturation). Rend `{ gain }`.
 */
export function pretraiterPcm(chemin, { coupure = 80, cible = 0.1 } = {}) {
  const taille = statSync(chemin).size;
  const n = Math.floor(taille / 2);
  if (!n) return { gain: 1 };
  const bloc = 1 << 16;
  const buf = Buffer.alloc(bloc * 2);
  const rc = 1 / (2 * Math.PI * coupure);
  const alpha = rc / (rc + 1 / FREQUENCE);
  const fd = openSync(chemin, 'r+');
  try {
    // 1. Passe-haut (écrit sur place) et énergie par tranche de 100 ms.
    let xPrec = 0;
    let yPrec = 0;
    const energies = [];
    let somme = 0;
    let compte = 0;
    for (let lus = 0; lus < n; lus += bloc) {
      const k = Math.min(bloc, n - lus);
      readSync(fd, buf, 0, k * 2, lus * 2);
      for (let i = 0; i < k; i++) {
        const x = buf.readInt16LE(i * 2) / 32768;
        const y = alpha * (yPrec + x - xPrec);
        xPrec = x;
        yPrec = y;
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(y * 32767))), i * 2);
        somme += y * y;
        if (++compte === FREQUENCE / 10) {
          energies.push(Math.sqrt(somme / compte));
          somme = 0;
          compte = 0;
        }
      }
      writeSync(fd, buf, 0, k * 2, lus * 2);
    }
    if (compte) energies.push(Math.sqrt(somme / compte));
    energies.sort((a, b) => a - b);
    const niveau = energies[Math.min(energies.length - 1, Math.floor(energies.length * 0.95))] || 0;
    const gain = niveau > 1e-5 ? Math.max(0.5, Math.min(20, cible / niveau)) : 1;
    if (Math.abs(gain - 1) < 0.05) return { gain: 1 };
    // 2. Gain et limiteur doux (tanh au-delà de 0,8).
    const limiter = v => (Math.abs(v) <= 0.8 ? v : Math.sign(v) * (0.8 + 0.2 * Math.tanh((Math.abs(v) - 0.8) / 0.2)));
    for (let lus = 0; lus < n; lus += bloc) {
      const k = Math.min(bloc, n - lus);
      readSync(fd, buf, 0, k * 2, lus * 2);
      for (let i = 0; i < k; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(limiter((buf.readInt16LE(i * 2) / 32768) * gain) * 32767))), i * 2);
      writeSync(fd, buf, 0, k * 2, lus * 2);
    }
    return { gain };
  } finally {
    closeSync(fd);
  }
}

// ------------------------------------------------------------------ Lecture et découpe

/** Tranche [debut, fin[ (secondes) du fichier PCM, en Float32Array (-1…1). */
export function lirePcm(chemin, debut, fin) {
  const taille = statSync(chemin).size;
  const o0 = Math.max(0, Math.floor(debut * FREQUENCE)) * 2;
  const o1 = Math.min(taille, Math.floor(fin * FREQUENCE) * 2);
  const n = Math.max(0, (o1 - o0) >> 1);
  const buf = Buffer.alloc(n * 2);
  if (n) {
    const fd = openSync(chemin, 'r');
    try {
      readSync(fd, buf, 0, n * 2, o0);
    } finally {
      closeSync(fd);
    }
  }
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) pcm[i] = buf.readInt16LE(i * 2) / 32768;
  return pcm;
}

export const MORCEAU_MAX_S = 30;
const RECHERCHE_S = 10;
const PAS_ENERGIE = 0.1;

/**
 * Prochain morceau à partir de `debut` (secondes) : au plus `max` (30 s par défaut) ; s'il reste plus, la
 * coupe tombe au moment le plus calme (énergie sur 100 ms) des `recherche` dernières secondes (10 s par
 * défaut : entre 20 et 30 s). Rend `{ debut, fin }`.
 */
export function fenetreSuivante(chemin, debut, duree = dureePcm(chemin), { max = MORCEAU_MAX_S, recherche = RECHERCHE_S } = {}) {
  if (duree - debut <= max) return { debut, fin: duree };
  const zoneDebut = debut + max - Math.min(recherche, max - 1);
  const pcm = lirePcm(chemin, zoneDebut, debut + max);
  const pas = Math.round(PAS_ENERGIE * FREQUENCE);
  let meilleure = pcm.length;
  let energie = Infinity;
  for (let i = 0; i + pas <= pcm.length; i += pas) {
    let s = 0;
    for (let j = i; j < i + pas; j++) s += pcm[j] * pcm[j];
    // À égalité, la coupe la plus tardive (morceaux plus longs, donc moins nombreux).
    if (s <= energie) {
      energie = s;
      meilleure = i + pas / 2;
    }
  }
  const fin = Math.round((zoneDebut + meilleure / FREQUENCE) * 100) / 100;
  return { debut, fin: Math.min(Math.max(fin, debut + 1), debut + max) };
}

/** Écrit un WAV mono 16 bits (tests, essai de l'installation). */
export function ecrireWav(chemin, pcm, frequence = FREQUENCE) {
  const n = pcm.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(frequence, 24);
  b.writeUInt32LE(frequence * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767))), 44 + i * 2);
  const fd = openSync(chemin, 'w');
  try {
    writeSync(fd, b);
  } finally {
    closeSync(fd);
  }
}

// ------------------------------------------------------------------ Détection de la parole (énergie)

/**
 * Zone de parole d'un morceau (détection simple par l'énergie, sans modèle) : trames de 30 ms, seuil adapté au bruit
 * de fond du morceau (3 × le 10e centile, borné par le quart du 90e centile et par `seuilMin`). Rend `{ debut, fin }`
 * en ÉCHANTILLONS (avec `marge` secondes de chaque côté), ou null s'il y a moins de `minParoleS` de parole : le
 * morceau n'est alors pas confié à Whisper (qui invente du texte dans le silence).
 */
export function zoneDeParole(pcm, { frequence = FREQUENCE, trameS = 0.03, marge = 0.2, minParoleS = 0.25, seuilMin = 0.003 } = {}) {
  const n = Math.max(1, Math.round(trameS * frequence));
  const nb = Math.floor(pcm.length / n);
  if (!nb) return null;
  const e = new Float64Array(nb);
  for (let k = 0; k < nb; k++) {
    let s = 0;
    for (let i = k * n; i < (k + 1) * n; i++) s += pcm[i] * pcm[i];
    e[k] = Math.sqrt(s / n);
  }
  const tri = Float64Array.from(e).sort();
  const bruit = tri[Math.floor(nb * 0.1)];
  const fort = tri[Math.min(nb - 1, Math.floor(nb * 0.9))];
  const seuil = Math.max(seuilMin, Math.min(bruit * 3, fort * 0.25));
  let premier = -1;
  let dernier = -1;
  let compte = 0;
  for (let k = 0; k < nb; k++) {
    if (e[k] > seuil) {
      if (premier < 0) premier = k;
      dernier = k;
      compte += 1;
    }
  }
  if (premier < 0 || compte * trameS < minParoleS) return null;
  const m = Math.round(marge * frequence);
  return { debut: Math.max(0, premier * n - m), fin: Math.min(pcm.length, (dernier + 1) * n + m) };
}

/** Énergie (RMS) autour de l'instant `t` (secondes) du fichier PCM : la coupe entre deux morceaux tombe-t-elle dans un silence ? */
export function energieAutour(chemin, t, demi = 0.15) {
  const x = lirePcm(chemin, Math.max(0, t - demi), t + demi);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return x.length ? Math.sqrt(s / x.length) : 0;
}
