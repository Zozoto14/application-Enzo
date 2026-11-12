# Centre de notifications (Esport)

Migration `0038_centre_notifications.sql`. Code serveur : `esport/noyau/notifications/` (`regles.mjs`,
`droits.mjs`, `centre.mjs`, `routes.mjs`). App : `src/esport/notifications/` (API, logique) et
`src/esport/ui/notifications/CentreNotifications.tsx`. Textes FR/EN : `src/esport/i18n/notifications.ts`.

## Où le trouver

- **Cloche** dans l'en-tête de l'app Esport (téléphone comme PC), avec la pastille des non lues. Sur téléphone, la
  barre du bas ne gagne aucune entrée.
- **PC** : entrée « Notifications » dans la barre latérale (sous Dashboard · Teams · Membres…), avec son compteur.
- Plus de carte « Notifications » sur la page **Teams** ni sur l'accueil d'une team : tout est dans le centre.

La page liste tout ce que le rôle du compte permet de voir : icône par catégorie, phrase, team (ou « Club »), auteur,
date relative, regroupement par jour (« Aujourd'hui », « Hier », puis la date), lu / non lu (point à droite :
« Marquer comme lu »), « Tout marquer comme lu », défilement infini (et « Afficher plus »). Un appui marque la
notification lue et mène **à l'endroit même** de l'élément (voir « Liens directs ») ; une ancienne notification sans
lien direct ouvre sa section (page de la team et section, espace CM et onglet, Membres, Devblog, Jeux).

## Visibilité (règle stricte, côté serveur)

Deux sources, unifiées en une liste triée par date :

1. **Le fil** (`notifs_centre`) : une ligne par événement du bus, avec une **catégorie** et une **clé d'accès**
   (`regles.mjs`). La clé est **réévaluée à chaque lecture** avec les rôles du moment (`droits.mjs`, même logique
   que les pages : appartenance → module activé → permission ; section CM ; Sponsors du club). Un rôle retiré ferme
   aussitôt ce qu'il ouvrait (et un rôle donné ouvre l'historique encore conservé).
2. **Les notifications personnelles** (`notifications`, écrites par chaque module : convocation, tâche assignée,
   post validé…). Elles restent visibles de leur destinataire tant qu'il est membre actif de la team concernée (sauf
   « retiré de la team »), qu'il a `sponsors.voir` pour les Sponsors et un accès CM pour le CM / Drive. Quand un
   événement a les deux, **seule la personnelle s'affiche** (pas de doublon).

