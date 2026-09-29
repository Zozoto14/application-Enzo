/**
 * Mise à jour de l'interface au lancement, sans Electron : testable seul.
 *
 * Voir `principal.mjs` pour le principe. Ce module ne fait que du git, du
 * npm et des fichiers dans le dossier du projet.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function git(dossier, args, delai = 30_000) {
  return new Promise((resoudre, rejeter) => {
    execFile(
      'git',
      ['-C', dossier, ...args],
      { timeout: delai, windowsHide: true, encoding: 'utf8' },
      (erreur, sortie) => (erreur ? rejeter(erreur) : resoudre(sortie.trim())),
    );
  });
}

// ------------------------------------------------ Mise à jour au lancement
//
// L'interface (tout ce qui s'affiche) est reconstruite depuis le dossier du
// projet à chaque lancement où GitHub a du nouveau : git récupère le code,
// vite recompile l'interface en quelques secondes, et la fenêtre la charge
// de là. Pas d'installeur à relancer.
//
// Seul le « moteur » — ce fichier et le préchargement, empaquetés dans
// l'exécutable — ne peut pas se remplacer ainsi. Quand une mise à jour le
// touche, le bandeau propose la réinstallation habituelle.

export function executer(commande, args, dossier, delai = 600_000) {
  return new Promise((resoudre, rejeter) => {
    execFile(
      commande,
      args,
      { cwd: dossier, timeout: delai, windowsHide: true, shell: process.platform === 'win32', maxBuffer: 20 * 1024 * 1024 },
      (erreur, sortie, erreurs) =>
        erreur ? rejeter(new Error(`${commande} ${args.join(' ')} : ${String(erreurs || erreur.message).slice(-600)}`)) : resoudre(sortie),
    );
  });
}

/** Récupère le code de GitHub, sans jamais écraser un travail local. */
export async function recupererCode(dossier) {
  await git(dossier, ['fetch', '--quiet', 'origin', 'main'], 30_000);
  const local = await git(dossier, ['rev-parse', 'HEAD']);
  const distant = await git(dossier, ['rev-parse', 'origin/main']);
  if (local === distant) {
    return [];
  }
  try {
    await git(dossier, ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']);
  } catch {
    throw new Error('Le code local contient des modifications absentes de GitHub : mise à jour automatique suspendue.');
  }

  // npm réécrit parfois ce fichier sans rien changer d'utile : on le rend
  // à sa version suivie plutôt que de bloquer la mise à jour pour lui.
  const modifies = (await git(dossier, ['status', '--porcelain', '--untracked-files=no']))
    .split('\n')
    // « XY chemin » : le statut, puis le chemin.
    .map(ligne => ligne.trim().replace(/^\S+\s+/, ''))
    .filter(Boolean);
  if (modifies.includes('package-lock.json')) {
    await git(dossier, ['checkout', '--', 'package-lock.json']);
  }
  // Autre fichier modifié sur ce PC (npm, fins de ligne, une retouche) : il
  // est mis de côté avec `git stash` — récupérable par `git stash pop` —
  // plutôt que de bloquer toutes les mises à jour pour lui.
  const bloquants = modifies.filter(fichier => fichier !== 'package-lock.json');
  if (bloquants.length > 0) {
    await git(dossier, ['stash', 'push', '--quiet', '-m', `AppDashboard : mis de côté avant mise à jour (${bloquants.join(', ')})`]);
  }

  const titres = (await git(dossier, ['log', '--format=%s', 'HEAD..origin/main'])).split('\n').filter(Boolean);
  const changes = (await git(dossier, ['diff', '--name-only', 'HEAD', 'origin/main'])).split('\n').filter(Boolean);

  // La clé de signature n'est pas suivie : on la garde de côté au cas où.
  const cheminCle = join(dossier, 'cle-maj-privee.txt');
  const cle = existsSync(cheminCle) ? await readFile(cheminCle) : undefined;
  try {
    await git(dossier, ['merge', '--ff-only', '--quiet', 'origin/main'], 60_000);
  } finally {
    if (cle && !existsSync(cheminCle)) {
      await writeFile(cheminCle, cle);
    }
  }

  if (changes.includes('package.json') || changes.includes('package-lock.json')) {
    await executer('npm', ['install', '--no-audit', '--no-fund'], dossier);
  }
  return titres;
}

/**
 * Prépare l'interface à charger : celle du dossier du projet, à jour, ou à
 * défaut celle embarquée dans l'application.
 */
export async function preparerInterface({ embarquee, version, construire }) {
  const lancement = { appliquees: [], moteurPerime: false, nouveautesMoteur: [], erreur: undefined };
  const dossier = version?.dossierSource;
  if (!dossier || !existsSync(join(dossier, 'package.json'))) {
    return { chemin: embarquee, lancement };
  }
  const interfaceProjet = join(dossier, 'bureau', 'dist', 'index.html');
  const marqueur = join(dossier, 'bureau', 'dist', 'construit.json');

  try {
    lancement.appliquees = await recupererCode(dossier);
  } catch (erreur) {
    // Hors ligne ou dépôt modifié : on continue avec ce qu'on a.
    lancement.erreur = erreur instanceof Error ? erreur.message : String(erreur);
  }

  try {
    const tete = await git(dossier, ['rev-parse', 'HEAD']);
    let construit;
    try {
      construit = JSON.parse(await readFile(marqueur, 'utf8')).commit;
    } catch {
      construit = undefined;
    }
    if (construit !== tete || !existsSync(interfaceProjet)) {
      await (construire ?? (() => executer('npm', ['run', 'bureau:build'], dossier)))();
      await writeFile(marqueur, JSON.stringify({ commit: tete, le: new Date().toISOString() }));
    }

    if (version?.commit && version.commit !== tete) {
      const moteur = (await git(dossier, ['diff', '--name-only', version.commit, tete, '--', 'bureau/electron/lanceur.mjs']))
        .split('\n')
        .filter(Boolean);
      if (moteur.length > 0) {
        lancement.moteurPerime = true;
        lancement.nouveautesMoteur = (await git(dossier, ['log', '--format=%s', `${version.commit}..${tete}`, '--', 'bureau/electron/lanceur.mjs']))
          .split('\n')
          .filter(Boolean);
      }
    }
    return { chemin: interfaceProjet, lancement };
  } catch (erreur) {
    lancement.erreur = erreur instanceof Error ? erreur.message : String(erreur);
    return { chemin: existsSync(interfaceProjet) ? interfaceProjet : embarquee, lancement };
  }
}

