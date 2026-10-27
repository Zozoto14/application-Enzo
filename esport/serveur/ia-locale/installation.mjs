/**
 * IA locale du serveur Esport (llama.cpp sur le processeur du serveur o2switch) : versions figées, modèles
 * proposés, emplacements et état de l'installation. Partagé par l'installateur (installer.mjs, lancé par
 * esport/serveur/installer-ia-locale.sh), le gestionnaire de processus (gestionnaire.mjs) et la config.
 *
 * Tout vit HORS du dépôt et hors de public_html, dans IA_LOCALE_DOSSIER (défaut ~/.appdashboard/ia-locale) :
 *
 *   ~/.appdashboard/ia-locale/
 *     moteur/            llama-server (binaire compilé, ou archive officielle décompressée)
 *     modeles/           modèle GGUF (Q4_K_M), téléchargé avec reprise et vérifié (SHA-256)
 *     outils/            micromamba + compilateur (le temps de la compilation seulement ; effacé ensuite)
 *     pret.json          écrit par l'installateur après vérification : moteur, modèles, mesures du --test
 *     etat/              au fonctionnement : serveur.json (verrou + pid), cle (clé d'accès tirée au hasard,
 *                        0600), mesures.json (dernière vitesse), travailleur.verrou
 *
 * Le déploiement automatique (deployer.sh) ne touche jamais à ce dossier.
 */

import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * llama.cpp : version figée (tag b11351 du 2 octobre 2026, commit vérifié). Trois façons de l'obtenir :
 *  - « officiel » : archive précompilée du projet (Ubuntu 22.04) : elle exige glibc 2.34 et libstdc++ de
 *    GCC 12 (GLIBCXX_3.4.30) : PAS CloudLinux 8 (glibc 2.28) ; prise seulement si la machine convient et
 *    que le binaire démarre vraiment ;
 *  - « compilation » (CloudLinux 8) : sources du tag (git, commit vérifié), compilées avec un GCC 14 récent
 *    obtenu sans droit administrateur (micromamba + paquets conda-forge figés, SHA-256 vérifiés), en
 *    binaire autonome (libstdc++ incluse : ne demande que glibc 2.27), pour tout processeur AVX2 ;
 *  - node-llama-cpp n'est PAS utilisé : ses binaires précompilés exigent eux aussi glibc 2.34, et sa
 *    compilation de repli est la même que la nôtre (avec en plus un moteur chargé DANS le processus Node).
 */
export const LLAMA_CPP = {
  version: 'b11351',
  commit: '631109b34da437a3c4a5ebd75091d677671392e3',
  depotGit: 'https://github.com/ggml-org/llama.cpp.git',
  officiel: {
    url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11351/llama-b11351-bin-ubuntu-x64.tar.gz',
    sha256: 'c800a3402548d57f408adcebe4e53b939141e34e09b7e4701c785435572d1fee',
    taille: 17_550_308,
    glibcMin: [2, 34],
  },
};

/** micromamba (gestionnaire de paquets conda autonome, glibc 2.17) : version figée, archive conda-forge. */
export const MICROMAMBA = {
  version: '2.9.0',
  url: 'https://conda.anaconda.org/conda-forge/linux-64/micromamba-2.9.0-0.tar.bz2',
  sha256: '8761c382127e6363bd9e0a2451aa3ef90d071a79133f736e2f759a3bf13040dd',
  taille: 6_988_090,
};

/** Liste figée (URL#SHA-256) des paquets du compilateur : GCC 14.4, cmake 4.4.3, make 4.4.1, sysroot glibc 2.28. */
export const FICHIER_OUTILS = new URL('./outils-compilation.lock', import.meta.url);

/**
 * Modèles proposés (instruct, licence permissive, GGUF Q4_K_M). Les fichiers et leur SHA-256 sont lus sur
 * Hugging Face (empreinte LFS publiée) pour une révision précise (commit), notée dans pret.json.
 *  - qwen2.5-7b (défaut) : Qwen2.5-7B-Instruct, Apache 2.0, très bon en français, anglais et JSON ;
 *  - qwen3-4b (option --petit) : Qwen3-4B-Instruct-2507, Apache 2.0, deux fois plus rapide. (Qwen2.5-3B
 *    n'est PAS sous licence permissive — « Qwen Research License » — d'où ce choix.)
 */
