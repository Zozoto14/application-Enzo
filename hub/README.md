# HUB

Tableau de bord central de « Application ENZO » : une tuile par application,
administration des accès des amis, 8 thèmes, personnalisation des tuiles
(ordre, taille, masquage, épinglage, densité, disposition) et registre
extensible d'applications.

## Où est réellement le code

Le code exécutable du hub reste dans **`portefeuille/src/hub/`**. Il n'a pas été
déplacé ici : il importe des modules du portefeuille (`../profils/profils`,
`../ui/ecrans/CarteProfils`, `../ui/ecrans/CarteSynchro`), et il est compilé
par le même Metro (iOS/Android), le même Vite (bureau), le même `tsc` et le
même Jest que l'application. Un dossier `hub/` à la racine obligerait à
réécrire ensemble alias `paths`, alias Vite, `moduleNameMapper` Jest et
`watchFolders`/`nodeModulesPaths` Metro, sans pouvoir tester Metro ici : le
risque de casser un build qui marche est trop grand.

| Fichier (`portefeuille/src/hub/`) | Rôle |
| --- | --- |
| `Hub.tsx` | écran d'accueil : tuiles, personnalisation |
| `Administration.tsx` | comptes des amis, identifiants, accès aux apps |
| `registre.tsx` | **registre des apps** : ajouter une app = ajouter une entrée |
| `types.ts` | contrat d'une app du hub |
| `permissions.ts` | qui voit quoi |
| `personnalisation.ts` | préférences des tuiles (clés `hub.prefs`, `hub.theme`) |
| `themes.ts` | les 8 thèmes |
| `infos.ts`, `web.ts` | infos en direct des tuiles, raccourcis clavier |
| `hub.test.ts` | tests |

Lancer/vérifier : voir `portefeuille/` (`npm run bureau`, `npx jest src/hub`).

## Ici (`hub/`)

- `maquette/hub-mockup.html` : maquette HTML autonome (ouvrir dans un navigateur).

## Identifiants

L'app du portefeuille a pour identifiant **`portefeuille`** (ancien nom :
`portfolio`). Les anciennes préférences et autorisations contenant `portfolio`
sont migrées automatiquement à la lecture (`migrerId` dans `personnalisation.ts`,
`nettoyerApps` dans `profils/profils.ts`).
