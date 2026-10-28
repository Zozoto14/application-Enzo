/**
 * Lancement du PROCESSUS DE FOND de l'IA locale (travailleur.mjs) : par l'app Esport dès qu'un travail
 * est demandé (brouillon, vérification), et par le cron (toutes les 5 minutes) en secours.
 *
 * Rien n'est lancé si un processus de fond travaille déjà (verrou etat/travailleur.verrou : pid, espace de
 * pid, heure de démarrage + battement). Comme pour le moteur, c'est le BATTEMENT qui fait foi : sous CageFS,
 * l'app et le cron ne voient pas forcément le processus de fond (`kill(pid, 0)` → ESRCH alors qu'il vit).
 * Sinon : `nice -n 19 node travailleur.mjs`, DÉTACHÉ (l'app ou le cron rendent la main tout de suite ; le
 * processus survit à un redémarrage de l'app), sorties dans ~/logs/esport-ia-locale.log. Arguments fixes
 * (aucune donnée venue d'une requête), pas de shell.
 */

import { spawn as spawnNode } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cheminsIaLocale, journalIaLocaleParDefaut } from './installation.mjs';
import { descriptionProcessus, envoyerSignal, identiteProcessus, ligneDeCommande, mortCertaine } from './processus.mjs';

export const SCRIPT_TRAVAILLEUR = fileURLToPath(new URL('./travailleur.mjs', import.meta.url));

/** Un verrou de processus de fond sans battement depuis ce délai est considéré mort. */
export const TRAVAILLEUR_MORT_MS = 10 * 60_000;

function trouverNice() {
  for (const c of ['/usr/bin/nice', '/bin/nice']) if (existsSync(c)) return c;
  return null;
}

/** Contenu du verrou du processus de fond : { pid, ns, boot, debut } (ancien format : le pid seul). */
export function contenuVerrouTravailleur(pid = process.pid) {
  return JSON.stringify({ pid, ...(pid === process.pid ? descriptionProcessus() : {}) });
}

export function lireVerrouTravailleur(chemin) {
  try {
    const t = readFileSync(chemin, 'utf8').trim();
    if (/^\d+$/.test(t)) return { pid: Number(t) };
    const v = JSON.parse(t);
    return v && Number.isInteger(v.pid) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Pid du processus de fond qui tient le verrou (battement récent et pas mort À COUP SÛR), ou null.
 * `systeme` (tests) : visibilité des processus simulée.
 */
export function travailleurActif(chemin, maintenant = Date.now(), systeme = {}) {
  try {
    const age = maintenant - statSync(chemin).mtimeMs;
    const v = lireVerrouTravailleur(chemin);
    if (!v || age >= TRAVAILLEUR_MORT_MS) return null;
    const desc = v.ns || v.boot ? { ns: v.ns ?? null, boot: v.boot ?? null, debut: v.debut ?? null } : null;
    return mortCertaine(v.pid, desc, systeme) ? null : v.pid;
  } catch {
    return null;
  }
}

/**
 * Processus de fond sans battement depuis TRAVAILLEUR_MORT_MS (bloqué) : SIGTERM (journalisé) seulement s'il est
 * IDENTIFIÉ (visible d'ici, notre script sur sa ligne de commande, même heure de démarrage) ; verrou retiré.
 */
function arreterBloque(chemin, { journal, role, systeme = {} } = {}) {
  const v = lireVerrouTravailleur(chemin);
  if (v && Number.isInteger(v.pid) && v.pid > 1) {
    const id = (systeme.identite ?? identiteProcessus)(v.pid);
    const memeDebut = !v.debut || id?.debut === v.debut;
    if (id && memeDebut && ligneDeCommande(v.pid).some(a => a === SCRIPT_TRAVAILLEUR)) {
      envoyerSignal(v.pid, 'SIGTERM', { cible: 'processus de fond', raison: `sans battement depuis ${Math.round(TRAVAILLEUR_MORT_MS / 60_000)} min (bloqué)`, journal, role });
    }
  }
  rmSync(chemin, { force: true });
}

/** Rend `{ lance, raison, pid? }`. `spawn`, `maintenant`, `fichierJournal` injectables (tests). */
export function lancerTravailleurIaLocale({ reglages, spawn = spawnNode, maintenant = Date.now(), fichierJournal = journalIaLocaleParDefaut(), script = SCRIPT_TRAVAILLEUR, role = null, systeme = {} } = {}) {
  if (!reglages?.installation?.installe) return { lance: false, raison: 'non installée' };
  const c = cheminsIaLocale(reglages.dossier);
  const pid = travailleurActif(c.verrouTravailleur, maintenant, systeme);
  if (pid) return { lance: false, raison: 'déjà en cours', pid };
  if (existsSync(c.verrouTravailleur)) arreterBloque(c.verrouTravailleur, { journal: fichierJournal, role, systeme });
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
