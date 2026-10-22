# Pilote automatique de semaine (« Ta semaine »)

Le dimanche soir (jour et heure réglables), l'application propose la **semaine idéale** : une notification, puis
l'écran **Tâches › Ta semaine**. Les tâches y sont rangées par jour et par créneau, avec les relances de prospects, les
paiements d'abonnements, le versement mensuel et les dividendes, et des épisodes Tsuzuku en récompense. On déplace ou on
retire ce qu'on veut, puis **« Tout valider »** applique les jours et créneaux dans Tâches, en un seul geste
(annulable).

## Où vit la fonction, et pourquoi

Le pilote croise cinq apps (Tâches, Prospects, Abonnements, Portefeuille, Tsuzuku) et ne règle que le planning de
Tâches. Il est donc coupé en deux, comme le veut l'architecture du hub :

| Couche | Fichiers | Rôle |
| --- | --- | --- |
| **Hub** : contrats et algorithme | `src/hub/pilote/contrats.ts`, `planification.ts`, `jours.ts` | Définit ce qu'on sait planifier (tâches, événements à date fixe, épisodes) et ce qu'on rend (une semaine). Pur, déterministe, sans import d'aucune app. |
| **Hôte** : remplit et applique | `src/taches/pilote/hote.ts`, `controleur.ts`, `notification.ts`, `src/taches/ui/PiloteSemaine.tsx` | Lit les données locales déjà synchronisées de chaque app, construit l'entrée du hub, applique la validation dans Tâches, envoie la notification. |

Pourquoi dans Tâches plutôt qu'une tuile du hub : l'écran a besoin de ce que Tâches sait déjà faire (rôle du compte,
droits par projet, assignation, écriture synchronisée, atomes d'interface, glisser-déposer souris et doigt,
notifications). Une tuile à part obligerait à dupliquer le contrôle d'accès (un membre qui a Tâches n'a pas
forcément une autre case dans l'Administration) et ne profiterait pas de la pastille 🔔 de Tâches. Les contrats, eux,
restent dans le hub : n'importe quelle autre app pourra un jour fournir ou consommer des événements sans toucher à
Tâches, et le hub ne dépend toujours d'aucun module d'app.

Entrée dans l'interface : **Tâches › Ta semaine** (barre latérale, ou ☰ sur téléphone). Une alerte « Ta semaine est
prête » de la pastille 🔔 ouvre l'écran.

## L'écran « Ta semaine »

- Titre, semaine (« Semaine du 19 au 25 octobre »), état (**Proposition à valider** ou **Validée**), résumé (« 10 tâches
  (10 h 45) · 1 relance · 1 paiement · 6 épisodes en récompense »).
- Un bloc par jour avec la **charge** du jour (« 4 h / 6 h », rouge si elle dépasse), un jour sans travail est marqué
  comme tel. Dans chaque jour, des cartes : créneau, genre (tâche, récurrente, relance, paiement, versement, dividende,
  récompense), durée, priorité, échéance d'origine, projet, étiquettes « En retard », « Trop chargé », « Jour sans
  travail », « Durée plafonnée ».
- **Déplacer** : glisser une carte sur un autre jour (souris, ou au doigt par appui long, comme le Kanban) ou boutons
  **‹ ›** (jour précédent, jour suivant). **Retirer** : bouton **✕** (la carte passe dans « Retirés de la semaine », d'où
  on la replace sur le jour voulu). Une surcharge n'est jamais refusée : elle est signalée, l'utilisateur décide.
