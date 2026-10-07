# Session de build iOS

> **Plus besoin de Mac.** L'app se compile désormais sur un Mac de GitHub et
> s'installe par AltStore : voir [iphone.md](iphone.md). Les réglages natifs
> décrits ci-dessous (étapes 3, 4 et 4 bis) sont déjà appliqués dans `ios/`.
> Ce document reste pour mémoire.

Une seule session, sur un Mac emprunté. Après quoi **plus aucun Mac ne sera
nécessaire** : les mises à jour JavaScript se fabriquent sur le PC.

Tout ce qui pouvait être préparé à l'avance l'a été. Sur le PC, avant de
partir :

```bash
npm run preparer-mac
```

Ce script vérifie le code, éprouve l'empaquetage, génère les clés de signature
si besoin, et produit un dossier `pour-le-mac/` à copier sur une clé USB.

## Sur le Mac

### 1. Outils

```bash
xcode-select --install
brew install node watchman cocoapods
```

Xcode depuis l'App Store si absent. N'importe quelle version récente : la plus
récente n'est exigée que pour soumettre sur l'App Store.

### 2. Tout le reste, en une commande

```bash
git clone applibourse.bundle applibourse
cd applibourse
bash scripts/session-mac.sh
```

Le script installe les dépendances, vérifie types et tests, active SQLCipher,
prépare les pods et contrôle que les huit modules natifs sont présents.

**Choisissez un chemin sans espace** (`~/applibourse`) : CMake échoue sinon,
et le script s'arrête d'ailleurs avec ce message.

### 3. La modification native, à faire une seule fois

C'est **l'étape qui rend toutes les futures mises à jour possibles sans Mac**.
Sans elle, le binaire ne saura charger que le JavaScript figé au moment du
build.

Ouvrir `ios/AppliBourse/AppDelegate.swift` et remplacer le corps de
`bundleURL()` par celui-ci :

```swift
override func bundleURL() -> URL? {
#if DEBUG
  RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
  let gestionnaire = FileManager.default
  guard let documents = gestionnaire.urls(
    for: .documentDirectory, in: .userDomainMask
  ).first else {
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
  }

  let dossierMaj = documents.appendingPathComponent("maj-active")
  let paquet = dossierMaj.appendingPathComponent("main.jsbundle")
  let marqueur = dossierMaj.appendingPathComponent("en-essai")

  // Retour arrière automatique : si le marqueur est encore là, c'est que le
  // démarrage précédent n'a jamais abouti. La mise à jour est écartée, et
  // l'application repart sur le paquet d'origine plutôt que de rester bloquée.
  if gestionnaire.fileExists(atPath: marqueur.path) {
    try? gestionnaire.removeItem(at: dossierMaj)
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
  }

  if gestionnaire.fileExists(atPath: paquet.path) {
    // Marqueur posé avant de charger : c'est au JavaScript de le retirer une
    // fois démarré. Un paquet qui plante avant d'y parvenir sera écarté.
    gestionnaire.createFile(atPath: marqueur.path, contents: nil)
    return paquet
  }

  return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
}
```

**Pourquoi le retour arrière importe autant.** Sans lui, une mise à jour qui
plante au démarrage rendrait l'application inutilisable — et il n'y aurait
plus de Mac pour reconstruire un binaire. Avec lui, le pire des cas est un
démarrage raté suivi d'un retour automatique à la version précédente.

### 4. Réveil en arrière-plan, pour des briefings à jour

Une notification programmée à l'avance porte un texte figé au moment où elle
est programmée. Pour qu'un briefing du matin annonce la valeur **du matin**,
l'application doit se réveiller, rafraîchir les cours, puis composer le
message. C'est le rôle de `react-native-background-fetch`, qui exige deux
ajouts natifs.

Dans `ios/AppliBourse/Info.plist`, à l'intérieur du `<dict>` racine :

```xml
<key>UIBackgroundModes</key>
<array>
  <string>fetch</string>
  <string>processing</string>
</array>
<key>BGTaskSchedulerPermittedIdentifiers</key>
<array>
  <string>com.transistorsoft.fetch</string>
</array>
```

Puis, dans Xcode, onglet **Signing & Capabilities** de la cible principale :
ajouter **Background Modes**, et y cocher *Background fetch* et *Background
processing*.

**Si ces réglages manquent**, l'application fonctionne toujours : les
briefings n'afficheront simplement que les valeurs connues à la dernière
ouverture. L'écran des réglages le signalera.

À garder en tête : iOS décide seul du moment exact du réveil. Un briefing
« du matin » peut arriver avec du retard, et le système espace les réveils
s'il juge l'application peu utilisée. C'est une limite du système, pas un
défaut de réglage.

