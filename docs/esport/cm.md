# Esport : section CM (community manager)

La section CM prépare la communication du club sur les réseaux (**X, Instagram, TikTok** pour l'instant) :
idées, posts à préparer, à **valider**, puis à **publier à la main** (aucune connexion aux réseaux : les textes
se copient, les médias se téléchargent). Elle a deux niveaux :

- l'**espace CM du club** (carte **CM du club** en tête de la page **Teams** de l'Esport, sur PC comme sur téléphone ;
  ce n'est plus une entrée de la navigation principale), tenu par le CM commun ;
- la **partie CM de chaque team** (module `cm`, onglet **CM** dans la section **Équipe**), où le correspondant de
  la team dépose les informations et où les joueurs proposent leurs clips.

Visuels (charte, modèles, éditeur, génération d'affiches) : [visuels.md](visuels.md). Comptes des réseaux, annonce
Discord des posts publiés et statistiques (onglet **Réseaux**) : [reseaux-stats.md](reseaux-stats.md). **Drive**
(dossiers et fichiers du club et des teams, versions, corbeille, dépôt des joueurs) : [drive.md](drive.md). **Réunions**
de l'équipe CM (agenda, disponibilités, rendez-vous, notes confidentielles ; permissions `cm.reunions.voir` et
`cm.reunions.gerer`) : [cm-reunions.md](cm-reunions.md).

Migrations : `esport/migrations/0023_cm.sql` (+ `0029_cm_etiquettes.sql`, étiquettes modifiables ; `0042_cm_tableaux_fond.sql`, fond des tableaux et choix d'affichage par compte). Code : `esport/noyau/cm/`, `src/esport/cm/`, `src/esport/ui/cm/`.

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
   le Manager voit la partie CM et y dépose. Le Propriétaire a ces trois permissions. **Éditer, valider et gérer ne
   viennent jamais d'un rôle de team** : la validation reste au Fondateur et au Responsable CM.

Le **Fondateur** a tout. Anti-escalade : hors Fondateur, on n'ajoute à un rôle CM, et on n'attribue, que des
permissions que l'on a soi-même (403 `escalade`) ; le nom et la couleur d'un rôle système sont fixes.

3. **Rôles du club** (migration 0033, **Esport › Membres › Rôles et permissions**, [roles-permissions.md](roles-permissions.md)) :
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

## Tableaux façon Trello

- **Mise en page** (comme le Trello de la CM) : les colonnes sont **côte à côte** et le **tableau défile
  horizontalement** ; il prend la **hauteur de la fenêtre** qui reste sous son en-tête (la page ne défile pas) et
  **chaque colonne a sa propre barre de défilement vertical**. En-tête de colonne **fixe** : nom, **nombre de
  cartes**, bouton **réduire** (→←) et menu **⋯** ; **« + Ajouter une carte »** reste **en bas** de la colonne. Une
  colonne **réduite** devient une **bande verticale** (nom vertical, nombre de cartes ; un clic l'agrandit) ; le
  choix est **mémorisé par compte** (`cm_preferences`, clé `tableau.<id>.reduites`). Téléphone : **une colonne par
  écran**, balayage latéral (le bas de l'écran reste à la barre de navigation).
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
- **Recherche et filtres** : texte, étiquettes, membres, échéance (en retard, 7 jours, sans), posts / cartes ;
  recherche dans tous les tableaux (titre et description). **Archives** affichables.
- **Grands tableaux** : sept requêtes par tableau quelle que soit sa taille ; 60 cartes affichées par liste, puis
  « Afficher plus » ; 10 000 cartes au plus par tableau.
- **Mises à jour des autres** : chaque écriture augmente la `version` du tableau ; l'app relit `GET /cm/etat`
  (quelques octets) toutes les 12 s quand la page est visible et recharge le tableau s'il a changé. Pas de
  websocket ni de connexion ouverte (hébergement mutualisé o2switch).

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
   **liens**, couvertures de couleur.

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

Notifications : carte assignée, @mention dans un commentaire, post à valider (et à valider de nouveau après une
modification), post validé ou refusé (auteur et membres de la carte), dépôt d'une team (CM du club), clip proposé (CM
de la team), décision sur un clip (proposeur), rôle CM reçu, Drive rempli à 80 % (gestionnaires du Drive).

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
| `POST /cm/tableaux/:id/(listes\|etiquettes\|cartes)` ; `PATCH /cm/listes/:id` ; `POST …/deplacer` ; `PATCH /cm/etiquettes/:id` ; `PUT /cm/tableaux/:id/etiquettes/ordre { ids }` | editer |
| `DELETE /cm/etiquettes/:id` (définitif, rend `{ cartes }`) ; `POST /cm/etiquettes/:id/fusionner { vers }` | gerer |
| `GET\|PATCH\|DELETE /cm/cartes/:id` ; `POST /cm/cartes/:id/deplacer` (`{ listeId, index, tableauId? }`) | voir ; editer (auteur d'un dépôt : titre, description, pièces) |
| `POST /cm/cartes/:id/(soumettre\|publier\|depublier)` ; `…/(valider\|refuser)` | editer ; valider |
| `POST /cm/cartes/:id/(checklists\|commentaires\|pieces)` ; `PATCH\|DELETE /cm/(checklists\|elements\|commentaires)/:id` ; `DELETE /cm/pieces/:id` ; `POST /cm/pieces/:id/lien` | editer (commenter : deposer ou editer) |
| `GET /cm/a-valider` ; `GET /cm/calendrier?du&au&reseau` ; `GET /cm/recherche?q` | voir |
| `PATCH /cm/tableaux/:id { fond }` (fond seul : `null`, `{ genre: 'couleur' \| 'degrade', cle }`, `{ genre: 'image', drive \| envoi }`) | editer |
| `GET /cm/calendrier/teams?du&au` (calendriers des teams, lecture seule) | voir (et droits de chaque team) |
| `GET /cm/preferences` ; `PUT /cm/preferences/:cle { valeur }` (`tableau.<id>.reduites`, `calendrier.teams` ; `null` efface) | voir (ses choix seulement) |
| `GET /cm/teams/:t` ; `POST …/depots` ; `GET …/matchs` ; `GET …/resume?genre&id&prefixe` ; `GET …/membres` | droits de la team |
| `GET\|POST /cm/teams/:t/clips` ; `GET /cm/clips` ; `PATCH\|DELETE /cm/clips/:id` ; `POST …/carte` ; `POST …/lien` | proposer ; voir ; editer |
| `GET\|POST /cm/roles` ; `PATCH\|DELETE /cm/roles/:id` ; `POST …/retablir` ; `GET\|POST /cm/affectations` ; `DELETE …/:id` ; `GET /cm/comptes` ; `GET\|PUT /cm/reglages` ; `GET /cm/journal` | gerer (club) |
| `GET /cm/import/portees` ; `POST /cm/import/trello/apercu` ; `POST /cm/import/trello` | gerer |
| `/cm/portees/:portee/envois…` (envoi par morceaux, portée `club` ou une team) ; `GET /cm/fichiers/:id?c&exp&sig` (lien signé) | editer, deposer ou proposer |

Limites de débit (par compte et par heure) : 20 imports Trello, 30 clips, 30 dépôts.

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
  `rgpd.mjs`, `routes.mjs`, `service.mjs`.
- App : `src/esport/cm/` (client, règles des réseaux, phrases, `fonds.ts`), `src/esport/ui/cm/` (EspaceCm, Tableau,
  FicheCarte, Calendrier, Clips, ImportTrello, RolesCm, CmTeam), textes `src/esport/i18n/cm.ts`.
- Tests : `esport/test/cm.test.mjs` (SQLite et PostgreSQL : règles, migration sur base existante, périmètre et
  permissions, tableaux, circuit de validation et invalidation, suggestions, clips, import Trello et entrées
  malformées, RGPD, export / import), `esport/test/cm-tableaux.test.mjs` (chaque modification d'une carte en
  POST + `X-Methode` relue en base, cartes Trello, suggestions, post validé → « à valider », version 409,
  permissions, fond, préférences, calendriers des teams et périmètre), `src/esport/Cm.test.tsx`,
  `src/esport/CmTableaux.test.tsx` (brouillons gardés, conflit, défilement par colonne, colonne réduite, cartes
  compactes, fond, calendriers superposés) et le bout en bout `scripts/e2e-esport-cm-tableaux.mjs` (site construit,
  faux frontal o2switch qui refuse PATCH / PUT / DELETE, captures 1440 × 900 et 390 × 844).

## Pour le Fondateur

1. Mettre à jour le serveur Esport (déploiement automatique o2switch, ou `npm run migrer --prefix esport`) : la
   migration `0023_cm.sql` s'applique seule (puis les suivantes, dont `0042_cm_tableaux_fond.sql` : fond des
   tableaux et choix d'affichage). Publier le site et l'app PC.
2. **Esport › Teams › CM du club › Équipe CM** : affecter le rôle **Responsable CM** au CM du club (portée « Club »), et
   **Correspondant CM** à une personne de chaque team (portée = la team ; elle doit en être membre).
3. Dans chaque team : **Paramètres › Modules › CM** (activé d'office pour une nouvelle team « complète »).
4. Facultatif : **CM › Réglages** (suggestions, hashtags) ; **CM › Import Trello** pour reprendre les tableaux Trello.
