/**
 * Lancement du processus de transcription par le cron (esport/serveur/cron.mjs, toutes les 5 minutes).
 *
 * Rien n'est lancé si le moteur n'est pas installé, si la file est vide, ou si un processus travaille
 * déjà (verrou). Sinon : `nice -n 19 node travailleur.mjs`, DÉTACHÉ (le cron se termine tout de suite,
 * la transcription continue), sorties dans ~/logs/esport-transcription.log.
 */

import { spawn as spawnNode } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { servicesFileTranscription } from '../../noyau/medias/fileTranscription.mjs';
import { chemins } from './moteur.mjs';
import { verrouActif } from './travailleur.mjs';

export const SCRIPT_TRAVAILLEUR = fileURLToPath(new URL('./travailleur.mjs', import.meta.url));

function trouverNice() {
  for (const c of ['/usr/bin/nice', '/bin/nice']) if (existsSync(c)) return c;
  return null;
}

/** Un processus resté bloqué (verrou plus mis à jour depuis 30 min) est arrêté : son travail sera repris. */
function arreterBloque(verrou) {
  try {
    const pid = Number(readFileSync(verrou, 'utf8').trim());
    if (Number.isInteger(pid) && pid > 1 && readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('travailleur.mjs')) process.kill(pid, 'SIGKILL');
  } catch {
    // Processus déjà parti (ou /proc illisible) : rien à faire.
  }
  rmSync(verrou, { force: true });
}

/**
 * Rend `{ lance, raison, n? }`. `spawn` et `journal` injectables (tests) ; `fichierJournal` : où écrire les
 * sorties du processus.
 */
export async function lancerTravailleur({ base, config, maintenant = () => Date.now(), spawn = spawnNode, fichierJournal = join(homedir(), 'logs', 'esport-transcription.log') }) {
  const ts = config?.transcriptionServeur;
  if (!ts?.disponible) return { lance: false, raison: ts?.raison ?? 'non installée' };
  const c = chemins(ts);
  // Dernière décision notée (Administration : « le cron est-il passé ? qu'a-t-il décidé ? »).
  const noter = r => {
    try {
      writeFileSync(c.lanceur, JSON.stringify({ le: new Date(maintenant()).toISOString(), raison: r.raison, ...(Number.isFinite(r.n) ? { n: r.n } : {}) }));
    } catch {
      // Dossier absent : sans conséquence.
    }
    return r;
  };
  const n = await servicesFileTranscription({ base, maintenant, config: ts }).nombreAFaire();
  if (!n) return noter({ lance: false, raison: 'rien à faire', n: 0 });
  if (verrouActif(c.verrou)) {
    let pid = null;
    try {
      pid = Number(readFileSync(c.verrou, 'utf8').trim()) || null;
    } catch {
      pid = null;
    }
    return noter({ lance: false, raison: `déjà en cours${pid ? ` (pid ${pid})` : ''}`, n });
  }
  if (existsSync(c.verrou)) arreterBloque(c.verrou);
  mkdirSync(dirname(fichierJournal), { recursive: true });
  const fd = openSync(fichierJournal, 'a');
  try {
    const nice = trouverNice();
    const commande = [process.execPath, '--max-old-space-size=512', SCRIPT_TRAVAILLEUR];
    const enfant = spawn(nice ?? commande[0], nice ? ['-n', '19', ...commande] : commande.slice(1), { detached: true, stdio: ['ignore', fd, fd], env: process.env, cwd: dirname(SCRIPT_TRAVAILLEUR) });
    enfant.unref?.();
  } finally {
    closeSync(fd);
  }
  return noter({ lance: true, raison: 'lancé', n });
}
