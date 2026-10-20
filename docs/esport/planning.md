# Esport : planning, disponibilités et présence (phase 2)

Trois modules de team, activables séparément : **Planning** (`planning`), **Disponibilités** (`availability`)
et **Présence** (`attendance`). Rien à déployer à la main : relancer le workflow « Esport (Worker) » applique
la migration `esport/migrations/0002_planning.sql` et le cron existant (toutes les 15 minutes) envoie les
rappels.

## Ce que voit chacun

| Rôle (système) | Planning | Disponibilités | Présence |
| --- | --- | --- | --- |
| Propriétaire, Manager | tout (créer, modifier, supprimer) | les siennes + heatmap ; réglages (effectif minimum, rappel) | répondre, marquer, statistiques de la team, CSV |
| Coach | tout | les siennes + heatmap ; « Proposer un événement » | répondre, marquer, statistiques, CSV |
| Analyste | lecture | les siennes + heatmap | répondre, ses statistiques |
| Joueur | lecture | les siennes + heatmap | répondre (RSVP), ses statistiques |
| Remplaçant / Invité | lecture | les siennes | répondre, ses statistiques |

Les boutons n'apparaissent que si le rôle le permet, mais c'est le serveur qui décide : un appel direct sans
la permission reçoit **403**, une team dont on n'est pas membre **404**, un module désactivé **404**.
Contrôles dans l'ordre : session → appartenance → module → permission (`esport/noyau/planning/service.mjs`).

La migration 0002 ajoute aux rôles système **déjà créés** : `availability.view_all` (Joueur, Analyste) et
`availability.edit_own` (Remplaçant). Les rôles personnalisés ne changent pas.

## Planning

- Vues **mois**, **semaine**, **liste** ; filtres par type, par membre convoqué et **« Où je suis convoqué »**
  (`membre=moi`) ; navigation par période.
- Types et couleurs : Entraînement (bleu), Scrim (violet), Match (rouge), Tournoi (ambre), Réunion (cyan), Autre (gris).
- Champs : type, titre, date, début, fin (une fin avant le début tombe le lendemain), lieu ou lien,
  description, **convoqués** (voir ci-dessous), `adversaireId` (facultatif, pour le scouting de la phase 5) et
  `reviewId` (phase 5).
## Convocations (migration 0009)

Chaque événement a sa liste **explicite** de convoqués. Dans le formulaire (planning, réunions, tous les types) :

