/**
 * Installation de la transcription sur le serveur (lancé par esport/serveur/installer-transcription.sh, dans le
 * Terminal cPanel). Sans root, idempotent (relancer ne refait que ce qui manque), rien dans le dépôt :
 *
 *  1. vérifie la machine (Linux x64, glibc, AVX2, Node 22, git, tar) et l'espace disque ;
 *  2. ffmpeg (paquet npm ffmpeg-static, binaire autonome) et ONNX Runtime (moteur de REPLI), versions figées ;
 *  3. whisper.cpp v1.9.5 COMPILÉ sur le serveur depuis les sources du tag (git, commit vérifié) : avec le
 *     compilateur du système s'il est assez récent (GCC 10+, cmake 3.14+), sinon avec le GCC 14 figé de l'IA
 *     locale (micromamba + paquets conda-forge vérifiés par SHA-256, effacés ensuite) ; binaire autonome ;
 *     le modèle de détection de la parole (Silero VAD) est pris dans ces mêmes sources (SHA-256 vérifié) ;
 *  4. modèles GGML (Hugging Face ggerganov/whisper.cpp, révision précise) : SHA-256 publié par Hugging Face
 *     ET SHA-1 publié par whisper.cpp vérifiés ; large-v3-turbo q5_0 par défaut (qualité « équilibrée »),
 *     `--tous` pour les trois qualités ;
 *  5. --test : transcrit un court échantillon avec chaque modèle installé, affiche la vitesse (× temps réel),
 *     la mémoire et la durée estimée d'une heure de réunion par qualité ; mesures notées dans pret.json ;
 *  6. écrit pret.json et redémarre l'app Esport : « Transcription serveur prête ».
 *
 * Si whisper.cpp ne peut pas être compilé, le REPLI ONNX (Whisper base) est installé à la place (comme avant).
 *
 * Options : --tous | --modele <nom> (plusieurs fois), --test, --threads N, --dry-run, --forcer,
 * --route auto|systeme|compilation, --onnx (installe aussi le repli), --revision <commit HF>,
 * --dossier <chemin>, --sans-redemarrage, --aide.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, freemem, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chargerConfigEsport } from '../config.mjs';
import { MODELES_WHISPER_CPP, QUALITES } from '../../noyau/medias/fileTranscription.mjs';
import { auMoins, commandeDispo, drapeauxProcesseur, espaceLibre, fichiersModele, preparerCompilateur, remplacerRpath, sha256Fichier, telechargerVerifie, versionGlibc } from '../ia-locale/installer.mjs';
import { decoderVersPcm, dureePcm, fenetreSuivante, lirePcm } from './audio.mjs';
import { PAQUETS_MOTEUR, chemins, cheminFfmpeg, creerTranscripteurWhisper, dossierModelesParDefaut } from './moteur.mjs';
import { DEPOT_MODELES_GGML, MODELES_GGML, VAD_SILERO, WHISPER_CPP, creerTranscripteurWhisperCpp } from './whispercpp.mjs';

const DEPOT = fileURLToPath(new URL('../../..', import.meta.url));
const GO = 1024 ** 3;
const ok = m => console.log(`  ✔ ${m}`);
const info = m => console.log(`    ${m}`);
const titre = m => console.log(`\n▶ ${m}`);
class Arret extends Error {}
const arreter = m => {
  throw new Arret(m);
};
const go = n => `${(n / GO).toFixed(1).replace('.', ',')} Go`;

const AIDE = `Transcription sur le serveur : whisper.cpp + modèles GGML dans ~/esport-modeles.
  --tous                 installe les modèles des trois qualités (Rapide, Équilibrée, Maximale : ≈ 2,2 Go)
  --modele <nom>         installe aussi ce modèle (${MODELES_WHISPER_CPP.join(', ')})
  --test                 transcrit un court échantillon avec chaque modèle : vitesse (× temps réel), mémoire
  --threads N            fils de calcul de whisper.cpp (défaut : TRANSCRIPTION_THREADS_WHISPER, sinon 8)
  --dry-run              montre ce qui serait fait, sans rien télécharger ni compiler
  --forcer               refait tout (moteur et modèles)
  --route <r>            auto (défaut), systeme (compilateur du serveur) ou compilation (GCC 14 figé)
  --onnx                 installe aussi le moteur de repli ONNX (Whisper base)
  --revision <commit>    révision Hugging Face précise des modèles
  --dossier <chemin>     autre dossier (hors public_html)
  --sans-redemarrage     ne redémarre pas l'app Esport`;

export function lireOptions(argv) {
  const o = { forcer: false, redemarrer: true, test: false, dryRun: false, route: 'auto', modeles: [], tous: false, onnx: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const valeur = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) arreter(`Valeur manquante après ${a}.`);
      return v;
    };
    if (a === '--modele') o.modeles.push(valeur());
    else if (a === '--tous') o.tous = true;
    else if (a === '--dossier') o.dossier = valeur();
    else if (a === '--threads') o.threads = Number(valeur());
    else if (a === '--test') o.test = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--forcer') o.forcer = true;
    else if (a === '--route') o.route = valeur();
    else if (a === '--onnx') o.onnx = true;
    else if (a === '--revision') o.revision = valeur();
    else if (a === '--sans-redemarrage') o.redemarrer = false;
    else if (a === '--aide' || a === '--help' || a === '-h') o.aide = true;
    else arreter(`Option inconnue : ${a} (voir --aide).`);
  }
  // Anciennes options (moteur ONNX) : --modele tiny|base installe le repli avec ce modèle.
  const anciens = o.modeles.filter(m => ['tiny', 'base'].includes(m));
  if (anciens.length) {
    o.onnx = true;
    o.modeleOnnx = anciens[0];
    o.modeles = o.modeles.filter(m => !anciens.includes(m));
  }
  for (const m of o.modeles) if (!MODELES_GGML[m]) arreter(`Modèle inconnu : ${m} (${MODELES_WHISPER_CPP.join(', ')}).`);
  if (o.threads !== undefined && (!Number.isInteger(o.threads) || o.threads < 1 || o.threads > 32)) arreter('--threads : un nombre entier de 1 à 32.');
  if (!['auto', 'systeme', 'compilation'].includes(o.route)) arreter('--route : auto, systeme ou compilation.');
  if (o.revision !== undefined && !/^[0-9a-f]{40}$/.test(o.revision)) arreter('--revision : un identifiant de commit Hugging Face (40 caractères hexadécimaux).');
  return o;
}

/** Modèles à installer : celui de la qualité par défaut (les trois qualités avec --tous) + ceux de --modele. */
export function modelesAInstaller(config, o) {
  const qualites = o.tous ? QUALITES : [config.qualite];
  return [...new Set([...qualites.map(q => config.modelesQualite[q]), ...o.modeles])].filter(m => MODELES_GGML[m]);
}

