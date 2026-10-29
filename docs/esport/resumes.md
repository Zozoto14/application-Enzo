# Esport : résumés de réunions

Module `meeting_summaries` (phase 3). Un membre dépose l'enregistrement d'une réunion ; un rédacteur en fait un
résumé PDF ; le déposant est prévenu et lit le PDF. Depuis la migration `0014`, l'enregistrement se **dépose
directement** (vidéo ou audio) et une **transcription automatique** horodatée est générée en PDF (voir plus bas).
Depuis la migration `0016`, cette transcription se fait **sur le serveur** (automatique, aucun PC à laisser ouvert),
ou au choix dans le navigateur.

## Qui fait quoi

| Rôle (système) | Déposer | Lire les résumés « team » | Lire les résumés « staff » | Boîte de réception, statuts, PDF |
| --- | --- | --- | --- | --- |
| Propriétaire, Fondateur (partout) | oui | oui | oui | oui |
| Manager | oui | oui | oui | oui (`write_summary`) |
| Coach, Analyste | oui | oui | oui (`view_staff`) | non |
| Joueur | oui | oui | non | non |
| Remplaçant / Invité | non | non | non | non |

Permissions : `meeting_summaries.submit`, `view_summary`, `view_staff` (nouvelle), `view_all` (boîte de réception
en lecture seule), `write_summary` (rédacteur). Le déposant voit toujours ses propres dépôts et leur PDF. Un dépôt
qu'on n'a pas le droit de voir répond 404, comme une team étrangère. Les rôles système des teams existantes
reçoivent les nouvelles permissions par la migration `0003` (Manager : `write_summary` et `view_staff` ; Coach et
Analyste : `view_staff`).

## Côté membre

Esport › team › **Résumés** :

- **Déposer** : l'enregistrement, type de réunion, date (JJ/MM/AAAA), titre, note facultative. Chaque dépôt prévient
  les rédacteurs de la team et le Fondateur (notification in-app).
  - **Déposer le fichier** (par défaut sur le site et le PC) : la vidéo ou l'audio de la réunion (MP4, MOV, WebM, MKV,
    M4A, MP3, WAV, OGG, FLAC), envoyé par morceaux avec reprise après coupure, comme les vidéos de review (voir
    [videos.md](videos.md)). Un **lien externe** peut être ajouté en plus (facultatif).
  - **Lien externe** : comme avant (http/https), sans fichier.
  - Case **« Transcrire automatiquement »** et **où transcrire** : « Serveur (automatique) » (par défaut quand le
    serveur l'a installé : cochée partout, iPhone compris), « Navigateur (ce PC) » (cochée sur PC, décochée sur un
    appareil peu puissant) ou « API externe » (si elle est activée). Le choix proposé d'abord est celui de la team
    (Paramètres › **Transcription des réunions**).
- **Mes dépôts** : statut (À résumer, En cours, Terminé) ; « Ouvrir le PDF » / « Télécharger » quand c'est prêt.
  Un dépôt pas encore pris en charge peut être retiré.
- **Résumés** : les résumés terminés que l'on peut lire.

L'accueil de la team montre les derniers résumés.

## Côté rédacteur

- Accueil Esport : bloc **Résumés à rédiger** (nombre en attente, badge « Nouveau ») › **Boîte de réception** : toutes
  les teams où l'on rédige. Dans une team : onglet **Boîte de réception** (cette team seulement).
- Filtres : statut, team, type, dates (du / au), déposant, « Nouveaux seulement » ; tris : plus récents, plus
  anciens, par statut, date de réunion.
- Ouvrir un dépôt le marque **Vu** (le badge « Nouveau » disparaît).
- Statuts **À résumer → En cours → Terminé** à la main ; « Terminé » demande un PDF. **Déposer le PDF** (site et PC)
  passe le dépôt en Terminé tout seul et prévient le déposant. **Remplacer le PDF** garde l'ancien dans
  l'historique (versions consultables par les rédacteurs). Sur iPhone et iPad (app native), le dépôt de PDF se fait
  depuis le PC ou le site.
