# Événements organisés par le club

**Administration › Événements** : les événements et tournois organisés **par le club** (ex. **The Nuke End**, The
Finals 3v3v3v3). Chaque événement a ses équipes participantes, ses inscriptions importées des tickets et **un rôle
Discord par équipe, créé et supprimé automatiquement**, ainsi qu'un hub vocal qui crée le salon de chaque équipe.

Les tournois **extérieurs** auxquels une team participe restent dans la team (Compétition › Tournois,
[tournois-resultats.md](tournois-resultats.md)) : inscription, check-in, bracket, résultats. Une team ne s'occupe ni
des équipes adverses ni des rôles Discord.

Migration : `esport/migrations/0064_evenements_club.sql`. Code : `esport/noyau/evenements-club/` (serveur),
`src/esport/ui/evenements/` (écran). Tests : `esport/test/evenements-club.test.mjs`, `src/esport/Evenements.test.tsx`.

## Site LigneZero

Les équipes des tournois du site **lz.appdashboard.fr** (dépôt `site-ligne-zero`, même hébergement o2switch) se
créent et se gèrent **uniquement ici** : l'admin du site n'a plus de bouton pour créer, renommer ou supprimer une
équipe (il garde la tête de série, le logo, la couleur, les disqualifications et les scores).

- Dans la fiche de l'événement, carte **« Site LigneZero »** : choisir le **tournoi du site** et « Enregistrer le
  lien » (un seul événement par tournoi du site ; « Aucun » retire le lien sans rien supprimer).
- Ensuite, l'app fait foi : une équipe **ajoutée** (à la main ou importée des tickets), **modifiée** (nom, TAG,
  joueurs, coach, remplaçants, Discord ID, Embark ID) ou **retirée** ici l'est aussi sur le site, tout de suite. Une
  différence côté site est écrasée ; une équipe disparue du site y est recréée.
- Au premier lien, les équipes déjà présentes des deux côtés (même nom ou même TAG) sont rapprochées, et celles
  qui n'existent que sur le site (anciennes inscriptions) sont reprises dans l'événement (TAG attribué au besoin).
- Synchronisation aussi toutes les 5 minutes (cron, événements ni terminés ni annulés) et avec « Synchroniser » ;
  bilan affiché (envoyées, mises à jour, reprises, problèmes).
- Accès au site : clé de service lue dans `~/.lignezero/api.env` (`CLE_SERVICE`, créée par le déploiement du
  site), rien à recopier ; autre hébergement : `LZ_API_URL` et `LZ_CLE` dans `esport.env`.
- Code : `esport/noyau/site-lz/` (client de l'API du site, pont). Migration 0070 (`site_tournoi_id`,
  `site_equipe_id`, `site_empreinte`). Tests : `esport/test/site-lz-pont.test.mjs`, `src/esport/Evenements.test.tsx`.

## Salons de match

Pour un événement lié à un tournoi du site, le bot ouvre **un salon texte privé par match** (1v1 ou lobby à plusieurs
équipes, ex. 3v3v3v3) dans la catégorie Discord choisie, y poste tout ce qui compte, et le supprime une fois le match
terminé en gardant son **historique dans l'app**.