- raccourcis **Joueurs** (Joueur et Remplaçant), **Staff** (Coach, Analyste, Manager), **Tout le monde** (tous
  les membres actifs **sauf** les Propriétaires), et un choix **personne par personne** (décocher quelqu'un d'un
  groupe l'en exclut) ;
- une liste à part **Propriétaires à convoquer** : un Propriétaire (et le Fondateur) n'est **jamais** convoqué
  sans être coché ;
- **aucun choix** : les joueurs seulement.

Un rôle personnalisé compte dans le Staff s'il marque la présence ou crée au planning, sinon dans les Joueurs s'il
répond aux convocations (RSVP) ; sinon il n'est convoqué que par « Tout le monde » ou nommément.

**Partout, seuls les convoqués** :

| Surface | Effet |
| --- | --- |
| RSVP | boutons Oui / Peut-être / Non ; un non-convoqué reçoit **403** (`non-concerne`) |
| Réponses attendues | `reponses.attendues` de la liste, alertes « sans réponse » et « à marquer » de l'accueil |
| Rappels | in-app (cron `attendance.reminder`) et Discord J-1 / H-1 : la variable `{convoques}` nomme les convoqués ; pas de rappel Discord sans convoqué. Discord n'autorise ici qu'une mention de **rôle** (pas de mention par personne, faute d'identifiant Discord des membres) : la mention configurée reste celle de la team |
| Notifications | nouvel événement, modifié, annulé : les convoqués qui voient le planning |
| Liste de présence | les convoqués de l'occurrence ; marquer un non-convoqué : **400** (`non-convoque`) |
| Statistiques et CSV | les convoqués (voir Présence) |
| Accueil de la team, Dashboard | « mes prochains événements », alertes, compteur « Événements (7 jours) » et semaine à venir |

Un Propriétaire non convoqué **voit** toujours l'événement au calendrier de la team (il en a le droit ; le détail
affiche « Vous n'êtes pas convoqué »), mais il n'est ni attendu, ni relancé, ni compté.

**Stockage : une règle, pas une liste figée.** `convocation` (JSON) =
`{ groupes, membres, exclus, proprietaires }` ; les groupes sont résolus à la lecture. Conséquence voulue : un
joueur **ajouté plus tard** à la team est convoqué par la règle « joueurs » aux occurrences qui se terminent
**après** son arrivée (`membres.rejoint_le`) — séries récurrentes comprises — mais pas aux séances passées
(ses statistiques ne se remplissent pas de « non marqué » d'avant lui). Un choix nominatif vaut toujours.

**Récurrence** : chaque occurrence garde la convocation de la série ; **Modifier cette date** peut lui donner sa
propre liste (`planning_exceptions.convocation`, « liste propre à cette date » ; `convocation: null` la rend à la
série). Changer l'horaire ou la règle de la série efface, comme avant, les exceptions.

**Migration** (`0009_convocations_demandes.sql`) : un événement existant « toute la team » (`concernes = '[]'`)
devient « Tout le monde » = tous les membres actifs **sauf** les Propriétaires ; une liste nominative est gardée
(un Propriétaire qui y figurait avait été choisi). L'ancienne colonne `concernes` reste écrite (choix nominatifs)
pour les anciennes lectures ; l'API accepte encore `concernes: [...]` (liste nominative) à la création.

Code : `esport/noyau/planning/convocations.mjs` (règles pures, serveur) et `src/esport/planning/convocations.ts`
(sélecteur de l'app) ; tests `esport/test/convocations.test.mjs`, e2e `scripts/e2e-esport-convocations.mjs`.

## Récurrence et iCal

- **Récurrence hebdomadaire** : jours de la semaine, toutes les 1 à 4 semaines, fin par date ou par nombre.
  La règle est stockée (`recurrence`, JSON), les occurrences sont calculées. Chaque occurrence est désignée
  par l'instant UTC de son début d'origine (sa « clé »).
  - **Cette date** : modifier (titre, lieu, horaire, déplacement de 30 jours au plus) ou annuler → exception
    (`planning_exceptions`).
  - **Cette date et les suivantes** : la série s'arrête la veille.
  - **Toute la série** : modifier (changer l'horaire ou la règle efface les exceptions) ou supprimer
    (suppression logique : présences et journal restent).
- **iCal** : « Exporter (.ics) » (fichier) ou « Créer un lien d'abonnement » : URL privée
  `https://applibourse-esport…/ical/ical_….ics` (jeton aléatoire, seule son empreinte est stockée, montré
  une fois). Révocable dans la même carte ; le lien cesse aussi de marcher si son titulaire quitte la team,
  perd la permission ou si le module est désactivé. Sur iPhone : remplacer `https:` par `webcal:`.

## Fuseaux horaires

- Les **instants** sont stockés en UTC (ISO 8601) : début et fin d'un événement, exceptions datées.
- Les **heures murales récurrentes** (« tous les mardis à 20:00 », « libre le lundi 19:00–23:00 ») sont
  gardées avec leur fuseau et converties en UTC **date par date** : 20:00 à Paris reste 20:00 à Paris de part
  et d'autre du changement d'heure (18:00 UTC l'été, 19:00 UTC l'hiver). Une heure qui n'existe pas (02:30 le
  jour du passage à l'heure d'été) est décalée d'une heure ; une heure ambiguë (passage à l'heure d'hiver)
  prend la première.
- Affichage : fuseau de la team par défaut (Paramètres › Planning), ou celui de l'appareil (« Mon heure »).
  Le serveur rend, pour chaque occurrence, sa date et ses heures dans le fuseau demandé.

## Disponibilités

- **Mes créneaux** par jour de la semaine (disponible ou indisponible) et **exceptions datées**
  (prioritaires : une absence ponctuelle retire le créneau, une disponibilité ponctuelle l'ajoute).
- **Heatmap** créneaux (1 h ou 30 min) × jours : nombre de joueurs libres (sur ceux qui saisissent leurs
  disponibilités). Les cases où l'**effectif minimum** est libre sont cerclées ; la liste « Effectif minimum
  libre » fusionne les créneaux consécutifs. **Proposer un événement** ouvre le formulaire du planning
  prérempli (Coach, Manager, Propriétaire).
- Effectif minimum : 5 par défaut, réglable (1 à 30) dans Paramètres › Planning (Propriétaire, Manager).

## Présence (refonte, migration 0013)

La réponse du joueur (**RSVP**, à l'avance) et la **présence réelle** (constatée par le staff) sont deux choses
distinctes, affichées séparément partout.

### Côté joueur

- **Réponse en un appui** : Oui / Peut-être / Non (accueil de la team, planning, page Présence › Mes réponses, bot
  Discord). Possible jusqu'à la fin de l'événement.
- **Annonce facultative**, sous la réponse : après Oui ou Peut-être, « Je serai en retard : 5 / 10 / 15 / 30 min » ;
  après Non, « Motif de l'absence ». Rien n'est obligatoire. Même modèle que les boutons RSVP du bot Discord : un
  appui qui n'envoie que la réponse garde l'annonce, sauf incohérence (« Non » efface le retard annoncé, « Oui » ou
  « Peut-être » effacent le motif).
- **Sa présence** : page Présence › Ma présence (période au choix) et carte **Mon profil de joueur** sur l'accueil
  de la team (30 jours) : taux, ponctualité, absences de suite, dernières séances avec sa réponse et la présence
  marquée. Un joueur ne voit jamais les chiffres des autres.

### Côté staff : la page Présence

Trois onglets (Marquer / Voir tout) :

- **À marquer (n)** : les séances **commencées** (en cours comprises) des 30 derniers jours dont la présence n'est
  pas complète (au moins un convoqué non marqué), la plus récente d'abord, avec « 3 à marquer sur 5 » et
  « En cours ». Deux boutons : **Feuille d'appel** et **Voir le détail**. L'accueil de la team signale les mêmes
  séances (commencées, et plus seulement terminées).
- **Historique** : une ligne par séance (période et types au choix) : convoqués, présents, en retard, absents,
  excusés, non marqués, venus en plus, taux. Un appui ouvre la séance.
- **Statistiques** : périodes **7 jours, 30 jours, 3 mois, saison** (depuis le début de saison de la team,
  `MM-JJ`, 1er septembre par défaut, réglable dans Paramètres › Planning) **ou dates** ; filtre par type
  d'événement ; chiffres clés (taux de présence, ponctualité et retard moyen, séances non marquées) ; par joueur :
  taux en chiffre et en barre, **tendance** (↗ / ↘ en points), ponctualité, **« n absences de suite »** ; par type
  d'événement ; un appui sur un joueur ouvre **sa fiche** (historique séance par séance, motifs). Jamais de « — » :
  une valeur absente est écrite (« pas encore marqué », « non convoqué ») et un **état vide** explique quoi faire
  (« 3 séances ont eu lieu mais leur présence n'est pas marquée »). Les **définitions** sont dans l'écran
  (« Comment ces chiffres sont calculés »). Export CSV.

### Vue Présence d'une séance et feuille d'appel

Une seule brique (`FeuilleAppel.tsx`), dans le détail d'un événement (vue) et en **feuille d'appel** (plein écran
sur iPhone, volet sur PC) :

- en haut, les **compteurs** : convoqués, ont répondu Oui / Peut-être / Non / sans réponse, puis « 3 sur 5
  marqués » avec une barre ;
- une ligne par convoqué : sa réponse (et son annonce : « annonce 15 min de retard », motif), et un **sélecteur en
  un appui** (Présent / En retard / Absent / Excusé, quatre boutons d'égale largeur sur une ligne, 44 px, 52 en
  feuille d'appel). **Chaque appui enregistre** et la ligne affiche « ✓ Enregistré » (ou « Non enregistré » et
  revient en arrière si le serveur refuse). En retard : minutes en option (5, 10, 15, 30 ou saisies). Absent ou
  Excusé : motif en option ;
- **Tout le monde présent** : marque présents les convoqués **pas encore marqués** (les exceptions déjà saisies
  restent), puis on ajuste ;
- **Ajouter quelqu'un de non convoqué** : un remplaçant venu quand même, noté présent, compté à part
  (« venu en plus »), jamais dans les taux ; « Retirer de la feuille » l'enlève.

On peut marquer une séance pas encore commencée (par ex. un excusé prévenu à l'avance) ; elle n'apparaît dans
« À marquer » qu'une fois commencée.

### Définitions (une seule, partout : page Présence, accueil, Dashboard, statistiques de la team, CSV)

- **Seuls les convoqués comptent** (voir Convocations) ; un non-convoqué venu quand même est compté à part.
- **Marquées** = séances où il était convoqué **et** dont la présence est marquée (présent, en retard, absent,
  excusé). Une séance commencée non marquée est « non marquée » : elle n'entre dans aucun taux.
- **Taux de présence** = (présents + en retard) ÷ marquées. **Un excusé compte comme une absence (justifiée)** :
  c'est la définition demandée par le Fondateur ; avant la refonte, l'écran Présence l'excluait alors que le
  Dashboard et les statistiques de la team le comptaient (trois chiffres différents pour la même chose).
- **Ponctualité** = présents ÷ (présents + en retard) ; **retard moyen** sur les retards chronométrés.
- **Absences de suite** = absences ou excuses consécutives en partant de la dernière séance marquée
  (`serieMax` : la plus longue).
- **Tendance** = taux de la seconde moitié de la période écoulée − taux de la première (en points ; « stable »
  sous 5 points).

### Données (migration `0013_presence_notes.sql`)

Colonnes ajoutées à `presences` : `retard_prevu` et `motif_prevu` (annonce du joueur), `retard_minutes` et `motif`
(constat du staff), `hors_convocation` (0/1). Les anciennes lignes restent valables. Le journal (`attendance.rsvp`,
`attendance.marked`) ne contient jamais de motif (donnée personnelle).

### Export CSV

Les MÊMES lignes que les statistiques (convoqués, non-marqués attendus compris, venus en plus signalés), filtres de
période et de type acceptés : date, heure, événement, type, joueur, **convoqué** (« Non (venu en plus) »),
réponse, **retard annoncé (min)**, **motif annoncé**, présence, **retard (min)**, **motif**, note (UTF-8 avec BOM,
formules neutralisées).

### Rappel automatique

Le cron publie `attendance.reminder` (une fois par convoqué et par occurrence) pour les convoqués sans réponse,
`rappelHeures` avant le début (24 h par défaut, 0 = jamais) ; in-app et Discord (« RSVP manquant »).

### Audit d'octobre 2026 (avant la refonte)

Relevé sur l'app lancée avec les graines (PC 1440 × 900 et iPhone 390 × 844) :

1. Une seule longue page mélangeait trois métiers (mes réponses, marquage, statistiques), sans onglets.
2. « Marquer la présence » listait toutes les séances commencées des 14 derniers jours, **même déjà marquées**,
   sans état ni compteur ; « Marquer » était un petit texte gris ; la liste s'ouvrait en accordéon et poussait la
   suite hors de l'écran ; aucun « tout le monde présent » : un appui par joueur, toujours.
3. Sur iPhone, les quatre boutons passaient sur deux lignes (« Excusé » seul en dessous) ; la confirmation
   (« enregistré ») s'affichait en haut du bloc, hors de l'écran.
4. Ni minutes de retard, ni motif, ni moyen d'ajouter un remplaçant non convoqué (refus 400).
5. Réponse et présence mélangées : chaque ligne d'une séance passée affichait « Réponse : Sans réponse » et les
   statistiques un « réponses 0 % » sans intérêt.
6. Statistiques : des « — » (Match, mois de septembre), des clés brutes (« 2026-09 », « 2026-S43 »), une ligne de
   chiffres à décoder ; **trois définitions différentes du taux** (page Présence sans les excusés : Tom à 100 %
   avec 3 excusés sur 6 ; Dashboard et statistiques de la team avec) ; ni 7 jours, ni saison, ni dates ; ni fiche
   joueur, ni séries, ni tendance ; la période par défaut englobait la semaine à venir.
7. Incohérence « à marquer » : la page Présence prenait les séances commencées, l'accueil seulement les terminées
   (l'entraînement en cours manquait à l'accueil).
8. Le joueur ne pouvait ni prévenir d'un retard ni donner un motif, et ses chiffres étaient en bas d'une page de
   staff.

Tout est corrigé ci-dessus ; tests : `esport/test/presence-notes.test.mjs`, `src/esport/planning/presence.test.tsx`,
e2e `scripts/e2e-esport-presence-notes.mjs` (captures `docs/captures-esport-presence-notes/`).

### Correctif : « présent » qui ne comptait pas (octobre 2026)

Constat du Fondateur : Réunion et Scrim du mardi 20/10, « présent » marqué, et les statistiques affichaient
« 0 présent · 2 non marqué · réponses 100 % », taux « — ». Le calcul du serveur était juste (clé d'occurrence,
période, fuseau, filtre de type, regroupement par mois : vérifiés par un test) ; la cause était dans le
marquage :

1. un appui sur **Présent** ne faisait que sélectionner : rien n'était envoyé tant qu'on ne touchait pas
   **Enregistrer la présence**, plus bas (en dehors de l'écran sur iPad) ; quitter le détail perdait le choix ;
2. la liste de présence d'un événement « toute la team » excluait le staff et les Propriétaires
   (`attendance.mark`), sauf s'ils avaient déjà une ligne ; chargée à l'ouverture du détail, elle ne se
   rechargeait pas après « Oui » : le Propriétaire, qui venait de répondre, ne pouvait pas se marquer — ses deux
   réponses restaient « non marqué » (d'où « réponses 100 % ») ;
3. le volet « Marquer la présence » de la page Présence n'affichait que les événements **terminés** : ceux du
   jour n'y étaient pas.

Corrigé : chaque appui enregistre ; la liste est celle des convoqués (le Propriétaire y est s'il est coché) et se
recharge après une réponse ; les événements commencés sont à marquer ; marquer un non-convoqué est refusé (400)
au lieu d'être ignoré ; statistiques et CSV comptent les convoqués. Test du cas exact :
`esport/test/convocations.test.mjs` (« statistiques : Réunion et Scrim le mardi 20/10… »).

## Bus d'événements et journal

Les charges d'événement portent `convoques` (comptes convoqués, résolus à l'écriture) : les notifications ne
vont qu'à eux. Nouveaux événements de domaine (outbox → journal + notifications) : `event.created`, `event.updated`,
`event.deleted`, `event.occurrence_updated`, `event.occurrence_cancelled`, `attendance.rsvp`,
`attendance.marked`, `attendance.reminder`, `availability.updated`, `availability.settings_changed`,
`ical.token_created`, `ical.token_revoked`. Notifications in-app : nouvel événement, événement modifié ou
annulé (membres concernés), rappel de réponse.

## API (préfixe facultatif `/api/esport`)

| Méthode et route | Permission |
| --- | --- |
| `GET /teams/:t/planning?debut&fin&fuseau&types&membre` (`membre=moi` : mes convocations) | planning.view |
| `POST /teams/:t/planning` (`convocation: { groupes, membres, exclus, proprietaires }`) | planning.create |
| `GET\|PATCH\|DELETE /teams/:t/planning/:e` (`DELETE ?portee=serie\|occurrence\|suivantes&occurrence=`) | view / update / delete |
| `PATCH /teams/:t/planning/:e/occurrences/:clé` (`convocation` propre à la date, `null` : celle de la série) | planning.update |
| `PUT /teams/:t/planning/:e/occurrences/:clé/rsvp` (`rsvp`, `retardPrevu?`, `motif?`) | attendance.rsvp_own, et être convoqué |
| `GET\|PUT /teams/:t/planning/:e/occurrences/:clé/presence` (`marques: [{ compte, reel, retardMinutes?, motif?, horsConvocation? }]`, `toutPresent?`) | view_all (ou la sienne) / attendance.mark |
| `GET /teams/:t/planning/accueil` | planning.view |
| `GET\|PUT /teams/:t/planning/reglages` | planning.view / team.manage |
| `GET /teams/:t/planning/export.ics` ; `GET\|POST /teams/:t/planning/ical` ; `DELETE …/ical/:id` | planning.view |
| `GET /ical/<jeton>.ics` (sans session) | jeton actif + accès du titulaire |
| `GET /teams/:t/presence/stats?debut&fin\|periode&types&granularite` | view_all (ou les siennes) |
| `GET /teams/:t/presence/export.csv?debut&fin&types` (ou `periode=7\|30\|90\|saison`) | attendance.view_all |
| `GET /teams/:t/presence/a-marquer` | attendance.mark |
| `GET /teams/:t/presence/historique?periode\|debut&fin&types` | attendance.view_all |
| `GET /teams/:t/presence/joueurs/:compte` (`moi` : la sienne) | attendance.view_all (ou la sienne) |
| `GET /teams/:t/dispos/moi` ; `PUT …/moi/regles` ; `POST …/moi/exceptions` ; `DELETE …/moi/exceptions/:id` | availability.edit_own |
| `GET /teams/:t/dispos/carte?semaine&fuseau&pas` | availability.view_all |

Ajouter `?format=json` aux exports pour recevoir `{ nom, type, contenu }` (utilisé par l'app).

## Code

- Cœur portable : `esport/noyau/planning/` — `temps.mjs` (fuseaux), `recurrence.mjs`, `convocations.mjs`, `dispos.mjs`
  (heatmap), `presence.mjs` (statistiques, définitions, séries, CSV), `ical.mjs`, `service.mjs`, `routes.mjs`, `bus.mjs`,
  `rappels.mjs` (cron). SQL standard (SQLite/D1, Postgres).
- App : `src/esport/planning/` (client, libellés) et `src/esport/ui/planning/` ; écrans branchés par
  `src/esport/ui/modules.tsx`.
- Graines : `esport/outils/graines-planning.mjs` (`npm run esport:local`).
- Tests : `esport/test/planning.test.mjs`, `esport/test/planning-api.test.mjs`, `esport/test/convocations.test.mjs`,
  `esport/test/presence-notes.test.mjs`, `src/esport/planning/planning.test.tsx`, `src/esport/planning/presence.test.tsx`,
  e2e `scripts/e2e-esport-planning.mjs`, `scripts/e2e-esport-convocations.mjs` et `scripts/e2e-esport-presence-notes.mjs`.
- Migrations : numéros croissants, **trous permis** (une autre branche peut livrer `0003` avant `0002`).
