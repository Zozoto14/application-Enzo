# Esport : Plan de match

Le module **Plan de match** (`plans_match`) réunit, pour un match précis, tout ce que la team doit savoir avant de
jouer. Il vit dans la section **Jeu** d'une team, pour tous les modèles de jeu (Valorant, The Finals, générique).

> **Contenu tactique.** Comme les strats et les lineups, un plan n'est **jamais envoyé à une IA externe** (aucun
> bouton de l'assistant d'écriture sur ses champs, et le serveur refuse) et son contenu n'est **jamais publié sur
> Discord** : l'annonce facultative « plan prêt » ne dit que « Le plan de match contre X est prêt », avec un lien.

## Pour un coach

1. **Nouveau plan** (bouton de la liste), ou bouton **Préparer le plan de match** d'un événement Match / Scrim /
   Tournoi du planning : le plan est alors lié à l'événement (sa date, son adversaire).
2. **Le match** : titre, événement du planning (ou une date libre), adversaire (fiche de scouting ou simple nom),
   match de tournoi, format (libre, BO1, BO3, BO5).
3. **Veto** (Valorant et jeu générique) : étapes dans l'ordre (Nous / Eux, Ban / Pick / Decider), la map visée,
   jusqu'à trois **replis** si elle n'est plus libre, une note. « Veto type BO3 » pose l'ordre habituel d'un coup.
   Pour The Finals il n'y a pas de veto : chaque arène porte son **mode attendu**.
4. **Une section par map** :
   - **Composition** : un joueur par ligne (membre de la team ou nom libre), son personnage, son rôle (IGL, entry,
     lurk… proposés en un appui, ou texte libre). Valorant : cinq lignes ; The Finals : trois, avec l'arme, la
     spécialisation, trois gadgets et la réserve (listes du profil de jeu quand il les connaît, sinon texte libre).
     La composition de la map précédente se reprend en un appui.
   - **Strats prévues** : dans l'ordre, par side (ou mode) et par type de round (pistol, éco, force, bonus, défaut,
     exécution, retake, autre). Chaque ligne vient d'une **strat de la team**, d'une **entrée du playbook**, ou
     d'un simple titre, avec une note.
   - **Lineups clés** : choisis parmi les lineups de cette map (module [Lineups](lineups.md)).
   - **Conditions de victoire**, **tendances adverses**, **calls et consignes**, notes.
5. **Checklist d'avant-match** (une checklist type est proposée) et **notes générales**.
6. **Marquer « prêt »** : jusque-là le plan est un brouillon que seule l'équipe d'encadrement voit. Prêt, toute la
   team le lit et reçoit une **notification** qui ouvre le plan.
7. Le jour du match : cochez la checklist sur la page du plan (les cases sont gardées avec le plan).
8. Après le match : **Marquer « joué »**, **lier le résultat** saisi dans Compétition › Résultats, et **Planifier le
   debrief** : un événement « Review » est créé au planning.

