#!/usr/bin/env node
/**
 * Préparation de la session Mac, depuis le PC.
 *
 * Fait tout ce qui peut l'être à l'avance, pour que la séance sur la machine
 * empruntée se réduise à une commande et deux clics. Produit un dossier prêt
 * à copier sur une clé USB.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sortie = resolve(racine, 'pour-le-mac');

const executer = (commande, args, options = {}) =>
  execFileSync(commande, args, { cwd: racine, shell: true, ...options });

const etape = (numero, texte) => console.log(`\n[${numero}/5] ${texte}`);
const ok = texte => console.log(`  ✓ ${texte}`);
const alerte = texte => console.log(`  ! ${texte}`);

// --- 1. Clés de mise à jour ------------------------------------------------
etape(1, 'Clés de mise à jour');
const clePrivee = resolve(racine, 'cle-maj-privee.txt');
if (!existsSync(clePrivee)) {
  console.log('  Génération de la paire de clés…');
  executer('node', ['scripts/cles-maj.mjs'], { stdio: 'inherit' });
} else {
  ok('paire de clés déjà en place');
}
const publique = readFileSync(resolve(racine, 'src/maj/cle-publique.ts'), 'utf8').match(
  /'([0-9a-f]{64})'/,
)?.[1];
ok(`clé publique inscrite dans le code : ${publique?.slice(0, 16)}…`);

// --- 2. Vérifications ------------------------------------------------------
etape(2, 'Vérification du code');
executer('npx', ['tsc', '--noEmit'], { stdio: 'inherit' });
ok('types');
executer('npx', ['jest', '--silent'], { stdio: 'inherit' });
ok('tests');

// --- 3. Paquet JavaScript --------------------------------------------------
// Le fabriquer ici prouve que l'empaquetage fonctionne, et évite de découvrir
// une erreur d'import sur le Mac, où chaque minute compte.
etape(3, 'Épreuve d’empaquetage');
mkdirSync(sortie, { recursive: true });
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
  JSON.stringify(resolve(sortie, 'epreuve.jsbundle')),
]);
ok('le paquet JavaScript se construit sans erreur');

// --- 4. Dépôt transportable ------------------------------------------------
etape(4, 'Dépôt transportable');
const bundle = resolve(sortie, 'applibourse.bundle');
executer('git', ['bundle', 'create', JSON.stringify(bundle), '--all'], {
  stdio: 'inherit',
});
ok('applibourse.bundle (historique complet, sans node_modules)');

// --- 5. Aide-mémoire -------------------------------------------------------
etape(5, 'Aide-mémoire');
copyFileSync(resolve(racine, 'docs/build-ios.md'), resolve(sortie, 'build-ios.md'));
copyFileSync(resolve(racine, 'docs/widget.md'), resolve(sortie, 'widget.md'));
writeFileSync(
  resolve(sortie, 'A-FAIRE-SUR-LE-MAC.txt'),
  `SESSION MAC — AIDE-MEMOIRE
===========================

1. git clone applibourse.bundle applibourse
2. cd applibourse
3. bash scripts/session-mac.sh

Le script installe, verifie, active SQLCipher et prepare les pods.

Il reste TROIS gestes manuels :

  a. PATCH NATIF — ouvrir ios/AppliBourse/AppDelegate.swift et coller
     le corps de bundleURL() donne dans build-ios.md, etape 3.
     C'est lui qui rend toutes les mises a jour futures possibles
     sans Mac. Ne pas le sauter.

  b. SIGNATURE — ouvrir ios/AppliBourse.xcworkspace
     Onglet "Signing & Capabilities"
     Cocher "Automatically manage signing"
     Choisir votre equipe personnelle (votre identifiant Apple)
     En profiter pour renseigner teamID dans ios/ExportOptions.plist

  c. LANCEMENT — iPhone branche et deverrouille :
       npx react-native run-ios --device

PUIS, PENDANT QUE LE MAC EST ENCORE LA — voir docs/build-ios.md,
section "Premier lancement". Ne pas sauter cette etape : c'est le
seul moment ou un probleme peut encore etre diagnostique.

IMPORTANT
---------
Apres cette session, plus aucun Mac ne sera necessaire : les mises a
jour JavaScript se fabriquent sur le PC avec "npm run publier-maj".
Seul un changement de code natif en exigerait un nouveau, et tous les
modules natifs previsibles sont deja embarques.

Sauvegardez cle-maj-privee.txt dans Bitwarden. Sans elle, plus aucune
mise a jour ne sera possible.
`,
  'utf8',
);
ok('A-FAIRE-SUR-LE-MAC.txt, build-ios.md et widget.md copiés');

console.log(`\nTout est prêt dans : ${sortie}`);
console.log('Copiez ce dossier sur une clé USB.');
