#!/usr/bin/env node
/**
 * Grave dans l'application de bureau la version du code qui la compose.
 *
 * Lancé juste avant `electron-builder` : il écrit, à côté du processus
 * principal, le commit compilé et le dossier du projet. Au démarrage,
 * l'application compare ce commit à celui de GitHub pour savoir si une
 * nouvelle version l'attend — et sait où lancer `npm run maj-pc`.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cible = resolve(racine, 'bureau/electron/version-build.json');

const git = (...args) =>
  execFileSync('git', args, { cwd: racine, encoding: 'utf8' }).trim();

let commit;
try {
  commit = git('rev-parse', 'HEAD');
} catch {
  // Pas un dépôt git : l'application se compile, mais ne saura pas se
  // comparer à GitHub.
  commit = undefined;
}

const version = {
  commit,
  dossierSource: racine,
  compileLe: new Date().toISOString(),
};

writeFileSync(cible, `${JSON.stringify(version, null, 2)}\n`);
console.log(`Version gravée : ${commit ? commit.slice(0, 7) : 'inconnue'}`);
