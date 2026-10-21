# Esport : résumés de réunions

Module `meeting_summaries` (phase 3). Un membre dépose l'enregistrement d'une réunion ; un rédacteur en fait un
résumé PDF ; le déposant est prévenu et lit le PDF. Depuis la migration `0014`, l'enregistrement se **dépose
directement** (vidéo ou audio) et une **transcription automatique** horodatée est générée en PDF (voir plus bas).

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
  - Case **« Transcrire automatiquement »** : cochée par défaut sur PC, décochée sur iPhone ou sur un appareil peu
    puissant (l'app propose alors de transcrire plus tard depuis un PC).
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

### Comment ça marche

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
- Sur **iPhone** : trop lent en général ; l'app le dit et propose de lancer la transcription depuis un PC. Sur l'app
  iPhone native, pas de transcription (le PDF se lit normalement).

### Temps de transcription (ordre de grandeur)

| Appareil | 1 h de réunion |
| --- | --- |
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

### Point d'extension serveur : API de transcription externe (désactivé)

Pour transcrire sur le serveur au lieu du navigateur (par exemple pour les iPhone), un point d'extension existe,
**désactivé par défaut**. Il envoie l'enregistrement tel quel à une API compatible OpenAI Whisper ; le cron fait le
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
bouton **« Transcrire sur le serveur »** apparaît sur les dépôts (utile depuis un iPhone) ; le résultat (PDF,
notification) est le même que dans le navigateur.

## Fichiers

- Stockage par l'interface `stockage` (`esport/adaptateurs/stockage.mjs`) : R2 privé `esport-fichiers` sur Cloudflare,
  dossier sur le disque en local (`<base>.fichiers/`), mémoire dans les tests.
- Contrôles, dans l'ordre : session → appartenance → module → `write_summary` → stockage présent → type annoncé
  `application/pdf` → taille (20 Mo, annoncée puis réelle) → octets magiques `%PDF-` au tout début. Un faux PDF
  n'écrit rien.
- Nom de stockage aléatoire (`teams/<team>/resumes/<uuid>.pdf`) ; le nom d'origine n'est gardé qu'en base.
- Lecture : `POST /teams/:t/resumes/:id/lien` vérifie les droits et rend un **lien signé** (HMAC avec `CLE_ESPORT`)
  valable **5 minutes**, lié au compte et au fichier : `GET /fichiers/:id?c=&exp=&sig=` (en-têtes `no-store`,
  `nosniff`). Lien falsifié : 403 ; expiré : 410.
- Sans stockage branché (R2 pas activé), le dépôt de PDF répond 503 « stockage-absent » ; le reste marche.

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

Événements (bus outbox → journal + notifications ; Discord en phase 4) : `meeting.submitted`,
`meeting.status_changed`, `meeting.summary_published`, `meeting.deleted`, `meeting_type.created|updated|deleted`.

Tables (migration `esport/migrations/0003_resumes_objectifs.sql`) : `types_reunion`, `reunions`, `fichiers` ; migration
`0014_videos_transcriptions.sql` : `envois`, `transcriptions`, colonnes `reunions.enregistrement_id`,
`transcription_statut`, `transcription_pdf_id`.

Événements : `meeting.transcription_ready` (notification « transcription-prete » au déposant et aux rédacteurs),
`meeting.transcription_updated` (journal seulement), `media.deleted` (journal). Rien ne part sur Discord.

Code et tests : `esport/noyau/resumes.mjs`, `esport/noyau/medias/` (`transcription.mjs` segments, pré-résumé, API
externe ; `pdf.mjs` PDF écrit sans dépendance), `src/esport/transcription/` (`audio.ts` découpe, `travail.ts` travail
avec pause et reprise, `extraction.web.ts` Web Audio, `whisper.web.ts` transformers.js, `lancer.ts` chargé à la
demande), `src/esport/ui/medias/Transcription.tsx` ; tests `esport/test/medias.test.mjs`,
`src/esport/transcription/transcription.test.ts` (transcripteur simulé, PDF), e2e `scripts/e2e-esport-videos.mjs`.
