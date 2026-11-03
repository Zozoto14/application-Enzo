# Esport : réunions de l'équipe CM (« comme Teams »)

Demande du Fondateur : « Dans l'équipe CM, rajoute une partie comme un TEAMS pour gérer les réunions, rendez-vous et
disponibilités de chacun. »

Où : **Esport › Teams › CM du club › onglet « Réunions »** (PC et téléphone ; pas de nouvelle section dans la barre du
bas). L'onglet a trois parties : **Agenda**, **Disponibilités**, **Rendez-vous**, et le **statut du moment** de chacun.

Migration : `esport/migrations/0039_cm_reunions.sql`. Code : `esport/noyau/cm/reunions/` (serveur),
`src/esport/cm/reunions.ts` (client), `src/esport/ui/cm/reunions/` (écrans), `src/esport/i18n/reunions.ts` (FR / EN).
Tests : `esport/test/cm-reunions.test.mjs` (SQLite et PostgreSQL), `src/esport/Reunions.test.tsx` (Jest).

## Qui fait quoi

Deux permissions du club, dans la section CM de **Membres › Rôles et permissions** et dans **Équipe CM** :

| Permission | Ce qu'elle ouvre | Par défaut |
| --- | --- | --- |
| `cm.reunions.voir` | voir l'agenda de l'équipe CM, les disponibilités et statuts de l'équipe ; créer ses réunions ; proposer et réserver des rendez-vous | Responsable CM, Correspondant CM, Second CEO |
| `cm.reunions.gerer` | modifier et annuler **toutes** les réunions, en lire les notes | Responsable CM, Second CEO |

- L'**équipe CM**, c'est toute personne qui a `cm.reunions.voir` : par une affectation CM du club, par une affectation
  de team (correspondant, tant qu'il est membre actif de la team) ou par un rôle du club. Le **Fondateur** a tout.
- **Modifier, annuler** : l'organisateur, ou `cm.reunions.gerer`. Les autres reçoivent 403.
- **Autres membres du club** : on peut les inviter (recherche par pseudo). Un invité hors équipe CM voit la carte
  « CM du club » de la page Teams avec le seul onglet **Réunions** : l'agenda de SES réunions, sa réponse, les notes ;
  rien d'autre (ni création, ni disponibilités, ni l'équipe).
- Un **rendez-vous** est privé : seules ses deux personnes (et `cm.reunions.gerer`) le voient ; une réunion est
  visible par toute l'équipe CM (agenda d'équipe), mais ses **notes** restent aux participants.
- Rôles de team : ils ne portent jamais ces permissions.

## Agenda

