# AppliBourse sur un téléphone Android

Le code du téléphone est le même que celui de l'ordinateur (React Native).
Il n'a encore jamais été compilé pour Android : la première compilation peut
révéler des erreurs dans les modules natifs (base chiffrée, notifications).
Envoyez-les telles quelles, elles se corrigent.

## 1. Installer Android Studio (une fois)

1. Téléchargez Android Studio sur developer.android.com/studio et installez-le
   avec les options par défaut.
2. Au premier lancement, laissez-le télécharger le « SDK » Android.
3. Dans Windows, ajoutez la variable d'environnement `ANDROID_HOME` :
   `C:\Users\zozot\AppData\Local\Android\Sdk`
   (Paramètres › Système › Informations système › Paramètres avancés ›
   Variables d'environnement › Nouvelle…).
4. Fermez et rouvrez le terminal.

## 2. Fabriquer l'application

Dans le dossier du projet :

```
git pull
npm install
npm run apk
```

Le fichier `android\app\build\outputs\apk\release\app-release.apk` est créé.

## 3. L'installer sur le téléphone

1. Copiez `app-release.apk` sur le téléphone (câble USB, Google Drive…).
2. Ouvrez-le depuis le téléphone ; Android demande d'autoriser l'installation
   d'applications « de source inconnue » : acceptez pour ce seul fichier.

## 4. Retrouver ses données sur le téléphone

Les deux appareils ne se parlent pas directement (aucun serveur) : on échange
une **sauvegarde chiffrée**.

1. Sur l'ordinateur : Sauvegarde › « Créer la sauvegarde ».
2. Copiez le fichier sur le téléphone (Drive, câble…).
3. Sur le téléphone : Sauvegarde › « Restaurer » la première fois, puis
   « Fusionner » les fois suivantes (les opérations des deux côtés sont
   réunies, sans doublon ; voir synchronisation.md).

## Ce qui diffère sur le téléphone

- **Podcast** : pas de revue de presse (les flux passent par le processus de
  l'ordinateur) ni de voix naturelles ; le texte de l'épisode reste lisible.
- **Notifications** : briefings et alertes passent par le réveil en
  arrière-plan d'Android, toutes les 15 minutes au mieux.
- Le reste (portefeuille, onglets, objectifs, exposition) est identique.