### 4 bis. Rendre les rapports et sauvegardes visibles dans Fichiers

Deux clés de plus dans le même `<dict>` racine de `Info.plist` :

```xml
<key>UIFileSharingEnabled</key>
<true/>
<key>LSSupportsOpeningDocumentsInPlace</key>
<true/>
```

Sans elles, le dossier Documents de l'application existe mais reste
invisible : les rapports annuels et les sauvegardes seraient écrits sans
qu'on puisse les atteindre.

Avec elles, l'application apparaît dans **Fichiers → Sur mon iPhone**. Un
rapport annuel s'ouvre alors dans Safari, et la feuille de partage l'imprime
en PDF — ce qui évite d'embarquer un module natif d'impression de plus.

### 5. Signature et lancement

Ouvrir `ios/AppliBourse.xcworkspace` dans Xcode :

- onglet **Signing & Capabilities**
- cocher **Automatically manage signing**
- choisir votre équipe personnelle (Xcode → Settings → Accounts si absente)

Puis, iPhone branché et déverrouillé :

```bash
npx react-native run-ios --device
```

### 6. Premier lancement — à ne pas remettre à plus tard

C'est le seul moment où un problème peut encore être diagnostiqué.

1. **« Protéger vos données »** : saisir un mot de passe long, généré par
   Bitwarden.
2. **« À noter maintenant »** : codes de récupération et clé TOTP. **Les noter
   sur papier immédiatement** — ils ne seront plus jamais affichés.
3. Ajouter la clé TOTP dans Google Authenticator, puis **verrouiller et
   déverrouiller** pour vérifier qu'un code fonctionne.
4. Créer le compte PEA, importer l'export de positions.
5. **Fermer et rouvrir** l'application : les données doivent être là.
6. Ouvrir **Réglages** et vérifier l'état des modules natifs : les huit
   doivent être signalés présents. Si l'un manque, la fonction qu'il porte
   sera simplement absente — l'écran dit laquelle.

Si l'application affiche un message sur SQLCipher, c'est que l'étape 2 du
script a échoué : la base ne serait pas chiffrée, et l'application refuse de
démarrer plutôt que de laisser croire le contraire.

### 7. Signature : sept jours, renouvelés par AltServer

AltStore PAL n'évite **pas** la réinstallation hebdomadaire : y publier une
application demande une adhésion au programme développeur Apple et un droit
de distribution alternative, ce qui n'a aucun sens pour une application
personnelle.

La réalité ne se contourne pas par du code : un compte Apple gratuit signe
pour sept jours, un compte payant pour un an. AltServer, sur le PC Windows,
re-signe automatiquement quand l'iPhone est sur le même Wi-Fi — ce qui rend
le compte gratuit vivable, à condition que le PC soit joignable chaque
semaine. Voir [iphone.md](iphone.md).

Deux problèmes distincts, à ne pas confondre : les mises à jour signées
règlent celui du **Mac** (livrer du code sans machine Apple) ; elles ne
prolongent pas une **signature** expirée.

## Après la session : les mises à jour

Sur le PC, pour toute nouvelle version :

```bash
npm run publier-maj -- --notes "Onglet Performances"
```

Le script vérifie le code, fabrique le paquet JavaScript, le signe avec la clé
privée et range le tout dans `maj/`. Copier `main.jsbundle` et
`manifeste.json` sur l'iPhone (Fichiers, AirDrop ou Syncthing), puis ouvrir
**Réglages → Mise à jour** dans l'application.

L'application refuse tout paquet qui n'est pas signé par votre clé, dont
l'empreinte ne correspond pas, ou dont le numéro de version n'est pas
strictement supérieur à celui installé.

**Sauvegardez `cle-maj-privee.txt` dans Bitwarden.** Sans elle, plus aucune
mise à jour n'est possible, et il faudrait un nouveau Mac pour réinstaller un
binaire portant une autre clé publique.

## Reconstruire plus tard, sans le Mac emprunté

Le besoin sera rare — voir le tableau ci-dessous — mais il faut que le chemin
existe. Trois options, et la différence tient surtout à l'USB.

### Le problème de l'USB

`npx react-native run-ios --device` installe directement sur un iPhone branché
en USB. Sur une machine distante ou une machine virtuelle, le téléphone n'est
pas branché. Le chemin devient alors :

```bash
# 1. Produire une archive, puis un .ipa
xcodebuild -workspace ios/AppliBourse.xcworkspace \
           -scheme AppliBourse \
           -configuration Release \
           -archivePath build/AppliBourse.xcarchive \
           archive

xcodebuild -exportArchive \
           -archivePath build/AppliBourse.xcarchive \
           -exportPath build/ipa \
           -exportOptionsPlist ios/ExportOptions.plist
```

