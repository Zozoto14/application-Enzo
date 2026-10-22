/**
 * Installation de la transcription sur le serveur (lancé par esport/serveur/installer-transcription.sh,
 * UNE FOIS, dans le Terminal cPanel). Sans root, sans compilation :
 *
 *  1. vérifie la machine (Linux x64, glibc 2.28 ou plus, Node 22) ;
 *  2. installe le moteur dans <dossier>/moteur (npm : onnxruntime-node et ffmpeg-static, versions
 *     figées, binaires précompilés ; rien dans le dépôt ni dans esport/node_modules) ;
 *  3. télécharge le modèle Whisper choisi (int8) depuis Hugging Face, sinon depuis GitHub (archive) ;
 *  4. fait un court essai de transcription (enregistrement d'exemple en anglais) et mesure la vitesse ;
 *  5. écrit <dossier>/pret.json et redémarre l'app Esport : « Transcription serveur prête ».
 *
 * Relancer ne retélécharge rien de ce qui est déjà là (sauf --forcer).
 *
 * Options : --modele tiny|base|small, --dossier <chemin>, --threads 1|2, --forcer, --sans-redemarrage.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { cpus, freemem, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chargerConfigEsport } from '../config.mjs';
import { MODELES_SERVEUR } from '../../noyau/medias/fileTranscription.mjs';
import { decoderVersPcm, dureePcm, fenetreSuivante, lirePcm } from './audio.mjs';
import { PAQUETS_MOTEUR, chemins, cheminFfmpeg, creerTranscripteurWhisper, dossierModelesParDefaut } from './moteur.mjs';

const DEPOT = fileURLToPath(new URL('../../..', import.meta.url));
const ok = m => console.log(`  ✔ ${m}`);
const info = m => console.log(`    ${m}`);
const titre = m => console.log(`\n▶ ${m}`);
function arreter(m) {
  console.error(`\n✖ ${m}\n`);
  process.exit(1);
}

function lireOptions(argv) {
  const o = { forcer: false, redemarrer: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--modele') o.modele = argv[++i];
    else if (a === '--dossier') o.dossier = argv[++i];
    else if (a === '--threads') o.threads = Number(argv[++i]);
    else if (a === '--forcer') o.forcer = true;
    else if (a === '--sans-redemarrage') o.redemarrer = false;
    else arreter(`Option inconnue : ${a}`);
  }
  return o;
}

/** Sources du modèle : fichiers un par un (Hugging Face), sinon archive GitHub du projet sherpa-onnx. */
export const sourcesModele = m => ({
  fichiers: [`${m}-encoder.int8.onnx`, `${m}-decoder.int8.onnx`, `${m}-tokens.txt`].map(f => ({ nom: f, url: `https://huggingface.co/csukuangfj/sherpa-onnx-whisper-${m}/resolve/main/${f}` })),
  essai: `https://huggingface.co/csukuangfj/sherpa-onnx-whisper-${m}/resolve/main/test_wavs/0.wav`,
  archive: `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-${m}.tar.bz2`,
});

async function telecharger(url, destination, { min = 1000 } = {}) {
  const partiel = `${destination}.partiel`;
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  const total = Number(r.headers.get('content-length')) || 0;
  let recu = 0;
  let palier = 0;
  const flux = Readable.fromWeb(r.body);
  flux.on('data', m => {
    recu += m.length;
    if (total && recu / total >= palier + 0.2) {
      palier = Math.floor((recu / total) * 5) / 5;
      info(`${Math.round((recu / total) * 100)} % de ${Math.round(total / 1e6)} Mo`);
    }
  });
  await pipeline(flux, createWriteStream(partiel));
  if (statSync(partiel).size < min) throw new Error('fichier trop petit');
  renameSync(partiel, destination);
}

