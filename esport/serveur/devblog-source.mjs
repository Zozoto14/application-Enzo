/**
 * Source des changements du devblog automatique (docs/esport/devblog.md, « Publication automatique ») : l'historique
 * git du dépôt RÉELLEMENT DÉPLOYÉ sur le serveur (o2switch : ~/application-enzo, mis à jour par
 * esport/serveur/deployer.sh, qui note « code : <ancien> → <nouveau> » dans ~/logs/esport-deploy.log).
 *
 * Sûreté :
 *  - chemins FIXES : le dépôt est celui d'où tourne ce serveur (deux dossiers au-dessus de ce fichier), le journal
 *    est ~/logs/esport-deploy.log ; aucun chemin ne vient d'une requête, d'un réglage ou de la base ;
 *  - git est lancé SANS shell (execFile), avec un environnement minimal (aucune variable du serveur, donc aucun
 *    secret), un délai et une taille de sortie bornés ;
 *  - les identifiants de commit passés à git sont vérifiés (40 caractères hexadécimaux, ou 7 à 40) et l'existence
 *    du commit est contrôlée avant `git log ancien..nouveau` ;
 *  - seuls le sujet, le corps et la date de chaque commit sont lus (`--format`), jamais l'auteur ni les fichiers.
 *
 * Interface (injectée dans le noyau, simulée dans les tests) :
 *   tete()                     → hash du commit déployé (HEAD), ou null ;
 *   existe(hash)               → booléen ;
 *   commits(de, a, { max })    → [{ hash, date, sujet, corps }] du plus ancien au plus récent (sans les fusions) ;
 *   deploiements()             → [{ le, de, a }] lus dans le journal du déploiement (les plus récents à la fin).
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Dépôt déployé : la racine du dépôt dont ce fichier fait partie (esport/serveur/ → ../..). */
export const DEPOT_DEPLOYE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Journal de esport/serveur/deployer.sh. */
export const JOURNAL_DEPLOIEMENT = join(homedir(), 'logs', 'esport-deploy.log');

const MOTIF_HASH = /^[0-9a-f]{7,40}$/;
const SEP_CHAMP = '\x1f';
const SEP_COMMIT = '\x1e';
const TAILLE_JOURNAL_MAX = 2 * 1024 * 1024;

/** Lance git sans shell, environnement minimal, sortie et durée bornées. Rend la sortie, ou null en cas d'échec. */
function git(depot, args, { executer = execFile } = {}) {
  return new Promise(ok => {
    executer(
      'git',
      ['-C', depot, '-c', 'core.quotepath=off', '-c', 'log.showSignature=false', ...args],
      {
        shell: false,
        timeout: 15_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: homedir(), LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1' },
      },
      (erreur, sortie) => ok(erreur ? null : String(sortie ?? '')),
    );
  });
}

/** Lignes « AAAA-MM-JJ HH:MM:SS code : <ancien> → <nouveau> » du journal du déploiement. */
export function lireJournalDeploiement(texte) {
  const sortie = [];
  for (const l of String(texte ?? '').split('\n')) {
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) code : ([0-9a-f]{7,40}|aucun) → ([0-9a-f]{7,40})\s*$/.exec(l);
    if (m) sortie.push({ le: `${m[1]}T${m[2]}`, de: m[3] === 'aucun' ? null : m[3], a: m[4] });
  }
  return sortie;
}

export function sourceGitDepot({ depot = DEPOT_DEPLOYE, journal = JOURNAL_DEPLOIEMENT, executer } = {}) {
  const g = args => git(depot, args, { executer });
  return {
    async tete() {
      const h = (await g(['rev-parse', '--verify', 'HEAD^{commit}']))?.trim();
      return h && MOTIF_HASH.test(h) ? h : null;
    },
    async existe(hash) {
      if (typeof hash !== 'string' || !MOTIF_HASH.test(hash)) return false;
      return (await g(['cat-file', '-e', `${hash}^{commit}`])) !== null;
    },
    async commits(de, a, { max = 200 } = {}) {
      if (typeof a !== 'string' || !MOTIF_HASH.test(a)) return [];
      if (de !== null && (typeof de !== 'string' || !MOTIF_HASH.test(de))) return [];
      const n = Math.max(1, Math.min(500, Math.floor(Number(max) || 200)));
      const plage = de ? `${de}..${a}` : a;
      const sortie = await g(['log', '--no-merges', `--max-count=${n}`, '--reverse', `--format=%H${SEP_CHAMP}%cI${SEP_CHAMP}%s${SEP_CHAMP}%b${SEP_COMMIT}`, plage, '--']);
      if (sortie === null) return null;
      return sortie
        .split(SEP_COMMIT)
        .map(bloc => bloc.replace(/^\n+/, ''))
        .filter(Boolean)
        .map(bloc => {
          const [hash, date, sujet, corps] = bloc.split(SEP_CHAMP);
          return { hash: (hash ?? '').trim(), date: (date ?? '').trim(), sujet: (sujet ?? '').trim(), corps: (corps ?? '').trim() };
        })
        .filter(c => MOTIF_HASH.test(c.hash));
    },
    async deploiements() {
      try {
        const brut = await readFile(journal);
        return lireJournalDeploiement(brut.subarray(Math.max(0, brut.length - TAILLE_JOURNAL_MAX)).toString('utf8'));
      } catch {
        return [];
      }
    },
  };
}
