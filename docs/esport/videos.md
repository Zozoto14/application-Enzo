# Esport : vidéos déposées sur le site

Depuis la migration `0014`, une **review vidéo** peut se faire sur une vidéo **déposée directement sur le site**
(en plus de YouTube, qui reste possible), et une **réunion** peut être déposée avec son **enregistrement** (vidéo ou
audio), transcrit automatiquement en PDF (voir [resumes.md](resumes.md)).

Rien à faire côté serveur : la tâche cron d'o2switch met le code à jour et applique la migration toute seule.

## Déposer une vidéo (review)

Esport › une team › **Jeu** › **Review vidéo** › **Nouvelle review** :

1. **Source de la vidéo** : « YouTube » (adresse, comme avant) ou **« Fichier vidéo »**.
2. **Choisir une vidéo** sur l'ordinateur, donner un titre, puis **Envoyer la vidéo et créer la review**.
3. Une barre montre l'envoi (pourcentage, Mo envoyés, vitesse). **Annuler l'envoi** l'arrête et l'efface.
4. À la fin, la review s'ouvre sur le **lecteur maison**.

Qui peut déposer : ceux qui créent des reviews (`video_review.create` : Propriétaire, Coach, Analyste). Le dépôt se
fait depuis le **site** ou l'**app PC** (sur l'app iPhone native, pas de sélecteur de fichiers).

### Coupure pendant l'envoi