- **À arbitrer** : ce que l'algorithme n'a pas pu placer (pas assez de place avant l'échéance, récurrence un jour off) ;
  on le place d'un bouton sur le jour de son choix.
- **Régénérer** : recalcule la proposition à partir des données et des réglages du moment (les retouches sont
  perdues). **Tout valider** : applique. **Annuler la validation** : rend les échéances d'avant (voir plus bas).
- **⚙︎ Réglages** : proposition automatique, jour et heure de la proposition, notification, créneaux de travail (jusqu'à
  quatre), charge maximale par jour (3 h à 8 h), jours sans travail, épisodes en récompense (nombre par soirée, heure de
  soirée), versement et dividendes du Portefeuille. Enregistrer régénère la semaine affichée.
- Les 8 thèmes du hub (clair et sombre), PC, iPad (1024 × 768 et 820 × 1180) et iPhone (390 × 844) : cibles de 44 px,
  textes de 15 px au moins, aucun débordement (mesurés par `scripts/e2e-pilote-semaine.mjs`).

### Quelle semaine est proposée

La semaine proposée est celle qui **commence au premier lundi après le jour de la proposition** (par défaut le
dimanche à 18 h : le lundi suivant). Avant l'heure de la proposition, l'écran montre la semaine en cours ; à l'heure
dite, la semaine suivante. Les jours déjà passés ne reçoivent rien (régénérer en milieu de semaine ne planifie que le
reste de la semaine).

## Ce que le pilote planifie

**Tâches** (`tachesPlanifiables`) : seulement celles qui sont **assignées à l'utilisateur** (le Fondateur compte aussi
les tâches sans responsable de ses projets **non partagés** ; jamais celles d'un projet partagé qui n'ont personne),
ouvertes, d'un projet où il peut écrire (un membre en lecture seule ne planifie rien, même assigné), hors sous-tâches
(la tâche principale les porte). Les tâches venues de Prospects, Abonnements et Portefeuille ne sont pas reprises : leur
événement d'origine est planifié à leur place. Une tâche entre dans la semaine si elle a une échéance au plus tard une
semaine après la semaine planifiée, ou une priorité haute ou urgente, ou une date de début ou « Ma journée » dans la
semaine, ou si elle revient cette semaine (récurrente). Une tâche sans date ni priorité haute n'est pas planifiée (elle
resterait à remplir les créneaux à l'infini). Durée = estimation moins le temps déjà passé (15 min au moins), 30 min par
défaut sans estimation (réglable).

**Récurrentes** : la tâche récurrente de Tâches n'existe qu'en une occurrence (la suivante naît à la complétion). Les
autres occurrences de la semaine sont placées à leur jour imposé (« Récurrente ») et ne touchent rien dans Tâches.

**Prospects** (Fondateur seul, comme les liens de Tâches) : les relances prévues jusqu'à la fin de la semaine, celles en
retard ramenées au premier jour de travail (fiches closes ou « ne plus contacter » exclues).

**Abonnements** (rangs qui peuvent voir les abonnements) : les échéances des comptes suivis jusqu'à la fin de la
semaine, retards compris (comptes offerts ou en pause exclus).

**Portefeuille** (réglable) : le versement mensuel s'il est actif (le jour du mois voulu tombe dans la semaine) et les
dividendes attendus dans la semaine (ou en retard de moins de 30 jours), tels que l'hôte les donne déjà à Tâches
(`ResumePortefeuille.rappelsTaches`).