Récupérer `build/ipa/AppliBourse.ipa`, le transférer sur l'iPhone, et
l'installer via AltStore PAL. C'est d'ailleurs le chemin normal d'AltStore :
il accepte un `.ipa` sans rien brancher.

`ios/ExportOptions.plist` est déjà dans le dépôt, en mode `development` —
celui d'une signature personnelle, sans compte développeur payant. **Une seule
ligne est à renseigner** : le `teamID`, que Xcode affiche sous Settings →
Accounts, ou que donne :

```bash
security find-identity -v -p codesigning
```

Autant le faire pendant la session sur le vrai Mac, où l'identifiant est sous
la main : le fichier sera prêt pour toutes les reconstructions futures.

### Machine virtuelle macOS sur le PC

L'option la plus indépendante : aucun tiers, aucun coût récurrent. Le projet
OSX-KVM fait tourner macOS sur du matériel non-Apple, ce qui suffit à compiler
et signer pour un usage personnel — la dernière version de Xcode n'étant
exigée que pour soumettre sur l'App Store.

Deux complications à connaître avant de s'y engager :

- **Processeur AMD.** macOS ne prévoit pas ces processeurs : il faut appliquer
  des correctifs de noyau spécifiques. C'est documenté et éprouvé, mais
  sensiblement plus capricieux que sur un Intel.
- **Hôte Windows.** OSX-KVM est un outil Linux. Il faut donc passer par WSL2
  avec virtualisation imbriquée, par un hyperviseur de bureau, ou par un
  double démarrage Linux — une couche de plus à faire fonctionner.

Zone grise légale, par ailleurs : la licence macOS la réserve au matériel
Apple.

### Mac loué à l'heure

Scaleway propose un Mac mini M4 à 0,22 €/heure avec un minimum facturé de
24 heures, soit environ 5 € par session. RentaMac, MacinCloud et MacStadium
font équivalent. C'est un vrai macOS, contrôlé en bureau à distance, avec le
chemin `.ipa` décrit plus haut.

Contrepartie : le code source part chez un tiers. Il ne contient aucun secret
— la clé privée de signature est exclue du dépôt, et le coffre vit sur
l'appareil — mais c'est à savoir.

### Android

Se compile depuis Windows, sans macOS d'aucune sorte. C'est le filet de
sécurité si tout le reste échoue.

## Ce qui exigerait malgré tout un nouveau build

| Changement | Nouveau build ? |
|---|---|
| Écrans, calculs, fiscalité, imports, cours | Non |
| Nouvel écran, nouvelle fonctionnalité en JavaScript | Non |
| Correction de bug | Non |
| **Nouveau module natif** | Oui |
| **Widget écran d'accueil** | Oui |
| **Extension iOS** (partage, Siri) | Oui |
| Mise à jour majeure de React Native | Oui |

Les **huit** modules natifs prévisibles sont déjà embarqués :

| Module | Ce qu'il permet |
|---|---|
| op-sqlite | Base chiffrée SQLCipher |
| get-random-values | Génération de clés |
| biometrics | Face ID en raccourci |
| fs | Fichiers : sauvegardes, mises à jour, Syncthing |
| notifee | Notifications : briefings et alertes de cours |
| image-picker | Pièce justificative jointe à une opération |
| calendar-events | Détachements de dividende au calendrier Apple |
| background-fetch | Réveil périodique : briefings à jour |

Ils couvrent l'ensemble de la feuille de route V1 à V3 du cadrage, à une
exception près.

**Si un module refuse de compiler**, retirez-le de `package.json`, relancez
`pod install` et recommencez. L'application est conçue pour s'en passer :
chaque module est chargé à la demande, et l'écran des réglages affiche ce que
le binaire a réellement embarqué. Mieux vaut un build réussi sans le
calendrier qu'une session perdue.

**Le widget d'écran d'accueil a été écarté**, et c'est une décision, pas un
oubli : l'entitlement App Groups n'est pas délivré aux identifiants Apple
gratuits, sans quoi un widget n'a aucun moyen de lire les données de
l'application. Le raisonnement complet est dans [widget.md](widget.md).

Sa fonction — voir la valeur du portefeuille sans ouvrir l'application — est
assurée par les **notifications**, qui ne demandent ni extension ni
entitlement.

Le bilan annuel en PDF, lui, ne demande aucun module : l'application produit
un fichier HTML, et iOS sait l'imprimer en PDF depuis le menu de partage.