La vidéo part en **morceaux** de quelques Mo. Si la connexion coupe, chaque morceau est **réessayé tout seul**
(attente de 1 s, 2 s, 4 s…). Si l'onglet est fermé ou l'ordinateur éteint : rouvrez le formulaire et **choisissez le
même fichier** ; l'envoi **reprend** où il s'était arrêté (rien n'est renvoyé deux fois). Un envoi abandonné est
effacé automatiquement au bout de **24 heures**.

### Contrôles (sécurité)

- Chaque morceau : taille exacte et **SHA-256** vérifiés ; le fichier entier aussi, à la fin (un fichier abîmé est
  refusé et effacé).
- Le **type** est vérifié par les **octets du fichier** (jamais par le nom) : MP4, MOV, WebM, MKV. Un PDF renommé en
  `.mp4` est refusé dès le premier morceau.
- Stockage **privé**, sous un nom aléatoire (`teams/<team>/videos/<identifiant>.media`), dans
  `/home/jayo8828/esport-fichiers` (jamais dans `public_html`).
- Lecture par **lien signé** valable **2 heures**, lié au compte ; les droits sont revérifiés à chaque lecture (un
  membre retiré ne lit plus rien). Lien modifié : refusé (403) ; expiré : 410 (le lecteur en redemande un tout seul).
- Aucune conversion sur le serveur (pas de ffmpeg sur l'hébergement mutualisé) : le fichier est gardé tel quel.

## Formats conseillés

| Format | Site et PC (Chrome, Edge, Firefox) | iPhone, iPad (Safari) | Conseil |
| --- | --- | --- | --- |
| **MP4 en H.264** (+ AAC) | oui | oui | **À privilégier** : lisible partout |
| MP4 en HEVC (H.265) | souvent non (Chrome sans matériel adapté) | oui | Convertir en H.264 |
| MOV (iPhone) | selon le codec (H.264 oui) | oui | Préférer l'export « Plus compatible » de l'iPhone (H.264) |
| WebM (VP9) | oui | partiel | Convertir en MP4 H.264 pour l'iPhone |
| MKV | Chrome souvent, Safari non | **non** | Convertir en MP4 (sans réencoder : changer le conteneur) |

Quand le serveur reconnaît un format **peu compatible avec l'iPhone** (MKV, ou un codec vidéo autre que H.264,
détecté dans l'en-tête du fichier), l'app l'affiche : « Format peu compatible avec iPhone ». La vidéo est quand même
gardée.

Pour obtenir un MP4 H.264 : OBS (« Format d'enregistrement : mp4 », encodeur x264 ou NVENC H.264), ou HandBrake
(préréglage « Fast 1080p30 »). Sur iPhone : Réglages › Appareil photo › Formats › **Le plus compatible**.

## Le lecteur maison

Même écran que pour YouTube : même **timeline**, mêmes **repères** (touche **M**), réactions 👍 / 👎, commentaires et
**dessin sur la vidéo** (le calque est posé exactement sur l'image, même en plein écran). En plus :

- **image par image** : touches **,** (image précédente) et **.** (image suivante), ou les boutons ⏮︎ ⏭︎ ;
  la cadence d'images est mesurée pendant la lecture (30 images/s par défaut) ;
- **vitesses** : 0,5× à 2× ;
- **plein écran** (bouton ⛶) : la vidéo et le calque de dessin passent en plein écran ensemble ;
- barre de position et temps écoulé.

Le navigateur ne télécharge que ce qu'il lit (requêtes « Range », réponses 206) : on peut sauter à la fin d'une vidéo
de 5 Go sans attendre.

Sur l'app iPhone native : la liste des repères reste lisible, et **Ouvrir la vidéo** la lance dans le lecteur de
l'appareil.

## Limites

| Limite | Valeur | Où la changer |
| --- | --- | --- |
| Taille maximale d'un fichier | **10 Go** par défaut | `ESPORT_VIDEO_MAX` dans `~/.appdashboard/esport.env` (ex. `ESPORT_VIDEO_MAX=20G`) |
| Taille d'un morceau | **8 Mo** par défaut (1 à 64 Mo) | `ESPORT_TAILLE_MORCEAU` (ex. `ESPORT_TAILLE_MORCEAU=4M`) |
| Envois en cours par personne | 5 | — |
| Envoi abandonné effacé après | 24 h | — |
| Lien de lecture | 2 h (renouvelé tout seul) | — |

Après un changement dans `esport.env` : cPanel › **Setup Node.js App** › l'app Esport › **Restart** (ou
`touch ~/application-enzo/esport/tmp/restart.txt`).

### Grosses requêtes chez o2switch (Passenger, LiteSpeed, Apache)

Chaque requête porte **un seul morceau** (8 Mo par défaut), jamais la vidéo entière : on reste loin des limites
de corps de requête des serveurs web.

- **Serveur Esport** (Node) : accepte un corps de 25 Mo, ou la taille d'un morceau + 1 Mo si elle est plus grande ;
  au-delà : 413. Les vidéos sont **lues en flux** (jamais entièrement en mémoire).
- **Passenger** : ne limite pas la taille du corps (il le met en tampon avant de le passer à Node).
- **Apache** (`LimitRequestBody`, 1 Go par défaut depuis Apache 2.4.53) et **LiteSpeed** (« Max Request Body Size »,
  2 Go par défaut) : largement au-dessus de 8 Mo.
- **Pare-feu applicatif** (ModSecurity, s'il est actif sur le domaine) : c'est la seule brique qui peut refuser un
  corps de quelques Mo. o2switch ne publie pas de limite précise pour les apps Node. Si un envoi échoue toujours au
  premier morceau avec une erreur 413 ou « Requête refusée » venue de l'hébergeur : réduisez les morceaux
  (`ESPORT_TAILLE_MORCEAU=2M`), redémarrez l'app, puis réessayez ; si ça ne suffit pas, cPanel › **ModSecurity** ›
  désactivez-le pour `esport.appdashboard.fr` seulement (ou demandez au support o2switch la limite de corps de
  requête de ce sous-domaine).
- Les limites de PHP (`upload_max_filesize`, `post_max_size`) ne concernent pas l'app Node.

## Espace utilisé

Esport › une team › **Réglages** › **Paramètres** › **Espace utilisé** (Propriétaire, ou tout rôle qui a « Modifier
la team ») :

- le **total** de la team et sa répartition : vidéos, enregistrements de réunions, transcriptions (PDF), résumés (PDF),
  miniatures de strats, envois en cours ;
- la **liste** des fichiers : nom, review ou réunion concernée, taille, date, déposé par ;
- **Supprimer** : une vidéo (permission « Supprimer » de la Review vidéo), un enregistrement, un PDF de transcription ou
  une **ancienne** version de résumé (permission « Rédiger les résumés »). Le résumé PDF actuel ne se supprime pas ici :
  on le remplace. La suppression efface les octets ; la review garde ses repères (« Vidéo supprimée »).
- Supprimer une review efface aussi sa vidéo ; retirer un dépôt de réunion efface son enregistrement.

Stockage chez o2switch : illimité, mais en « usage raisonnable ». Une heure de vidéo 1080p en H.264 pèse environ
1 à 3 Go : pensez à supprimer les vidéos des reviews terminées.

## API (préfixe facultatif `/api/esport`)

| Route | Permission |
| --- | --- |
| `POST /teams/:t/review/envois` `{ nom, taille, type? }` | video_review.create |
| `GET`, `DELETE /teams/:t/review/envois/:e` (état, annulation ; ses propres envois seulement) | video_review.create |
| `PUT /teams/:t/review/envois/:e/morceaux/:i` (binaire, en-tête `X-Sha256`) | video_review.create |
| `POST /teams/:t/review/envois/:e/fin` `{ sha256 }` | video_review.create |
| `POST /teams/:t/review` `{ titre, envoi, reference? }` (au lieu de `url`) | video_review.create |
| `POST /teams/:t/review/:id/video/lien` → `{ url, expire }` | video_review.view |
| `GET /fichiers/:id?c=&exp=&sig=` (en-tête `Range` accepté : 206, 416) | lien signé |
| `GET /teams/:t/espace`, `DELETE /teams/:t/espace/:fichier` | team.manage ; permission du module |

Les mêmes routes d'envoi existent sous `/teams/:t/resumes/envois` pour les enregistrements de réunions
(`meeting_summaries.submit`).

## Code et tests

- Serveur (cœur portable) : `esport/noyau/medias/` (`service.mjs` envois, espace, RGPD ; `formats.mjs` octets magiques
  et atomes MP4 ; `lecture.mjs` plages Range ; `sha256.mjs` SHA-256 incrémental ; `pdf.mjs`, `transcription.mjs`),
  stockage `esport/adaptateurs/stockage.mjs` (disque, R2, mémoire : écriture par morceaux, lecture par plages en flux),
  migration `esport/migrations/0014_videos_transcriptions.sql`.
- App : `src/esport/medias/` (envoi, SHA-256, choix du fichier), `src/esport/ui/review/LecteurFichier.web.tsx`,
  `src/esport/ui/medias/` (barre d'envoi, espace utilisé, transcription).
- Tests : `esport/test/medias.test.mjs` (SQLite et PostgreSQL), `esport/test/pg/serveurs.test.mjs` (morceaux de 8 Mo
  par HTTP, lecture en flux), `src/esport/medias/envoi.test.ts`, e2e `scripts/e2e-esport-videos.mjs`.
