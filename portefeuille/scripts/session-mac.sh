#!/usr/bin/env bash
#
# Session Mac, en une commande.
#
#   bash scripts/session-mac.sh
#
# Automatise tout ce qui peut l'être : dépendances, vérifications, activation
# de SQLCipher, pods, et contrôle que les modules natifs sont bien présents.
# Ne reste à faire à la main que ce qui exige l'interface de Xcode : choisir
# l'équipe de signature, et lancer sur l'appareil.

set -euo pipefail

bleu() { printf '\033[1;34m%s\033[0m\n' "$1"; }
vert() { printf '\033[1;32m%s\033[0m\n' "$1"; }
rouge() { printf '\033[1;31m%s\033[0m\n' "$1"; }

racine="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$racine"

if [[ "$racine" == *" "* ]]; then
  rouge "Le chemin du projet contient un espace : $racine"
  rouge "CMake echoue dans ce cas. Deplacez le projet vers ~/applibourse."
  exit 1
fi

bleu "[1/6] Outils"
command -v node >/dev/null || { rouge "node absent : brew install node"; exit 1; }
command -v pod  >/dev/null || { rouge "cocoapods absent : brew install cocoapods"; exit 1; }
xcode-select -p >/dev/null || { rouge "Outils Xcode absents : xcode-select --install"; exit 1; }
vert "  node $(node --version), cocoapods $(pod --version)"

bleu "[2/6] Dependances"
npm install

bleu "[3/6] Verification du code"
npx tsc --noEmit
npx jest --silent
vert "  tests et types au vert"

bleu "[4/6] Activation de SQLCipher"
# Sans ce reglage, op-sqlite se compile sans chiffrement et la base s'ouvrirait
# en clair. L'application refuse de demarrer dans ce cas, mais autant le
# configurer correctement du premier coup.
node - <<'JS'
const fs = require('node:fs');
const chemin = 'package.json';
const paquet = JSON.parse(fs.readFileSync(chemin, 'utf8'));
if (paquet['op-sqlite']?.sqlcipher === true) {
  console.log('  deja active');
} else {
  paquet['op-sqlite'] = { ...(paquet['op-sqlite'] ?? {}), sqlcipher: true };
  fs.writeFileSync(chemin, JSON.stringify(paquet, null, 2) + '\n');
  console.log('  active dans package.json');
}
JS

bleu "[5/6] Pods"
( cd ios && pod install )

bleu "[6/6] Controle des modules natifs"
manquants=0
for module in @op-engineering/op-sqlite react-native-get-random-values \
              react-native-biometrics react-native-fs @notifee/react-native; do
  if [ -d "node_modules/$module" ]; then
    vert "  present : $module"
  else
    rouge "  ABSENT  : $module"
    manquants=$((manquants + 1))
  fi
done

echo
if [ "$manquants" -gt 0 ]; then
  rouge "$manquants module(s) manquant(s) : npm install avant de continuer."
  exit 1
fi

vert "Preparation terminee. Il reste trois gestes manuels :"
echo
echo "  1. Patch natif — coller le corps de bundleURL() decrit dans"
echo "     docs/build-ios.md, etape 3. C'est lui qui rend les futures"
echo "     mises a jour possibles sans Mac."
echo
echo "  2. Signature — ouvrir ios/AppliBourse.xcworkspace dans Xcode,"
echo "     onglet Signing & Capabilities, cocher Automatically manage signing"
echo "     et choisir votre equipe personnelle."
echo
echo "  3. Lancement — iPhone branche et deverrouille :"
echo "       npx react-native run-ios --device"
echo
echo "Puis suivez la section « Premier lancement » de docs/build-ios.md."
