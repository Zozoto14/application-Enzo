# Transcription des réunions : qualité (Whisper ONNX dans Node, vocabulaire de la team, relecture par l'IA)

Public : le Fondateur (installation) et les responsables de team (réglages). Installation pas à pas :
[o2switch.md](../o2switch.md), partie H. Dépôt, PDF, boîte du rédacteur : [resumes.md](resumes.md).

## 30 octobre 2026 : vos réunions ne quittent plus le serveur (confidentialité)

Décision du Fondateur : « Non, ce n'est pas OK que ça envoie mes réunions à NVIDIA. » Jusqu'ici, la relecture par l'IA
passait par l'ordre « léger » (`IA_ORDRE_LEGER` = `api2` : NVIDIA gpt-oss-20b en tête), et l'IA locale étant tuée par
l'hébergeur, **le texte des réunions partait chez NVIDIA**. Désormais (règle du connecteur, voir
[ia-api.md](ia-api.md) partie 2 bis) :

- **Relecture IA = IA locale seulement**, quel que soit l'ordre de repli. Sans IA locale utilisable (pas installée, ou
  « indisponible sur cet hébergement »), **pas de relecture** : la transcription garde le **nettoyage sans IA**
  (anti-répétitions, génériques inventés, annotations) et l'écran affiche « **Relecture IA désactivée : aucune IA
  locale disponible ; vos réunions ne quittent pas le serveur** » (Paramètres de la team et transcription prête).
- **L'API audio externe** (`TRANSCRIPTION_API=openai`) n'est **jamais** utilisée, même configurée, tant que le
  Fondateur ne l'a pas **explicitement autorisée** (Administration IA › Confidentialité › « Transcription des
  réunions » › « Autoriser l'envoi à un service externe »). Sans cette autorisation : le mode « externe » n'est pas
  proposé, `POST …/transcription/externe` répond 503, et les demandes déjà en file « externe » repassent « à
  transcrire » sans que rien ne soit envoyé.
