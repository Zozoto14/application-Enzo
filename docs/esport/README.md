# Esport : guide d'utilisation

L'Esport est l'espace des teams (Valorant d'abord) dans l'app : planning, disponibilités, présence, résumés de
réunions, objectifs et tâches, review vidéo, scouting, strats et playbook, canal de ressources, tournois et résultats, notifications Discord, journal. Ce guide
explique simplement comment s'en servir, d'abord pour le **Fondateur**, puis pour les **joueurs**.

## Sommaire de la documentation Esport

| Document | Pour qui | Contenu |
| --- | --- | --- |
| [README.md](README.md) (ce guide) | Tout le monde | Utilisation, rôles, vos données, limites connues |
| [invitations.md](invitations.md) | Fondateur, staff | Inviter un joueur (création de compte depuis l'Esport), page Membres |
| [deploiement.md](deploiement.md) | Fondateur | Activer le serveur Esport (o2switch), ajouter un joueur |
| [planning.md](planning.md) | Tout le monde | Planning, disponibilités, présence, agenda iCal |
| [resumes.md](resumes.md) | Tout le monde | Déposer une réunion (fichier ou lien), transcription automatique en PDF, boîte du rédacteur |
| [transcription.md](transcription.md) | Fondateur, responsables | Qualité de la transcription : whisper.cpp, qualités, vocabulaire de la team, relecture par l'IA |
| [objectifs-taches.md](objectifs-taches.md) | Tout le monde | Objectifs, tâches, kanban |
| [suivi-joueurs.md](suivi-joueurs.md) | Staff, Fondateur | Suivi joueurs : notes du staff, partage, RGPD |
| [bot-discord.md](bot-discord.md) | Fondateur, tout le monde | Bot Discord : activation, commandes, pings des convoqués, /lier |
| [discord.md](discord.md) | Propriétaire, Manager | Webhook (repli sans bot), messages, sécurité |
| [review-video.md](review-video.md) | Coach, Analyste, joueurs | Review YouTube, repères, export |
| [videos.md](videos.md) | Coach, Analyste, Fondateur | Vidéos déposées sur le site, lecteur maison, formats, espace utilisé |
| [scouting.md](scouting.md) | Staff | Fiches adversaires, VODs |
| [strats-playbook.md](strats-playbook.md) | Coach, Analyste, joueurs | Éditeur de strats, partage, playbook, licences Riot |
| [ressources.md](ressources.md) | Tout le monde | Canal de ressources : liens, vidéos YouTube, fichiers, notes ; catégories, propositions, Discord |
| [profils-jeu.md](profils-jeu.md) | Fondateur | Profils de jeu (formats, score, maps, personnages), assistant IA, mises à jour proposées |
| [tournois-resultats.md](tournois-resultats.md) | Staff, tout le monde | Tournois (inscription, roster, parcours, matchs au planning, classement) et résultats (score selon le jeu, bilans, Discord) |
| [cm.md](cm.md) | Fondateur, CM, correspondants, joueurs | Section CM : tableaux façon Trello, posts FR / EN par réseau, validation, calendrier, clips des joueurs, dépôts des teams, import Trello |
| [visuels.md](visuels.md) | Fondateur, CM | Visuels de la section CM : charte graphique (thème cyberpunk), modèles d'affiches par défaut (4 formats, FR / EN), éditeur, génération PNG / JPEG jointe aux posts |
| [reseaux-stats.md](reseaux-stats.md) | Fondateur, CM | Page Réseaux du CM : comptes du club et des teams, annonce Discord des posts publiés (anglais + fil français), statistiques des posts, vidéos et comptes (relevés datés, engagement, tableaux de bord, import / export CSV) |
| [drive.md](drive.md) | Fondateur, CM | Drive du CM : dossiers et fichiers du club et des teams, envoi multiple et glisser-déposer, versions, corbeille (30 jours), recherche, aperçus, ZIP, quota, dépôt des joueurs, pièces jointes et images prises dans le Drive |
| [cm-reunions.md](cm-reunions.md) | Fondateur, CM | Réunions de l'équipe CM « comme Teams » : agenda jour / semaine / mois, réponses, disponibilités et statut de chacun, « Trouver un créneau » (fuseaux, absences, réunions), rendez-vous réservables, notes confidentielles et tâches de suivi, rappels in-app et MP Discord, iCal |
| [trombinoscope.md](trombinoscope.md) | Fondateur, CM, staff, joueurs | Trombinoscope (Membres, premier onglet) : fiches des joueurs (photo, teams et jeu, postes, elo, palmarès saisi et calculé, anciennes structures, réseaux pro), visibilité par champ, texte d'annonce FR / EN, RGPD |
| [sponsors.md](sponsors.md) | Fondateur, Responsable CM | Sponsors & partenaires (rubrique du CM) : pipeline des prospects, partenaires, contrats et contreparties, tableau de bord, import / export CSV, RGPD des contacts |
| [tickets.md](tickets.md) | Fondateur, staff du support | Tickets Discord : salons privés ouverts par un panneau ou /ticket, formulaires, réponses depuis l'app, transcripts, notes de satisfaction, fermeture automatique ; tout se configure dans la page Tickets |
| [roles-permissions.md](roles-permissions.md) | Fondateur | Page Administration › Rôles et permissions : rôles du club (Second CEO…), rôles CM, rôles des teams et modèle des nouvelles teams, matrice par catégories, garde-fous, journal |
| [devblog.md](devblog.md) | Fondateur, tous les membres | Devblog : notes de mise à jour FR / EN, fenêtre « Nouveautés » à l'entrée (une fois par compte), historique (bouton « Nouveautés » du Dashboard), éditeur avec aperçus et IA, publication Discord (anglais + fil français, @here) |
| [notifications.md](notifications.md) | Tous les membres, Fondateur | Centre de notifications : cloche et compteur dans l'en-tête, toutes les notifications que votre rôle permet de voir (le Fondateur voit tout), filtres, préférences par compte, temps réel, ajout d'un événement |
| [statistiques.md](statistiques.md) | Fondateur | Page Statistiques (réservée au Fondateur) : qui utilise l'app, pages les plus et les moins utilisées, ce qui est collecté |
| [securite.md](securite.md) | Fondateur | Revue de sécurité, RGPD, limites |
| [migration-serveur.md](migration-serveur.md) | Fondateur | Architecture du serveur, changer d'hébergeur, sauvegardes |

## Les trois pages de l'Esport

En ouvrant la tuile **Esport**, trois pages de premier niveau, avant d'entrer dans une team. Sur PC et iPad
paysage, elles sont dans la **barre latérale** à gauche ; sur iPhone, dans la **barre d'onglets en bas** :

| Page | Pour quoi faire |
| --- | --- |
| **Dashboard** (ouvre par défaut) | Résumé de toutes vos teams. En haut, quatre chiffres clés (teams, événements des 7 jours, résumés à rédiger ou tâches en retard, alertes), puis la semaine à venir (toutes teams) et les alertes (tâches en retard, résumé en attente depuis plus de 7 jours, présence faible, invités pas encore connectés). Puis une carte par team : membres, présence des 14 derniers jours, résumés en attente, tâches en retard, prochains événements, dernière activité. Touchez une carte pour ouvrir la team. |
| **Teams** | Vos teams, création d'une team (Fondateur), votre profil Esport (les notifications sont dans le centre : cloche de l'en-tête) ; **Ressources** (Fondateur) : publier une même ressource dans plusieurs teams d'un coup. |
| **Membres** | Tous les membres des teams dont vous voyez les membres (le Fondateur : aussi les comptes du hub qui ont l'Esport sans être dans aucune team, voir plus bas) : filtres (team, rôle, statut invité / actif / suspendu / sans team), recherche, création de compte (Fondateur), **demandes de compte** (badge « Demandes en attente » du Fondateur ; « Proposer un membre » avec la permission « Créer des membres »), ajout à une team, rôle, suspension, retrait, invitations. Voir [invitations.md](invitations.md). |
| **Teams › CM du club** (selon vos droits CM, Drive ou Sponsors) | Carte en tête de la page **Teams** (PC et téléphone ; ce n'est plus une entrée de la navigation principale, l'entrée « Teams » reste surlignée) : section CM du club — tableaux de contenus façon Trello, posts X / Instagram / TikTok en français et en anglais, file « À valider », calendrier éditorial, clips proposés par les joueurs, visuels, réseaux, **Drive** (bouton direct sur la carte), Sponsors ; pour le gestionnaire : équipe et rôles CM, import Trello, réglages. Voir [cm.md](cm.md). |
| **Administration** (au moins une des permissions ci-dessous) | Une seule entrée de la navigation (barre latérale et barre du bas) pour l'administration du club, en sous-onglets, chacun selon sa permission (le serveur contrôle chaque requête) : **Tickets** (Fondateur, `tickets.voir` ou `tickets.configurer` : tickets Discord, leurs statistiques et leur configuration, [tickets.md](tickets.md)) · **Statistiques** (Fondateur, `statistiques.voir` : statistiques d'usage, [statistiques.md](statistiques.md)) · **Jeux** (Fondateur, `jeux.gerer` : profils de jeu, assistant IA, Administration de l'IA, [profils-jeu.md](profils-jeu.md)) · **Rôles et permissions** (Fondateur, `roles.gerer`, [roles-permissions.md](roles-permissions.md)) · **Devblog** (Fondateur, `devblog.gerer` : brouillons, éditeur, publication automatique ; la lecture reste pour tous via « Nouveautés » du Dashboard, [devblog.md](devblog.md)). Pastille rouge sur l'entrée et sur « Tickets » : tickets ouverts avec du nouveau pour vous (catégories que vous voyez), en temps réel. Les anciens liens (Tickets, Statistiques, Jeux, Membres › Rôles et permissions, notifications comprises) mènent au bon sous-onglet. |

Chaque bloc du Dashboard n'apparaît que si le module est activé dans la team **et** que votre rôle
permet de le voir (un Joueur ne voit pas la présence de toute l'équipe ni le détail du journal). Le
serveur ne renvoie jamais rien d'une team où vous n'êtes pas.

### Dans une team : six sections

Les modules activés sont rangés en six sections ; une section n'apparaît que si elle contient au moins un
module ouvert à votre rôle, et chaque section n'affiche que ses modules activés (en sous-onglets) :

```
Esport
├── Dashboard
├── Teams
│   └── <une team>
│       ├── Accueil      prochains événements (réponse en un appui), derniers résumés, tâches en retard,
│       │                l'équipe, notifications, statistiques
│       ├── Agenda       Planning · Disponibilités · Présence
│       ├── Jeu          Strats · Playbook · Ressources · Review vidéo · Scouting
│       ├── Compétition  Tournois · Résultats
│       ├── Équipe       Résumés · Objectifs et tâches · Suivi joueurs · CM · Membres et rôles
│       └── Réglages     Paramètres · Discord · Journal
├── Membres             Trombinoscope (par défaut, voir trombinoscope.md) · Tous les membres · Rôles et permissions (Fondateur, voir roles-permissions.md)
├── CM                   (section CM du club, voir cm.md ; onglets Visuels, voir visuels.md, Réunions, voir cm-reunions.md, Drive, voir drive.md, Réseaux, voir reseaux-stats.md, et Sponsors, voir sponsors.md)
├── Jeux                 (profils de jeu et assistant IA, voir profils-jeu.md)
└── Statistiques         (Fondateur seulement : statistiques d'usage, voir statistiques.md)
```

- **PC et iPad paysage** : sous Dashboard · Teams · Membres, la barre latérale montre la team ouverte (logo ou
  initiales sur sa couleur, nom, votre rôle), le bouton **⇄ Changer de team** et les six sections. En haut de la
  page, un fil d'Ariane (**Teams › Faucons Valorant › Agenda**) ramène à la liste des teams, puis les
  sous-onglets de la section.
- **iPhone** : en-tête **‹ Teams**, logo et nom de la team, **⇄** pour changer de team, sous-onglets juste
  dessous ; les six sections dans la barre d'onglets en bas.
- Chaque section se souvient du dernier sous-onglet ouvert. En changeant de team, vous restez sur la même section
  si elle existe dans l'autre team.
- Sur chaque page : une seule action principale, à droite du titre (**+ Nouvel événement**, **+ Nouvelle strat**,
  **+ Nouvelle tâche**…). Les actions secondaires (exports CSV, dupliquer, ajouter au playbook, lien de partage,
  supprimer) sont dans le menu **⋯**. Les filtres du planning, des strats et du playbook se replient derrière un
  bouton **Filtres** qui résume ceux qui sont actifs.
- Sur PC, les formulaires longs (nouvel événement, détail d'un événement, nouvelle tâche, nouvel objectif)
  s'ouvrent dans un **volet à droite** : la page reste visible derrière (Échap ou le voile le referment). Sur
  iPhone, ils prennent tout l'écran.

Captures avant et après la refonte de la navigation : [`docs/captures-esport-refonte/`](../captures-esport-refonte/).
Le système visuel (espacements, typographie, cartes, badges, états vides, en-tête de page, sous-onglets, volet
latéral) est dans `src/esport/ui/design.tsx`, le cadre de navigation dans `src/esport/ui/CadreEsport.tsx`.

Inviter quelqu'un : **Membres › Créer un compte** ([invitations.md](invitations.md)). Il n'y a plus de
code d'invitation.

## Les rôles en deux minutes

Chaque membre a **un rôle par team** (on peut être Coach dans une team et Joueur dans une autre) :

| Rôle | Ce qu'il fait |
| --- | --- |
| **Propriétaire** | Tout, y compris supprimer la team et choisir ses modules |
| **Manager** | Membres, rôles, invitations, planning, résumés, Discord, journal |
| **Coach** | Planning, présence, review, strats, playbook, scouting, objectifs, ressources, tournois, résultats |
| **Analyste** | Review, strats, playbook, scouting, saisie des résultats ; lit le planning et les tournois |
| **Joueur** | Lit la team (tournois et résultats compris), donne ses disponibilités, répond aux événements où il est convoqué, dépose des réunions, commente les reviews |
| **Remplaçant** | Lecture limitée |

Le Propriétaire et le Manager peuvent créer des **rôles personnalisés** (Membres et rôles › Rôles) ; personne ne
peut donner une permission qu'il n'a pas lui-même. Le Propriétaire peut donner au rôle **Joueur** (ou à un rôle
personnalisé) la permission **« Créer des membres »** : ses membres proposent alors de nouveaux comptes, que le
Fondateur valide en un clic ([invitations.md](invitations.md)). Le **Fondateur** (vous, le propriétaire de l'app) a tous les
droits partout.

### Modifier un rôle existant

**Team › Équipe › Membres et rôles**, bloc **Rôles et permissions** : choisissez le rôle, puis :

- **rôle personnalisé** › **Modifier** : nom, couleur et permissions ;
- **rôle système** (Manager, Coach, Analyste, Joueur, Remplaçant) › **Modifier les permissions** : les cases de la
  matrice (modules × voir, créer, modifier, supprimer, spéciales). Le changement ne vaut que pour **cette team** (chaque
  team a sa propre copie des rôles système). Un rôle système modifié porte une `*` dans la liste et le bouton
  **Rétablir les permissions par défaut** (permissions du catalogue) ;
- le **Propriétaire** est verrouillé : il a toujours toutes les permissions.

Pendant l'édition, chaque case changée est **surlignée** et le nombre de changements non enregistrés s'affiche ;
**Annuler** les défait, **Enregistrer** les envoie (avec une confirmation pour un rôle système). L'effet est
immédiat : les membres qui ont ce rôle voient la différence à leur prochaine action (le serveur relit les
permissions à chaque requête, il n'y a pas de cache). Le Journal note « X a modifié les permissions du rôle Y :
ajout de … ; retrait de … » (ou « a rétabli les permissions par défaut… »). Rien ne part sur Discord (l'annonce
« Changement de rôle » concerne le rôle d'un membre, pas les permissions d'un rôle).

Garde-fous, appliqués par le serveur :

| Règle | Refus |
| --- | --- |
| Il faut la permission **Gérer les rôles** (`roles.manage`) | 403 `permission` |
| Le rôle Propriétaire ne se modifie pas (ni ne se « rétablit ») | 403 `role-verrouille` |
| Hors Propriétaire et Fondateur, on ne modifie qu'un rôle placé **sous** le sien (un Manager ne touche ni au Propriétaire ni au Manager) | 403 `role-superieur` |
| Anti-escalade : on n'**ajoute** qu'une permission que l'on a soi-même (retirer reste possible) | 403 `escalade` |
| La team garde toujours au moins un membre actif capable de gérer les rôles | 409 `dernier-gestionnaire` |
| Nom et couleur d'un rôle système : fixes | 403 `role-systeme` |

API : `PATCH /teams/:id/roles/:roleId` (`{ nom?, couleur?, permissions? }`) et
`POST /teams/:id/roles/:roleId/retablir`. La liste des rôles indique pour un rôle système `permissionsParDefaut`
et `modifie`. Aucune migration : les rôles système sont, depuis la phase 1, des lignes propres à chaque team
(`roles`, `role_permissions`).

## Pour le Fondateur

### Mettre l'Esport en route (une fois)

Suivez [deploiement.md](deploiement.md). Les mises à jour s'installent toutes seules (déploiement automatique
du serveur o2switch, [docs/o2switch.md](../o2switch.md)) : il applique les migrations `0007_finitions.sql` (index et limites de débit),
`0008_invitations_directes.sql` (invitation directe) et `0009_convocations_demandes.sql` (convocations
explicites, demandes de compte). La migration `0017_ressources.sql` ajoute le canal de ressources : activez le
module **Ressources** dans les Paramètres des teams existantes ([ressources.md](ressources.md)). La migration
`0018_statistiques_usage.sql` ajoute la page **Statistiques** ([statistiques.md](statistiques.md)) : rien à régler.
La migration `0021_profils_jeu.sql` ajoute les **profils de jeu** (Valorant préconfiguré, teams existantes rattachées) ;
l'assistant IA est facultatif ([profils-jeu.md](profils-jeu.md), [o2switch.md partie I](../o2switch.md)).
La migration `0022_tournois_resultats.sql` ajoute les modules **Tournois** et **Résultats** (section Compétition) :
activez-les dans les Paramètres des teams concernées ([tournois-resultats.md](tournois-resultats.md)).
La migration `0023_cm.sql` ajoute la **section CM** : affectez le Responsable CM et les correspondants (**Esport › Teams › CM du club ›
Équipe CM**) et activez le module **CM** dans les teams existantes ([cm.md](cm.md)).
La migration `0024_sponsors.sql` ajoute la rubrique **Sponsors** du CM, ouverte par défaut au Responsable CM
(permissions `sponsors.voir` / `sponsors.gerer`, modifiables dans **Esport › Teams › CM du club › Équipe CM**) ([sponsors.md](sponsors.md)).
La migration `0026_cm_reseaux.sql` ajoute la page **Réseaux** du CM : enregistrez les comptes du club, réglez
l'annonce Discord de chacun (**Esport › Teams › CM du club › Réseaux**) ([reseaux-stats.md](reseaux-stats.md)).
La migration `0027_cm_drive.sql` ajoute le **Drive** du CM (club et teams), ouvert par défaut au Responsable CM (tout)
et aux correspondants (leur team) ; les joueurs n'y voient que le dossier « Dépôt joueurs » ; espace réglable par
`ESPORT_DRIVE_QUOTA` ([drive.md](drive.md)).
La migration `0030_trombinoscope.sql` ajoute le **Trombinoscope** (Membres) : le staff des teams et les rôles CM le
voient par défaut, chaque joueur complète sa fiche depuis « Mon profil » ([trombinoscope.md](trombinoscope.md)).
La migration `0033_roles_globaux.sql` ajoute les **rôles du club** et la page **Administration › Rôles et permissions**
(Fondateur) : donnez le rôle « Second CEO » à votre adjoint depuis la section Club de cette page
([roles-permissions.md](roles-permissions.md)).

### Créer une team

1. Hub › tuile **Esport** › choisissez votre pseudo (la première fois).
2. **Créer une team** : nom, **jeu (obligatoire)** et preset (« Team Valorant complète », « Minimal » ou
   « Personnalisé »), puis les modules. Le jeu est un **profil de jeu** configuré avant dans **Esport › Administration › Jeux** (formats,
   score, maps, personnages… ; Valorant est préconfiguré) : voir [profils-jeu.md](profils-jeu.md). Vous pourrez activer
   ou désactiver un module plus tard sans rien perdre (Paramètres de la team).

### Inviter un joueur

Plus de code à transmettre :

1. **Esport › Membres › Créer un compte** (sur votre appareil, où vous êtes connecté en Fondateur) : nom ou
   pseudo, adresse e-mail, team(s) et rôle par team, poste en jeu (facultatif) ; confirmez votre identité.
2. Le compte « Esport seulement » est créé dans l'Administration et le joueur est déjà dans sa team (statut
   **Invité**). **Envoyer l'invitation par e-mail** ouvre votre messagerie, message prêt.
3. Le joueur ouvre le lien, choisit son mot de passe, et retrouve sa team dans l'Esport (statut **Actif**).

**Comptes créés dans l'Administration** (avant les invitations directes, ou sans passer par l'Esport) : tout
compte du hub qui a l'Esport parmi ses apps apparaît dans **Membres**, même s'il n'a jamais ouvert l'Esport,
avec les pastilles **Jamais connecté** et **Sans team** (filtre **Sans team** ; l'en-tête compte « X comptes,
dont Y sans team »). **Le compte › Ajouter à une team** (team, rôle, pseudo Esport) le pré-enregistre côté
serveur, comme une invitation directe : il voit sa team dès sa prochaine ouverture de l'Esport, sans code ni
écran de pseudo. Cette liste est lue sur l'appareil du Fondateur (annuaire du hub) ; un Manager garde
l'annuaire du serveur.

Relancer ou révoquer une invitation : **Membres** › le compte. Un Manager ajoute à ses teams un compte qui existe
déjà (**Membres** › le compte › **Ajouter à une team**). Supprimer un compte dans l'Administration le retire aussi
de l'Esport. Détails : [invitations.md](invitations.md).

### Gérer la team au quotidien

- **Convocations** : à chaque événement (planning, réunions…), choisissez les **Convoqués** (raccourcis Joueurs,
  Staff, Tout le monde, ou personne par personne) et, à part, les **Propriétaires à convoquer**. Sans choix : les
  joueurs. Vous n'êtes convoqué (réponse attendue, rappels, statistiques) que si vous vous cochez ; vous voyez
  quand même tout le calendrier, et le filtre **« Où je suis convoqué »** n'affiche que vos convocations.
  Détails : [planning.md](planning.md).
- **Membres et rôles** : changer un rôle, suspendre (le membre ne voit plus la team), retirer.
- **Journal** : qui a fait quoi. Filtres par module, type d'action, membre et période ; **Exporter (CSV)** ;
  **Durée de conservation** (1 an par défaut ; de 30 jours à 2 ans, ou illimitée) : les entrées plus anciennes
  s'effacent automatiquement.
- **Accueil › Statistiques de la team** : présence (taux par joueur), tâches faites et en retard, réunions
  déposées, activité, sur 7, 30 ou 90 jours.
- **Résumés** : la boîte de réception rassemble les dépôts de toutes vos teams ; déposez le PDF du résumé, le
  joueur est prévenu.

### Demandes RGPD d'un joueur

Un joueur peut tout faire seul (voir plus bas). S'il vous le demande : **Membres et rôles** › touchez le joueur ›
**Exporter ses données** (fichier JSON) ou **Supprimer son compte Esport** (confirmation demandée). La suppression
efface son profil, ses disponibilités, présences et notifications dans toutes les teams ; ce qu'il a écrit pour la
team (réunions, commentaires, strats) reste, marqué « Compte supprimé ». Le dernier Propriétaire d'une team doit
d'abord nommer un successeur.

## Pour les joueurs

### Premier passage

Ouvrez le lien d'invitation reçu par e-mail, choisissez votre mot de passe, puis **Esport** : votre pseudo et votre
team sont déjà là (Dashboard et Teams), aucun code à saisir. Riot ID et Discord se renseignent dans votre profil
(Teams › Mon profil), facultatifs.

### Ce que vous faites le plus souvent

- **Accueil** : prochains événements (répondez **Oui / Non / Peut-être** en un geste, même sur iPhone ; prévenez
  d'un retard ou donnez le motif d'une absence si vous voulez), **Mon profil de joueur** (votre présence sur 30 jours
  et les notes que le staff a partagées avec vous), tâches en retard, derniers résumés, notifications.
- **Présence** : « Mes réponses » et « Ma présence » (votre taux, votre ponctualité, vos dernières séances).
- **Disponibilités** : vos créneaux habituels par jour, et les exceptions (vacances, soirée prise).
- **Résumés** : déposez le lien de l'enregistrement d'une réunion ; vous verrez quand le résumé PDF est prêt.
- **Objectifs et tâches** : « Mes tâches », faites-les avancer (À faire › En cours › Fait).
- **Review vidéo** : regardez la VOD, ajoutez un repère à l'instant courant (touche **M** sur ordinateur), commentez.
- **Strats et Playbook** : consultez les strats de la team (lecture seule sur iPhone).
- **Ressources** (section Jeu) : guides, vidéos de pros, lineups, outils… publiés par le staff ; réagissez,
  commentez, gardez vos favoris ; si la team l'ouvre, proposez les vôtres (validées par le staff). Voir
  [ressources.md](ressources.md).

Exports possibles selon votre rôle : agenda (iCal), présence, tâches et objectifs (CSV), notes de review (PDF ou
Markdown), strats (PNG), journal (CSV).

### Vos données

Les données Esport sont gardées **en clair** sur le serveur Esport (hébergé en France chez o2switch), pas
chiffrées de bout en bout comme le reste de l'app. Jamais d'adresse e-mail. L'app envoie aussi des **statistiques d'usage internes**, visibles par
l'administrateur (le Fondateur) : pages ouvertes et durées, actions clés, type d'appareil, langue, erreurs techniques ;
jamais de contenu ni d'adresse IP, aucun traceur tiers ([statistiques.md](statistiques.md)). **Paramètres de la team › Mon profil
Esport** : modifier votre profil, **Exporter mes données** (JSON) ou **Supprimer mes données Esport**. Membre
mineur : l'accord d'un représentant légal est nécessaire.

## Langues : français et English

L'Esport est disponible en **français** et en **English** (écrans, messages d'erreur, journal, notifications,
e-mail d'invitation, en-têtes des exports CSV). Le reste du hub reste en français.

- **Choisir sa langue** : à la création du profil, puis **Mon profil Esport › Langue**. Le changement est
  immédiat, sans recharger. Le choix est enregistré sur le compte Esport (le bot Discord et les notifications le
  connaissent). Par défaut : la langue de l'appareil si elle est l'anglais, sinon le français.
- **Discord** : les messages publics suivent la **langue de la team** (Réglages › Discord), les réponses du bot la
  langue du compte lié, sinon la locale Discord. Voir [le bot Discord](bot-discord.md).
- **Ce qui n'est pas traduit** : ce que les gens saisissent (titres, notes, noms de rôles ou de types créés par la
  team), la page publique de partage d'une strat et les agendas iCal.
- **Développeurs** : dictionnaires typés `src/esport/i18n/fr.ts` et `en.ts` (TypeScript refuse une clé manquante en
  anglais), fonctions `tr()` / `trn()` (pluriels) et dates via `Intl`. Le test `src/esport/i18n/chaines.test.ts`
  échoue si une chaîne française en dur apparaît dans un composant. Test de bout en bout :
  `scripts/e2e-esport-anglais.mjs`.

## Accessibilité

Les 8 thèmes du hub respectent les contrastes AA (texte, texte atténué, états, boutons ; l'encre des initiales de
team est choisie, noire ou blanche, pour le contraste). Sur téléphone, les onglets, sections, sous-onglets,
boutons, cases, choix, filtres et menus font au moins 44 px, et aucune page ne défile horizontalement.
Les sections et sous-onglets sont des onglets annoncés (« sélectionné ») et s'ouvrent au clavier (Tab, Entrée). Tout se fait au clavier sur ordinateur (Tab, Entrée, Espace ; « M »
dans la review) ; les boutons, onglets, choix et barres de statistiques ont un libellé lu par VoiceOver et les
lecteurs d'écran.

## Limites connues

- **Une heure de grâce** : un compte révoqué dans l'Administration garde l'Esport ouvert jusqu'à la fin de sa
  session (une heure au plus).
- **Pas de dessin précis sur la vidéo YouTube** : les notes sont liées à un instant (et une durée), pas à une zone
  de l'image.
- **Strats** : édition sur PC et iPad (site), lecture seule sur iPhone ; images Riot chargées depuis
  valorant-api.com (voir la politique Riot dans [strats-playbook.md](strats-playbook.md)).
- **Statistiques** : la présence compte les **convoqués** ; une séance sans marquage compte « non marqué » et
  n'entre pas dans le taux. Marquer la présence enregistre à chaque appui.
- **Hors ligne** : l'Esport a besoin du serveur ; sans réseau, il affiche un message et le reste de l'app marche.
- **Discord** : notifications par webhook (pas de bot ni de commandes) ; un message envoyé ne se retire pas.
- **Fichiers** : PDF de 20 Mo au plus ; pas d'antivirus (type, taille et contenu vérifiés).
- **Sauvegardes** : sauvegardes cPanel / JetBackup d'o2switch (base et fichiers) ; export JSON à la demande
  (voir [migration-serveur.md](migration-serveur.md)).
- Le **journal** garde l'identifiant technique (sans pseudo) d'un compte supprimé jusqu'à la fin de sa durée de
  conservation.