async function installerModele(c, m, forcer) {
  mkdirSync(c.modele, { recursive: true });
  const essai = join(c.dossier, 'essai', 'essai.wav');
  mkdirSync(dirname(essai), { recursive: true });
  const manquants = () => c.fichiersModele.filter(f => forcer || !existsSync(f));
  if (!manquants().length && existsSync(essai)) {
    ok(`modèle Whisper « ${m} » déjà présent (rien à télécharger)`);
    return;
  }
  const s = sourcesModele(m);
  try {
    for (const f of s.fichiers) {
      const dest = join(c.modele, f.nom);
      if (!forcer && existsSync(dest)) continue;
      info(`téléchargement de ${f.nom} (Hugging Face)…`);
      await telecharger(f.url, dest);
    }
    if (!existsSync(essai)) await telecharger(s.essai, essai);
    ok(`modèle « ${m} » téléchargé depuis Hugging Face`);
    return;
  } catch (e) {
    info(`Hugging Face indisponible (${e.message}) : archive GitHub à la place.`);
  }
  const archive = join(c.dossier, `whisper-${m}.tar.bz2`);
  info(`téléchargement de l'archive GitHub (plus grosse : elle contient aussi la version non compressée)…`);
  await telecharger(s.archive, archive, { min: 1_000_000 });
  const tmp = join(c.dossier, `extraction-${m}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const r = spawnSync('tar', ['-xjf', archive, '-C', tmp, '--wildcards', '*int8.onnx', '*tokens.txt', '*test_wavs/0.wav'], { stdio: 'inherit' });
  if (r.status !== 0) arreter('Extraction de l’archive impossible (commande tar avec bzip2).');
  const racine = join(tmp, `sherpa-onnx-whisper-${m}`);
  for (const f of readdirSync(racine)) if (/int8\.onnx$|tokens\.txt$/.test(f)) renameSync(join(racine, f), join(c.modele, f));
  if (existsSync(join(racine, 'test_wavs', '0.wav'))) copyFileSync(join(racine, 'test_wavs', '0.wav'), essai);
  rmSync(tmp, { recursive: true, force: true });
  rmSync(archive, { force: true });
  if (manquants().length) arreter(`Modèle incomplet après extraction : ${manquants().join(', ')}`);
  ok(`modèle « ${m} » téléchargé depuis GitHub`);
}

function installerMoteur(c, forcer) {
  mkdirSync(c.moteur, { recursive: true });
  const voulu = { name: 'esport-transcription-moteur', private: true, description: 'Moteur de transcription du serveur Esport (installé par installer-transcription.sh)', dependencies: PAQUETS_MOTEUR };
  const fichier = join(c.moteur, 'package.json');
  const deja = existsSync(fichier) ? readFileSync(fichier, 'utf8') : '';
  const installe = Object.entries(PAQUETS_MOTEUR).every(([p, v]) => {
    try {
      return JSON.parse(readFileSync(join(c.moteur, 'node_modules', p, 'package.json'), 'utf8')).version === v;
    } catch {
      return false;
    }
  });
  if (!forcer && installe && deja === `${JSON.stringify(voulu, null, 2)}\n`) {
    ok('moteur déjà installé (onnxruntime-node, ffmpeg-static)');
    return;
  }
  writeFileSync(fichier, `${JSON.stringify(voulu, null, 2)}\n`);
  const npm = join(dirname(process.execPath), 'npm');
  info('npm install (binaires précompilés, quelques minutes)…');
  const r = spawnSync(existsSync(npm) ? npm : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'], {
    cwd: c.moteur,
    stdio: 'inherit',
    // Pas de binaires pour carte graphique NVIDIA (inutiles ici, plusieurs centaines de Mo).
    env: { ...process.env, ONNXRUNTIME_NODE_INSTALL_CUDA: 'skip' },
  });
  if (r.status !== 0) arreter('npm install du moteur a échoué (voir les messages ci-dessus).');
  ok(`moteur installé dans ${c.moteur}`);
}

async function essayer(config, c) {
  const essai = join(c.dossier, 'essai', 'essai.wav');
  const ffmpeg = cheminFfmpeg(config);
  if (ffmpeg) ok('ffmpeg prêt (lecture des vidéos MP4, MOV, MKV, WebM et des audios M4A, MP3, OGG, FLAC)');
  else info('ffmpeg absent : seuls les fichiers WAV seront lus (relancez avec --forcer pour réessayer).');
  const pcm = join(c.dossier, 'essai', 'essai.pcm');
  await decoderVersPcm({ source: essai, sortie: pcm, ffmpeg, threads: 1 });
  const duree = dureePcm(pcm);
  const t0 = Date.now();
  const w = await creerTranscripteurWhisper(config);
  const chargement = (Date.now() - t0) / 1000;
  const t1 = Date.now();
  const textes = [];
  for (let pos = 0; pos < duree - 0.05; ) {
    const f = fenetreSuivante(pcm, pos, duree);
    textes.push((await w.transcrireMorceau(lirePcm(pcm, f.debut, f.fin), { langue: 'en' })).texte);
    pos = f.fin;
  }
  const calcul = (Date.now() - t1) / 1000;
  await w.liberer();
  rmSync(pcm, { force: true });
  const texte = textes.join(' ').trim();
  info(`texte obtenu : « ${texte} »`);
  if (!/nightfall|yellow|lamps/i.test(texte)) arreter('L’essai de transcription n’a pas donné le texte attendu : relancez avec --forcer (modèle peut-être abîmé).');
  // L'exemple (quelques secondes) est complété en un morceau de 30 s, comme un vrai morceau de réunion,
  // mais un vrai morceau contient bien plus de paroles à écrire : environ 2,5 fois plus de calcul.
  const vitesse = (calcul * 2.5) / Math.max(30, duree);
  ok(`essai réussi : ${duree.toFixed(1)} s d’audio en ${calcul.toFixed(1)} s (chargement du modèle : ${chargement.toFixed(1)} s)`);
  return { vitesse, memoire: process.memoryUsage().rss };
}

async function principal() {
  const o = lireOptions(process.argv.slice(2));
  console.log('Transcription des réunions sur le serveur : installation');
  titre('1. Vérification de la machine');
  const glibc = process.report?.getReport?.().header?.glibcVersionRuntime ?? null;
  info(`système : ${process.platform} ${process.arch}, Node ${process.versions.node}, glibc ${glibc ?? 'inconnue'}, ${cpus().length} processeur(s), mémoire ${Math.round(totalmem() / 1e9)} Go (libre : ${Math.round(freemem() / 1e9)} Go)`);
  if (process.platform !== 'linux' || process.arch !== 'x64') arreter('Il faut un serveur Linux x64 (o2switch l’est).');
  if (Number(process.versions.node.split('.')[0]) < 22) arreter('Node 22 est nécessaire : lancez d’abord « source …/nodevenv/application-enzo/esport/22/bin/activate ».');
  if (glibc) {
    const [a, b] = glibc.split('.').map(Number);
    if (a < 2 || (a === 2 && b < 28)) arreter(`glibc ${glibc} trop ancienne (2.28 au moins pour ONNX Runtime).`);
  }
  ok('machine compatible (aucune compilation, aucun droit administrateur nécessaire)');

  const env = chargerConfigEsport();
  const config = { ...env.transcriptionServeur };
  if (o.modele) {
    if (!MODELES_SERVEUR.includes(o.modele)) arreter(`Modèle inconnu : ${o.modele} (tiny, base ou small).`);
    config.modele = o.modele;
  }
  if (o.dossier) config.dossierModeles = o.dossier;
  if (!config.dossierModeles) config.dossierModeles = dossierModelesParDefaut();
  if (o.threads) config.threads = Math.max(1, Math.min(4, o.threads));
  const c = chemins(config);
  if (c.dossier.includes('public_html')) arreter('Le dossier des modèles ne doit pas être dans public_html.');
  mkdirSync(c.dossier, { recursive: true });
  chmodSync(c.dossier, 0o700);
  info(`dossier : ${c.dossier} ; modèle : ${config.modele} ; fils de calcul : ${config.threads}`);

  titre('2. Moteur (ONNX Runtime + ffmpeg)');
  installerMoteur(c, o.forcer);

  titre(`3. Modèle Whisper « ${config.modele} »`);
  await installerModele(c, config.modele, o.forcer);

  titre('4. Essai de transcription');
  const essai = await essayer(config, c);
  const parHeure = (essai.vitesse * 3600 * (1 + config.repos)) / 60;
  info(`estimation : environ ${Math.round(parHeure)} min de calcul pour 1 h de réunion (avec les pauses de ménagement du serveur)`);

  let pret = {};
  try {
    pret = JSON.parse(readFileSync(c.pret, 'utf8'));
  } catch {
    pret = {};
  }
  const modeles = [...new Set([...(pret.modeles ?? []), config.modele])];
  writeFileSync(c.pret, `${JSON.stringify({ version: 1, modeles, le: new Date().toISOString(), vitesse: { ...(pret.vitesse ?? {}), [config.modele]: Number(essai.vitesse.toFixed(3)) }, threads: config.threads }, null, 2)}\n`);
  mkdirSync(c.travail, { recursive: true });

  titre('5. Mise en service');
  if (o.redemarrer) {
    mkdirSync(join(DEPOT, 'esport', 'tmp'), { recursive: true });
    writeFileSync(join(DEPOT, 'esport', 'tmp', 'restart.txt'), new Date().toISOString());
    ok('app Esport redémarrée (elle propose maintenant « Serveur (automatique) »)');
  }
  if (env.transcriptionServeur.modele !== config.modele) info(`Pensez à mettre TRANSCRIPTION_MODELE=${config.modele} dans ~/.appdashboard/esport.env.`);
  console.log('\nTranscription serveur prête\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  principal().catch(e => arreter(e?.stack ?? String(e)));
}
