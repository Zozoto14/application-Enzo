/**
 * Installation de l'IA LOCALE du serveur Esport (lancé par esport/serveur/installer-ia-locale.sh, dans le
 * Terminal cPanel). Sans droit administrateur, sans carte graphique, idempotent (relancer ne refait que
 * ce qui manque), et RIEN n'est écrit dans le dépôt : tout va dans ~/.appdashboard/ia-locale (ou --dossier).
 *
 *  1. vérifie la machine (Linux x64, glibc, AVX2, mémoire, git, tar) et l'espace disque ;
 *  2. moteur llama.cpp, version figée b11351 :
 *     - glibc ≥ 2.34 : archive officielle précompilée (SHA-256 vérifié), gardée si elle démarre ;
 *     - sinon (CloudLinux 8, glibc 2.28) : COMPILATION depuis les sources du tag (git, commit vérifié)
 *       avec un GCC 14 obtenu sans root (micromamba + paquets conda-forge figés, chacun téléchargé ET
 *       vérifié par SHA-256 ici même, puis installés hors ligne) ; binaire autonome (glibc 2.27 suffit) ;
 *       les outils (environ 1 Go) sont effacés à la fin ;
 *  3. modèle GGUF Q4_K_M (Qwen2.5-7B-Instruct par défaut, Qwen3-4B-Instruct-2507 avec --petit, Apache 2.0),
 *     depuis Hugging Face, à une révision précise (commit) : reprise du téléchargement, SHA-256 comparé à
 *     l'empreinte publiée par Hugging Face pour ce fichier ;
 *  4. écrit pret.json (moteur, modèle, empreintes) ; --test : banc d'essai (chargement, jetons/s, mémoire,
 *     JSON en anglais et en français) avec un résumé et une recommandation ;
 *  5. affiche les lignes à mettre dans ~/.appdashboard/esport.env.
 *
 * Options : --petit | --modele qwen2.5-7b|qwen3-4b, --dossier <chemin absolu>, --threads N, --test,
 * --dry-run (rien n'est téléchargé ni écrit), --forcer (tout refaire), --revision <commit Hugging Face>,
 * --route auto|officiel|compilation.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { cpus, freemem, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { configIaLocale } from '../../noyau/ia/connecteur.mjs';
import { chargerEnv, fichierEnvParDefaut } from '../commun.mjs';
import { creerGestionnaireIaLocale, environnementMoteur } from './gestionnaire.mjs';
import { FICHIER_OUTILS, LLAMA_CPP, MICROMAMBA, MODELES_IA_LOCALE, MODELE_IA_LOCALE_DEFAUT, MODELE_IA_LOCALE_PETIT, cheminsIaLocale, dossierIaLocaleParDefaut, dossierRefuse, lireJson } from './installation.mjs';

const DEPOT = fileURLToPath(new URL('../../..', import.meta.url));
const GO = 1024 ** 3;
const ok = m => console.log(`  ✔ ${m}`);
const info = m => console.log(`    ${m}`);
const titre = m => console.log(`\n▶ ${m}`);
class Arret extends Error {}
const arreter = m => {
  throw new Arret(m);
};

// ------------------------------------------------------------------ Options, machine

export function lireOptions(argv) {
  const o = { test: false, dryRun: false, forcer: false, route: 'auto' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const valeur = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) arreter(`Valeur manquante après ${a}.`);
      return v;
    };
    if (a === '--petit') o.modele = MODELE_IA_LOCALE_PETIT;
    else if (a === '--modele') o.modele = valeur();
    else if (a === '--dossier') o.dossier = valeur();
    else if (a === '--threads') o.threads = Number(valeur());
    else if (a === '--revision') o.revision = valeur();
    else if (a === '--route') o.route = valeur();
    else if (a === '--test') o.test = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--forcer') o.forcer = true;
    else if (a === '--aide' || a === '--help' || a === '-h') o.aide = true;
    else arreter(`Option inconnue : ${a} (voir --aide).`);
  }
  if (o.modele && !MODELES_IA_LOCALE[o.modele]) arreter(`Modèle inconnu : ${o.modele} (${Object.keys(MODELES_IA_LOCALE).join(' ou ')}).`);
  if (o.threads !== undefined && (!Number.isInteger(o.threads) || o.threads < 1 || o.threads > 32)) arreter('--threads : un nombre entier de 1 à 32.');
  if (o.revision !== undefined && !/^[0-9a-f]{40}$/.test(o.revision)) arreter('--revision : un identifiant de commit Hugging Face (40 caractères hexadécimaux).');
  if (!['auto', 'officiel', 'compilation'].includes(o.route)) arreter('--route : auto, officiel ou compilation.');
  return o;
}

/** glibc du système, ex. [2, 28] (ou null). */
export function versionGlibc() {
  const v = process.report?.getReport?.().header?.glibcVersionRuntime;
  const m = /^(\d+)\.(\d+)/.exec(String(v ?? ''));
  return m ? [Number(m[1]), Number(m[2])] : null;
}
const auMoins = (v, min) => Boolean(v) && (v[0] > min[0] || (v[0] === min[0] && v[1] >= min[1]));

