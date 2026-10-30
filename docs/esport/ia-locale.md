# IA locale du serveur Esport

L'assistant des profils de jeu ([profils-jeu.md](profils-jeu.md)) peut travailler **sans clé d'API** : une IA
installée **sur le serveur o2switch lui-même**, calculée sur le processeur (pas de carte graphique). Elle est gratuite
et rien ne sort du serveur, mais elle est **plus lente** qu'un service d'IA externe : un brouillon de profil prend
plusieurs minutes au lieu de quelques secondes. C'est l'un des trois moteurs de l'IA (avec l'API principale et l'API
secondaire, voir [ia-api.md](ia-api.md)) : seule, en tête de l'**ordre de repli** avec les API en secours, ou en
dernier recours quand les API sont en panne, limitées (429) ou à leur plafond.

Installation pas à pas : [docs/o2switch.md, partie J](../o2switch.md). Ce document explique le fonctionnement.

## Ce qui est installé

| Élément | Choix | Où |
| --- | --- | --- |
| Moteur | **llama.cpp**, version figée `b11351` (commit `631109b3…`), son serveur `llama-server` (API « chat completions » compatible OpenAI) | `~/.appdashboard/ia-locale/moteur/` (≈ 30 Mo) |
| Modèle (défaut) | **Qwen2.5-7B-Instruct**, GGUF `Q4_K_M`, licence **Apache 2.0** : bon en français, en anglais et en JSON | `~/.appdashboard/ia-locale/modeles/` (≈ 4,7 Go) |
| Modèle (`--petit`) | **Qwen3-4B-Instruct-2507**, GGUF `Q4_K_M`, Apache 2.0 : environ deux fois plus rapide, un peu moins précis | ≈ 2,5 Go |
| État | `pret.json` (moteur, modèle, empreintes, mesures du `--test`), `etat/` (verrou, clé d'accès, dernière vitesse) | même dossier |

Pourquoi pas Qwen2.5-3B : sa licence (« Qwen Research ») n'est pas permissive ; Qwen3-4B-Instruct-2507 l'est.

Tout est **hors du dépôt et hors de `public_html`** : le déploiement automatique (`deployer.sh`) n'y touche jamais,
et rien n'est servi par le site. Le dossier est en `0700`.

### Comment le moteur est obtenu (sans droit administrateur)

o2switch tourne sous **CloudLinux 8** (glibc 2.28). Les binaires précompilés de llama.cpp (comme ceux de
node-llama-cpp) demandent **glibc 2.34** : ils ne démarrent pas. L'installateur choisit donc :

1. **glibc ≥ 2.34** : l'archive officielle `llama-b11351-bin-ubuntu-x64.tar.gz` (17,5 Mo, SHA-256
   `c800a340…1fee`), gardée seulement si elle démarre vraiment (`llama-server --version`) ;
2. **sinon (cas o2switch) : compilation** depuis les sources du tag (`git clone`, commit vérifié), avec un **GCC 14**
   obtenu sans root : `micromamba` 2.9.0 (SHA-256 vérifié) installe **hors ligne** 39 paquets conda-forge figés
   (`esport/serveur/ia-locale/outils-compilation.lock` : GCC 14.4, cmake 4.4.3, make, en-têtes glibc 2.28), **chacun
   téléchargé et vérifié par SHA-256 par l'installateur** (micromamba, lui, ne vérifie pas les empreintes d'une liste
   explicite). Le binaire est autonome (libstdc++ incluse, ne demande que glibc 2.27), compilé pour tout processeur
   **AVX2** (sans AVX2 : version plus lente mais compatible). Les outils (≈ 1 Go) sont **effacés** à la fin.

node-llama-cpp n'est pas utilisé : mêmes binaires glibc 2.34, même compilation de repli, et le modèle serait chargé
**dans** le processus Node de l'app (plusieurs Go dans Passenger).

### Le modèle

Téléchargé depuis Hugging Face à une **révision précise** (commit du dépôt, noté dans `pret.json`), avec **reprise**
après coupure (fichier `.partiel`, en-tête `Range`), puis **SHA-256 comparé à l'empreinte publiée** par Hugging Face
pour ce fichier ; un fichier faux est effacé. `--revision <commit>` fige une révision donnée (pour réinstaller
exactement la même).

## Fonctionnement à la demande

Le moteur ne tourne **pas en continu** (serveur partagé) :

- il **démarre quand une tâche IA arrive** (brouillon, vérification, test de connexion) : chargement du modèle de
  quelques secondes à une minute ;
