/**
 * Moteur de transcription du serveur : où il est installé, s'il est prêt, et son chargement.
 *
 * Tout vit HORS du dépôt et hors de public_html, dans TRANSCRIPTION_DOSSIER_MODELES
 * (par défaut ~/esport-modeles), installé une seule fois par esport/serveur/installer-transcription.sh :
 *
 *   ~/esport-modeles/
 *     moteur/            paquets npm du moteur : onnxruntime-node (calcul), ffmpeg-static (lecture audio)
 *     whisper-base/      modèle Whisper (base-encoder.int8.onnx, base-decoder.int8.onnx, base-tokens.txt)
 *     pret.json          écrit par l'installateur après un essai réussi (modèles prêts)
 *     travail/           fichiers audio temporaires des travaux en cours (effacés à la fin)
 *     travailleur.verrou un seul processus de transcription à la fois
 *
 * Le déploiement automatique (deployer.sh : git reset, npm install dans esport/) ne touche jamais à ce
 * dossier : le modèle n'est pas retéléchargé.
 */

import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chargerWhisper } from './whisper.mjs';

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
    travail: join(dossier, 'travail'),
    verrou: join(dossier, 'travailleur.verrou'),
  };
}

/**
 * Le moteur est-il installé et vérifié pour le modèle choisi ? Rapide (aucun chargement) : appelé au
 * démarrage du serveur et par le cron. Rend `{ installe, raison? }`.
 */
export function etatInstallation(config) {
  const c = chemins(config);
  if (!existsSync(join(c.moteur, 'node_modules', 'onnxruntime-node', 'package.json'))) return { installe: false, raison: 'moteur absent (lancer esport/serveur/installer-transcription.sh)' };
  for (const f of c.fichiersModele) if (!existsSync(f)) return { installe: false, raison: `modèle « ${config.modele} » absent (lancer installer-transcription.sh)` };
  let pret;
  try {
    pret = JSON.parse(readFileSync(c.pret, 'utf8'));
  } catch {
    return { installe: false, raison: 'installation pas vérifiée (relancer installer-transcription.sh)' };
  }
  if (!Array.isArray(pret?.modeles) || !pret.modeles.includes(config.modele)) return { installe: false, raison: `modèle « ${config.modele} » pas vérifié (relancer installer-transcription.sh)` };
  return { installe: true, ffmpeg: Boolean(cheminFfmpeg(config)) };
}

const requireMoteur = config => createRequire(join(chemins(config).moteur, 'package.json'));

/** onnxruntime-node, chargé depuis le dossier du moteur (jamais depuis esport/node_modules). */
export function chargerOrt(config) {
  return requireMoteur(config)('onnxruntime-node');
}

/** Chemin du binaire ffmpeg (paquet ffmpeg-static), ou null s'il manque ou ne s'exécute pas. */
export function cheminFfmpeg(config) {
  try {
    const p = requireMoteur(config)('ffmpeg-static');
    if (typeof p !== 'string' || !existsSync(p)) return null;
    accessSync(p, constants.X_OK);
    return p;
  } catch {
    return null;
  }
}

/** Transcripteur Whisper réel : `{ moteur, transcrireMorceau(pcm, { langue }), liberer() }`. */
export async function creerTranscripteurWhisper(config) {
  const w = await chargerWhisper({ ort: chargerOrt(config), dossier: chemins(config).modele, nom: config.modele, threads: config.threads });
  return { moteur: `Whisper ${config.modele} (serveur)`, transcrireMorceau: w.transcrireMorceau, liberer: w.liberer, infos: w.infos };
}