- Le Fondateur peut lever la règle pour la relecture seule (« Relecture par l'IA des transcriptions ») : la relecture
  peut alors utiliser l'API configurée quand l'IA locale manque. Chaque changement est journalisé.
- Aucune autre fonction n'envoie le contenu des réunions à une API : le pré-résumé est calculé sans IA, le PDF sur le
  serveur, la transcription dans le navigateur reste dans le navigateur (seuls la bibliothèque et le modèle Whisper
  sont téléchargés), et le bot Discord n'annonce que le **titre** d'une réunion.

## 30 octobre 2026 : le calcul revient DANS le processus Node

**Constat sur o2switch (journaux réels)** : l'ancien moteur ONNX (Whisper dans le processus Node) a transcrit sans
incident « Entretien Part. 1 » (6 min) et « Part. 2 » (28 min, 82 morceaux) ; whisper.cpp (binaire externe) est
**tué à chaque fois** (`whisper.cpp s'est arrêté (signal SIGKILL) : read_audio_data…`, « 0 bloc(s) d'audio »), comme
llama-server (IA locale), sans aucune « faute » mémoire ou processeur dans Resource Usage. Conclusion : l'hébergeur
arrête de force les binaires de calcul lancés depuis le dossier personnel (surveillance anti-minage probable), mais
laisse calculer `node`.

**Ce qui change** :

- **Moteur par défaut : Whisper par ONNX Runtime dans le processus Node** (`esport/serveur/transcription/whisper.mjs`,
  `onnxruntime-node` figé), avec des modèles **bien plus grands** que « base » (exports int8 de sherpa-onnx, poids
  d'origine d'OpenAI) : **small** (Rapide), **large-v3-turbo** (Équilibrée), **large-v3** (Maximale). Les fichiers de
  128 bandes mel (large-v3, turbo) sont gérés.
- Toutes les améliorations de la version whisper.cpp sont refaites dans ce décodeur : **prompt de vocabulaire** de la
  team (découpage BPE exact de Whisper, `<|startofprev|>`) **+ texte du morceau précédent** (contexte, comme Whisper),
  **recherche en faisceau** (beam 5, une file de cache clés/valeurs par hypothèse), **températures de repli** (0 → 1 ;
  texte en boucle, taux de compression > 2,4 ou log-prob moyenne < -1 → nouvel essai par échantillonnage, `bestOf`
  candidats), **jetons non parlés supprimés**, règle « pas de parole » (0,6), boucles coupées ; langue imposée ou
  détectée ; **découpage dans les silences** (morceaux ≤ 30 s coupés au moment le plus calme), **zone de parole seule**
  (détection par l'énergie, silence jamais confié à Whisper), **marge reprise** (1,5 s) quand la coupe tombe en
  pleine parole, recollée sans doublon ; filtres anti-hallucination et nettoyage ; écho du prompt écarté ;
  **relecture par l'IA locale** via le connecteur (`discuterPour('correction', …)`, tâche confidentielle).
- **ffmpeg** ne sert que quelques secondes à lire la vidéo (il a toujours fonctionné, y compris avec l'ancien moteur) ;
  s'il était arrêté de force, l'erreur le dit (`ffmpeg a été arrêté (signal SIGKILL…)`) et un nouvel essai a lieu ;
  un WAV se lit sans lui.
- **whisper.cpp reste en option** (`installer-transcription.sh --whispercpp`, `TRANSCRIPTION_MOTEUR=whispercpp`). S'il
  est **arrêté de force** (SIGKILL que nos programmes n'ont pas envoyé), le processus de fond **bascule tout seul sur
  ONNX pour ce travail** (même bloc repris, aucun essai compté) et **désactive whisper.cpp** pour la suite
  (`~/esport-modeles/whispercpp-desactive.json`, affiché dans Administration IA › Transcription sur le serveur ;
  supprimer ce fichier pour le réessayer).
- **File d'attente** (« En file d'attente : démarre dans les 5 minutes » sans fin) : après un échec, l'app affiche la
  **raison**, l'**heure du nouvel essai** et les **essais restants** ; un travail en attente depuis plus de 15 min
  (ou « en cours » sans battement) est signalé **bloqué** avec **« Relancer maintenant »** (essais remis à zéro, en tête
  de file) ; le cron écrit sa décision dans son journal (« transcription : lancé / déjà en cours (pid …) / rien à
  faire ») et dans `~/esport-modeles/lanceur.json` ; le processus de fond note son démarrage ; un **chien de garde**
  arrête un processus sans aucune avancée pendant 45 min (`TRANSCRIPTION_BLOCAGE_MIN`) au lieu de garder le verrou
  et le bail indéfiniment ; l'attente du verrou commun avec l'IA locale est toujours bornée.

  Cause du blocage observé : le verrou du processus de fond était renouvelé chaque minute par un minuteur tant que le
  processus vivait, **même s'il n'avançait plus** (attente sans fin d'un moteur, d'une connexion…) ; le cron répondait
  alors « déjà en cours » sans rien écrire, et l'app affichait « démarre dans les 5 minutes » (elle ne montrait pas
  non plus l'heure d'un nouvel essai déjà passée, ni la raison de l'échec précédent).

Installation et commandes : [o2switch.md](../o2switch.md), parties H1 à H5.

## Pourquoi c'était mauvais (diagnostic d'octobre 2026)

Le moteur du serveur (migration 0016) faisait tourner **Whisper « base »** (74 M de paramètres, int8) avec ONNX
Runtime, et un décodeur écrit à la main :

| Cause | Effet sur le texte |
| --- | --- |
| Modèle « base » (le 2e plus petit de Whisper) | Français approximatif, mots inventés, accords faux : c'est la cause principale |
| Décodage **glouton** (un seul candidat), **sans** température de repli | Une fenêtre ratée reste ratée (phrases qui « ne veulent rien dire ») |
| **Aucun prompt** : Whisper ne connaissait ni les pseudos, ni les agents, ni les maps | « Jett » → « jet », « Ascent » → « assent », pseudos déformés |
| Morceaux de **30 s indépendants**, sans contexte du morceau précédent ni chevauchement | Phrases coupées en deux, début de morceau sans contexte |
| Pas de détection de la parole (seulement un seuil d'énergie RMS) | Silences et bruits de clavier transcrits en génériques (« Sous-titres réalisés par… ») |
| Pas de normalisation du volume ni de filtre | Joueur qui parle bas sur Discord mal reconnu, souffle et ronflement |
| Pas d'horodatage par phrase (un segment = 30 s) | Lecture et correction pénibles |

Ce qui était déjà juste : rééchantillonnage en 16 kHz mono (ffmpeg), langue imposée (français par défaut), coupe
des morceaux dans le moment le plus calme, coupure des boucles de répétition dans le décodeur.

## Ce qui change

### 1. Moteur : whisper.cpp + large-v3-turbo (29 octobre ; option depuis le 30 octobre, voir plus haut)

- **whisper.cpp v1.9.5** (ggml-org/whisper.cpp, commit `d1be6fde11ac`), **compilé sur le serveur sans root** par
  `installer-transcription.sh` : avec le compilateur du système s'il est assez récent, sinon avec le **même GCC 14
  figé que l'IA locale** (micromamba + paquets conda-forge vérifiés par SHA-256, `outils-compilation.lock`), effacé
  ensuite. Binaire autonome (glibc 2.27 suffit), lancé à la demande en `nice 19`, environnement vidé.
- **Modèles GGML** d'OpenAI Whisper (Hugging Face `ggerganov/whisper.cpp`) : vérifiés par le **SHA-256** publié par
  Hugging Face pour la révision téléchargée **et** par le **SHA-1** publié dans `models/README.md` de whisper.cpp
  (figé dans `esport/serveur/transcription/whispercpp.mjs`).
- **Détection de la parole Silero VAD v6.2.0** : fichier pris dans les sources de whisper.cpp au commit vérifié
  (SHA-256 figé), aucun téléchargement de plus.
- **Repli** : si whisper.cpp ne peut pas être installé, l'ancien moteur ONNX reste utilisé (qualité « Équilibrée »
  seulement, morceaux de 30 s), avec les nouveaux garde-fous sur le texte.

Pourquoi ce choix sur o2switch (CloudLinux 8, glibc 2.28, pas de GPU, pas de root, 48 Go) : faster-whisper
(CTranslate2) demande Python et des roues récentes ; les binaires ONNX gros modèles sont lents et lourds ; whisper.cpp
se compile comme llama.cpp (outillage déjà en place), quantifie large-v3-turbo en **≈ 550 Mo / ≈ 1,2 Go de mémoire**,
et apporte beam search, seuils anti-hallucination, prompt et VAD sans rien écrire nous-mêmes.

### 2. Trois qualités (choisies au dépôt, par défaut pour la team, ou « Retranscrire avec la meilleure qualité »)

Moteur par défaut (ONNX dans Node, 4 fils ; `--test` mesure les vraies valeurs) :

| Qualité | Modèle ONNX int8 (réglable) | Décodage | Mémoire | 1 h de réunion (estimation, pauses comprises) |
| --- | --- | --- | --- | --- |
| Rapide | `small` (≈ 0,4 Go) | glouton, repli à 0,4 et 0,8 | ≈ 1,1 Go | 20 à 40 min |
| **Équilibrée** (défaut) | `turbo` = large-v3-turbo (≈ 1 Go) | beam 5, 5 candidats en repli | ≈ 2,6 Go | 45 à 90 min |
| Maximale | `large-v3` (≈ 1,8 Go) | beam 5, 5 candidats en repli | ≈ 4,5 Go | 2 h 30 à 5 h |

Avec whisper.cpp (option, 8 fils) :

| Qualité | Modèle GGML (réglable) | Décodage | 1 h de réunion |
| --- | --- | --- | --- |
| Rapide | `small` (466 Mo) | glouton + repli de température | 8 à 15 min |
| **Équilibrée** (défaut) | `large-v3-turbo-q5_0` (547 Mo) | beam 5, 5 candidats en repli | 20 à 40 min |
| Maximale | `large-v3-q5_0` (1,1 Go) | beam 5, 5 candidats en repli | 60 à 120 min |

Les durées affichées dans l'app viennent des **mesures** de `installer-transcription.sh --test` sur le serveur
(pret.json), sinon de ces valeurs de départ. Une qualité dont le modèle n'est pas installé n'est pas proposée ; une
demande retombe sur la plus proche installée.

### 3. Réglages du décodage (`argumentsWhisperCli`)

- beam search 5 (Équilibrée, Maximale), températures de repli 0 → 0,2 → … 1,0 ;
- seuils d'OpenAI : entropie 2,4 (équivalent du « compression ratio » : texte en boucle → relance), log-prob
  moyenne -1, « pas de parole » 0,6 ; jetons non parlés supprimés (`-sns` : pas de [Musique], ♪) ;
- VAD : parole ≥ 250 ms, silence ≥ 500 ms, marge 200 ms, fenêtres de parole ≤ 30 s ; les horodatages restent ceux de
  l'enregistrement ;
- **blocs de 5 minutes** (`TRANSCRIPTION_BLOC_S`) coupés dans le silence le plus calme de la dernière minute, avec
  **1,5 s de chevauchement** ; au recollage, les segments déjà acquis et les mots répétés à la jointure sont retirés
  (`recollerSegments`) ;
- chaque bloc est enregistré en base : une interruption reprend au bloc suivant.

### 4. Langue et vocabulaire de la team (le plus important pour la justesse)

- **Langue** par team (Paramètres › Transcription des réunions) : **français** par défaut, anglais, ou **détection
  automatique** ; modifiable au dépôt.
- **Prompt initial** construit automatiquement (`construirePromptVocabulaire`, ≈ 600 caractères, gardé pour toutes
  les fenêtres) : nom de la team et du jeu, **glossaire de la team** (Paramètres : pseudos, surnoms, callouts maison),
  **pseudos des membres** (et nom du Riot ID), **adversaires** du scouting et leurs joueurs, **agents, maps et modes**
  du profil de jeu, termes esport courants (et ceux du jeu : Spike, plant, retake… ; cashout, vault… pour The Finals).
  Exemple : « Réunion de l'équipe Faucons sur Valorant. Vocabulaire : B main, Zozoto. Joueurs : Léa, Tom. Adversaires :
  Karmine Corp. Agents : Jett, Sova… Maps : Ascent, Bind… »

### 5. Prétraitement audio

ffmpeg (paquet `ffmpeg-static`, sinon celui du système) : mono 16 kHz, **passe-haut 80 Hz**, **normalisation
dynamique** du volume (`dynaudnorm`, gain ≤ × 15). Sans ffmpeg (WAV seulement) : passe-haut, gain global vers
-20 dBFS et limiteur doux (`pretraiterPcm`).

### 6. Garde-fous sur le texte (tous les moteurs, API externe comprise)

Annotations retirées ([Musique], (rires), ♪), **boucles** coupées (un groupe de mots répété 3 fois ou plus, un mot
répété 4 fois ou plus), **génériques inventés** retirés (« Sous-titres réalisés par la communauté d'Amara.org »,
« Merci d'avoir regardé »…), segment identique au précédent retiré.

### 7. Relecture par l'IA (post-correction), active par défaut si l'IA LOCALE est disponible

- Après la transcription, l'IA relit le texte **par lots de ~16 segments** : orthographe, grammaire, ponctuation,
  majuscules et mots mal reconnus évidents (surtout ceux du **glossaire** : pseudos, agents, maps). Consigne stricte :
  ne pas résumer, ne rien ajouter, ne rien retirer, une ligne pour une ligne, le texte de la réunion est une donnée.
- **Garde « ne pas inventer »** (`verifierLigne`) sur chaque ligne : longueur entre 70 % et 135 % de l'originale,
  au plus ~20 % de mots nouveaux (hors corrections d'orthographe et glossaire), au plus ~25 % de mots perdus. Une
  ligne refusée reste brute.
- Passe par le **connecteur IA** (jamais d'appel direct à un moteur) : répartiteur `creerIaDepuisEnv(…).discuterPour(
  'correction', …)`, tâche **confidentielle** : **IA locale seulement**, quels que soient `IA_ORDRE_LEGER` et l'ordre
  de l'Administration IA (voir [ia-api.md](ia-api.md), partie 2 bis). L'**IA locale** y est branchée avec le même
  gestionnaire « un seul moteur » (rôle « transcription »). Sans IA locale : **pas de relecture**, message « Relecture
  IA désactivée : aucune IA locale disponible ; vos réunions ne quittent pas le serveur » (le texte n'est jamais
  envoyé à une API, sauf levée explicite par le Fondateur). Si l'IA locale cesse de répondre en cours de route, la
  relecture s'arrête et le reste est gardé brut : la transcription n'échoue jamais pour ça.
- La **version brute** est gardée (`transcriptions.segments_bruts`) : l'éditeur bascule **« Relu par l'IA » / « Brut
  (Whisper) »** ; enregistrer la version brute en fait le texte de la transcription.
- Désactivable par team (Paramètres) ou pour tout le serveur (`TRANSCRIPTION_CORRECTION=non`). Une clé d'API seule
  ne la rend plus disponible.

### 8. Un seul moteur lourd à la fois (file commune avec l'IA locale)

Si la mémoire du compte ne permet pas whisper.cpp **et** llama-server ensemble (`TRANSCRIPTION_EXCLUSIF=auto` :
modèles + 1,5 Go au-delà de 85 % de `TRANSCRIPTION_RAM_COMPTE`, ou mémoire inconnue), la transcription prend, le temps
de chaque bloc, **le verrou de compte de l'IA locale** (`~/.appdashboard/ia-locale/etat/serveur.json`, rôle
« transcription ») : l'IA attend son tour, et réciproquement. Entre deux blocs, le verrou est rendu. Avec
`TRANSCRIPTION_RAM_COMPTE=48G` (o2switch), les deux tiennent : pas d'attente.

### 9. Diarisation (« Intervenant 1, 2… ») : pas faite

whisper.cpp ne sait séparer les voix qu'en stéréo (un canal par personne) ou avec tinydiarize (modèle anglais
seulement). Les enregistrements Discord sont mono et en français : aucune solution légère et fiable sur ce serveur,
donc rien plutôt qu'un étiquetage faux.

### 10. Écran

- Au dépôt et sur une réunion à transcrire : **Rapide / Équilibrée / Maximale** avec la **durée estimée** pour cet
  enregistrement ; progression (pourcentage, temps restant), puis « Relecture par l'IA locale… ».
- Transcription prête : **« Retranscrire avec la meilleure qualité »** (la meilleure installée).
- Éditeur : correction à la main de chaque segment (PDF régénéré), bascule relue / brute.
- Paramètres de la team : mode, langue, qualité, relecture par l'IA, glossaire.

### 11. API externe (compatible OpenAI `audio/transcriptions`)

**Désactivée par défaut, même configurée** (`TRANSCRIPTION_API=openai`…) : elle envoie l'audio de la réunion chez le
fournisseur, donc elle ne sert que si le Fondateur l'a **explicitement autorisée** (Administration IA ›
Confidentialité › « Transcription des réunions »). Elle reçoit alors le même **prompt de vocabulaire** (champ
`prompt`) et `temperature=0`, et sa réponse passe par les mêmes garde-fous.

## Réglages (`~/.appdashboard/esport.env`, tous facultatifs)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `TRANSCRIPTION_MOTEUR` | `auto` | `auto` (ONNX dans Node ; whisper.cpp seulement pour une qualité sans modèle ONNX), `onnx`, `whispercpp` (d'abord, bascule sur ONNX s'il est tué) |
| `TRANSCRIPTION_QUALITE` | `equilibree` | qualité par défaut des teams |
| `TRANSCRIPTION_ONNX_RAPIDE` / `_EQUILIBREE` / `_MAXIMALE` | `small` / `turbo` / `large-v3` | modèle ONNX de chaque qualité (`tiny`, `base`, `small`, `medium`, `turbo`, `large-v3`) |
| `TRANSCRIPTION_THREADS` | `4` | fils de calcul d'ONNX Runtime (1 à 16) |
| `TRANSCRIPTION_RAM_MAX` | `8G` | mémoire du processus Node (modèle compris) au-delà de laquelle le travail s'arrête |
| `TRANSCRIPTION_BLOCAGE_MIN` | `45` | minutes sans avancée avant que le processus de fond se déclare bloqué et s'arrête |
| `TRANSCRIPTION_MODELE_RAPIDE` / `_EQUILIBREE` / `_MAXIMALE` | `small` / `large-v3-turbo-q5_0` / `large-v3-q5_0` | modèle whisper.cpp de chaque qualité (option) |
| `TRANSCRIPTION_THREADS_WHISPER` | `8` | fils de calcul de whisper.cpp |
| `TRANSCRIPTION_BLOC_S` | `300` | durée d'un bloc (60 à 1800 s) |
| `TRANSCRIPTION_CHEVAUCHEMENT_S` | `1.5` | marge entre deux blocs |
| `TRANSCRIPTION_VAD` | `oui` | détection de la parole |
| `TRANSCRIPTION_CORRECTION` | `auto` | relecture par l'IA (`auto` = si disponible, `non`) |
| `TRANSCRIPTION_EXCLUSIF` | `auto` | jamais whisper.cpp et l'IA locale ensemble : `auto`, `oui`, `non` |
| `TRANSCRIPTION_RAM_COMPTE` | (inconnue) | mémoire du compte, ex. `48G` |
| `TRANSCRIPTION_MODELE` | `base` | ancien réglage : modèle ONNX unique d'une installation d'avant (qualité Équilibrée) |

## Tests
`esport/test/transcription-onnx.test.mjs` (aucun modèle, aucun téléchargement) : décodeur ONNX avec un **faux ONNX
Runtime** (BPE, prompt et texte précédent, 128 bandes mel, faisceau contre glouton, jeton non parlé, « pas de
parole », températures de repli sur une boucle), zone de parole, **bascule sur ONNX quand whisper.cpp est tué**
(SIGKILL), reconnaissance d'un SIGKILL extérieur, **file** (échec affiché, bloquée, « Relancer »), **verrou orphelin**,
**chien de garde**, plan d'installation (fichiers et SHA-256 publiés par Hugging Face, faux réseau).


`esport/test/transcription-qualite.test.mjs` (SQLite et PostgreSQL, aucun téléchargement) : prompt de vocabulaire,
garde-fous, blocs et recollage sans doublon, prétraitement, relecture avec un faux moteur et garde « ne pas inventer »,
choix du moteur et repli, arguments et sortie de whisper-cli, transcripteur avec un faux binaire, file commune avec
l'IA locale, de bout en bout (dépôt → blocs → relecture interrompue puis reprise → transcription relue + brute). Test
d'intégration facultatif avec le vrai whisper-cli : `ESPORT_TEST_WHISPER_CLI`, `ESPORT_TEST_WHISPER_MODELE`,
`ESPORT_TEST_WHISPER_WAV` (et `ESPORT_TEST_WHISPER_VAD`).
