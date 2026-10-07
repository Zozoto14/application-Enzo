# Application ENZO

Dépôt multi-applications, un dossier par application.

| Dossier | Contenu |
| --- | --- |
| `portefeuille/` | Gestion de portefeuille boursier (ex-AppliBourse) : React Native + Vite/Electron, relais Cloudflare, iOS, Android |
| `budget/` | « mon-budget » : PWA de suivi de budget, serveur Node |
| `hub/` | HUB central : maquette, doc, explications (le code du hub est dans `portefeuille/src/hub/`, voir `hub/README.md`) |
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

**Hub** : maquette `hub/maquette/hub-mockup.html` ; le hub réel s'ouvre dans
l'app du portefeuille.

## Sécurité
Ne jamais versionner `cle-maj-privee.txt` (clé de signature des mises à jour du
portefeuille), les `.env*`, `node_modules/` ni les dossiers de build.
