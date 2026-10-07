# HUB

Tableau de bord central de « Application ENZO » : une tuile par application,
administration des accès des amis, 8 thèmes, personnalisation des tuiles
(ordre, taille, masquage, épinglage, densité, disposition) et registre
extensible d'applications.

## Arborescence

```
hub/
├── README.md
├── maquette/hub-mockup.html   maquette HTML autonome (ouvrir dans un navigateur)
└── src/                       code du hub (alias `@hub`)
    ├── index.ts               point d'entrée : tout ce que l'hôte importe
    ├── types.ts               contrats : AppHub, ContexteHub, ProfilHub, ControleProfilsHub…
    ├── registre.ts            creerRegistre, appAdministration, ID_ADMINISTRATION
    ├── Hub.tsx                écran d'accueil : tuiles, personnalisation, thèmes
    ├── Administration.tsx     comptes des amis, identifiants, accès aux apps
    ├── identifiants.ts        mot de passe d'un ami, création de son coffre (CoffreInitialisable)
    ├── permissions.ts         qui voit quoi
    ├── personnalisation.ts    préférences des tuiles (clés `hub.prefs`, `hub.theme`), migrerId
    ├── themes.ts              les 8 thèmes
    ├── infos.ts, web.ts       infos en direct, clavier et préférences du navigateur
    └── hub.test.ts            tests
```

## Principe : le hub ne dépend d'aucune app

`hub/src` n'importe **aucun** module d'une app (seulement `react` et
`react-native`). Il définit des contrats, et l'application hôte (aujourd'hui
le portefeuille) les remplit :

| Le hub demande | Le portefeuille fournit |
| --- | --- |
| la liste des apps (`creerRegistre`) | `portefeuille/src/app/registreHub.ts` : `APP_PORTEFEUILLE` + `appAdministration({ QrCode })` |
| le profil ouvert et les primitives de profils (`ControleProfilsHub`) | `ControleProfils` (`src/ui/ecrans/CarteProfils.tsx`), construit par `bureau/index.tsx` |
| les données en direct des tuiles (`ContexteHub.donnees[idApp]`) | le résumé du portefeuille (`ResumePortefeuille`), publié par `src/app/App.tsx` |
| le stockage des préférences (`StockagePrefs`) | le stockage du profil, dans `App.tsx` |
| un coffre vierge et une source aléatoire (`creerAccesAmi`) | la `Session` du profil de l'ami et `aleatoireParDefaut` (`bureau/index.tsx`) |
| un composant de QR code (`ComposantQrCode`) | `QrCode` de `src/ui/ecrans/CarteSynchro.tsx` |

Les types de l'hôte sont compatibles par structure : le `Profil` du
portefeuille porte les champs de `ProfilHub`, sa `Session` respecte
`CoffreInitialisable`.

## Comment le portefeuille branche le hub

Le portefeuille importe `@hub` (ou `@hub/<module>` pour un module en données
pures, ex. `@hub/personnalisation`). L'alias pointe sur `../hub/src` et est
déclaré de façon cohérente dans `portefeuille/` :

- `tsconfig.json` : `paths` (`@hub`, `@hub/*`, et `react`/`react-native` vers
  `portefeuille/node_modules`, le hub n'ayant pas de `node_modules`) et
  `include` de `../hub/src` ;
- `vite.config.mjs` (bureau) : `resolve.alias`, `resolve.dedupe` (un seul
  React), `server.fs.allow` ;
- `jest.config.js` : `roots` (les tests de `hub/src` tournent avec ceux du
  portefeuille), `moduleNameMapper`, `moduleDirectories` ; Babel reprend
  `portefeuille/babel.config.js` ;
- `metro.config.js` (iOS/Android) : `watchFolders`, `resolveRequest`,
  `nodeModulesPaths`.

Pas de `package.json` ni de `node_modules` dans `hub/` : `npm ci` se fait
toujours dans `portefeuille/`.

## Ajouter une app au registre

1. Écrire sa définition `AppHub` (voir `src/types.ts`) : `id` stable
   (`[a-z0-9-]{2,32}`, enregistré dans les autorisations : ne plus le changer),
   `nom`, `categorie`, `description`, `icone`, `teinte`, et au besoin
   `info(contexte)` (tuile en direct, lit `contexte.donnees[id]`),
   `disponible(contexte)`, `adminSeulement`, `Racine` (écran de l'app).
2. L'ajouter à la liste de `creerRegistre([...])` dans
   `portefeuille/src/app/registreHub.ts`.
3. Si elle publie des données en direct, les ajouter à `donnees` dans le
   `contexteHub` de `App.tsx`.

Le hub en fait une tuile, l'Administration une case d'autorisation, sans
autre modification.

## Identifiants

L'app du portefeuille a pour identifiant **`portefeuille`** (ancien nom :
`portfolio`). Les anciennes préférences et autorisations contenant `portfolio`
sont migrées automatiquement à la lecture : `migrerId`/`IDS_HERITES` dans
`src/personnalisation.ts`, réutilisé par `nettoyerApps` dans
`portefeuille/src/profils/profils.ts`.

## Lancer, vérifier

Depuis `portefeuille/` : `npm run bureau` (bureau), `npx jest ../hub` (tests du
hub), `npm run verifier` (tsc, Jest, ESLint, hub compris).