**Tsuzuku** (si l'app est ouverte au profil) : la suite des animés suivis (en cours ou à reprendre), du plus récemment
regardé : jusqu'à 3 épisodes par animé, 14 au total, durée de l'épisode ou 24 min. Aucun nom de site : seulement les
titres de la bibliothèque du profil.

## L'algorithme (`src/hub/pilote/planification.ts`)

Pur et déterministe : mêmes entrées, même semaine, quel que soit l'ordre des entrées (aucune horloge, aucun hasard ;
tous les tris finissent par l'identifiant ; testé).

1. **Événements à date fixe** (relances, paiements, versement, dividendes) : restent à leur jour ; un événement en
   retard est ramené au premier jour de travail ; avec une heure imposée, il la garde (les tâches l'évitent). Relance 15
   min, paiement 10, versement 15, dividende 10. Un événement un jour off reste ce jour-là « toute la journée », hors
   charge.
2. **Tâches triées par urgence** : d'abord celles qui ont une échéance cette semaine, sont en retard ou sont urgentes
   (par échéance croissante), puis les hautes, normales, basses. Les récurrences sont des occurrences à jour imposé,
   placées avant les tâches libres de même échéance.
3. **Choix du jour** : parmi les jours de travail entre le début de la tâche et son échéance (toute la semaine si elle
   est en retard ou sans échéance), un jour où la **charge maximale** et les **créneaux** laissent la place : **le plus
   tôt** pour les urgentes, hautes et en retard ; **le jour le moins chargé** pour les autres (la semaine se répartit). Sans
   place avant l'échéance : « à arbitrer » (jamais forcé, une échéance n'est pas repoussée en silence).
4. **Dans la journée** : événements d'abord, puis tâches par priorité et échéance ; les heures se rangent dans les
   **créneaux de travail** (pas de tâche à cheval sur une pause ; une durée supérieure au plus long créneau est
   plafonnée et signalée). Une tâche n'est jamais coupée.
5. **Récompenses** : le soir des **jours de travail où du travail est prévu** (donc fini dans la charge permise), après la
   dernière tâche et à partir de l'heure de soirée (20 h), au plus N épisodes par soirée, jamais après 23 h 30, dans
   l'ordre donné par l'hôte (les épisodes d'un même animé se suivent). Pas d'épisode un jour sans travail ni un jour
   off.
6. **Jours off** : aucune tâche n'y est placée par l'algorithme ; l'utilisateur peut quand même y déposer un élément
   (marqué « Jour sans travail »).

Les modifications de l'utilisateur (`deplacerElement`, `decalerElement`, `retirerElement`, `remettreElement`) re-rangent
seulement les jours touchés.

### Récompenses : un déblocage visuel, jamais un verrou

Un épisode est « 🔒 Se débloque quand tes tâches du jour sont faites (N restantes) » tant que les tâches (réelles) du
même jour ne sont pas terminées dans Tâches (une tâche supprimée ne bloque pas ; un jour sans tâche réelle, avec
seulement des récurrentes, est débloqué), puis « ✓ Débloqué : bon visionnage ». Le bouton « ▶ Tsuzuku » ouvre Tsuzuku
dans tous les cas : **rien n'est bloqué**, seul l'affichage change.

## Valider et annuler

**Tout valider** (`validerSemaine`) : pour chaque élément de genre « tâche » encore valable (ouverte, assignée à
l'utilisateur, modifiable), l'échéance devient `jour + heure du créneau` (l'échéance d'origine reste dans
l'**historique** de la tâche, qui la note). Les relances, paiements, versements, dividendes, récurrences et épisodes ne
touchent **rien** (rien n'est écrit dans Prospects, Abonnements ni Portefeuille). C'est **une seule modification** des
données de Tâches (`etat.maj`) : un seul enregistrement local et donc, si l'appareil est relié, un seul dépôt par la
synchronisation existante (voir `docs/taches.md`, « Écritures »). Les tâches terminées, supprimées ou
devenues non modifiables depuis la proposition sont ignorées et comptées dans le message. Un membre n'applique que ses
tâches, dans sa copie, comme n'importe quelle modification de sa part (le Fondateur revérifie tout ce qui revient).

**Annuler la validation** (`annulerValidation`) : chaque tâche retrouve l'échéance (ou l'absence d'échéance) d'avant,
**sauf celles modifiées depuis** (échéance déplacée entre-temps : on n'y touche pas, le message le dit). L'écran revient
à la proposition, modifiable.

## Notification du dimanche soir (`notification.ts`)

Quand l'heure choisie est passée, que la semaine suivante n'est **ni validée ni déjà annoncée** et que la proposition
est récente (36 h au plus : un appareil éteint une semaine n'annonce rien), une alerte « Ta semaine est prête : 10
tâches, 1 relance, 1 paiement, 6 épisodes en récompense » part : pastille 🔔 de Tâches et, selon les réglages de
notification de Tâches (heures calmes, « un appareil seulement », son), notification du système sur le PC. Une seule
fois par semaine (clé `pilote|<lundi>` retenue sur l'appareil). Évaluée par le tour existant du hub
(`verifierRappels`, toutes les 30 s tant que l'app est déverrouillée) : aucun serveur, aucune notification de
l'extérieur.

## Stockage et relais

- État de l'écran (réglages, brouillon, dernière validation, semaines annoncées) : **base de l'appareil**, clé
  `taches.pilote`, jamais synchronisée ni sauvegardée. Aucune écriture sur le relais pour la proposition, les
  retouches, les réglages ni la notification.
- Les seules données partagées touchées sont celles de Tâches, **une fois**, à la validation (et à l'annulation).
- Les réglages et le brouillon sont propres à chaque appareil (la validation, elle, voyage avec les tâches).
- Relais inchangé.

## Limites connues

- Les projets personnels d'un membre ne sont pas planifiés (l'écran propose de revenir aux projets partagés).
- Les dépendances entre tâches ne sont pas utilisées pour l'ordre.
- Une tâche plus longue que le plus long créneau est plafonnée au lieu d'être coupée en plusieurs jours.
- Valider remplace l'échéance de la tâche par son créneau : l'échéance d'origine reste lisible dans l'historique et
  dans « Annuler la validation », pas dans un champ à part.
- Le brouillon et les réglages ne suivent pas d'un appareil à l'autre.
- Les « nouveaux épisodes » sont la suite de ce que l'utilisateur regarde (épisode suivant de chaque animé suivi) : la
  bibliothèque n'enregistre pas les dates de diffusion.

## Tests

- `src/hub/pilote/planification.test.ts` (45) : charge maximale, déplacement du surplus en « à arbitrer »,
  répartition, urgentes au plus tôt, plafond de durée ; échéances (au plus tard le jour dit, échéance proche avant
  échéance lointaine, retard, date de début, tâche lointaine, régénération en cours de semaine) ; jours off,
  créneaux sans chevauchement, récurrences ; événements des autres apps (jour, heure imposée, retard, jour off, hors
  semaine) ; récompenses (soir, après le travail, jamais un jour sans travail, par soirée, fin de soirée, déblocage) ;
  déterminisme (ordre des entrées) ; déplacer, refuser, surcharge signalée, retirer et remettre, placer un élément
  à arbitrer, décaler ; réglages ; moment de la proposition.
- `src/taches/pilote/pilote.test.ts` (22) : assignation, rangs et partage (Fondateur, membre en écriture, membre en
  lecture), exclusions, durée, récurrences ; relances, paiements, versement, dividendes, épisodes (accès Tsuzuku,
  bibliothèque illisible) ; **validation** (une seule modification, rien d'autre ne bouge, tâche terminée ignorée,
  membre), **annulation** (tâche modifiée depuis conservée) ; état de l'appareil ; notification (une fois, jour et heure
  réglables, désactivée, déjà validée, trop ancienne, membre).
- `src/taches/pilote/RacinePilote.test.tsx` (11) : l'écran dans les 8 thèmes (bureau et téléphone), l'entrée de
  navigation, valider (une seule écriture des données de Tâches) et annuler, déplacer / retirer / remettre, régénérer,
  récompenses (verrou, bouton Tsuzuku toujours actif, déblocage), réglages, semaine libre, membre.
- Bout en bout : `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-pilote-semaine.mjs` (après
  `npx vite build`), horloge simulée du dimanche 18 octobre 2026 : alerte de 18 h (une seule fois, qui ouvre
  l'écran), semaine proposée avec relance, paiement et épisodes, déplacements au bouton, à la souris et au doigt,
  retirer et remettre, régénérer, réglages, validation et annulation vues dans la liste de Tâches, déblocage d'un
  épisode, 8 thèmes (PC et iPhone), iPad 1024 × 768 et 820 × 1180, iPhone 390 × 844. Captures JPEG dans
  `docs/captures-pilote-semaine/`.