/** Version d'un outil (« g++ (GCC) 8.5.0 » → [8, 5]), ou [0, 0]. */
function versionOutil(cmd, args = ['--version']) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 20_000 });
  if (r.status !== 0) return [0, 0];
  const m = /(\d+)\.(\d+)/.exec(`${r.stdout ?? ''}`);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

/** Le compilateur du système suffit-il (GCC 10+, cmake 3.14+) ? Sur CloudLinux 8 (GCC 8) : non. */
export function compilateurSystemeSuffit({ gxx = versionOutil('g++'), cmake = versionOutil('cmake') } = {}) {
  return auMoins(gxx, [10, 0]) && auMoins(cmake, [3, 14]);
}

function executer(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (r.status !== 0) arreter(`Commande en échec : ${[cmd, ...args].join(' ').slice(0, 300)} (code ${r.status ?? r.signal ?? r.error?.message}).`);
}

/** Le binaire démarre-t-il, et est-ce la version figée ? */
export function verifierWhisperCli(binaire) {
  if (!existsSync(binaire)) return { ok: false, message: 'absent' };
  const r = spawnSync(binaire, ['--version'], { encoding: 'utf8', timeout: 30_000, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } });
  const sortie = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) return { ok: false, message: (sortie.trim().split('\n').pop() || `code ${r.status ?? r.signal}`).slice(0, 300) };
  if (!sortie.includes(WHISPER_CPP.versionAffichee)) return { ok: false, message: `version inattendue : ${sortie.trim().slice(0, 200)}` };
  return { ok: true, message: sortie.trim().split('\n')[0] };
}