- **Réglages** (fiche › carte **« Salons de match »**, `evenements.gerer`) : activer ; **catégorie** Discord (ex.
  « Matchs », sélecteur repliable) ; **nom des salons** (modèle `{round}-{equipes}` par défaut ; variables `{round}`
  → `r1`, `{match}` → `m1` / `l1`, `{equipes}` → TAG des équipes, `{phase}`, `{evenement}` ; nom mis en minuscules,
  sans accents ni espaces, 100 caractères au plus) ; **délai de suppression** après la fin (30 min par défaut, 5 à
  1440) ; **« Rappel 10 min avant »** (activé par défaut) ; **langue** des messages (celle du bot par défaut :
  Tickets › Configuration › Général ; sinon français, anglais, ou les deux) ; **création anticipée** (0 par défaut : dès
  que les équipes du match sont connues ; N : au plus tôt N heures avant l'horaire) ; **rétention des historiques**
  (0 par défaut : jusqu'à la suppression de l'événement ; N : effacés N jours après la suppression du salon) ;
  **« Placer sous le salon »** (facultatif, sélecteur repliable des salons écrits rangés par catégorie).
- **Placer sous le salon** : choisi, les salons de match sont créés dans la **catégorie de ce salon** (le sélecteur de
  catégorie s'efface et affiche celle-ci en lecture seule) puis rangés **juste en dessous**, par horaire (le plus tôt
  d'abord, sans horaire à la fin), en un seul `PATCH /guilds/{g}/channels` des positions qui changent (même calcul que
  « placer sous le hub » des salons vocaux) ; les salons au-dessus du repère ne bougent jamais ; un horaire changé sur le
  site re-trie au passage suivant ; une limite de débit (429) reporte le rangement au passage suivant. Repère supprimé
  sur Discord : les salons sont créés dans la catégorie choisie (sans elle, aucune création), le staff est averti une
  fois dans un salon de match, et le dernier passage l'indique. Sans repère : la catégorie choisie, salons ajoutés à la
  fin.
- **Quand** (quasi temps réel, migration 0079) :
  - **poussée par le site** : chaque modification d'un match, lobby (équipes comprises), phase, résultat, horaire, stream
    ou staff assigné sur le site (déclencheurs de sa base, donc tous les éditeurs de l'admin) envoie un **avis signé** à
    `POST https://esport.appdashboard.fr/site-lz/evenement` (voir « Synchronisation poussée » ci-dessous) ; l'app relit
    alors le tournoi par le pont et traite **d'abord les matchs annoncés**, 2,5 s après le dernier avis (anti-rebond,
    6 s au plus) : l'embed est modifié en quelques secondes ;
  - **relecture** : toutes les **60 s** tant que l'événement est **en cours** (statut, ou dates du jour), par la boucle
    du processus meneur (`evenements-club/boucle-salons.mjs`, bail `salons-match-boucle`), que les tickets, la
    bienvenue ou les salons vocaux soient activés ou non (avant : seulement avec la Gateway, sinon 5 min) ; 15 s quand
    le passage précédent n'a pas tout fait (plafond, limite de débit) ; sinon toutes les 5 minutes (cron, qui réveille
    l'app tant qu'un événement est en cours) ; « Synchroniser maintenant » à la demande. Si un avis se perd, la
    relecture rattrape. Les matchs sont lus sur le site par le pont signé, en **lecture seule** ;
  - la fiche affiche **« Dernière synchro : il y a 4 s (poussée par le site / relecture / depuis l'app) »**, relue
    toutes les 20 s.
- **Création** : match avec au moins deux équipes connues, pas encore terminé (« terminé » = statut `finished` **et** un
  résultat : vainqueur ou score pour un 1v1, au moins un placement ou un abandon pour un lobby ; un lobby marqué terminé
  sans aucun résultat, ancien comportement du bouton « Enregistrer » du site, est traité comme à jouer). Équipes du
  site non reliées à l'événement : listées dans l'embed (« pas de rôle Discord »), sans accès, le salon est créé quand
  même. **Diagnostic** sous « Dernier passage » (et avis de « Synchroniser maintenant ») : matchs 1v1 et lobbies lus
  sur le site, salons déjà suivis, matchs sans salon par raison (terminé, moins de 2 équipes, hors délai de création
  anticipée, salon supprimé, refus Discord, attente, catégorie pleine) avec le détail match par match (20 au plus),
  ou la raison d'un passage qui n'a rien lu (désactivé, non lié, événement terminé). Accès : `@everyone` sans accès ; le
  **rôle Discord de chaque équipe** du match (voir, écrire, historique, fichiers) ; le **rôle staff** de l'événement et
  les **rôles staff supplémentaires** (en plus : gérer les messages) ; le **staff assigné** au match sur le site (accès
  par membre, mêmes droits que le staff) ; le bot. Message d'accueil : mention des rôles des équipes et des
  **capitaines**, embed avec le match (phase, round), l'**horaire** `<t:…:F>` et relatif (ou « à définir »), le statut,
  le stream, et chaque équipe (`[TAG] Nom`, rôle, joueurs mentionnés quand ils sont sur le serveur, capitaine).
- **Équipe sans rôle** (équipe du site pas encore reliée à une équipe de l'événement) : signalée dans l'embed
  (« pas de rôle Discord : n'a pas accès au salon ») et le **staff est averti** dans le salon (une fois).
- **Horaire et staff assigné** : saisis sur le site (Admin › Tournois, sous chaque match et lobby : « Horaire », vide =
  à définir ; « Staff assigné », comptes staff/admin du site avec Discord lié). Le staff assigné est mentionné dans
  l'embed (« Staff assigné ») ; une personne absente du serveur Discord (ou sans Discord lié) y est notée, n'a pas
  d'accès, et le staff de l'événement est averti une fois. Assignation changée sur le site → accès et embed mis à jour,
  message « Mise à jour du match : staff assigné » qui mentionne le nouveau staff (pas les équipes).
- **Mise à jour** : horaire, équipes (composition d'un lobby comprise), phase ou titre (round, poule, nom du lobby),
  lien du stream, statut « en cours » ou staff assigné changés sur le site → l'embed est modifié **tout de suite**, les
  accès suivent les équipes, et un court message « Mise à jour du match : horaire, lien du stream, statut (en cours) »
  mentionne les équipes ; il part **30 s après le premier changement** et regroupe tous ceux de cette fenêtre (un seul
  message pour une série de modifications). Un autre message (rappel, résultat) fait partir la mise à jour en attente
  d'abord. Statut passé à « terminé » : annoncé par le résultat.
- **Rappel** : 10 minutes avant l'horaire, une seule fois (jamais en retard : un salon créé à moins de 10 minutes du
  match ne l'envoie pas ; nouvel horaire : rappel réarmé). Pas de rappel 30 minutes avant.
- **Résultat** saisi sur le site (match terminé) → posté (scores et vainqueur, ou classement du lobby avec points), avec
  l'heure de suppression ; un résultat corrigé est reposté ; un résultat retiré rouvre le salon.
- **Match supprimé ou annulé sur le site** (ex. « Supprimer le déroulé ») → avis dans le salon, suppression après le
  délai. Si le site ne répond pas, rien n'est considéré comme supprimé.
- **Suppression** (délai écoulé, « Supprimer maintenant », fin ou suppression de l'événement) : l'**historique** est
  enregistré (messages, auteurs, dates, embeds du bot en texte, pièces jointes **en liens** : les liens Discord expirent
  au bout d'un moment, le nom du fichier reste), puis le salon est supprimé. Un salon supprimé n'est jamais recréé
  automatiquement (« Créer maintenant » le recrée, l'ancien historique reste).
- **Liste** (même carte) : chaque salon (match, équipes, lien Discord, statut, horaire, suppression programmée) avec
  **Supprimer maintenant** et **Voir l'historique** ; les matchs du site sans salon avec **Créer maintenant** (même si la
  création automatique est coupée ou pas encore due). L'historique est visible avec `evenements.gerer` (le Fondateur
  l'a) ou par une personne du **staff de l'événement** (compte de l'app lié). C'est du contenu de l'événement, pas un
  ticket confidentiel ; il n'est **jamais envoyé à une IA**.
- **Envoi fiable** (migration 0079, table `club_salons_match_envois`) : chaque message du bot (accueil et mentions,
  avertissements du staff, mises à jour, modification de l'embed, rappel, résultat, correction, retrait, avis
  d'annulation, avis de suppression) entre dans une **file persistante** avec une clé stable (salon, genre, version),
  écrite dans la même transaction que l'état qui l'a décidé : un passage interrompu ne perd ni ne double rien. La file
  part **dans l'ordre par salon** ; limite de débit (429), Discord en panne (5xx) ou réseau coupé → nouvel essai après
  5 s, 10 s, 20 s… (10 min au plus, 12 essais) ; un **nonce Discord** (`enforce_nonce`) empêche tout doublon si une
  réponse se perd ; plafond de 40 actions atteint → la suite part au passage suivant (15 s). Refus (403, 50013, 50001) :
  la surcharge du bot est réparée et le message réessayé une fois, puis l'échec est noté avec sa **raison précise** et
  le staff reçoit l'alerte « Salon de match : message refusé… ». Message d'accueil supprimé à la main : reposté à la
  modification suivante. Messages en attente : la suppression du salon les attend (une heure au plus). Messages partis
  effacés de la file après 7 jours.
- **Statut des envois** (liste) : par salon, « messages : 5 envoyé(s), 1 en attente, 1 en échec · accueil : le bot n'a
  pas la permission… » ; total de l'événement ; bouton **« Renvoyer les messages en échec »** (après correction des
  droits sur Discord).
- **Contrôle des accès** : à chaque passage (au plus une fois par minute), les surcharges du salon sont vérifiées : le
  bot (voir, écrire, **intégrer des liens** — sans lui Discord masque les embeds —, fichiers, historique, gérer les
  messages et le salon, mentionner tout le monde s'il en a le droit), les rôles des équipes, le staff, le staff
  assigné, `@everyone` sans accès ; ce qui manque est complété (un `PATCH`, les surcharges ajoutées à la main restent).
  Bot sans « Intégrer des liens » sur le serveur : avertissement dans la fiche et alerte.
- **Mentions** : `allowed_mentions` liste explicitement les rôles et les membres (jamais `@everyone`). Les rôles des
  équipes créés par l'app ne sont pas mentionnables : si le bot n'a pas « Mentionner @everyone, @here et tous les
  rôles », Discord poste le message sans notifier personne ; les **joueurs** de l'équipe (sur le serveur) sont alors
  mentionnés un par un, en plus des capitaines (la fiche le signale).
- **Sûreté** : une ligne par match (clé unique événement + match) et un bail par événement : jamais deux salons pour un
  même match (plusieurs processus, redémarrage) ; un salon créé juste avant un arrêt brutal est retrouvé par son sujet
  (`esport-hq:match:…`). 5 créations et 40 actions Discord au plus par passage, arrêt au premier refus pour limite de
  débit (la suite au passage suivant). Discord limite une catégorie à 50 salons : les matchs suivants attendent.
- **Permissions du bot** : Gérer les salons, Gérer les rôles (accès des salons), Voir les salons, Envoyer des messages,
  **Intégrer des liens** (embeds), Joindre des fichiers, Lire l'historique ; « Gérer les messages » pour la donner au
  staff (sinon le staff écrit sans pouvoir modérer) ; « Mentionner @everyone, @here et tous les rôles » pour que la
  mention d'un rôle d'équipe notifie (sans elle, les joueurs sont mentionnés un par un).
- Code : `esport/noyau/evenements-club/salons-match.mjs`, `boucle-salons.mjs`, `esport/noyau/site-lz/poussee.mjs`,
  `src/esport/ui/evenements/SalonsMatch.tsx`. Migrations 0073 (`club_evenements.salons_match`, table
  `club_salons_match`) et 0079 (file `club_salons_match_envois`, avis `site_lz_pousses`, nonces `site_lz_nonces`).
  Côté site : lecture des matchs, lobbies, résultats et phases, et du staff assigné (vue
  `tournament_match_staff_discord` : nom et Discord ID) ouverte à la clé du pont (`api/serveur/cles.mjs`, migration
  0008 du site) ; avis poussés (`api/serveur/pousse.mjs`, migration 0009 du site). Tests :
  `esport/test/salons-match.test.mjs`, `esport/test/salons-match-fiables.test.mjs`, `src/esport/Evenements.test.tsx`.

### Synchronisation poussée (site → AppDashboard)

- **Adresse** : `POST https://esport.appdashboard.fr/site-lz/evenement` (aussi sous `/api/esport/…`), sans session.
- **Corps** (16 Ko au plus, aucune donnée du site) : `{ "tournoi": "<uuid>", "matchs": ["<uuid>"…], "lobbies": ["<uuid>"…] }`,
  ou `"tout": true` (phase, équipe, joueurs : tout le tournoi).
- **Signature** : même secret que le pont (`CLE_PONT` de `~/.lignezero/api.env`, jamais transmis ; `CLE_PONT_ANCIENNE`
  acceptée pendant une rotation), en-têtes `x-lz-horodatage` (ms), `x-lz-nonce`, `x-lz-signature` = HMAC-SHA256
  base64url de `LZ1\nPOST\n/site-lz/evenement\n<horodatage>\n<nonce>\n<sha256 hex du corps>`. Fenêtre de 5 minutes,
  nonce à usage unique (table `site_lz_nonces`), comparaison en temps constant. Réponses : 200 `{ ok, evenements }`
  (tournoi non lié ou avis inconnu : accepté et ignoré), 401 (en-têtes, horloge, signature, rejeu), 503 (clé absente),
  429 (plus de 600 avis en 10 min par adresse).
- **Côté site** : l'avis part sans ralentir l'enregistrement (file en base, envoi en arrière-plan, 5 s au plus,
  réessais) ; s'il n'arrive pas, la relecture de 60 s rattrape.
- **Ordre de déploiement** : AppDashboard d'abord (l'adresse existe et ignore ce qu'elle ne connaît pas), puis le site.

## Droits

Permission du club **`evenements.gerer`** (« Événements : gérer », catégorie Administration). Le Fondateur l'a
d'office ; la migration la donne au **Second CEO** et à un rôle du club nommé **« CEO »** s'il existe (Administration ›
Rôles et permissions pour la donner ou la retirer). Elle suffit pour tout, actions Discord comprises (création,
attribution, déplacement et suppression des rôles des équipes). Seule exception : **Importer depuis les tickets**
demande en plus de voir les tickets de la catégorie choisie (permissions des Tickets), et **modifier les vocaux de
l'événement** (créer, modifier, retirer un hub) demande en plus **`vocaux.configurer`** (« Salons vocaux :
configurer », les mêmes droits qu'aujourd'hui pour les réglages des salons vocaux) : sans elle, la section s'affiche en
lecture seule. Le Second CEO a les deux ; le rôle « CEO » n'a que la première (à compléter dans Rôles et permissions
s'il doit régler les vocaux).

## Un événement

- **Informations** : nom, jeu (profils de jeu), dates de début et de fin (AAAA-MM-JJ), statut (**À venir**, **En
  cours**, **Terminé**, **Annulé**), description.
- **Inscriptions** : la catégorie de tickets des inscriptions (ex. « Inscription The Nuke End », source de l'import),
  et les **catégories de tickets de l'événement** (plusieurs : inscriptions, support…) traitées par le rôle staff.
- **Rôles Discord** :
  - **Rôles automatiques** (activés par défaut) : un rôle par équipe, donné à ses membres présents sur le serveur ;
  - **nom des rôles** : modèle `{tag} {nom}` par défaut (il doit contenir `{tag}` ou `{nom}`) ; couleur facultative ;
  - **« Placer les nouveaux rôles juste en dessous du rôle… »** : « Lire les rôles du serveur » affiche les rôles dans
    l'ordre de la hiérarchie (le plus haut d'abord, comme dans Paramètres du serveur › Rôles) ; les rôles qui ne sont
    pas **sous le rôle du bot** (« Esport HQ » compris) sont grisés : Discord interdit au bot de placer un rôle
    au-dessus du sien. Le serveur revérifie à l'enregistrement (refus expliqué). Sans choix : tout en bas ;
  - **suppression automatique** N heures après la date de fin (24 par défaut, 0 : jamais par la date).
- **Équipes participantes** : nom, TAG (lettres et chiffres, 6 au plus, unique dans l'événement) et membres (joueur,
  coach, remplaçant ; Discord ID, nom, Embark ID ; case **Capitaine**, un seul par équipe : c'est lui qui reçoit le
  lien du map ban du site — sans capitaine coché, le premier joueur) ; 64 équipes et 10 membres au plus.

## Rôles automatiques

Avec les rôles automatiques, sans autre bouton :

- **Ajouter une équipe** (à la main ou par **Importer depuis les tickets**) : le bot crée aussitôt son rôle (nom du
  modèle, **non mentionnable**, sans permission), le place juste en dessous du rôle choisi, et le donne aux membres
  présents sur le serveur.
- **Modifier une équipe** : nom ou TAG changés, le rôle est **renommé** ; un membre ajouté reçoit le rôle, un membre
  retiré le perd.
- **Retirer une équipe** : son rôle est **supprimé**, ainsi que son salon vocal (hub de l'événement).
- **Modèle ou couleur changés** dans les réglages : les rôles existants suivent ; **rôle repère changé** : ils sont
  replacés.

Après chaque action, l'écran affiche le **bilan** : rôles créés et renommés, attributions, membres **pas trouvés sur
le serveur**, membres **sans Discord ID**, refus de Discord, position. Si Discord refuse (code 50013), le rôle
« Esport HQ » est trop bas : dans Paramètres du serveur › Rôles, glissez-le au-dessus des rôles des équipes (et du rôle
repère).

**Resynchroniser les rôles** refait tout ce qui manque (rôles, noms, attributions, position ; un rôle supprimé à la
main sur Discord est recréé). C'est le bouton à utiliser quand les rôles automatiques sont désactivés, ou après
l'arrivée sur le serveur d'un membre qui en était absent. Sans bot ou sans serveur Discord (Tickets › Configuration ›
Général), les équipes s'enregistrent quand même et l'écran le signale.

Position : les rôles de l'événement sont placés, dans l'ordre des équipes, juste sous le rôle repère, par un seul
`PATCH /guilds/{serveur}/roles` qui ne contient que les rôles dont la position change (tous sous le repère, donc sous
le bot).

## Rôle staff de l'événement

Chaque événement a un **rôle staff** (nom réglable, `Staff {evenement}` par défaut ; `{evenement}` : le nom de
l'événement) créé par le bot dès qu'il y a une personne dans le staff ou une catégorie de tickets de l'événement, et
placé avec le même réglage « juste en dessous du rôle… » (au-dessus des rôles des équipes).

- **Staff de l'événement** (carte de la fiche) : « Chercher » trouve les membres de l'app qui ont lié leur Discord
  (pseudo ou nom Discord), puis les membres du serveur Discord ; **Ajouter** donne le rôle, **Retirer** le retire.
- **Tickets** : le rôle est ajouté aux **rôles du staff** des catégories de tickets de l'événement (Tickets ›
  Configuration › Catégories : les nouveaux tickets lui sont ouverts) et ouvert sur les salons des tickets déjà
  ouverts de ces catégories. Une catégorie retirée de la liste lui est retirée.
- **Vocal** : il voit et rejoint **tous les salons vocaux des équipes** de l'événement **sans rien régler** : il est
  dans les surcharges de chaque salon créé par un hub de l'événement (avec le rôle de l'équipe, les rôles du staff et
  les rôles autorisés du hub) et y reste quand le salon est reverrouillé (recalcul). À chaque synchronisation du rôle
  (créé ou recréé, staff ajouté ou retiré, événement renommé, catégories changées, « Resynchroniser les rôles »), il est
  **réappliqué** aux salons d'équipe déjà ouverts (un `PUT` de surcharge « voir, se connecter » par salon, sans effet
  s'il y est déjà). Inutile donc de l'ajouter aux « Rôles autorisés en plus » d'un hub : la fiche et le Bot Esport HQ
  l'affichent comme une puce **« inclus automatiquement »**.
- **Hub de l'événement** : le staff qui passe par le hub a **son propre salon** (voir « Vocaux de l'événement ») et
  voit le hub caché.
- **Fin** : supprimé avec les rôles des équipes (bouton, cron) et retiré des rôles du staff des catégories de tickets.
- Données : `club_evenement_staff` (Discord ID, nom, compte lié) suit l'export ; RGPD : retiré du staff.

## Rôles staff supplémentaires

Section de la fiche (20 rôles au plus) : des rôles Discord qui ont **exactement les mêmes droits** que le rôle staff
de l'événement : hub de l'événement et salon du staff, surcharges « voir, se connecter » de tous les salons vocaux de
l'événement, rôles qui traitent les tickets des catégories de l'événement, hub caché. Changer la liste resynchronise
les salons ouverts, les surcharges du hub et les catégories de tickets.

- **Créer un rôle staff** : nom (ex. « Casteur The Nuke End »), couleur, libellé, personnes qui le reçoivent (choisies
  dans le staff de l'événement ; modifiables ensuite). Le bot le crée (sans permission, non mentionnable), le place
  avec le réglage « juste en dessous du rôle… » (après le rôle staff) et le donne. Il **appartient à l'événement** :
  supprimé à la fin ou à la suppression, comme le rôle staff.
- **Ajouter un rôle existant** (sélecteur repliable des rôles du serveur, ordre de la hiérarchie, après « Lire les
  rôles du serveur ») : une confirmation s'affiche, « Ce rôle existe déjà sur le serveur : il sera SUPPRIMÉ de Discord à
  la fin de l'événement, pour tous ses membres », avec **Ajouter (supprimé à la fin)**, **Ajouter sans le supprimer**
  ou Annuler. Ensuite, l'interrupteur **« Supprimer ce rôle à la fin de l'événement »** (oui par défaut) reste
  modifiable, avec un rappel rouge tant qu'il est activé.
- **Jamais supprimés** (grisés dans le sélecteur, avec la raison, et refusés par le serveur) : @everyone, rôles gérés
  par une intégration ou un bot, rôles qui donnent **Administrateur**, **Gérer le serveur** ou **Gérer les rôles**,
  rôles **au niveau du bot ou au-dessus**. Le serveur **revérifie** juste avant la suppression : un rôle devenu
  dangereux entre-temps est ignoré (noté au journal, rendu dans le bilan `ignores`).
- **Libellé** de chaque rôle : `{role}` du nom du salon du staff (voir « Vocaux de l'événement ») ; vide, il est dérivé
  du nom (sans le nom de l'événement, les symboles décoratifs, les emoji ni les espaces en trop : « ⟡ Casteur The Nuke
  End ⟡ » → « Casteur ») ; l'exemple s'affiche dans le champ.
- Accès aux tickets : un rôle n'est ajouté à une catégorie que là où il n'y était pas ; ces ajouts sont notés
  (`club_evenements.staff_sup_ajouts`) et seuls eux sont défaits (rôle retiré de la liste, catégorie retirée de
  l'événement, fin ou suppression).
- **Fin ou suppression de l'événement** : accès défaits, puis les rôles marqués « Supprimer ce rôle à la fin de
  l'événement » supprimés de Discord (et retirés de la liste) ; les autres restent sur Discord. La confirmation de
  suppression de l'événement et la carte des équipes (« Supprimer les rôles ») affichent **la liste exacte** des rôles
  supprimés : rôle staff, rôles staff supplémentaires marqués, rôles des équipes (`suppression.roles` de la fiche).
- Données : colonne `club_evenements.staff_roles_sup` (migration 0067), entrées `{ id, nom, label, couleur,
  supprimerFin, cree, membres }` (l'ancienne liste d'identifiants est relue sans suppression à la fin). Route
  `POST /evenements/:id/staff-roles` (créer un rôle staff).


## Import depuis les tickets

Chaque ticket de la catégorie donne une proposition lue dans les réponses du formulaire : nom, TAG, une ligne par
membre « Discord ID — Embark ID » (mention `<@…>`, identifiant seul, `@pseudo` ou Embark ID `nom#1234`, dans n'importe
quel ordre). Un `@pseudo` sans identifiant est cherché parmi les membres du serveur (nom **exact**) ; sinon la ligne
est signalée « sans Discord ID », à corriger. Les membres absents du serveur et les équipes déjà présentes (même
ticket ou même TAG) sont signalés ; on coche celles à ajouter. Les réponses sont lues **dans l'app**, jamais envoyées à
une IA.

## Fin de l'événement

Bouton **Supprimer les rôles** (salons de match — historique gardé —, rôles et salons vocaux des équipes), ou
automatiquement par le cron (5 min) dès que
l'événement passe à **Terminé** ou **Annulé**, ou **N heures après sa date de fin**. Ensuite, plus aucun rôle n'est
créé automatiquement pour cet événement (« Resynchroniser » reste possible tant qu'il n'est ni terminé ni annulé).

## Supprimer un événement

**Supprimer l'événement** (bas de la fiche) relit la fiche puis demande confirmation : « Les hubs vocaux, les salons
d'équipe et les rôles Discord de l'événement seront aussi supprimés », avec le nombre de hubs vocaux retirés et, si ce
sont les seuls hubs du serveur, « les salons vocaux temporaires seront désactivés ». Confirmé, dans l'ordre :

1. **ses hubs vocaux** sont retirés des réglages des salons vocaux (même stockage, journal `tickets.config_modifiee`) ;
   s'il ne reste aucun hub, les salons vocaux temporaires sont désactivés (comme quand on retire le dernier hub) ;
2. le **nettoyage de fin d'événement**, au mieux : salons de match fermés (historique enregistré), salons vocaux des
   équipes supprimés sur Discord, rôles des équipes et
   rôle staff supprimés, rôle staff retiré des rôles du staff des catégories de tickets. Un refus de Discord (ou
   l'absence de bot ou de serveur) **n'empêche pas** la suppression : il est noté dans le journal du serveur
   (`[esport] événement … supprimé : nettoyage Discord incomplet`), l'écran dit de supprimer à la main ce qui reste,
   et le rôle staff est quand même retiré des catégories de tickets ;
3. l'événement, ses équipes, leurs membres, son staff, ses salons de match et leurs historiques.

La réponse de `DELETE /evenements/:id` : `{ ok, hubs, vocauxDesactives, nettoyage: { roles, salons, salonsMatch, echecs, erreur } }`.
La fiche (`GET`) donne `suppression: { hubs, desactiveVocaux }` pour la confirmation.

## Vocaux de l'événement

Section **« Vocaux de l'événement »** de la fiche : les hubs vocaux de l'événement se **créent, se modifient et se
retirent ici, et seulement ici**. Un membre qui a le rôle d'une équipe rejoint le hub ; Esport HQ crée le salon de son
équipe (un par équipe), verrouillé sur son rôle ; les autres sont déconnectés et prévenus en MP.

- Par hub : **salon vocal** (sélecteur repliable, salons rangés par catégorie ; les salons déjà pris par un autre hub ne
  sont pas proposés), **catégorie des salons créés** (celle du hub par défaut), **modèle du nom** (`{tag} — {nom}` par
  défaut), **places par défaut** (0 : illimité), **rôles autorisés en plus** (casters, admins). Le verrouillage est
  implicite (toujours verrouillé).
- **Salon du staff** : le staff (rôle staff, rôles staff supplémentaires, rôles autorisés en plus, rôles du staff des
  salons vocaux) qui passe par le hub a son propre salon, nommé d'après **« Nom du salon du staff »** (`{role} —
  {pseudo}` par défaut, variables `{role}` et `{pseudo}`), verrouillé sur le staff, avec les contrôles habituels ; une
  personne qui a aussi le rôle d'une équipe va dans le salon de son équipe. Les autres sont refusés (MP).
  `{role}` est le **libellé court** du premier rôle qui lui donne l'accès, dans cet ordre de priorité : rôles staff
  supplémentaires (ordre de leur liste), rôle staff de l'événement (« Staff »), rôles autorisés en plus du hub (ordre du
  hub ; libellé réglable à côté de chaque rôle), rôles du staff des salons vocaux (ordre des réglages ; libellé réglable
  dans le Bot Esport HQ). Libellé vide : dérivé du nom du rôle (sans le nom de l'événement ni les symboles ; « Staff »
  s'il ne reste rien). Ex. « Casteur — Léa », « Staff — Zed ». Un hub dont le modèle était l'ancien défaut
  `Staff — {pseudo}` passe au nouveau.
- **Options du hub** (interrupteurs, comme pour les hubs ordinaires : [vocaux.md](vocaux.md#options-de-chaque-hub)) :
  placer les salons créés juste sous le hub (oui), visibles mais pas joignables (non), **cacher le hub** aux personnes
  sans permission (**oui par défaut** : seuls les équipes, le staff et les rôles autorisés le voient).
- Lignes en lecture seule : « Le rôle staff de l'événement « … » a accès automatiquement à tous les vocaux d'équipe »
  (ou qu'il l'aura dès sa création), et chaque salon est verrouillé sur le rôle de son équipe ; sous les rôles
  autorisés, la puce du rôle staff « inclus automatiquement ».
- **Même stockage** que les salons vocaux temporaires (réglage `vocaux`, hubs dont `tournoiId` est l'événement) :
  aucune deuxième source. Les salons vocaux doivent être activés dans le Bot Esport HQ (la section le rappelle) ; retirer
  le dernier hub du serveur les désactive.
- Dans Administration › Bot Esport HQ › Fonctionnalités › Salons vocaux temporaires, ces hubs apparaissent en **ligne
  compacte en lecture seule** « Hub de l'événement X — configuré dans Événements », avec un bouton **Ouvrir
  l'événement** (qui ouvre cette fiche). Il n'y a plus d'option « Hub d'événement » là-bas.
- Droits : lire avec `evenements.gerer` ; modifier avec en plus `vocaux.configurer` (voir « Droits »).

Détails du fonctionnement des salons : [vocaux.md](vocaux.md#hub-vocal-dun-événement).

## Reprise de l'étape précédente (migration 0063)

Les équipes notées dans la fiche d'un tournoi d'une team (ex. The Nuke End créé dans The Final LZ0) deviennent un
événement du club au **même identifiant**, avec leurs équipes, membres et rôles déjà créés ; les hubs vocaux liés et les
salons d'équipe ouverts continuent de fonctionner. Les anciennes tables (`tournoi_discord`, `tournoi_equipes`,
`tournoi_equipe_membres`) sont supprimées ; un export de la base fait avant la mise à jour est repris de la même façon à
l'import. Le tournoi de la team reste dans la team (il peut être supprimé ou gardé : il ne porte plus de rôles).

## API

Routes (`evenements.gerer`, 403 sinon) :

| Route | Rôle |
|---|---|
| `GET /evenements`, `POST /evenements` | Liste ; créer |
| `GET /evenements/roles-serveur` | Rôles du serveur Discord (hiérarchie, `utilisable` : sous le bot) |
| `GET`, `PATCH`, `DELETE /evenements/:id` | Fiche (`suppression` : ce que la suppression emporte) ; modifier (réglages Discord compris) ; supprimer (hubs vocaux, salons d'équipe, rôles : au mieux) |
| `POST /evenements/:id/equipes` | Ajouter des équipes `{ equipes: [...] }` (rôles automatiques) |
| `PATCH`, `DELETE /evenements/:id/equipes/:e` | Modifier ; retirer (rôle et salon supprimés) |
| `GET /evenements/staff-candidats?q=` | Personnes proposées pour le staff (app avec Discord lié, puis serveur) |
| `POST /evenements/:id/staff-roles` | Créer un rôle staff `{ nom, couleur?, label?, membres? }` (appartient à l'événement, supprimé à la fin) |
| `POST /evenements/:id/staff`, `DELETE /evenements/:id/staff/:s` | Ajouter au staff (rôle donné) ; retirer (rôle retiré) |
| `GET`, `POST /evenements/:id/vocaux` | Hubs vocaux de l'événement (`staffRole`, `peutModifier`, `autresHubs`) ; ajouter un hub (+ `vocaux.configurer`) |
| `PATCH`, `DELETE /evenements/:id/vocaux/:hub` | Modifier ; retirer un hub de l'événement (+ `vocaux.configurer` ; 404 si le hub n'est pas lié à l'événement) |
| `POST /evenements/:id/import` | Propositions lues dans les tickets `{ categorieId }` |
| `POST /evenements/:id/roles` | Resynchroniser les rôles (bilan) |
| `POST /evenements/:id/roles/supprimer` | Supprimer les rôles et les salons des équipes |
| `GET`, `PUT /evenements/:id/salons-match` | Salons de match : réglages, catégories du serveur, salons, matchs du site sans salon, dernier passage ; enregistrer les réglages |
| `POST /evenements/:id/salons-match/synchro` | Synchroniser maintenant |
| `POST /evenements/:id/salons-match/creer` | Créer maintenant `{ cle }` (`m:<id>` match, `l:<id>` lobby) |
| `POST /evenements/:id/salons-match/:s/supprimer` | Supprimer maintenant (historique enregistré) |
| `GET /evenements/:id/salons-match/:s/historique` | Historique (`evenements.gerer` ou staff de l'événement) |
| `GET /evenements/:id/salons-match/etat` | État léger : dernier passage (origine, heure), envois par salon |
| `POST /evenements/:id/salons-match/renvoyer` | Renvoyer les messages en échec (`renvoyes`) |
| `POST /site-lz/evenement` | Avis signé du site (synchronisation poussée, sans session) |

## Données

`club_evenements`, `club_evenement_equipes`, `club_evenement_membres`, `club_evenement_staff`, `club_salons_match` et
`club_salons_match_envois` suivent l'export de la base (Administration). RGPD : l'effacement d'un compte (par son Discord
ID) retire la personne des équipes et du staff des événements, efface les historiques de salons de match où elle a écrit
et les messages de la file qui la mentionnent.
