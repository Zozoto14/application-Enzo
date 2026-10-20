# Esport : objectifs et tâches

Module `goals_tasks` (phase 3). Données propres à l'Esport, **séparées de l'app Tâches du hub**.

## Objectifs

- Objectif **d'équipe** ou **d'un joueur** (membre actif), date cible facultative, statut actif / atteint /
  abandonné.
- **Progression calculée** par le serveur à partir des tâches rattachées : faites / total (arrondie, 0 % sans
  tâche). Une tâche supprimée ne compte plus ; supprimer un objectif garde ses tâches (détachées).

## Tâches

- Titre, description, assigné (membre actif de la team), échéance, priorité (basse, normale, haute, urgente),
  statut (à faire, en cours, fait), objectif facultatif.
- Vues **liste** et **kanban** (trois colonnes ; boutons pour passer d'une colonne à l'autre) ; filtres **Toutes**,
  **Mes tâches**, **En retard** (échéance passée dans le fuseau de la team, tâche non faite). Tri : échéance (sans
  échéance à la fin), puis priorité.
- L'accueil de la team montre les tâches en retard.

## Droits

| Rôle (système) | Voir | Créer, modifier, supprimer | Assigner à quelqu'un d'autre |
| --- | --- | --- | --- |
| Propriétaire, Fondateur | oui | oui | oui |
| Coach | oui | oui | oui |
| Manager, Analyste, Joueur | oui | non | non |
| Remplaçant / Invité | non | non | non |

L'assigné fait toujours avancer **sa** tâche (statut), même avec la seule lecture. S'assigner soi-même demande
`goals_tasks.create` (création) ou `goals_tasks.update` (modification) ; assigner quelqu'un d'autre demande
`goals_tasks.assign`.

## Notifications

- **Assignation** (`task.assigned`) : l'assigné est prévenu, sauf s'il s'est assigné lui-même.
- **Échéance** (`task.due_soon`) : le cron du Worker (toutes les 15 minutes) prévient une fois l'assigné d'une tâche
  non faite dont l'échéance est demain, aujourd'hui ou passée. Changer l'échéance ou l'assigné relance le rappel.
  En local, `serveur-local.mjs` fait de même toutes les 15 minutes.

## API

| Route | Rôle |
| --- | --- |
| `GET/POST /teams/:t/objectifs`, `PATCH/DELETE /teams/:t/objectifs/:id` | Objectifs (avec `progression`) |
| `GET /teams/:t/taches?filtre=miennes\|retard&statut=&objectif=&assigne=&priorite=` | Tâches (+ `jour` de la team) |
| `POST /teams/:t/taches`, `PATCH/DELETE /teams/:t/taches/:id` | Créer, modifier, supprimer (logique) |

Événements : `goal.created|updated|deleted`, `task.created|updated|assigned|deleted|due_soon`. Tables : `objectifs`,
`taches` (migration `0003`).