- **Types de réunion** : les types globaux (Hebdo, Mensuel, Débrief de match, Staff, Autre, gérés par le Fondateur)
  et ceux de la team. Visibilité par type : « Team » ou « Staff ». Changer la visibilité d'un type s'applique aussi
  aux résumés déjà publiés.

## Transcription automatique

Trois façons de transcrire, choisies au dépôt (ou par défaut pour la team dans Paramètres › **Transcription des
réunions**, permission « Modifier la team ») :

| Mode | Où ça calcule | Quand l'utiliser |
| --- | --- | --- |
| **Serveur (automatique)**, par défaut | Le serveur Esport (o2switch), en arrière-plan | Toujours, s'il est installé : rien à laisser ouvert, marche depuis un iPhone |
| **Navigateur (ce PC)** | L'ordinateur de celui qui dépose | Serveur pas installé, en échec, ou pour aller plus vite avec une bonne carte graphique |
| **API externe** (désactivée sans clé) | Un service payant (OpenAI) | Cas particuliers ; l'audio part chez le fournisseur |

Si le serveur n'est pas installé ou échoue, l'app le dit et propose le navigateur.

### Sur le serveur (migration 0016)

1. **File d'attente** : au dépôt (mode serveur), un travail « à transcrire » est mis en file **en base**
   (`travaux_transcription`). L'app affiche « En file d'attente sur le serveur ».
2. **Traitement en arrière-plan** : la tâche cron du serveur (toutes les 5 minutes) lance **un seul** processus de
   transcription à la fois, détaché, en priorité basse (`nice 19`), avec 1 fil de calcul par défaut. Il décode l'audio
   une fois (ffmpeg), puis le transcrit par **morceaux de 30 s au plus**, coupés dans un silence.
3. **Moteur** : **whisper.cpp** avec **Whisper large-v3-turbo** (qualité « Équilibrée » ; « Rapide » et
   « Maximale » au choix), le **vocabulaire de la team** en prompt, la détection de la parole, puis une **relecture
   par l'IA locale** (version brute gardée). Repli : l'ancien moteur ONNX. Détails et diagnostic :
   [transcription.md](transcription.md) ; installation : [o2switch.md](../o2switch.md), partie H.
