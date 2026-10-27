/**
 * Lancement du PROCESSUS DE FOND de l'IA locale (travailleur.mjs) : par l'app Esport dès qu'un travail
 * est demandé (brouillon, vérification), et par le cron (toutes les 5 minutes) en secours.
 *
 * Rien n'est lancé si un processus de fond travaille déjà (verrou etat/travailleur.verrou, pid + battement).
 * Sinon : `nice -n 19 node travailleur.mjs`, DÉTACHÉ (l'app ou le cron rendent la main tout de suite ; le
 * processus survit à un redémarrage de l'app), sorties dans ~/logs/esport-ia-locale.log. Arguments fixes
 * (aucune donnée venue d'une requête), pas de shell.
 */

import { spawn as spawnNode } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processusVivant } from './gestionnaire.mjs';
import { cheminsIaLocale, journalIaLocaleParDefaut } from './installation.mjs';

export const SCRIPT_TRAVAILLEUR = fileURLToPath(new URL('./travailleur.mjs', import.meta.url));

/** Un verrou de processus de fond sans battement depuis ce délai est considéré mort. */
export const TRAVAILLEUR_MORT_MS = 10 * 60_000;

function trouverNice() {
  for (const c of ['/usr/bin/nice', '/bin/nice']) if (existsSync(c)) return c;
  return null;
}

/** Pid du processus de fond qui tient le verrou (vivant et récent), ou null. */
export function travailleurActif(chemin, maintenant = Date.now()) {
  try {
    const age = maintenant - statSync(chemin).mtimeMs;
    const pid = Number(readFileSync(chemin, 'utf8').trim());
    return age < TRAVAILLEUR_MORT_MS && processusVivant(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** Processus de fond bloqué (pas de battement) : arrêté s'il est bien le nôtre, verrou retiré. */
function arreterBloque(chemin) {
  try {
    const pid = Number(readFileSync(chemin, 'utf8').trim());
    if (Number.isInteger(pid) && pid > 1 && readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(SCRIPT_TRAVAILLEUR)) process.kill(pid, 'SIGKILL');
  } catch {
    // Processus déjà parti (ou /proc illisible).
  }
  rmSync(chemin, { force: true });
}

/** Rend `{ lance, raison, pid? }`. `spawn`, `maintenant`, `fichierJournal` injectables (tests). */
export function lancerTravailleurIaLocale({ reglages, spawn = spawnNode, maintenant = Date.now(), fichierJournal = journalIaLocaleParDefaut(), script = SCRIPT_TRAVAILLEUR } = {}) {
  if (!reglages?.installation?.installe) return { lance: false, raison: 'non installée' };
  const c = cheminsIaLocale(reglages.dossier);
  const pid = travailleurActif(c.verrouTravailleur, maintenant);
  if (pid) return { lance: false, raison: 'déjà en cours', pid };
  if (existsSync(c.verrouTravailleur)) arreterBloque(c.verrouTravailleur);
  mkdirSync(dirname(fichierJournal), { recursive: true });
  const fd = openSync(fichierJournal, 'a');
  try {
    const nice = trouverNice();
    const commande = [process.execPath, '--max-old-space-size=384', script];
    const enfant = spawn(nice ?? commande[0], nice ? ['-n', '19', ...commande] : commande.slice(1), { detached: true, stdio: ['ignore', fd, fd], env: process.env, cwd: dirname(script) });
    enfant.on?.('error', () => undefined);
    enfant.unref?.();
    return { lance: true, raison: 'lancé', pid: enfant.pid ?? null };
  } finally {
    closeSync(fd);
  }
}