function drapeauxProcesseur() {
  try {
    const l = readFileSync('/proc/cpuinfo', 'utf8').split('\n').find(x => x.startsWith('flags'));
    return new Set((l ?? '').split(':')[1]?.trim().split(/\s+/) ?? []);
  } catch {
    return new Set();
  }
}

const commandeDispo = (cmd, args = ['--version']) => spawnSync(cmd, args, { stdio: 'ignore', timeout: 20_000 }).status === 0;

/** Espace libre (octets) du système de fichiers qui contiendra `chemin`. */
function espaceLibre(chemin) {
  let p = resolve(chemin);
  while (!existsSync(p) && dirname(p) !== p) p = dirname(p);
  try {
    const s = statfsSync(p);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}
const go = n => `${(n / GO).toFixed(1)} Go`;

// ------------------------------------------------------------------ Téléchargements

/** SHA-256 d'un fichier (lecture en flux). */
export async function sha256Fichier(chemin) {
  const h = createHash('sha256');
  await pipeline(createReadStream(chemin), h);
  return h.digest('hex');
}

/**
 * Télécharge `url` vers `destination` avec REPRISE (fichier .partiel + en-tête Range) puis vérifie la
 * taille (si connue) et le SHA-256. Un fichier déjà présent et correct n'est pas retéléchargé.
 */
export async function telechargerVerifie(url, destination, { sha256, taille = null, fetch: f = globalThis.fetch, journal = info } = {}) {
  if (!/^[0-9a-f]{64}$/.test(String(sha256))) throw new Error(`empreinte SHA-256 manquante pour ${url}`);
  if (existsSync(destination) && (taille === null || statSync(destination).size === taille) && (await sha256Fichier(destination)) === sha256) return { deja: true };
  const partiel = `${destination}.partiel`;
  mkdirSync(dirname(destination), { recursive: true });
  for (let essai = 1; essai <= 4; essai++) {
    const deja = existsSync(partiel) ? statSync(partiel).size : 0;
    if (taille !== null && deja === taille) break;
    if (taille !== null && deja > taille) rmSync(partiel, { force: true });
    const r = await f(url, { redirect: 'follow', headers: deja > 0 ? { Range: `bytes=${deja}-` } : {} }).catch(e => ({ ok: false, status: 0, erreur: e }));
    if (r.status === 416) {
      rmSync(partiel, { force: true });
      continue;
    }
    if (!r.ok || !r.body) {
      journal(`téléchargement interrompu (${r.status || r.erreur?.message || 'réseau'}), nouvel essai ${essai}/4…`);
      await new Promise(ok2 => setTimeout(ok2, 2000 * essai));
      continue;
    }
    const reprise = r.status === 206 && deja > 0;
    if (deja > 0 && !reprise) rmSync(partiel, { force: true });
    const total = taille ?? (Number(r.headers.get('content-length')) || 0) + (reprise ? deja : 0);
    let recu = reprise ? deja : 0;
    let palier = total ? Math.floor((recu / total) * 10) : 0;
    const flux = Readable.fromWeb(r.body);
    flux.on('data', m => {
      recu += m.length;
      if (total && Math.floor((recu / total) * 10) > palier) {
        palier = Math.floor((recu / total) * 10);
        journal(`${palier * 10} % de ${total > 1e9 ? go(total) : `${Math.round(total / 1e6)} Mo`}`);
      }
    });
    try {
      await pipeline(flux, createWriteStream(partiel, { flags: reprise ? 'a' : 'w' }));
      break;
    } catch (e) {
      journal(`téléchargement interrompu (${e?.message ?? e}), reprise ${essai}/4…`);
    }
  }
  if (!existsSync(partiel)) throw new Error(`téléchargement impossible : ${url}`);
  if (taille !== null && statSync(partiel).size !== taille) throw new Error(`taille inattendue pour ${url} (relancez : le téléchargement reprendra)`);
  const h = await sha256Fichier(partiel);
  if (h !== sha256) {
    rmSync(partiel, { force: true });
    throw new Error(`empreinte SHA-256 incorrecte pour ${url} (fichier effacé)`);
  }
  renameSync(partiel, destination);
  return { deja: false };
}

// ------------------------------------------------------------------ Moteur

/** Le binaire démarre-t-il, et est-ce bien la version figée ? */
export function verifierBinaire(binaire) {
  if (!existsSync(binaire)) return { ok: false, message: 'absent' };
  const r = spawnSync(binaire, ['--version'], { env: environnementMoteur(binaire), encoding: 'utf8', timeout: 30_000 });
  const sortie = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) return { ok: false, message: (sortie.trim().split('\n').pop() || `code ${r.status ?? r.signal}`).slice(0, 300) };
  if (!sortie.includes(LLAMA_CPP.commit.slice(0, 7))) return { ok: false, message: `version inattendue : ${sortie.trim().slice(0, 200)}` };
  return { ok: true, message: sortie.trim().split('\n')[0] };
}