4. **Progression visible** dans l'app (rafraîchie toutes les 15 s) : pourcentage et **temps restant estimé**
   (d'après la vitesse mesurée). On peut **fermer l'app** ; « Annuler (transcrire autrement) » retire le travail.
5. **Reprise** : chaque morceau est enregistré en base. Si le processus est arrêté (limite de l'hébergeur,
   redémarrage), son bail expire (10 minutes) et le passage suivant du cron **reprend au dernier morceau fait**.
6. **Réessais** : une erreur donne un nouvel essai 5 minutes, puis 15 minutes plus tard ; après 3 échecs (ou 24 h),
   la transcription passe en **« Échec »** : le déposant est prévenu et l'app propose **« Transcrire »** dans le
   navigateur d'un PC, ou **« Réessayer sur le serveur »**.
7. **Fin** : segments horodatés enregistrés, **PDF généré par le serveur**, statut « Transcription prête »,
   notification au **déposant** et aux **rédacteurs** (« La transcription de … est prête »).
8. **Visibilité** : exactement celle du dépôt (une réunion d'un type **staff** reste invisible, 404, pour qui ne voit
   pas le staff ; la notification ne part qu'au déposant et aux rédacteurs).

Durée (qualité Équilibrée, 8 fils) : **20 à 40 minutes pour 1 h de réunion**, plus la relecture par l'IA locale ;
l'app affiche l'estimation pour chaque qualité. Tableau complet : [o2switch.md](../o2switch.md), partie H.

### Dans le navigateur

La transcription se fait **dans le navigateur** (site ou app PC) de celui qui la lance, avec **Whisper** (modèle de
reconnaissance vocale multilingue d'OpenAI) via **transformers.js** :

1. **Audio** : le navigateur décode la piste son de l'enregistrement (Web Audio API), la passe en **mono 16 kHz** et la
   découpe en **segments de 30 s**. Les gros fichiers (plus de 700 Mo) sont lus en accéléré (×4) au lieu d'être
   décodés d'un coup : la mémoire reste faible.
2. **Whisper** : modèle « base » multilingue, **français** par défaut (anglais au choix). Calcul sur la carte
   graphique (**WebGPU**) quand le navigateur le permet, sinon sur le processeur (WebAssembly).
3. **Téléchargé une seule fois** : la bibliothèque (version figée, empreinte SHA-256 vérifiée) et le modèle (environ
   80 Mo) sont gardés dans le cache du navigateur (Cache API). Rien de tout cela n'est chargé tant qu'on ne transcrit
   pas : l'app reste aussi légère qu'avant.
4. **Progression** affichée ; **Pause**, **Reprendre**, **Arrêter** à tout moment. On peut **changer d'écran** dans
   l'app : la transcription continue en arrière-plan (bandeau en haut de l'Esport). Garder l'onglet ouvert.
5. **Reprise** : le travail est enregistré sur le serveur toutes les 2 min 30 de réunion. Si l'onglet se ferme,
   **Reprendre la transcription** repart du segment entamé.
6. À la fin, la transcription est enregistrée et le **serveur génère le PDF** (aucune bibliothèque de plus dans
   l'app) ; le **déposant et les rédacteurs** sont prévenus (« La transcription de … est prête »).

L'audio **ne quitte pas l'appareil** pour la transcription (il est déjà sur le serveur Esport comme enregistrement).

### Qui transcrit

- Le **déposant**, au moment du dépôt (case cochée) : avec le fichier encore ouvert, rien n'est retéléchargé.
- Un **rédacteur** (ou le déposant) plus tard : **Mes dépôts** ou **Boîte de réception** › le dépôt › **Transcrire**
  (l'enregistrement est relu sur le serveur par un lien signé). **Retranscrire** recommence de zéro.
- Sur **iPhone** : dans le navigateur, trop lent en général ; choisissez « Serveur (automatique) » (rien ne tourne sur
  l'iPhone). Sur l'app iPhone native, pas de transcription dans l'appareil (le PDF se lit normalement).
- **Sur le serveur** : le déposant ou un rédacteur, au dépôt ou plus tard (« Transcrire sur le serveur »,
  « Retranscrire sur le serveur »).

### Temps de transcription (ordre de grandeur)

| Appareil | 1 h de réunion |
| --- | --- |
| **Serveur o2switch** (whisper.cpp large-v3-turbo, en arrière-plan) | 20 à 40 minutes, sans rien laisser ouvert |
| PC récent avec WebGPU (Chrome, Edge) | 5 à 15 minutes |
| PC sans WebGPU (processeur, WebAssembly) | 30 à 90 minutes |
| Gros fichier (plus de 700 Mo) | + 15 minutes de lecture accélérée |
| iPhone, petit portable | déconseillé |

Le premier usage ajoute le téléchargement du modèle (environ 80 Mo, une seule fois).

### Corriger, puis le PDF

- **Voir et corriger la transcription** : chaque segment horodaté est modifiable (fautes, noms de joueurs, termes du
  jeu). **Enregistrer et régénérer le PDF** : le serveur refait le PDF (l'ancien est effacé ; le texte est la
  référence).
- Le **PDF de transcription** : titre, team, type de réunion, date, durée, langue, moteur, date de génération, un
  **pré-résumé automatique** (les 5 phrases les plus représentatives, choisies par fréquence des mots, sans IA
  externe : à vérifier), puis la transcription horodatée (`00:01:23`), en-tête et numéro de page sur chaque page.
- Il est **distinct du résumé rédigé** : le statut du dépôt (À résumer → En cours → Terminé) et le PDF du résumé
  restent gérés comme avant par le rédacteur.
- **Visibilité** : mêmes règles que le dépôt. Une réunion d'un type **staff** : transcription, PDF et enregistrement
  invisibles pour ceux qui ne voient pas le staff (404). Le déposant et les rédacteurs corrigent ; les autres lecteurs
  lisent seulement.

### API de transcription externe (désactivée)

Pour confier la transcription à un service externe, un point d'extension existe, **désactivé par défaut** (la
transcription sur le serveur le rend rarement utile). Il envoie l'enregistrement tel quel à une API compatible OpenAI Whisper ; le cron fait le
travail (quelques réunions par passage). À ajouter dans `~/.appdashboard/esport.env`, puis redémarrer l'app Esport :

```ini
# Transcription par une API externe (facultatif ; payant chez OpenAI, environ 0,006 $ la minute)
TRANSCRIPTION_API=openai
TRANSCRIPTION_API_CLE=sk-...
# Facultatifs :
TRANSCRIPTION_API_URL=https://api.openai.com/v1/audio/transcriptions
TRANSCRIPTION_API_MODELE=whisper-1
TRANSCRIPTION_API_MAX=25M
```

Limites : l'API d'OpenAI refuse les fichiers de plus de **25 Mo** (le serveur ne convertit rien : déposer un audio
M4A ou MP3 plutôt que la vidéo), et l'audio part chez le fournisseur (à signaler aux membres). Une fois activé, un
bouton **« Transcrire par l'API externe »** apparaît sur les dépôts, et le mode « API externe » au dépôt ; le
résultat (PDF, notification) est le même que dans le navigateur.

## Fichiers

- Stockage par l'interface `stockage` (`esport/adaptateurs/stockage.mjs`) : dossier privé sur le disque du serveur
  (`FICHIERS_DIR`, o2switch), dossier sur le disque en local (`<base>.fichiers/`), mémoire dans les tests.
- Contrôles, dans l'ordre : session → appartenance → module → `write_summary` → stockage présent → type annoncé
  `application/pdf` → taille (20 Mo, annoncée puis réelle) → octets magiques `%PDF-` au tout début. Un faux PDF
  n'écrit rien.
- Nom de stockage aléatoire (`teams/<team>/resumes/<uuid>.pdf`) ; le nom d'origine n'est gardé qu'en base.
- Lecture : `POST /teams/:t/resumes/:id/lien` vérifie les droits et rend un **lien signé** (HMAC avec `CLE_ESPORT`)
  valable **5 minutes**, lié au compte et au fichier : `GET /fichiers/:id?c=&exp=&sig=` (en-têtes `no-store`,
  `nosniff`). Lien falsifié : 403 ; expiré : 410.
- Sans stockage branché (`FICHIERS_DIR` absent), le dépôt de PDF répond 503 « stockage-absent » ; le reste marche.

## API

| Route | Rôle |
| --- | --- |
| `GET /resumes/boite?statut=&team=&type=&du=&au=&deposePar=&nouveaux=1&tri=` | Boîte de réception (toutes teams accessibles) |
| `GET/POST /teams/:t/resumes` | Résumés terminés lisibles / déposer |
| `GET /teams/:t/resumes/miens` | Historique de mes dépôts |
| `GET/POST /teams/:t/resumes/types`, `PATCH/DELETE …/types/:id` | Types de réunion |
| `GET/PATCH/DELETE /teams/:t/resumes/:id` | Détail (historique des PDF) / statut / retrait |
| `POST /teams/:t/resumes/:id/vu` | Marquer « Vu » |
| `PUT /teams/:t/resumes/:id/pdf` | Déposer ou remplacer le PDF (corps binaire, en-tête `X-Nom-Fichier`) |
| `POST /teams/:t/resumes/:id/lien` | Lien signé temporaire (`fichierId` : ancienne version, rédacteurs) |
| `POST /teams/:t/resumes/envois` (+ `…/:e`, `…/:e/morceaux/:i`, `…/:e/fin`) | Enregistrement envoyé par morceaux (voir [videos.md](videos.md)) |
| `POST /teams/:t/resumes` `{ envoi, lien?, … }` | Dépôt avec l'enregistrement (le lien devient facultatif) |
| `POST /teams/:t/resumes/:id/enregistrement/lien` | Lien signé (2 h) de l'enregistrement (lecture par plages) |
| `GET /teams/:t/resumes/:id/transcription` | Transcription horodatée, pré-résumé, PDF (même visibilité que le dépôt) |
| `PUT /teams/:t/resumes/:id/transcription` `{ segments, langue, moteur, duree?, partielle?, progression? }` | Enregistrer (partielle : reprise ; complète : PDF généré, notification) ; déposant ou rédacteur |
| `POST /teams/:t/resumes/:id/transcription/lien` `{ telecharger? }` | Lien signé (5 min) du PDF de transcription |
| `POST /teams/:t/resumes/:id/transcription/externe` `{ langue }` | API externe (503 si désactivée) |
| `POST /teams/:t/resumes/:id/transcription/serveur` `{ langue }` | Mettre en file du serveur (503 « transcription-serveur-absente » s'il n'est pas installé) ; `DELETE` : annuler |
| `GET/PATCH /teams/:t/resumes/reglages-transcription` `{ mode }` | Mode de la team (`serveur`, `navigateur`, `externe`, `null` = celui du serveur) ; PATCH : `team.manage` |
| `POST /teams/:t/resumes` `{ envoi, transcription: 'serveur' \| 'navigateur' \| 'externe', langue }` | Dépôt avec le mode de transcription |

Événements (bus outbox → journal + notifications ; Discord en phase 4) : `meeting.submitted`,
`meeting.status_changed`, `meeting.summary_published`, `meeting.deleted`, `meeting_type.created|updated|deleted`.

Tables (migration `esport/migrations/0003_resumes_objectifs.sql`) : `types_reunion`, `reunions`, `fichiers` ; migration
`0014_videos_transcriptions.sql` : `envois`, `transcriptions`, colonnes `reunions.enregistrement_id`,
`transcription_statut`, `transcription_pdf_id`.

Événements : `meeting.transcription_ready` (notification « transcription-prete » au déposant et aux rédacteurs ;
sans acteur quand c'est le serveur), `meeting.transcription_updated` (journal seulement),
`meeting.transcription_failed` (échec sur le serveur : notification « transcription-echec » au déposant),
`media.deleted` (journal). Rien ne part sur Discord.

Migration `0016_transcription_serveur.sql` : table `travaux_transcription` (file : statut, bail `verrou_jusqua`,
essais, progression, vitesse mesurée), nouveau statut de réunion `serveur` ; le mode de la team est dans
`team_modules.config` du module (`transcriptionMode`).

Code et tests : `esport/noyau/resumes.mjs`, `esport/noyau/medias/` (`transcription.mjs` segments, pré-résumé, API
externe ; `pdf.mjs` PDF écrit sans dépendance), `src/esport/transcription/` (`audio.ts` découpe, `travail.ts` travail
avec pause et reprise, `extraction.web.ts` Web Audio, `whisper.web.ts` transformers.js, `lancer.ts` chargé à la
demande), `src/esport/ui/medias/Transcription.tsx` ; tests `esport/test/medias.test.mjs`,
`src/esport/transcription/transcription.test.ts` (transcripteur simulé, PDF), e2e `scripts/e2e-esport-videos.mjs`.

Transcription sur le serveur : `esport/noyau/medias/fileTranscription.mjs` (file, bail, réessais, estimation),
`esport/noyau/resumes.mjs` (dépôt, mode de la team, fin et échec), `esport/serveur/transcription/` (`whisper.mjs`
log-mel et décodage Whisper sur ONNX Runtime, `audio.mjs` ffmpeg / WAV et découpe, `travailleur.mjs` processus de
fond, `lanceur.mjs` appelé par le cron, `moteur.mjs` installation, `installer.mjs` +
`esport/serveur/installer-transcription.sh`), `src/esport/ui/medias/TranscriptionServeur.tsx` ; tests
`esport/test/transcription-serveur.test.mjs` (SQLite et PostgreSQL ; intégration avec le vrai modèle s'il est
installé), `src/esport/TranscriptionServeur.test.tsx`, e2e `scripts/e2e-esport-transcription-serveur.mjs`.
