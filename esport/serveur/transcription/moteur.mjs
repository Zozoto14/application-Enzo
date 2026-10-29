/**
 * Moteurs de transcription du serveur : où ils sont installés, s'ils sont prêts, quelle QUALITÉ chacun permet,
 * et leur chargement.
 *
 *  - moteur principal : whisper.cpp (whispercpp.mjs), binaire compilé sur le serveur + modèles GGML + VAD ;
 *  - moteur de REPLI : Whisper par ONNX Runtime (whisper.mjs), si whisper.cpp n'a pas pu être installé.
 *
 * Tout vit HORS du dépôt et hors de public_html, dans TRANSCRIPTION_DOSSIER_MODELES
 * (par défaut ~/esport-modeles), installé une seule fois par esport/serveur/installer-transcription.sh :
 *
 *   ~/esport-modeles/
 *     whispercpp/        whisper-cli (compilé depuis les sources du tag figé, commit vérifié)
 *     ggml/              modèles GGML (ggml-large-v3-turbo-q5_0.bin…), SHA-256 et SHA-1 vérifiés
 *     vad/               ggml-silero-v6.2.0.bin (détection de la parole), SHA-256 vérifié
 *     moteur/            paquets npm : ffmpeg-static (lecture audio), onnxruntime-node (repli)
 *     whisper-base/      modèle ONNX du repli (base-encoder.int8.onnx…), s'il est installé
 *     pret.json          écrit par l'installateur après vérification (moteurs, modèles, vitesses mesurées)
 *     travail/           fichiers audio temporaires des travaux en cours (effacés à la fin)
 *     travailleur.verrou un seul processus de transcription à la fois
 *
 * Le déploiement automatique (deployer.sh : git reset, npm install dans esport/) ne touche jamais à ce
 * dossier : le modèle n'est pas retéléchargé.
 */

import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chargerWhisper } from './whisper.mjs';
import { MODELES_GGML, VAD_SILERO, creerTranscripteurWhisperCpp } from './whispercpp.mjs';
import { DECODAGE_QUALITE, QUALITES, cleVitesse } from '../../noyau/medias/fileTranscription.mjs';

/** Versions figées des paquets du moteur (installés par installer-transcription.sh). */
export const PAQUETS_MOTEUR = { 'onnxruntime-node': '1.30.0', 'ffmpeg-static': '5.3.0' };

export const dossierModelesParDefaut = () => join(homedir(), 'esport-modeles');

export function chemins(config) {
  const dossier = config.dossierModeles || dossierModelesParDefaut();
  const modele = config.modele || 'base';
  return {
    dossier,
    moteur: join(dossier, 'moteur'),
    modele: join(dossier, `whisper-${modele}`),
    fichiersModele: [`${modele}-encoder.int8.onnx`, `${modele}-decoder.int8.onnx`, `${modele}-tokens.txt`].map(f => join(dossier, `whisper-${modele}`, f)),
    pret: join(dossier, 'pret.json'),
    whispercpp: join(dossier, 'whispercpp'),
    binaireWhisper: join(dossier, 'whispercpp', 'whisper-cli'),
    ggml: join(dossier, 'ggml'),
    vad: join(dossier, 'vad', VAD_SILERO.fichier),
    outils: join(dossier, 'outils'),
    essai: join(dossier, 'essai'),
    travail: join(dossier, 'travail'),
    verrou: join(dossier, 'travailleur.verrou'),
  };
}

const lirePret = c => {
  try {
    return JSON.parse(readFileSync(c.pret, 'utf8'));
  } catch {
    return null;
  }
};

/** Repli ONNX : installé et vérifié pour le modèle `config.modele` ? Rend `{ installe, raison? }`. */
export function etatOnnx(config, pret = lirePret(chemins(config))) {
  const c = chemins(config);
  if (!existsSync(join(c.moteur, 'node_modules', 'onnxruntime-node', 'package.json'))) return { installe: false, raison: 'moteur absent (lancer esport/serveur/installer-transcription.sh)' };
  for (const f of c.fichiersModele) if (!existsSync(f)) return { installe: false, raison: `modèle « ${config.modele} » absent (lancer installer-transcription.sh)` };
  if (!pret) return { installe: false, raison: 'installation pas vérifiée (relancer installer-transcription.sh)' };
  if (!Array.isArray(pret?.modeles) || !pret.modeles.includes(config.modele)) return { installe: false, raison: `modèle « ${config.modele} » pas vérifié (relancer installer-transcription.sh)` };
  return { installe: true };
}

/**
 * whisper.cpp : binaire présent et exécutable, modèles GGML présents (taille de pret.json), VAD. Rend
 * `{ installe, raison?, binaire, modeles: { nom: chemin }, vad, vitesses, memoireMo }`.
 */
export function etatWhisperCpp(config, pret = lirePret(chemins(config))) {
  const c = chemins(config);
  const w = pret?.whispercpp;
  const vide = { installe: false, binaire: null, modeles: {}, vad: null, vitesses: {}, memoireMo: {} };
  if (!w) return { ...vide, raison: 'whisper.cpp non installé (lancer esport/serveur/installer-transcription.sh)' };
  try {
    if (w.binaire !== c.binaireWhisper) throw new Error('binaire');
    accessSync(c.binaireWhisper, constants.X_OK);
  } catch {
    return { ...vide, raison: 'whisper.cpp absent (relancer installer-transcription.sh)' };
  }
  const modeles = {};
  for (const [nom, m] of Object.entries(w.modeles ?? {})) {
    const def = MODELES_GGML[nom];
    const chemin = join(c.ggml, def?.fichier ?? '');
    try {
      if (def && statSync(chemin).size === m.taille) modeles[nom] = chemin;
    } catch {
      // Modèle effacé : pas disponible.
    }
  }
  if (!Object.keys(modeles).length) return { ...vide, binaire: c.binaireWhisper, raison: 'aucun modèle GGML (relancer installer-transcription.sh)' };
  let vad = null;
  try {
    if (statSync(c.vad).size === VAD_SILERO.taille) vad = c.vad;
  } catch {
    vad = null;
  }
  return { installe: true, binaire: c.binaireWhisper, modeles, vad, vitesses: w.vitesses ?? {}, memoireMo: w.memoireMo ?? {} };
}

