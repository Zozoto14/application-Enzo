/**
 * Moteurs de transcription du serveur : où ils sont installés, s'ils sont prêts, quelle QUALITÉ chacun permet,
 * et leur chargement.
 *
 *  - moteur PAR DÉFAUT : Whisper par ONNX Runtime DANS LE PROCESSUS NODE (whisper.mjs), modèles sherpa-onnx int8 :
 *    small (Rapide), large-v3-turbo (Équilibrée), large-v3 (Maximale). L'hébergeur (o2switch) arrête de force les
 *    binaires de calcul externes lancés depuis le dossier personnel (whisper.cpp, llama-server : SIGKILL), pas le
 *    processus `node` : c'est pourquoi tout le calcul reste ici ;
 *  - en OPTION : whisper.cpp (whispercpp.mjs), binaire compilé sur le serveur (`installer-transcription.sh
 *    --whispercpp`) ; s'il est arrêté de force par l'hébergeur, le travail BASCULE sur ONNX et whisper.cpp est
 *    DÉSACTIVÉ pour la suite (fichier whispercpp-desactive.json, visible dans l'Administration).
 *
 * Tout vit HORS du dépôt et hors de public_html, dans TRANSCRIPTION_DOSSIER_MODELES
 * (par défaut ~/esport-modeles), installé une seule fois par esport/serveur/installer-transcription.sh :
 *
 *   ~/esport-modeles/
 *     moteur/            paquets npm : onnxruntime-node (calcul), ffmpeg-static (lecture audio)
 *     whisper-turbo/     modèle ONNX (turbo-encoder.int8.onnx, turbo-decoder.int8.onnx, turbo-tokens.txt), SHA-256 vérifiés
 *     whisper-small/, whisper-large-v3/ …
 *     whispercpp/, ggml/, vad/   whisper.cpp et ses modèles GGML (option --whispercpp)
 *     whispercpp-desactive.json  whisper.cpp arrêté de force par l'hébergeur : plus utilisé (supprimer pour réessayer)
 *     pret.json          écrit par l'installateur après vérification (moteurs, modèles, vitesses mesurées)
 *     travail/           fichiers audio temporaires des travaux en cours (effacés à la fin)
 *     travailleur.verrou un seul processus de transcription à la fois
 *     lanceur.json       dernière décision du cron (lancé, déjà en cours, rien à faire…) : Administration
 *     dernier-passage.txt fin du dernier processus de transcription
 *
 * Le déploiement automatique (deployer.sh : git reset, npm install dans esport/) ne touche jamais à ce
 * dossier : les modèles ne sont pas retéléchargés.
 */

import { accessSync, constants, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chargerWhisper } from './whisper.mjs';
import { MODELES_GGML, VAD_SILERO, creerTranscripteurWhisperCpp } from './whispercpp.mjs';
import { DECODAGE_QUALITE, QUALITES, cleVitesse } from '../../noyau/medias/fileTranscription.mjs';

/** Versions figées des paquets du moteur (installés par installer-transcription.sh). */
export const PAQUETS_MOTEUR = { 'onnxruntime-node': '1.30.0', 'ffmpeg-static': '5.3.0' };

/**
 * Modèles ONNX (exports int8 de sherpa-onnx, dépôts Hugging Face csukuangfj/sherpa-onnx-whisper-<nom>) : fichiers
 * `<nom>-encoder.int8.onnx`, `<nom>-decoder.int8.onnx`, `<nom>-tokens.txt`. L'installateur relève la liste, les
 * tailles et les SHA-256 publiés par Hugging Face pour une révision précise, et vérifie chaque fichier téléchargé.
 * `memoireMo` : mémoire approximative du processus pendant le calcul (beam 5).
 */
export const MODELES_ONNX_DEFS = {
  tiny: { depot: 'csukuangfj/sherpa-onnx-whisper-tiny', nom: 'Whisper tiny', tailleApprox: 1.1e8, memoireMo: 450 },
  base: { depot: 'csukuangfj/sherpa-onnx-whisper-base', nom: 'Whisper base', tailleApprox: 1.6e8, memoireMo: 550 },
  small: { depot: 'csukuangfj/sherpa-onnx-whisper-small', nom: 'Whisper small', tailleApprox: 3.8e8, memoireMo: 1100 },
  medium: { depot: 'csukuangfj/sherpa-onnx-whisper-medium', nom: 'Whisper medium', tailleApprox: 9.5e8, memoireMo: 2300 },
  turbo: { depot: 'csukuangfj/sherpa-onnx-whisper-turbo', nom: 'Whisper large-v3-turbo', tailleApprox: 1.0e9, memoireMo: 2600 },
  'large-v3': { depot: 'csukuangfj/sherpa-onnx-whisper-large-v3', nom: 'Whisper large-v3', tailleApprox: 1.8e9, memoireMo: 4500 },
};