/** SHA-1 d'un fichier (empreinte publiée par whisper.cpp dans models/README.md). */
export async function sha1Fichier(chemin) {
  const h = createHash('sha1');
  await pipeline(createReadStream(chemin), h);
  return h.digest('hex');
}

// ------------------------------------------------------------------ whisper.cpp

async function compilerWhisperCpp(c, { route, threads, avx2 }) {
  if (!commandeDispo('git')) arreter('git est introuvable : il sert à récupérer les sources de whisper.cpp (o2switch le fournit normalement).');
  const o = c.outils;
  mkdirSync(o, { recursive: true });
  let envCompil = { ...process.env };
  let cmake = 'cmake';
  let envOutils = null;
  if (route === 'compilation') {
    const t = await preparerCompilateur(o);
    envCompil = t.envCompil;
    cmake = join(t.bin, 'cmake');
    envOutils = t.envOutils;
  } else ok('compilateur du système (GCC 10 ou plus, cmake 3.14 ou plus)');
  const src = join(o, 'whisper.cpp');
  const commit = () => spawnSync('git', ['-C', src, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim();
  if (!existsSync(join(src, '.git')) || commit() !== WHISPER_CPP.commit) {
    rmSync(src, { recursive: true, force: true });
    info(`sources de whisper.cpp ${WHISPER_CPP.version} (git)…`);
    executer('git', ['-c', 'advice.detachedHead=false', 'clone', '--quiet', '--depth', '1', '--branch', WHISPER_CPP.version, WHISPER_CPP.depotGit, src], { env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' } });
  }
  if (commit() !== WHISPER_CPP.commit) arreter(`Sources inattendues : commit ${commit()} au lieu de ${WHISPER_CPP.commit}.`);
  ok(`sources vérifiées (commit ${WHISPER_CPP.commit.slice(0, 12)})`);
  const build = join(o, 'build-whisper');
  rmSync(build, { recursive: true, force: true });
  const jeu = avx2 ? 'ON' : 'OFF';
  info(`compilation de whisper-cli (${threads} fils, priorité basse) : 2 à 10 minutes…`);
  executer(
    cmake,
    [
      '-S', src, '-B', build, '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF', '-DGGML_NATIVE=OFF', '-DGGML_AVX=ON',
      `-DGGML_AVX2=${jeu}`, `-DGGML_FMA=${jeu}`, `-DGGML_F16C=${jeu}`, `-DGGML_BMI2=${jeu}`, '-DGGML_OPENMP=OFF', '-DGGML_CCACHE=OFF',
      '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_BUILD_SERVER=OFF', '-DWHISPER_SDL2=OFF', '-DWHISPER_CURL=OFF',
      '-DCMAKE_EXE_LINKER_FLAGS=-static-libstdc++ -static-libgcc',
    ],
    { env: envCompil },
  );
  executer(cmake, ['--build', build, '--target', 'whisper-cli', '-j', String(threads)], { env: envCompil });
  mkdirSync(c.whispercpp, { recursive: true });
  const tmp = `${c.binaireWhisper}.nouveau`;
  copyFileSync(join(build, 'bin', 'whisper-cli'), tmp);
  chmodSync(tmp, 0o755);
  // Le GCC de conda-forge inscrit « -rpath <outils>/env/lib » (effacé ensuite) : remplacé sur place par $ORIGIN.
  if (envOutils) remplacerRpath(tmp, join(envOutils, 'lib'));
  renameSync(tmp, c.binaireWhisper);
  // Détection de la parole : le modèle Silero est dans ces sources (commit vérifié) ; empreinte vérifiée.
  mkdirSync(dirname(c.vad), { recursive: true });
  const vadSource = join(src, VAD_SILERO.source);
  if (!existsSync(vadSource) || (await sha256Fichier(vadSource)) !== VAD_SILERO.sha256) arreter('Modèle de détection de la parole (Silero VAD) absent ou modifié dans les sources de whisper.cpp.');
  copyFileSync(vadSource, c.vad);
  ok(`${VAD_SILERO.nom} installé (SHA-256 vérifié)`);
  // Échantillon de l'essai (--test) : samples/jfk.wav des sources (11 s, anglais).
  mkdirSync(c.essai, { recursive: true });
  if (existsSync(join(src, 'samples', 'jfk.wav'))) copyFileSync(join(src, 'samples', 'jfk.wav'), join(c.essai, 'jfk.wav'));
  return c.binaireWhisper;
}

// ------------------------------------------------------------------ Modèles GGML

/** Plan de téléchargement d'un modèle GGML (révision Hugging Face, taille, SHA-256 publié). */
async function planModele(nom, { revision } = {}) {
  const def = MODELES_GGML[nom];
  const echappe = def.fichier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const plan = await fichiersModele({ depot: DEPOT_MODELES_GGML, motif: new RegExp(`^${echappe}$`) }, { revision });
  return { ...plan.fichiers[0], revision: plan.revision };
}

async function installerModeleGgml(c, nom, plan) {
  const def = MODELES_GGML[nom];
  const dest = join(c.ggml, def.fichier);
  const r = await telechargerVerifie(plan.url, dest, { sha256: plan.sha256, taille: plan.taille });
  const sha1 = await sha1Fichier(dest);
  if (sha1 !== def.sha1) {
    rmSync(dest, { force: true });
    arreter(`${def.fichier} : empreinte SHA-1 ${sha1} différente de celle publiée par whisper.cpp (${def.sha1}) : fichier effacé.`);
  }
  ok(`${def.fichier} ${r.deja ? 'déjà présent et vérifié' : 'téléchargé et vérifié'} (SHA-256 Hugging Face + SHA-1 whisper.cpp)`);
  return { fichier: def.fichier, taille: plan.taille, sha256: plan.sha256, sha1, revision: plan.revision };
}

// ------------------------------------------------------------------ Moteur npm (ffmpeg, repli ONNX)

function installerMoteurNpm(c, forcer) {
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
    ok('ffmpeg et ONNX Runtime déjà installés');
    return true;
  }
  writeFileSync(fichier, `${JSON.stringify(voulu, null, 2)}\n`);
  const npm = join(dirname(process.execPath), 'npm');
  info('npm install (binaires précompilés, quelques minutes)…');
  const r = spawnSync(existsSync(npm) ? npm : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'], {
    cwd: c.moteur,
    stdio: 'inherit',
    env: { ...process.env, ONNXRUNTIME_NODE_INSTALL_CUDA: 'skip' },
  });
  if (r.status !== 0) {
    info('npm install a échoué : ffmpeg du système utilisé s’il existe (sinon seuls les WAV seront lus).');
    return false;
  }
  ok(`ffmpeg et ONNX Runtime installés dans ${c.moteur}`);
  return true;
}

/** Sources du modèle ONNX du repli (sherpa-onnx, Hugging Face), comme avant. */
export const sourcesModele = m => ({
  fichiers: [`${m}-encoder.int8.onnx`, `${m}-decoder.int8.onnx`, `${m}-tokens.txt`].map(f => ({ nom: f, url: `https://huggingface.co/csukuangfj/sherpa-onnx-whisper-${m}/resolve/main/${f}` })),
  essai: `https://huggingface.co/csukuangfj/sherpa-onnx-whisper-${m}/resolve/main/test_wavs/0.wav`,
});

async function telechargerSimple(url, destination) {
  const partiel = `${destination}.partiel`;
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(partiel));
  if (statSync(partiel).size < 1000) throw new Error('fichier trop petit');
  renameSync(partiel, destination);
}

async function installerRepliOnnx(c, config, forcer) {
  mkdirSync(c.modele, { recursive: true });
  const s = sourcesModele(config.modele);
  for (const f of s.fichiers) {
    const dest = join(c.modele, f.nom);
    if (!forcer && existsSync(dest)) continue;
    info(`téléchargement de ${f.nom}…`);
    await telechargerSimple(f.url, dest);
  }
  const essai = join(c.essai, 'essai.wav');
  mkdirSync(c.essai, { recursive: true });
  if (!existsSync(essai)) await telechargerSimple(s.essai, essai);
  const w = await creerTranscripteurWhisper(config);
  const pcm = join(c.essai, 'essai.pcm');
  await decoderVersPcm({ source: essai, sortie: pcm, ffmpeg: cheminFfmpeg(config), threads: 1 });
  const duree = dureePcm(pcm);
  const textes = [];
  for (let pos = 0; pos < duree - 0.05; ) {
    const f = fenetreSuivante(pcm, pos, duree);
    textes.push((await w.transcrireMorceau(lirePcm(pcm, f.debut, f.fin), { langue: 'en' })).texte);
    pos = f.fin;
  }
  await w.liberer();
  rmSync(pcm, { force: true });
  if (!/nightfall|yellow|lamps/i.test(textes.join(' '))) arreter('L’essai du repli ONNX n’a pas donné le texte attendu : relancez avec --forcer.');
  ok(`repli ONNX (Whisper ${config.modele}) installé et vérifié`);
}

// ------------------------------------------------------------------ Essai (--test)

/**
 * Essai d'un modèle : l'échantillon (11 s de parole) répété 3 fois avec 1 s de silence, transcrit avec prompt et
 * VAD comme en vrai. Vitesse = secondes de calcul par seconde d'audio ; « × temps réel » = l'inverse ; mémoire
 * maximale du moteur. Rend `{ vitesse, xTempsReel, memoireMo, texte, reussi, duree, calcul }`.
 */
export async function essaiModele({ binaire, fichierModele, nomModele, vad, threads, pcmEssai, dossierTravail, qualite = 'equilibree', maintenant = () => Date.now(), spawn }) {
  const morceau = lirePcm(pcmEssai, 0, dureePcm(pcmEssai));
  const silence = 16000;
  const echantillon = new Float32Array(morceau.length * 3 + silence * 2);
  for (let k = 0; k < 3; k++) echantillon.set(morceau, k * (morceau.length + silence));
  const duree = echantillon.length / 16000;
  const decodage = qualite === 'rapide' ? { beam: 1, bestOf: 2 } : { beam: 5, bestOf: 5 };
  const t = creerTranscripteurWhisperCpp({ binaire, fichierModele, nomModele, vad, threads, decodage, dossierTravail, ...(spawn ? { spawn } : {}) });
  const t0 = maintenant();
  const r = await t.transcrireBloc(echantillon, { langue: 'en', prompt: 'Esports team meeting. Players: Jett, Sova. Maps: Ascent, Bind.' });
  const calcul = Math.max(0.01, (maintenant() - t0) / 1000);
  const texte = r.segments.map(s => s[2]).join(' ');
  return { vitesse: calcul / duree, xTempsReel: duree / calcul, memoireMo: t.memoireMaxMo || null, texte, reussi: /what your country can do/i.test(texte), duree, calcul };
}

/** « 25 min » pour une heure de réunion, d'après la vitesse (secondes de calcul par seconde d'audio). */
export const dureeHeure = vitesse => `${Math.max(1, Math.round(vitesse * 60))} min`;

// ------------------------------------------------------------------ Programme

export async function principal(argv = process.argv.slice(2)) {
  const o = lireOptions(argv);
  if (o.aide) {
    console.log(AIDE);
    return;
  }
  console.log(`Transcription des réunions sur le serveur : ${o.dryRun ? 'SIMULATION (--dry-run : rien n’est téléchargé ni compilé)' : 'installation'}`);
  titre('1. Machine');
  const glibc = versionGlibc();
  const avx2 = drapeauxProcesseur().has('avx2');
  info(`${process.platform} ${process.arch}, Node ${process.versions.node}, glibc ${glibc?.join('.') ?? 'inconnue'}, ${cpus().length} cœurs visibles, AVX2 ${avx2 ? 'oui' : 'non'}, mémoire ${go(totalmem())} (libre ${go(freemem())})`);
  if (process.platform !== 'linux' || process.arch !== 'x64') arreter('Il faut un serveur Linux x64 (o2switch l’est).');
  if (Number(process.versions.node.split('.')[0]) < 22) arreter('Node 22 est nécessaire : lancez d’abord « source …/nodevenv/application-enzo/esport/22/bin/activate ».');
  if (!glibc || !auMoins(glibc, [2, 27])) arreter(`glibc ${glibc?.join('.') ?? 'inconnue'} : 2.27 au moins est nécessaire.`);
  if (!commandeDispo('tar')) arreter('La commande tar est introuvable.');
  ok('machine compatible (aucun droit administrateur nécessaire)');

  const env = chargerConfigEsport();
  const config = { ...env.transcriptionServeur };
  if (o.dossier) config.dossierModeles = resolve(o.dossier);
  if (!config.dossierModeles) config.dossierModeles = dossierModelesParDefaut();
  if (o.modeleOnnx) config.modele = o.modeleOnnx;
  const threads = o.threads ?? config.threadsWhisper;
  const c = chemins(config);
  if (/(^|\/)public_html(\/|$)/.test(c.dossier)) arreter('Le dossier des modèles ne doit pas être dans public_html.');
  const modeles = modelesAInstaller(config, o);
  let pret = {};
  try {
    pret = JSON.parse(readFileSync(c.pret, 'utf8'));
  } catch {
    pret = {};
  }
  const ecrirePret = () => writeFileSync(c.pret, `${JSON.stringify({ ...pret, version: 1 }, null, 2)}\n`);
  const w0 = pret.whispercpp ?? {};
  const moteurOk = !o.forcer && w0.binaire === c.binaireWhisper && w0.commit === WHISPER_CPP.commit && verifierWhisperCli(c.binaireWhisper).ok && existsSync(c.vad);
  const route = o.route === 'auto' ? (compilateurSystemeSuffit() ? 'systeme' : 'compilation') : o.route;

  titre('2. Plan et espace disque');
  const plans = {};
  for (const m of modeles) {
    try {
      plans[m] = await planModele(m, { revision: o.revision ?? (!o.forcer ? w0.modeles?.[m]?.revision : undefined) });
    } catch (e) {
      info(`liste des fichiers de ${m} indisponible pour l’instant (${e.message}) : taille estimée ${go(MODELES_GGML[m].tailleApprox)}`);
    }
  }
  const deja = m => Boolean(plans[m]) && existsSync(join(c.ggml, MODELES_GGML[m].fichier)) && statSync(join(c.ggml, MODELES_GGML[m].fichier)).size === plans[m].taille;
  const tailleModeles = modeles.reduce((s, m) => s + (deja(m) ? 0 : (plans[m]?.taille ?? MODELES_GGML[m].tailleApprox)), 0);
  const besoin = tailleModeles + (moteurOk ? 0 : route === 'compilation' ? 1.6 * GO : 0.4 * GO) + 0.3 * GO;
  const libre = espaceLibre(c.dossier);
  info(`dossier : ${c.dossier}`);
  info(`whisper.cpp ${WHISPER_CPP.version} : ${moteurOk ? 'déjà installé' : route === 'systeme' ? 'compilation avec le compilateur du système (2 à 10 min)' : 'compilation avec le GCC 14 figé, sans root (10 à 25 min)'}`);
  for (const m of modeles) info(`modèle ${m} : ${MODELES_GGML[m].fichier}${plans[m] ? ` (${go(plans[m].taille)}, SHA-256 ${plans[m].sha256.slice(0, 16)}…, révision ${plans[m].revision.slice(0, 12)})` : ''}${deja(m) ? ' — déjà là' : ''}`);
  info(`qualités : ${QUALITES.map(q => `${q} → ${config.modelesQualite[q]}${modeles.includes(config.modelesQualite[q]) || w0.modeles?.[config.modelesQualite[q]] ? '' : ' (pas installé : --tous)'}`).join(' ; ')}`);
  info(`espace nécessaire : environ ${go(besoin)} ; libre : ${libre === null ? 'inconnu' : go(libre)}`);
  if (libre !== null && libre < besoin) arreter(`Espace disque insuffisant : ${go(besoin)} nécessaires, ${go(libre)} libres.`);
  if (o.dryRun) {
    afficherFin({ config, threads, simulation: true });
    return;
  }
  mkdirSync(c.dossier, { recursive: true, mode: 0o700 });
  chmodSync(c.dossier, 0o700);
  for (const d of [c.ggml, c.whispercpp, c.travail, c.essai]) mkdirSync(d, { recursive: true });

  titre('3. ffmpeg (lecture des vidéos) et ONNX Runtime (repli)');
  installerMoteurNpm(c, o.forcer);
  const ffmpeg = cheminFfmpeg(config);
  if (ffmpeg) ok(`ffmpeg prêt (${ffmpeg.startsWith(c.moteur) ? 'paquet ffmpeg-static' : 'celui du système'}) : MP4, MOV, MKV, WebM, M4A, MP3, OGG, FLAC ; passe-haut et normalisation du volume`);
  else info('ffmpeg absent : seuls les fichiers WAV seront lus (prétraitement simple intégré).');

  titre(`4. whisper.cpp ${WHISPER_CPP.version}`);
  let whisperOk = moteurOk;
  if (moteurOk) ok(`déjà installé : ${c.binaireWhisper}`);
  else {
    try {
      await compilerWhisperCpp(c, { route, threads: Math.min(Math.max(2, threads), 16), avx2 });
      const v = verifierWhisperCli(c.binaireWhisper);
      if (!v.ok) arreter(`whisper-cli compilé ne démarre pas (${v.message}).`);
      ok(`moteur prêt (${route}) : ${v.message}`);
      whisperOk = true;
      pret.whispercpp = { ...(pret.whispercpp ?? {}), binaire: c.binaireWhisper, version: WHISPER_CPP.version, commit: WHISPER_CPP.commit, route, vad: { fichier: VAD_SILERO.fichier, sha256: VAD_SILERO.sha256 }, le: new Date().toISOString() };
      ecrirePret();
    } catch (e) {
      info(`whisper.cpp n’a pas pu être installé : ${e instanceof Arret ? e.message : (e?.message ?? e)}`);
      info('Repli : le moteur ONNX (Whisper base, qualité bien moindre) est installé à la place. Relancez plus tard (ou --route compilation).');
      o.onnx = true;
    } finally {
      rmSync(c.outils, { recursive: true, force: true });
    }
  }

  if (whisperOk) {
    titre('5. Modèles GGML');
    pret.whispercpp.modeles = { ...(pret.whispercpp.modeles ?? {}) };
    for (const m of modeles) {
      let plan = plans[m];
      if (!plan) {
        try {
          plan = await planModele(m, { revision: o.revision });
        } catch (e) {
          arreter(`Liste des fichiers de ${m} illisible (${e.message}) : vérifiez l’accès à huggingface.co puis relancez (le moteur, lui, est installé).`);
        }
      }
      pret.whispercpp.modeles[m] = await installerModeleGgml(c, m, plan);
      ecrirePret();
    }
  }

  if (o.onnx) {
    titre(`Repli ONNX (Whisper ${config.modele})`);
    await installerRepliOnnx(c, config, o.forcer);
    pret.modeles = [...new Set([...(pret.modeles ?? []), config.modele])];
    ecrirePret();
  }

  if (o.test && whisperOk) {
    titre('6. Essai (--test) : vitesse et mémoire de chaque modèle');
    const source = join(c.essai, 'jfk.wav');
    if (!existsSync(source)) info('échantillon absent (essai/jfk.wav) : relancez avec --forcer pour le récupérer avec les sources.');
    else {
      const pcm = join(c.essai, 'jfk.pcm');
      await decoderVersPcm({ source, sortie: pcm, ffmpeg, threads: 1 });
      pret.whispercpp.vitesses = { ...(pret.whispercpp.vitesses ?? {}) };
      pret.whispercpp.memoireMo = { ...(pret.whispercpp.memoireMo ?? {}) };
      for (const m of Object.keys(pret.whispercpp.modeles)) {
        const fichierModele = join(c.ggml, MODELES_GGML[m].fichier);
        if (!existsSync(fichierModele)) continue;
        const q = QUALITES.find(x => config.modelesQualite[x] === m) ?? 'equilibree';
        info(`${m} (${threads} fils)…`);
        const r = await essaiModele({ binaire: c.binaireWhisper, fichierModele, nomModele: m, vad: c.vad, threads, pcmEssai: pcm, dossierTravail: c.travail, qualite: q });
        (r.reussi ? ok : info)(`${m} : ${r.reussi ? 'réussi' : 'TEXTE INATTENDU'} — ${r.duree.toFixed(0)} s d’audio en ${r.calcul.toFixed(1)} s, soit × ${r.xTempsReel.toFixed(1)} temps réel ; mémoire ${r.memoireMo ? `${(r.memoireMo / 1024).toFixed(1).replace('.', ',')} Go` : 'inconnue'} ; 1 h de réunion ≈ ${dureeHeure(r.vitesse)}`);
        info(`texte : « ${r.texte.slice(0, 160)} »`);
        pret.whispercpp.vitesses[m] = Math.round(r.vitesse * 1000) / 1000;
        if (r.memoireMo) pret.whispercpp.memoireMo[m] = r.memoireMo;
      }
      rmSync(pcm, { force: true });
      ecrirePret();
      console.log('\nEstimation par qualité (pauses de ménagement du serveur comprises) :');
      for (const q of QUALITES) {
        const m = config.modelesQualite[q];
        const v = pret.whispercpp.vitesses[m];
        info(`${q} (${m}) : ${v ? `1 h de réunion ≈ ${dureeHeure(v * (1 + config.repos))}` : 'modèle pas installé (--tous)'}`);
      }
      const ia = env.iaLocale?.installation?.installe;
      info(`relecture par l’IA locale : ${ia ? 'active (IA locale installée) : environ 10 à 40 min de plus par heure de réunion' : 'inactive (IA locale non installée : installer-ia-locale.sh)'}`);
    }
  } else if (!o.test) info('Pour mesurer la vitesse sur ce serveur : relancez avec --test (quelques minutes).');

  mkdirSync(c.travail, { recursive: true });
  titre('Mise en service');
  if (o.redemarrer) {
    mkdirSync(join(DEPOT, 'esport', 'tmp'), { recursive: true });
    writeFileSync(join(DEPOT, 'esport', 'tmp', 'restart.txt'), new Date().toISOString());
    ok('app Esport redémarrée (qualités proposées dans l’app : Rapide, Équilibrée, Maximale)');
  }
  afficherFin({ config, threads });
  console.log('\nTranscription serveur prête\n');
}

function afficherFin({ config, threads, simulation = false }) {
  titre(simulation ? 'Lignes qui seraient à ajouter' : 'Réglages conseillés');
  console.log('\n  Dans ~/.appdashboard/esport.env (valeurs conseillées sur o2switch) :\n');
  console.log(`TRANSCRIPTION_THREADS_WHISPER=${threads}`);
  console.log('TRANSCRIPTION_RAM_COMPTE=48G');
  if (config.dossierModeles !== dossierModelesParDefaut()) console.log(`TRANSCRIPTION_DOSSIER_MODELES=${config.dossierModeles}`);
  console.log('\n  puis : mkdir -p ~/application-enzo/esport/tmp && touch ~/application-enzo/esport/tmp/restart.txt');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  principal().catch(e => {
    console.error(`\n✖ ${e instanceof Arret ? e.message : (e?.stack ?? String(e))}\n`);
    process.exit(1);
  });
}
