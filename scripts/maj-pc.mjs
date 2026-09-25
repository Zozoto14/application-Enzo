#!/usr/bin/env node
/**
 * Met à jour l'application de bureau installée sur ce PC.
 *
 *   npm run maj-pc
 *
 * Récupère le code poussé sur GitHub, réinstalle les dépendances, recompile
 * l'installeur Windows puis le lance : il ne reste qu'à cliquer sur Suivant.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function executer(commande, args) {
  execFileSync(commande, args, { cwd: racine, stdio: 'inherit', shell: true });
}

// --- 1. Récupérer le code ---------------------------------------------------
console.log('\n[1/4] Récupération du code depuis GitHub');

// La clé de signature n'est plus suivie par git : un pull qui la retire du
// dépôt la supprimerait aussi du disque. On la garde en mémoire le temps du
// pull, et on la remet si elle a disparu.
const cheminCle = resolve(racine, 'cle-maj-privee.txt');
const cle = existsSync(cheminCle) ? readFileSync(cheminCle) : undefined;
const remettreCle = () => {
  if (cle && !existsSync(cheminCle)) {
    writeFileSync(cheminCle, cle);
    console.log('Clé de signature cle-maj-privee.txt conservée.');
  }
};

try {
  executer('git', ['pull']);
  remettreCle();
} catch {
  remettreCle();
  console.error(
    '\nLe git pull a échoué. Le plus souvent, un fichier a été modifié sur ce PC :\n' +
      'lancez "git status" pour voir lequel.',
  );
  process.exit(1);
}

// --- 2. Dépendances ---------------------------------------------------------
console.log('\n[2/4] Installation des dépendances');
executer('npm', ['install']);

// --- 3. Compilation ---------------------------------------------------------
console.log('\n[3/4] Compilation de l’installeur');
executer('npm', ['run', 'bureau:exe']);

// --- 4. Lancement de l'installeur -------------------------------------------
// package.json est relu ici : le git pull a pu changer le dossier de sortie.
console.log('\n[4/4] Lancement de l’installeur');
const config = JSON.parse(readFileSync(resolve(racine, 'package.json'), 'utf8'));
const sortie = resolve(racine, config.build?.directories?.output ?? 'dist');

const installeurs = existsSync(sortie)
  ? readdirSync(sortie)
      .filter(nom => /setup.*\.exe$/i.test(nom))
      .map(nom => resolve(sortie, nom))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  : [];

if (installeurs.length === 0) {
  console.error(`\nAucun installeur trouvé dans ${sortie}.`);
  process.exit(1);
}

console.log(`→ ${installeurs[0]}`);
spawn(installeurs[0], [], { detached: true, stdio: 'ignore' }).unref();
console.log('\nL’installeur est ouvert : fermez AppliBourse si elle tourne, puis suivez les étapes.');