- il écoute **seulement sur `127.0.0.1`**, sur un **port libre tiré à chaque démarrage**, avec une **clé d'accès
  aléatoire** (fichier `etat/cle` en `0600`, jamais sur la ligne de commande) : sur un mutualisé, `127.0.0.1` est
  partagé avec les autres comptes du serveur ; sans la clé, le moteur refuse tout ;
- il **s'arrête après 5 minutes sans requête** (`IA_LOCALE_INACTIVITE_MIN`) ;
- **un seul moteur pour tout le compte** : verrou `etat/serveur.json` (pid du processus propriétaire, pid du moteur,
  battement toutes les 30 s). Un autre processus attend son tour (ou répond « IA locale occupée ») ;
- **orphelins** : si le processus propriétaire disparaît (redémarrage de Passenger, processus tué), le moteur resté
  seul est arrêté au démarrage de l'app, à chaque passage du cron (toutes les 5 min) et avant tout nouveau démarrage.
  Seul un processus dont la ligne de commande porte **notre** fichier de clé est arrêté, jamais un autre ;
- **file d'attente** : une requête à la fois (le modèle occupe tous ses fils), 4 en attente au plus (au-delà : « IA
  locale occupée », et si une API la suit dans l'ordre de repli, elle prend le relais) ;
- priorité la plus basse (`nice 19`), **8 fils de calcul** par défaut (`IA_LOCALE_THREADS`), contexte de **8 192
  jetons** (`IA_LOCALE_CONTEXTE` ; moins de mémoire qu'avant, et les requêtes en étapes y tiennent largement), pas
  d'attente active des fils, pas de cache mémoire entre requêtes (`--cache-ram 0` ; le début commun des requêtes
  successives reste réutilisé, voir plus bas), **environnement vidé** (les secrets de `esport.env` ne sont pas
  transmis au moteur), interface web du moteur coupée. Journal : `~/logs/esport-ia-locale.log`.