function executer(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (r.status !== 0) arreter(`Commande en échec : ${[cmd, ...args].join(' ').slice(0, 300)} (code ${r.status ?? r.signal ?? r.error?.message}).`);
}

async function moteurOfficiel(c) {
  const dossier = join(c.moteur, `officiel-${LLAMA_CPP.version}`);
  const archive = join(c.moteur, `llama-${LLAMA_CPP.version}-ubuntu-x64.tar.gz`);
  info('archive officielle précompilée (17 Mo)…');
  await telechargerVerifie(LLAMA_CPP.officiel.url, archive, { sha256: LLAMA_CPP.officiel.sha256, taille: LLAMA_CPP.officiel.taille });
  ok('archive vérifiée (SHA-256)');
  rmSync(dossier, { recursive: true, force: true });
  mkdirSync(dossier, { recursive: true });
  executer('tar', ['-xzf', archive, '-C', dossier, '--strip-components=1', '--no-same-owner']);
  rmSync(archive, { force: true });
  return join(dossier, 'llama-server');
}

/** Lignes « adresse#sha256 » de la liste figée des paquets du compilateur. */
export function lirePaquetsOutils(texte = readFileSync(FICHIER_OUTILS, 'utf8')) {
  return texte
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('https://'))
    .map(l => {
      const [url, sha256] = l.split('#');
      const nom = url.split('/').pop();
      if (!/^https:\/\/conda\.anaconda\.org\/conda-forge\/(linux-64|noarch)\/[A-Za-z0-9._+-]+\.conda$/.test(url) || !/^[0-9a-f]{64}$/.test(sha256 ?? '')) throw new Error(`ligne invalide dans outils-compilation.lock : ${l}`);
      return { url, sha256, nom };
    });
}