export const MODELES_IA_LOCALE = {
  'qwen2.5-7b': {
    nom: 'Qwen2.5-7B-Instruct (Q4_K_M)',
    licence: 'Apache-2.0',
    depot: 'Qwen/Qwen2.5-7B-Instruct-GGUF',
    // Le dépôt officiel découpe parfois le fichier en parties (…-00001-of-00002.gguf) : llama.cpp les lit toutes.
    motif: /^qwen2\.5-7b-instruct-q4_k_m(?:-\d{5}-of-\d{5})?\.gguf$/,
    tailleApprox: 4.7e9,
    ramGo: 6,
  },
  'qwen3-4b': {
    nom: 'Qwen3-4B-Instruct-2507 (Q4_K_M)',
    licence: 'Apache-2.0',
    depot: 'unsloth/Qwen3-4B-Instruct-2507-GGUF',
    motif: /^Qwen3-4B-Instruct-2507-Q4_K_M\.gguf$/,
    tailleApprox: 2.5e9,
    ramGo: 3.5,
  },
};
export const MODELE_IA_LOCALE_DEFAUT = 'qwen2.5-7b';
export const MODELE_IA_LOCALE_PETIT = 'qwen3-4b';

export const dossierIaLocaleParDefaut = () => join(homedir(), '.appdashboard', 'ia-locale');
export const journalIaLocaleParDefaut = () => join(homedir(), 'logs', 'esport-ia-locale.log');

/** Emplacements (absolus) sous le dossier de l'IA locale. */
export function cheminsIaLocale(dossier = dossierIaLocaleParDefaut()) {
  const d = resolve(dossier);
  const etat = join(d, 'etat');
  return {
    dossier: d,
    moteur: join(d, 'moteur'),
    modeles: join(d, 'modeles'),
    outils: join(d, 'outils'),
    pret: join(d, 'pret.json'),
    etat,
    verrouServeur: join(etat, 'serveur.json'),
    cle: join(etat, 'cle'),
    mesures: join(etat, 'mesures.json'),
    verrouTravailleur: join(etat, 'travailleur.verrou'),
  };
}

/** Le dossier est-il acceptable (absolu, hors public_html, hors du dépôt) ? Rend un message d'erreur ou null. */
export function dossierRefuse(dossier, depot) {
  if (!dossier || !isAbsolute(dossier)) return 'le dossier doit être un chemin absolu';
  const d = resolve(dossier);
  if (/(^|\/)public_html(\/|$)/.test(d)) return 'le dossier ne doit pas être dans public_html';
  if (depot) {
    const r = resolve(depot);
    if (d === r || d.startsWith(`${r}/`)) return 'le dossier ne doit pas être dans le dépôt';
  }
  return null;
}

export function lireJson(chemin, defaut = null) {
  try {
    return JSON.parse(readFileSync(chemin, 'utf8'));
  } catch {
    return defaut;
  }
}

/**
 * L'IA locale est-elle installée et vérifiée pour le modèle choisi ? Rapide (aucun lancement) : appelé
 * au démarrage du serveur et par le cron. Rend `{ installe, raison?, binaire, fichierModele, modele… }`.
 */
export function etatInstallationIaLocale({ dossier, modele = MODELE_IA_LOCALE_DEFAUT } = {}) {
  const c = cheminsIaLocale(dossier || dossierIaLocaleParDefaut());
  const def = MODELES_IA_LOCALE[modele];
  const base = { installe: false, dossier: c.dossier, modele, nomModele: def?.nom ?? modele, binaire: null, fichierModele: null, moteur: null, benchmark: null };
  if (!def) return { ...base, raison: 'modele-inconnu' };
  const pret = lireJson(c.pret);
  if (!pret || pret.version !== 1) return { ...base, raison: 'non-installee' };
  const binaire = pret.moteur?.binaire;
  try {
    if (typeof binaire !== 'string' || !binaire.startsWith(`${c.moteur}/`)) throw new Error('binaire');
    accessSync(binaire, constants.X_OK);
  } catch {
    return { ...base, raison: 'moteur-absent' };
  }
  const m = pret.modeles?.[modele];
  const fichiers = Array.isArray(m?.fichiers) ? m.fichiers : [];
  if (!fichiers.length) return { ...base, binaire, raison: 'modele-absent' };
  for (const f of fichiers) {
    const chemin = join(c.modeles, String(f.nom ?? ''));
    if (!/^[A-Za-z0-9._-]+\.gguf$/.test(String(f.nom ?? '')) || !existsSync(chemin) || statSync(chemin).size !== f.taille) return { ...base, binaire, raison: 'modele-absent' };
  }
  return {
    ...base,
    installe: true,
    raison: null,
    binaire,
    fichierModele: join(c.modeles, fichiers[0].nom),
    taille: fichiers.reduce((s, f) => s + f.taille, 0),
    moteur: { version: pret.moteur.version ?? null, route: pret.moteur.route ?? null },
    benchmark: pret.benchmark?.[modele] ?? null,
  };
}
