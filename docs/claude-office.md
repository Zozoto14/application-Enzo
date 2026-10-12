# Claude Office dans le hub

Claude Office est un bureau en pixel art qui montre les agents de Claude Code au travail (arrivées, outils,
pauses café, fil de discussion). Source : [W17ANT/agent-office](https://github.com/W17ANT/agent-office), fourche
`Zozoto14/Claude-Office-Multi`. Licence MIT, © 2026 W17ANT : texte complet dans
[`claude-office-LICENSE.txt`](claude-office-LICENSE.txt), mention reprise en tête de
`bureau/electron/claudeOffice.mjs` (qui reprend la logique de son `hooks/install-hooks.mjs`).

## Ce qui s'affiche où (onglet « Bureau », par défaut)

Le bureau des agents est **dessiné dans le hub** : PC (Electron), site et téléphone/PWA, sans serveur Claude Office à
lancer, sans fenêtre à part et **sans rien installer sur l'appareil où l'on regarde**. C'est un **open space vu en
isométrique**, organisé en **zones à thème** (`src/claudeOffice/SceneOpenSpace.web.tsx`, SVG + CSS, aucune image ni
dépendance), au sol teinté et au mobilier propre, chacune avec son enseigne et le **nombre d'agents présents** ; **jour**
en thème clair (soleil par les fenêtres), **nuit** en thème sombre (ville allumée, flaques de lumière, écrans).

Un personnage par session de Claude Code (peau, coiffure et accessoire tirés de l'identifiant de session, haut à la
couleur du projet). Il **arrive par la porte**, puis **marche jusqu'à la zone de son activité du moment** :

| Zone | Mobilier | Quand l'agent y va |
| --- | --- | --- |
| Atelier code | 8 bureaux à écran (lignes de code) | il écrit : Edit, Write, MultiEdit, NotebookEdit ; **et tout outil inconnu** |
| Salle des machines | baies serveurs à voyants, consoles | il lance des commandes : Bash, PowerShell, BashOutput… |
| Bibliothèque | étagères pleines, tables de lecture, fauteuil | il lit et cherche : Read, Grep, Glob, LS, MCP de lecture |
| Café web | comptoir, ordinateurs, ardoise, globe | il consulte le web : WebFetch, WebSearch, navigateur, MCP web |
| Salle de réunion | table, tableau blanc (vitrée) | il délègue ou planifie : Task, Agent, TodoWrite, ExitPlanMode |
| Coin réflexion | poufs, plantes, tapis rond | il réfléchit : demande reçue, pas d'outil récent |
| Accueil | porte, banque d'accueil, chaises | session ouverte, pas encore de demande |
| Détente | fauteuils, machine à café | inactif : fin de réponse vue (ou délai de la salle d'attente écoulé) |
| **Attend ta réponse** (guichet) | comptoir, sonnette, gyrophare | Claude demande une autorisation ou pose une question : **main levée**, pastille « ! » rouge |
| **Salle d'attente** | banquettes | il vient de **finir une tâche** (fin de réponse ou de session), pas encore vue |

- **Correspondance outil → zone** : une seule table, `CORRESPONDANCE_OUTILS` de `src/claudeOffice/zones.ts` (la
  première ligne qui reconnaît le nom gagne ; noms MCP `mcp__serveur__outil` compris ; sinon l'Atelier). Pour un outil
  de plus : une ligne (motif, zone, exemples) ; les exemples sont vérifiés par les tests.
- **Pas d'aller-retour frénétique** : les outils de la dernière **rafale** (20 s avant le dernier) votent, les plus
  récents pesant plus (demi-vie 6 s) ; puis un **séjour minimal de 12 s** dans une zone avant d'en changer — sauf vers
  ou depuis le guichet et la salle d'attente, immédiats (ils demandent ton attention, ou tu viens d'y répondre).
- **Places** : chaque zone a ses places (45 en tout) ; place choisie de façon **déterministe** (hachage, puis suivante
  libre). Zone pleine : l'agent reste où il est, l'enseigne indique « +N sans place » (jamais de chevauchement).
- **Trajets** par les couloirs (deux horizontaux, deux verticaux), sur la voie de droite selon le sens de marche,
  **planifiés sans collision** (un trajet ne part que s'il reste à 0,55 dalle au moins de tout autre marcheur).
- **Salle d'attente** : délai réglable (1, 5 — par défaut —, 10 ou 30 min, ou « jusqu'à ce que je l'aie vu »),
  compté depuis l'**horodatage réel de la fin** (même sur le site, d'après la copie). Bulle « Terminé · il y a X min »
  et récapitulatif : dernière demande, puis la réponse résumée si l'historique la contient (« contenu des outils »
  activé), sinon les outils utilisés et les fichiers modifiés (secrets masqués). « Marquer comme vu » : retenu **sur
  l'appareil seulement** (aucune écriture sur le relais) ; une session fermée repart alors avec son carton, une
  session ouverte va en Détente. Petite fête en arrivant.
- **Animation** : seuls les marcheurs bougent image par image (`requestAnimationFrame` bridé à ~30 i/s, arrêté dès que
  personne ne marche) ; changements de zone en attente réexaminés chaque seconde ; le reste en animations CSS. Tout se
  **gèle hors de l'écran ou onglet masqué**. « Réduire les animations » : personne ne marche, simple **fondu** quand un
  agent change de zone.
- **Accessibilité** : la scène est décorative (`aria-hidden`) ; la **liste des agents** (bouton par agent : projet,
  zone, état, dernière demande) porte la même information et ouvre le détail.
- **Téléphone** : vue rapprochée qui se fait glisser (textes de la scène agrandis) ou « Vue d'ensemble ». iPad et PC :
  scène entière. Partout dans l'écran : **cibles ≥ 44 px, textes ≥ 15 px** hors scène.
- **Mode « démo »** (« Voir la démo », partagé par les trois onglets) : cinq sessions fictives font le tour des
  zones, une sur deux attend une autorisation au guichet, des visiteurs finissent leur session (deux en salle d'attente
  dès le début), une session est en détente ; 30 jours d'historique fictif pour les statistiques et l'historique
  (lecture seule). Pastille et bandeau « DÉMO » ; rien de réel n'est lu ni déposé.
- **Hors du web** (application native) : `SceneOpenSpace.tsx`, une case par zone avec ses personnages.

### Autour de la scène

- **Mise en route** (en tête, état réel, mis à jour seul — `logiqueMiseEnRoute.ts`) : sur le PC, hook installé / à
  mettre à jour / absent, dernier événement reçu, copie chiffrée (et dernier dépôt), présence rapide ; ailleurs, compte
  principal relié, relais joignable, copie reçue (âge, « ancienne » au-delà d'1 h), appareils d'où elle vient,
  présence, dernier événement. Chaque ligne non verte a **une** action : bouton (installer/mettre à jour le hook,
  activer la copie, activer la présence, réessayer, voir la démo) et/ou commande à copier (`npm run office:hooks`).
  Tout est vert : une seule ligne « tout est prêt ».
- **Aujourd'hui** : sessions, demandes, temps actif (écarts de moins de 5 min entre deux événements d'une session),
  dernier projet, en une ligne.
- Pastilles **« N attendent ta réponse »** et **« N terminés à voir »** (ouvrent le détail du premier) ; bascule
  **Scène / Liste** mémorisée sur l'appareil (Liste : cartes groupées par zone, « Attend ta réponse » et « Terminés
  récemment » d'abord) ; **« ? »** : comment lire le bureau (zones, pastilles, « En direct » contre « Copie chiffrée · il
  y a X min », figé/grisé) ; légende des zones en boutons (explication au toucher ou au clavier).