- les requêtes sont envoyées **en flux** (`stream: true`, SSE) : le moteur envoie la progression de la lecture du
  texte, puis le texte morceau par morceau, et un signe de vie toutes les 30 s ; la connexion n'est donc jamais
  muette pendant un calcul de plusieurs minutes, la progression s'affiche, et un moteur qui meurt en route est
  repéré tout de suite. La sortie reste contrainte par le schéma JSON (la grammaire s'applique jeton par jeton).
  Sans aucun signe de vie pendant 5 minutes, le calcul est abandonné (`ia-locale-bloquee`) ;
- **mémoire du moteur relevée toutes les 5 s** : si le système le tue, le journal dit combien il occupait juste avant.

### Qui calcule : le processus de fond

Passenger peut endormir ou redémarrer l'app à tout moment ; un brouillon calculé localement dure plusieurs minutes.
Les **travaux** (brouillons, vérifications) sont donc exécutés par un **processus de fond**
(`esport/serveur/ia-locale/travailleur.mjs`) :

1. l'app enregistre le travail et **lance le processus de fond** (détaché, `nice 19`) puis répond tout de suite
   (« en attente », la page se met à jour quand c'est prêt) ;
2. le processus de fond démarre le moteur, exécute les travaux, garde le moteur chaud tant qu'il en arrive, puis
   **s'arrête après 5 minutes sans travail** (moteur arrêté avec lui) ; un seul processus de fond à la fois
   (verrou `etat/travailleur.verrou`), 60 minutes de vie au plus (`IA_LOCALE_DUREE_TRAVAILLEUR_MIN`) ;
3. **le cron (toutes les 5 minutes) relance le processus de fond** si des travaux attendent (lancement manqué,
   processus arrêté par l'hébergeur…), et lance au plus **une vérification automatique due** par passage, comme avec
   la clé d'API.

Seul le **test de connexion** (Administration IA) tourne dans l'app elle-même (une petite requête ; le moteur s'y
arrête après 1 minute pour laisser la place au processus de fond).

## Choisir sa place (Administration IA › Ordre de repli)

**Esport › Jeux › Administration IA › Ordre de repli** (Fondateur), pour les profils de jeu et pour les tâches
légères (détails : [ia-api.md](ia-api.md)) :

| Ordre (profils de jeu) | Effet |
| --- | --- |
| **IA locale** seule | Tout passe par le moteur du serveur. Pas de plafond mensuel (rien n'est payé) : la durée (20 min par requête) et la concurrence (une à la fois) sont bornées à la place. |
| **API principale, API secondaire** | Les fournisseurs externes, avec les plafonds mensuels par moteur. |
| **IA locale, puis les API** | Le moteur local d'abord (consignes compactes) ; s'il échoue (démarrage impossible, trop long, occupé, réponse illisible), le travail est repris par les API (compté dans leurs plafonds). |
| **Les API, puis l'IA locale** (défaut) | Les API d'abord ; si elles échouent toutes (panne, limite 429, plafond), le travail repasse en attente et le **processus de fond** le refait avec l'IA locale. |

Sans ordre enregistré : `IA_ORDRE` (défaut `api,api2,local`) ; `IA_FOURNISSEUR=local` met l'IA locale en tête
(`local,api,api2`). Un moteur absent (pas installé, pas de clé) est sauté. L'ancien réglage « IA locale / Clé API /
Locale d'abord » est converti en ordre (`local` ; `api,api2` ; `local,api,api2`).

La carte montre aussi : modèle, fils de calcul, **en marche / arrêtée**, **dernière vitesse** (jetons générés par
seconde, mesurée à chaque requête, sinon celle du `--test`), **dernier temps de réponse**, requêtes en attente, dernière
erreur, et **Tester l'IA locale** (le premier test charge le modèle : jusqu'à une minute). Le bouton **Tester la
connexion** de la carte de l'API teste alors la clé d'API seule. Le compteur du mois distingue les appels à l'API
(plafonnés) des requêtes locales (comptées, sans plafond).

## Consignes pour un petit modèle

Avec l'IA locale, l'assistant envoie des **consignes compactes** (`esport/noyau/ia/consignes-compactes.mjs`) : règles
courtes et numérotées, un **exemple sur un jeu fictif**, 2 pages de référence de 5 000 caractères au plus (au lieu de
4 × 12 000, soit ≈ 3 000 jetons de pages), un profil existant tronqué à 6 000 caractères (4 000 pour un brouillon qui le complète), et un **schéma JSON** passé
au moteur (`response_format: json_schema`) : llama.cpp en tire une grammaire, le modèle ne peut écrire qu'un JSON de
cette forme. Des pages, seul le **texte utile** est gardé : contenu principal (`<main>`, `<article>`), sans menus,
pieds de page, encadrés, formulaires ni lignes répétées.

### Le brouillon en étapes

Un brouillon n'est plus **une** énorme requête (lecture de tout, puis jusqu'à 4 000 jetons écrits d'un coup, soit
plus de 10 minutes sans rien voir) mais **quatre étapes**, affichées dans la liste des brouillons (« Étape 3/4 :
modes et cartes · 120 jetons écrits ») :

| Étape | Contenu | Écriture au plus |
| --- | --- | --- |
| 1/4 | Pages de référence : celles données, sinon le modèle en propose (petite requête), le serveur les lit | 300 jetons |
| 2/4 | Nom, couleur, formats, score, roster, rôles des joueurs | 900 jetons |
| 3/4 | Modes et cartes (avec les clés des formats de l'étape 2) | 1 400 jetons |
| 4/4 | Classes et personnages | 1 600 jetons |

Les étapes 2 à 4 envoient **le même début de message** (consigne système, jeu, notes, profil existant, pages) puis
la partie à écrire : le moteur garde ce début en mémoire (`cache_prompt`) et ne le relit pas, seule la première
étape paie la lecture des pages. Une étape 3 ou 4 illisible laisse sa partie vide avec un avertissement (« à
compléter à la main ») au lieu de faire échouer tout le brouillon.

**File d'attente** : le processus de fond fait **un brouillon à la fois**, du plus ancien au plus récent ; un
brouillon lancé pendant qu'un autre calcule est « En attente : n° 2 dans la file » et part ensuite. Relancer **le
même jeu** pendant que son brouillon attend ou calcule est refusé (`brouillon-en-cours`) ; un brouillon resté « en
préparation » sans nouvelle depuis 15 minutes (processus arrêté) ne bloque plus.
La **lecture des réponses ne change pas** : `JSON.parse` puis validation **stricte** par schéma (champs inconnus jetés,
textes bornés, images et sources https publiques), et rien n'est enregistré sans la validation du Fondateur.

## Sécurité

- L'adresse `http://127.0.0.1:<port>` est construite **dans le seul connecteur local**
  (`creerConnecteurLocal`, `esport/noyau/ia/connecteur.mjs`) à partir du port entier donné par le gestionnaire : c'est
  la seule exception à « https public seulement », et elle ne vient jamais de la configuration, d'une page ni du
  modèle. La **garde anti-SSRF des pages lues est inchangée** : une adresse locale proposée par le modèle
  (`http://127.0.0.1:8080/…`, `https://localhost/…`) est écartée comme avant.
- Aucune commande passe par un shell : tous les lancements (`llama-server`, `nice`, `git`, `tar`, `micromamba`,
  `cmake`) reçoivent leurs arguments en liste ; les valeurs de configuration sont bornées (entiers, nom de modèle
  `[a-z0-9._-]`, révision hexadécimale).
- Le moteur reçoit un environnement minimal (pas de `IA_API_CLE`, `DATABASE_URL`, `CLE_ESPORT`…, aucune variable
  `LLAMA_ARG_*`). Ni le port ni la clé du moteur ne sont renvoyés par l'API.

## Réglages (`~/.appdashboard/esport.env`)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `IA_FOURNISSEUR=local` | — | IA locale en tête de l'ordre des profils de jeu par défaut (`local,api,api2`) |
| `IA_LOCALE_MODELE` | `qwen2.5-7b` | `qwen2.5-7b` ou `qwen3-4b` (installé avec `--petit`) |
| `IA_LOCALE_THREADS` | `8` | Fils de calcul (1 à 32) |
| `IA_LOCALE_DOSSIER` | `~/.appdashboard/ia-locale` | Dossier de l'installation (absolu, hors `public_html` et du dépôt) |
| `IA_LOCALE_CONTEXTE` | `8192` | Taille du contexte en jetons (4 096 à 32 768 ; plus = plus de mémoire) |
| `IA_LOCALE_INACTIVITE_MIN` | `5` | Arrêt du moteur après N minutes sans requête |
| `IA_LOCALE_DELAI_MIN` | `20` | Durée maximale d'une requête, attente comprise |
| `IA_LOCALE_DEMARRAGE_S` | `300` | Chargement du modèle au plus |
| `IA_LOCALE_JETONS_MAX` | `4096` | Jetons écrits au plus par requête |
| `IA_LOCALE_FILE_MAX` | `4` | Requêtes en attente au plus |
| `IA_LOCALE_NICE` | `19` | Priorité du moteur (19 = la plus basse) |
| `IA_LOCALE_DUREE_TRAVAILLEUR_MIN` | `60` | Vie d'un processus de fond avant de passer la main |
| `IA_LOCALE_TUES_MAX` | `2` | Arrêts de force (SIGKILL de l'hébergeur) de suite avant « indisponible sur cet hébergement » (sautée) |

## Vitesse et ressources (ordres de grandeur)

Mesurez sur **votre** serveur : `bash ~/application-enzo/esport/serveur/installer-ia-locale.sh --test` (chargement,
jetons par seconde, mémoire, un essai JSON en anglais et un résumé en français, puis un **essai de brouillon
complet** — même chemin que l'app : flux, étapes, consignes compactes, sur un jeu fictif avec deux pages fictives —
avec la durée de chaque étape, la durée totale et la mémoire maximale du moteur, puis une recommandation).
Estimations pour un processeur de serveur récent avec 8 fils, à confirmer par le test :

| Modèle | Mémoire du moteur | Écriture | Brouillon de profil | Test de connexion |
| --- | --- | --- | --- | --- |
| Qwen2.5-7B (défaut) | ≈ 5,5 Go | 4 à 8 jetons/s | 5 à 10 min (lecture des pages 1 à 3 min, puis 1 à 3 min par étape) | 20 à 60 s (chargement compris) |
| Qwen3-4B (`--petit`) | ≈ 3 Go | 8 à 15 jetons/s | 3 à 6 min | 10 à 30 s |

Le compte o2switch a de la marge (48 Go de mémoire physique, 400 processus ; la machine montre 64 cœurs et 125 Go,
mais c'est l'hôte), et le serveur est **partagé** : CloudLinux limite le processeur, la mémoire et les entrées-sorties
du compte (limites « LVE » : cPanel › **Resource Usage**). Gardez 8 fils au plus. Le moteur est lancé avec 4 fils HTTP
(`--threads-http 4`, au lieu d'un par cœur visible) et le modèle en lecture projetée (`mmap`, par défaut de llama.cpp :
pages du fichier partagées, récupérables ; `--mlock` n'est pas utilisé). Les fautes « IO » au chargement du modèle
ralentissent mais ne tuent pas.

## Dépannage

Tout ce qui concerne le moteur est noté dans **`~/logs/esport-ia-locale.log`** : sorties de `llama-server`, et des
lignes `[esport] IA locale (rôle, pid …)` qui disent **qui** a fait quoi (`app`, `travailleur` = processus de fond,
`cron`, `installateur`, `diagnostic`) : moteur prêt (durée du chargement, contexte, mémoire, processus visibles du
compte), **chaque requête terminée** (durée, jetons lus dont ceux déjà en cache, jetons écrits, vitesses), requête
échouée avec sa **cause technique** (`ECONNRESET`, `ECONNREFUSED`…) et l'état du moteur à cet instant, **chaque arrêt**
du moteur (« arrêté à notre demande » ou « arrêté de façon imprévue », avec la phase — chargement, au repos, PENDANT
une requête, pendant son arrêt — le **signal** reçu et la mémoire relevée juste avant), moteur orphelin nettoyé.
La « dernière erreur » de la carte **Moteur de l'IA** est partagée entre l'app et le processus de fond
(`etat/incident.json`), effacée dès qu'une requête réussit.

### « Tué par nous » ou « tué par l'extérieur » ?

**Chaque signal envoyé par notre code** (app, processus de fond, cron, installateur, diagnostic) est noté **avant**
l'envoi : `signal SIGTERM envoyé à pid 12345 (moteur) : inactivité (300 s sans requête)`, avec le rôle et le pid de
l'expéditeur. Nous n'envoyons que `SIGTERM` (arrêt propre) ; `SIGKILL` seulement si le moteur est encore là 10 s
après, et c'est noté aussi. Donc :

```bash
grep -E "signal SIG|imprévue|orphelin|hors de portée|diagnostic" ~/logs/esport-ia-locale.log | tail -n 60
```

- une ligne « arrêté de façon imprévue (signal SIGKILL : arrêté de force par un autre processus ou par l'hébergeur ;
  ce processus ne lui a envoyé aucun signal) » **sans** ligne « signal SIGKILL envoyé à pid <ce pid> » juste avant
  → **tué par l'extérieur** (aucun de nos programmes) ;
- une ligne « signal … envoyé à pid <ce pid> » → **tué par nous** : le rôle et la raison sont sur la ligne.

Pour trancher sans l'app : le **diagnostic** lance le moteur SEUL, au premier plan.

```bash
source /home/jayo8828/nodevenv/application-enzo/esport/22/bin/activate
cd ~/application-enzo
bash esport/serveur/installer-ia-locale.sh --petit --diagnostic            # 4 variantes × 60 s de calcul
bash esport/serveur/installer-ia-locale.sh --petit --diagnostic --duree 600 --variante http   # 10 min, comme un brouillon
```

Il vérifie et affiche qu'**aucun autre** de nos processus d'IA ne tourne (verrou du moteur libre, pas de processus de
fond, aucun moteur visible ; sinon il refuse : attendre 1 à 5 min), prend les verrous (l'app et le cron n'en lancent
pas pendant ce temps), puis essaie : `http` (comme l'app), `socket` (socket Unix : **aucun port TCP ouvert**),
`un-fil` (1 seul fil de calcul) et `cli` (`llama-completion`/`llama-cli` sans serveur, s'il est installé ; le moteur
compilé n'a que `llama-server`, la variante `socket` couvre alors le cas « sans port »). Chaque variante : chargement,
10 s au repos, puis calcul continu ; relevé chaque seconde (mémoire, processeur). Il conclut par **TUÉ PAR NOUS**,
**TUÉ PAR L'EXTÉRIEUR** (avec ce que les variantes éliminent : port, nombre de fils, calcul), **PLANTAGE DU MOTEUR**
ou **LE MOTEUR TIENT**, et affiche un **message prêt à envoyer au support o2switch** (heures UTC, phase, fils, mémoire,
processeur ; ni clé, ni port, ni domaine). En attendant la réponse : retirez l'IA locale de l'ordre de repli dans
l'Administration IA.

### « Indisponible sur cet hébergement » (arrêts de force répétés)

Sur o2switch (29/10), llama-server est arrêté de force (SIGKILL que nos programmes n'ont pas envoyé) au chargement ou
quelques secondes après le début du calcul, sans « faute » dans Resource Usage. Chaque arrêt de ce genre est compté
dans `~/.appdashboard/ia-locale/etat/hebergement.json` (partagé par l'app, le processus de fond et la transcription).
Au bout de **2 arrêts de suite** (`IA_LOCALE_TUES_MAX`), l'IA locale est marquée **« indisponible sur cet
hébergement »** : elle reste dans la configuration et dans les ordres de repli, mais elle est **sautée** (le moteur
suivant répond tout de suite, plus d'attente de 10 minutes), son processus de fond n'est plus lancé, et
l'Administration IA l'explique. Une requête réussie remet le compteur à zéro. Pour la réessayer :
`rm ~/.appdashboard/ia-locale/etat/hebergement.json` (relancer `installer-ia-locale.sh` l'efface aussi).

Piste documentée pour plus tard (pas implémentée) : **node-llama-cpp**, qui calculerait dans le processus Node,
comme la transcription (le calcul dans `node` n'est pas arrêté par l'hébergeur).

### Un seul moteur pour tout le compte

Le verrou `etat/serveur.json` est un **bail** : le propriétaire y inscrit son pid, son **espace de processus**
(`/proc/self/ns/pid`), l'identifiant de démarrage de la machine et son heure de démarrage, le pid du moteur et l'heure
de démarrage du moteur, et le renouvelle toutes les 30 s. Sous CloudLinux/CageFS, l'app (Passenger), le cron et une
session SSH peuvent **ne pas se voir** (`kill(pid, 0)` répond « n'existe pas » pour un processus bien vivant) : avant
octobre 2026, un propriétaire vivant pouvait passer pour mort, son verrou et sa clé étaient retirés et un **second
moteur** était lancé. Désormais :

- le propriétaire est vivant tant que son bail est récent (moins de 3 min), **quoi que dise `kill(pid, 0)`** ; il n'est
  déclaré mort plus tôt que si c'est **certain** (même espace de processus que nous et disparu, pid réutilisé, machine
  redémarrée) ;
- un moteur orphelin n'est arrêté que s'il est **identifié** (visible d'ici, notre fichier de clé sur sa ligne de
  commande, même heure de démarrage que celle inscrite) : SIGTERM, puis SIGKILL s'il résiste, tout est journalisé ;
- un moteur orphelin **hors de portée** (autre espace de processus) qui répond encore sur son port avec notre clé :
  aucun signal, verrou gardé, **aucun second moteur** (« ENCORE EN MARCHE et hors de portée d'ici » dans le journal) ;
- avant de lancer un moteur, un moteur visible lancé avec notre clé mais inscrit à aucun verrou est arrêté (SIGTERM) ;
- le moteur est lancé **détaché** (son propre groupe de processus) : la fin d'une session SSH ou un signal adressé au
  groupe de l'app ne l'atteint pas ; son propriétaire l'arrête lui-même (SIGTERM journalisé, y compris à sa sortie) ;
- l'installateur (`--test`) passe par le même verrou : si l'app ou le processus de fond tient le moteur, il **attend**
  (6 min au plus) puis renonce proprement, sans second moteur ; Ctrl-C arrête son moteur proprement ;
- le verrou du processus de fond suit la même règle (battement plutôt que `kill(pid, 0)`).

Le banc d'essai (`--test`) appelle le moteur par le même transport que l'app (`node:http`, une connexion par requête ;
plus le `fetch` global, dont la connexion gardée ouverte pouvait être refermée par le moteur entre deux essais), et
affiche la **cause réelle** d'un échec au lieu de `TypeError: fetch failed` : sortie du moteur (signal, code, envoyé
par nous ou non), signaux de nos programmes vers lui, dernières lignes du moteur.

| Message / code | Cause probable | Que faire |
| --- | --- | --- |
| Brouillon en échec « Le moteur d'IA locale a coupé la connexion pendant le calcul (ECONNRESET) », ou « L'IA locale n'a pas pu démarrer » juste après (version du 28 octobre 2026) | Le moteur s'arrêtait **en plein calcul** d'une seule énorme requête (pages + jusqu'à 4 000 jetons écrits, plus de 10 min). Le délai du moteur n'en est pas la cause : `--timeout` de llama-server b11351 est le délai de lecture/écriture de son serveur HTTP (600 s par défaut), nous le réglons sur `IA_LOCALE_DELAI_MIN` (1 200 s), et une requête en cours de calcul n'est pas coupée par lui. ECONNRESET signifie que le moteur a fermé la connexion sans répondre : cause la plus probable, il a été **tué par le système** (limite mémoire du compte, qui grandit avec la longueur du texte lu) ou s'est planté — à confirmer dans le journal (« arrêté de façon imprévue (signal …) », avec désormais la mémoire relevée juste avant). **Corrigé** : requêtes en flux, brouillon en 4 petites étapes, pages réduites au texte utile, contexte 8 192 (moins de mémoire), message précis (`ia-locale-tuee`, `ia-locale-plantage`), second essai de démarrage après une courte pause, file d'attente des brouillons. | Mettre à jour l'app, redémarrer l'app, relancer **un** brouillon ; s'il échoue encore en `ia-locale-tuee`, voir cette ligne plus bas. |
| Brouillon en échec « Service d'IA injoignable » alors que **Tester l'IA locale** réussit (avant octobre 2026) | Le `fetch` de Node (undici) abandonne une requête après **300 s sans en-têtes** ; llama-server n'en envoie qu'à la fin de la génération (un brouillon dure 5 à 15 min). **Corrigé** : le moteur local est appelé par `node:http` sans ce délai (`esport/serveur/ia-locale/transport.mjs`) ; seul `IA_LOCALE_DELAI_MIN` borne la requête. | Mettre à jour l'app (déploiement), redémarrer l'app, relancer le brouillon. |
| `ia-delai-connexion` | Un client HTTP a expiré avant la réponse (cause dans le message : `UND_ERR_HEADERS_TIMEOUT`…) | Ne devrait plus arriver pour l'IA locale ; sinon, signaler avec la ligne du journal. |
| `ia-delai` | La requête a dépassé `IA_LOCALE_DELAI_MIN` (20 min, attente comprise) | Moins de pages de référence, `IA_LOCALE_JETONS_MAX` plus bas, modèle `--petit`, ou délai plus long. |
| `ia-locale-tuee` | Le moteur a reçu `SIGKILL` pendant le calcul **sans que ce processus le lui ait envoyé** : un autre programme ou l'**hébergeur**. Sur o2switch, cPanel › Resource Usage ne montre aucune faute mémoire (limite 48 Go) : ce n'est pas la limite LVE. | Voir « Tué par nous ou tué par l'extérieur ? » : lignes « signal … envoyé » du journal, puis `--diagnostic`. |
| `ia-locale-plantage` | Le moteur s'est arrêté brutalement (autre signal, `SIGSEGV`, `SIGABRT`, ou code d'erreur) | Les dernières lignes de `llama-server` au-dessus dans le journal ; relancer ; si cela se répète, `installer-ia-locale.sh --forcer`. |
| `ia-locale-demarrage-tue` | Le moteur a reçu `SIGKILL` **pendant le chargement**, deux fois de suite (un second essai est fait après 5 s) | Comme `ia-locale-tuee`. |
| `ia-locale-coupee` | Le moteur a coupé la connexion pendant le calcul sans être mort (redémarré, connexion fermée) | Chercher juste au-dessus dans le journal ; relancer. |
| `ia-locale-bloquee` | Plus aucun signe de vie du moteur pendant 5 minutes (processeur bloqué par la limite CPU du compte ?) | cPanel › Resource Usage ; `IA_LOCALE_THREADS=4`. |
| `ia-locale-contexte` | La demande ne tient pas dans le contexte (`IA_LOCALE_CONTEXTE`) | Moins de pages de référence, ou contexte plus grand (plus de mémoire). |
| `ia-locale-refus` | Le moteur a répondu par une erreur (code HTTP et type dans le message) | Le message complet est dans le journal (« requête échouée »). |
| `ia-reponse-tronquee` | Une étape a atteint sa limite d'écriture (`finish_reason: length`) | Relancer ; `IA_LOCALE_JETONS_MAX` borne aussi chaque étape. |
| `brouillon-en-cours` | Un brouillon de ce jeu attend ou calcule déjà | Attendre qu'il soit prêt (la liste montre l'étape en cours ou la place dans la file). |
| « Service d'IA injoignable » avec l'IA locale en tête de l'ordre | Le moteur local a échoué et les **API** de secours ont échoué à leur tour (adresse ou réseau) : c'est le seul chemin qui passe encore par le `fetch` global ; l'IA locale, elle, est toujours appelée par `transport.mjs` (app, processus de fond, installateur). | Corriger `IA_API_URL` / `IA_API_CLE` (ou `IA_API2_*`), ou ne garder que l'IA locale dans l'ordre de repli. |
| `ia-locale-arretee` | Plus rien n'écoute : le moteur s'était déjà arrêté | Idem. |
| `ia-locale-arret` (carte) | Le moteur s'est arrêté de lui-même | Idem ; voir les dernières lignes de `llama-server` dans le journal. |
| `ia-locale-demarrage` | Le moteur n'a pas démarré (binaire, modèle, mémoire, chargement > `IA_LOCALE_DEMARRAGE_S`) | La raison exacte est dans le journal (« démarrage impossible : … »). |
| `ia-locale-occupee` | Un autre processus (souvent le processus de fond en plein brouillon) tient le moteur, ou un moteur sans propriétaire répond encore hors de portée | Attendre la fin du brouillon ; le test de connexion n'interrompt jamais un calcul. Si cela dure : `grep "hors de portée" ~/logs/esport-ia-locale.log`. |

Garanties (testées dans `esport/test/ia-locale.test.mjs` et `esport/test/ia-locale-signaux.test.mjs`, avec une
visibilité des processus simulée) : un propriétaire invisible mais dont le bail est récent n'est jamais pris pour mort ;
aucun signal à un moteur non identifié ; SIGTERM avant SIGKILL, chacun journalisé ; un SIGKILL venu d'ailleurs est
reconnu même pendant notre propre arrêt ; le diagnostic distingue « tué par nous » et « tué par l'extérieur » ; un moteur dont le propriétaire est vivant et bat (toutes
les 30 s) n'est **jamais** arrêté par l'app, le cron ou un autre processus ; l'arrêt pour inactivité n'a pas lieu pendant
une requête (le minuteur ne repart qu'à la fin) ; un processus ne retire jamais le verrou ni la clé d'un autre, même
quand il nettoie un orphelin au moment où un autre processus reprend le moteur ; le verrou du processus de fond est créé
d'un coup avec son pid (jamais deux processus de fond) ; un calcul plus long que le délai d'inactivité d'un faux moteur
aboutit en flux (et échoue en ECONNRESET sans flux) ; moteur tué (`SIGKILL`) ou planté pendant le calcul → messages
distincts ; mort au chargement → second essai ; brouillon en étapes (début de message commun, progression, étape
illisible tolérée), file d'attente et doublons. Pendant un brouillon, la liste affiche « Calcul en cours depuis N
minutes » et l'étape en cours.

## Désinstaller

```bash
rm -rf ~/.appdashboard/ia-locale
rm -f ~/logs/esport-ia-locale.log
```

Puis retirez les lignes `IA_FOURNISSEUR=local` et `IA_LOCALE_*` de `~/.appdashboard/esport.env` et redémarrez l'app
Esport. L'assistant revient à la clé d'API (ou se coupe s'il n'y en a pas).

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `esport/serveur/installer-ia-locale.sh` | Script à lancer (trouve le Node de l'app, `nice 19`) |
| `esport/serveur/ia-locale/installer.mjs` | Installation, `--test`, `--dry-run`, `--diagnostic` |
| `esport/serveur/ia-locale/diagnostic.mjs` | `--diagnostic` : moteur lancé seul, « tué par nous » ou « tué par l'extérieur » |
| `esport/serveur/ia-locale/processus.mjs` | Identité des processus (espace de pid, heure de démarrage), mort certaine, signaux journalisés, mémoire du compte |
| `esport/serveur/ia-locale/installation.mjs` | Versions figées, modèles, emplacements, état de l'installation |
| `esport/serveur/ia-locale/outils-compilation.lock` | Paquets conda-forge figés du compilateur (adresse + SHA-256) |
| `esport/serveur/ia-locale/gestionnaire.mjs` | Démarrage à la demande, verrou, orphelins, file d'attente, arrêt |
| `esport/serveur/ia-locale/service.mjs` | Branchement dans l'app, le cron et le processus de fond |
| `esport/serveur/ia-locale/transport.mjs` | Appel HTTP du moteur local (`node:http`, sans les délais de 300 s d'undici) |
| `esport/serveur/ia-locale/lanceur.mjs`, `travailleur.mjs` | Processus de fond |
| `esport/noyau/ia/connecteur.mjs` | `configIaLocale`, `creerConnecteurLocal` |
| `esport/noyau/ia/consignes-compactes.mjs` | Consignes et schémas JSON pour un petit modèle |
| `esport/test/ia-locale.test.mjs`, `ia-locale-signaux.test.mjs` | Tests (faux moteur : aucun modèle, aucun téléchargement ; visibilité des processus simulée) |