| Clé d'accès | Qui voit |
| --- | --- |
| `team:p1\|p2` | une des permissions dans la team de l'élément (module activé) ; `team:*` = membre actif |
| `cm:p1\|p2` | permissions CM de la portée (team de l'élément, ou club sans team) |
| `club:p1\|p2` | permissions du club (rôles du club, affectations CM « club », Sponsors) |
| `tous` | tout compte Esport (devblog publié) |
| `fondateur` | le Fondateur seul (défaut d'un type d'événement inconnu) |
| `aucun` | personne (bruit technique : réactions, jetons iCal, commandes du bot…) |

- **Fondateur (CEO)** : tout (sauf `aucun`).
- **Second CEO** (et tout rôle du club avec `teams.acces_total`) : les teams avec les droits du Propriétaire (sauf
  supprimer), et le reste selon ses permissions du club (Sponsors s'il a `sponsors.voir`…).
- **Données sensibles** : notes du staff (`player_notes.view`, jamais le contenu), strats privées (staff :
  `strats.delete`, resserré si une strat devient privée), réunions (`view_all` / `write_summary` ; les résumés
  publiés d'un type « team » aussi pour `view_summary` ; resserré si le type passe « staff »), Sponsors
  (`club:sponsors.voir`), Discord (`discord.manage`).
- La **charge** recopiée ne contient jamais les champs sensibles (`contenu`, `note`, `email`, `url`, `webhook`,
  `jeton`… : `CHAMPS_RETIRES`), textes bornés.
- Les actions du lecteur lui-même ne sont jamais « non lues ».

## Catégories, filtres, préférences

Catégories : `planning` (planning, scrims, convocations, présences), `competition` (matchs et tournois),
`resultats`, `cm` (posts, validations, clips, dépôts, suggestions, visuels, réseaux), `drive`, `sponsors`,
`membres` (membres, rôles, invitations, comptes, trombinoscope, badges, rôles CM et du club), `discord`, `reunions`
(dépôts, résumés, transcriptions), `objectifs` (objectifs et tâches), `jeu` (strats, playbook, review, scouting,
ressources, notes du staff), `devblog`, `systeme` (profils de jeu, IA).

Filtres (`GET /notifications/centre`) : `categories` (liste séparée par des virgules), `team`, `auteur`, `du` / `au`
(AAAA-MM-JJ), `nonLues=1`, `ordre=asc` (défaut : plus récentes d'abord), `suite` (curseur), `limite` (≤ 100).

Préférences **en base, par compte** (`notifs_preferences`) :

- `masquees` : catégories non suivies (absentes de la liste et du compteur ; un filtre explicite les montre) ;
- `silencieuses` : « me notifier » décoché (dans la liste, hors compteur et hors annonce en direct) ;
- `teams` : teams suivies (vide = toutes ; les éléments sans team restent).

## API

| Route | Rôle |
| --- | --- |
| `GET /notifications/centre` | page de la liste (`liste`, `noms`, `suite`, `nonLues`, `teams` filtrables) |
| `GET /notifications/compteur` | `{ nonLues }` (droits et préférences) |
| `POST /notifications/centre/lues` | `{ ids: [...] }` ou `{ tout: true }` → `{ nonLues }` |
| `GET` / `PUT /notifications/preferences` | `{ masquees, silencieuses, teams }` |

Les anciennes routes `GET /notifications` et `POST /notifications/lues` (notifications personnelles seules) restent.

## Temps réel

Serveur : `surNouvelleNotification(fn)` (`notifications/centre.mjs`) appelle
`fn({ compte, id, source: 'fil' | 'perso', categorie, teamId })` une fois par compte concerné, dès qu'un événement
est distribué (droits ET « me notifier » respectés, jamais l'auteur). Rend la fonction de désabonnement. Les
personnelles écrites hors du bus (devblog automatique) ne sont pas annoncées : le compteur les rattrape.

App : `signalerNotifications(nonLues?)` (`src/esport/notifications/api.ts`) prévient la cloche et la page ouverte
(avec le nouveau compteur, ou sans : relecture). En attendant, la cloche relit `GET /notifications/compteur` toutes
les minutes et au retour sur l'onglet.

## Ajouter un événement

1. Le type dans `TYPES_EVENEMENTS` (bus) comme d'habitude.
2. Une entrée dans `REGLES` (`esport/noyau/notifications/regles.mjs`), type exact ou préfixe `xxx.*` / `xxx.yyy_*` :

   ```js
   'drive.ajout': { categorie: 'drive', acces: 'cm:cm.drive.voir|cm.drive.envoyer|cm.drive.gerer', lien: { vue: 'cm', onglet: 'drive' } },
   ```

   Sans entrée, l'événement n'est visible que du Fondateur (catégorie Système).
3. Charge : des champs courts (`titre`, `nom`, `compte`…) ; la phrase vient du journal (`phraseJournal`, app) ou
   du repli du centre (`phraseCentre`). Ne jamais y mettre de contenu privé.

`drive.ajout` (onglet Drive / Visuels) est déjà branché : catégorie Drive, visible des comptes qui voient le Drive
de la portée (team de l'événement, ou club sans team). Charge attendue : `{ nom }` (nom du fichier) ; `team_id` de la
portée ; `entite_type` / `entite_id` du fichier.

## Idempotence, rétention, RGPD, export

- Une ligne du fil par événement (même identifiant, `ON CONFLICT DO NOTHING`) : rejouer un événement ne crée rien.
  L'abonné du centre est le **dernier** de `ABONNES_PAR_DEFAUT`.
- Rétention : **90 jours** (cron, étape « rétention des notifications ») : fil, lectures, notifications personnelles.
- « Tout marquer comme lu » pose `lu_jusqua` ; sans lui, rien d'avant la création du compte n'est « non lu ».
- RGPD : l'export du compte contient `centreNotifications` (préférences, lectures) ; la suppression les efface.
- Export / import de la base : `notifs_centre`, `notifs_lectures`, `notifs_preferences`.

## Tickets Discord

Catégorie **Tickets** (migration 0054, [tickets.md](tickets.md)) : seulement des notifications **personnelles**
(`tk-nouveau`, `tk-assigne`, `tk-message`, `tk-note`, `tk-ferme`), envoyées à ceux qui voient la catégorie du ticket.
Leur catégorie de ticket est gardée (`notifications.ticket_categorie_id`) et **relue à chaque lecture** : un compte qui
ne voit plus cette catégorie ne voit plus ces notifications. Les événements `ticket.*` / `tickets.*` n'entrent jamais
dans le fil commun (règle « aucun »), ni dans le récapitulatif e-mail.

## Liens directs

Migration `0076_notifications_cibles.sql`. Code : `esport/noyau/notifications/cibles.mjs` (serveur),
`src/esport/notifications/cibles.ts` (traduction en écran, adresses), `src/esport/ui/notifications/Cible.tsx`
(`useCible`, `CibleSurlignee`). Tests : `esport/test/notifications-cibles.test.mjs`, `src/esport/NotificationsLiens.test.tsx`.

**Format** : chaque notification porte une **cible** stable et versionnée (colonne `cible`, JSON), jamais une adresse :
`{ "v": 1, "g": "<genre>", ...identifiants }`, par exemple `{"v":1,"g":"carte_cm","carte":"…","commentaire":"…"}`.
Fil : écrite à la création (`abonneCentre`) ; personnelles : calculée à la première lecture (comme la catégorie).
Chaîne vide = pas de cible (notification d'avant la migration, ou section déjà au bon endroit) : le lien de section
(`lien`) reste, comme avant.

**Au clic** (cloche, page Notifications, téléphone compris) : la notification est marquée lue, puis
`POST /notifications/cible { cible }` vérifie avec les rôles du moment que l'élément existe encore et que le compte y a
encore accès, et complète la cible (tableau d'une carte, dossier d'un fichier, team et date d'un événement…) :
`{ etat: 'ok', cible }`, `{ etat: 'supprime' }` (« Cet élément n'existe plus ») ou `{ etat: 'interdit' }` (« Vous n'avez
plus accès à cet élément ») ; dans ces deux cas l'app affiche l'avis et reste où elle est (jamais une page blanche).
Sinon l'app ouvre la bonne team, la bonne section ou le bon sous-onglet, ouvre l'élément (fiche, volet, détail) et met
en avant l'élément visé (défilé jusqu'à lui, cadre accentué quelques secondes).

**Adresses partageables** (web) : `#/app/esport/c/<genre>?<champ>=<valeur>&…` pour un élément (revérifié par le serveur
à l'ouverture), `#/app/esport/v/<écran>[/<team>][/<section>]` pour un écran. L'app tient l'adresse à jour : un
rechargement garde l'endroit ; un lien collé est suivi. Le hub garde ces adresses (`aSousRoute`, liensProfonds.ts).
Les messages Discord qui pointent vers l'app utilisent les mêmes liens (`lienProfond(LIEN_APP, cible)`) : MP de nouveau
ticket et de nouveau message (ticket et message), MP de réunion CM (la réunion), annonces, rappels et relances d'un
événement du planning (l'événement à sa date).

| Genre | Types (événements du bus, notifications personnelles) | Où il mène |
| --- | --- | --- |
| `ticket` | `ticket.*` (sauf corbeille / purge), `tk-nouveau`, `tk-assigne`, `tk-message`, `tk-note`, `tk-ferme` | Tickets : le ticket ouvert, le message mis en avant (`tk-message`) |
| `carte_cm` | `cm.carte_*`, `cm.commentaire_ajoute`, `cm.depot`, `cm.post_*`, `cm-assigne`, `cm-urgence`, `cm-carte-terminee`, `cm-mention`, `cm-commentaire`, `cm-a-valider`, `cm-valide`, `cm-refuse`, `cm-depot` | Espace CM › Tableaux : le tableau, la fiche de la carte, le commentaire mis en avant ; sans espace CM : onglet CM de la team |
| `clip_cm` | `cm.clip_*`, `cm-clip-propose`, `cm-clip-decide` | Espace CM › Clips |
| `lien_cm` | `cm.lien_*` (sauf suppression), `cm-lien-partage` | Espace CM › DATA › Ressources |
| `drive` | `cm.drive_fichier_*`, `cm.drive_version_ajoutee`, `cm.drive_dossier_*`, `cm.drive_restaure`, `drive.ajout` | Drive (club ou team) : le dossier ouvert, le fichier affiché (aperçu et détails) |
| `reunion_cm` | `cm.reunion_*`, `cm-reunion-invite`, `-modifiee`, `-annulee`, `-reponse`, `-rappel` | Espace CM › Réunions : l'agenda au jour de la réunion, le détail ouvert |
| `evenement` | `event.*` (sauf suppression), `attendance.*`, `evenement-nouveau`, `evenement-modifie`, `rappel-rsvp` | Team › Planning : à la date de l'occurrence, l'événement ouvert |
| `tache`, `objectif` | `task.*`, `goal.*`, `tache-assignee`, `tache-echeance` | Team › Objectifs et tâches : la tâche mise en avant |
| `reunion` | `meeting.*` (sauf suppression), `resume-depose`, `resume-publie`, `transcription-*` | Team › Résumés de réunion : le dépôt ouvert |
| `strat`, `playbook` | `strat.*`, `playbook.*`, `playbook-valide` | Team › Strats (la strat ouverte) / Playbook |
| `review` | `review.created`, `.updated`, `.marker_added`, `.comment_added`, `review-nouvelle`, `review-commentaire` | Team › Review vidéo : la review ouverte |
| `ressource` | `resource.*` (sauf suppression), `ressource-*` | Team › Ressources : la ressource ouverte |
| `adversaire` | `opponent.*` (sauf suppression) | Team › Scouting : la fiche de l'adversaire |
| `tournoi`, `resultat` | `tournoi.*`, `match.resultat_*`, `tournoi-inscrit`, `tournoi-termine`, `resultat-saisi` | Team › Tournois / Résultats : la fiche ouverte |
| `membre` | `member.joined`, `.added`, `.role_changed`, `.status_changed`, `trombi.fiche_*`, `trombi.photo_*`, `membre-arrive`, `trombi-modifiee` | Membres › Trombinoscope : la fiche du membre |
| `demande_compte` | `member.account_*`, `demande-compte*` | Membres › Tous les membres (demandes) |
| `sponsor` | `sponsors.prospect_*`, `.partenaire_*`, `.contrat_enregistre`, `.obligation_*`, `.responsable`, `.rappel_*`, `sp-*` | Espace CM › Sponsors |
| `jeu` | `game.created`, `.updated`, `.updates_proposed`, `jeu-maj-proposee` | Administration › Jeux |
| `devblog` | `devblog.publie`, `devblog-auto` | Devblog (publié) ; Administration › Devblog (brouillon de l'éditeur) |
| (section) | réglages et éléments supprimés : `team.*`, `role.*`, `invitation.*`, `discord.*` (Bot, salons, échecs d'envoi), `cm.tableau_*`, `cm.reseau_*`, `roles.*`, `tickets.*`, `bienvenue`, `role-change`, `modules`, `note-partagee`, `cm-releve`… | la section de la règle (`lien`), déjà le bon endroit |

Les types jamais affichés (règle « aucun » : réactions, jetons iCal, commandes du bot…) sont rangés sous `aucune`.

**Ajouter un type** : le ranger sous son genre dans `CIBLES_EVENEMENTS` ou `CIBLES_PERSONNELLES` (`cibles.mjs`) ; les
tests échouent tant qu'un type du bus ou une notification personnelle écrite par un module n'est pas rangé. Un nouveau
genre : l'ajouter aux deux listes `GENRES_CIBLES` (serveur et app, vérifiées identiques), à `verifierCible` (existence et
accès) et à `destinationCible` (écran), puis faire appliquer la cible par l'écran (`useCible`, `CibleSurlignee`).