Autres actions (menu **⋯** de la page) : **Dupliquer** (copie en brouillon, sans événement), **Enregistrer comme
modèle** (compositions, veto et checklist habituels : « Nouveau plan » propose ensuite de partir d'un modèle),
**Imprimer** (boîte d'impression du navigateur : papier ou PDF ; site et app PC), repasser en brouillon,
**Supprimer** (corbeille de 30 jours, menu ⋯ de la liste).

Si deux personnes modifient le même plan, la seconde est prévenue par un bandeau et rien n'est écrasé.

## Pour un joueur

- **Notification « Le plan de match contre X est prêt »** : elle ouvre le plan.
- **Accueil de la team** : carte **Prochain plan de match** quand un plan est lié à un événement à venir.
- **Planning** : sur un événement Match / Scrim / Tournoi, bouton **Plan de match**.
- **Page du plan** : en haut, l'adversaire, la date, le format et les maps ; puis **Mon rôle** (ce que vous jouez
  sur chaque map : personnage, rôle, équipement, note), le veto, et pour chaque map la composition (votre ligne
  est mise en avant), les strats prévues (un appui ouvre la strat), les lineups clés (un appui ouvre le lineup),
  les conditions de victoire, les tendances adverses et les calls. La checklist se lit, le staff la coche.
- Le joueur ne voit ni les brouillons ni les modèles, et ne modifie rien.

## Droits

| Permission | Ce qu'elle permet | Rôles par défaut |
| --- | --- | --- |
| `plans.voir` | Lire les plans prêts et joués | Propriétaire, Manager, Coach, Analyste, Joueur, Remplaçant |
| `plans.editer` | Créer, modifier, publier, cocher la checklist, dupliquer, supprimer | Propriétaire, Manager, Coach |

Les notes de la **fiche de scouting** liée (notes générales, tendances par map) s'affichent en lecture seule dans
le plan, uniquement pour ceux qui ont le droit de voir le scouting ; le nom de l'adversaire, lui, fait partie du
plan. Planifier le debrief demande aussi le droit de créer un événement au planning.

Le module est **activé d'office** dans les teams qui ont déjà les strats ou le planning. Ailleurs : Réglages ›
Paramètres › Modules. Les rôles personnalisés (et le modèle des rôles des nouvelles teams, si vous l'avez modifié)
ne reçoivent pas ces permissions tout seuls : cochez-les dans Administration › Rôles et permissions.

## Notifications et Discord

| Quand | Qui est prévenu | Où mène la notification |
| --- | --- | --- |
| Un plan passe à « prêt » | Tous les membres qui lisent les plans, sauf celui qui l'a publié | La page du plan |

**Discord (facultatif, désactivé par défaut)** : Réglages › Discord › « Plan de match prêt ». Le message ne peut
contenir que l'adversaire (`{contre}`), la date (`{pourLe}`), le nom de la team et un lien vers l'app. Ni le titre
du plan, ni les maps, ni les compositions, ni les strats, ni aucune note ne sont disponibles pour ce message.

## Confidentialité

- **IA** : les tâches `plans-match`, `plan-match`, `plan-de-match`, `plans_match` sont rangées avec `strats` dans
  `esport/noyau/ia/confidentialite.mjs` (IA locale seulement). L'assistant d'écriture n'est branché sur aucun champ
  d'un plan, et le serveur refuse le champ `plans-match` (`403 ecriture-confidentielle`).
- **Événements, journal et notifications** : ils ne portent que le titre du plan, l'adversaire et la date.
- **RGPD** : l'export des données d'un compte contient les plans qu'il a créés (titre, statut, date, adversaire) et
  les lignes de composition qui le désignent ; à l'effacement du compte, les plans restent à la team sans auteur
  et il sort des compositions.
- **Export / import de la base** : table `plans_match`.

## Limites connues

- Un événement du planning n'a qu'un plan (une occurrence d'une série a le sien).
- Si l'événement lié est déplacé, la date du plan suit ; s'il est supprimé, le plan garde sa dernière date.
- Le veto est une intention : il n'est pas rapproché du résultat réel du match.
- Les cases de la checklist sont communes au plan (pas une liste par joueur), cochées par le staff.
- L'impression n'est proposée que sur le site et l'app PC.
- Le bouton « Voir au planning » ouvre le planning de la team, pas directement l'événement.

## Pour les développeurs

| Élément | Où |
| --- | --- |
| Migration | `esport/migrations/0083_plans_match.sql` |
| Service, routes, événements, RGPD | `esport/noyau/plans/{service,routes,bus,rgpd}.mjs` |
| Interface | `src/esport/ui/plans/` (`Plans.tsx`, `PagePlan.tsx`, `EditeurPlan.tsx`, `Raccourcis.tsx`) |
| Logique pure | `src/esport/plans/logique.ts` (tri, filtres, veto type, « mon rôle », document imprimable) |
| Tests | `esport/test/plans-match.test.mjs` (SQLite et PostgreSQL), `src/esport/Plans.test.tsx`, `scripts/e2e-esport-plans.mjs` |

API (toutes sous `/teams/<team>`, session obligatoire) :

| Méthode et chemin | Rôle |
| --- | --- |
| `GET /plans` | Liste (`?statut`, `?adversaire`), modèles, droits |
| `POST /plans` | Créer (`evenementId` et `occurrence`, `date`, `adversaireId` ou `adversaireNom`, `format`, `contenu`, `depuis` : plan ou modèle recopié) |
| `GET /plans/evenement?evenement=&occurrence=` | Plan d'une occurrence du planning |
| `GET /plans/prochain` | Prochain plan lié à un événement à venir |
| `GET /plans/liens` | Ce que l'éditeur peut lier (événements, adversaires, matchs, résultats, membres, strats, playbook, lineups) |
| `GET`, `PATCH`, `DELETE /plans/<id>` | Lire, modifier (statut compris ; en-tête `X-Version-Lue` : `409 conflit-version`), supprimer (corbeille) |
| `PUT /plans/<id>/coches` | Cases cochées de la checklist |
| `POST /plans/<id>/dupliquer` | Copie, ou modèle (`{ modele: true }`) |
| `POST /plans/<id>/debrief` | Événement « Review » (`{ date, heureDebut, heureFin }`) |
| `GET /plans/corbeille` · `POST /plans/<id>/restaurer` | Corbeille |
