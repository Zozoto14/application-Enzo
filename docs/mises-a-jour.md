# Mises à jour : voir les nouveautés sans rien faire

Avant : à chaque nouveauté, il fallait vérifier dans le terminal (`tail ~/logs/esport-deploy.log`) que le site était
à jour, puis recharger avec **Ctrl+F5**. Maintenant :

- l'app **voit seule** qu'une nouvelle version est en ligne et propose « **Nouvelle version disponible — Mettre à
  jour** » (ou se met à jour d'elle-même quand on ne s'en sert pas) ;
- le Fondateur voit dans l'en-tête du hub où en est la publication : « **Mise à jour en cours… (≈ X min)** », puis
  « **À jour** », ou une alerte si la mise à jour **n'a pas pu être publiée** (tests en échec sur GitHub) ;
- une page **Paramètres › Administration › Mises à jour** remplace le terminal.

Rien à installer ni à régler : il suffit d'un dernier Ctrl+F5 (une seule fois) pour charger la version qui contient
ce système ; ensuite, plus jamais.

## La chaîne, de bout en bout

```text
push sur main
  → GitHub Actions « Site (o2switch) » : tests, build, branche deploiement-o2switch     (~5 min)
  → o2switch, deployer.sh (cron toutes les 5 min, qui guette chaque minute)            (≤ 1 min)
       code, migrations, redémarrage des serveurs, copie du site dans public_html
  → l'app ouverte relit version.json (démarrage, retour au premier plan, toutes les 3 min)
       → bandeau « Nouvelle version disponible — Mettre à jour », ou rechargement automatique
```

## 1. Dans l'app : détecter la nouvelle version (`src/hub/maj/version.ts`)

- Le build (`vite.config.mjs`) écrit **`version.json`** à la racine du site : `{ id, commit, date }` (commit complet
  et date du build), et grave la même chose dans la page (`__BUILD_ID__`, `__BUILD_COMMIT__`, `__BUILD_DATE__`).
  Le fichier est servi **sans cache** (`Cache-Control: no-cache, no-store, must-revalidate`, règle de
  `bureau/public/_headers` traduite en `.htaccess` par le workflow), et lu avec `cache: 'no-store'`.
- L'app le relit **au démarrage**, **au retour au premier plan** (onglet, fenêtre, retour du réseau : au plus une
  fois toutes les 30 s) et **toutes les 3 minutes**. Une petite requête de quelques octets : rien de lourd.
- Comparaison (`estPlusRecente`) : même id ou même commit → rien ; sinon la date du build la plus récente gagne
  (jamais de « mise à jour » vers un build plus ancien). L'ancien format (`{ id }` seul) est compris.
- Nouvelle version : **bandeau** en haut de l'app (« Mettre à jour » / « Plus tard »). Le bouton recharge
  **proprement** : service worker éventuel activé (`SKIP_WAITING`) puis désinscrit, caches vidés, page redemandée
  au serveur (cache HTTP contourné), puis rechargement. Les morceaux JS ont une empreinte dans leur nom : la
  nouvelle page charge les nouveaux. (Le site n'a pas de service worker aujourd'hui ; s'il en a un un jour, c'est
  déjà géré.)