- Vues **Jour / Semaine / Mois** (PC : grille horaire 7:00–23:00 comme Outlook ; téléphone : liste par jour, l'équipe
  dans un bloc repliable). Heures affichées dans **mon fuseau** (celui de mes disponibilités, sinon celui de
  l'appareil) ; la fiche rappelle l'heure de l'organisateur s'il est dans un autre fuseau.
- Une réunion : titre, ordre du jour, date, heure, durée, **fuseau**, lieu (**salon vocal Discord** par son lien
  `https://discord.com/channels/…`, **lien de visio** externe en https, **sur place**, ou aucun ; bouton **Rejoindre**),
  organisateur, participants, **récurrence** hebdomadaire (même règle que le planning des teams :
  `planning/recurrence.mjs`, heure murale gardée au changement d'heure, fin par nombre de fois), **rappel** (5, 10, 15,
  30, 60 min, la veille, ou aucun ; 15 min par défaut).
- **Réponses** : Accepter, Peut-être, Refuser, **Proposer un autre horaire** (date et heures, avec un commentaire).
  Un bloc en pointillés attend ma réponse ; un bloc pâle est refusé ; un bloc barré est annulé. Un badge compte les
  invitations sans réponse.
- **Modifier** : un nouvel horaire (ou une nouvelle récurrence) remet les réponses **en attente** (sauf celle de
  l'organisateur), comme Outlook ; `version` évite d'écraser une modification concurrente (409).
- **Annuler** : la réunion entière, avec un motif envoyé aux participants, ou **une seule date** d'une série.

## Disponibilités et statut

- **Mes créneaux** : chaque semaine, par jour, de HH:MM à HH:MM, disponible ou indisponible, dans **mon fuseau**
  (heures murales converties date par date, `planning/dispos.mjs`).
- **Absences et congés** (journées entières, dans mon fuseau) et « disponible en plus ».
- **Statut du moment** (pastille comme Teams) : Disponible, Occupé, Absent, Ne pas déranger, avec un message et une
  durée (1 h, 4 h, aujourd'hui, jusqu'à ce que je le change). Sans statut choisi, il est **automatique** : absent
  pendant une absence, occupé pendant une réunion, disponible sinon. Le panneau **Équipe CM** montre le statut, le
  message et l'heure locale de chacun.
- **Disponibilités de l'équipe** : grille superposée de la semaine (nombre de membres libres par heure, réunions déjà
  prévues déduites ; touchez une case pour voir qui).

## Trouver un créneau

Dans le formulaire d'une réunion : **Trouver un créneau** (7 jours à partir de la date choisie, pas de 30 min, heures
8:00–22:00 de l'organisateur) propose jusqu'à 8 créneaux qui ne se chevauchent pas, triés : le plus de participants
libres, puis le moins de « sans disponibilités saisies », puis le plus tôt. Pour chacun : **Libres**, **Occupés**
(réunion existante non refusée), **Absents** (absence, congé, ou hors de leurs créneaux), **Sans disponibilités
saisies** (comptés libres seulement entre 9:00 et 22:00 **dans leur propre fuseau** : jamais une réunion à 3 h du
matin chez quelqu'un). **Qui est libre à ce créneau ?** fait le même calcul pour l'horaire saisi. Règles pures :
`esport/noyau/cm/reunions/regles.mjs` (`proposerCreneaux`).

## Rendez-vous

Un membre de l'équipe propose des **plages** (« rendez-vous avec la Responsable CM », 30 min, salon Discord) : chaque
plage est découpée en créneaux. Les autres en réservent un ; le rendez-vous arrive dans l'agenda des deux (la personne
qui propose est l'organisatrice, la réservation vaut acceptation). **Jamais de double réservation** : le créneau n'est
pris que par un `UPDATE … WHERE reserve_par IS NULL` (le second reçoit 409 `creneau-reserve`) et `cm_reunions.creneau_id`
est unique. On ne réserve pas son propre créneau ni un créneau passé. Annuler le rendez-vous (l'une ou l'autre
personne) **libère** le créneau. Les autres ne voient que les créneaux libres, jamais qui a réservé quoi. Fermer les
réservations, rouvrir, supprimer (les rendez-vous déjà réservés restent).

## Notes de réunion (confidentielles)

- **Ordre du jour** et **compte rendu** (texte), **tâches de suivi** (texte, pour qui, échéance, faite), modifiables
  par l'organisateur, les participants et `cm.reunions.gerer` ; les autres membres de l'équipe voient la réunion dans
  l'agenda, pas ses notes (403 en écriture).
- Une tâche peut devenir une **carte d'un tableau CM** (liste « Idées » par défaut ; il faut `cm.editer` sur ce
  tableau). La carte ne reprend que le texte de la tâche, jamais le compte rendu.
- **Confidentialité** : les notes ne quittent jamais le serveur. Aucun événement du bus, aucune notification, aucun MP
  Discord, aucun abonnement iCal ne les contient (testé). Elles sont rattachées aux tâches **confidentielles** du
  connecteur IA (`ia/confidentialite.mjs` : `cm-reunions`, `notes-reunion` → « Résumés de réunion ») : IA locale
  seulement, jamais une API externe, sauf levée explicite par le Fondateur. Aucune fonction n'envoie aujourd'hui ces
  notes à une IA.

## Rappels, Discord, iCal

- **Rappel** avant chaque occurrence (cron toutes les 5 min, `reunions/rappels.mjs`) : une fois par participant et
  par occurrence (marque `cm_reunion_rappels`), jamais pour qui a refusé. Notification in-app **et MP Discord du bot**
  (file `cm_reunion_mp`, `reunions/mp.mjs` : même mécanisme que les relances du planning — salon privé, nonce, 429
  respecté, réessais 1 min → 3 h, compte joint par la liaison `/lier` vérifiée sinon le Discord ID posé par le
  Fondateur) dans **la langue du membre**, heure dans **son fuseau**. Une annulation part aussi en MP. Sans bot
  (`DISCORD_BOT_TOKEN`) ou sans compte Discord lié : la tâche est abandonnée, la notification in-app reste.
- **iCal** : menu **⋯** de l'agenda → **Exporter (.ics)**, ou **S'abonner** (lien `/cm-reunions/ical/<jeton>.ics`, jeton
  aléatoire dont seule l'empreinte SHA-256 est gardée, 5 actifs au plus, révocable). Le calendrier contient MES
  réunions (organisées ou acceptées / en attente) de −30 à +120 jours : titre, horaire, lieu ou lien, jamais les notes.

## Événements du bus (centre de notifications)

Sans team (`team_id` NULL), dans le journal de la section CM. Charges : titre, genre, début, fin, fuseau, organisateur,
participants (comptes) — jamais les notes.

| Événement | Quand | Notification in-app |
| --- | --- | --- |
| `cm.reunion_creee` | réunion créée | invités : `cm-reunion-invite` |
| `cm.reunion_modifiee` | titre, horaire, récurrence, lieu ou participants changés (`changements`, `ajoutes`, `retires`) | participants : `cm-reunion-modifiee` |
| `cm.reunion_annulee` | série (`serie: true`) ou une occurrence annulée (`occurrence`), avec `motif` | participants : `cm-reunion-annulee` (+ MP) |
| `cm.reunion_reponse` | réponse d'un participant (`reponse`, `proposition`) | organisateur : `cm-reunion-reponse` |
| `cm.rdv_reserve` | créneau de rendez-vous réservé | personne qui propose : `cm-rdv-reserve` |
| `cm.reunion_rappel` | rappel (cron) | le participant : `cm-reunion-rappel` (+ MP) |

## API

Routes (session) : voir l'en-tête de `esport/noyau/cm/reunions/routes.mjs` — `/cm/reunions` (agenda `?du&au`, créer),
`/cm/reunions/:id` (détail, modifier), `…/annuler`, `…/reponse`, `…/notes`, `…/taches`, `/cm/reunions/taches/:id`
(`…/carte`), `/cm/reunions/creneaux`, `/cm/reunions/equipe/grille`, `/cm/reunions/comptes`, `/cm/reunions/statut`,
`/cm/reunions/dispos/moi…`, `/cm/reunions/rdv…`, `/cm/reunions/export.ics`, `/cm/reunions/ical…`. `GET /cm/moi` rend
`reunions: { voir, gerer, invite }`. Limite : 60 créations (réunions et offres) par heure et par compte.

## Données, export, RGPD

- Tables : `cm_reunions`, `cm_reunion_participants`, `cm_reunion_exceptions`, `cm_reunion_notes`, `cm_reunion_taches`,
  `cm_dispo_regles`, `cm_dispo_exceptions`, `cm_reunion_profils`, `cm_rdv_offres`, `cm_rdv_creneaux`,
  `cm_reunion_rappels`, `cm_reunion_mp`, `cm_reunion_ical` — toutes dans l'**export / import** de la base.
- **Export RGPD** (Mes données) : réunions organisées ou invitées (sa réponse), créneaux, absences, statut, offres de
  rendez-vous.
- **Suppression du compte** : il quitte les participants ; ses disponibilités, son statut, ses abonnements iCal et ses
  MP en file disparaissent ; ses offres de rendez-vous ferment (créneaux libres retirés) ; les réunions qu'il
  organisait restent au club, sans organisateur ; ses tâches de suivi perdent leur assignation.
