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
- **Accessibilité** : le dessin est décoratif (`aria-hidden`), mais chaque personnage (et sous-agent) a au-dessus de
  lui un **bouton transparent ≥ 44 px** (Tab, libellé « projet, zone : ce qu'il fait ») dont le focus montre la carte
  (`aria-describedby`) et qu'Entrée ouvre ; la **liste des agents** sous la scène porte la même information.
- **Taille** : voir « La scène v4 » ci-dessous (plein cadre, zoom). Partout dans l'écran : **cibles ≥ 44 px, textes
  ≥ 15 px** hors scène.
- **Mode « démo »** (« Voir la démo », partagé par les trois onglets) : cinq sessions fictives font le tour des
  zones, une sur deux attend une autorisation au guichet, des visiteurs finissent leur session (deux en salle d'attente
  dès le début), une session est en détente ; 30 jours d'historique fictif pour les statistiques et l'historique
  (lecture seule). Pastille et bandeau « DÉMO » ; rien de réel n'est lu ni déposé.
- **Hors du web** (application native) : `SceneOpenSpace.tsx`, une case par zone avec ses personnages.

### La scène v4 : plus grande, moins de texte, détails au survol

`PlateauScene.web.tsx` (caméra, cartes, plein écran, relecture, mini-carte ; logique pure : `logiqueCamera.ts`,
`logiqueRelecture.ts`, `sousAgentsScene.ts`, tests `sceneV4.test.tsx`, e2e `scripts/e2e-claude-office-v4-scene.mjs` ;
captures `docs/captures-claude-office/v4-*.jpg`, avant/après : `v4-avant-pc-sombre.jpg` / `v4-pc-sombre.jpg`,
`v4-avant-iphone-clair.jpg` / `v4-iphone-clair.jpg`).

- **Plein cadre** : la scène prend toute la largeur et la hauteur disponible (PC : tout l'open space d'un coup ;
  iPhone et iPad portrait : vue rapprochée lisible, échelle ≥ 0,78 sur iPhone). Au-dessus, **une seule barre** :
  fraîcheur, « ✋ N attendent ta réponse », « ✓ N terminés à voir », filtre actif, Scène / Liste, « ? », Démo et
  **Options ▾** (résumé du jour, compteurs, recherche dans l'historique, filtres par projet, légende des zones, aide
  des gestes). Sur l'onglet Bureau, la présentation de l'app disparaît et la page s'élargit (1680 px au plus).
- **Caméra** : molette (autour du pointeur ; dézoomée au maximum, la page défile normalement), glisser avec une
  inertie légère, pincer au doigt, **+ / − / Recentrer** (clavier : + − 0 et flèches quand la scène a le focus),
  **double-clic / double-tap sur une zone** pour la cadrer, **mini-carte** repliable (cadre de vue, toucher pour s'y
  rendre ; repliée par défaut sur téléphone, choix mémorisé sur l'appareil). Bornes : de la vue d'ensemble à 5×,
  jamais perdue hors de l'open space. Le dessin reste net (la caméra règle le `viewBox` du SVG, sans nouveau rendu).
- **Moins d'infos partout** : plus de bulle tournante ni de compteur sur chaque enseigne ; par défaut, personnages,
  petites pastilles d'état et noms de zone discrets (compteur seulement au guichet et en salle d'attente).
  **Survol** (souris) ou **focus** (clavier) d'un agent : carte (projet, état, zone, depuis quand, demande en cours ou
  autorisation attendue, outil, sous-agents en cours) avec « Voir le détail » et « Suivre cet agent » ; d'une zone :
  nom, nombre d'agents, à quoi elle sert (au guichet et en salle d'attente : **qui attend**). La carte ne sort jamais
  de l'écran (`placerCarte`). **Au toucher** : premier tap = aperçu, second tap (ou bouton) = panneau Détail, tap
  ailleurs = ferme ; clic souris = détail directement. **Échap** ferme la carte, puis le plein écran (et une feuille
  ouverte se ferme sans fermer l'app).
- **Plein écran** (⛶) : API Fullscreen quand elle existe, et dans tous les cas un mode **immersif** qui recouvre
  l'en-tête du hub (iPhone compris) ; le détail s'ouvre par-dessus ; « ✋ N attendent » y reste visible.
  **Écran d'ambiance** (◐) : plein écran sans aucune interface (2e écran, tablette posée), vue d'ensemble, rafraîchi
  seul, écran maintenu allumé quand le navigateur le permet (Wake Lock) ; bouger ou toucher montre « Quitter ».
- **Suivre cet agent** : la caméra le garde au centre (même quand il marche), jusqu'à « Arrêter » ou un glisser.
- **Relecture de la journée** (⏱) : curseur temporel en bas (lecture / pause, ×10 / ×60, barres d'activité, heure,
  « Direct »). À chaque instant t, le bureau est **reconstruit** à partir de ce qui est déjà en mémoire (journal du PC
  ou copie chiffrée) : seuls les événements d'avant t comptent, l'état est calculé à t (`bureauA`) ; rien n'est relu
  ni déposé en plus. Sauter dans le temps replace tout le monde d'un coup ; en lecture, ils marchent.
- **Sous-agents** : chaque sous-agent est un **petit personnage** (mini-version du parent, même couleur et accessoire,
  pastille de son type) qui sort de la Salle de réunion, va dans la zone de son activité (Explore → Bibliothèque,
  Plan → Réunion, tests → Machines…, sinon près du parent), puis **rend son travail** au parent et disparaît. Au
  survol : « Sous-agent de <projet> », description, type, depuis quand, lien pointillé vers le parent ; compteur
  discret « ⑂ N » sur le parent ; section « Sous-agents » dans le détail ; indentés sous le parent dans les listes.
  Six au plus à la fois (le reste : « +N »). Contrat : `SousAgent` de `sousAgentsScene.ts` ({id, parent, description,
  type, modèle, début, fin, état en cours/terminé/échec, durée, profondeur}), alimenté par le **module de données**
  `sousAgents(entrees)` de `logiqueSousAgents.ts` via `sousAgentsDepuisHistorique(entrees, t, references)` : avec le
  hook v4, un sous-agent apparaît **en direct dès son `SubagentStart`** (sans attendre la fin de l'outil Agent) et
  repart à son `SubagentStop` ; « sans nouvelles » (30 min, ou session fermée) = plus dessiné. **Repli** pour une
  session sans aucun événement de sous-agent (hook d'avant la v4) : déduits des outils Task / Agent notés à leur fin
  avec leur durée (visibles en relecture, et en direct pendant leur « rendu »). La démo fusionne la session
  « refonte » (`entreesDemoSousAgents` : trois sous-agents en parallèle + un imbriqué) et en fait tourner d'autres
  sur deux ou trois sessions fictives.
- **Équipe dans la scène et la liste** : la couleur du haut et l'accessoire choisis dans l'écran Équipe habillent le
  personnage (et ses mini-sous-agents) ; le **surnom** s'affiche au survol (« Bérénice » au-dessus du projet), dans la
  cible accessible (« Bérénice (budget), … »), la pastille « ◎ Suivi », la carte d'un sous-agent, le titre du Détail
  et les cartes de la vue Liste. Changer l'équipe redessine aussitôt (`useMagasinSuivi`).
- **Clavier** (raccourcis de l'onglet Suivi) : `F` bascule le plein écran de la scène ; `J` / `K` font **suivre**
  l'agent suivant / précédent (caméra centrée + carte épinglée) ; en vue Liste (ou en natif), ils ouvrent son détail.
- **Graphisme** (toujours SVG/CSS, sans image) : sol de chaque zone en dégradé, lumière d'ambiance (soleil par les
  fenêtres et poussière dans les rayons le jour, bleu nuit et lampes la nuit), ciel qui défile lentement (nuages,
  soleil, lune, étoiles), ombres portées douces sous le mobilier, cloison vitrée de la salle des machines,
  personnages ombrés (respiration, regard, marche aux jambes qui balancent, décalages propres à chacun), lampes
  suspendues adoucies. « Réduire les animations » : rien ne bouge, pas d'inertie ni de transition de caméra.
- **Mise en route réductible** : bouton « Réduire ▴ » (aria-expanded) même avec une ligne rouge ; réduite, une ligne
  « Mise en route · N points à régler » avec sa pastille, qui se rouvre d'un toucher. Mémorisé sur l'appareil
  (`localStorage`) ; elle ne se rouvre seule que si un **nouveau** point passe au rouge (« Aucun événement reçu »
  toujours rouge quand on travaille depuis des sessions cloud ne l'encombre plus).

### Autour de la scène

- **Mise en route** (en tête, état réel, mis à jour seul — `logiqueMiseEnRoute.ts`) : sur le PC, hook installé / à
  mettre à jour / absent, dernier événement reçu, copie chiffrée (et dernier dépôt), présence rapide ; ailleurs, compte
  principal relié, relais joignable, copie reçue (âge, « ancienne » au-delà d'1 h), appareils d'où elle vient,
  présence, dernier événement. Chaque ligne non verte a **une** action : bouton (installer/mettre à jour le hook,
  activer la copie, activer la présence, réessayer, voir la démo) et/ou commande à copier (`npm run office:hooks`).
  Tout est vert : une seule ligne « tout est prêt ».
- **Aujourd'hui** (dans « Options ») : sessions, demandes, temps actif (écarts de moins de 5 min entre deux
  événements d'une session), dernier projet, en une ligne.
- Pastilles **« N attendent ta réponse »** et **« N terminés à voir »** (ouvrent le détail du premier) ; bascule
  **Scène / Liste** mémorisée sur l'appareil (Liste : cartes groupées par zone, « Attend ta réponse » et « Terminés
  récemment » d'abord) ; **« ? »** : comment lire le bureau (zones, pastilles, « En direct » contre « Copie chiffrée · il
  y a X min », figé/grisé) ; légende des zones en boutons dans « Options » (explication au toucher ou au clavier).
- **Recherche** dans l'historique depuis le Bureau et **filtre par projet** (dans « Options » ; le filtre actif reste
  rappelé dans la barre, retiré d'un toucher) (« Mettre en avant » estompe les autres,
  « Masquer » les retire de la scène et de la liste).
- **Détail d'un agent** (toucher un personnage ou une carte, `DetailAgent.tsx`) : projet, zone, depuis quand, ce qu'il
  attend ou ce qu'il a fini, compteurs (demandes, outils, temps d'outils, échecs, attentes), **sous-agents** et **chronologie** de la
  session (demandes, outils avec leur durée, réflexions de plus de 15 s, attentes, fin) ; « Marquer comme vu »,
  « Voir dans l'Historique » (filtré sur la session).
- **Statistiques** (onglet, `Statistiques.tsx`, `logiqueStats.ts`) : requêtes par jour (7 ou 30 j), carte de chaleur
  jour × heure, outils les plus utilisés (durée moyenne quand le hook la connaît), projets les plus actifs, sessions,
  durée moyenne d'une session, temps actif. Calculé sur l'appareil (journal sur le PC, copie chiffrée ailleurs) ;
  graphiques en simples vues, chacun résumé en une phrase pour les lecteurs d'écran.
- **Réglages du bureau** (propres à l'appareil, `prefsOffice.ts`, jamais envoyés) : délai de la salle d'attente ; sur
  le PC, « Me prévenir quand Claude attend ma réponse » (**désactivé par défaut**) : notification de Windows par le
  mécanisme existant (`window.applibourse.systeme.notifier`), une fois par attente.

### Onglet « Suivi » (v4) : récap, alertes, équipe, notes, raccourcis

Quatrième onglet, une section à la fois (`Suivi.tsx`), pour ne rien ajouter sur le Bureau. La pastille
**« Suivi · N »** compte les alertes non lues (aussi un indicateur « Alertes » sur la tuile du hub). Tout est calculé
et rangé **sur l'appareil** (base du profil, clés `claude-office.*`) : **aucune écriture KV de plus**, le Worker n'est
pas modifié.

- **Récap** (`logiqueRecap.ts`) : aujourd'hui ou 7 derniers jours — sessions, demandes, outils, temps actif (même règle
  que « Aujourd'hui »), projets, outils les plus utilisés, faits marquants (3 sessions les plus longues avec leur
  dernière demande, erreurs d'outil, attentes et la plus longue). « Copier le récap » (texte), Markdown, JSON (et
  « Enregistrer (.md)… » quand l'hôte sait enregistrer un fichier) ; sans presse-papiers, le texte s'affiche à
  sélectionner. Secrets reconnus masqués, aucun contenu d'outil.
- **Alertes** (`logiqueAlertes.ts` pur, `alertesOffice.ts`) : « un agent attend ta réponse depuis plus de X min »
  (5 par défaut), « session active depuis plus de X h » (2), « N erreurs d'outil d'affilée » (3), « un agent a fini »
  (tâche d'au moins X min, 5 ; « Toutes » possible). Par règle : activée, seuil, pastille, et sur le PC
  « Notification de Windows » (désactivée par défaut, `window.applibourse.systeme.notifier`, 3 au plus par passage).
  **Anti-répétition** : une alerte par occurrence (session + événement déclencheur), au plus une par règle et par
  session toutes les 10 min, et seuls les faits récents comptent (rouvrir l'écran ne rejoue pas l'historique). Sur une
  copie du relais, l'état est jugé **à la date du dépôt**. Journal consultable (200 au plus, « Voir la session »,
  « Vider le journal ») ; l'ouvrir marque tout comme lu. Évaluées tant que l'écran est ouvert (lecture légère :
  canal d'activité du PC toutes les 5 s, relais toutes les 2 min, index seulement si rien ne change) et sur le hub
  (mêmes présences que la tuile) ; journal et anti-répétition communs.
- **Équipe** (`equipe.ts`, `EcranEquipe.tsx`, `AvatarAgent.web.tsx`) : par projet — ou pour une session en cours, qui
  l'emporte — surnom (24 caractères), couleur (12), accessoire d'un petit catalogue SVG (aucun, lunettes, casque,
  bonnet, nœud, écharpe, couronne, casquette, fleur), ★ favori (en tête des listes). Pour la scène :
  `apparenceAgent(projet, session)` → `{ surnom?, couleur, accessoire?, favori, personnalise }`, et
  `apparencePersonnalisee(agent)`, remplaçant direct de `apparence(agent)` (drapeau `PERSONNALISATION_DANS_LA_SCENE`,
  vrai) ; `useMagasinSuivi()` redessine un composant quand l'équipe ou les notes changent.
- **Notes** (`NoteSession.tsx`) : une note libre par session (500 caractères), dans le **Détail d'un agent** et sur
  chaque session de l'**Historique** ; section « Notes » : toutes les notes, recherche sans accents ni casse.
- **Raccourcis clavier** (`raccourcis.ts`, PC et iPad avec clavier, web) : `?` aide (aussi « Raccourcis clavier »
  en bas de l'onglet Suivi), `B`/`H`/`S` onglets, `/` recherche (sur le Bureau, ouvre « Options » et place le curseur dans sa recherche ; Historique ou Notes ;
  sinon ouvre l'Historique), `F` plein écran de la scène (bascule), `Échap` ferme l'aide ou le détail **sans quitter l'app**,
  `J`/`K` agent suivant/précédent (dans la scène : la caméra le suit ; en vue Liste : ouvre son détail). Jamais pendant la saisie (champ, zone de texte, contenu
  éditable) ni avec Ctrl, Cmd ou Alt.
- **Démo** : en plus des sessions du bureau, trois sessions fictives (`demoSuivi.ts`) déclenchent les quatre alertes
  (pastille « Suivi · 4 ») ; équipe (Bob, Félix…) et notes fictives ; rien n'est écrit. Le Bureau de la démo montre
  **les mêmes sessions** que les alertes (« facturation » au guichet : la pastille « ✋ attend ta réponse » de la
  barre et l'alerte « attend ta réponse » parlent du même agent ; « carnet » qui « a fini » est en salle d'attente).
- **Place dans l'écran** : « Suivi » est le quatrième onglet de la ligne de titre épurée (à côté de Bureau,
  Historique, Statistiques), avec sa pastille d'alertes non lues ; rien n'est ajouté à la barre du Bureau.

### Sous-agents (v4, données ; le rendu est celui de la scène)

**Ce que Claude Code fournit** (doc officielle des hooks, code.claude.com/docs/en/hooks, lue le 12/10/2026) :
`SubagentStart` (`agent_id`, `agent_type`) et `SubagentStop` (`agent_id`, `agent_type`, `agent_transcript_path`,
`last_assistant_message`) ; les événements d'outils lancés **dans** un sous-agent portent `agent_id` et `agent_type` ;
l'outil qui lance un sous-agent s'appelle `Agent` (anciennement `Task`), `tool_input` = `description`, `prompt`,
`subagent_type`, `model` (facultatif) — `run_in_background` n'est pas dans la table de la doc (les sous-agents tournent
en arrière-plan par défaut : réponse `status: "async_launched"`). **Incertain** : aucun champ documenté ne relie
l'appel `Agent` (tool_use_id) à l'`agent_id` du `SubagentStart` ; on lit `tool_response.agentId` s'il existe, sinon on
apparie par type et par date (± 60 s). Le parent d'un sous-agent imbriqué n'est connu que par le lancement fait dans
ce parent (au premier plan, il n'arrive qu'à la fin).

**Hook v4** (`bureau/electron/officeHistorique.mjs`) : écoute en plus `SubagentStart` (type `debut-sous-agent`) et
`PostToolUseFailure` (outil `echec: true`, durée `duration_ms`) ; garde `agent`/`agentType` (le sous-agent lui-même
sur début et fin, sinon celui où l'événement a eu lieu) et, sur l'outil Agent/Task, `resume` = description courte,
`sousAgentType`, `modele`, `arrierePlan`, `agentLance` ; **jamais le prompt** ni le dernier message, sauf avec
« Enregistrer aussi le contenu des outils ». Secrets masqués comme le reste. Un hook installé avant est « à mettre à
jour » : **relancer `npm run office:hooks`** (n'ajoute que ces deux événements), puis redémarrer Claude Code. Sans
mise à jour, les sous-agents restent visibles d'après l'outil Task/Agent et `SubagentStop` (moins précis).

**Contrat** — `src/claudeOffice/logiqueSousAgents.ts` :

```ts
sousAgents(entrees, { maintenant, references? }): Record<string /* Agent.cle = "appareil|session" */, SousAgent[]>
interface SousAgent {
  id: string;            // agent_id (ou « lance-… », « fin-… », « debut-… » fabriqué)
  cleSession: string; session: string;
  parent: string;        // id de session (1er niveau) ou id du sous-agent parent
  profondeur: number;    // 1, 2…
  description?: string; type?: string; modele?: string; arrierePlan?: boolean;
  debut: number; debutInconnu?: boolean; fin?: number;            // ms
  etat: 'en-cours' | 'termine' | 'echec' | 'expire';             // expire : sans nouvelles 30 min, ou session fermée
  dureeMs: number; outils: Array<{ nom: string; n: number }>; nbOutils: number; echecs: number; dernier: number;
}
sousAgentsEnCours(liste)                  // ceux qui tournent (petits personnages autour de l'agent)
statsSousAgents(entrees, maintenant, jours) // total, parJour, sessions, maxParSession, maxParalleles, types, echecs, dureeMoyenneMs
entreesDemoSousAgents(debut, maintenant)  // démo : session « refonte », 3 sous-agents parallèles + 1 imbriqué, un échec (cycle 90 s)
```

Exemple : `sousAgents(entrees, { maintenant: Date.now() })['52e6f6322d1d|sess-1']` →
`[{ id: 'agent-a1', parent: 'sess-1', profondeur: 1, description: 'Trouver les API', type: 'Explore', modele: 'haiku',
arrierePlan: true, etat: 'en-cours', dureeMs: 18000, outils: [{ nom: 'Read', n: 2 }], … }]`. Pour la démo du bureau,
les entrées de `entreesDemo` sont fusionnées avec `entreesDemoSuivi` et `entreesDemoSousAgents(debutDemo, maintenant)`
(Bureau.tsx). Statistiques : carte « Sous-agents » (par jour, types, parallèles, échecs) ; récap : « N sous-agents (types),
jusqu'à K en parallèle » ; chronologie du détail : « Sous-agent lancé / terminé (type) ».

**Points d'intégration avec la scène** (faits) : `Racine.tsx` (`useSuiviOffice`, onglet Suivi dans la ligne de titre,
aide) ; `Bureau.tsx` (`sousAgentsDepuisHistorique`, démo commune, `useNavigationAgents(...)` hors scène web, Équipe
dans la vue Liste) ; `PlateauScene.web.tsx` (écouteurs `plein-ecran`, `agent-suivant`, `agent-precedent`, surnom
au survol) ; `SceneOpenSpace.web.tsx` (`apparencePersonnalisee as apparence`) ; `DetailAgent.tsx` (titre avec
surnom) et `Historique.tsx` (`<NoteSession …/>`) ; `resumeHub.ts` (pastille de la tuile). Poids : environ 42 Ko minifiés (14 Ko compressés) de plus au bundle du site.

| États (liste) | Déduit de (dernier événement de la session) |
| --- | --- |
| Attend ta réponse | demande d'autorisation ou question (Notification « permission »/« question », PermissionRequest) |
| Écrit du code | outil d'écriture (Edit, Write, MultiEdit…) il y a moins d'une minute |
| Utilise un outil | autre outil (Bash, Read, Grep…) il y a moins d'une minute |
| Réfléchit | demande envoyée, outil fini depuis plus d'une minute, fin d'un sous-agent |
| Inactif | fin de réponse, début de session, ou plus rien depuis 10 min (en salle d'attente tant que la fin n'est pas vue) |
| Terminé | fin de session (en salle d'attente, puis visible 30 min) ; sans événement depuis 3 h : session expirée, rangée |

Logique pure et testée : `logiqueBureau.ts` (états, salle d'attente, récapitulatif), `zones.ts`, `logiqueScene.ts`.

Poids : la v3 ajoute environ 58 Ko minifiés (17 Ko compressés) au bundle du site, sans image ni dépendance ; la
scène v4 environ 55 Ko minifiés de plus.

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
- **Équipe, notes et alertes partagées entre appareils** (v4) : volontairement locales. Aucune entité chiffrée
  existante ne s'y prête sans en changer le format (`prefs:hub` écarte les clés inconnues) ; en ajouter une
  demanderait une nouvelle entité de synchro. Personnaliser sur le PC ne change donc pas le téléphone.
- **Alertes quand l'écran et le hub sont fermés** (v4) : comme la notification v3, elles ne sont évaluées que dans
  l'application ouverte (écran Claude Office ou hub) ; ailleurs, il faudrait un service de notifications push.
- **Notification « attend ta réponse » v3 et alerte v4** : les deux réglages coexistent (la v3 prévient dès l'attente,
  la v4 au-delà du seuil) ; les fusionner changerait un réglage existant, laissé à l'intégration finale.
- **Surnom en permanence au-dessus des personnages** : volontairement non (la scène v4 garde peu de texte) ; il
  apparaît au survol, au focus et dans les listes.

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
| `src/claudeOffice/Suivi.tsx`, `suiviOffice.ts` | Onglet « Suivi » (récap, alertes, notes, aide des raccourcis) ; ce que l'écran branche en une ligne |
| `src/claudeOffice/logiqueAlertes.ts`, `alertesOffice.ts` | Règles d'alertes, anti-répétition, journal ; exécution, notification, pastille |
| `src/claudeOffice/logiqueRecap.ts` | Récap du jour et de la semaine, exports texte/Markdown/JSON |
| `src/claudeOffice/equipe.ts`, `EcranEquipe.tsx`, `AvatarAgent(.web).tsx`, `NoteSession.tsx` | Personnalisation des agents, `apparenceAgent`, notes de session |
| `src/claudeOffice/logiqueSousAgents.ts` | Sous-agents par session (contrat pour la scène), statistiques, démo |
| `src/claudeOffice/raccourcis.ts`, `demoSuivi.ts` | Raccourcis clavier et bus d'événements avec la scène ; compléments de la démo |

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
1024×768, PC, clair et sombre : débordement, cibles 44 px, textes 15 px ; captures `20…31`). v4 :
`src/claudeOffice/fonctionsV4.test.tsx` (apparence par projet et session, règles d'alertes, seuils, anti-répétition,
relais, récap et exports masqués, raccourcis inactifs en saisie, notes ; rendu Suivi, Équipe, Alertes, Récap, aide des
raccourcis, clair et sombre ; pastille ; droits), `src/claudeOffice/sousAgents.test.tsx` (appariement, parallèles,
imbriqués, ancien hook, début sans fin, fin sans début, relais, statistiques, récap, démo) et
`scripts/e2e-claude-office-v4-fonctions.mjs` (PC : alerte,
pastille, notification, raccourcis, note, équipe, récap copié ; site en démo sur iPhone 390×844, iPad, PC, clair et
sombre ; captures `40…47`).

## Droits

`adminSeulement` (jamais proposée dans les autorisations d'un ami, même si la liste enregistrée est retouchée) et
`disponible` = rang **Fondateur** (compte principal ou compte promu Fondateur). Administrateur, gestionnaire et ami ne
voient ni la tuile ni l'écran (tests : `src/claudeOffice/claudeOffice.test.tsx`).

## Réglages et synchro

Les réglages du bureau (vue Scène/Liste, délai de la salle d'attente, fins « vues », notification) — et en v4
l'équipe, les notes, les réglages et le journal des alertes — sont **propres à
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
