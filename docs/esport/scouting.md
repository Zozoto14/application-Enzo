# Esport : scouting adverse (phase 5)

Module `scouting` : fiches adversaires. **Donnée sensible** : visible uniquement avec `scouting.view`, modifiable
avec `scouting.manage`. Un Joueur n'a aucune entrée dans la barre et reçoit **403** en appel direct.

| Rôle (système) | Voir | Gérer |
| --- | --- | --- |
| Propriétaire, Coach, Analyste | oui | oui |
| Manager | oui | non |
| Joueur, Remplaçant / Invité | non | non |

La migration 0005 donne ces permissions aux rôles système déjà créés. Contrôles : session → appartenance (404) →
module (404) → permission (403) ; toute requête filtre sur `team_id` (un adversaire d'une autre team est 404).

## Contenu d'une fiche

- **Fiche** : nom, logo (adresse `https://…` ; pas de fichier déposé : une adresse suffit et évite un stockage public),
  notes générales.
- **Joueurs adverses** : pseudo, Riot ID, rôle, agents joués, notes.
- **Tendances par map et par side** (attaque, défense, les deux) : notes, compositions habituelles (une par ligne),
  taux de victoire facultatif (0 à 100).
- **VODs** : liens https avec titre. **« Ouvrir en review vidéo »** : crée la review de la VOD (YouTube
  seulement) et la lie ; un second appui rend la même review ; si la review a été supprimée, une nouvelle est
  créée. Il faut `scouting.manage` et `video_review.create` (ou `video_review.view` pour ouvrir une review déjà
  liée).
- **Historique des confrontations** : les événements du planning dont l'adversaire est cette fiche
  (`adversaire_id`), du plus récent au plus ancien, avec la review liée à l'événement. Visible seulement si le
  rôle voit le planning.

## Lien avec le planning

Le formulaire d'événement du planning propose le **sélecteur d'adversaire** (si le rôle a `scouting.view` et le
module est activé). Le serveur n'accepte qu'un adversaire (ou une review) **de la même team**, visible par celui
qui le lie ; effacer (`null`) est toujours permis. Supprimer une fiche détache ses événements.

## Bus et journal

`opponent.created|updated|deleted` et `opponent.detail_changed` (`{ adversaire, partie: joueur|tendance|vod,
action: ajout|modification|suppression|review|liaison, nom }`), journalisés. Une VOD ouverte en review publie aussi
`review.created` (avec `adversaireId` et `depuisVod`).

## API (préfixe facultatif `/api/esport`)

| Méthode et route | Permission |
| --- | --- |
| `GET /teams/:t/scouting/adversaires` ; `GET …/:a` | scouting.view |
| `POST /teams/:t/scouting/adversaires` ; `PATCH \| DELETE …/:a` | scouting.manage |
| `POST \| PATCH \| DELETE …/:a/joueurs[/:x]`, `…/tendances[/:x]`, `…/vods[/:x]` | scouting.manage |
| `POST …/:a/vods/:x/review` (corps `{ reviewId? }` pour lier une review existante) | scouting.manage + video_review |

## Code et tests

`esport/noyau/scouting/service.mjs` (routes : `esport/noyau/review/routes.mjs`) ; app : `src/esport/ui/scouting/` ;
graines : `esport/outils/graines-review.mjs` ; tests : `esport/test/scouting.test.mjs`,
`src/esport/review/review.test.tsx`, e2e `scripts/e2e-esport-review.mjs`.
