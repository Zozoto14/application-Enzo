# Esport : Drive de la section CM

Le **Drive** range les fichiers des CM au même endroit : logos, photos des joueurs, clips, visuels, fichiers des
sponsors, rushs bruts… Il y a un Drive pour le **club** (**Teams › CM du club ›
Drive**, ou le bouton **Drive** de la carte « CM du club » en tête de la page Teams) et un par **team** dont le module
CM est activé (**Team › Équipe › CM › Drive**, et dans **CM du club › Drive** en choisissant la team). Aucune nouvelle
entrée dans la barre du bas sur téléphone.

**« Je ne vois pas le Drive »** : il faut un droit `cm.drive.*` (le Fondateur les a tous, sans affectation) et la
version du site qui le contient : après une mise à jour, le site est construit par GitHub Actions (~5 min) puis copié
par le cron du serveur (≤ 5 min) ; **rechargez la page** ensuite (l'app lit vos droits CM à l'ouverture).

Voir aussi : [cm.md](cm.md) (section CM, rôles), [visuels.md](visuels.md), [sponsors.md](sponsors.md).

Migrations : `esport/migrations/0027_cm_drive.sql`, `0039_cm_drive_nouveautes_visuels_dossiers.sql` (nouveautés
par compte, dossiers des visuels). Code : `esport/noyau/cm/drive/` (serveur), `src/esport/cm/drive.ts`
et `src/esport/ui/cm/drive/` (app), textes `src/esport/i18n/drive.ts`.

## Qui fait quoi

Trois permissions, portées par les **rôles CM** (Esport › Teams › CM du club › Équipe CM ; jamais par un rôle de team) :

| Permission | Ce qu'elle ouvre |
| --- | --- |
| `cm.drive.voir` | parcourir, rechercher, prévisualiser, télécharger (et un dossier en ZIP), favoris, lien interne |
| `cm.drive.envoyer` | déposer des fichiers, créer des dossiers ; renommer, déplacer, étiqueter, remplacer (nouvelle version) et mettre à la corbeille **ses** fichiers et dossiers ; copier |
| `cm.drive.gerer` | tout, sur tout : dossiers **restreints**, corbeille (restaurer, supprimer définitivement, vider), supprimer une ancienne version, réglages du rangement automatique (Drive du club) |

Gérer implique envoyer, qui implique voir. Par défaut (migration 0027) :

- **Responsable CM** (affectation « club ») : les trois, sur le Drive du club et de toutes les teams ;
- **Correspondant CM** (affectation d'une team) : voir et envoyer, dans **sa** team seulement ;
- **joueurs** (et tout membre d'une team qui propose des clips ou dépose des infos, sans droit sur le Drive) : seulement
  le dossier **« Dépôt joueurs »** de leur team, où ils déposent leurs photos et vidéos et ne voient **que leurs propres
  fichiers** ;
- le **Fondateur** : tout.

Un rôle CM sans ces permissions (« Rédacteur »…) ne voit pas le Drive. Le Drive ne contient que ce que les CM y
déposent : **jamais** les strats, le scouting, les notes du staff (les routes de la team restent fermées au CM, comme
avant).

**Dossiers restreints** : un dossier marqué restreint (et tout ce qu'il contient) n'existe que pour ceux qui gèrent le
Drive (404 pour les autres, recherche et ZIP compris) ; un lien obtenu avant la restriction ne lit plus rien.

## Dossiers

- **Dossiers par défaut**, créés à la première ouverture : club — Logos, Photos joueurs, Clips, Visuels, Sponsors,
  Bruts ; team — les mêmes sans Sponsors, plus **Dépôt joueurs**. Leur nom est traduit par l'app tant qu'on ne le
  renomme pas (« Rétablir le nom par défaut ») ; ils restent à la racine et ne se suppriment pas.
- Créer, renommer, déplacer (jamais dans lui-même), mettre à la corbeille un dossier ; 12 niveaux, 5 000 dossiers par
  Drive au plus. **Fil d'Ariane** en haut.
- **Télécharger en ZIP** : le dossier et ses sous-dossiers visibles, en flux (rien n'est écrit sur le disque du
  serveur ; pas de compression : les médias le sont déjà). Limite `ESPORT_DRIVE_ZIP_MAX` (2 Go par défaut) et 2 000
  fichiers ; au-delà, téléchargez les sous-dossiers. 20 ZIP par heure et par compte.

## Déplacer à la souris

Sur le **site** et l'**app PC** :

- **glisser-déposer** un fichier ou un dossier sur un **dossier** (grille ou liste), sur un maillon du **fil
  d'Ariane** (pour remonter, jusqu'à la racine) ou dans l'**arborescence latérale** (écran large : tous les dossiers,
  dépliables, le dossier ouvert en évidence) ;
- **sélection multiple** : Ctrl / Cmd-clic ajoute ou retire un élément, Maj-clic sélectionne une plage, un **cadre**
  tracé dans le vide sélectionne tout ce qu'il touche (Ctrl / Maj : la sélection s'étend) ; glisser un élément
  sélectionné emporte **toute la sélection** (« 3 éléments ») ; clic dans le vide ou Échap : on abandonne ;