- **Rechargement automatique** (Paramètres › À propos › **Mettre à jour automatiquement**, activé par défaut, réglage
  propre à chaque appareil) : seulement si **aucune saisie n'est en cours** et que l'app est **inactive ou en
  arrière-plan** :
  - saisie en cours = un champ de texte actif ; un champ dans lequel on a tapé et qui contient encore du texte
    (formulaire pas encore envoyé) ; une saisie signalée par un écran (`marquerSaisie(cle, true)`) ; une vidéo ou un
    son en lecture. Dans le doute, l'app attend : **jamais de formulaire perdu** ;
  - aucun compte ouvert (écran de connexion) : 30 s en arrière-plan ou 2 min sans activité ;
  - compte ouvert (il faudra le déverrouiller à nouveau) : 10 min en arrière-plan ou 20 min sans activité ;
  - garde-fou : un seul rechargement automatique par version et par 10 minutes (si un cache intermédiaire servait
    encore l'ancienne page, pas de boucle).
  Les données en attente d'envoi sont gardées sur le disque et envoyées à la fermeture de la page : recharger ne
  perd rien.
- Déjà en place avant (commit f17cc69) et toujours là : rechargement unique sur « Failed to fetch dynamically
  imported module » (`src/ui/versionPerimee.ts`) et anciens fichiers `assets/` gardés 14 jours sur le serveur.

**App PC (Electron)** : l'interface est compilée sur le PC à partir de GitHub ; le même bandeau apparaît quand
GitHub a du nouveau (vérifié toutes les 15 minutes et au retour sur la fenêtre), et « Mettre à jour (redémarre
l'app) » récupère le code et relance l'app. Quand la fenêtre est cachée, le processus principal le fait déjà seul.
**iPhone / Android** : rien de changé (mises à jour signées installées à la réouverture) ; sur le site ouvert dans
le navigateur du téléphone, tout ce qui précède s'applique.

## 2. La pastille « Mise à jour en cours… » (Fondateur)

Le serveur Esport expose **`GET /deploiement`** (Fondateur, ou un compte à qui il confie la permission du club
**`deploiement.voir`**, désactivée par défaut, même pour le Second CEO ; 404 pour tous les autres). Il ne fait que
**lire** (`esport/serveur/deploiement.mjs`) :

| Information | D'où elle vient |
| --- | --- |
| Version du serveur Esport | commit du dépôt cloné, lu dans `.git` au démarrage de l'app (redémarrée à chaque déploiement) |
| Version du site | `public_html/version.json` |
| Version du relais | `~/.appdashboard/code-deploye` (même dépôt) et date de `relais/tmp/restart.txt` |
| Dernier déploiement, 10 dernières lignes | `~/logs/esport-deploy.log` : lignes datées écrites par deployer.sh **seulement** (jamais la sortie de npm ou des migrations), secrets masqués |
| Dernière vérification du serveur | `~/.appdashboard/derniere-verification` (écrit chaque minute par le guet) |
| Dernier commit de main, état du workflow « Site (o2switch) » | API publique GitHub, **sans jeton** |

GitHub : cache de **2 minutes**, délai court (4 s), requêtes conditionnelles (ETag : une réponse 304 ne compte pas
dans la limite de 60 requêtes/heure de l'API publique). Si la limite est atteinte malgré tout, ou si GitHub ne
répond pas, la dernière réponse connue est gardée (la page le signale) et rien n'est redemandé avant l'heure de
remise à zéro annoncée par GitHub.

États (pastille de l'en-tête du hub, un clic ouvre la page) :

| État | Quand | Pastille |
| --- | --- | --- |
| `en-cours` (build) | le workflow tourne sur GitHub | « Mise à jour en cours… (≈ X min) » (≈ 6 min de build, moins le temps écoulé, + 1) |
| `en-cours` (publication) | build réussi, site pas encore copié | « Mise à jour en cours… (≈ 1 min) » (5 si le serveur ne guette pas) |
| `a-jour` | le site publié vient du dernier build réussi | « À jour » (affichée 2 min après une mise à jour suivie, puis la pastille disparaît) |
| `echec` | le dernier build a échoué (tests…) | **« Mise à jour non publiée »** — « La mise à jour n'a pas pu être publiée (tests en échec). Prévenez le développeur. » |
| `bloque` | build réussi depuis plus de 30 min mais site inchangé, ou dernière ligne du journal en ÉCHEC | « Mise à jour bloquée » (cron arrêté, deployer.sh en échec : voir le journal) |

Un commit qui ne touche que la documentation ne lance pas le workflow : le site reste « à jour » (il n'y a rien à
publier). L'app interroge le serveur au démarrage, toutes les 3 minutes et au retour au premier plan (au plus une
fois par minute) ; un seul sondage pour la pastille et la page.

## 3. La page « Mises à jour » (Paramètres › Administration)

Versions (cette app, site, serveur Esport, relais, dernier commit sur GitHub), dernier déploiement, dernière
vérification du serveur, état de la construction GitHub (avec lien), 10 dernières lignes du journal, et :

- **Vérifier maintenant** : `POST /deploiement/verifier` dépose le fichier-drapeau `~/.appdashboard/deployer-demande`
  (une date, rien d'autre). deployer.sh le consomme à sa prochaine vérification (moins d'une minute en général) et fait
  un passage complet. **Le serveur web ne lance jamais de commande** : pas d'exécution possible depuis l'app. Limité à
  30 demandes par heure et par compte.
- **Recharger l'app** : rechargement propre (comme le bandeau).

## 4. deployer.sh : guetter plutôt qu'attendre 5 minutes

La tâche cron **ne change pas** (toutes les 5 minutes, même commande). Ce qui change dans
`esport/serveur/deployer.sh` :

- lancé sans option, il **guette ~4 minutes** (`DEPLOYER_GUET`, 240 s) et vérifie **chaque minute**
  (`DEPLOYER_PAS`, 60 s) avec **un seul `git ls-remote`** (main et deploiement-o2switch) comparé à
  `~/.appdashboard/code-deploye` et `site-deploye`. Rien de nouveau : il ne fait **rien** (pas de `git fetch`, rien au
  journal) ;
- passage complet (le script d'avant, étapes 1 à 6) seulement : s'il y a du nouveau, si le drapeau « Vérifier
  maintenant » est présent, si `git ls-remote` échoue (le passage complet dira pourquoi dans le journal), ou s'il n'y
  a pas eu de passage complet depuis une heure (`~/.appdashboard/passage-complet` : purge des anciens assets, etc.) ;
- un passage complet en échec arrête le guet : le cron suivant réessaiera (pas un « ÉCHEC » par minute) ;
- avec une option (`--forcer`, `--sans-git`, `--sans-site`, `--sans-code`), il fait un seul passage complet, comme
  avant. Toujours protégé par le verrou (flock) : un seul deployer.sh à la fois.

Résultat : une nouveauté est en ligne environ **1 minute** après la fin du workflow GitHub (au lieu de 2 min 30 en
moyenne, 5 au pire), soit **≈ 6 minutes** après le push.

## Tests

- `esport/test/deploiement.test.mjs` (SQLite, et PostgreSQL avec `ESPORT_TEST_PG`) : journal filtré et secrets
  masqués, versions, synthèse des états, cache GitHub / ETag / limite de l'API / panne réseau, drapeau, permissions.
- `esport/test/pg/deployer.test.mjs` : vérification légère sans `git fetch`, drapeau consommé, site poussé pendant le
  guet et publié dans la même exécution.
- `src/hub/maj/version.test.ts` (Jest) : comparaison de versions, saisie en cours (jamais de rechargement pendant une
  saisie), décisions, anti-boucle ; `src/hub/maj/deploiement.test.tsx` : pastille FR/EN, sondage partagé, page.
