# Claude Office dans le hub

Claude Office est un bureau en pixel art qui montre les agents de Claude Code au travail (arrivées, outils,
pauses café, fil de discussion). Source : [W17ANT/agent-office](https://github.com/W17ANT/agent-office), fourche
`Zozoto14/Claude-Office-Multi`. Licence MIT, © 2026 W17ANT : texte complet dans
[`claude-office-LICENSE.txt`](claude-office-LICENSE.txt), mention reprise en tête de
`bureau/electron/claudeOffice.mjs` (qui reprend la logique de son `hooks/install-hooks.mjs`).

## Ce qui s'affiche où (onglet « Bureau », par défaut)

Le bureau des agents est **dessiné dans le hub** (`src/claudeOffice/Bureau.tsx`) : PC (Electron), site et
téléphone/PWA, sans serveur Claude Office à lancer, sans fenêtre à part et **sans rien installer sur l'appareil où
l'on regarde**. Un personnage par session de Claude Code, à son poste, animé selon l'état déduit des derniers
événements ; bulle avec la dernière demande résumée (secrets masqués) ; compteurs (au travail, inactifs, terminés,
demandes et outils du jour) ; détail au toucher ; thèmes clair et sombre ; « réduire les animations » respecté.

| États | Déduit de (dernier événement de la session) |
| --- | --- |
| Écrit du code | outil d'écriture (Edit, Write, MultiEdit…) il y a moins d'une minute |
| Utilise un outil | autre outil (Bash, Read, Grep…) il y a moins d'une minute |
| Réfléchit | demande envoyée, outil fini depuis plus d'une minute, fin d'un sous-agent |
| Inactif | fin de réponse, début de session, ou plus rien depuis 10 min |
| Terminé | fin de session (visible 30 min, puis rangée) ; sans événement depuis 3 h : session expirée, rangée |

Le hook n'enregistre que la **fin** des outils (PostToolUse) : « utilise un outil » veut dire « vient d'en finir un et
travaille encore ». Logique pure et testée : `src/claudeOffice/logiqueBureau.ts`.

| Où | Source | Fraîcheur |
| --- | --- | --- |
| PC (app Electron) | journal local, canal `claude-office:historique-activite` relu toutes les **2 s** (rien n'est relu si le journal n'a pas grandi) | « En direct · journal de ce PC » |
| Site, téléphone, autre PC | copie chiffrée déposée par le PC sur le relais, relue **chaque minute** (index seulement ; un dépôt n'est rouvert que si sa date change) | « Copie chiffrée · à jour il y a X min » ; l'état est calculé **à la date du dépôt**, figé et grisé si ce dépôt a plus de 10 min |

Tuile « Claude Office » (page Administration) : nombre d'agents au travail et inactifs ; « En direct sur ce PC » sur
le PC, sinon l'âge du dernier dépôt et la pastille « DIFFÉRÉ » (au lieu de « EN DIRECT »). Hors du PC, la tuile ne lit
que les petites présences, jamais les copies d'historique.

## Limites (honnêtes)

1. **Le hook reste nécessaire sur la machine où tourne Claude Code** (`npm run office:hooks`, ou « Installer le hook
   d'historique… » dans l'état vide du bureau sur le PC). C'est lui qui écrit le journal ; un appareil sans le hook
   n'apparaît pas. Rien à installer, en revanche, sur les appareils qui regardent.
2. **Pas de temps réel à distance.** Le relais (Cloudflare KV gratuit, ~1 000 écritures/jour, 2 écritures par dépôt)
   ne permet pas un flux en direct : le PC dépose sa copie chiffrée au plus toutes les **15 min** (désactivée par
   défaut, à activer dans l'onglet Bureau du PC : « Déposer la copie chiffrée de ce PC »). Facultative, la **présence
   rapide** dépose en plus l'activité récente (3 dernières heures, 300 événements, sans contenu d'outil) toutes les
   **5 min** pendant que Claude Code travaille, seulement si elle a changé, **48 fois par jour au plus** puis pause
   jusqu'au lendemain. Pire cas par PC : 96 + 48 dépôts = 288 écritures/jour. **Le Worker n'est pas modifié**
   (objets `office-historique-<appareil>` et `office-presence-<appareil>` de l'espace `principal`, jeton maître).
3. **PC fermé** : l'app de bureau doit tourner sur le PC pour déposer (le hook, lui, écrit toujours le journal).
4. Réservé au **Fondateur** (tuile et écran) ; la copie du relais au **compte principal** (jeton maître). Rien en clair
   sur le relais (XChaCha20-Poly1305, clé de synchronisation). L'écran rappelle que les bulles montrent ce que l'on
   écrit à Claude.

## Pourquoi le vrai Claude Office n'est pas embarqué

1. Claude Office est d'abord un **serveur Node local** (Express + WebSocket + SQLite `better-sqlite3`, `claude -p`)
   alimenté par des **hooks de Claude Code** : rien de cela ne peut tourner dans l'app web (Cloudflare Pages) ni sur
   le téléphone, et son interface React 18 + DOM ne s'intègre pas à l'arbre React Native du hub.
2. Ses ~100 Mo de sprites n'ont rien à faire dans le bundle du site : le bureau natif est fait de simples vues
   (aucune image, aucune police d'icônes).
3. Il reste disponible sur le PC en **option avancée** (« Options avancées : Claude Office complet en fenêtre à
   part… », repliée par défaut) : état du serveur, ouverture dans une fenêtre Electron à part, installation de ses
   hooks. On n'importe que le code utile (installation des hooks, rendue sûre).

## Où est quoi

| Fichier | Rôle |
| --- | --- |
| `src/claudeOffice/registre.ts` | Entrée du registre (`src/hub/registre.tsx`) : tuile « Claude Office », catégorie Admin, page « Administration » du hub (`page: 'administration'`) |
| `src/claudeOffice/Racine.tsx` | Écran : onglets Bureau / Historique ; sur le PC, options avancées (serveur, fenêtre à part, hooks) |
| `src/claudeOffice/Bureau.tsx` | Onglet « Bureau » : visuel natif, état vide, copie chiffrée et présence rapide (PC) |
| `src/claudeOffice/logiqueBureau.ts` | Déduction de l'état des agents, tri, expiration, compteurs, masquage d'appoint, libellés |
| `src/claudeOffice/activiteBureau.ts` | D'où vient l'activité : journal local (PC) ou dépôts du relais (ailleurs) |
| `src/claudeOffice/resumeHub.ts` | Résumé pour la tuile (`info` du registre, `contexte.claudeOffice`) |
| `src/claudeOffice/pont.ts` | Contrat du pont `window.applibourse.claudeOffice` (absent hors du PC) |
| `bureau/electron/claudeOffice.mjs` | Logique Node pure : aperçu, fusion, sauvegarde, écriture, sonde `/health` |
| `bureau/electron/claudeOfficeIpc.mjs` | Canaux `claude-office:*` du processus principal (confirmation native) |
| `scripts/office-hooks.mjs` | `npm run office:hooks` (hooks de Claude Office + hook d'historique) |
| `src/claudeOffice/Historique.tsx`, `bureau/electron/officeHistorique.mjs` | Onglet « Historique » et journal local : voir [`claude-office-historique.md`](claude-office-historique.md) |

Rien de Node/Electron n'entre dans le bundle web : `src/claudeOffice` n'appelle que le pont, absent sur le site.
Tests : `src/claudeOffice/bureau.test.tsx` (déduction, rendu, pont et copie simulés, présence, droits, aucun accès
réseau) ; e2e : `scripts/e2e-claude-office-bureau.mjs` (PC, site, téléphone 390×844, captures `docs/captures-claude-office/6…12`).

## Droits

`adminSeulement` (jamais proposée dans les autorisations d'un ami, même si la liste enregistrée est retouchée) et
`disponible` = rang **Fondateur** (compte principal ou compte promu Fondateur). Administrateur, gestionnaire et ami ne
voient ni la tuile ni l'écran (tests : `src/claudeOffice/claudeOffice.test.tsx`).

## Réglages et synchro

Les seuls réglages (dossier de Claude Office, adresse du serveur) sont **propres au PC** : gardés par le processus
principal dans `claude-office.json` des données de l'application. Ils ne sont pas synchronisés (un chemin et une
adresse 127.0.0.1 n'ont pas de sens sur un autre appareil) : **rien ne part sur le relais**. Les données de Claude
Office (historique, discussion) restent dans son dossier et `~/.agent-office`. Seules exceptions, facultatives et
désactivées par défaut : la copie **chiffrée** de l'historique des requêtes (voir
[`claude-office-historique.md`](claude-office-historique.md)) et la **présence rapide** chiffrée du bureau.

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
redémarrer Claude Code. Dans les options avancées de l'écran (PC), le serveur passe à « En marche » et « Ouvrir Claude Office » ouvre son interface
dans une fenêtre sans accès au pont d'AppDashboard, bornée à l'adresse locale (127.0.0.1/localhost seulement).
