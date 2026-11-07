# Esport : section CM (community manager)

La section CM prépare la communication du club sur les réseaux (**X, Instagram, TikTok** pour l'instant) :
idées, posts à préparer, à **valider**, puis à **publier à la main** (aucune connexion aux réseaux : les textes
se copient, les médias se téléchargent). Elle a deux niveaux :

- l'**espace CM du club** (carte **CM du club** en tête de la page **Teams** de l'Esport, sur PC comme sur téléphone ;
  ce n'est plus une entrée de la navigation principale), tenu par le CM commun ;
- la **partie CM de chaque team** (module `cm`, onglet **CM** dans la section **Équipe**), où le correspondant de
  la team dépose les informations et où les joueurs proposent leurs clips.

**Navigation de l'espace CM du club** (comme une team) : la barre latérale ne liste que des **groupes** — **Accueil CM**
(vue d'ensemble : posts à valider, prochaines publications, nouveautés du Drive, prochaines réunions ; pour qui a
`cm.voir`), **Contenus** (sous-onglets Tableaux | À valider | Calendrier), **DATA** (Clips | Visuels | Drive | Ressources),
**Diffusion** (Réseaux), **Partenaires** (Sponsors), **Équipe** (Réunions | Équipe CM), **Gestion** (Import Trello |
Réglages | Journal) — et chaque groupe a ses **sous-onglets en haut de la page** (aucune rangée s'il n'a qu'une
sous-section). Les compteurs (posts à valider, nouveautés du Drive) sont sur le sous-onglet et, additionnés, sur
le groupe. Un groupe sans sous-section permise est masqué. Fil d'Ariane « Teams › CM du club › Groupe › Sous-section ».
Sur téléphone : sélecteur de groupe puis sous-onglets sous le titre. Le sélecteur **⇄ Changer de team** d'une team
propose **CM du club** en tête (pastille CM rose) pour qui a accès à l'espace CM ; **⇄ Changer** du CM propose Teams
et toutes les teams.

Visuels (charte, modèles, éditeur, génération d'affiches) : [visuels.md](visuels.md). Comptes des réseaux, annonce
Discord des posts publiés et statistiques (onglet **Réseaux**) : [reseaux-stats.md](reseaux-stats.md). **Drive**
(dossiers et fichiers du club et des teams, versions, corbeille, dépôt des joueurs) : [drive.md](drive.md). **Réunions**
de l'équipe CM (agenda, disponibilités, rendez-vous, notes confidentielles ; permissions `cm.reunions.voir` et
`cm.reunions.gerer`) : [cm-reunions.md](cm-reunions.md).

Migrations : `esport/migrations/0023_cm.sql` (+ `0029_cm_etiquettes.sql`, étiquettes modifiables ; `0042_cm_tableaux_fond.sql`, fond des tableaux et choix d'affichage par compte ; `0044_cm_liens.sql`, liens utiles de DATA › Ressources et leurs liaisons ; `0045_cm_commentaires_non_lus.sql`, commentaires non lus et cartes suivies ; `0046_cm_tableaux_acces.sql`, tableaux restreints ; `0047_cm_urgence.sql`, drapeau d'urgence des cartes ; `0048_cm_liens_acces.sql`, qui voit une ressource de DATA › Ressources). Code : `esport/noyau/cm/`, `src/esport/cm/`, `src/esport/ui/cm/`.

## Qui fait quoi

Six permissions (plus deux pour la rubrique **Sponsors**, `sponsors.voir` et `sponsors.gerer`, et trois pour le
**Drive**, `cm.drive.voir`, `cm.drive.envoyer` et `cm.drive.gerer`, portées aussi par les rôles CM : voir
[sponsors.md](sponsors.md) et [drive.md](drive.md)) :

| Permission | Ce qu'elle ouvre |
| --- | --- |
| `cm.voir` | voir les tableaux, cartes, calendrier, clips de la portée |
| `cm.deposer` | déposer une information (formulaire de la team) ; commenter ; retoucher son dépôt |
| `cm.editer` | préparer : cartes, listes, étiquettes (créer, renommer, recolorer, réordonner), checklists, pièces jointes, posts, soumettre, publier ; trier les clips |
| `cm.valider` | valider ou refuser un post |
| `cm.gerer` | créer, archiver, supprimer un tableau ; fusionner et supprimer définitivement une étiquette ; équipe et rôles CM ; import Trello ; réglages ; journal de la section |
| `cm.clips.proposer` | proposer un clip au CM |

Elles viennent de deux endroits :

1. **Rôles CM** (niveau club, **Esport › Teams › CM du club › Équipe CM**) : « **Responsable CM** » (les six permissions, Sponsors et
   tout le Drive) et « **Correspondant CM** » (voir, déposer, proposer des clips ; voir et alimenter le Drive de sa
   team) sont des rôles système dont les permissions se
   modifient (bouton **Rétablir**) ; depuis la migration 0030, ils portent aussi le **trombinoscope** de la page
   Membres (Responsable : voir et compléter ; Correspondant : voir — [trombinoscope.md](trombinoscope.md)) ; le Fondateur crée d'autres rôles (« Rédacteur », « Vidéaste »…) avec les
   permissions voulues. Une **affectation** donne un rôle à un compte :
   - pour **tout le club** : ses permissions valent pour l'espace du club et pour toutes les teams dont le module
     CM est activé ;
   - pour **une team** : c'est le correspondant de la team ; il doit en être **membre actif** (l'affectation ne vaut
     plus s'il la quitte ou est suspendu).
2. **Rôles de la team** (matrice habituelle, groupe « CM ») : seulement `cm.voir`, `cm.deposer` et
   `cm.clips.proposer`. Par défaut : les joueurs, remplaçants, analystes, coachs et managers **proposent des clips** ;
   le Manager **dépose** des informations (sans `cm.voir` depuis la migration 0053 : il suit ses propres dépôts). Le
   Propriétaire a ces trois permissions. **Éditer, valider et gérer ne viennent jamais d'un rôle de team** : la
   validation reste au Fondateur et au Responsable CM. Une permission CM d'un rôle de team ne vaut **que dans l'onglet
   CM de cette team** (déposer, proposer un clip, et avec `cm.voir` le tableau de la team) : **jamais** dans l'espace
   « CM du club » (voir ci-dessous).

Le **Fondateur** a tout. Anti-escalade : hors Fondateur, on n'ajoute à un rôle CM, et on n'attribue, que des
permissions que l'on a soi-même (403 `escalade`) ; le nom et la couleur d'un rôle système sont fixes.

3. **Rôles du club** (migration 0033, **Esport › Administration › Rôles et permissions**, [roles-permissions.md](roles-permissions.md)) :
   un rôle du club qui porte des permissions CM vaut comme une affectation « club ». Le rôle système « **Second CEO** »
   (adjoint du Fondateur) a par défaut **tout le CM** (`cm.gerer`, tout le Drive, Sponsors compris). Les rôles CM se
   modifient aussi depuis cette page (section CM, même matrice), et les routes `/cm/roles` / `/cm/affectations`
   s'ouvrent à la permission du club `roles.gerer` ; les affectations se font toujours dans **Équipe CM**.

**Périmètre** : le CM du club n'est membre d'aucune team. Il ne voit que la section CM, les membres (pseudos) et
les **résumés publiables** des matchs, tournois et résultats (`competition/resume.mjs`). Jamais les strats, le
scouting détaillé (un adversaire n'apparaît que par son nom), les notes du staff, le planning ni un résultat
« staff seulement » ou un scrim non publiable (les routes de la team lui répondent 404).

Contrôles d'une route CM : session → team existante → module `cm` activé (404) → appartenance ou affectation
(404) → permission (403).

### Qui entre dans l'espace « CM du club »

L'espace (tuile « CM du club », entrée du sélecteur « Changer de team », barre latérale CM ; Accueil CM, Contenus,
À valider, Calendrier, DATA — Clips, Visuels, Drive, Ressources —, Diffusion, Partenaires, Équipe, Gestion) est réservé
à l'**équipe CM** : le Fondateur, les rôles du club qui portent une permission CM (Second CEO…), les affectations à un
rôle CM (Responsable, Correspondant — du club ou d'une team —, rôles CM personnalisés) et les permissions CM accordées
dans **Rôles et permissions**. Côté serveur, `porteesDe` (cm/commun.mjs) rend `teams` (toutes les permissions, pour
l'onglet CM d'une team et l'état léger `/cm/etat`) et `teamsEspace` (sans celles d'un rôle de team) ; toutes les
lectures de l'espace passent par `espaceCm` / `voitEspaceCm` / `exigerEspaceCm` : `GET /cm/moi` (`espace`, `teams`),
`/cm/tableaux`, `/cm/a-valider`, `/cm/calendrier`, `/cm/recherche`, `/cm/urgences`, `/cm/terminees`, `/cm/clips`,
`/cm/calendrier/teams`, la charte, les modèles, les visuels, les dossiers de visuels, les images du club, Réseaux,
les Ressources, l'import Trello (403, ou 404 pour Réseaux). Le Drive, les réunions, l'Équipe CM, les Sponsors et la
Gestion ne s'ouvraient déjà qu'aux rôles CM / du club. Notifications : sans équipe CM, les personnelles CM / Drive du
club (sans team) sont masquées à la lecture, et les ressources hors partage comptent comme interdites dans le fil.
Exceptions gardées : l'**invité d'une réunion** à venir (ses réunions seulement) et la personne avec qui une
**ressource est partagée** (« Partager avec… », `moi.ressources` : DATA › Ressources ne montre que celles-là).
Migration 0053 : `cm.voir` est retiré des rôles « Manager » des teams existantes qui ont encore les trois permissions
CM par défaut (une partie CM personnalisée ne change pas ; le modèle des nouvelles teams réglé par le Fondateur non plus).

## DATA › Ressources : les liens utiles de l'équipe CM

Le groupe **DATA** (ex-« Médias ») garde **Clips | Visuels | Drive** et ajoute **Ressources** : la liste des **liens** utiles du club
(outils, modèles, banques d'images, tableaux de bord). Elle est visible de qui a `cm.voir`. Code : `esport/noyau/cm/liens.mjs`
(migration `0044_cm_liens.sql`, tables `cm_liens` et `cm_lien_liaisons`), `src/esport/cm/liens.ts`, `src/esport/ui/cm/liens/`.

- **Un lien** : titre, adresse, description, **étiquette** libre (filtre), **épinglage**, ordre manuel (monter / descendre
  tant qu'aucun filtre n'est actif ; les épinglés restent en tête), team de rattachement facultative (le lien reste visible
  de tout le CM du club ; un correspondant d'une team ne voit que les liens du club et ceux de sa team ; si la team disparaît,
  le lien redevient un lien du club). Recherche sans accents ni casse (titre, description, étiquette, domaine, team) et filtres
  étiquette / team / épinglés.
- **Adresse** : **https** obligatoire, hôte public (pas de `localhost`, d'adresse IP ni de réseau local), sans identifiant ;
  validée par l'écran puis par le serveur (réutilise `verifierAdresse` du module Ressources des teams,
  `esport/noyau/ressources/apercu.mjs`) et enregistrée normalisée (400 `url`). **Aperçu** : le **domaine** (sans « www. ») et
  une icône locale ; le serveur ne télécharge rien et l'écran ne charge **aucune image externe** (ni favicon distante).
  Ouverture dans un **nouvel onglet** avec `noopener,noreferrer`. 500 liens au plus.
- **Pourquoi pas le module Ressources des teams** : il est lié à une team, à ses rôles (`resources.*`), à sa file de validation
  et à ses catégories ; l'espace CM est un espace du club sans team. Seule la validation d'adresse est partagée.
- **Permissions** (aucune nouvelle) : `cm.voir` consulter ; `cm.editer` (du club) ajouter, modifier, épingler, ordonner, lier
  et délier ; `cm.gerer` (du club) supprimer. Cohérent avec les tableaux (éditer / gérer).
- **Liaisons** (plusieurs-à-plusieurs, `cm_lien_liaisons`) : un lien peut être **lié** à plusieurs **cartes** des tableaux CM et à
  plusieurs **dossiers du Drive**. Depuis la **fiche d'une carte** (bloc « Ressources liées ») et depuis un **dossier du Drive**
  (menu du dossier ou bouton de la barre, pour qui voit la section CM) : liste cliquable, **Lier une ressource** (recherche parmi
  les ressources existantes, ou **Créer une nouvelle ressource** qui la crée et la lie), **Délier**. Depuis une ressource :
  « Voir où il est lié » (cartes et dossiers, avec un raccourci vers le tableau ou le dossier du Drive ; délier). Lier ou délier
  demande `cm.editer` du club **et** le droit d'écrire sur la cible (`cm.editer` de la portée du tableau ; **envoyer** ou **gérer**
  dans le Drive). **Visibilité** : on ne voit, ne compte et ne peut atteindre que les cartes et dossiers accessibles ; un lien vers
  un **dossier restreint** n'est donc visible que de ceux qui y ont accès (404 sinon) ; la liaison d'un dossier à la corbeille ou d'une
  carte supprimée n'apparaît plus. **Suppressions** : supprimer une ressource la délie partout ; supprimer une carte ou un tableau,
  ou purger un dossier du Drive (corbeille vidée), retire ses liaisons.
- **API** : `GET|POST /cm/liens`, `PUT /cm/liens/ordre`, `PATCH|DELETE /cm/liens/:id`, `GET|POST /cm/liens/:id/liaisons`,
  `DELETE /cm/liens/:id/liaisons/:genre/:cibleId`, `GET /cm/liens/cible/:genre/:id`.
- **Bus, notifications, temps réel** : événements `cm.lien_cree`, `cm.lien_modifie`, `cm.lien_supprime`, `cm.lien_lie`,
  `cm.lien_delie` (journal de la section ; fil d'activité de la catégorie CM, lien vers DATA › Ressources ; sujet temps réel
  `cm` : les listes ouvertes se relisent). Pas de notification personnelle, sauf un partage (ci-dessous).
- **Lien profond** : onglet `ressources` (groupe `data`), ex. `{ vue: 'cm', onglet: 'ressources' }`.
- **RGPD** : l'export du compte contient `cmLiens` (ses liens) ; à la suppression du compte, ses liens et liaisons restent au
  club, sans auteur. Export / import de la base : tables `cm_liens` et `cm_lien_liaisons`.

### Qui voit la ressource (ressources restreintes, migration 0048)

Exemple du Fondateur : « quand je donne les tâches à Lyna, je veux qu'elle les voie ». Chaque ressource est visible de
**« Toute l'équipe CM »** (défaut, valeur de toutes les ressources existantes : les règles ci-dessus) ou **« Restreint »** :
seulement les **personnes** et les **rôles** choisis (rôles CM, du club, de team), chacun **« Peut voir »** (lecture seule :
ouvrir, voir où elle est liée) ou **« Peut modifier »** (ses permissions CM habituelles : `cm.editer`, `cm.gerer`). Mêmes
modèle et composants que l'[accès aux tableaux](#accès-au-tableau-tableaux-restreints) (`esport/noyau/cm/acces.mjs`,
`src/esport/ui/cm/ChoixAcces.tsx`) ; code propre : `esport/noyau/cm/liensAcces.mjs`, `src/esport/ui/cm/liens/AccesRessource.tsx`.

- **Toujours** : son **créateur** et le **Fondateur** la voient (et la modifient, selon leurs permissions). La restriction ne
  donne jamais rien : elle s'ajoute à la lecture habituelle (`cm.voir`, team de rattachement). Un rôle compte pour qui l'a
  **aujourd'hui** (relu à chaque requête).
- **Réglage** : à la **création** (formulaire « Qui voit la ressource ») et dans le menu **⋯** de la ressource, « Qui voit la
  ressource… » (avec « Qui voit cette ressource aujourd'hui »), réservé au **créateur**, à **`cm.gerer`** (au niveau « peut
  modifier ») et au **Fondateur**. Garde-fou : hors créateur et Fondateur, on ne se retire pas soi-même « peut modifier »
  (409 `acces-soi-meme`). Sur la ligne : **cadenas** « Restreint » et **avatars** (initiales) des personnes autorisées (six au plus, puis « +N » ;
  le Fondateur, toujours autorisé, n'y figure pas).
- **« Partager avec… »** (menu ⋯) : une ou plusieurs personnes en un clic (celles qui lisent les Ressources de la portée).
  Ressource restreinte : elles reçoivent l'accès (« peut voir » par défaut, jamais rétrogradées ; réservé à qui règle
  l'accès) ; ressource ouverte : un éditeur peut aussi la signaler. Elles reçoivent une **notification personnelle**
  (centre de notifications, catégorie CM, « X a partagé une ressource avec vous : « titre » », lien vers DATA › Ressources),
  et la ressource s'affiche chez elles avec une pastille **« Nouveau »** jusqu'à son **ouverture** (bouton Ouvrir ou « Voir
  où il est lié » : `POST /cm/liens/:id/vu`, état en base `cm_lien_partages.vu_le`, la notification passe en lue). Les
  personnes ajoutées **nommément** dans le réglage (ou à la création) sont prévenues de la même façon ; un rôle, non.
  Compteur sur le sous-onglet **Ressources** (`GET /cm/etat` → `ressources`).
- **Filtre « Partagé avec moi »** (ressources partagées avec le compte).
- **Contrôle serveur partout** (404 pour qui n'en est pas, comme si elle n'existait pas) : liste (étiquettes comprises),
  « Voir où il est lié », ressources d'une **carte** et d'un **dossier du Drive** (une ressource restreinte liée n'y apparaît
  que pour qui voit la ressource **et** la carte ou le dossier), modifier, épingler, ordonner, lier, délier, supprimer,
  réglage, partage, compteur de l'état, **journal** (section et team), **centre de notifications** (fil et
  personnelles, relues à chaque lecture : `notifications.cm_lien_id`, `liensInterdits` de `notifications/droits.mjs`),
  annonces en direct, **temps réel** (le sujet `cm` ne transporte aucune donnée : la liste se relit avec les contrôles).
  **Retrait immédiat** : la ressource, ses liaisons et ses anciennes notifications disparaissent à la requête suivante.
  **Suppression** d'une ressource restreinte : son fil et ses notifications sont effacés, ses entrées du journal perdent
  leurs détails (titre, domaine).
- **API** : `GET /cm/liens/acces?team` (personnes et rôles proposables à la création, `cm.editer`) ;
  `GET|PUT /cm/liens/:id/acces { acces: 'tous' | 'restreint', regles: [{ genre, cible, niveau }] }` ;
  `POST /cm/liens/:id/partage { comptes, niveau? }` ; `POST /cm/liens/:id/vu`. `POST /cm/liens` accepte aussi `acces` et
  `regles`. Chaque ressource de la liste porte `acces`, `autorises`, `nouveau`, `partageAvecMoi` et ses `droits`
  (`modifier`, `supprimer`, `acces`, `partager`).
- **Bus** : `cm.lien_acces` (charge : `acces` et nombre de règles, jamais les personnes ; fil des gestionnaires CM qui voient la
  ressource) et `cm.lien_partage` (notification personnelle `cm-lien-partage` seulement, relue au moment de l'envoi).
- **Données** (`0048_cm_liens_acces.sql`) : `cm_liens.acces`, `cm_lien_acces` (règles), `cm_lien_partages` (à qui, par qui,
  quand, `vu_le`), `notifications.cm_lien_id`. Export / import de la base : `cm_lien_acces`, `cm_lien_partages`. **RGPD** :
  l'export du compte donne `cmLiensAcces` (ressources où il est nommé) et `cmLiensPartages` ; à la suppression du compte, ses
  accès nominatifs et partages reçus sont effacés, ceux qu'il a donnés restent sans auteur.
- **Tests** : `esport/test/cm-liens-acces.test.mjs` (SQLite et PostgreSQL : rien par aucune route pour un compte non
  autorisé — liste, carte et dossier liés, écritures, état, journal, notifications, temps réel —, « Partager avec Lyna »
  et sa notification, « Nouveau » puis ouverture, retrait immédiat, rôles, garde-fou, création restreinte, suppression,
  export / import, RGPD) et `src/esport/CmRessourcesAcces.test.tsx` (cadenas, avatars, « Nouveau », filtre, partage, réglage,
  création, phrase FR/EN).

### Fichiers dans les ressources (migration 0051)

Demande du Fondateur : « qu'on puisse mettre des fichiers dans l'onglet Ressources ». Une ressource est un **lien**
(ci-dessus) **ou un fichier**. Bouton **« + Ajouter »** → **Lien** ou **Fichier**. Code : `esport/noyau/cm/liens.mjs`
(partie « Fichiers ») et `esport/noyau/cm/drive/service.mjs` (partie « Fichiers de DATA › Ressources »),
`src/esport/ui/cm/liens/FormFichier.tsx`, `Ressources.tsx`, `LiensLies.tsx`.

- **Ajouter un fichier** : **depuis l'appareil** (site et app PC ; plusieurs fichiers d'un coup ou **glisser-déposer** : une
  ressource par fichier, envoi **par morceaux avec reprise** et barre de progression, comme le Drive ; sur l'app iPhone,
  pas de sélecteur : on choisit dans un Drive) **ou depuis un Drive** (sélecteur « Depuis le Drive » avec le choix du Drive).
  Titre (par défaut le **nom du fichier** ; un titre saisi ne vaut que pour un fichier seul), description, étiquette, team,
  épinglage, ordre, **« Qui voit la ressource »** : les mêmes règles que les liens.
- **Stockage — choix retenu** : on réutilise le **stockage du Drive** (aucun second stockage, aucun second quota).
  - Fichier **envoyé depuis Ressources** : rangé dans le **dossier système « Ressources »** du **Drive du club**, créé au
    premier envoi. Il est géré comme un fichier du Drive (**versions**, **quota** du Drive, alerte à 80 %, **corbeille**) et
    **appartient à sa ressource** (`cm_drive_fichiers.ressource_id`). **Approche la plus sûre, double** : le dossier
    « Ressources » est **toujours restreint** (seuls les gestionnaires du Drive l'ouvrent ; il ne se rouvre pas : 409
    `dossier-systeme`) **et** chaque fichier n'existe, dans tout le Drive, que pour qui **voit sa ressource** (liste, compteur
    du dossier, recherche, filtres, détail, ZIP, nouveautés, corbeille, favoris, lien interne, lien signé du Drive, lien
    `/cm/fichiers`). Un gestionnaire du Drive qui n'est pas d'une ressource restreinte ne voit donc pas son fichier. Le fichier
    ne se **déplace**, ne se **copie**, ne se **joint** ailleurs (carte, visuel, sponsor, autre ressource) ni ne part à la
    **corbeille** par le Drive (409 `fichier-ressource`) : tout passe par la ressource ; il peut être renommé et recevoir une
    version. Aucun événement du Drive (fil, journal, nouveautés) ne le nomme : la ressource a les siens.
  - Fichier **choisi dans un Drive** : simple **référence** (rien n'est copié). **La ressource suit sa source** : la voir ne
    donne jamais accès au fichier ; qui la voit sans voir le fichier dans son Drive lit « **Fichier d'un Drive auquel vous
    n'avez pas accès** » (ni nom, ni taille, ni lien ; 403 `drive-inaccessible`). Source à la corbeille : « Fichier supprimé
    du Drive ». Restreindre la ressource ne cache pas le fichier dans son Drive (il ne lui appartient pas). Attention : le
    **titre** de la ressource (par défaut le nom du fichier) est visible de tous ceux qui la voient ; pour un fichier d'un
    dossier restreint, donnez-lui un titre neutre.
- **Affichage** : icône du type (image, vidéo, son, document, archive…), nom, format, dimensions, durée, taille, Drive
  d'origine, **vignette** d'une image ; **aperçu au clic** (les aperçus du Drive : image, SVG sans script, vidéo, son, police,
  texte, PDF dans un nouvel onglet), **Télécharger**, **Remplacer le fichier** (menu ⋯ : nouvelle version, l'ancienne reste
  dans l'historique du Drive ; pour un fichier choisi dans un Drive, il faut aussi pouvoir le modifier dans son Drive),
  **filtre par type** (Liens, Fichiers, Images, Documents, Vidéos), recherche dans le nom du fichier. Liaison aux cartes et
  aux dossiers comme les liens (dans une carte, le fichier s'ouvre par lien signé).
- **Contrôle serveur** : aperçu et téléchargement par **lien signé** (2 h) `GET /cm/liens/contenu/<ressource>.<version>`,
  chaque lecture revérifie la **visibilité de la ressource ET l'accès au fichier source** pour le compte du lien (un lien
  forgé ou conservé par un compte non autorisé : 403 ; **retrait immédiat**). Types dangereux refusés **comme dans le Drive**
  (octets vérifiés, HTML et exécutables refusés, nom assaini, extension forcée, `nosniff`, SVG et texte en `sandbox`) ;
  **quota** du Drive (413 `quota-drive`), plafond par fichier.
- **Envoi** : `/cm/drive/portees/ressources/envois…` (usage « drive », portée d'envoi « ressources », `cm.editer` du club suffit,
  sans droit sur le Drive : le fichier ne peut aller que dans le dossier « Ressources »). Un envoi du Drive ne sert pas pour une
  ressource, ni l'inverse.
- **Suppression** : ressource ouverte à toute l'équipe CM → son fichier envoyé part à la **corbeille du Drive** (30 jours,
  restaurable par un gestionnaire du Drive, il n'appartient plus à aucune ressource) ; ressource **restreinte** → son fichier
  est **effacé tout de suite** (lignes et octets s'ils ne servent plus), pour ne jamais réapparaître chez qui ne la voyait pas.
  Un fichier choisi dans un Drive n'est jamais touché.
- **API** : `POST /cm/liens { genre: 'fichier', envoi | elementId, titre?, description?, categorie?, teamId?, epingle?, acces?, regles? }` ;
  `POST /cm/liens/:id/fichier { envoi, version? }` (remplacer ; 409 `conflit` si la version a changé) ;
  `POST /cm/liens/:id/fichier/lien { telecharger?, version? }` ; `GET /cm/liens/contenu/<ressource>.<version>?c&exp&sig` (sans
  session). Chaque ressource porte `genre` et, pour un fichier, `fichier` (`source`, `etat` : `ok` | `inaccessible` |
  `supprime` ; nom, genre, type, taille, version, infos, vignette, Drive d'origine, `remplacer`). Limite de débit : celle des
  dépôts du Drive.
- **Bus** : `cm.lien_cree`, `cm.lien_modifie`, `cm.lien_supprime` portent `genre: 'fichier'` ; nouveau `cm.lien_version`
  (fichier remplacé). Mêmes contrôles de visibilité que les autres événements de ressources.
- **Données** (`0051_cm_ressources_fichiers.sql`) : `cm_liens.genre` ('lien' par défaut), `cm_liens.element_id`,
  `cm_liens.source` ('envoi' | 'drive'), `cm_drive_fichiers.ressource_id` ; `url` et `hote` d'un fichier valent ''. Export /
  import de la base : colonnes comprises. **RGPD** : `cmLiens` donne le genre et, pour un fichier envoyé, son nom (les
  octets sont dans `cmDrive`) ; à la suppression du compte, ressources et fichiers restent au club sans auteur.
- **Graines** : `esport/outils/graines-ressources.mjs` (un lien et un fichier au nom long, pour l'écran et le contrôle de
  débordement sur téléphone).
- **Tests** : `esport/test/cm-ressources-fichiers.test.mjs` (SQLite et PostgreSQL : envoi d'un et de plusieurs fichiers,
  dossier « Ressources » restreint, aperçu et téléchargement, types refusés, ressource restreinte invisible par le Drive et
  par liens signés forgés — ressource, Drive, `/cm/fichiers` —, retrait immédiat, gestion par la ressource seulement, choix
  depuis un Drive sans copie et « suit sa source », remplacer, suppression vers la corbeille ou effacement, quota, cartes
  liées, export / import, RGPD) et `src/esport/CmRessourcesFichiers.test.tsx` (filtre par type, ligne, fichier inaccessible,
  aperçu et téléchargement, ajout depuis un Drive, carte liée, anglais).

## Tableaux façon Trello

- **Mise en page** (comme le Trello de la CM) : les colonnes sont **côte à côte** et le **tableau défile
  horizontalement** ; il prend la **hauteur de la fenêtre** qui reste sous son en-tête (la page ne défile pas) et
  **chaque colonne a sa propre barre de défilement vertical**. En-tête de colonne **fixe** : nom, **nombre de
  cartes**, bouton **réduire** (→←) et menu **⋯** ; **« + Ajouter une carte »** reste **en bas** de la colonne. Une
  colonne **réduite** devient une **bande verticale** (nom vertical, nombre de cartes ; un clic l'agrandit) ; le
  choix est **mémorisé par compte** (`cm_preferences`, clé `tableau.<id>.reduites`). Téléphone : **une colonne par
  écran**, balayage latéral (le bas de l'écran reste à la barre de navigation).
- **Place pour le tableau** (PC) : un tableau ouvert n'a **pas de largeur maximale** (la page n'est plus bornée à
  1600 px) : réduire la **barre latérale** («, en haut de la barre) élargit le tableau d'autant. Marges serrées, fil
  d'Ariane et sous-onglets sur **une seule ligne**, bouton **Filtres** dans la **ligne du nom** (le panneau s'ouvre
  dessous), bannière « colonne de fin » sur une ligne ; la zone va jusqu'au **bas de la fenêtre** (haut remesuré quand
  ce qui est au-dessus change). Une colonne grandit avec ses cartes jusqu'à la hauteur de la zone, puis défile.
  **Plein écran** (bouton de l'en-tête, PC) : le tableau seul par-dessus l'app (ni barre de l'app, ni fil d'Ariane, ni
  onglets, ni barre latérale) ; **Échap** en sort (au lieu de ramener au hub ; dans un champ, Échap ferme le champ ;
  une fiche ouverte se ferme d'abord). Le rappel « Échap pour fermer » à côté de « ← Hub » a été retiré.
- **Cartes compactes** : par défaut le **titre seul** (deux lignes au plus, environ 36 px). La carte ne grandit que
  si elle a quelque chose à montrer : **étiquettes** (pastilles au-dessus du titre), **couverture**, et sous le
  titre une ligne d'informations : statut et réseaux d'un post, date prévue, **échéance**, icône **description**
  (≡), **commentaires**, **checklist** (x/y), **pièces jointes**, dépôt / suggestion, **membres** (avatars).
- **Fond du tableau** (menu **⋯ › Changer le fond…**, `cm.editer`) : 8 **couleurs** et 6 **dégradés** prédéfinis
  (seule la clé est enregistrée, `src/esport/cm/fonds.ts`), ou une **image** prise dans le **Drive** du tableau ou
  du club (aucun octet copié) ou **importée** (envoi par morceaux dans la portée du tableau) : PNG, JPEG, WebP, GIF,
  jamais de SVG. Un **voile sombre** recouvre toujours le fond et les colonnes gardent une surface presque opaque :
  lisible en thème **clair comme sombre**. L'image se lit par lien signé (2 h) pour qui voit le tableau, même sans
  accès au Drive ; ses octets partent quand plus rien ne s'en sert (fond changé, `utilisations.mjs`).
- **Enregistrer une modification** (fiche d'une carte) : chaque champ s'enregistre par son bouton ou sa case ; ce qui
  est tapé est un **brouillon** gardé tant qu'il n'est pas enregistré, même si la carte est relue entre-temps (autre
  action de la fiche : étiquette, checklist, visuel ; autre personne ; rafraîchissement). Le message (« Enregistré. »
  ou l'erreur) s'affiche **dans le bloc** du bouton. Post : la sauvegarde envoie la **version lue** ; si la carte a
  changé ailleurs sans toucher au contenu du post (étiquette, déplacement…), l'app renvoie avec la nouvelle version ;
  si quelqu'un a changé le texte, la saisie reste et l'écart est expliqué. Le titre d'un post **publié** ne se
  modifie plus (dépublier d'abord). Un membre assigné qui a **perdu l'accès** au tableau (affectation retirée,
  membre importé de Trello) reste sur la carte et ne bloque plus les autres changements de membres ; seuls les
  membres **ajoutés** doivent avoir accès. Sur iPhone et Android, toucher « Enregistrer » clavier ouvert enregistre
  du premier coup.
- **Plusieurs tableaux** : du club, ou rattachés à une team. Le tableau par défaut **« Contenus »** (club, et une team
  dès qu'on ouvre sa partie CM) a les listes **Idées → En préparation → À valider → Validé / Programmé → Publié** ;
  renommées, elles gardent leur rôle. Il ne s'archive ni ne se supprime.
- **Listes** : créer, renommer, déplacer (menu de la liste), archiver.
- **Cartes** : titre, description en **Markdown** (nettoyé par le serveur, rendu par l'app sans HTML), **étiquettes**
  colorées, **échéance** (et « terminé »), **membres assignés** (personnes qui ont accès au tableau), **checklists**,
  **commentaires** (@pseudo : la personne est prévenue), **pièces jointes** (lien https, fichier envoyé par
  morceaux : PDF, images, vidéos, archives ; jamais de SVG ni HTML ; ou fichier choisi **dans le Drive**, sans copie), **couverture** (couleur ou image jointe),
  team concernée (tableau du club), **archivage**, **activité** (qui a fait quoi sur la carte).
- **Déplacer une carte** : à la souris ou au doigt par la poignée **⠿** (un trait montre où elle arrive ; le tableau
  défile près des bords) ; au clavier et au lecteur d'écran par le menu **⋯** de la carte (Monter, Descendre, Liste
  précédente / suivante, Déplacer vers…). Le serveur range la carte entre ses voisines (positions décimales,
  renumérotées si besoin).
- **Créer des cartes en chaîne** (comme Trello) : « + Ajouter une carte » ouvre un champ en bas de la colonne ; **Entrée**
  (ou le bouton « Carte » / « Ajouter ») crée la carte, **vide le champ et le garde ouvert avec le focus**, prêt pour la
  suivante. La carte apparaît **tout de suite** en bas de la colonne (affichage optimiste ; les créations partent au
  serveur dans l'ordre, une erreur retire la carte et s'affiche) et la colonne défile pour garder le champ visible.
  **Échap** ou un clic ailleurs ferme le champ ; **Maj+Entrée** fait un retour à la ligne (le serveur le range en espace
  dans le titre) ; **coller plusieurs lignes** propose **« Créer N cartes »** (une par ligne non vide, 200 caractères
  au plus). Téléphone : le bouton garde aussi le champ ouvert.
- **Déplacer une colonne** : à la souris, on saisit l'**en-tête** (nom) et on le dépose entre deux colonnes (un trait
  vertical montre l'emplacement, le tableau défile tout seul près des bords) ; au toucher, **appui long** sur l'en-tête ;
  au clavier et au lecteur d'écran, menu **⋯** de la colonne › **Déplacer la colonne à gauche / à droite** (annoncé).
  L'ordre est **persisté côté serveur** (`POST /cm/listes/:id/deplacer { index }`, permission `cm.editer`, tableau
  restreint respecté ; le serveur compte parmi les colonnes non archivées) et change aussitôt à l'écran ; les autres
  utilisateurs le reçoivent par le temps réel (version du tableau) en moins d'une seconde.
- **Étiquettes** : propres à chaque tableau (pas d'étiquettes globales) ; couleur parmi 10 teintes ou **couleur libre**
  `#RRGGBB`, nom de 40 caractères au plus (peut rester vide, comme sur Trello). **Gérer les étiquettes** : menu **⋯**
  du tableau, ou **Modifier les étiquettes…** dans la fiche d'une carte (même panneau). On peut **créer, renommer,
  recolorer, réordonner** (`cm.editer`), **fusionner** deux étiquettes (les cartes de la première passent à la
  seconde, sans doublon) et **supprimer définitivement** (`cm.gerer`). La suppression demande une confirmation qui
  indique le **nombre de cartes** concernées (archivées comprises) ; l'étiquette est retirée de toutes les cartes,
  **sans corbeille**. Les cartes ne portent que l'identifiant de l'étiquette : un renommage ou une couleur
  changée se voit tout de suite partout (cartes, filtres, fiches, autres écrans via la version du tableau).
  Les **étiquettes importées de Trello** se gèrent comme les autres, et **relancer l'import** ne défait rien : une
  étiquette renommée ou recolorée dans l'app garde son nom et sa couleur, une étiquette supprimée ou fusionnée
  n'est pas recréée (migration `0029_cm_etiquettes.sql` : `cm_etiquettes.modifie_le`, `cm_etiquettes_retirees`).
  Pourquoi `cm.gerer` pour supprimer et fusionner : c'est une action destructrice qui touche toutes les cartes du
  tableau, au même niveau que supprimer un tableau ; renommer ou recolorer reste ouvert à qui prépare les cartes
  (`cm.editer`). Le journal de la section note `cm.etiquette_modifiee`, `cm.etiquette_supprimee` (avec le nombre de
  cartes) et `cm.etiquette_fusionnee`. Les **étiquettes des fichiers du Drive** (tags) se gèrent dans le Drive :
  [drive.md](drive.md).
- **Recherche et filtres** (bouton **Filtres** de l'en-tête) : texte, étiquettes, membres, échéance (en retard, 7 jours, sans), posts / cartes ;
  recherche dans tous les tableaux (titre et description). **Archives** affichables.
- **Grands tableaux** : sept requêtes par tableau quelle que soit sa taille ; 60 cartes affichées par liste, puis
  « Afficher plus » ; 10 000 cartes au plus par tableau.
- **Mises à jour des autres** : chaque écriture augmente la `version` du tableau ; l'app relit `GET /cm/etat`
  (quelques octets) toutes les 12 s quand la page est visible et recharge le tableau s'il a changé. Pas de
  websocket ni de connexion ouverte (hébergement mutualisé o2switch).

### Commentaires non lus (migration 0045)

Quand quelqu'un commente une carte, une **petite pastille rouge** (la même que les nouveautés du Drive, avec le
nombre) prévient les autres. L'état « lu » est gardé **par le serveur, par compte** (jamais dans le navigateur) :

- **Ce qui compte** : un commentaire écrit par **quelqu'un d'autre** après la dernière ouverture de la carte par ce
  compte (ou son dernier « Tout marquer comme lu »). **Ses propres commentaires ne comptent jamais.** Ne comptent pas
  non plus : les commentaires supprimés, ceux importés de Trello, ceux des cartes archivées ou supprimées. Au
  **premier passage** d'un compte, rien n'est « non lu » (ce qui existait avant n'encombre pas les pastilles).
- **Qui le voit** : seulement les tableaux que le compte voit (`cm.voir`) ; un compte sans accès n'a aucune pastille et
  reçoit 404 sur les routes du tableau et de la carte.
- **Où** : sur chaque **carte** (à côté de ❝ n), dans l'**en-tête de la colonne** (somme de ses cartes, aussi sur une
  colonne réduite), à côté du **nom du tableau**, sur le tableau dans la **liste des tableaux**, sur le sous-onglet
  **Tableaux**, sur le groupe **Contenus** de la barre latérale (somme de « Tableaux » et « À valider »), sur la
  puce **Contenus** de la tuile « CM du club » de Teams, et sur l'onglet **Tableau** de la partie CM d'une team. Les
  nouveautés du **Drive** gardent leur propre pastille : les deux comptes ne s'additionnent jamais (« À valider » est un
  autre compteur, déjà existant).
- **Disparition** : ouvrir la carte la marque lue (`GET /cm/cartes/:id?vu=1`, une lecture, rien n'est diffusé) ;
  **« Tout marquer comme lu »** (bouton du tableau, `POST /cm/tableaux/:id/tout-vu`) marque tout le tableau lu pour ce
  compte seulement.
- **Dans la fiche** : les commentaires écrits depuis la visite précédente sont mis en évidence (fond teinté, filet
  d'accent) sous un séparateur **« N nouveaux commentaires »** qui reste tant que la fiche est ouverte, même si elle
  est relue entre-temps (un commentaire qui arrive pendant la lecture est marqué lu aussitôt, la pastille s'efface).
- **Temps réel** : un commentaire est une écriture du sujet `cm` (voir [temps-reel.md](temps-reel.md)) ; l'état de la
  section (`GET /cm/etat`, qui rend aussi `nonLus: { total, tableaux }`) est relu aussitôt chez les autres, la
  pastille apparaît en moins d'une seconde. « Tout marquer comme lu », « Suivre » et la lecture `?vu=1` ne sont
  jamais diffusés (état personnel). Le tableau lui-même se recharge via la version de la carte, comme avant.
- **Notification** (centre de notifications, catégorie **CM**, type `cm-commentaire` : « X a commenté « titre » ») :
  seulement pour les **membres assignés** à la carte, l'**auteur de la carte** et les personnes qui la **suivent**
  (bouton **Suivre** / **Suivie** de la fiche, `POST /cm/cartes/:id/suivre { suivre }`), à condition qu'elles aient accès
  au tableau ; jamais l'auteur du commentaire. Les personnes **@mentionnées** gardent leur notification `cm-mention`
  (jamais en double). **Une seule** notification non lue par carte et par personne (pas de rafale quand la
  conversation s'anime). Le commentaire n'apparaît plus dans le fil du centre de tous ceux qui voient le CM (règle
  `cm.commentaire_ajoute` : aucune) ; il reste dans le journal d'activité.
- **Données** : `cm_commentaires_vus` (`compte_id`, `cle` : identifiant de la carte, `t:<tableau>` pour « tout lu » ou
  `*` pour le premier passage, `vu_le`) et `cm_carte_suivis` (`carte_id`, `compte_id`). Export / import de la base
  (`transfert.mjs`) ; **RGPD** : l'export d'un compte contient son état « lu » (`cmCommentairesVus`) et ses cartes
  suivies (`cmCartesSuivies`), sa suppression efface les deux.

### Urgences : le drapeau des cartes (migration 0047)

Chaque carte peut porter un **drapeau d'urgence** à quatre niveaux : **Faible**, **Moyen**, **Urgent**, **Critique** (par
défaut : **aucun**). Colonne `cm_cartes.urgence` (`NULL` ou `faible` / `moyen` / `urgent` / `critique`), constantes et
ordre dans `esport/noyau/cm/urgence.mjs` (serveur) et `src/esport/cm/urgence.ts` (app).

- **Réglage** (`cm.editer`, comme les autres champs de carte ; un lecteur voit le drapeau sans pouvoir le changer, un
  correspondant qui ne fait que déposer n'y touche pas : 403) : `PATCH /cm/cartes/:id { urgence }` (`null` ou `"aucune"` =
  aucun ; 400 `urgence` si la valeur est inconnue). Trois façons dans l'app : le **sélecteur rapide** de la fiche
  (« Niveau d'urgence », cinq choix), le menu **⋯ › Urgence…** de la carte (volet à cinq choix, utilisable au clavier et au
  lecteur d'écran) et, à l'import, la conversion d'étiquettes Trello (ci-dessous). Chaque changement est inscrit dans le
  **journal d'activité de la carte** (« X a changé l'urgence : Aucune → Faible ») ; un changement vers le même niveau
  n'écrit rien. Pas de raccourci clavier dédié : le menu ⋯ se parcourt déjà au clavier.
- **Sur la carte** (interface seulement, aucune donnée en plus) : une **bande de couleur verticale** (6 px) sur le bord
  gauche, et une **pastille texte** « CRITIQUE » / « URGENT » / « MOYEN » / « FAIBLE » (fond plein, drapeau monochrome,
  petites capitales et **barres** : 1 à 4 selon le niveau) sur la ligne des étiquettes : la carte compacte **ne grandit pas**
  (ce n'est pas une « information » de `carteAInfos`). **Critique** : fond de carte légèrement teinté de rouge (mélange
  opaque : lisible sur les fonds d'image), bordure rouge de 2 px et **pulsation douce de la bande**, désactivée avec
  `prefers-reduced-motion` (`AccessibilityInfo.isReduceMotionEnabled`) ; **Urgent** : même principe en orange, plus discret,
  sans pulsation ; **Moyen** et **Faible** : bande et pastille seulement. La couleur ne porte jamais seule l'information
  (daltonisme) : texte de la pastille, nombre de barres, et libellé « Urgence : Critique » lu par les lecteurs d'écran
  (dans le nom de la carte) et en infobulle sur le web.
- **Jetons de couleur** (`JETONS_URGENCE`, `src/esport/cm/urgence.ts`, repris par le design system sous `URGENCE`) :
  `urgence.critique|urgent|moyen|faible`, chacun avec `trait` (bande, drapeau, texte), `fond` / `encre` (pastille) et
  `teinte` (part mélangée au fond de la carte), en clair et en sombre ; contrastes testés dans les huit thèmes (texte de
  pastille et trait au moins 4,5:1, texte et texte atténué lisibles sur le fond teinté). Briques réutilisées partout
  (`src/esport/ui/cm/Drapeau.tsx`) : `PastilleUrgence`, `BandeUrgence`, `CompteurUrgence`, `BandeauUrgence`,
  `LegendeUrgence`.
- **Légende** : bouton **« ? »** de l'en-tête du tableau (et à côté du filtre d'urgence d'À valider et du calendrier), et
  rappel sur la carte « Urgences » de l'Accueil CM : une pastille et son sens par niveau, et l'explication des barres.
- **Fiche de la carte** : **bandeau coloré** en haut avec le niveau en grand ; le sélecteur « Niveau d'urgence » devient
  quatre **gros boutons colorés** (plus « Aucun »), le niveau actuel plein et coché.
- **Filtre** : dans **Filtres** du tableau, une rangée de cases Critique / Urgent / Moyen / Faible / **Sans drapeau**
  (plusieurs niveaux possibles) ; un filtre à choix unique dans **À valider** et dans le **calendrier éditorial**, qui
  affichent aussi le drapeau (`/cm/a-valider`, `/cm/calendrier`, `/cm/recherche` rendent `urgence`).
- **Tri** : voir « Tri des cartes » ci-dessous (tri automatique par urgence puis échéance, par défaut dans chaque colonne).
- **Compteurs** : l'en-tête de chaque colonne montre le nombre de cartes **Critique** et **Urgent** (archivées exclues,
  **pastilles colorées** drapeau + nombre, libellé « 2 cartes critiques » pour les lecteurs d'écran). `GET /cm/tableaux` rend
  `urgences: { critique, urgent }` par tableau (puces sur la liste des tableaux) ; `GET /cm/etat` rend `urgences` (total
  sur les tableaux visibles) ; `GET /cm/urgences` rend les cartes critiques puis urgentes (échéance la plus proche en
  premier) des tableaux visibles. L'**Accueil CM** a une carte **« Urgences »** (nombre et cinq premières cartes, qui
  ouvrent le tableau), relue quand le nombre change.
- **Alertes** (centre de notifications, catégorie **CM**, type `cm-urgence`, événement `cm.carte_urgence`) : passer une
  carte en **Urgent** ou **Critique**, **en montant seulement** (Faible → Urgent, Urgent → Critique, aucun → Critique :
  une notification chaque fois ; descendre, ou passer à Faible / Moyen, n'en envoie jamais), prévient les **membres
  assignés** et les **personnes qui suivent** la carte, et, pour **Critique**, les comptes qui ont `cm.gerer` sur la partie
  du tableau (la Responsable CM du club, ou celles de la team). Jamais l'auteur du changement, et seulement les comptes qui
  **voient le tableau** (une personne assignée avant de perdre son accès, ou d'un tableau **restreint** qu'elle ne voit pas, n'est
  pas prévenue : le service filtre avec `personnesTableau` et le bus avec la visibilité du tableau ; les compteurs, `GET /cm/urgences`
  et la carte « Urgences » de l'Accueil ignorent aussi ces tableaux). Pas de notification dans le fil de tous ceux qui voient le CM (règle `cm.carte_urgence` : aucune,
  comme les commentaires) ; l'événement reste dans le journal d'activité. Pas de rafale : une montée = une notification
  par personne.
- **Temps réel** : le drapeau est une écriture du sujet `cm` (version du tableau incrémentée) : il apparaît chez les
  autres en moins d'une seconde, comme tout changement de carte (voir [temps-reel.md](temps-reel.md)). Le verrouillage
  optimiste de la fiche (`versionAttendue`) s'applique comme aux autres champs.
- **Import Trello** : une étiquette nommée **Critique / Urgent / Moyen / Faible** (ou **Critical / Urgent / Medium / Low**,
  sans tenir compte des accents ni de la casse) est signalée à l'**aperçu** (`urgences: [{ nom, niveau, cartes }]`). La case
  **« Les convertir en drapeau d'urgence »** (cochée par défaut) envoie `convertirUrgences: true` : les cartes qui portent
  ces étiquettes reçoivent le drapeau (le plus haut niveau si plusieurs), les étiquettes ne sont **pas** importées, et une
  carte qui a déjà un drapeau le **garde** (relancer l'import n'écrase rien). Décochée : comportement habituel
  (étiquettes importées). Le bilan rend `urgencesConverties`.
- **Données** : une colonne de `cm_cartes` (+ index `cm_cartes_urgence`) : export / import de la base inchangés
  (`transfert.mjs` lit toutes les colonnes), aucune donnée personnelle nouvelle (l'auteur d'un changement est dans le
  journal d'activité, déjà couvert par l'export et l'effacement RGPD). Migration SQL standard, identique sur SQLite et
  PostgreSQL.
- **Tests** : `esport/test/cm-urgence.test.mjs` (réglage et permissions, journal, compteurs, À valider et calendrier,
  notifications montée seulement / assignés / suiveurs / responsables / visibilité, temps réel, import Trello) ;
  `src/esport/CmUrgence.test.tsx` (couleurs AA, tri, filtre, carte compacte, en-tête de colonne, menu ⋯, fiche, phrases
  FR / EN) et `NavCm.test.tsx` (carte « Urgences » de l'Accueil).

### Colonnes de fin : les cartes « Fini » sont terminées (migration 0050)

Une colonne peut être déclarée **colonne de fin** : toute carte déposée dedans est **terminée**. Plusieurs colonnes de fin par
tableau sont possibles. Code : `esport/noyau/cm/colonneFin.mjs` (détection des noms, semaines), `tableaux.mjs`
(`instructionsTerminee`, `alignerCartesDeListe`), `src/esport/cm/colonneFin.ts`.

- **Déclarer une colonne de fin** : case **« Colonne de fin (les cartes déposées ici sont terminées) »** à la **création** d'une
  colonne (`POST /cm/tableaux/:id/listes { nom, fin }`) et dans le menu **⋯** de la colonne (**Colonne de fin : oui / non**,
  `PATCH /cm/listes/:id { fin }`, permission `cm.editer`). La case est **cochée d'office** quand le nom ressemble à **Fini,
  Terminé, Fait, Done, Publié** (sans accents ni casse, FR et EN) ; une fois touchée à la main, le nom ne la change plus.
  Une colonne de fin porte une **icône « terminé »** monochrome dans son en-tête (colonne réduite comprise).
- **Colonnes existantes** : la migration **ne coche rien**. Une **bannière « Marquer “Fini” comme colonne de fin ? »** (réservée à
  `cm.gerer`) s'affiche en haut du tableau pour chaque colonne ouverte dont le nom ressemble à Fini / Terminé / Fait / Done /
  Publié : **Marquer comme colonne de fin** ou **Non merci** (refus mémorisé dans `cm_listes.fin_ignoree`, la bannière ne revient pas).
- **Effet sur les cartes** : un seul invariant, tenu par le serveur : **une carte est terminée si et seulement si sa colonne est
  une colonne de fin**. La déposer dans une colonne de fin (glisser-déposer, menu ⋯, création directe, circuit de validation :
  un post publié rejoint « Publié » et devient terminé si cette colonne est cochée, import Trello, déplacement vers un autre
  tableau) enregistre la **date et l'auteur** (`cm_cartes.terminee_le`, `terminee_par`) ; la **sortir** d'une colonne de fin la
  **rouvre** (les deux champs repassent à vide). Cocher ou décocher une colonne qui contient déjà des cartes les termine ou les
  rouvre d'un coup (une ligne de journal par carte, **un seul** événement `cm.liste_fin`, aucune notification par carte).
- **Ce qui change pour une carte terminée** : sur la carte compacte, une **coche verte** devant le titre, titre **atténué**,
  drapeau d'urgence **conservé mais grisé** (plus de bande ni de teinte) ; dans la fiche, la mention **« Terminée le … par … »**
  (journal : « a terminé la carte », « a rouvert la carte »). Elle est **exclue** : des compteurs d'urgence (en-tête de colonne,
  liste des tableaux, `/cm/etat`, `GET /cm/urgences`, carte « Urgences » de l'Accueil CM), des alertes d'urgence (monter en
  critique une carte terminée ne notifie personne), des **échéances en retard** (jamais rouge, absente du filtre « En retard »),
  de la file **À valider** et de ses compteurs. Les rappels de publication de **Réseaux** ne concernent pas les cartes.
  Le filtre du tableau gagne **« Masquer les terminées »**.
- **Statistiques** : `GET /cm/terminees?semaines=8` (26 au plus) : cartes terminées par semaine (lundi à dimanche, UTC) sur les
  tableaux visibles ; la carte **« Cartes terminées »** de l'Accueil CM affiche la semaine en cours et de petites barres par semaine.
- **Événements du bus** : `cm.carte_terminee` et `cm.carte_rouverte` (charge `{ titre, tableau, liste, cle, concernes }`), `cm.liste_fin`
  (colonne cochée ou décochée). Journal d'activité et **temps réel** (sujet `cm`, version du tableau incrémentée : les autres voient
  la carte se terminer en moins d'une seconde). **Notification** `cm-carte-terminee` (catégorie CM) au **créateur de la carte et à
  ses suiveurs** (jamais à l'auteur du dépôt) : **une seule non lue par carte et par personne** (aller-retour sans spam),
  **rien à la réouverture**. **Tableau restreint** : seuls ceux qui voient le tableau sont prévenus (filtre du service et du bus) ;
  les statistiques, compteurs et listes ignorent les tableaux fermés au compte.
- **Import Trello** : l'aperçu propose comme colonnes de fin les listes **archivées** ou nommées Fini / Terminé / Fait / Done / Publié
  (`listes[].proposeFin`) ; les cases (cochées d'office) envoient `listesFin: [identifiants Trello]` ; ces listes deviennent colonnes
  de fin (jamais décochées par un nouvel import) et leurs cartes sont terminées (bilan `colonnesFin`).
- **Données et RGPD** : `cm_listes.fin`, `cm_listes.fin_ignoree`, `cm_cartes.terminee_le`, `cm_cartes.terminee_par` (+ index
  `cm_cartes_terminee`) ; export / import de la base inchangés (toutes les colonnes sont lues). `terminee_par` est mis à vide à la
  suppression du compte (la carte reste terminée, « Compte supprimé »). Migration SQL standard, identique sur SQLite et PostgreSQL.
- **Tests** : `esport/test/cm-colonne-fin.test.mjs` (création, réglage, déplacement vers et depuis une colonne de fin, exclusions,
  notifications, temps réel, tableau restreint, circuit de validation, autre tableau, statistiques, import Trello, RGPD) et
  `src/esport/CmColonneFin.test.tsx` (noms, case cochée d'office, menu ⋯, bannière, icône, carte terminée, filtres, fiche, phrases FR / EN).

## Tri des cartes

Migration 0052 : `cm_listes.tri` (`auto` par défaut, ou `manuel`). Le choix est **par colonne**, **stocké côté serveur** et
visible de tous les membres du tableau (ce n'est plus une préférence personnelle).

- **Tri automatique** (défaut de chaque colonne) : (1) les cartes ouvertes d'abord ; (2) **urgence décroissante** :
  Critique, Urgent, Moyen, Faible, sans drapeau ; (3) à urgence égale, **échéance la plus proche en premier** : les
  échéances dépassées d'abord (la plus ancienne en tête), puis les plus proches ; les cartes **sans échéance** (ou dont
  l'échéance est cochée « faite ») après celles qui en ont ; (4) à égalité, l'**ordre manuel** (`position`). Les cartes
  **terminées** (colonne de fin) viennent en dernier, dans leur ordre manuel. L'échéance est un instant absolu : le fuseau
  du club (Europe/Paris, y compris le passage à l'heure d'hiver) n'intervient que dans l'affichage. Fonction pure :
  `src/esport/cm/tri.ts` (`comparerCartes`, `trierCartes`).
- **Ordre manuel** : l'ordre des positions, réglé par glisser-déposer, « Monter » et « Descendre ».
- **Choix** : menu ⋯ de la colonne › **« Tri automatique (urgence puis échéance) »** ou **« Ordre manuel »** (le choix en
  cours est marqué « (actuel) » ; réservé à `cm.editer`, `PATCH /cm/listes/:id { tri }`, valeur autre que `auto` / `manuel`
  refusée en 400). Le tri est une **vue** : les positions ne sont jamais modifiées, repasser en manuel retrouve l'ordre
  d'avant. Un serveur ancien (sans le champ) reste en ordre manuel.
- **Indication** : sous l'en-tête d'une colonne en tri automatique, le libellé discret **« Trié par urgence »**, avec
  l'infobulle « … Passer en ordre manuel pour réordonner. ».
- **Glisser-déposer** : **entre colonnes** il reste possible (la carte rejoint la colonne cible, où elle prend sa place
  triée) ; **à l'intérieur** d'une colonne en tri automatique le réordonnancement est désactivé (pas d'indicateur de
  dépôt, annonce « Colonne en tri automatique : passer en ordre manuel pour réordonner. » ; « Monter » et « Descendre »
  masqués ; « Liste précédente / suivante » et « Déplacer vers… » restent). Règle : `regleDepot` (`Tableau.tsx`).
- **Création en chaîne** : la nouvelle carte apparaît à sa place triée (une carte sans drapeau ni échéance : après les
  cartes qui en ont, avant les terminées ; dans une colonne de fin : parmi les terminées) et la colonne défile jusqu'à
  elle.
- **Partout où une colonne est listée** (vue large comme mobile, une seule liste ordonnée) et **en temps réel** : quand
  l'urgence ou l'échéance d'une carte change (ici ou chez un collègue), la carte se replace avec une petite animation
  (glissement et fondu d'une fraction de seconde), **coupée avec `prefers-reduced-motion`**.
- **Migration des anciens réglages** : la préférence personnelle « Critiques en haut » (`cm_preferences`, clé
  `tableau.<id>.tri_urgence`) est supprimée par la migration 0052 ; toutes les colonnes passent en tri automatique.
- **Export / import** : `tri` fait partie des colonnes de `cm_listes` de l'export de la base (un ancien export sans la
  colonne s'importe en tri automatique).

## Accès au tableau (tableaux restreints)

Un tableau est visible de **« Tous ceux qui ont accès au CM »** de sa portée (défaut : le comportement d'avant, et
la valeur de tous les tableaux existants à la migration 0046) ou **« Restreint »** : seulement les **personnes** et
les **rôles** choisis — rôles CM, rôles du club (Rôles et permissions), rôles de team (ceux de la team du tableau ;
pour un tableau du club, ceux des teams au module CM) —, chacun avec un niveau :

| Niveau | Ce qu'il ouvre |
| --- | --- |
| **Peut voir** | le tableau, ses cartes, commentaires, pièces jointes, visuels, en **lecture seule** : aucune écriture (ni commentaire, ni validation, ni déplacement : 403) |
| **Peut modifier** | les permissions CM **habituelles** du compte sur la portée (cm.editer, cm.valider, cm.gerer…) |

- **Le Fondateur (CEO) voit et modifie toujours tout**, sans être cité. L'accès au tableau ne **donne** jamais rien :
  il faut d'abord voir le CM de la portée (cm.voir) ; il ne fait que retirer. Une personne citée qui perd son
  rôle CM ne voit plus le tableau ; un rôle compte pour qui l'a **aujourd'hui** (affectation CM du club ou de la
  team du tableau — membre actif —, rôle du club, rôle de team d'un membre actif).
- **Réglage** : menu **⋯** du tableau › **Accès au tableau…** (volet : « Tous ceux qui ont accès au CM » ou
  « Restreint », puis pour chaque personne et chaque rôle **Aucun / Peut voir / Peut modifier**, et « Qui voit ce
  tableau aujourd'hui »). Réservé à qui a **cm.gerer** sur la portée **ou a créé le tableau**, au niveau « peut
  modifier » (le Fondateur toujours). Un **cadenas « Restreint »** s'affiche sur le tableau dans la liste et dans son
  en-tête.
- **Garde-fous** (409) : le **tableau par défaut** « Contenus » reste ouvert (`tableau-defaut` : dépôts, clips,
  suggestions et événements y arrivent) ; un tableau restreint garde **au moins une personne, hors Fondateur, qui
  peut le gérer** (« peut modifier » avec cm.gerer, ou son créateur : `acces-sans-gestionnaire`) ; hors Fondateur,
  on ne **se retire pas soi-même** (`acces-soi-meme`). Une personne citée doit avoir accès au CM de la portée, un
  rôle doit exister (400 `regle-inconnue`) ; 100 personnes ou rôles au plus.
- **Contrôle côté serveur partout** (`esport/noyau/cm/acces.mjs`, relu à chaque requête : un retrait vaut **tout de
  suite**) : qui n'est pas du tableau reçoit **404** (on ne dit pas qu'il existe) sur le tableau, ses cartes,
  commentaires, checklists, pièces jointes (et leurs **liens signés** déjà donnés : 403), étiquettes, listes, visuels
  générés depuis ses cartes, son réglage d'accès ; il ne le voit ni dans la **liste des tableaux**, ni dans le
  **calendrier éditorial**, la **recherche**, **À valider**, l'**Accueil CM**, l'**état** (`/cm/etat` : versions et
  compteur « à valider »), la partie CM d'une team (tableaux, dépôts), le **journal** (section et team), les
  utilisations d'un fichier du Drive (comptées, sans titre), les posts comptés d'un **sponsor** (« post d'un tableau
  restreint », sans titre ni lien), les annonces et publications de **Réseaux** (sans lien vers la carte) ; l'**import
  Trello** ne met pas à jour un tableau restreint qu'il ne voit pas (409) et l'aperçu n'en donne pas le nom.
  **Pastilles de commentaires non lus** : jamais comptées pour un tableau restreint qu'on ne voit pas (carte, colonne,
  tableau, sous-onglet, groupe Contenus, tuile CM). Les **ressources** (DATA) liées à une de ses cartes ne la montrent
  pas (« Voir où il est lié »). **Notifications** : les personnelles (assignée, mention, nouveau commentaire — suiveurs
  compris : un suiveur retiré n'est plus prévenu —, à valider, validé, refusé) ne partent qu'à ceux qui voient
  le tableau (`notifications.cm_carte_id`), et le centre masque à la lecture le fil et les personnelles d'un tableau
  restreint (ou de ses cartes, même déplacées) dont le lecteur n'est pas ou plus — anciennes notifications
  comprises. **Temps réel** : la clé d'une carte, sa version, la présence et l'auteur ne partent que si la route de la
  carte répond au destinataire (rejouée à chaque message) ; changer l'accès d'un tableau oublie les autorisations en
  cache (`invalider`). Les personnes **assignables** et **mentionnables** d'un tableau restreint sont celles qui le voient.
- Un post **publié** reste public sur son réseau : sa ligne de statistiques (Réseaux) et son annonce Discord restent,
  sans lien vers la carte pour qui ne voit pas le tableau.
## Posts et validation

Une carte peut être un **post** : réseaux ciblés, **textes FR et EN par réseau** avec compteur de caractères
(X : 280, adresses comptées 23, emoji 2 ; Instagram : 2 200 et 30 hashtags ; TikTok : 4 000), hashtags et mentions
comptés, bouton **Copier** par réseau et par langue, **date de publication prévue** (heure de Paris pour le club,
heure de la team pour un tableau de team), liens vers un **match / tournoi / résultat** (bouton **Pré-remplir depuis
un match…** : textes FR / EN tirés du résumé publiable, avec J-1 / Jour J), vers des **clips** et des **joueurs**.

Circuit :

1. **Brouillon** → **Soumettre** (`cm.editer`) : refusé si un réseau n'a aucun texte, si un texte dépasse la limite
   du réseau ou si Instagram a trop de hashtags (400 `post-incomplet` avec le détail). Le post passe **À valider**
   (liste « À valider ») ; les valideurs sont prévenus. Vue **CM › À valider**.
2. **Valider** (`cm.valider`, avec la version lue : 409 si le post a changé entre-temps) → **Validé** (liste
   « Validé / Programmé »), l'auteur est prévenu ; ou **Refuser** avec un **motif** obligatoire → **Refusé** (liste
   « En préparation »), motif en commentaire, l'auteur est prévenu.
3. **Toute modification du contenu après la validation** (titre, réseaux, textes, date prévue, liens, pièces jointes,
   clip joint) repasse le post **À valider** : le serveur compare l'empreinte SHA-256 du contenu à celle enregistrée à
   la validation. Étiquettes, membres, commentaires, checklists ne comptent pas.
4. **Publier** (`cm.editer`) : seulement un post validé (409 `validation-requise`). On publie à la main, puis on colle
   l'**adresse du post** par réseau (https sur le domaine du réseau). Le post passe **Publié**, son contenu est
   verrouillé (« Annuler la publication » le ramène à Validé). Événement **`cm.post_publie`** (réseaux, adresses,
   liens, team) à la première publication, **`cm.post_adresses`** quand une adresse est ajoutée ou changée ensuite :
   la page **Réseaux** s'y abonne — **annonce Discord** du post (une par réseau et par salon, jamais en double ; une
   adresse changée réédite le message) et **publication suivie** pour les statistiques
   ([reseaux-stats.md](reseaux-stats.md)).

Les cartes se déplacent librement : glisser un post dans « Publié » ne le publie pas (le badge montre son statut).

## Suggestions automatiques

Pour une team dont le module CM est activé, l'app propose des **posts brouillon** dans « Idées » du tableau du club,
textes FR / EN pré-remplis (résumé publiable, hashtags des réglages) :

| Quand | Carte | Date de publication |
| --- | --- | --- |
| tournoi créé | « Annonce : <tournoi> » | — |
| match de tournoi daté (ou redaté) | « J-1 · … » et « Jour J · … » | la veille, et 3 h avant |
| résultat saisi | « Résultat · … » | — |
| tournoi terminé (avec classement) | « Classement final : … » | — |

Jamais pour un contenu non publiable (résultat staff, scrim non publiable, tournoi non publiable). Une seule carte
par élément et par type ; tant que personne ne l'a retouchée, elle suit le match (redaté : dates et textes ;
supprimé : archivée). **CM › Réglages** : désactiver tout, ou type par type ; réseaux et hashtags des suggestions.

## Dépôt d'informations (team)

**Team › Équipe › CM › Déposer** (`cm.deposer`, le correspondant) : type (info, photo, actu, recrue, résultat,
événement, autre), titre, détails (Markdown), liens (5), fichiers (5, envoi par morceaux). Une carte arrive dans
« Idées » du tableau CM de la team ; le CM du club est prévenu. Le correspondant voit ses dépôts et leur avancement,
et retouche le titre, les détails et les pièces de ses dépôts (pas le reste).

## Clips des joueurs

**Team › Équipe › CM › Clips** (`cm.clips.proposer`) : un lien (YouTube, Twitch… en https) ou un fichier vidéo,
titre, moment (« 12:34 »), match ou résultat **publiable** lié, description. 30 clips en attente au plus par joueur.
Le joueur voit ses clips et leur statut ; le CM est prévenu.

**CM › Clips** (galerie, filtres statut et team) : **Retenir**, **Refuser** (motif facultatif, envoyé au joueur),
**Créer une carte** (post brouillon dans « Idées » du club — ou de la team pour un CM de team —, clip en pièce jointe, match et joueur liés), **Joindre à
une carte** existante ; le clip passe **utilisé**. Le joueur est prévenu de chaque décision. Le fichier se lit par
lien signé (2 h), valable pour l'auteur et ceux qui voient la partie CM de la team.

## Calendrier éditorial

**CM › Calendrier** : posts prévus (date de publication) par **semaine** ou par **mois**, filtre par réseau ;
grille sur PC, jour par jour sur téléphone. Toucher un post ouvre son tableau.

**Calendriers des teams** (superposés, **lecture seule**, `GET /cm/calendrier/teams?du&au`, 100 jours au plus) : un
**interrupteur par team** (sa couleur, palette fixe dans l'ordre alphabétique), choix **mémorisé par compte**
(`cm_preferences`, clé `calendrier.teams` ; toutes affichées par défaut). Ce qui apparaît dépend de ce que le compte
a déjà le droit de voir :

| Accès | Ce qui s'affiche |
| --- | --- |
| membre actif de la team avec `planning.view` (ou Fondateur, ou rôle du club « Accès à toutes les teams ») | son **planning** : matchs, scrims, tournois, événements (pas les entraînements ni les réunions), lieu et description compris |
| partie CM seulement (CM du club, correspondant sans planning) | la **compétition publiable** : matchs de tournoi et tournois publiables (`competition/resume.mjs`), sans scrim, lieu, note ni description |
| ni l'un ni l'autre | rien (la team n'apparaît pas) ; sans `cm.voir` nulle part : 403 |

Toucher un événement ouvre son **détail** ; **« Créer un post pour cet événement »** (qui prépare des posts) pose un
post brouillon daté du début de l'événement dans « Idées » du tableau « Contenus » du club (sinon de la team), team
liée, textes FR / EN **pré-remplis** si le match ou le tournoi est publiable, puis ouvre le tableau.

## Import Trello

**CM › Import Trello** (`cm.gerer`, depuis le site ou l'app PC) :

1. Dans Trello : le tableau › **Menu ⋯ › Imprimer, exporter et partager › Exporter au format JSON**.
2. Choisir le fichier (15 Mo au plus), la partie CM (club ou team), « importer aussi les archivées ».
3. **Aperçu** : nombre de listes, cartes, étiquettes, checklists, commentaires, pièces jointes ; tableau déjà importé ;
   **correspondance des membres Trello** avec les comptes qui ont accès au tableau (proposée par pseudo).
4. **Importer** : tableau, listes (archivées en option), cartes et positions, descriptions, étiquettes et couleurs,
   échéances, checklists, commentaires (depuis les actions de Trello ; auteur associé, sinon son nom), pièces jointes en
   **liens**, couvertures de couleur. Les étiquettes **Critique / Urgent / Moyen / Faible** peuvent devenir le **drapeau
   d'urgence** des cartes (voir « Urgences »).

**Relancer l'import** du même tableau le met à jour **sans rien dupliquer** (identifiants Trello) : noms, positions,
archivage repris ; nouveaux éléments ajoutés ; rien de ce qui a été ajouté dans l'app n'est retiré ; une carte
devenue **post** dans l'app n'est plus modifiée par l'import.

Sécurité : **aucune requête réseau vers Trello**. Le fichier est une donnée non fiable : structure vérifiée
strictement (identifiants Trello, références entre listes, cartes, étiquettes, checklists ; refus 400
`trello-invalide` avec le chemin fautif), volumes bornés (300 listes, 5 000 cartes, 20 000 éléments de checklist et
commentaires…), textes tronqués, **Markdown nettoyé** (HTML neutralisé, liens http(s) seulement, pas d'image),
pièces jointes en https seulement. Les **fichiers déposés sur Trello restent des liens** : il faut être connecté à
Trello pour les ouvrir (l'app le dit) ; une image de couverture Trello reste une pièce jointe. Exemple anonymisé :
`esport/test/donnees/trello-exemple.json`.

## Notifications, journal, Discord

Notifications : carte assignée, @mention dans un commentaire, nouveau commentaire (assignés, auteur de la carte, suiveurs), carte passée en urgent ou critique (assignés, suiveurs, responsables CM pour critique ; voir « Urgences »), carte terminée dans une colonne de fin (créateur et suiveurs ; voir « Colonnes de fin »), post à valider (et à valider de nouveau après une
modification), post validé ou refusé (auteur et membres de la carte), dépôt d'une team (CM du club), clip proposé (CM
de la team), décision sur un clip (proposeur), rôle CM reçu, Drive rempli à 80 % (gestionnaires du Drive). Pour une carte d'un
**tableau restreint**, seulement ceux qui voient le tableau (voir « Accès au tableau »).

Journal (bus) : actions `cm.*` (tableaux, cartes, commentaires, dépôts, soumissions, validations, refus,
invalidations, publications, clips, import Trello, rôles, affectations, réglages). Une action sur un tableau de team
va dans le journal de la team (filtre « CM ») ; celles du club dans **CM › Journal** (gestionnaires).

**Discord** : le travail du CM reste interne (aucun message pour une carte, une validation, un clip) ; seule l'**annonce
d'un post publié** part sur Discord, en anglais avec un fil français, réglée compte par compte dans **CM › Réseaux**
(salons, rôle, messages, test : [reseaux-stats.md](reseaux-stats.md)).

## Données (migration 0023)

| Table | Contenu |
| --- | --- |
| `cm_roles`, `cm_role_permissions`, `cm_affectations` | rôles CM, permissions, affectations (club ou team) |
| `cm_reglages` | réglages (suggestions) |
| `cm_tableaux`, `cm_listes`, `cm_etiquettes` | tableaux (portée, version), listes (rôle `cle`), étiquettes |
| `cm_cartes` (+ `cm_carte_etiquettes`, `cm_carte_membres`) | cartes et posts (réseaux, textes, liens, adresses, statut, empreinte validée, origine) |
| `cm_checklists`, `cm_checklist_elements`, `cm_commentaires`, `cm_pieces`, `cm_activite` | détails d'une carte |
| `cm_fichiers` | fichiers de la section (club ou team), stockage privé |
| `cm_clips`, `cm_imports` | clips proposés ; historique des imports Trello |
| `cm_commentaires_vus`, `cm_carte_suivis` (migration 0045) | commentaires lus par compte, cartes suivies |
| `cm_listes.fin`, `cm_cartes.terminee_le` (migration 0050) | colonnes de fin, cartes terminées (date, auteur) |
| `cm_listes.tri` (migration 0052) | tri des cartes de la colonne : `auto` (défaut) ou `manuel` |
| `role_permissions` (migration 0053) | `cm.voir` retiré des rôles « Manager » encore aux permissions CM par défaut |

`envois` est reconstruite (comme en 0017) : usage « cm », `team_id` facultatif, colonne `portee`. Les rôles système
des teams existantes reçoivent `cm.clips.proposer` (et `cm.voir`, `cm.deposer` pour le Manager) ; le module n'est
**pas activé d'office** sur les teams existantes (le preset « Team Valorant complète » l'active pour une nouvelle team).

Tout est dans l'**export / import de la base** (les deux rôles CM système posés par la migration sont remplacés par
ceux de l'export). **RGPD** : l'export d'un compte contient ses rôles CM, ses cartes créées et assignées, ses
commentaires, ses clips et fichiers ; la suppression du compte efface ses affectations et assignations, le retire
des joueurs liés aux posts ; ce qu'il a écrit pour le club reste, sans auteur.

## API (préfixe facultatif `/api/esport`)

| Route | Droit |
| --- | --- |
| `GET /cm/moi` ; `GET /cm/etat` | session |
| `GET\|POST /cm/tableaux` ; `GET\|PATCH\|DELETE /cm/tableaux/:id` (`?archives=1`) | voir ; gerer |
| `GET\|PUT /cm/liens/:id/acces` ; `POST /cm/liens/:id/partage { comptes, niveau? }` ; `POST /cm/liens/:id/vu` ; `GET /cm/liens/acces?team` | créateur, gerer ou Fondateur ; voir le lien (vu) ; editer (options) |
| `GET\|PUT /cm/tableaux/:id/acces` (`{ acces: 'tous' \| 'restreint', regles: [{ genre: 'compte' \| 'role_cm' \| 'role_club' \| 'role_team', cible, niveau: 'voir' \| 'modifier' }] }`) | gerer ou créateur du tableau |
| `POST /cm/tableaux/:id/(listes\|etiquettes\|cartes)` ; `PATCH /cm/listes/:id` ; `POST …/deplacer` ; `PATCH /cm/etiquettes/:id` ; `PUT /cm/tableaux/:id/etiquettes/ordre { ids }` | editer |
| `DELETE /cm/etiquettes/:id` (définitif, rend `{ cartes }`) ; `POST /cm/etiquettes/:id/fusionner { vers }` | gerer |
| `GET\|PATCH\|DELETE /cm/cartes/:id` ; `POST /cm/cartes/:id/deplacer` (`{ listeId, index, tableauId? }`) | voir ; editer (auteur d'un dépôt : titre, description, pièces) |
| `POST /cm/cartes/:id/(soumettre\|publier\|depublier)` ; `…/(valider\|refuser)` | editer ; valider |
| `POST /cm/cartes/:id/(checklists\|commentaires\|pieces)` ; `PATCH\|DELETE /cm/(checklists\|elements\|commentaires)/:id` ; `DELETE /cm/pieces/:id` ; `POST /cm/pieces/:id/lien` | editer (commenter : deposer ou editer) |
| `POST /cm/tableaux/:id/tout-vu` ; `GET /cm/cartes/:id?vu=1` (fiche ouverte : commentaires marqués lus) ; `POST /cm/cartes/:id/suivre { suivre }` | voir (état personnel) |
| `GET /cm/a-valider` ; `GET /cm/calendrier?du&au&reseau` ; `GET /cm/recherche?q` ; `GET /cm/urgences` (cartes critiques et urgentes) ; `GET /cm/terminees?semaines` (cartes terminées par semaine) | voir |
| `PATCH /cm/cartes/:id { urgence }` (`null` ou `"aucune"`, `faible`, `moyen`, `urgent`, `critique`) | editer |
| `PATCH /cm/tableaux/:id { fond }` (fond seul : `null`, `{ genre: 'couleur' \| 'degrade', cle }`, `{ genre: 'image', drive \| envoi }`) | editer |
| `GET /cm/calendrier/teams?du&au` (calendriers des teams, lecture seule) | voir (et droits de chaque team) |
| `GET /cm/preferences` ; `PUT /cm/preferences/:cle { valeur }` (`tableau.<id>.reduites`, `calendrier.teams` ; `null` efface) | voir (ses choix seulement) |
| `GET /cm/teams/:t` ; `POST …/depots` ; `GET …/matchs` ; `GET …/resume?genre&id&prefixe` ; `GET …/membres` | droits de la team |
| `GET\|POST /cm/teams/:t/clips` ; `GET /cm/clips` ; `PATCH\|DELETE /cm/clips/:id` ; `POST …/carte` ; `POST …/lien` | proposer ; voir ; editer |
| `GET\|POST /cm/roles` ; `PATCH\|DELETE /cm/roles/:id` ; `POST …/retablir` ; `GET\|POST /cm/affectations` ; `DELETE …/:id` ; `GET /cm/comptes` ; `GET\|PUT /cm/reglages` ; `GET /cm/journal` | gerer (club) |
| `GET /cm/import/portees` ; `POST /cm/import/trello/apercu` ; `POST /cm/import/trello` | gerer |
| `/cm/portees/:portee/envois…` (envoi par morceaux, portée `club` ou une team) ; `GET /cm/fichiers/:id?c&exp&sig` (lien signé) | editer, deposer ou proposer |

Limites de débit (par compte et par heure) : 20 imports Trello, 30 clips, 30 dépôts.

La migration `0046_cm_tableaux_acces.sql` ajoute `cm_tableaux.acces` (`'tous'` pour tous les tableaux existants),
`cm_tableau_acces` (personnes et rôles d'un tableau restreint, avec leur niveau ; dans l'export / import de la base ;
l'export RGPD d'un compte donne les tableaux où il est cité, la suppression du compte l'en retire) et
`notifications.cm_carte_id` (carte d'une notification personnelle du CM, remplie pour les existantes depuis leur
événement).

La migration `0042_cm_tableaux_fond.sql` ajoute `cm_tableaux.fond` (JSON de la teinte ou du dégradé, ou
`{ genre: 'image' }`) et `cm_tableaux.fond_fichier_id` (fichier CM de l'image), et `cm_preferences` (choix
d'affichage par compte : dans l'export / import de la base et l'export RGPD du compte, effacés avec lui).

La migration `0026_cm_reseaux.sql` ajoute la page **Réseaux** (comptes, annonces, statistiques : tables `cm_rs_*`,
voir [reseaux-stats.md](reseaux-stats.md)). La migration `0027_cm_drive.sql` ajoute le **Drive** (tables `cm_drive_*`,
usage « drive » des envois, permissions du Drive sur les rôles système : voir [drive.md](drive.md)). Les octets d'un
fichier CM peuvent servir à plusieurs endroits (pièce jointe prise dans le Drive, visuel rangé…) : ils ne sont effacés
que quand plus rien ne s'en sert (`esport/noyau/cm/utilisations.mjs`).

## Code et tests

- Serveur : `esport/noyau/cm/` — `commun.mjs` (portées, droits), `reseaux.mjs` et `posts.mjs` (règles pures),
  `tableaux.mjs`, `equipe.mjs`, `clips.mjs`, `droits.mjs`, `trello.mjs` (lecture pure de l'export),
  `importTrello.mjs`, `suggestions.mjs` et `bus.mjs` (abonnés du bus), `calendriers.mjs` (calendriers des teams),
  `acces.mjs` (tableaux restreints : niveaux, tableaux interdits d'un lecteur, condition SQL du journal et du fil),
  `liens.mjs` et `liensAcces.mjs` (DATA › Ressources et ressources restreintes),
  `rgpd.mjs`, `routes.mjs`, `service.mjs`.
- App : `src/esport/cm/` (client, règles des réseaux, phrases, `fonds.ts`), `src/esport/ui/cm/` (EspaceCm, Tableau,
  FicheCarte, Calendrier, Clips, ImportTrello, RolesCm, CmTeam), textes `src/esport/i18n/cm.ts`.
- Tri des cartes : `src/esport/cm/tri.ts` ; tests `src/esport/CmTri.test.tsx` (fonction de tri, option par colonne, libellé, glisser, création en chaîne, temps réel, animation) et `esport/test/cm-tri.test.mjs` (défaut, `PATCH tri`, droits, export / import, migration 0052).
- Tests : `esport/test/cm.test.mjs` (SQLite et PostgreSQL : règles, migration sur base existante, périmètre et
  permissions, tableaux, circuit de validation et invalidation, suggestions, clips, import Trello et entrées
  malformées, RGPD, export / import), `esport/test/cm-commentaires.test.mjs` (SQLite et PostgreSQL : commentaires non lus par compte, vu à l'ouverture, tout lu, permissions, notifications aux bonnes personnes, temps réel, RGPD) et `src/esport/CmCommentairesNonLus.test.tsx` (pastilles carte, colonne, tableau, groupe, tuile), `esport/test/cm-tableaux.test.mjs` (chaque modification d'une carte en
  POST + `X-Methode` relue en base, cartes Trello, suggestions, post validé → « à valider », version 409,
  permissions, fond, préférences, calendriers des teams et périmètre), `esport/test/cm-acces.test.mjs` (tableau
  restreint : rien par chaque route — liste, carte, commentaires, calendrier, recherche, à valider, état, journal,
  notifications, temps réel, lien signé —, « peut voir » sans écriture, retrait immédiat, Fondateur, garde-fous, rôles,
  export / import, RGPD), `src/esport/CmAcces.test.tsx` (menu, cadenas, réglage envoyé), `src/esport/Cm.test.tsx`,
  `src/esport/CmTableauxSaisie.test.tsx` (création en chaîne, collage multi-lignes, ordre des colonnes, clavier, temps réel),
  `src/esport/CmTableaux.test.tsx` (brouillons gardés, conflit, défilement par colonne, colonne réduite, cartes
  compactes, fond, calendriers superposés) et le bout en bout `scripts/e2e-esport-cm-tableaux.mjs` (site construit,
  faux frontal o2switch qui refuse PATCH / PUT / DELETE, captures 1440 × 900 et 390 × 844).

## Pour le Fondateur

1. Mettre à jour le serveur Esport (déploiement automatique o2switch, ou `npm run migrer --prefix esport`) : la
   migration `0023_cm.sql` s'applique seule (puis les suivantes, dont `0042_cm_tableaux_fond.sql` : fond des
   tableaux et choix d'affichage ; `0045_cm_commentaires_non_lus.sql` : commentaires non lus). Publier le site et l'app PC.
2. **Esport › Teams › CM du club › Équipe CM** : affecter le rôle **Responsable CM** au CM du club (portée « Club »), et
   **Correspondant CM** à une personne de chaque team (portée = la team ; elle doit en être membre).
3. Dans chaque team : **Paramètres › Modules › CM** (activé d'office pour une nouvelle team « complète »).
4. Facultatif : **CM › Réglages** (suggestions, hashtags) ; **CM › Import Trello** pour reprendre les tableaux Trello.
5. Facultatif : limiter un tableau à certaines personnes : ouvrir le tableau › menu **⋯** › **Accès au tableau…** ›
   **Restreint**, puis choisir les personnes et les rôles (« peut voir » ou « peut modifier »). Les tableaux existants
   restent ouverts tant que personne ne les restreint.