/**
 * Qualités disponibles d'après les moteurs installés (pur, testable) : `{ rapide: { disponible, moteur, modele },
 * … }`. whisper.cpp d'abord (modèle de la qualité, TRANSCRIPTION_MODELE_*), sinon le repli ONNX pour la seule
 * qualité « équilibrée » (un seul modèle). `config.moteur` : auto | whispercpp | onnx.
 */
export function qualitesDisponibles(config, { whispercpp, onnx }) {
  const sortie = {};
  const avecWhisper = config.moteur !== 'onnx' && whispercpp?.installe;
  const avecOnnx = config.moteur !== 'whispercpp' && onnx?.installe;
  for (const q of QUALITES) {
    const modele = config.modelesQualite?.[q];
    if (avecWhisper && whispercpp.modeles[modele]) sortie[q] = { disponible: true, moteur: 'whispercpp', modele };
    else if (!avecWhisper && avecOnnx && q === 'equilibree') sortie[q] = { disponible: true, moteur: 'onnx', modele: config.modele };
    else sortie[q] = { disponible: false, moteur: avecWhisper ? 'whispercpp' : avecOnnx ? 'onnx' : null, modele: avecWhisper ? modele : null };
  }
  return sortie;
}

/**
 * Les moteurs sont-ils installés et vérifiés ? Rapide (aucun chargement) : appelé au démarrage du serveur et
 * par le cron. Rend `{ installe, raison?, ffmpeg, whispercpp, onnx, qualites, vitesses }`.
 */
export function etatInstallation(config) {
  const c = chemins(config);
  const pret = lirePret(c);
  const whispercpp = etatWhisperCpp(config, pret);
  const onnx = etatOnnx(config, pret);
  const qualites = qualitesDisponibles(config, { whispercpp, onnx });
  const installe = Object.values(qualites).some(q => q.disponible);
  const vitesses = {};
  for (const [m, v] of Object.entries(pret?.vitesse ?? {})) if (Number(v) > 0) vitesses[m] = Number(v);
  for (const [m, v] of Object.entries(whispercpp.vitesses ?? {})) if (Number(v) > 0) vitesses[cleVitesse('whispercpp', m)] = Number(v);
  const raison = installe ? undefined : config.moteur === 'onnx' ? onnx.raison : (whispercpp.raison ?? onnx.raison);
  return { installe, ...(raison ? { raison } : {}), ffmpeg: Boolean(cheminFfmpeg(config)), whispercpp, onnx, qualites, vitesses };
}

const requireMoteur = config => createRequire(join(chemins(config).moteur, 'package.json'));

/** onnxruntime-node, chargé depuis le dossier du moteur (jamais depuis esport/node_modules). */
export function chargerOrt(config) {
  return requireMoteur(config)('onnxruntime-node');
}

/** Chemin du binaire ffmpeg (paquet ffmpeg-static, sinon celui du système), ou null s'il n'y en a pas. */
export function cheminFfmpeg(config, { systeme = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'] } = {}) {
  const candidats = [];
  try {
    const p = requireMoteur(config)('ffmpeg-static');
    if (typeof p === 'string') candidats.push(p);
  } catch {
    // Paquet absent : ffmpeg du système, s'il y en a un.
  }
  for (const p of [...candidats, ...systeme]) {
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      // Suivant.
    }
  }
  return null;
}

/** Transcripteur Whisper du REPLI ONNX : `{ moteur, transcrireMorceau(pcm, { langue }), liberer() }`. */
export async function creerTranscripteurWhisper(config) {
  const w = await chargerWhisper({ ort: chargerOrt(config), dossier: chemins(config).modele, nom: config.modele, threads: config.threads });
  return { moteur: `Whisper ${config.modele} (serveur, ONNX)`, transcrireMorceau: w.transcrireMorceau, liberer: w.liberer, infos: w.infos, cle: `onnx:${config.modele}` };
}

/**
 * Transcripteur pour un choix `{ qualite, moteur, modele }` (voir `qualiteEffective`) : whisper.cpp (blocs,
 * prompt de vocabulaire, VAD) ou le repli ONNX (morceaux de 30 s).
 */
export async function creerTranscripteur(config, choix, { surProcessus } = {}) {
  if (choix?.moteur === 'whispercpp') {
    const w = etatWhisperCpp(config);
    if (!w.installe || !w.modeles[choix.modele]) throw Object.assign(new Error(`Modèle whisper.cpp « ${choix.modele} » absent : relancez installer-transcription.sh.`), { definitif: false });
    const t = creerTranscripteurWhisperCpp({
      binaire: w.binaire,
      fichierModele: w.modeles[choix.modele],
      nomModele: choix.modele,
      vad: config.vad ? w.vad : null,
      threads: config.threadsWhisper,
      decodage: DECODAGE_QUALITE[choix.qualite] ?? DECODAGE_QUALITE.equilibree,
      dossierTravail: chemins(config).travail,
      surProcessus,
    });
    return Object.assign(t, { cle: `whispercpp:${choix.modele}:${choix.qualite}`, memoireMoPrevue: MODELES_GGML[choix.modele]?.memoireMo ?? 2000 });
  }
  return creerTranscripteurWhisper(config);
}