async function moteurCompile(c, { threads, avx2 }) {
  if (!commandeDispo('git')) arreter('git est introuvable : il sert à récupérer les sources de llama.cpp (o2switch le fournit normalement).');
  const o = c.outils;
  mkdirSync(o, { recursive: true });
  const env = { ...process.env, MAMBA_ROOT_PREFIX: join(o, 'racine'), CONDA_OVERRIDE_GLIBC: '2.28', MAMBA_NO_BANNER: '1' };
  // 1. micromamba
  const mm = join(o, 'mm', 'bin', 'micromamba');
  if (!existsSync(mm)) {
    info(`micromamba ${MICROMAMBA.version} (7 Mo)…`);
    const archive = join(o, 'micromamba.tar.bz2');
    await telechargerVerifie(MICROMAMBA.url, archive, { sha256: MICROMAMBA.sha256, taille: MICROMAMBA.taille });
    mkdirSync(join(o, 'mm'), { recursive: true });
    executer('tar', ['-xjf', archive, '-C', join(o, 'mm'), '--no-same-owner', 'bin/micromamba']);
    rmSync(archive, { force: true });
  }
  ok('micromamba prêt (SHA-256 vérifié)');
  // 2. paquets du compilateur : téléchargés et vérifiés ICI (micromamba ne vérifie pas les empreintes d'une liste explicite).
  const paquets = lirePaquetsOutils();
  info(`compilateur GCC 14 + cmake : ${paquets.length} paquets figés (environ 215 Mo)…`);
  for (const p of paquets) await telechargerVerifie(p.url, join(o, 'paquets', p.nom), { sha256: p.sha256, journal: () => undefined });
  ok('paquets du compilateur téléchargés et vérifiés (SHA-256)');
  const local = join(o, 'local.lock');
  writeFileSync(local, `@EXPLICIT\n${paquets.map(p => pathToFileURL(join(o, 'paquets', p.nom)).href).join('\n')}\n`);
  const envOutils = join(o, 'env');
  if (!existsSync(join(envOutils, 'bin', 'cmake'))) {
    rmSync(envOutils, { recursive: true, force: true });
    executer(mm, ['create', '-y', '-q', '--offline', '-p', envOutils, '--file', local], { env });
  }
  ok('compilateur installé (hors ligne, depuis les paquets vérifiés)');
  // 3. sources, commit vérifié
  const src = join(o, 'src');
  const commit = () => spawnSync('git', ['-C', src, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim();
  if (!existsSync(join(src, '.git')) || commit() !== LLAMA_CPP.commit) {
    rmSync(src, { recursive: true, force: true });
    info(`sources de llama.cpp ${LLAMA_CPP.version} (git)…`);
    executer('git', ['-c', 'advice.detachedHead=false', 'clone', '--quiet', '--depth', '1', '--branch', LLAMA_CPP.version, LLAMA_CPP.depotGit, src]);
  }
  if (commit() !== LLAMA_CPP.commit) arreter(`Sources inattendues : commit ${commit()} au lieu de ${LLAMA_CPP.commit}.`);
  ok(`sources vérifiées (commit ${LLAMA_CPP.commit.slice(0, 12)})`);
  // 4. compilation (llama-server seul), binaire autonome
  const build = join(o, 'build');
  rmSync(build, { recursive: true, force: true });
  const jeu = avx2 ? 'ON' : 'OFF';
  info(`compilation (${threads} fils, priorité basse) : 10 à 30 minutes…`);
  // Compilateur appelé directement (sans « micromamba run », dont les drapeaux ajouteraient au binaire un
  // chemin de bibliothèques vers le dossier des outils, effacé ensuite).
  const bin = join(envOutils, 'bin');
  const envCompil = { ...process.env, PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, CC: join(bin, 'x86_64-conda-linux-gnu-gcc'), CXX: join(bin, 'x86_64-conda-linux-gnu-g++'), LDFLAGS: '', CFLAGS: '', CXXFLAGS: '', CPPFLAGS: '' };
  executer(
    join(bin, 'cmake'),
    [
      '-S', src, '-B', build, '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF', '-DGGML_NATIVE=OFF', '-DGGML_AVX=ON',
      `-DGGML_AVX2=${jeu}`, `-DGGML_FMA=${jeu}`, `-DGGML_F16C=${jeu}`, `-DGGML_BMI2=${jeu}`, '-DGGML_OPENMP=OFF', '-DGGML_CCACHE=OFF', '-DLLAMA_OPENSSL=OFF',
      '-DLLAMA_BUILD_TESTS=OFF', '-DLLAMA_BUILD_EXAMPLES=OFF', '-DLLAMA_BUILD_SERVER=ON', '-DLLAMA_BUILD_UI=OFF', '-DLLAMA_BUILD_MTMD=OFF',
      '-DCMAKE_EXE_LINKER_FLAGS=-static-libstdc++ -static-libgcc',
    ],
    { env: envCompil },
  );
  executer(join(bin, 'cmake'), ['--build', build, '--target', 'llama-server', '-j', String(threads)], { env: envCompil });
  const dossier = join(c.moteur, `compile-${LLAMA_CPP.version}`);
  mkdirSync(dossier, { recursive: true });
  const binaire = join(dossier, 'llama-server');
  copyFileSync(join(build, 'bin', 'llama-server'), binaire);
  chmodSync(binaire, 0o755);
  // Le GCC de conda-forge inscrit toujours « -rpath <outils>/env/lib » (ses specs) : ce dossier est effacé
  // ensuite ; le chemin est remplacé sur place par $ORIGIN (comme « chrpath -r »), le binaire n'en a pas besoin.
  remplacerRpath(binaire, join(envOutils, 'lib'));
  return binaire;
}

/**
 * Remplace, dans un binaire ELF, la chaîne exacte `ancien` (chemin de bibliothèques, terminée par un octet nul)
 * par « $ORIGIN » complété d'octets nuls (même longueur : rien d'autre ne bouge). Une seule occurrence attendue.
 */
export function remplacerRpath(binaire, ancien) {
  const octets = readFileSync(binaire);
  const motif = Buffer.from(`${ancien}\0`);
  const i = octets.indexOf(motif);
  if (i < 0) return false;
  if (octets.indexOf(motif, i + 1) >= 0) arreter('Chemin de bibliothèques présent plusieurs fois dans le moteur compilé.');
  const nouveau = Buffer.alloc(motif.length, 0);
  nouveau.write('$ORIGIN');
  nouveau.copy(octets, i);
  writeFileSync(binaire, octets, { mode: 0o755 });
  return true;
}

// ------------------------------------------------------------------ Modèle (Hugging Face)

/** Fichiers GGUF du modèle à une révision donnée (commit) : nom, taille, SHA-256 publié par Hugging Face. */
export async function fichiersModele(def, { revision, fetch: f = globalThis.fetch } = {}) {
  let rev = revision;
  if (!rev) {
    const r = await f(`https://huggingface.co/api/models/${def.depot}/revision/main`, { redirect: 'follow' });
    if (!r.ok) throw new Error(`Hugging Face : HTTP ${r.status}`);
    rev = (await r.json())?.sha;
  }
  if (!/^[0-9a-f]{40}$/.test(String(rev))) throw new Error('Hugging Face : révision illisible');
  const r = await f(`https://huggingface.co/api/models/${def.depot}/tree/${rev}`, { redirect: 'follow' });
  if (!r.ok) throw new Error(`Hugging Face : HTTP ${r.status}`);
  const liste = await r.json();
  const fichiers = (Array.isArray(liste) ? liste : [])
    .filter(x => x?.type === 'file' && def.motif.test(String(x.path ?? '')) && /^[0-9a-f]{64}$/.test(String(x.lfs?.oid ?? '')) && Number.isSafeInteger(x.lfs?.size ?? x.size))
    .map(x => ({ nom: x.path, taille: x.lfs?.size ?? x.size, sha256: x.lfs.oid, url: `https://huggingface.co/${def.depot}/resolve/${rev}/${encodeURIComponent(x.path)}` }))
    .sort((a, b) => a.nom.localeCompare(b.nom));
  if (!fichiers.length) throw new Error(`aucun fichier ${def.motif} dans ${def.depot} (révision ${rev})`);
  return { revision: rev, fichiers };
}

// ------------------------------------------------------------------ Banc d'essai (--test)

const ESSAIS = [
  {
    nom: 'JSON (anglais)',
    messages: [
      { role: 'system', content: 'Answer with ONE JSON object only.' },
      { role: 'user', content: 'Invent a fictional 5v5 tactical shooter called "Exemple Arena". Give its name, 3 game modes and 4 maps. Return {"nom": "", "modes": [""], "cartes": [""]}.' },
    ],
    schema: { type: 'object', properties: { nom: { type: 'string' }, modes: { type: 'array', items: { type: 'string' }, maxItems: 5 }, cartes: { type: 'array', items: { type: 'string' }, maxItems: 6 } }, required: ['nom', 'modes', 'cartes'], additionalProperties: false },
    valide: j => typeof j?.nom === 'string' && j.modes?.length >= 1 && j.cartes?.length >= 1,
  },
  {
    nom: 'résumé en français (JSON)',
    messages: [
      { role: 'system', content: 'Réponds avec UN seul objet JSON, en français.' },
      { role: 'user', content: 'Résume en deux phrases : « L’équipe s’entraîne trois soirs par semaine. Le mardi est consacré aux stratégies sur deux cartes, le jeudi aux matchs d’entraînement contre d’autres équipes, et le dimanche à la revue des vidéos. Le capitaine veut ajouter une séance de communication avant le tournoi de décembre. » Réponds {"resume": "…"}.' },
    ],
    schema: { type: 'object', properties: { resume: { type: 'string' } }, required: ['resume'], additionalProperties: false },
    valide: j => typeof j?.resume === 'string' && j.resume.length > 30 && /\b(le|la|les|des|une?)\b/i.test(j.resume),
  },
];

function memoireMaxGo(pid) {
  try {
    const l = readFileSync(`/proc/${pid}/status`, 'utf8').split('\n').find(x => x.startsWith('VmHWM:'));
    return Number(/(\d+)/.exec(l ?? '')?.[1] ?? 0) / 1024 / 1024;
  } catch {
    return null;
  }
}

/** Recommandation en français d'après la vitesse de génération (jetons/s) et le traitement du texte lu. */
export function recommandation({ jetonsParSeconde, lectureParSeconde, modele }) {
  // Un brouillon : environ 4 000 jetons lus (pages, consignes) et 1 500 écrits.
  const minutes = (4000 / Math.max(1, lectureParSeconde || jetonsParSeconde * 8) + 1500 / Math.max(0.1, jetonsParSeconde)) / 60;
  const duree = `un brouillon de profil prendra environ ${Math.max(1, Math.round(minutes))} min`;
  if (jetonsParSeconde >= 8) return { niveau: 'bon', texte: `Vitesse très correcte : ${duree}. Mode conseillé : « IA locale » (ou « Locale d’abord, API en secours »).` };
  if (jetonsParSeconde >= 3) return { niveau: 'moyen', texte: `Vitesse correcte mais lente : ${duree}. Mode conseillé : « Locale d’abord, API en secours » si vous avez une clé d’API.${modele !== MODELE_IA_LOCALE_PETIT ? ' Pour aller deux fois plus vite : relancez avec --petit.' : ''}` };
  return { niveau: 'lent', texte: `Trop lent pour un usage confortable : ${duree}. ${modele !== MODELE_IA_LOCALE_PETIT ? 'Essayez le modèle plus petit (--petit) ou ' : 'Préférez '}la clé d’API (mode « Clé API »).` };
}

async function bancEssai({ c, binaire, fichierModele, threads, modele }) {
  const g = creerGestionnaireIaLocale({ dossier: c.dossier, binaire, fichierModele, threads, contexte: 8192, inactiviteMs: 60_000, demarrageMs: 600_000, delaiMs: 15 * 60_000, attenteVerrouMs: 30_000, log: { log: () => undefined, warn: info, error: info } });
  const resultats = [];
  let memoire = null;
  const debut = Date.now();
  try {
    await g.executer(async ({ port, cle }) => {
      const chargementS = (Date.now() - debut) / 1000;
      ok(`modèle chargé en ${chargementS.toFixed(1)} s`);
      const pid = lireJson(c.verrouServeur)?.pid;
      for (const e of ESSAIS) {
        const t0 = Date.now();
        const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cle}` },
          body: JSON.stringify({ model: modele, messages: e.messages, temperature: 0.2, max_tokens: 400, response_format: { type: 'json_schema', json_schema: { name: 'essai', schema: e.schema, strict: true } } }),
          signal: AbortSignal.timeout(10 * 60_000),
        });
        const j = await r.json().catch(() => null);
        const texte = j?.choices?.[0]?.message?.content ?? '';
        let donnees = null;
        try {
          donnees = JSON.parse(texte);
        } catch {
          donnees = null;
        }
        const reussi = r.ok && e.valide(donnees);
        const t = j?.timings ?? {};
        resultats.push({ nom: e.nom, reussi, dureeS: (Date.now() - t0) / 1000, jetonsParSeconde: Number(t.predicted_per_second) || 0, lectureParSeconde: Number(t.prompt_per_second) || 0 });
        (reussi ? ok : info)(`${e.nom} : ${reussi ? 'réussi' : 'ÉCHEC'} en ${((Date.now() - t0) / 1000).toFixed(1)} s, ${(Number(t.predicted_per_second) || 0).toFixed(1)} jetons/s — ${texte.slice(0, 160).replace(/\s+/g, ' ')}`);
      }
      memoire = pid ? memoireMaxGo(pid) : null;
      return { chargementS };
    }, { delai: 30 * 60_000 }).then(x => resultats.push({ chargementS: x.chargementS }));
  } finally {
    await g.arreter();
  }
  const chargementS = resultats.find(r => 'chargementS' in r)?.chargementS ?? null;
  const essais = resultats.filter(r => 'reussi' in r);
  const jetonsParSeconde = Math.round((essais.reduce((s, r) => s + r.jetonsParSeconde, 0) / Math.max(1, essais.length)) * 10) / 10;
  const lectureParSeconde = Math.round((essais.reduce((s, r) => s + r.lectureParSeconde, 0) / Math.max(1, essais.length)) * 10) / 10;
  return { le: new Date().toISOString(), threads, chargementS, jetonsParSeconde, lectureParSeconde, memoireGo: memoire === null ? null : Math.round(memoire * 10) / 10, essaisReussis: essais.filter(r => r.reussi).length, essais: essais.length };
}

// ------------------------------------------------------------------ Programme

const AIDE = `Installation de l'IA locale (llama.cpp + modèle GGUF) dans ~/.appdashboard/ia-locale.
  --petit                 modèle plus petit et plus rapide (${MODELES_IA_LOCALE[MODELE_IA_LOCALE_PETIT].nom})
  --modele <nom>          ${Object.keys(MODELES_IA_LOCALE).join(' ou ')} (défaut : IA_LOCALE_MODELE, sinon ${MODELE_IA_LOCALE_DEFAUT})
  --threads N             fils de calcul (défaut : IA_LOCALE_THREADS, sinon 8)
  --test                  banc d'essai : chargement, jetons/s, mémoire, JSON anglais et français, recommandation
  --dry-run               montre ce qui serait fait, sans rien télécharger ni écrire
  --forcer                refait tout (moteur et modèle)
  --dossier <chemin>      autre dossier (absolu, hors public_html et hors du dépôt)
  --revision <commit>     révision Hugging Face précise du modèle
  --route <r>             auto (défaut), officiel (archive précompilée) ou compilation`;

export async function principal(argv = process.argv.slice(2)) {
  const o = lireOptions(argv);
  if (o.aide) {
    console.log(AIDE);
    return;
  }
  chargerEnv(process.env.ESPORT_ENV || fichierEnvParDefaut('esport'), process.env);
  const reglages = configIaLocale(process.env);
  const modele = o.modele ?? (MODELES_IA_LOCALE[reglages.modele] ? reglages.modele : MODELE_IA_LOCALE_DEFAUT);
  const def = MODELES_IA_LOCALE[modele];
  const dossier = resolve(o.dossier ?? reglages.dossier ?? dossierIaLocaleParDefaut());
  const refus = dossierRefuse(dossier, DEPOT);
  if (refus) arreter(`Dossier refusé (${dossier}) : ${refus}.`);
  const threads = o.threads ?? reglages.threads;
  const c = cheminsIaLocale(dossier);
  console.log(`IA locale du serveur Esport : ${o.dryRun ? 'SIMULATION (--dry-run : rien n’est téléchargé ni écrit)' : 'installation'}`);

  titre('1. Machine');
  const glibc = versionGlibc();
  const drapeaux = drapeauxProcesseur();
  const avx2 = drapeaux.has('avx2');
  info(`${process.platform} ${process.arch}, Node ${process.versions.node}, glibc ${glibc?.join('.') ?? 'inconnue'}, ${cpus().length} cœurs visibles, AVX2 ${avx2 ? 'oui' : 'non'}, mémoire ${go(totalmem())} (libre ${go(freemem())})`);
  if (process.platform !== 'linux' || process.arch !== 'x64') arreter('Il faut un serveur Linux x64 (o2switch l’est).');
  if (Number(process.versions.node.split('.')[0]) < 22) arreter('Node 22 est nécessaire (voir docs/o2switch.md).');
  if (!glibc || !auMoins(glibc, [2, 27])) arreter(`glibc ${glibc?.join('.') ?? 'inconnue'} : 2.27 au moins est nécessaire.`);
  if (!commandeDispo('tar')) arreter('La commande tar est introuvable.');
  if (totalmem() < def.ramGo * GO) info(`ATTENTION : moins de ${def.ramGo} Go de mémoire visibles ; préférez --petit.`);
  ok('machine compatible (aucun droit administrateur nécessaire)');
  info(`dossier : ${dossier} ; modèle : ${def.nom} (${def.licence}) ; fils de calcul : ${threads}`);

  // Ce qui est déjà là (idempotence)
  const pret = lireJson(c.pret, {}) ?? {};
  let binaire = typeof pret.moteur?.binaire === 'string' && pret.moteur.binaire.startsWith(`${c.moteur}/`) && pret.moteur.version === LLAMA_CPP.version ? pret.moteur.binaire : null;
  const moteurOk = !o.forcer && binaire && verifierBinaire(binaire).ok;
  const officielPossible = auMoins(glibc, LLAMA_CPP.officiel.glibcMin);
  const route = o.route === 'auto' ? (officielPossible ? 'officiel' : 'compilation') : o.route;
  if (route === 'officiel' && !officielPossible) info(`ATTENTION : l’archive officielle demande glibc ${LLAMA_CPP.officiel.glibcMin.join('.')} (ici ${glibc.join('.')}) ; elle ne démarrera sans doute pas.`);

  titre('2. Plan et espace disque');
  let plan = null;
  try {
    plan = await fichiersModele(def, { revision: o.revision ?? (pret.modeles?.[modele]?.revision && !o.forcer ? pret.modeles[modele].revision : undefined) });
  } catch (e) {
    info(`liste des fichiers du modèle indisponible pour l’instant (${e.message}) : taille estimée ${go(def.tailleApprox)}`);
  }
  const tailleModele = plan ? plan.fichiers.reduce((s, f) => s + f.taille, 0) : def.tailleApprox;
  const modeleDeja = (plan?.fichiers ?? []).filter(f => existsSync(join(c.modeles, f.nom)) && statSync(join(c.modeles, f.nom)).size === f.taille).reduce((s, f) => s + f.taille, 0);
  const besoin = (tailleModele - modeleDeja) + (moteurOk ? 0 : route === 'compilation' ? 2.5 * GO : 0.2 * GO) + 0.5 * GO;
  const libre = espaceLibre(dossier);
  info(`moteur llama.cpp ${LLAMA_CPP.version} : ${moteurOk ? 'déjà installé' : route === 'officiel' ? 'archive officielle précompilée' : 'compilation depuis les sources (GCC 14 sans root, 10 à 30 min)'}`);
  if (plan) for (const f of plan.fichiers) info(`modèle : ${f.nom} (${go(f.taille)}, SHA-256 ${f.sha256.slice(0, 16)}…, révision ${plan.revision.slice(0, 12)})`);
  info(`espace nécessaire : environ ${go(besoin)} (au final : ${go(tailleModele + 0.1 * GO)}) ; libre : ${libre === null ? 'inconnu' : go(libre)}`);
  if (libre !== null && libre < besoin) arreter(`Espace disque insuffisant : ${go(besoin)} nécessaires, ${go(libre)} libres.`);
  if (o.dryRun) {
    afficherFin({ modele, threads, dossier, simulation: true });
    return;
  }
  ok('espace disque suffisant');
  mkdirSync(dossier, { recursive: true, mode: 0o700 });
  chmodSync(dossier, 0o700);
  for (const d of [c.moteur, c.modeles, c.etat]) mkdirSync(d, { recursive: true, mode: 0o700 });

  titre(`3. Moteur llama.cpp ${LLAMA_CPP.version}`);
  if (moteurOk) ok(`déjà installé : ${binaire}`);
  else {
    binaire = null;
    let routeFaite = route;
    if (route === 'officiel') {
      const b = await moteurOfficiel(c);
      const v = verifierBinaire(b);
      if (v.ok) binaire = b;
      else if (o.route === 'officiel') arreter(`L’archive officielle ne démarre pas ici (${v.message}).`);
      else info(`l’archive officielle ne démarre pas ici (${v.message}) : compilation à la place.`);
    }
    if (!binaire) {
      routeFaite = 'compilation';
      const b = await moteurCompile(c, { threads: Math.min(threads, 16), avx2 });
      const v = verifierBinaire(b);
      if (!v.ok) arreter(`Le moteur compilé ne démarre pas (${v.message}).`);
      binaire = b;
      rmSync(c.outils, { recursive: true, force: true });
      ok('outils de compilation effacés');
    }
    pret.moteur = { binaire, version: LLAMA_CPP.version, commit: LLAMA_CPP.commit, route: routeFaite, le: new Date().toISOString() };
    ok(`moteur prêt (${routeFaite}) : ${verifierBinaire(binaire).message}`);
    pret.version = 1;
    writeFileSync(c.pret, `${JSON.stringify(pret, null, 2)}\n`, { mode: 0o600 });
  }

  titre(`4. Modèle ${def.nom}`);
  if (!plan) {
    try {
      plan = await fichiersModele(def, { revision: o.revision });
    } catch (e) {
      arreter(`Liste des fichiers du modèle illisible (${e.message}) : vérifiez l’accès à huggingface.co puis relancez (le moteur, lui, est installé).`);
    }
  }
  for (const f of plan.fichiers) {
    const r = await telechargerVerifie(f.url, join(c.modeles, f.nom), { sha256: f.sha256, taille: f.taille });
    ok(`${f.nom} ${r.deja ? 'déjà présent et vérifié' : 'téléchargé et vérifié'} (SHA-256)`);
  }
  pret.version = 1;
  pret.modeles = { ...(pret.modeles ?? {}), [modele]: { depot: def.depot, revision: plan.revision, fichiers: plan.fichiers.map(({ nom, taille, sha256 }) => ({ nom, taille, sha256 })), le: new Date().toISOString() } };
  writeFileSync(c.pret, `${JSON.stringify(pret, null, 2)}\n`, { mode: 0o600 });
  ok('installation enregistrée (pret.json)');

  if (o.test) {
    titre('5. Banc d’essai (--test)');
    const fichierModele = join(c.modeles, plan.fichiers[0].nom);
    const b = await bancEssai({ c, binaire, fichierModele, threads, modele });
    const reco = recommandation({ ...b, modele });
    pret.benchmark = { ...(pret.benchmark ?? {}), [modele]: { ...b, recommandation: reco.niveau } };
    writeFileSync(c.pret, `${JSON.stringify(pret, null, 2)}\n`, { mode: 0o600 });
    console.log('\nRésumé du banc d’essai :');
    info(`chargement du modèle : ${b.chargementS === null ? '?' : `${b.chargementS.toFixed(0)} s`} ; génération : ${b.jetonsParSeconde} jetons/s ; lecture : ${b.lectureParSeconde} jetons/s`);
    info(`mémoire du moteur (pic) : ${b.memoireGo === null ? 'inconnue' : `${b.memoireGo} Go`} ; essais JSON réussis : ${b.essaisReussis}/${b.essais} (${threads} fils)`);
    info(reco.texte);
    if (b.essaisReussis < b.essais) info('Un essai a échoué : l’app le signalera aussi ; relancez --test, ou --forcer si le modèle semble abîmé.');
  } else {
    info('Pour mesurer la vitesse sur ce serveur : relancez avec --test (quelques minutes).');
  }
  afficherFin({ modele, threads, dossier });
}

function afficherFin({ modele, threads, dossier, simulation = false }) {
  titre(simulation ? 'Lignes qui seraient à ajouter' : 'À faire maintenant');
  console.log('\n  1) Ajoutez (ou modifiez) ces lignes dans ~/.appdashboard/esport.env :\n');
  console.log('IA_FOURNISSEUR=local');
  console.log(`IA_LOCALE_MODELE=${modele}`);
  console.log(`IA_LOCALE_THREADS=${threads}`);
  if (dossier !== resolve(dossierIaLocaleParDefaut())) console.log(`IA_LOCALE_DOSSIER=${dossier}`);
  console.log('\n  (Gardez IA_API_URL / IA_API_CLE / IA_MODELE si vous voulez l’API en secours.)');
  console.log('\n  2) Redémarrez l’app Esport :\n');
  console.log(`mkdir -p ~/application-enzo/esport/tmp && touch ~/application-enzo/esport/tmp/restart.txt`);
  console.log('\n  3) Esport › Jeux › Administration IA : choisissez « IA locale » ou « Locale d’abord, API en secours », puis « Tester l’IA locale ».');
  if (!simulation) console.log('\nIA locale prête\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  principal().catch(e => {
    console.error(`\n✖ ${e instanceof Arret ? e.message : (e?.stack ?? String(e))}\n`);
    process.exit(1);
  });
}