- **indication de la cible** : la cible survolée est entourée (couleur d'accent) et le fantôme qui suit le pointeur
  dit « 3 éléments → Logos » ; un dossier restreint est signalé (« gestionnaires seulement ») ;
- **refus clair**, avant même de lâcher (cible en rouge, raison dans le fantôme, rappelée si l'on lâche) : un dossier
  dans lui-même ou un de ses sous-dossiers, un dossier par défaut hors de la racine, l'élément d'un autre sans
  `cm.drive.gerer` (« Vous ne pouvez déplacer que vos propres éléments »), déjà dans ce dossier. Le serveur revérifie
  tout (dossier restreint invisible : 404 ; dépôt des joueurs : jamais) ;
- **Annuler** : après chaque déplacement, un toast « 3 éléments déplacés vers « Logos ». **Annuler** » remet chaque
  élément à **son** emplacement d'origine (le serveur rend l'emplacement d'avant de chaque élément déplacé) ;
- **écran tactile** (site sur tablette ou téléphone) : **appui long** (≈ 0,5 s) puis glisser ; un mouvement avant
  l'appui long fait défiler la page normalement.

Partout (et sur l'app iPhone / Android, sans glisser) : menu **« ⋯ » › Déplacer**, ou **Sélectionner** (appui long sur
une ligne) puis **Déplacer**. Les déplacements passent par `POST /cm/drive/lot { action: 'deplacer' }` (et `PATCH`
d'un fichier ou d'un dossier) : comme toute écriture de l'app, en **POST + `X-Methode`** quand l'hébergement bloque
PATCH (client.ts).

## Nouveautés (pastilles)

Une **pastille avec un compteur** montre, **pour chaque utilisateur**, ce qui a été ajouté depuis sa dernière visite :

- sur la puce **Drive** de la tuile **« CM du club »** (page Teams), sur l'onglet **Drive** de l'espace CM et sur
  l'onglet **Drive** de l'onglet CM d'une team (ce Drive-là) ;
- sur **chaque dossier** qui contient des nouveautés (grille, liste, arborescence) : le compteur d'un dossier
  additionne ses nouveautés et celles de ses sous-dossiers.

Compte comme nouveauté : un **fichier** ou un **dossier** ajouté (envoi, copie, rangement automatique), ou une
**nouvelle version** d'un fichier, **par quelqu'un d'autre** (ses propres ajouts ne comptent jamais), après la
dernière visite de **son dossier** par l'utilisateur. Seul ce que l'utilisateur **peut voir** compte (dossier
restreint, dépôt des joueurs : rien pour qui n'y a pas accès). Ouvrir un dossier le **marque comme vu** (ses
sous-dossiers gardent leurs pastilles jusqu'à leur ouverture) ; **Tout marquer comme vu** (barre du Drive) remet tout
à zéro. Au tout premier passage, rien n'est « nouveau ».

L'état « vu » est gardé **par le serveur**, par compte et par dossier (`cm_drive_vus`) : jamais dans le navigateur ;
il suit le compte d'un appareil à l'autre. Les pastilles se relisent à l'ouverture, toutes les 2 minutes et au retour
sur l'onglet du navigateur.

**Événement de bus `drive.ajout`** (pour le centre de notifications) : une ligne de la table `evenements` à chaque
ajout, dans le même lot que l'écriture. Il ne va **pas** au journal d'activité (les `cm.drive_*` y sont déjà).

| Champ | Valeur |
| --- | --- |
| `type` | `drive.ajout` |
| `team_id` | la team de la portée (NULL pour le Drive du club) |
| `acteur_id` | l'auteur (NULL : rangement automatique sans auteur) |
| `entite_type`, `entite_id` | `cm_drive` (fichier) ou `cm_drive_dossier` (dossier), et son identifiant |
| `charge` | `{ portee, dossierId, element: 'fichier' \| 'dossier', type: 'fichier' \| 'dossier' \| 'version', genre: 'ajout' \| 'copie' \| 'version' \| 'rangement', nom, version, auteur }` |

Le consommateur ne prévient que ceux qui **voient** l'élément : `drive.destinatairesAjout(ev)` (service du Drive)
rend ces comptes, l'auteur exclu ; `drive.elementVisiblePour(compte, element, id)` répond pour un compte.
Le **centre de notifications** ([notifications.md](notifications.md)) le consomme (catégorie Drive, « Clara a ajouté
un fichier / créé un dossier / ajouté une nouvelle version dans le Drive : nom ») : visible de qui voit le Drive de
la portée, et de **ceux qui gèrent le Drive seulement** pour un élément sous un **dossier restreint**
(`notifications/regles.mjs`, `sousDossierRestreint`) ; un dossier restreint après coup (ou un élément rangé dessous)
resserre aussitôt les notifications déjà affichées.

## Fichiers

- **Envoi** : bouton **Envoyer des fichiers** (plusieurs à la fois) ou **glisser-déposer** sur la zone (site et app
  PC ; sur iPhone, l'envoi se fait depuis le site ou le PC). Envoi **par morceaux avec reprise** (le même que les
  vidéos : un envoi coupé reprend où il en était). Taille maximale d'un fichier : `ESPORT_DRIVE_FICHIER_MAX`
  (2 Go par défaut).
- **Types acceptés** (reconnus par leurs **octets**, jamais par le nom) : images (PNG, JPEG, GIF, WebP, SVG, TIFF,
  HEIC, AVIF), vidéos (MP4, MOV, WebM, MKV), audio (MP3, M4A, AAC, WAV, OGG, FLAC), PDF (et `.ai` compatibles PDF),
  polices (TTF, OTF, WOFF, WOFF2), archives (ZIP — dont `.xd`, `.sketch`, `.docx`… —, 7z, RAR, GZIP), PSD, texte
  (TXT, CSV, Markdown, JSON, sous-titres…). **Jamais** de page web ni de programme.
- **Renommer, déplacer, copier** (une copie dans un autre dossier ou le Drive d'une autre team réutilise les mêmes
  octets : aucun espace en plus), **étiquettes** (12 au plus), **favoris** (personnels), **télécharger**.
- **Gérer les étiquettes** (bouton de la barre du Drive, `cm.drive.gerer` seulement) : liste des étiquettes de la
  portée avec le nombre de fichiers. **Renommer** change l'étiquette sur tous les fichiers de la portée, corbeille
  comprise (si le nouveau nom existe déjà, les deux sont fusionnées) ; **Supprimer définitivement** la retire de
  tous les fichiers après une confirmation qui indique leur nombre (les fichiers eux-mêmes ne sont pas touchés ;
  pas de corbeille pour une étiquette). Les étiquettes du Drive sont de simples mots (pas de couleur) et propres à
  chaque Drive (club ou team). Les filtres et la recherche suivent aussitôt ; le journal note
  `cm.drive_tag_renomme` et `cm.drive_tag_supprime`. Un correspondant ou un joueur peut toujours étiqueter ses
  propres fichiers (fiche du fichier), mais pas renommer ni supprimer une étiquette pour tout le monde.
- **Versions** : « Remplacer (nouvelle version) » garde l'ancienne dans l'historique (30 versions au plus par
  fichier, les plus anciennes partent). Chaque version se télécharge ; **Restaurer** une ancienne version en fait la
  nouvelle version actuelle ; un gestionnaire peut supprimer une ancienne version.
- **Aperçus** : vignettes des images (jusqu'à 8 Mo), lecteur vidéo et audio (lecture par plages), PDF dans un nouvel
  onglet, police (texte d'exemple), début d'un fichier texte ; infos : type, taille, dimensions, durée, codecs,
  auteur, dates, emplacement, origine, utilisations (cartes CM, visuels, sponsors).
- **Vue grille ou liste**, **tri** (nom, date, taille, type ; inversable), **sélection** et actions groupées
  (déplacer, copier, corbeille).
- **Recherche** sans accents ni casse, dans tout le Drive ou dans le dossier ouvert, avec **filtres** : type,
  étiquette, auteur, dates, favoris.
- **Lien interne** : « Copier le lien interne » donne `drive:<identifiant>` ; collé dans la recherche du Drive, il
  ouvre l'élément — seulement pour qui y a accès (le lien ne donne aucun droit).

## Corbeille

Mettre à la corbeille un dossier y emmène tout son contenu ; **Restaurer** remet tout à sa place (à la racine si son
dossier n'existe plus). Chacun restaure ce qu'il a jeté ; un gestionnaire restaure tout, supprime définitivement,
vide la corbeille. Au bout de **30 jours**, le cron efface définitivement (lignes et octets).

Les octets ne partent que quand **plus rien** ne s'en sert : un fichier du Drive joint à une carte, à un sponsor ou
utilisé comme image de l'éditeur reste lisible là-bas même après sa suppression du Drive.

## Espace (quota)

- Limite totale du Drive : `ESPORT_DRIVE_QUOTA` (20 Go par défaut), corbeille et anciennes versions comprises. Un
  envoi qui la dépasserait est refusé dès le début (413 `quota-drive`).
- Barre d'espace dans le Drive ; **alerte à 80 %** : une notification aux gestionnaires du Drive (au plus une par
  semaine, par l'envoi et par le cron).
- Pour faire de la place : vider la corbeille, supprimer d'anciennes versions.

## Intégrations

- **Carte CM** : pièces jointes › **Depuis le Drive** (Drive de la portée du tableau ou du club). La personne qui voit
  la carte lit la pièce, même sans droit sur le Drive.
- **Éditeur de visuels** : Ajouter une image › **Depuis le Drive** ; **charte** : Logos › **Depuis le Drive** (Drive du
  club ; PNG, JPEG, GIF, WebP de 15 Mo au plus).
- **Sponsors** : pièces d'un prospect ou partenaire › **Depuis le Drive** (Drive du club ; deck, logo…).
- **Rangement automatique** (réglable : **Drive › Réglages**, gestionnaires du Drive du club) : chaque **visuel généré**
  va dans « Visuels » de sa portée (un nouveau rendu = une nouvelle version du même fichier) ; chaque **clip retenu**
  (fichier déposé) va dans « Clips » de sa team. Mis à la corbeille, il n'y revient pas.

Rien n'est copié : la pièce, l'image ou le sponsor pointe vers les mêmes octets que le Drive.

## Sécurité

- Type vérifié par les octets au premier morceau ; HTML et exécutables refusés ; nom **assaini** (sans chemin,
  caractère de contrôle, marque bidirectionnelle ni nom réservé de Windows) et **extension forcée** selon le type
  reconnu (« script.bat » en texte devient « script.bat.txt ») : un fichier téléchargé n'est jamais lancé comme un
  programme.
- Fichiers servis par **lien signé (2 h)** ; chaque lecture revérifie l'accès (rôle retiré, dossier restreint entre-temps :
  403). En-têtes `X-Content-Type-Options: nosniff`, `Content-Disposition` (affichage ou téléchargement), jamais dans un
  cadre ; **SVG et texte** servis avec une politique `sandbox` sans aucun script (une balise `<img>` n'exécute jamais le
  script d'un SVG).
- Aucune requête PATCH / PUT / DELETE obligatoire : l'app passe en POST + `X-Methode` quand l'hébergement les bloque.

## Données (migration 0027)

| Table | Contenu |
| --- | --- |
| `cm_drive_dossiers` | dossiers (portée, parent, nom ou clé du dossier par défaut, restreint, corbeille) |
| `cm_drive_fichiers` | fichiers (portée, dossier, nom, version actuelle, type, taille, infos, origine, corbeille) |
| `cm_drive_versions` | versions (octets dans `cm_fichiers`) |
| `cm_drive_tags`, `cm_drive_favoris` | étiquettes ; favoris par compte |
| `cm_drive_vus` (migration 0039) | état « vu » par compte, portée et dossier (`racine`, l'identifiant d'un dossier, ou `*` : tout marqué vu) |

`envois` est reconstruite (usage « drive »), comme en 0017 et 0023. Les rôles CM système reçoivent leurs permissions
du Drive. Tout est dans l'**export / import de la base**. **RGPD** : l'export d'un compte liste ses fichiers du Drive
et ses favoris (et ses dossiers vus) ; la suppression du compte efface ses favoris et son état « vu », ses fichiers
restent au club sans auteur.

## API (préfixe facultatif `/api/esport`)

| Route | Droit |
| --- | --- |
| `GET /cm/drive/nouveautes?portee` (sans portée : un total par Drive) ; `POST /cm/drive/vu { portee, dossierId }` ; `POST /cm/drive/tout-vu { portee? }` | voir (ou dépôt) |
| `GET /cm/drive/portees` ; `GET /cm/drive?portee&dossier&vu` (`vu=1` : marqué vu, réponse avec `nouveautes`) ; `GET /cm/drive/arbre?portee` ; `GET /cm/drive/filtres?portee` | voir (ou dépôt) |
| `GET /cm/drive/recherche?portee&q&genre&tag&auteur&du&au&favoris&dossier` ; `GET /cm/drive/elements/:id` | voir |
| `/cm/drive/portees/:p/envois…` ; `POST /cm/drive/fichiers { portee, dossierId, envoi, nom?, tags? }` | envoyer (ou dépôt) |
| `GET\|PATCH\|DELETE /cm/drive/fichiers/:id` ; `POST …/(copier\|lien\|versions)` ; `POST …/versions/:v/restaurer` ; `DELETE …/versions/:v` | voir ; auteur ou gérer ; gérer |
| `POST /cm/drive/dossiers` ; `PATCH\|DELETE /cm/drive/dossiers/:id` ; `POST …/zip` | envoyer ; auteur ou gérer ; voir |
| `GET /cm/drive/corbeille?portee` ; `POST /cm/drive/corbeille/:id/restaurer` ; `DELETE /cm/drive/corbeille/:id` ; `POST /cm/drive/corbeille/vider` | voir ; auteur ou gérer ; gérer |
| `POST /cm/drive/lot { action, elements, dossierId?, portee? }` (déplacer : rend aussi `avant`, l'emplacement d'avant de chaque élément déplacé) ; `POST /cm/drive/favoris` | selon l'action |
| `PATCH /cm/drive/tags { portee, tag, nom }` ; `DELETE /cm/drive/tags?portee&tag` (étiquette de tous les fichiers de la portée) | gérer |
| `GET\|PUT /cm/drive/reglages` | gérer (club) |
| `GET /cm/drive/contenu/<élément>.<version>?c&exp&sig` ; `GET /cm/drive/zip/<dossier>?c&exp&sig` | lien signé (accès revérifié) |
| `POST /cm/cartes/:id/pieces { genre: 'drive', fichierId }` ; `POST /cm/visuels/images { portee, drive }` ; `POST /sponsors/pieces { genre: 'drive', fichierId, … }` | intégrations |

Limites de débit (par compte et par heure) : 600 fichiers rangés ou versions, 20 ZIP.

## Code et tests

- Serveur : `esport/noyau/cm/drive/regles.mjs` (règles pures : noms, extensions, étiquettes, réglages),
  `zip.mjs` (ZIP en flux), `service.mjs`, `routes.mjs` ; `esport/noyau/cm/utilisations.mjs` (octets partagés) ;
  formats étendus dans `esport/noyau/medias/formats.mjs` (`reconnaitreEtendu`).
- App : `src/esport/cm/drive.ts` (dont `refusDeplacement`, `groupesAnnulation`), `src/esport/cm/nouveautesDrive.ts`
  (pastilles), `src/esport/ui/cm/drive/` (Drive, DetailFichier, ChoixDrive, ApercuDrive et ZoneDepot — versions web
  et native ; `glisser.web.ts` / `glisser.ts` : glisser-déposer, cadre, Ctrl / Maj-clic ; `explorateur.tsx` : fil
  d'Ariane, arborescence latérale, choix d'un dossier, aussi utilisés par les dossiers des visuels).
- Tests : `esport/test/drive.test.mjs` (SQLite et PostgreSQL : règles, formats, ZIP, migration, permissions,
  fichiers, versions, corbeille et purge, quota, sécurité, intégrations, RGPD, export / import),
  `esport/test/drive-deplacer-nouveautes.test.mjs` (SQLite et PostgreSQL : déplacements — cycles, permissions,
  groupé, annulation, POST + X-Methode —, nouveautés — par compte, permissions, ses propres ajouts exclus, versions,
  vu, tout vu, `drive.ajout` —, dossiers des visuels, RGPD), `src/esport/Drive.test.tsx`.

## Pour le Fondateur

1. Mettre à jour le serveur Esport (déploiement automatique o2switch, ou `npm run migrer --prefix esport`) : la
   migration `0027_cm_drive.sql` s'applique seule. Publier le site et l'app PC.
2. Facultatif, dans `~/.appdashboard/esport.env` : `ESPORT_DRIVE_QUOTA=20G` (espace total ; gardez de la marge sur
   l'espace disque de l'hébergement), `ESPORT_DRIVE_FICHIER_MAX=2G`, `ESPORT_DRIVE_ZIP_MAX=2G`, puis redémarrer l'app
   Node.
3. Les rôles **Responsable CM** et **Correspondant CM** ont déjà le Drive ; pour un autre rôle CM, cochez les
   permissions Drive dans **Esport › Teams › CM du club › Équipe CM**.
