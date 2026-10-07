# Claude Office dans le hub

Claude Office est un bureau en pixel art qui montre les agents de Claude Code au travail (arrivées, outils,
pauses café, fil de discussion). Source : [W17ANT/agent-office](https://github.com/W17ANT/agent-office), fourche
`Zozoto14/Claude-Office-Multi`. Licence MIT, © 2026 W17ANT : texte complet dans
[`claude-office-LICENSE.txt`](claude-office-LICENSE.txt), mention reprise en tête de
`bureau/electron/claudeOffice.mjs` (qui reprend la logique de son `hooks/install-hooks.mjs`).

## Choix d'intégration : tuile + écran d'intégration (option b)

1. Claude Office est d'abord un **serveur Node local** (Express + WebSocket + SQLite `better-sqlite3`, `claude -p`)
   alimenté par des **hooks de Claude Code** : rien de cela ne peut tourner dans l'app web (Cloudflare Pages) ni sur
   le téléphone, et son interface React 18 + DOM ne s'intègre pas à l'arbre React Native du hub.
2. Le hub a donc une vraie app `claude-office` (tuile, écran, droits) qui présente Claude Office, dit s'il tourne,
   l'ouvre dans une fenêtre Electron à part et installe ses hooks ; le code Node reste derrière le pont du bureau.
3. On n'importe que le code utile (installation des hooks, rendue sûre) : copier ses ~100 Mo de sprites dans ce
   dépôt n'apporterait rien, Claude Office se met à jour dans son propre dossier.

## Où est quoi

| Fichier | Rôle |
| --- | --- |
| `src/claudeOffice/registre.ts` | Entrée du registre (`src/hub/registre.tsx`) : tuile « Claude Office », catégorie Admin, page « Administration » du hub (`page: 'administration'`) |
| `src/claudeOffice/Racine.tsx` | Écran : état du serveur, ouvrir, dossier, aperçu/installation des hooks ; sur site/téléphone, la commande |
| `src/claudeOffice/pont.ts` | Contrat du pont `window.applibourse.claudeOffice` (absent hors du PC) |
| `bureau/electron/claudeOffice.mjs` | Logique Node pure : aperçu, fusion, sauvegarde, écriture, sonde `/health` |
| `bureau/electron/claudeOfficeIpc.mjs` | Canaux `claude-office:*` du processus principal (confirmation native) |
| `scripts/office-hooks.mjs` | `npm run office:hooks` (hooks de Claude Office + hook d'historique) |
| `src/claudeOffice/Historique.tsx`, `bureau/electron/officeHistorique.mjs` | Onglet « Historique » et journal local : voir [`claude-office-historique.md`](claude-office-historique.md) |

Rien de Node/Electron n'entre dans le bundle web : `src/claudeOffice` n'appelle que le pont, absent sur le site.

## Droits

`adminSeulement` (jamais proposée dans les autorisations d'un ami, même si la liste enregistrée est retouchée) et
`disponible` = rang **Fondateur** (compte principal ou compte promu Fondateur). Administrateur, gestionnaire et ami ne
voient ni la tuile ni l'écran (tests : `src/claudeOffice/claudeOffice.test.tsx`).

## Réglages et synchro

Les seuls réglages (dossier de Claude Office, adresse du serveur) sont **propres au PC** : gardés par le processus
principal dans `claude-office.json` des données de l'application. Ils ne sont pas synchronisés (un chemin et une
adresse 127.0.0.1 n'ont pas de sens sur un autre appareil) : **rien ne part sur le relais**. Les données de Claude
Office (historique, discussion) restent dans son dossier et `~/.agent-office`. Seule exception, facultative et
désactivée par défaut : la copie **chiffrée** de l'historique des requêtes (voir
[`claude-office-historique.md`](claude-office-historique.md)).

## Audit de `hooks/install-hooks.mjs` (original)

- **Ce qu'il modifie** : `~/.claude/settings.json` **et** `~/.gemini/settings.json` (les deux par défaut), clé
  `hooks` : une entrée `{ matcher: "*", command: node "<dossier>/hooks/agent-tracker.mjs" claude }` sur 7 événements
  (UserPromptSubmit, PreToolUse, PostToolUse, SessionStart, SessionEnd, Stop, SubagentStop) ; pour Gemini, 6
  événements et `hooksConfig.enabled = true`.
- **Pas de commande lancée ni d'accès réseau** par l'installeur lui-même. Mais il écrit **immédiatement**, sans
  aperçu ni confirmation ; sa sauvegarde `settings.json.office-backup` est **écrasée à chaque passage** (la première
  sauvegarde est perdue) ; écriture non atomique ; JSON invalide → plantage ; il retire toute commande contenant
  `agent-tracker`.
- **Le hook installé** (`agent-tracker.mjs`) tourne à **chaque** outil et chaque demande : il écrit les demandes, les
  entrées et les réponses des outils (tronquées à 4 000 caractères) **en clair** dans `~/.agent-office/history/*.jsonl`
  (des secrets passés en ligne de commande peuvent s'y retrouver), et les envoie en HTTP à `OFFICE_URL`
  (127.0.0.1:3334 par défaut, jeton de `~/.agent-office/auth-token`), délai 1,5 s, erreurs ignorées.

### Ce que fait `npm run office:hooks` à la place

Aperçu exact d'abord ; `--a-blanc` (`--dry-run`) n'écrit rien ; confirmation « oui » (refus sans terminal, sauf
`--oui`) ; copie **horodatée** `settings.json.claude-office-<date>.bak` avant écriture ; écriture atomique ; refus si le
fichier a changé depuis l'aperçu ou n'est pas du JSON valide ; **idempotent** (rien d'écrit si déjà en place) ;
Claude Code seul par défaut (`--gemini` pour Gemini CLI) ; seules les entrées `agent-tracker.mjs`/`.sh` sont
remplacées, les autres hooks ne sont jamais touchés ; `--desinstaller` les retire. Fichier : `CLAUDE_CONFIG_DIR` s'il
est défini, sinon `~/.claude/settings.json` ; `--settings <fichier>` pour un autre.

Dossier de Claude Office, **aucun chemin en dur** : `--dossier "<chemin>"`, sinon `CLAUDE_OFFICE_DIR`, sinon cherché
dans le dossier du projet ou à côté (`Claude Office`, `claude-office`, `Claude-Office-Multi`, `Claude-Office`). Exemple
Windows : `npm run office:hooks -- --dossier "C:\Users\zozot\Desktop\AppDashboard\Claude Office"`. Un dossier
`Claude Office/` posé dans le projet est ignoré par git (`.gitignore`).

Dans l'écran du hub (PC) : « Voir ce qui sera modifié » montre le même texte ; « Installer les hooks… » recalcule le
plan **dans le processus principal** et l'affiche dans une **boîte de dialogue native** (Annuler par défaut) : la
fenêtre ne choisit ni le fichier ni la commande, et rien ne s'installe à l'ouverture de l'écran.

## Mise en route sur le PC

```bash
git pull && npm ci                          # dans AppDashboard
cd "<dossier de Claude Office>" && npm ci    # Claude Office lui-même
cd "<AppDashboard>"
npm run office:hooks -- --a-blanc           # aperçu
npm run office:hooks                         # confirmation, sauvegarde, écriture
```

Puis démarrer Claude Office (`npm run build` puis `npm run server` dans son dossier, ou `Claude Office.vbs`) et
redémarrer Claude Code. La tuile du hub (PC) passe à « En marche » et « Ouvrir Claude Office » ouvre son interface
dans une fenêtre sans accès au pont d'AppDashboard, bornée à l'adresse locale (127.0.0.1/localhost seulement).
