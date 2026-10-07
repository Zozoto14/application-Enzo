#!/usr/bin/env node
/**
 * Fabrique l'application Android (fichier .apk) à installer sur un téléphone.
 *
 *   npm run apk
 *
 * Demande Android Studio (voir docs/android.md). Le fichier produit est
 * autonome : il embarque l'interface, sans serveur de développement.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const android = resolve(racine, 'android');

if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
  console.error(
    '\nAndroid Studio ne semble pas installé (variable ANDROID_HOME absente).\n' +
      'Suivez docs/android.md, étape 1, puis relancez « npm run apk ».',
  );
  process.exit(1);
}

const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
console.log('\nCompilation de l’application Android (plusieurs minutes la première fois)…');
execFileSync(gradle, ['assembleRelease'], { cwd: android, stdio: 'inherit', shell: process.platform === 'win32' });

const apk = resolve(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (existsSync(apk)) {
  console.log(`\nApplication prête : ${apk}\nCopiez ce fichier sur votre téléphone et ouvrez-le pour l’installer.`);
} else {
  console.error('\nLa compilation s’est terminée sans produire le fichier attendu.');
  process.exit(1);
}
