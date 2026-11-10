/**
 * Version EN SERVICE d'un serveur Node (relais ou Esport) : le commit du dépôt lu AU DÉMARRAGE (le code chargé en
 * mémoire), l'heure de démarrage, le pid, Node ; comparés au dernier commit déployé par deployer.sh
 * (~/.appdashboard/code-deploye). Un écart = l'app n'a pas redémarré après le déploiement (Passenger) : à
 * redémarrer dans cPanel › Setup Node.js App (docs/o2switch.md, « Dépannage »).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lireCommitGit, memeCommit } from './deploiement.mjs';

export const RACINE_DEPOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const dossierEtatParDefaut = (env = process.env) => env.DEPLOIEMENT_ETAT || join(homedir(), '.appdashboard');

/** Commit du dépôt : lu dans .git sans lancer git ; sinon (worktree, dépôt particulier) `git rev-parse HEAD`. */
export function commitDuDepot(depot = RACINE_DEPOT) {
  const lu = lireCommitGit(depot);
  if (lu) return lu;
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: depot, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/** Relevé fait UNE fois, au démarrage. */
export function infosDemarrage({ app, depot = RACINE_DEPOT, maintenant = Date.now, pid = process.pid, node = process.versions.node } = {}) {
  return { app, commit: commitDuDepot(depot), demarreLe: new Date(maintenant()).toISOString(), pid, node };
}

const lire = chemin => {
  try {
    return readFileSync(chemin, 'utf8').trim() || null;
  } catch {
    return null;
  }
};

/**
 * État à l'instant (route authentifiée) : `aJour` vaut false quand deployer.sh a déployé un autre commit depuis le
 * démarrage (redémarrage manquant), null quand on ne sait pas (pas de deployer.sh, dépôt sans .git).
 */
export function etatVersion(infos, { etatDir = dossierEtatParDefaut(), maintenant = Date.now } = {}) {
  const codeDeploye = lire(join(etatDir, 'code-deploye'));
  const aJour = codeDeploye && infos.commit ? memeCommit(codeDeploye, infos.commit) : null;
  return {
    ...infos,
    commitCourt: infos.commit ? infos.commit.slice(0, 7) : null,
    dureeS: Math.max(0, Math.round((maintenant() - Date.parse(infos.demarreLe)) / 1000)),
    codeDeploye,
    aJour,
    heure: new Date(maintenant()).toISOString(),
  };
}
