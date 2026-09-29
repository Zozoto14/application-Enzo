#!/usr/bin/env node
/**
 * Génère la paire de clés qui signera toutes les mises à jour futures.
 *
 * À lancer **une seule fois**, avant la session Mac. La clé publique est
 * inscrite dans le code, donc dans le binaire ; la clé privée reste sur le PC
 * et ne doit jamais en sortir.
 *
 * Perdre la clé privée, c'est perdre la possibilité de mettre à jour
 * l'application — définitivement, puisqu'il n'y aura plus de Mac pour
 * reconstruire un binaire avec une nouvelle clé publique. D'où l'insistance
 * du script à la faire sauvegarder.
 */

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cheminPublique = resolve(racine, 'src/maj/cle-publique.ts');
const cheminPrivee = resolve(racine, 'cle-maj-privee.txt');

const forcer = process.argv.includes('--forcer');

/**
 * Clé fournie de l'extérieur.
 *
 * Permet d'utiliser une valeur générée ailleurs — typiquement un mot de passe
 * aléatoire de 64 caractères hexadécimaux produit par Bitwarden, ce qui a
 * l'avantage d'être sauvegardé par construction. Toute suite de 32 octets
 * tirés au hasard est une clé Ed25519 valide.
 *
 * Ce qui n'est PAS acceptable : une phrase que l'on retient. Une clé doit être
 * imprévisible, pas mémorisable.
 */
const indexPrivee = process.argv.indexOf('--privee');
const fournie = indexPrivee === -1 ? undefined : process.argv[indexPrivee + 1]?.trim();

/**
 * Vérification d'une sauvegarde.
 *
 * Une clé mal recopiée dans le gestionnaire de mots de passe ne se découvre
 * qu'au moment où l'on en a besoin — c'est-à-dire trop tard, une fois le
 * binaire construit. Autant s'en assurer tout de suite.
 */
const indexVerifier = process.argv.indexOf('--verifier');
if (indexVerifier !== -1) {
  // Une valeur collée depuis un gestionnaire de mots de passe traîne souvent
  // des espaces ou un retour à la ligne : ils ne sont pas une erreur de
  // l'utilisateur, et le script n'a aucune raison de s'y arrêter.
  const candidate = (process.argv[indexVerifier + 1] ?? '').replace(/\s/g, '');
  const attendue = readFileSync(cheminPublique, 'utf8').match(/'([0-9a-f]{64})'/)?.[1];

  if (!/^[0-9a-fA-F]{64}$/.test(candidate)) {
    console.error('Ce n’est pas une clé : 64 caractères hexadécimaux attendus.');
    console.error(`  Reçu : ${candidate.length} caractère(s).`);
    if (/[g-zG-Z]/.test(candidate)) {
      console.error('  Elle contient des lettres au-delà de f : ce n’est pas de');
      console.error('  l’hexadécimal. Une clé générée par un gestionnaire de mots de');
      console.error('  passe classique ne convient pas ici.');
    }
    process.exit(1);
  }

  const normalisee = candidate.toLowerCase();

  // Confusion la plus fréquente, et elle est de la faute du script : la seule
  // clé qu'il affichait à l'écran était la publique.
  if (normalisee === attendue) {
    console.error('Vous avez collé la clé PUBLIQUE, pas la clé privée.');
    console.error('');
    console.error('  La clé publique est celle affichée à l’écran : elle vit dans');
    console.error('  le code et n’a pas besoin d’être sauvegardée.');
    console.error('');
    console.error('  La clé PRIVEE, celle à ranger dans Bitwarden, se trouve ici :');
    console.error(`    ${cheminPrivee}`);
    console.error('');
    console.error('  Pour l’afficher : npm run cles-maj -- --montrer');
    process.exit(1);
  }

  const derivee = bytesToHex(ed25519.getPublicKey(hexToBytes(normalisee)));
  if (derivee === attendue) {
    console.log('Sauvegarde correcte.');
    console.log('  Cette clé privée correspond bien à la clé publique du projet.');
    process.exit(0);
  }

  console.error('CETTE CLE NE CORRESPOND PAS au projet.');
  console.error(`  Clé publique attendue : ${attendue}`);
  console.error(`  Clé publique obtenue  : ${derivee}`);
  console.error('');
  console.error('Deux explications possibles :');
  console.error('  - la sauvegarde a été faite avant une régénération de la paire ;');
  console.error('  - la valeur a été tronquée ou mal recopiée.');
  console.error('');
  console.error(`Dans les deux cas, la clé qui fait foi est celle de ${cheminPrivee}`);
  console.error('Pour l’afficher : npm run cles-maj -- --montrer');
  process.exit(1);
}

