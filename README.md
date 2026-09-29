# Application ENZO

Dépôt multi-applications, un dossier par application.

| Dossier | Contenu |
| --- | --- |
| `portefeuille/` | Gestion de portefeuille boursier (ex-AppliBourse) : React Native + Vite/Electron, relais Cloudflare, iOS, Android |
| `budget/` | « mon-budget » : PWA de suivi de budget, serveur Node |
| `hub/` | HUB central : code (`hub/src/`, alias `@hub`), maquette, doc (voir `hub/README.md`) |
| `docs/` | Documentation commune |
| `.github/` | Workflows (compilation iOS du portefeuille) |

## Lancer chaque application

**Portefeuille (et hub)** — Node 22 recommandé
```bash
cd portefeuille
npm ci
npm run bureau          # interface dans le navigateur (Vite, port 5177)
npm run bureau:app      # fenêtre de bureau Electron (avec `npm run bureau` lancé)
npm test && npx tsc --noEmit
npm run bureau:build    # build de production
```
iPhone/iPad : voir `portefeuille/docs/iphone.md`. Le workflow
`.github/workflows/app-iphone.yml` compile l'IPA.

**Budget** — Node >= 22.5
```bash
cd budget
npm start               # serveur sur server/server.js
```
`npm test` (node --test tests/) attend un dossier `tests/` qui n'existe pas encore.

**Hub** : code dans `hub/src/`, sans `node_modules` à lui ; il s'ouvre dans l'app
du portefeuille, qui l'importe par l'alias `@hub` et le compile (Vite, Metro,
tsc, Jest depuis `portefeuille/` : `npx jest ../hub` pour ses seuls tests).
Maquette : `hub/maquette/hub-mockup.html`.

## Sécurité
Ne jamais versionner `cle-maj-privee.txt` (clé de signature des mises à jour du
portefeuille), les `.env*`, `node_modules/` ni les dossiers de build.
