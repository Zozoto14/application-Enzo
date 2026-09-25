#!/usr/bin/env node
/**
 * Fabrique et signe une mise à jour JavaScript, depuis le PC.
 *
 * C'est la commande à lancer pour toute nouvelle version après la session
 * Mac : elle vérifie le code, produit le paquet, le signe, et range le tout
 * dans un dossier à copier sur l'appareil.
 *
 *   npm run publier-maj -- --notes "Onglet Performances"
 *
 * Aucun Mac n'intervient : `react-native bundle` tourne sous Windows.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cheminPrivee = resolve(racine, 'cle-maj-privee.txt');
const cheminEtat = resolve(racine, 'maj/version.json');

const argument = nom => {
  const index = process.argv.indexOf(`--${nom}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

function executer(commande, args) {
  execFileSync(commande, args, { cwd: racine, stdio: 'inherit', shell: true });
}

if (!existsSync(cheminPrivee)) {
  console.error('Clé privée introuvable. Lancez d’abord : npm run cles-maj');
  process.exit(1);
}

// --- 1. Vérifications, avant de produire quoi que ce soit ------------------
// Publier une mise à jour qui ne compile pas condamnerait l'application sur
// l'appareil : les contrôles ne sont donc pas optionnels.
console.log('\n[1/4] Vérification du code');
executer('npx', ['tsc', '--noEmit']);
executer('npx', ['jest', '--silent']);

// --- 2. Fabrication du paquet ---------------------------------------------
console.log('\n[2/4] Fabrication du paquet JavaScript');
const dossierMaj = resolve(racine, 'maj');
mkdirSync(dossierMaj, { recursive: true });
const cheminPaquet = resolve(dossierMaj, 'main.jsbundle');

executer('npx', [
  'react-native',
  'bundle',
  '--platform',
  'ios',
  '--dev',
  'false',
  '--entry-file',
  'index.js',
  '--bundle-output',
  JSON.stringify(cheminPaquet),
]);

// --- 3. Signature ----------------------------------------------------------
console.log('\n[3/4] Signature');
const paquet = new Uint8Array(readFileSync(cheminPaquet));
const precedente = existsSync(cheminEtat)
  ? JSON.parse(readFileSync(cheminEtat, 'utf8')).version
  : 0;
const version = Number(argument('version') ?? precedente + 1);

const base = {
  format: 1,
  version,
  date: new Date().toISOString().slice(0, 10),
  empreinte: bytesToHex(sha256(paquet)),
  taille: paquet.length,
};

// Corps sérialisé champ par champ, dans un ordre fixe : l'ordre des clés d'un
// objet n'est pas garanti identique entre le PC et l'appareil.
const corps = utf8ToBytes(
  [
    `format=${base.format}`,
    `version=${base.version}`,
    `date=${base.date}`,
    `empreinte=${base.empreinte}`,
    `taille=${base.taille}`,
  ].join('\n'),
);

const clePrivee = readFileSync(cheminPrivee, 'utf8').trim();
const manifeste = {
  ...base,
  notes: argument('notes'),
  signature: bytesToHex(ed25519.sign(corps, hexToBytes(clePrivee))),
};

writeFileSync(
  resolve(dossierMaj, 'manifeste.json'),
  `${JSON.stringify(manifeste, null, 2)}\n`,
  'utf8',
);
writeFileSync(cheminEtat, `${JSON.stringify({ version }, null, 2)}\n`, 'utf8');

// --- 4. Récapitulatif ------------------------------------------------------
const mio = (paquet.length / 1024 / 1024).toFixed(2);
console.log(`\n[4/4] Mise à jour ${version} prête`);
console.log(`  Dossier  : ${dossierMaj}`);
console.log(`  Paquet   : main.jsbundle (${mio} Mio)`);
console.log('  Manifeste: manifeste.json');
if (manifeste.notes) {
  console.log(`  Notes    : ${manifeste.notes}`);
}
console.log('');
console.log('Copiez ces deux fichiers sur l’iPhone (Fichiers, AirDrop ou Syncthing),');
console.log('puis ouvrez Réglages → Mise à jour dans l’application.');
