# Esport : guide d'utilisation

L'Esport est l'espace des teams (Valorant d'abord) dans l'app : planning, disponibilités, présence, résumés de
réunions, objectifs et tâches, review vidéo, scouting, strats et playbook, notifications Discord, journal. Ce guide
explique simplement comment s'en servir, d'abord pour le **Fondateur**, puis pour les **joueurs**.

## Sommaire de la documentation Esport

| Document | Pour qui | Contenu |
| --- | --- | --- |
| [README.md](README.md) (ce guide) | Tout le monde | Utilisation, rôles, vos données, limites connues |
| [invitations.md](invitations.md) | Fondateur, staff | Inviter un joueur (création de compte depuis l'Esport), page Membres |
| [deploiement.md](deploiement.md) | Fondateur | Activer le serveur Esport (Cloudflare + GitHub), ajouter un joueur |
| [planning.md](planning.md) | Tout le monde | Planning, disponibilités, présence, agenda iCal |
| [resumes.md](resumes.md) | Tout le monde | Déposer une réunion, boîte du rédacteur, PDF |
| [objectifs-taches.md](objectifs-taches.md) | Tout le monde | Objectifs, tâches, kanban |
| [discord.md](discord.md) | Propriétaire, Manager | Webhook, messages, sécurité |
| [review-video.md](review-video.md) | Coach, Analyste, joueurs | Review YouTube, repères, export |
| [scouting.md](scouting.md) | Staff | Fiches adversaires, VODs |
| [strats-playbook.md](strats-playbook.md) | Coach, Analyste, joueurs | Éditeur de strats, partage, playbook, licences Riot |
| [securite.md](securite.md) | Fondateur | Revue de sécurité, RGPD, limites |
| [migration-serveur.md](migration-serveur.md) | Fondateur | Quitter Cloudflare pour un vrai serveur, sauvegardes |

## Les trois pages de l'Esport

En ouvrant la tuile **Esport**, trois pages de premier niveau, avant d'entrer dans une team :

| Page | Pour quoi faire |
| --- | --- |
| **Dashboard** (ouvre par défaut) | Résumé de toutes vos teams. En haut : résumés à rédiger, événements de la semaine (toutes teams), alertes (tâches en retard, résumé en attente depuis plus de 7 jours, présence faible, invités pas encore connectés). Puis une carte par team : membres, présence des 14 derniers jours, résumés en attente, tâches en retard, prochains événements, dernière activité. Touchez une carte pour ouvrir la team. |
| **Teams** | Vos teams, création d'une team (Fondateur), notifications, votre profil Esport. |
| **Membres** | Tous les membres des teams dont vous voyez les membres : filtres (team, rôle, statut invité / actif / suspendu), recherche, création de compte (Fondateur), ajout à une team, rôle, suspension, retrait, invitations. Voir [invitations.md](invitations.md). |

Chaque bloc du Dashboard n'apparaît que si le module est activé dans la team **et** que votre rôle
permet de le voir (un Joueur ne voit pas la présence de toute l'équipe ni le détail du journal). Le
serveur ne renvoie jamais rien d'une team où vous n'êtes pas.

Dans une team, la barre latérale garde ses modules (planning, disponibilités, présence, résumés,
objectifs et tâches, review, scouting, strats, playbook, Discord, membres et rôles, journal, paramètres).

Inviter quelqu'un : **Membres › Créer un compte** ([invitations.md](invitations.md)). Il n'y a plus de
code d'invitation.

## Les rôles en deux minutes

Chaque membre a **un rôle par team** (on peut être Coach dans une team et Joueur dans une autre) :

| Rôle | Ce qu'il fait |
| --- | --- |
| **Propriétaire** | Tout, y compris supprimer la team et choisir ses modules |
| **Manager** | Membres, rôles, invitations, planning, résumés, Discord, journal |
| **Coach** | Planning, présence, review, strats, playbook, scouting, objectifs |
| **Analyste** | Review, strats, playbook, scouting ; lit le planning |
| **Joueur** | Lit la team, donne ses disponibilités, répond aux événements, dépose des réunions, commente les reviews |
| **Remplaçant** | Lecture limitée |

Le Propriétaire et le Manager peuvent créer des **rôles personnalisés** (Membres et rôles › Rôles) ; personne ne
peut donner une permission qu'il n'a pas lui-même. Le **Fondateur** (vous, le propriétaire de l'app) a tous les
droits partout.

## Pour le Fondateur

### Mettre l'Esport en route (une fois)

Suivez [deploiement.md](deploiement.md) (10 minutes depuis le navigateur). Pour cette version, relancez simplement
le workflow **« Esport (Worker) »** : il applique les migrations `0007_finitions.sql` (index et limites de débit)
et `0008_invitations_directes.sql` (invitation directe).

### Créer une team

1. Hub › tuile **Esport** › choisissez votre pseudo (la première fois).
2. **Créer une team** : nom, jeu et preset (« Team Valorant complète », « Minimal » ou « Personnalisé »), puis les
   modules. Vous pourrez activer ou désactiver un module plus tard sans rien perdre (Paramètres de la team).

### Inviter un joueur

Plus de code à transmettre :

1. **Esport › Membres › Créer un compte** (sur votre appareil, où vous êtes connecté en Fondateur) : nom ou
   pseudo, adresse e-mail, team(s) et rôle par team, poste en jeu (facultatif) ; confirmez votre identité.
2. Le compte « Esport seulement » est créé dans l'Administration et le joueur est déjà dans sa team (statut
   **Invité**). **Envoyer l'invitation par e-mail** ouvre votre messagerie, message prêt.
3. Le joueur ouvre le lien, choisit son mot de passe, et retrouve sa team dans l'Esport (statut **Actif**).

Relancer ou révoquer une invitation : **Membres** › le compte. Un Manager ajoute à ses teams un compte qui existe
déjà (**Membres** › le compte › **Ajouter à une team**). Supprimer un compte dans l'Administration le retire aussi
de l'Esport. Détails : [invitations.md](invitations.md).

### Gérer la team au quotidien

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

- **Accueil** : prochains événements (répondez **Oui / Non / Peut-être** en un geste, même sur iPhone), tâches en
  retard, derniers résumés, notifications.
- **Disponibilités** : vos créneaux habituels par jour, et les exceptions (vacances, soirée prise).
- **Résumés** : déposez le lien de l'enregistrement d'une réunion ; vous verrez quand le résumé PDF est prêt.
- **Objectifs et tâches** : « Mes tâches », faites-les avancer (À faire › En cours › Fait).
- **Review vidéo** : regardez la VOD, ajoutez un repère à l'instant courant (touche **M** sur ordinateur), commentez.
- **Strats et Playbook** : consultez les strats de la team (lecture seule sur iPhone).

Exports possibles selon votre rôle : agenda (iCal), présence, tâches et objectifs (CSV), notes de review (PDF ou
Markdown), strats (PNG), journal (CSV).

### Vos données

Les données Esport sont gardées **en clair** sur le serveur Esport (chiffrées au repos par Cloudflare), pas
chiffrées de bout en bout comme le reste de l'app. Jamais d'adresse e-mail. **Paramètres de la team › Mon profil
Esport** : modifier votre profil, **Exporter mes données** (JSON) ou **Supprimer mes données Esport**. Membre
mineur : l'accord d'un représentant légal est nécessaire.

## Accessibilité

Les 8 thèmes du hub respectent les contrastes AA (texte, texte atténué, états, boutons). Sur téléphone, les onglets,
boutons, cases et choix font au moins 44 px. Tout se fait au clavier sur ordinateur (Tab, Entrée, Espace ; « M »
dans la review) ; les boutons, onglets, choix et barres de statistiques ont un libellé lu par VoiceOver et les
lecteurs d'écran.

## Limites connues

- **Une heure de grâce** : un compte révoqué dans l'Administration garde l'Esport ouvert jusqu'à la fin de sa
  session (une heure au plus).
- **Pas de dessin précis sur la vidéo YouTube** : les notes sont liées à un instant (et une durée), pas à une zone
  de l'image.
- **Strats** : édition sur PC et iPad (site), lecture seule sur iPhone ; images Riot chargées depuis
  valorant-api.com (voir la politique Riot dans [strats-playbook.md](strats-playbook.md)).
- **Statistiques** : la présence compte les séances **marquées** par le staff ; une séance sans marquage n'entre pas
  dans le taux.
- **Hors ligne** : l'Esport a besoin du serveur ; sans réseau, il affiche un message et le reste de l'app marche.
- **Discord** : notifications par webhook (pas de bot ni de commandes) ; un message envoyé ne se retire pas.
- **Fichiers** : PDF de 20 Mo au plus ; pas d'antivirus (type, taille et contenu vérifiés).
- **Sauvegardes** : Time Travel de D1 (30 jours) tant que l'Esport est sur Cloudflare ; prévoir un export régulier
  (voir [migration-serveur.md](migration-serveur.md)).
- Le **journal** garde l'identifiant technique (sans pseudo) d'un compte supprimé jusqu'à la fin de sa durée de
  conservation.
