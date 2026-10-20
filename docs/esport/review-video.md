# Esport : review vidéo (phase 5)

Module `video_review` : analyser un match ou un scrim posé sur YouTube, avec des repères horodatés, des notes
et un fil de commentaires par repère. Rien à déployer à la main : relancer le workflow « Esport (Worker) »
applique la migration `esport/migrations/0005_review_scouting.sql`.

## Ce que voit chacun

| Rôle (système) | Voir | Créer / renommer | Repères et commentaires | Supprimer |
| --- | --- | --- | --- | --- |
| Propriétaire, Coach | oui | oui | oui (tous les repères modifiables) | tout |
| Analyste | oui | oui | oui | ses repères et commentaires |
| Joueur | oui | non | oui : ajoute et commente ; modifie et supprime SES contributions | non (ni la review, ni le travail d'un autre) |
| Manager | oui | non | non | non |
| Remplaçant / Invité | non | non | non | non |

Permissions : `video_review.view|create|annotate|delete`. Contrôles dans l'ordre : session → appartenance à la
team (404) → module activé (404) → permission (403). Une review d'une autre team est introuvable (404).
La migration 0005 donne aux rôles système **déjà créés** les permissions ci-dessus (idempotente ; rôles
personnalisés inchangés).

## Création

Adresse YouTube **watch**, **youtu.be**, **shorts**, **embed** ou **live** (aussi `m.youtube.com`,
`music.youtube.com`, `youtube-nocookie.com`, avec ou sans `https://`). L'identifiant (11 caractères) est extrait
et validé par le serveur (`esport/noyau/review/youtube.mjs`, miroir `src/esport/review/youtube.ts`) ; tout autre
hôte (`youtube.com.exemple.fr`…) est refusé. L'adresse stockée est canonique. Un `t=` dans l'adresse donne la
position de départ.

## Lecteur

- **Site et app PC** : API YouTube IFrame (script `https://www.youtube.com/iframe_api`, chargé à l'ouverture
  d'une review ; vidéo servie par `youtube-nocookie.com`). Temps courant interrogé 4 fois par seconde,
  `seekTo`, vitesse (0,5× à 2×). Si le propriétaire interdit la lecture intégrée, un lien ouvre YouTube.
- **App iOS native** (sans WebView) : lecture seule de la liste des repères ; chaque repère ouvre la vidéo dans
  YouTube au bon timestamp (`&t=83s`). Les commentaires restent lisibles et écrivables ; pas d'ajout, de
  modification ni de suppression de repère, pas d'export PDF.

## Repères

- Timeline sous le lecteur : un repère par pastille colorée (erreur rouge ✕, bonne action verte ✓, utilitaires
  bleu ◆, placement ambre ⌖, comms violet ✉ : le glyphe double la couleur) ; les durées sont des barres ; un clic
  saute au repère ; un clic sur la piste saute à l'instant.
- **Touche M** (site, app PC) : ajoute un repère au temps courant et met la vidéo en pause. Ignorée pendant la
  saisie dans un champ. Champs : instant (modifiable), titre, catégorie, joueur concerné, durée facultative,
  note.
- **Note** : Markdown limité (`**gras**`, `*italique*`, `` `code` ``, listes `-` et `1.`, titres `#` à `###`,
  liens `[texte](https://…)`). Nettoyée côté serveur (`nettoyerNote` : HTML neutralisé en `&lt;`, images et
  définitions de liens retirées, liens http(s) seulement) et rendue côté app par des composants, **jamais en HTML
  brut**.
- Liste latérale triée, synchronisée avec la lecture (repère en cours mis en avant et visible), filtres par
  catégorie, joueur et auteur.
- Fil de commentaires par repère.

## Exports

- **Markdown** : `GET /teams/:t/review/:id/export.md` (`?format=json` : `{ nom, type, contenu }`, utilisé par
  l'app). Titre, repères triés avec lien à l'instant, joueur, auteur, note, commentaires.
- **PDF par impression** (site, app PC) : le Markdown exporté devient un document HTML échappé posé dans la page
  (`#impression-esport`, visible seulement à l'impression), puis `window.print()` : choisir « Enregistrer au
  format PDF ». Pas de fenêtre ni de cadre (l'app PC les bloque).

**Limite connue** : pas de dessin sur la vidéo YouTube ; les notes sont liées à un instant (timestamp) seulement.

## CSP et en-têtes

- **Site** (Cloudflare Pages, `bureau/public/_headers`) et **app PC** : aucune CSP n'est posée aujourd'hui, YouTube
  fonctionne donc tel quel. Le jour où une CSP sera ajoutée, autoriser au minimum :
  `script-src https://www.youtube.com https://s.ytimg.com` ; `frame-src https://www.youtube.com
  https://www.youtube-nocookie.com` ; `img-src https://i.ytimg.com https://*.ytimg.com` ;
  `connect-src https://www.youtube.com`. La liste est aussi en commentaire dans `_headers`.
- **App PC (Electron)** : les sous-cadres sont bloqués sauf les lecteurs déclarés de Tsuzuku ; la review ajoute
  seulement `https://www.youtube(-nocookie).com/embed/<id>` (`bureau/electron/youtube.mjs`, testé), et pose un
  référent générique sur cette requête (YouTube refuse parfois une page `file://` sans référent, erreur 153).
- **API Esport** : réponses de fichiers en `default-src 'none'` (inchangé).

## Bus d'événements et journal

`review.created` (charge `{ titre, videoId, url, reference, adversaireId?, depuisVod? }` : **Discord s'y abonne**),
`review.updated`, `review.deleted`, `review.marker_added|updated|deleted`, `review.comment_added|deleted`.
Notifications in-app : nouvelle review (lecteurs de la review), commentaire sur son repère.

## API (préfixe facultatif `/api/esport`)

| Méthode et route | Permission |
| --- | --- |
| `GET /teams/:t/review` | video_review.view |
| `POST /teams/:t/review` `{ titre, url, reference? }` | video_review.create |
| `GET /teams/:t/review/:id` | video_review.view |
| `PATCH /teams/:t/review/:id` | video_review.create |
| `DELETE /teams/:t/review/:id` | video_review.delete |
| `GET /teams/:t/review/:id/export.md` | video_review.view |
| `POST /teams/:t/review/:id/reperes` `{ debut, fin? \| duree?, categorie, titre, note?, cible? }` | video_review.annotate |
| `PATCH \| DELETE /teams/:t/review/:id/reperes/:r` | auteur (annotate) ou create / delete |
| `POST /teams/:t/review/:id/reperes/:r/commentaires` `{ texte }` | video_review.annotate |
| `DELETE /teams/:t/review/:id/reperes/:r/commentaires/:c` | auteur (annotate) ou delete |

## Code et tests

- Cœur portable : `esport/noyau/review/` (`youtube.mjs`, `markdown.mjs`, `export.mjs`, `service.mjs`, `routes.mjs`,
  `bus.mjs`). SQL standard (SQLite/D1, Postgres).
- App : `src/esport/review/` (client, libellés, Markdown, impression) et `src/esport/ui/review/` ;
  `Lecteur.web.tsx` (IFrame) / `Lecteur.tsx` (iOS), `raccourci.web.ts`, `impression.web.ts`.
- Graines : `esport/outils/graines-review.mjs` (`npm run esport:local`).
- Tests : `esport/test/review.test.mjs`, `src/esport/review/review.test.tsx`, `bureau/electron/youtube.test.mjs`,
  e2e `scripts/e2e-esport-review.mjs` (faux script YouTube intercepté, aucun appel à YouTube).
