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

- Vues **mois**, **semaine**, **liste** ; filtres par type et par membre convoqué ; navigation par période.
- Types et couleurs : Entraînement (bleu), Scrim (violet), Match (rouge), Tournoi (ambre), Réunion (cyan), Autre (gris).
- Champs : type, titre, date, début, fin (une fin avant le début tombe le lendemain), lieu ou lien,
  description, membres convoqués (aucun = toute la team), `adversaireId` (facultatif, pour le scouting de la
  phase 5) et `reviewId` (phase 5).
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

## Présence

- **RSVP** par le joueur : Oui / Peut-être / Non, en un appui (accueil de la team, planning, page Présence).
  Possible jusqu'à la fin de l'événement.
- **Présence réelle** marquée par le staff : Présent, En retard, Absent, Excusé (détail d'une occurrence, ou
  « Marquer la présence » de la page Présence ; l'accueil signale les événements passés non marqués).
- Liste de présence : les membres convoqués ; sans convocation, ceux qui répondent (RSVP) sans marquer
  (le staff n'y figure pas).
- **Statistiques** par joueur, par type d'événement et par mois ou par semaine.
  Taux = (présent + en retard) / (marqués − excusés) ; un excusé ne compte ni pour ni contre, un non-marqué
  n'entre pas dans le taux. Ponctualité = présent / (présent + en retard).
- **Export CSV** (staff) : date, heure, événement, type, joueur, réponse, présence, note (UTF-8 avec BOM,
  formules neutralisées).
- **Rappel automatique** : le cron publie l'événement `attendance.reminder` sur le bus (une fois par joueur
  et par occurrence) pour les joueurs sans réponse, `rappelHeures` avant le début (24 h par défaut, 0 =
  jamais). L'abonné in-app en fait une notification ; Discord (phase 4) s'abonnera au même événement.

## Bus d'événements et journal

Nouveaux événements de domaine (outbox → journal + notifications) : `event.created`, `event.updated`,
`event.deleted`, `event.occurrence_updated`, `event.occurrence_cancelled`, `attendance.rsvp`,
`attendance.marked`, `attendance.reminder`, `availability.updated`, `availability.settings_changed`,
`ical.token_created`, `ical.token_revoked`. Notifications in-app : nouvel événement, événement modifié ou
annulé (membres concernés), rappel de réponse.

## API (préfixe facultatif `/api/esport`)

| Méthode et route | Permission |
| --- | --- |
| `GET /teams/:t/planning?debut&fin&fuseau&types&membre` | planning.view |
| `POST /teams/:t/planning` | planning.create |
| `GET\|PATCH\|DELETE /teams/:t/planning/:e` (`DELETE ?portee=serie\|occurrence\|suivantes&occurrence=`) | view / update / delete |
| `PATCH /teams/:t/planning/:e/occurrences/:clé` | planning.update |
| `PUT /teams/:t/planning/:e/occurrences/:clé/rsvp` | attendance.rsvp_own |
| `GET\|PUT /teams/:t/planning/:e/occurrences/:clé/presence` | view_all (ou la sienne) / attendance.mark |
| `GET /teams/:t/planning/accueil` | planning.view |
| `GET\|PUT /teams/:t/planning/reglages` | planning.view / team.manage |
| `GET /teams/:t/planning/export.ics` ; `GET\|POST /teams/:t/planning/ical` ; `DELETE …/ical/:id` | planning.view |
| `GET /ical/<jeton>.ics` (sans session) | jeton actif + accès du titulaire |
| `GET /teams/:t/presence/stats?debut&fin&types&granularite` | view_all (ou les siennes) |
| `GET /teams/:t/presence/export.csv` | attendance.view_all |
| `GET /teams/:t/dispos/moi` ; `PUT …/moi/regles` ; `POST …/moi/exceptions` ; `DELETE …/moi/exceptions/:id` | availability.edit_own |
| `GET /teams/:t/dispos/carte?semaine&fuseau&pas` | availability.view_all |

Ajouter `?format=json` aux exports pour recevoir `{ nom, type, contenu }` (utilisé par l'app).

## Code

- Cœur portable : `esport/noyau/planning/` — `temps.mjs` (fuseaux), `recurrence.mjs`, `dispos.mjs`
  (heatmap), `presence.mjs` (statistiques, CSV), `ical.mjs`, `service.mjs`, `routes.mjs`, `bus.mjs`,
  `rappels.mjs` (cron). SQL standard (SQLite/D1, Postgres).
- App : `src/esport/planning/` (client, libellés) et `src/esport/ui/planning/` ; écrans branchés par
  `src/esport/ui/modules.tsx`.
- Graines : `esport/outils/graines-planning.mjs` (`npm run esport:local`).
- Tests : `esport/test/planning.test.mjs`, `esport/test/planning-api.test.mjs`,
  `src/esport/planning/planning.test.tsx`, e2e `scripts/e2e-esport-planning.mjs`.
- Migrations : numéros croissants, **trous permis** (une autre branche peut livrer `0003` avant `0002`).
