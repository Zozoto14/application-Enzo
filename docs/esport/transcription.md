# Transcription des réunions : qualité (whisper.cpp, vocabulaire de la team, relecture par l'IA)

Public : le Fondateur (installation) et les responsables de team (réglages). Installation pas à pas :
[o2switch.md](../o2switch.md), partie H. Dépôt, PDF, boîte du rédacteur : [resumes.md](resumes.md).

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

### 1. Moteur : whisper.cpp + large-v3-turbo

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

| Qualité | Modèle (réglable) | Décodage | 1 h de réunion (estimation, 8 fils, pauses comprises) |
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

### 7. Relecture par l'IA (post-correction), active par défaut si une IA est configurée

- Après la transcription, l'IA relit le texte **par lots de ~16 segments** : orthographe, grammaire, ponctuation,
  majuscules et mots mal reconnus évidents (surtout ceux du **glossaire** : pseudos, agents, maps). Consigne stricte :
  ne pas résumer, ne rien ajouter, ne rien retirer, une ligne pour une ligne, le texte de la réunion est une donnée.
- **Garde « ne pas inventer »** (`verifierLigne`) sur chaque ligne : longueur entre 70 % et 135 % de l'originale,
  au plus ~20 % de mots nouveaux (hors corrections d'orthographe et glossaire), au plus ~25 % de mots perdus. Une
  ligne refusée reste brute.
- Passe par le **connecteur IA** (jamais d'appel direct à un moteur) : répartiteur `creerIaDepuisEnv(…).discuterPour(
  'correction', …)`, tâche **légère** dont l'ordre de repli se règle dans l'Administration IA (`IA_ORDRE_LEGER` :
  API secondaire, API principale, IA locale… voir [ia-api.md](ia-api.md)). L'**IA locale** y est branchée avec le même
  gestionnaire « un seul moteur » (rôle « transcription »). Attention : avec une API, le texte de la réunion part chez
  le fournisseur ; mettez `local` en tête de `IA_ORDRE_LEGER` pour le garder sur le serveur. Si aucun moteur ne répond,
  la relecture s'arrête et le reste est gardé brut : la transcription n'échoue jamais pour ça.
- La **version brute** est gardée (`transcriptions.segments_bruts`) : l'éditeur bascule **« Relu par l'IA » / « Brut
  (Whisper) »** ; enregistrer la version brute en fait le texte de la transcription.
- Désactivable par team (Paramètres) ou pour tout le serveur (`TRANSCRIPTION_CORRECTION=non`).

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

Toujours disponible (`TRANSCRIPTION_API=openai`…) ; elle reçoit maintenant le même **prompt de vocabulaire**
(champ `prompt`) et `temperature=0`, et sa réponse passe par les mêmes garde-fous.

## Réglages (`~/.appdashboard/esport.env`, tous facultatifs)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `TRANSCRIPTION_MOTEUR` | `auto` | `auto` (whisper.cpp sinon ONNX), `whispercpp`, `onnx` |
| `TRANSCRIPTION_QUALITE` | `equilibree` | qualité par défaut des teams |
| `TRANSCRIPTION_MODELE_RAPIDE` / `_EQUILIBREE` / `_MAXIMALE` | `small` / `large-v3-turbo-q5_0` / `large-v3-q5_0` | modèle de chaque qualité (`small`, `medium`, `large-v3-turbo-q5_0`, `large-v3-turbo`, `large-v3-q5_0`) |
| `TRANSCRIPTION_THREADS_WHISPER` | `8` | fils de calcul de whisper.cpp |
| `TRANSCRIPTION_BLOC_S` | `300` | durée d'un bloc (60 à 1800 s) |
| `TRANSCRIPTION_CHEVAUCHEMENT_S` | `1.5` | marge entre deux blocs |
| `TRANSCRIPTION_VAD` | `oui` | détection de la parole |
| `TRANSCRIPTION_CORRECTION` | `auto` | relecture par l'IA (`auto` = si disponible, `non`) |
| `TRANSCRIPTION_EXCLUSIF` | `auto` | jamais whisper.cpp et l'IA locale ensemble : `auto`, `oui`, `non` |
| `TRANSCRIPTION_RAM_COMPTE` | (inconnue) | mémoire du compte, ex. `48G` |
| `TRANSCRIPTION_MODELE`, `TRANSCRIPTION_THREADS` | `base`, `1` | repli ONNX |

## Tests

`esport/test/transcription-qualite.test.mjs` (SQLite et PostgreSQL, aucun téléchargement) : prompt de vocabulaire,
garde-fous, blocs et recollage sans doublon, prétraitement, relecture avec un faux moteur et garde « ne pas inventer »,
choix du moteur et repli, arguments et sortie de whisper-cli, transcripteur avec un faux binaire, file commune avec
l'IA locale, de bout en bout (dépôt → blocs → relecture interrompue puis reprise → transcription relue + brute). Test
d'intégration facultatif avec le vrai whisper-cli : `ESPORT_TEST_WHISPER_CLI`, `ESPORT_TEST_WHISPER_MODELE`,
`ESPORT_TEST_WHISPER_WAV` (et `ESPORT_TEST_WHISPER_VAD`).