export const fichiersOnnx = nom => [`${nom}-encoder.int8.onnx`, `${nom}-decoder.int8.onnx`, `${nom}-tokens.txt`];

export const dossierModelesParDefaut = () => join(homedir(), 'esport-modeles');

export function chemins(config) {
  const dossier = config.dossierModeles || dossierModelesParDefaut();
  const modele = config.modele || 'base';
  return {
    dossier,
    moteur: join(dossier, 'moteur'),
    /** Dossier d'un modèle ONNX. */
    onnx: nom => join(dossier, `whisper-${nom}`),
    // Ancien réglage TRANSCRIPTION_MODELE (modèle ONNX unique) : gardé pour les installations existantes.
    modele: join(dossier, `whisper-${modele}`),
    fichiersModele: fichiersOnnx(modele).map(f => join(dossier, `whisper-${modele}`, f)),
    pret: join(dossier, 'pret.json'),
    whispercpp: join(dossier, 'whispercpp'),
    binaireWhisper: join(dossier, 'whispercpp', 'whisper-cli'),
    desactivationWhisper: join(dossier, 'whispercpp-desactive.json'),
    ggml: join(dossier, 'ggml'),
    vad: join(dossier, 'vad', VAD_SILERO.fichier),
    outils: join(dossier, 'outils'),
    essai: join(dossier, 'essai'),
    travail: join(dossier, 'travail'),
    verrou: join(dossier, 'travailleur.verrou'),
    lanceur: join(dossier, 'lanceur.json'),
    dernierPassage: join(dossier, 'dernier-passage.txt'),
  };
}

const lireJson = chemin => {
  try {
    return JSON.parse(readFileSync(chemin, 'utf8'));
  } catch {
    return null;
  }
};
const lirePret = c => lireJson(c.pret);

/**
 * Moteur ONNX (dans le processus Node) : onnxruntime-node installé, et quels modèles sont présents et vérifiés.
 * Un modèle compte s'il est noté dans pret.json (`onnx.modeles`, avec la taille de chaque fichier) et que ses
 * fichiers ont toujours cette taille ; les anciennes installations (`modeles: ['base']`) restent lisibles.
 * Rend `{ installe, raison?, modeles: { nom: dossier }, vitesses, memoireMo }`.
 */
export function etatOnnx(config, pret = lirePret(chemins(config))) {
  const c = chemins(config);
  const vide = { installe: false, modeles: {}, vitesses: {}, memoireMo: {} };
  if (!existsSync(join(c.moteur, 'node_modules', 'onnxruntime-node', 'package.json'))) return { ...vide, raison: 'moteur ONNX absent (lancer esport/serveur/installer-transcription.sh)' };
  if (!pret) return { ...vide, raison: 'installation pas vérifiée (relancer installer-transcription.sh)' };
  const modeles = {};
  for (const [nom, m] of Object.entries(pret.onnx?.modeles ?? {})) {
    if (!MODELES_ONNX_DEFS[nom]) continue;
    const dossier = c.onnx(nom);
    try {
      const fichiers = Array.isArray(m?.fichiers) && m.fichiers.length ? m.fichiers : fichiersOnnx(nom).map(f => ({ nom: f, taille: null }));
      for (const f of fichiersOnnx(nom)) if (!existsSync(join(dossier, f))) throw new Error('absent');
      for (const f of fichiers) if (f.taille !== null && f.taille !== undefined && statSync(join(dossier, f.nom)).size !== f.taille) throw new Error('taille');
      modeles[nom] = dossier;
    } catch {
      // Modèle effacé ou incomplet : pas disponible.
    }
  }
  // Ancienne installation (repli ONNX « base » d'avant) : liste simple de noms.
  for (const nom of Array.isArray(pret.modeles) ? pret.modeles : []) {
    if (modeles[nom] || !MODELES_ONNX_DEFS[nom]) continue;
    if (fichiersOnnx(nom).every(f => existsSync(join(c.onnx(nom), f)))) modeles[nom] = c.onnx(nom);
  }
  if (!Object.keys(modeles).length) return { ...vide, raison: 'aucun modèle ONNX (lancer installer-transcription.sh)' };
  return { installe: true, modeles, vitesses: pret.onnx?.vitesses ?? {}, memoireMo: pret.onnx?.memoireMo ?? {} };
}