/** Affiche la clé privée, pour la recopier dans le gestionnaire. */
if (process.argv.includes('--montrer')) {
  if (!existsSync(cheminPrivee)) {
    console.error('Aucune clé privée. Générez-en une : npm run cles-maj');
    process.exit(1);
  }
  const privee = readFileSync(cheminPrivee, 'utf8').trim();
  console.log('Clé PRIVEE, à ranger dans Bitwarden :');
  console.log('');
  console.log(`  ${privee}`);
  console.log('');
  console.log('Clé publique correspondante, déjà dans le code, rien à en faire :');
  console.log(`  ${bytesToHex(ed25519.getPublicKey(hexToBytes(privee)))}`);
  process.exit(0);
}

if (fournie !== undefined && !/^[0-9a-fA-F]{64}$/.test(fournie)) {
  console.error('Clé invalide : 64 caractères hexadécimaux attendus (32 octets).');
  console.error('');
  console.error('Dans Bitwarden : générer un mot de passe, type « Aléatoire »,');
  console.error('64 caractères, uniquement chiffres et lettres a-f.');
  process.exit(1);
}

if (existsSync(cheminPrivee) && !forcer) {
  const actuelle = readFileSync(cheminPublique, 'utf8').match(/'([0-9a-f]{64})'/)?.[1];
  console.log('Une paire de clés existe déjà.');
  console.log(`  Clé publique : ${actuelle ?? '(introuvable)'}`);
  console.log(`  Clé privée   : ${cheminPrivee}`);
  console.log('');
  console.log('En régénérer une invaliderait toutes les mises à jour signées');
  console.log("avec l'ancienne, et le binaire déjà construit ne les accepterait plus.");
  console.log('Pour le faire malgré tout : npm run cles-maj -- --forcer');
  console.log('Pour importer une clé générée ailleurs :');
  console.log('  npm run cles-maj -- --forcer --privee <64 caractères hexadécimaux>');
  process.exit(0);
}

const privee = fournie
  ? hexToBytes(fournie.toLowerCase())
  : ed25519.utils.randomSecretKey();
const publique = ed25519.getPublicKey(privee);

writeFileSync(
  cheminPublique,
  `/**
 * Clé publique de signature des mises à jour.
 *
 * Générée par \`npm run cles-maj\` et inscrite dans le binaire lors de l'unique
 * build iOS. L'application n'accepte que les paquets signés par la clé privée
 * correspondante, qui ne quitte jamais le PC.
 *
 * Ce fichier est généré : ne pas le modifier à la main.
 */

export const CLE_PUBLIQUE_MAJ = '${bytesToHex(publique)}';
`,
  'utf8',
);

writeFileSync(cheminPrivee, `${bytesToHex(privee)}\n`, 'utf8');

console.log(fournie ? 'Clé importée.' : 'Paire de clés générée.');
console.log('');
console.log('  Clé PRIVEE — c’est CELLE-CI qu’il faut sauvegarder :');
console.log('');
console.log(`    ${bytesToHex(privee)}`);
console.log('');
console.log(`  (egalement dans ${cheminPrivee})`);
console.log('');
console.log('  Clé publique, deja inscrite dans le code, rien a en faire :');
console.log(`    ${bytesToHex(publique)}`);
console.log('');
console.log('A FAIRE MAINTENANT : copier la clé PRIVEE ci-dessus dans Bitwarden,');
console.log('puis verifier la sauvegarde :');
console.log('  npm run cles-maj -- --verifier <ce que vous avez colle>');
console.log('');
console.log('Sans elle, plus aucune mise à jour ne sera possible, et il faudra');
console.log('un nouveau build iOS — donc un Mac — pour en réinstaller une autre.');
