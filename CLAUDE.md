# AppliBourse & Projects - Work Method

## Development Branch
- **Repository**: w8gy9t2zn4-lgtm/Application-budget
- **Branch**: `claude/brave-cerf-bgs41s`

## Work Delegation Method
**From 2026-09-29 onwards, all work follows this method:**

### Core Principle
- **NEVER** do work directly with personal tools
- **ALWAYS** delegate to sub-agents via the Agent tool
- Plan first, then spawn agents in parallel when independent

### Model Routing
- **Opus 5.5** (`claude-opus-5-5`): Architecture, complex bugs, code reviews
- **Sonnet 5.5** (`claude-sonnet-5-5`): Modifications, tests, docs, refactoring
- **Haiku 4.5** (`claude-haiku-4-5-20251001`): Searches, summaries, exploration

### Agent Workflow
1. **Plan the task** (mental or brief outline)
2. **Spawn one sub-agent per task** with appropriate model
3. **Pass `model` parameter** to every Agent() call
4. **Launch independent tasks in parallel** (no dependencies)
5. **Read agent reports only**, never read files directly
6. **Act on findings** from agent summaries

### Example
```
// Wrong ❌
Read files, Grep for code, Edit files

// Right ✅
Agent({ 
  subagent_type: "Explore",
  model: "claude-haiku-4-5-20251001",
  prompt: "Find all API endpoints..." 
})
// → read report → delegate implementation to Sonnet agent
```

### When Not to Delegate
- One-off tool calls (Read, Bash, Edit) already using MCP servers
- Simple direct answers to questions
- But: if it requires research across files → Explore agent

---

## Repository Structure (multi-app "Application ENZO")
- `hub/` : HUB (README, maquette `hub/maquette/hub-mockup.html`). Code exécutable du hub : `portefeuille/src/hub/` (il dépend des modules du portefeuille, voir `hub/README.md`)
- `portefeuille/` : app de gestion de portefeuille (ex-AppliBourse) : `src/`, `bureau/`, `relais/`, `ios/`, `android/`, `scripts/`, `docs/`
- `budget/` : app « mon-budget » (`js/`, `css/`, `server/`, PWA)
- `docs/` : docs communes ; `README.md` : lancement de chaque app
- `.github/workflows/` : CI (iOS du portefeuille, chemins `portefeuille/...`)
- Ne jamais versionner `cle-maj-privee.txt`, `.env*`, `node_modules/`, builds
- L'id d'app du portefeuille est `portefeuille` (ancien `portfolio` migré à la lecture)

## Current Projects

### Portefeuille (AppliBourse) - `portefeuille/`
- Cross-platform React Native + react-native-web (Vite)
- Cloudflare Workers relay with encryption (XChaCha20-Poly1305)
- iOS via AltStore, PC desktop (Electron), rescue website
- Multi-profile system (admin + friends)
- Status: Core features stable, testing on iPad pending

### Budget - `budget/`
- PWA de suivi de budget, serveur Node (`npm start`)

### HUB Project - `hub/`
- Central dashboard for all apps, admin panel for access management, extensible registry of apps, 8 themes
- Status: implemented in `portefeuille/src/hub/`; mockup in `hub/maquette/`
