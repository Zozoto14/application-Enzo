/**
 * Installation de la transcription sur le serveur (lancé par esport/serveur/installer-transcription.sh, dans le
 * Terminal cPanel). Sans root, idempotent (relancer ne refait que ce qui manque), rien dans le dépôt :
 *
 *  1. vérifie la machine (Linux x64, glibc, Node 22) et l'espace disque ;
 *  2. ONNX Runtime pour Node (calcul DANS le processus Node : moteur par défaut) et ffmpeg (paquet npm
 *     ffmpeg-static, lecture des vidéos), versions figées ;
 *  3. modèles Whisper ONNX int8 (exports sherpa-onnx, Hugging Face csukuangfj/sherpa-onnx-whisper-<nom>, révision
 *     précise) : SHA-256 publiés par Hugging Face vérifiés (empreinte git pour les petits fichiers non-LFS) ;
 *     large-v3-turbo par défaut (qualité « équilibrée »), `--tous` pour small (Rapide) et large-v3 (Maximale) ;
 *  4. --test : transcrit un court échantillon DANS ce processus avec chaque modèle installé (comme le fera le
 *     processus de fond), affiche la vitesse (× temps réel), la mémoire du processus et la durée estimée d'une heure
 *     de réunion par qualité ; mesures notées dans pret.json (estimations de l'app) ;
 *  5. écrit pret.json et redémarre l'app Esport : « Transcription serveur prête ».
 *
 * whisper.cpp (binaire externe compilé sur le serveur) n'est installé qu'avec `--whispercpp` : l'hébergeur (o2switch)
 * arrête de force les binaires de calcul externes (SIGKILL) ; s'il l'est, le processus de fond bascule tout seul sur
 * ONNX et le désactive.
 *
 * Options : --tous | --modele <nom> (plusieurs fois), --test, --threads N, --dry-run, --forcer, --whispercpp,
 * --route auto|systeme|compilation, --revision <commit HF>, --dossier <chemin>, --sans-redemarrage, --aide.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, freemem, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chargerConfigEsport } from '../config.mjs';
import { DECODAGE_QUALITE, MODELES_ONNX, MODELES_WHISPER_CPP, QUALITES } from '../../noyau/medias/fileTranscription.mjs';
import { auMoins, commandeDispo, drapeauxProcesseur, espaceLibre, fichiersModele, preparerCompilateur, remplacerRpath, sha256Fichier, telechargerVerifie, versionGlibc } from '../ia-locale/installer.mjs';
import { decoderVersPcm, dureePcm, lirePcm } from './audio.mjs';
import { MODELES_ONNX_DEFS, PAQUETS_MOTEUR, chemins, cheminFfmpeg, creerTranscripteurOnnx, dossierModelesParDefaut, fichiersOnnx } from './moteur.mjs';
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

const AIDE = `Transcription sur le serveur : Whisper ONNX dans le processus Node + modèles dans ~/esport-modeles.
  --tous                 installe les modèles des trois qualités (Rapide small, Équilibrée large-v3-turbo,
                         Maximale large-v3 : ≈ 3,2 Go)
  --modele <nom>         installe aussi ce modèle ONNX (${MODELES_ONNX.join(', ')}) ou whisper.cpp
                         (${MODELES_WHISPER_CPP.join(', ')} : implique --whispercpp)
  --test                 transcrit un court échantillon avec chaque modèle : vitesse (× temps réel), mémoire
  --threads N            fils de calcul (défaut : TRANSCRIPTION_THREADS, sinon 4)
  --dry-run              montre ce qui serait fait, sans rien télécharger ni compiler
  --forcer               refait tout (moteur et modèles)
  --whispercpp           installe AUSSI whisper.cpp (binaire externe, option : souvent arrêté par l'hébergeur)
  --route <r>            (whisper.cpp) auto, systeme (compilateur du serveur) ou compilation (GCC 14 figé)
  --revision <commit>    révision Hugging Face précise des modèles
  --dossier <chemin>     autre dossier (hors public_html)
  --sans-redemarrage     ne redémarre pas l'app Esport`;

export function lireOptions(argv) {
  const o = { forcer: false, redemarrer: true, test: false, dryRun: false, route: 'auto', modeles: [], modelesGgml: [], tous: false, whispercpp: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const valeur = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) arreter(`Valeur manquante après ${a}.`);
      return v;
    };
    if (a === '--modele') {
      const m = valeur();
      if (MODELES_ONNX_DEFS[m]) o.modeles.push(m);
      else if (MODELES_GGML[m]) {
        o.modelesGgml.push(m);
        o.whispercpp = true;
      } else arreter(`Modèle inconnu : ${m} (ONNX : ${MODELES_ONNX.join(', ')} ; whisper.cpp : ${MODELES_WHISPER_CPP.join(', ')}).`);
    } else if (a === '--tous') o.tous = true;
    else if (a === '--dossier') o.dossier = valeur();
    else if (a === '--threads') o.threads = Number(valeur());
    else if (a === '--test') o.test = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--forcer') o.forcer = true;
    else if (a === '--whispercpp') o.whispercpp = true;
    else if (a === '--route') o.route = valeur();
    else if (a === '--onnx') o.onnx = true; // Ancienne option : ONNX est désormais le moteur par défaut.
    else if (a === '--revision') o.revision = valeur();
    else if (a === '--sans-redemarrage') o.redemarrer = false;
    else if (a === '--aide' || a === '--help' || a === '-h') o.aide = true;
    else arreter(`Option inconnue : ${a} (voir --aide).`);
  }
  if (o.threads !== undefined && (!Number.isInteger(o.threads) || o.threads < 1 || o.threads > 32)) arreter('--threads : un nombre entier de 1 à 32.');
  if (!['auto', 'systeme', 'compilation'].includes(o.route)) arreter('--route : auto, systeme ou compilation.');
  if (o.revision !== undefined && !/^[0-9a-f]{40}$/.test(o.revision)) arreter('--revision : un identifiant de commit Hugging Face (40 caractères hexadécimaux).');
  return o;
}

/** Modèles ONNX à installer : celui de la qualité par défaut (les trois qualités avec --tous) + ceux de --modele. */
export function modelesAInstaller(config, o) {
  const qualites = o.tous ? QUALITES : [config.qualite];
  return [...new Set([...qualites.map(q => config.modelesOnnx[q]), ...o.modeles])].filter(m => MODELES_ONNX_DEFS[m]);
}