/** whisper.cpp désactivé (arrêté de force par l'hébergeur) : `{ le, raison }` ou null. */
export function desactivationWhisperCpp(config) {
  const j = lireJson(chemins(config).desactivationWhisper);
  return j && typeof j.raison === 'string' ? { le: typeof j.le === 'string' ? j.le : null, raison: j.raison } : null;
}

/** Désactive whisper.cpp pour la suite (il a été arrêté de force) ; rend la désactivation écrite. */
export function desactiverWhisperCpp(config, raison, { le = new Date().toISOString() } = {}) {
  const d = { le, raison: String(raison ?? '').slice(0, 300) };
  try {
    writeFileSync(chemins(config).desactivationWhisper, `${JSON.stringify(d, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // Dossier illisible : la bascule vaut au moins pour ce travail.
  }
  return d;
}

/** Réactive whisper.cpp (après un changement chez l'hébergeur) : efface la désactivation. */
export function reactiverWhisperCpp(config) {
  rmSync(chemins(config).desactivationWhisper, { force: true });
}

/**
 * whisper.cpp : binaire présent et exécutable, modèles GGML présents (taille de pret.json), VAD, et pas désactivé.
 * Rend `{ installe, raison?, desactive?, binaire, modeles: { nom: chemin }, vad, vitesses, memoireMo }`.
 */
export function etatWhisperCpp(config, pret = lirePret(chemins(config))) {
  const c = chemins(config);
  const w = pret?.whispercpp;
  const vide = { installe: false, binaire: null, modeles: {}, vad: null, vitesses: {}, memoireMo: {} };
  if (!w) return { ...vide, raison: 'whisper.cpp non installé (option : installer-transcription.sh --whispercpp)' };
  const desactive = desactivationWhisperCpp(config);
  if (desactive) return { ...vide, desactive, raison: `whisper.cpp désactivé : ${desactive.raison}` };
  try {
    if (w.binaire !== c.binaireWhisper) throw new Error('binaire');
    accessSync(c.binaireWhisper, constants.X_OK);
  } catch {
    return { ...vide, raison: 'whisper.cpp absent (relancer installer-transcription.sh --whispercpp)' };
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
  if (!Object.keys(modeles).length) return { ...vide, binaire: c.binaireWhisper, raison: 'aucun modèle GGML (relancer installer-transcription.sh --whispercpp)' };
  let vad = null;
  try {
    if (statSync(c.vad).size === VAD_SILERO.taille) vad = c.vad;
  } catch {
    vad = null;
  }
  return { installe: true, binaire: c.binaireWhisper, modeles, vad, vitesses: w.vitesses ?? {}, memoireMo: w.memoireMo ?? {} };
}

/** Ordre des moteurs selon TRANSCRIPTION_MOTEUR : auto → ONNX puis whisper.cpp ; onnx → ONNX ; whispercpp → whisper.cpp puis ONNX. */
export const ordreMoteurs = moteur => (moteur === 'onnx' ? ['onnx'] : moteur === 'whispercpp' ? ['whispercpp', 'onnx'] : ['onnx', 'whispercpp']);

/**
 * Qualités disponibles d'après les moteurs installés (pur, testable) : `{ rapide: { disponible, moteur, modele,
 * alternatives }, … }`. Pour chaque qualité, le premier moteur de l'ordre (`ordreMoteurs`) qui a le modèle de cette
 * qualité (TRANSCRIPTION_ONNX_* pour ONNX, TRANSCRIPTION_MODELE_* pour whisper.cpp) ; `alternatives` : l'autre
 * moteur s'il l'a aussi (bascule si le premier est arrêté de force). Ancienne installation ONNX sans modèle de
 * qualité (seulement « base ») : la qualité « équilibrée » l'utilise, comme avant.
 */
export function qualitesDisponibles(config, { whispercpp, onnx }) {
  const sortie = {};
  const ordre = ordreMoteurs(config.moteur).filter(m => (m === 'onnx' ? onnx?.installe : whispercpp?.installe));
  const modeleDe = (m, q) => (m === 'onnx' ? (onnx.modeles[config.modelesOnnx?.[q]] ? config.modelesOnnx[q] : null) : whispercpp.modeles[config.modelesQualite?.[q]] ? config.modelesQualite[q] : null);
  for (const q of QUALITES) {
    const possibles = ordre.map(m => ({ disponible: true, moteur: m, modele: modeleDe(m, q) })).filter(x => x.modele);
    if (possibles.length) sortie[q] = { ...possibles[0], alternatives: possibles.slice(1) };
    else sortie[q] = { disponible: false, moteur: ordre[0] ?? null, modele: null, alternatives: [] };
  }
  // Ancienne installation : un seul modèle ONNX (TRANSCRIPTION_MODELE, « base »), pour la qualité équilibrée.
  if (!QUALITES.some(q => sortie[q].disponible) && ordre.includes('onnx') && onnx.modeles[config.modele]) {
    sortie.equilibree = { disponible: true, moteur: 'onnx', modele: config.modele, alternatives: [] };
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
  for (const [m, v] of Object.entries(onnx.vitesses ?? {})) if (Number(v) > 0) vitesses[cleVitesse('onnx', m)] = Number(v);
  for (const [m, v] of Object.entries(whispercpp.vitesses ?? {})) if (Number(v) > 0) vitesses[cleVitesse('whispercpp', m)] = Number(v);
  const raison = installe ? undefined : config.moteur === 'whispercpp' ? (whispercpp.raison ?? onnx.raison) : (onnx.raison ?? whispercpp.raison);
  return { installe, ...(raison ? { raison } : {}), ffmpeg: Boolean(cheminFfmpeg(config)), whispercpp, onnx, qualites, vitesses };
}

/**
 * État pour l'Administration : moteur, qualités, whisper.cpp (désactivé ?), dernier passage du processus de fond et
 * dernière décision du cron. Lectures de fichiers seulement.
 */
export function etatAdministration(config) {
  const c = chemins(config);
  const e = etatInstallation(config);
  let dernierPassage = null;
  try {
    dernierPassage = readFileSync(c.dernierPassage, 'utf8').trim().slice(0, 40) || null;
  } catch {
    dernierPassage = null;
  }
  const l = lireJson(c.lanceur);
  return {
    disponible: e.installe,
    raison: e.raison ?? null,
    moteur: config.moteur ?? 'auto',
    qualites: Object.fromEntries(Object.entries(e.qualites).map(([q, x]) => [q, { disponible: x.disponible, moteur: x.moteur, modele: x.modele }])),
    whispercpp: { installe: Boolean(e.whispercpp.installe), desactive: e.whispercpp.desactive ?? null },
    dernierPassage,
    lanceur: l && typeof l.raison === 'string' ? { le: String(l.le ?? ''), raison: l.raison.slice(0, 120), ...(Number.isFinite(l.n) ? { n: l.n } : {}) } : null,
  };
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

/**
 * Transcripteur ONNX (dans le processus Node) pour le modèle `nom` : `{ moteur, cle, transcrireMorceau(pcm, options),
 * decodage, liberer() }`. `ort` injectable (tests : faux ONNX Runtime).
 */
export async function creerTranscripteurOnnx(config, { nom = config.modele, qualite = 'equilibree', ort = null, dossier = null } = {}) {
  const w = await chargerWhisper({ ort: ort ?? chargerOrt(config), dossier: dossier ?? chemins(config).onnx(nom), nom, threads: config.threads });
  const def = MODELES_ONNX_DEFS[nom];
  return {
    moteur: `${def?.nom ?? `Whisper ${nom}`} (serveur, ONNX)`,
    transcrireMorceau: w.transcrireMorceau,
    encoder: w.encoder,
    liberer: w.liberer,
    infos: w.infos,
    decodage: DECODAGE_QUALITE[qualite] ?? DECODAGE_QUALITE.equilibree,
    cle: `onnx:${nom}:${qualite}`,
    memoireMoPrevue: def?.memoireMo ?? 1500,
  };
}

/** Ancien nom : transcripteur ONNX du modèle `config.modele`. */
export const creerTranscripteurWhisper = config => creerTranscripteurOnnx(config, { nom: config.modele });

/**
 * Transcripteur pour un choix `{ qualite, moteur, modele }` (voir `qualiteEffective`) : ONNX dans le processus
 * (morceaux de 30 s, prompt de vocabulaire, beam search) ou whisper.cpp (blocs, binaire externe).
 */
export async function creerTranscripteur(config, choix, { surProcessus } = {}) {
  if (choix?.moteur === 'whispercpp') {
    const w = etatWhisperCpp(config);
    if (!w.installe || !w.modeles[choix.modele]) throw Object.assign(new Error(w.desactive ? `whisper.cpp désactivé : ${w.desactive.raison}` : `Modèle whisper.cpp « ${choix.modele} » absent : relancez installer-transcription.sh --whispercpp.`), { definitif: false });
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
  return creerTranscripteurOnnx(config, { nom: choix?.modele ?? config.modele, qualite: choix?.qualite ?? 'equilibree' });
}