- **Recherche** dans l'historique depuis le Bureau, **filtre par projet** (« Mettre en avant » estompe les autres,
  « Masquer » les retire de la scène et de la liste).
- **Détail d'un agent** (toucher un personnage ou une carte, `DetailAgent.tsx`) : projet, zone, depuis quand, ce qu'il
  attend ou ce qu'il a fini, compteurs (demandes, outils, temps d'outils, échecs, attentes) et **chronologie** de la
  session (demandes, outils avec leur durée, réflexions de plus de 15 s, attentes, fin) ; « Marquer comme vu »,
  « Voir dans l'Historique » (filtré sur la session).
- **Statistiques** (onglet, `Statistiques.tsx`, `logiqueStats.ts`) : requêtes par jour (7 ou 30 j), carte de chaleur
  jour × heure, outils les plus utilisés (durée moyenne quand le hook la connaît), projets les plus actifs, sessions,
  durée moyenne d'une session, temps actif. Calculé sur l'appareil (journal sur le PC, copie chiffrée ailleurs) ;
  graphiques en simples vues, chacun résumé en une phrase pour les lecteurs d'écran.
- **Réglages du bureau** (propres à l'appareil, `prefsOffice.ts`, jamais envoyés) : délai de la salle d'attente ; sur
  le PC, « Me prévenir quand Claude attend ma réponse » (**désactivé par défaut**) : notification de Windows par le
  mécanisme existant (`window.applibourse.systeme.notifier`), une fois par attente.

| États (liste) | Déduit de (dernier événement de la session) |
| --- | --- |
| Attend ta réponse | demande d'autorisation ou question (Notification « permission »/« question », PermissionRequest) |
| Écrit du code | outil d'écriture (Edit, Write, MultiEdit…) il y a moins d'une minute |
| Utilise un outil | autre outil (Bash, Read, Grep…) il y a moins d'une minute |
| Réfléchit | demande envoyée, outil fini depuis plus d'une minute, fin d'un sous-agent |
| Inactif | fin de réponse, début de session, ou plus rien depuis 10 min (en salle d'attente tant que la fin n'est pas vue) |
| Terminé | fin de session (en salle d'attente, puis visible 30 min) ; sans événement depuis 3 h : session expirée, rangée |

Logique pure et testée : `logiqueBureau.ts` (états, salle d'attente, récapitulatif), `zones.ts`, `logiqueScene.ts`.

Poids : la v3 ajoute environ 58 Ko minifiés (17 Ko compressés) au bundle du site, sans image ni dépendance.

### Le hook v3 (à réinstaller une fois)

Le hook d'historique écoute désormais aussi **PreToolUse** (aucune ligne au journal : un petit repère
`en-cours/<empreinte>` qui donne la **durée** de l'outil à sa fin, effacé aussitôt ; repères orphelins effacés après un
jour), **Notification** et **PermissionRequest** (type `attente`, motif `permission` ou `question`, message masqué ;
les rappels « Claude attend votre saisie » et messages techniques sont ignorés ; le hook n'écrit **jamais** sur la
sortie standard, donc ne décide rien à la place de l'utilisateur). Un hook installé avant est signalé « à mettre à
jour » (`etatHookHistorique`) : **relancer `npm run office:hooks`** (ou le bouton de la mise en route sur le PC)
n'ajoute que ces trois événements, puis redémarrer Claude Code. Sans cette mise à jour, tout marche, sans durée ni
« attend ta réponse ».

| Où | Source | Fraîcheur |
| --- | --- | --- |
| PC (app Electron) | journal local, canal `claude-office:historique-activite` relu toutes les **2 s** (rien n'est relu si le journal n'a pas grandi) | « En direct · journal de ce PC » |
| Site, téléphone, autre PC | copie chiffrée déposée par le PC sur le relais, relue **chaque minute** (index seulement ; un dépôt n'est rouvert que si sa date change) | « Copie chiffrée · à jour il y a X min » ; l'état est calculé **à la date du dépôt**, figé et grisé si ce dépôt a plus de 10 min |

Tuile « Claude Office » (page Administration) : nombre d'agents au travail et inactifs ; « En direct sur ce PC » sur
le PC, sinon l'âge du dernier dépôt et la pastille « DIFFÉRÉ » (au lieu de « EN DIRECT »). Hors du PC, la tuile ne lit
que les petites présences, jamais les copies d'historique.

## Idées non faites (et pourquoi)

- **Notification quand l'app est fermée ou sur le téléphone** : la notification « attend ta réponse » ne part que du PC,
  tant que l'onglet Bureau est ouvert. Ailleurs, il faudrait un service de notifications push et un dépôt par attente
  (écritures KV en plus, et du temps réel que le relais gratuit n'offre pas).
- **« Vu » partagé entre appareils** : volontairement local (aucune écriture KV de plus) ; vu sur le PC, l'agent reste
  « à voir » sur le téléphone jusqu'au délai.
- **Outil « en cours » en direct** : le hook ne note pas le début d'un outil au journal (seulement un repère pour sa
  durée), pour ne pas doubler la taille du journal et des copies ; « utilise un outil » reste « vient d'en finir un ».
- **Réponse complète dans la salle d'attente** : seulement si « Enregistrer aussi le contenu des outils » est activé
  (désactivé par défaut, par discrétion) ; sinon outils et fichiers.
- **Durée des sessions exacte** : le journal ne voit que les événements ; la durée est celle entre le premier et le
  dernier, le temps actif ignore les pauses de plus de 5 min.

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
| `src/claudeOffice/Racine.tsx` | Écran : onglets Bureau / Historique / Statistiques, démo partagée ; sur le PC, options avancées (serveur, fenêtre à part, hooks) |
| `src/claudeOffice/Bureau.tsx` | Onglet « Bureau » : en-tête, compteurs, scène, légende, liste des agents, démo, état vide, copie chiffrée et présence rapide (PC) |
| `src/claudeOffice/SceneOpenSpace.web.tsx` | L'open space en SVG isométrique (web, site, PC) : décor jour/nuit, postes, personnages, bulles, animations |
| `src/claudeOffice/SceneOpenSpace.tsx` | Même scène en vues simplifiées, hors du web (application native) |
| `src/claudeOffice/zones.ts` | Les zones, leurs libellés, la table outil → zone, la zone voulue (rafale) |
| `src/claudeOffice/logiqueScene.ts` | Plan en zones et places, couloirs et voies, trajets sans collision, hystérésis, phases (arrive, marche, fête, repart), apparence, gadgets, démo |
| `src/claudeOffice/logiqueMiseEnRoute.ts`, `MiseEnRoute.tsx` | Check-list « Mise en route », aide « ? » |
| `src/claudeOffice/logiqueStats.ts`, `Statistiques.tsx` | Résumé du jour, statistiques, chronologie d'une session, historique de démo ; onglet Statistiques |
| `src/claudeOffice/DetailAgent.tsx` | Panneau « Détail d'un agent » |
| `src/claudeOffice/prefsOffice.ts`, `uiOffice.tsx` | Réglages de l'appareil ; boutons, puces, interrupteurs (44 px, 15 px) |
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
réseau), `src/claudeOffice/scene.test.tsx` (zones et places, itinéraires et voies, trajets sans collision, hystérésis,
salle d'attente pleine, fondu, apparence, gadgets, démo, rendu SVG : zones, guichet, estompés, vide, réduit, thèmes) et
`src/claudeOffice/bureauV3.test.tsx` (outil → zone, rafales, attente, salle d'attente et « vu », récapitulatif, résumé
du jour, statistiques, chronologie, mise en route, réglages ; rendu : pastilles, détail, liste par zone, filtres,
aide, notification, statistiques, démo partagée, historique filtré) ; Node : `bureau/electron/officeHistorique.test.mjs`
(attentes, durée des outils, état « à mettre à jour »). E2e : `scripts/e2e-claude-office-bureau.mjs` (captures
`6…18`) et `scripts/e2e-claude-office-v3.mjs` (vrai hook ; Bibliothèque → Atelier → Salle d'attente, guichet,
mise en route, détail, « vu », historique filtré, statistiques, Liste mémorisée ; iPhone 390×844, iPad 820×1180 et
1024×768, PC, clair et sombre : débordement, cibles 44 px, textes 15 px ; captures `20…31`).

## Droits

`adminSeulement` (jamais proposée dans les autorisations d'un ami, même si la liste enregistrée est retouchée) et
`disponible` = rang **Fondateur** (compte principal ou compte promu Fondateur). Administrateur, gestionnaire et ami ne
voient ni la tuile ni l'écran (tests : `src/claudeOffice/claudeOffice.test.tsx`).

## Réglages et synchro

Les réglages du bureau (vue Scène/Liste, délai de la salle d'attente, fins « vues », notification) sont **propres à
l'appareil** (préférences du profil ouvert, jamais envoyées). Les réglages du vrai Claude Office (dossier, adresse du serveur) sont **propres au PC** : gardés par le processus
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