/** Modèles whisper.cpp à installer (avec --whispercpp seulement). */
export function modelesGgmlAInstaller(config, o) {
  if (!o.whispercpp) return [];
  const qualites = o.tous ? QUALITES : [config.qualite];
  return [...new Set([...qualites.map(q => config.modelesQualite[q]), ...o.modelesGgml])].filter(m => MODELES_GGML[m]);
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


// ------------------------------------------------------------------ Modèles ONNX (moteur par défaut)

/** Empreinte git d'un fichier (« blob ») : celle que Hugging Face publie pour les petits fichiers hors LFS. */
export function sha1Git(octets) {
  return createHash('sha1').update(`blob ${octets.length}\0`).update(octets).digest('hex');
}

/**
 * Fichiers d'un modèle ONNX dans la liste de Hugging Face (`/api/models/<dépôt>/tree/<révision>`) : encodeur,
 * décodeur (int8, et leur fichier de poids `.weights` s'il y en a), jetons, et l'échantillon d'essai
 * test_wavs/0.wav. Chaque fichier a soit un SHA-256 (LFS), soit une empreinte git (petit fichier). Pur, testable.
 */
export function planDepuisArbre(liste, { nom, depot, revision }) {
  const motif = new RegExp(`^(${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(encoder|decoder)\\.int8\\.(onnx|weights)|${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-tokens\\.txt|test_wavs/0\\.wav)$`);
  const fichiers = [];
  for (const x of Array.isArray(liste) ? liste : []) {
    if (x?.type !== 'file' || !motif.test(String(x.path ?? ''))) continue;
    // Fichier LFS sans SHA-256 lisible : jamais téléchargé (l'empreinte git ne serait que celle du pointeur).
    if (x.lfs && !/^[0-9a-f]{64}$/.test(String(x.lfs.oid ?? ''))) continue;
    const lfs = x.lfs ?? null;
    const taille = lfs ? lfs.size : x.size;
    if (!Number.isSafeInteger(taille)) continue;
    if (!lfs && !/^[0-9a-f]{40}$/.test(String(x.oid ?? ''))) continue;
    fichiers.push({ nom: x.path, taille, ...(lfs ? { sha256: lfs.oid } : { sha1Git: x.oid }), url: `https://huggingface.co/${depot}/resolve/${revision}/${x.path.split('/').map(encodeURIComponent).join('/')}` });
  }
  fichiers.sort((a, b) => a.nom.localeCompare(b.nom));
  for (const f of fichiersOnnx(nom)) if (!fichiers.some(x => x.nom === f)) throw new Error(`${f} absent du dépôt ${depot} (révision ${revision.slice(0, 12)})`);
  return { revision, fichiers };
}

/** Plan de téléchargement d'un modèle ONNX : révision (la plus récente, ou celle demandée), fichiers, tailles, empreintes. */
export async function planOnnx(nom, { revision, fetch: f = globalThis.fetch } = {}) {
  const def = MODELES_ONNX_DEFS[nom];
  let rev = revision;
  if (!rev) {
    const r = await f(`https://huggingface.co/api/models/${def.depot}/revision/main`, { redirect: 'follow' });
    if (!r.ok) throw new Error(`Hugging Face : HTTP ${r.status}`);
    rev = (await r.json())?.sha;
  }
  if (!/^[0-9a-f]{40}$/.test(String(rev))) throw new Error('Hugging Face : révision illisible');
  const liste = [];
  for (const sous of ['', '/test_wavs']) {
    const r = await f(`https://huggingface.co/api/models/${def.depot}/tree/${rev}${sous}`, { redirect: 'follow' });
    if (!r.ok) {
      if (sous) continue;
      throw new Error(`Hugging Face : HTTP ${r.status}`);
    }
    liste.push(...((await r.json()) ?? []));
  }
  return planDepuisArbre(liste, { nom, depot: def.depot, revision: rev });
}

/** Petit fichier hors LFS : téléchargé puis comparé à son empreinte git. */
async function telechargerPetit(url, destination, { sha1: attendu, taille }) {
  if (existsSync(destination) && statSync(destination).size === taille && sha1Git(readFileSync(destination)) === attendu) return { deja: true };
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status} pour ${url}`);
  const octets = Buffer.from(await r.arrayBuffer());
  if (octets.length !== taille || sha1Git(octets) !== attendu) throw new Error(`${url} : empreinte différente de celle publiée (fichier refusé).`);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(`${destination}.partiel`, octets);
  renameSync(`${destination}.partiel`, destination);
  return { deja: false };
}

async function installerModeleOnnx(c, nom, plan) {
  const dossier = c.onnx(nom);
  mkdirSync(dossier, { recursive: true });
  const fichiers = [];
  for (const f of plan.fichiers) {
    const essai = f.nom.startsWith('test_wavs/');
    const dest = essai ? join(c.essai, `${nom}-0.wav`) : join(dossier, f.nom);
    const r = f.sha256 ? await telechargerVerifie(f.url, dest, { sha256: f.sha256, taille: f.taille }) : await telechargerPetit(f.url, dest, { sha1: f.sha1Git, taille: f.taille });
    if (!essai) {
      fichiers.push({ nom: f.nom, taille: f.taille, ...(f.sha256 ? { sha256: f.sha256 } : { sha1Git: f.sha1Git }) });
      ok(`${f.nom} ${r.deja ? 'déjà présent et vérifié' : 'téléchargé et vérifié'} (${f.sha256 ? 'SHA-256' : 'empreinte git'} publiée par Hugging Face)`);
    }
  }
  return { depot: MODELES_ONNX_DEFS[nom].depot, revision: plan.revision, fichiers, le: new Date().toISOString() };
}

// ------------------------------------------------------------------ Essai (--test)

const ECHANTILLON_PROMPT = 'Esports team meeting. Players: Jett, Sova. Maps: Ascent, Bind.';

/** L'échantillon (quelques secondes de parole) répété 3 fois avec 1 s de silence : ≈ 20 à 30 s, comme un vrai morceau. */
function echantillonRepete(pcmEssai, maxS = 29) {
  const morceau = lirePcm(pcmEssai, 0, Math.min(dureePcm(pcmEssai), (maxS - 2) / 3));
  const silence = 16000;
  const e = new Float32Array(morceau.length * 3 + silence * 2);
  for (let k = 0; k < 3; k++) e.set(morceau, k * (morceau.length + silence));
  return e;
}

/**
 * Essai d'un modèle ONNX DANS CE PROCESSUS (comme le processus de fond) : chargement, puis l'échantillon transcrit
 * avec prompt et décodage de la qualité. Vitesse = secondes de calcul par seconde d'audio ; mémoire = pic du
 * processus Node (modèle compris). Rend `{ vitesse, xTempsReel, memoireMo, chargementS, texte, reussi, duree, calcul }`.
 */
export async function essaiOnnx({ config, nom, qualite = 'equilibree', pcmEssai, attendu = /nightfall|yellow|lamps|country|brothels/i, creer = creerTranscripteurOnnx, maintenant = () => Date.now(), memoire = () => process.memoryUsage().rss }) {
  const echantillon = echantillonRepete(pcmEssai);
  const duree = echantillon.length / 16000;
  let pic = memoire();
  const releve = setInterval(() => {
    pic = Math.max(pic, memoire());
  }, 200);
  releve.unref?.();
  try {
    const t0 = maintenant();
    const t = await creer(config, { nom, qualite });
    const chargementS = (maintenant() - t0) / 1000;
    const d = DECODAGE_QUALITE[qualite] ?? DECODAGE_QUALITE.equilibree;
    const t1 = maintenant();
    const r = await t.transcrireMorceau(echantillon, { langue: 'en', prompt: ECHANTILLON_PROMPT, beam: d.beam, bestOf: d.bestOf, temperatures: d.temperatures });
    const calcul = Math.max(0.01, (maintenant() - t1) / 1000);
    pic = Math.max(pic, memoire());
    await t.liberer?.();
    const texte = String(r?.texte ?? '');
    return { vitesse: calcul / duree, xTempsReel: duree / calcul, memoireMo: Math.round(pic / (1024 * 1024)), chargementS, texte, reussi: attendu.test(texte), duree, calcul };
  } finally {
    clearInterval(releve);
  }
}

/**
 * Essai de whisper.cpp (option) : l'échantillon répété, transcrit avec prompt et VAD comme en vrai. Rend
 * `{ vitesse, xTempsReel, memoireMo, texte, reussi, duree, calcul }`.
 */
export async function essaiModele({ binaire, fichierModele, nomModele, vad, threads, pcmEssai, dossierTravail, qualite = 'equilibree', maintenant = () => Date.now(), spawn }) {
  const echantillon = echantillonRepete(pcmEssai, 60);
  const duree = echantillon.length / 16000;
  const decodage = qualite === 'rapide' ? { beam: 1, bestOf: 2 } : { beam: 5, bestOf: 5 };
  const t = creerTranscripteurWhisperCpp({ binaire, fichierModele, nomModele, vad, threads, decodage, dossierTravail, ...(spawn ? { spawn } : {}) });
  const t0 = maintenant();
  const r = await t.transcrireBloc(echantillon, { langue: 'en', prompt: ECHANTILLON_PROMPT });
  const calcul = Math.max(0.01, (maintenant() - t0) / 1000);
  const texte = r.segments.map(s => s[2]).join(' ');
  return { vitesse: calcul / duree, xTempsReel: duree / calcul, memoireMo: t.memoireMaxMo || null, texte, reussi: /what your country can do|nightfall|yellow|lamps/i.test(texte), duree, calcul };
}

/** « 25 min » pour une heure de réunion, d'après la vitesse (secondes de calcul par seconde d'audio). */
export const dureeHeure = vitesse => `${Math.max(1, Math.round(vitesse * 60))} min`;
const enGo = mo => `${(mo / 1024).toFixed(1).replace('.', ',')} Go`;

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
  ok('machine compatible (aucun droit administrateur nécessaire)');

  const env = chargerConfigEsport();
  const config = { ...env.transcriptionServeur };
  if (o.dossier) config.dossierModeles = resolve(o.dossier);
  if (!config.dossierModeles) config.dossierModeles = dossierModelesParDefaut();
  if (o.threads) config.threads = o.threads;
  const threads = config.threads;
  const threadsWhisper = o.threads ?? config.threadsWhisper;
  const c = chemins(config);
  if (/(^|\/)public_html(\/|$)/.test(c.dossier)) arreter('Le dossier des modèles ne doit pas être dans public_html.');
  const modeles = modelesAInstaller(config, o);
  const modelesGgml = modelesGgmlAInstaller(config, o);
  let pret = {};
  try {
    pret = JSON.parse(readFileSync(c.pret, 'utf8'));
  } catch {
    pret = {};
  }
  const ecrirePret = () => writeFileSync(c.pret, `${JSON.stringify({ ...pret, version: 2 }, null, 2)}\n`);
  pret.onnx = { modeles: {}, vitesses: {}, memoireMo: {}, ...(pret.onnx ?? {}) };

  titre('2. Plan et espace disque');
  const plans = {};
  for (const m of modeles) {
    try {
      plans[m] = await planOnnx(m, { revision: o.revision ?? (!o.forcer ? pret.onnx.modeles?.[m]?.revision : undefined) });
    } catch (e) {
      info(`liste des fichiers de ${m} indisponible pour l’instant (${e.message}) : taille estimée ${go(MODELES_ONNX_DEFS[m].tailleApprox)}`);
    }
  }
  const tailleDe = m => (plans[m] ? plans[m].fichiers.reduce((t, f) => t + f.taille, 0) : MODELES_ONNX_DEFS[m].tailleApprox);
  const deja = m => Boolean(plans[m]) && plans[m].fichiers.every(f => f.nom.startsWith('test_wavs/') || (existsSync(join(c.onnx(m), f.nom)) && statSync(join(c.onnx(m), f.nom)).size === f.taille));
  const besoin = modeles.reduce((t, m) => t + (deja(m) ? 0 : tailleDe(m)), 0) + 0.4 * GO + (o.whispercpp ? 2.5 * GO : 0);
  const libre = espaceLibre(c.dossier);
  info(`dossier : ${c.dossier}`);
  info(`moteur : ONNX Runtime ${PAQUETS_MOTEUR['onnxruntime-node']} DANS le processus Node (${threads} fils de calcul) ; whisper.cpp : ${o.whispercpp ? 'aussi installé (--whispercpp)' : 'non (option --whispercpp)'}`);
  for (const m of modeles) {
    const p = plans[m];
    info(`modèle ${m} (${MODELES_ONNX_DEFS[m].nom}) : ${p ? `${go(tailleDe(m))}, révision ${p.revision.slice(0, 12)}` : 'liste indisponible'}${deja(m) ? ' — déjà là' : ''}`);
    for (const f of p?.fichiers ?? []) info(`   ${f.nom} (${f.taille > 1e6 ? `${Math.round(f.taille / 1e6)} Mo` : `${f.taille} o`}, ${f.sha256 ? `SHA-256 ${f.sha256.slice(0, 16)}…` : `git ${f.sha1Git.slice(0, 12)}…`})`);
  }
  info(`qualités : ${QUALITES.map(q => `${q} → ${config.modelesOnnx[q]}${modeles.includes(config.modelesOnnx[q]) || pret.onnx.modeles?.[config.modelesOnnx[q]] ? '' : ' (pas installé : --tous)'}`).join(' ; ')}`);
  info(`espace nécessaire : environ ${go(besoin)} ; libre : ${libre === null ? 'inconnu' : go(libre)}`);
  if (libre !== null && libre < besoin) arreter(`Espace disque insuffisant : ${go(besoin)} nécessaires, ${go(libre)} libres.`);
  if (o.dryRun) {
    afficherFin({ config, threads, simulation: true });
    return;
  }
  mkdirSync(c.dossier, { recursive: true, mode: 0o700 });
  chmodSync(c.dossier, 0o700);
  for (const d of [c.travail, c.essai]) mkdirSync(d, { recursive: true });

  titre('3. ONNX Runtime (calcul dans Node) et ffmpeg (lecture des vidéos)');
  if (!installerMoteurNpm(c, o.forcer)) arreter('ONNX Runtime n’a pas pu être installé (npm install en échec) : relancez, ou voir docs/esport/transcription.md.');
  const ffmpeg = cheminFfmpeg(config);
  if (ffmpeg) ok(`ffmpeg prêt (${ffmpeg.startsWith(c.moteur) ? 'paquet ffmpeg-static' : 'celui du système'}) : MP4, MOV, MKV, WebM, M4A, MP3, OGG, FLAC ; passe-haut et normalisation du volume`);
  else info('ffmpeg absent : seuls les fichiers WAV seront lus (prétraitement simple intégré).');

  titre('4. Modèles Whisper ONNX (SHA-256 vérifiés)');
  for (const m of modeles) {
    let plan = plans[m];
    if (!plan) {
      try {
        plan = await planOnnx(m, { revision: o.revision });
      } catch (e) {
        arreter(`Liste des fichiers de ${m} illisible (${e.message}) : vérifiez l’accès à huggingface.co puis relancez.`);
      }
    }
    pret.onnx.modeles[m] = await installerModeleOnnx(c, m, plan);
    ecrirePret();
  }

  if (o.whispercpp) await installerWhisperCpp({ c, o, config, pret, ecrirePret, modelesGgml, threads: threadsWhisper, avx2 });

  if (o.test) {
    titre('5. Essai (--test) : vitesse et mémoire de chaque modèle, DANS ce processus Node');
    const pcm = join(c.essai, 'essai.pcm');
    for (const m of Object.keys(pret.onnx.modeles)) {
      if (!MODELES_ONNX_DEFS[m]) continue;
      const source = [join(c.essai, `${m}-0.wav`), ...Object.keys(MODELES_ONNX_DEFS).map(x => join(c.essai, `${x}-0.wav`)), join(c.essai, 'jfk.wav')].find(existsSync);
      if (!source) {
        info(`${m} : pas d’échantillon (essai/${m}-0.wav) : relancez avec --forcer.`);
        continue;
      }
      await decoderVersPcm({ source, sortie: pcm, ffmpeg, threads: 1 });
      const q = QUALITES.find(x => config.modelesOnnx[x] === m) ?? 'equilibree';
      info(`${m} (qualité ${q}, ${threads} fils, beam ${DECODAGE_QUALITE[q].beam})…`);
      try {
        const r = await essaiOnnx({ config, nom: m, qualite: q, pcmEssai: pcm });
        (r.reussi ? ok : info)(`${m} : ${r.reussi ? 'réussi' : 'TEXTE INATTENDU'} — chargement ${r.chargementS.toFixed(1)} s ; ${r.duree.toFixed(0)} s d’audio en ${r.calcul.toFixed(1)} s, soit × ${r.xTempsReel.toFixed(2)} temps réel ; mémoire du processus ${enGo(r.memoireMo)} ; 1 h de réunion ≈ ${dureeHeure(r.vitesse * (1 + config.repos))}`);
        info(`texte : « ${r.texte.slice(0, 160)} »`);
        pret.onnx.vitesses[m] = Math.round(r.vitesse * 1000) / 1000;
        pret.onnx.memoireMo[m] = r.memoireMo;
        if (r.memoireMo * 1024 * 1024 > config.ramMax) info(`ATTENTION : ${enGo(r.memoireMo)} dépasse TRANSCRIPTION_RAM_MAX (${go(config.ramMax)}) : augmentez-le dans esport.env.`);
      } catch (e) {
        info(`${m} : essai impossible (${e?.message ?? e}).`);
      }
    }
    rmSync(pcm, { force: true });
    ecrirePret();
    console.log('\nEstimation par qualité (pauses de ménagement du serveur comprises) :');
    for (const q of QUALITES) {
      const m = config.modelesOnnx[q];
      const v = pret.onnx.vitesses[m];
      info(`${q} (${m}) : ${v ? `1 h de réunion ≈ ${dureeHeure(v * (1 + config.repos))}` : 'modèle pas installé (--tous)'}`);
    }
    if (o.whispercpp && pret.whispercpp?.modeles) await essaisWhisperCpp({ c, config, pret, ecrirePret, threads: threadsWhisper, ffmpeg });
    const ia = env.iaLocale?.installation?.installe || env.ia?.actif;
    info(`relecture par l’IA : ${ia ? 'active (connecteur IA : API ou IA locale)' : 'inactive (aucune IA configurée)'}`);
  } else info('Pour mesurer la vitesse sur ce serveur : relancez avec --test (quelques minutes).');

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

/** whisper.cpp (option --whispercpp) : compilation, VAD, modèles GGML. Un échec n'empêche pas le moteur ONNX. */
async function installerWhisperCpp({ c, o, config, pret, ecrirePret, modelesGgml, threads, avx2 }) {
  titre(`Option : whisper.cpp ${WHISPER_CPP.version} (binaire externe)`);
  info('Attention : sur o2switch, l’hébergeur arrête de force ce binaire (SIGKILL) ; le processus de fond bascule alors sur ONNX et le désactive.');
  if (!commandeDispo('tar')) {
    info('La commande tar est introuvable : whisper.cpp n’est pas installé.');
    return;
  }
  const w0 = pret.whispercpp ?? {};
  const moteurOk = !o.forcer && w0.binaire === c.binaireWhisper && w0.commit === WHISPER_CPP.commit && verifierWhisperCli(c.binaireWhisper).ok && existsSync(c.vad);
  const route = o.route === 'auto' ? (compilateurSystemeSuffit() ? 'systeme' : 'compilation') : o.route;
  for (const d of [c.ggml, c.whispercpp]) mkdirSync(d, { recursive: true });
  if (moteurOk) ok(`déjà installé : ${c.binaireWhisper}`);
  else {
    try {
      await compilerWhisperCpp(c, { route, threads: Math.min(Math.max(2, threads), 16), avx2 });
      const v = verifierWhisperCli(c.binaireWhisper);
      if (!v.ok) arreter(`whisper-cli compilé ne démarre pas (${v.message}).`);
      ok(`moteur prêt (${route}) : ${v.message}`);
      pret.whispercpp = { ...(pret.whispercpp ?? {}), binaire: c.binaireWhisper, version: WHISPER_CPP.version, commit: WHISPER_CPP.commit, route, vad: { fichier: VAD_SILERO.fichier, sha256: VAD_SILERO.sha256 }, le: new Date().toISOString() };
      ecrirePret();
    } catch (e) {
      info(`whisper.cpp n’a pas pu être installé : ${e instanceof Arret ? e.message : (e?.message ?? e)} (le moteur ONNX, lui, est prêt).`);
      return;
    } finally {
      rmSync(c.outils, { recursive: true, force: true });
    }
  }
  pret.whispercpp.modeles = { ...(pret.whispercpp.modeles ?? {}) };
  for (const m of modelesGgml) {
    try {
      const plan = await planModele(m, { revision: o.revision ?? (!o.forcer ? pret.whispercpp.modeles?.[m]?.revision : undefined) });
      pret.whispercpp.modeles[m] = await installerModeleGgml(c, m, plan);
      ecrirePret();
    } catch (e) {
      info(`modèle GGML ${m} non installé : ${e instanceof Arret ? e.message : (e?.message ?? e)}`);
    }
  }
  // Réinstallé à la main : il peut être réessayé (la désactivation après un arrêt de force est effacée).
  rmSync(c.desactivationWhisper, { force: true });
}

async function essaisWhisperCpp({ c, config, pret, ecrirePret, threads, ffmpeg }) {
  const source = join(c.essai, 'jfk.wav');
  if (!existsSync(source)) return;
  const pcm = join(c.essai, 'jfk.pcm');
  await decoderVersPcm({ source, sortie: pcm, ffmpeg, threads: 1 });
  pret.whispercpp.vitesses = { ...(pret.whispercpp.vitesses ?? {}) };
  pret.whispercpp.memoireMo = { ...(pret.whispercpp.memoireMo ?? {}) };
  for (const m of Object.keys(pret.whispercpp.modeles ?? {})) {
    const fichierModele = join(c.ggml, MODELES_GGML[m].fichier);
    if (!existsSync(fichierModele)) continue;
    const q = QUALITES.find(x => config.modelesQualite[x] === m) ?? 'equilibree';
    info(`whisper.cpp ${m} (${threads} fils)…`);
    try {
      const r = await essaiModele({ binaire: c.binaireWhisper, fichierModele, nomModele: m, vad: c.vad, threads, pcmEssai: pcm, dossierTravail: c.travail, qualite: q });
      (r.reussi ? ok : info)(`whisper.cpp ${m} : × ${r.xTempsReel.toFixed(1)} temps réel ; mémoire ${r.memoireMo ? enGo(r.memoireMo) : 'inconnue'}`);
      pret.whispercpp.vitesses[m] = Math.round(r.vitesse * 1000) / 1000;
      if (r.memoireMo) pret.whispercpp.memoireMo[m] = r.memoireMo;
    } catch (e) {
      info(`whisper.cpp ${m} : essai en échec (${e?.message ?? e})${e?.tueExterne ? ' : ARRÊTÉ DE FORCE par l’hébergeur. Il ne sera pas utilisé (bascule sur ONNX).' : ''}`);
    }
  }
  rmSync(pcm, { force: true });
  ecrirePret();
}

function afficherFin({ config, threads, simulation = false }) {
  titre(simulation ? 'Lignes qui seraient à ajouter' : 'Réglages conseillés');
  console.log('\n  Dans ~/.appdashboard/esport.env (valeurs conseillées sur o2switch) :\n');
  console.log(`TRANSCRIPTION_THREADS=${threads}`);
  console.log('TRANSCRIPTION_RAM_MAX=8G');
  if (config.dossierModeles !== dossierModelesParDefaut()) console.log(`TRANSCRIPTION_DOSSIER_MODELES=${config.dossierModeles}`);
  console.log('\n  puis : mkdir -p ~/application-enzo/esport/tmp && touch ~/application-enzo/esport/tmp/restart.txt');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  principal().catch(e => {
    console.error(`\n✖ ${e instanceof Arret ? e.message : (e?.stack ?? String(e))}\n`);
    process.exit(1);
  });
}
