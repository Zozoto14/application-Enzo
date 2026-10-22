# Esport : review vidéo (phase 5)

Module `video_review` : analyser un match ou un scrim posé sur YouTube **ou déposé sur le site** (vidéo envoyée par
morceaux, lecteur maison : voir [videos.md](videos.md)), avec des repères horodatés, des notes,
un fil de commentaires par repère, des réactions 👍 / 👎 et des dessins posés sur la vidéo (v2). Rien à
déployer à la main : le déploiement automatique du serveur (o2switch) applique les migrations
`esport/migrations/0005_review_scouting.sql` et `0010_review_v2.sql`.

## Ce que voit chacun

| Rôle (système) | Voir | Créer / renommer | Repères, commentaires, dessins | Réagir 👍 / 👎 | Supprimer |
| --- | --- | --- | --- | --- | --- |
| Propriétaire, Coach | oui | oui | oui (tous les repères modifiables) | oui | tout |
| Analyste | oui | oui | oui | oui | ses repères et commentaires |
| Joueur | oui | non | oui : ajoute, commente, dessine ; modifie et supprime SES contributions | oui | non (ni la review, ni le travail d'un autre) |
| Manager | oui | non | non | oui | non |
| Remplaçant / Invité | non | non | non | non | non |

Permissions : `video_review.view|create|annotate|delete|react` (`annotate` couvre aussi le dessin). Contrôles dans l'ordre : session → appartenance à la
team (404) → module activé (404) → permission (403). Une review d'une autre team est introuvable (404).
La migration 0005 donne aux rôles système **déjà créés** les permissions ci-dessus ; la migration 0010 leur
ajoute `video_review.react` (Manager, Coach, Analyste, Joueur : tous ceux qui voient la review). Idempotentes ;
rôles personnalisés inchangés (à cocher dans la matrice des rôles si besoin).

## Création

Adresse YouTube **watch**, **youtu.be**, **shorts**, **embed** ou **live** (aussi `m.youtube.com`,
`music.youtube.com`, `youtube-nocookie.com`, avec ou sans `https://`). L'identifiant (11 caractères) est extrait
et validé par le serveur (`esport/noyau/review/youtube.mjs`, miroir `src/esport/review/youtube.ts`) ; tout autre
hôte (`youtube.com.exemple.fr`…) est refusé. L'adresse stockée est canonique. Un `t=` dans l'adresse donne la
position de départ.

## Lecteur

Une review a une **source** : YouTube (ci-dessous) ou un **fichier déposé** (lecteur HTML5 maison, lecture par plages,
image par image avec « , » et « . », plein écran ; détails dans [videos.md](videos.md)). Timeline, repères, réactions,
commentaires et dessin sont les mêmes pour les deux.

- **Site et app PC** : API YouTube IFrame (script `https://www.youtube.com/iframe_api`, chargé à l'ouverture
  d'une review ; vidéo servie par `youtube-nocookie.com`). Temps courant interrogé 4 fois par seconde,
  `seekTo`, vitesse (0,5× à 2×). Si le propriétaire interdit la lecture intégrée, un lien ouvre YouTube.
- **App iOS native** (sans WebView) : lecture seule de la liste des repères ; chaque repère ouvre la vidéo dans
  YouTube au bon timestamp (`&t=83s`). Les commentaires et les réactions restent utilisables ; pas d'ajout, de
  modification ni de suppression de repère, pas de dessin (un repère dessiné affiche ✏️ et « Dessin disponible
  sur le site ou le PC »), pas d'export PDF.

## Repères

- Timeline sous le lecteur : un repère par pastille colorée (erreur rouge ✕, bonne action verte ✓, utilitaires
  bleu ◆, placement ambre ⌖, comms violet ✉ : le glyphe double la couleur) ; les durées sont des barres ; un clic
  saute au repère ; un clic sur la piste saute à l'instant.
- **Touche M** (site, app PC) : ajoute un repère au temps courant et met la vidéo en pause. Ignorée pendant la
  saisie dans un champ. Champs : instant (modifiable), titre, catégorie, joueur concerné, durée facultative,
  note.
- **Note** : Markdown limité, jusqu'à 8000 caractères (commentaires : 1000). Éléments : paragraphes, `**gras**`,
  `*italique*`, `~~barré~~`, `==surlignage==`, `{{couleur|texte}}`, `@pseudo`, `` `code` `` et blocs de code
  (```), citations `>`, séparateur `---`, titres `#` à `###`, listes à puces (`-`, `*`), numérotées (`1.`) et
  cases (`- [ ]`, `- [x]`) avec retraits (3 niveaux), liens `[texte](https://…)`. Nettoyée côté serveur
  (`nettoyerNote` : HTML neutralisé en `&lt;` `&gt;` y compris dans le code, images et définitions de liens
  retirées, liens http(s) seulement, couleur hors liste = texte seul ; le `>` de citation en début de ligne
  reste, le reste de la ligne est neutralisé) et rendue côté app par des composants, **jamais en HTML brut** (même
  liste d'éléments dans `src/esport/review/markdown.ts`, qui sert aussi à l'impression PDF).
  - **Couleurs** : syntaxe maison `{{rouge|texte}}`, huit couleurs prédéfinies seulement (rouge, orange, jaune,
    vert, bleu, violet, rose, gris), validées côté serveur ET à l'affichage ; pas de couleur libre, pas de CSS.
    Pas de couleurs imbriquées. Le surlignage est un jaune fixe (`==texte==`).
  - **Pas de souligné** : le Markdown limité ne l'a pas (le soulignement se confond avec un lien). Le bouton S et
    **Ctrl/Cmd+U** appliquent le **barré**.
  - **@mentions** : `@pseudo` (lettres, chiffres, `_ . -`), mis en valeur à l'affichage ; l'autocomplétion
    propose les joueurs de la team dans le formulaire de repère. C'est un repère visuel : aucune notification.
- **Éditeur** (`src/esport/ui/ChampNote.tsx`, logique pure `src/esport/review/formatage.ts`) au-dessus des champs de
  note : zone de saisie de 11 lignes sur PC et 8 sur téléphone, qui grandit avec le texte (jusqu'à 560 px sur PC,
  380 px sur téléphone, puis défile), poignée de redimensionnement sur le web, bouton **Agrandir** (plein écran :
  éditeur et aperçu côte à côte dès 900 px de large, onglets Écrire / Aperçu sinon), aperçu repliable, compteur
  de caractères visible à partir de 80 % de la limite. Barre : annuler / rétablir, **B**, *I*, ~~S~~, liste à
  puces, case, lien, surlignage, couleur, H1 à H3, liste numérotée, citation, code, bloc de code, séparateur,
  emoji, @ ; sur petit écran, la barre défile horizontalement et « ⋯ » ouvre le reste. Boutons de 44 px.
  Les cases sont cochables dans l'aperçu.
  - **Raccourcis** (site, app PC) : Ctrl/Cmd+**B**, **I**, **U** (barré), Maj+**X** (barré), **K** (lien),
    Maj+**7** (liste numérotée), Maj+**8** (liste à puces), **Z** (annuler), **Y** ou Maj+Z (rétablir). **Entrée**
    continue une liste (puce, numéro suivant, case décochée, citation) ; Entrée sur un élément vide en sort (ou
    remonte d'un niveau) ; **Tab** / **Maj+Tab** indentent les listes. L'historique annuler / rétablir est propre
    à l'éditeur (la sélection est entourée de la marque ; un second appui la retire).
  - Dans le formulaire de repère, un `<` écrit dans une note est stocké `&lt;` par le serveur et redevient `<`
    quand la note est rouverte dans l'éditeur.
  - Réutilisé ailleurs dans l'Esport, avec un rendu Markdown à l'affichage : note du dépôt (résumés), description
    des tâches, notes du scouting (fiche, joueurs adverses, tendances), notes d'étape des strats, commentaires.
    Ces zones ont leurs propres limites (1000 à 2000 caractères), inchangées ; l'@mention n'est proposée que dans
    les repères.
- Liste latérale synchronisée avec la lecture (repère en cours mis en avant et visible), filtres par catégorie,
  joueur et auteur, **tri** par instant, « plus likés 👍 » ou « plus dislikés 👎 ».
- Fil de commentaires par repère (rendu Markdown).

## Réactions 👍 / 👎

- Sur chaque repère (liste et détail) et sur chaque commentaire : **une réaction par membre et par cible**
  (contrainte d'unicité en base), qu'il change (👍 ↔ 👎) ou retire (second appui).
- Compteurs visibles par tous les lecteurs ; la liste des personnes s'affiche au survol (site, app PC) ou à
  l'appui long (doigt), et figure dans le nom accessible du bouton.
- Pas de notification ni de Discord : seul l'événement `review.reaction_changed` part sur le bus (journal).
- Export RGPD (`reviewReactions`) ; supprimées avec le compte.

## Dessin sur la vidéo

On ne peut pas dessiner DANS l'iframe YouTube : un **calque transparent** est posé par-dessus le lecteur (même
cadre 16:9).

- **« ✏️ Dessiner »** (site, app PC, iPad dans le navigateur ; permission `video_review.annotate`) : la vidéo se
  met en pause, le calque s'active. Outils : flèche, cercle, rectangle, trait libre, texte, gomme ; 6 couleurs,
  3 épaisseurs ; annuler et rétablir. Éditeur Konva (`CalqueDessin.web.tsx`) chargé à la demande, comme
  l'éditeur de strats.
- **Enregistrement** : rattaché au repère qui commence au timestamp courant (à 0,5 s près, si on peut le
  modifier), sinon un repère « Dessin mm:ss » (Placement) est créé. Coordonnées **relatives (0 à 1)** : le dessin
  suit la taille du lecteur.
- **Lecture** : quand la vidéo passe sur un repère dessiné, le dessin s'affiche par-dessus (SVG, les clics
  traversent) pendant la durée du repère, ou 3 s par défaut ; en continu tant que la vidéo est en pause sur ce
  repère. Bouton « Masquer / Afficher les dessins ». Miniature et icône ✏️ dans la liste des repères.
- **Serveur** (`esport/noyau/review/dessin.mjs`) : JSON `{ v: 1, objets: [{ t, c, e, p, x? }] }` validé (types
  connus, couleur `#rrggbb`, épaisseur 1 à 20, coordonnées 0 à 1, 100 formes, 200 points par trait, 120
  caractères par texte, 32 Ko au plus) ; colonne `review_reperes.dessin`.
- **Exports** : mention dans le Markdown et le PDF (« ✏️ Dessin sur la vidéo : 1 forme (flèche)… ») ; dessin
  complet dans l'export RGPD (`reviewReperes[].dessin`).

## Exports

- **Markdown** : `GET /teams/:t/review/:id/export.md` (`?format=json` : `{ nom, type, contenu }`, utilisé par
  l'app). Titre, repères triés avec lien à l'instant, joueur, auteur, réactions, mention du dessin, note,
  commentaires.
- **PDF par impression** (site, app PC) : le Markdown exporté devient un document HTML échappé posé dans la page
  (`#impression-esport`, visible seulement à l'impression), puis `window.print()` : choisir « Enregistrer au
  format PDF ». Pas de fenêtre ni de cadre (l'app PC les bloque).

## CSP et en-têtes

- **Site** (`bureau/public/_headers`, traduit en `.htaccess` chez o2switch) et **app PC** : aucune CSP n'est posée aujourd'hui, YouTube
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
`review.updated`, `review.deleted`, `review.marker_added|updated|deleted`, `review.comment_added|deleted`,
`review.reaction_changed` (journal seulement).
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
| `POST /teams/:t/review/:id/reperes` `{ debut, fin? \| duree?, categorie, titre, note?, cible?, dessin? }` | video_review.annotate |
| `PATCH \| DELETE /teams/:t/review/:id/reperes/:r` | auteur (annotate) ou create / delete |
| `POST /teams/:t/review/:id/reperes/:r/commentaires` `{ texte }` | video_review.annotate |
| `DELETE /teams/:t/review/:id/reperes/:r/commentaires/:c` | auteur (annotate) ou delete |
| `PUT \| DELETE /teams/:t/review/:id/reperes/:r/reaction` `{ valeur: 'like' \| 'dislike' \| null }` | video_review.react |
| `PUT \| DELETE /teams/:t/review/:id/reperes/:r/commentaires/:c/reaction` | video_review.react |

## Code et tests

- Cœur portable : `esport/noyau/review/` (`youtube.mjs`, `markdown.mjs`, `dessin.mjs`, `export.mjs`, `service.mjs`, `routes.mjs`,
  `bus.mjs`). SQL standard (SQLite, PostgreSQL).
- App : `src/esport/review/` (client, libellés, Markdown, `formatage.ts`, `dessin.ts`, impression) et
  `src/esport/ui/review/` ; `Lecteur.web.tsx` (IFrame, calque par-dessus) / `Lecteur.tsx` (iOS),
  `dessinVideo.web.tsx` (SVG + Konva) / `dessinVideo.tsx` (iOS), `BarreDessin.tsx`, `Reactions.tsx`,
  `raccourci.web.ts`, `impression.web.ts` ; `src/esport/ui/ChampNote.tsx`.
- Graines : `esport/outils/graines-review.mjs` (`npm run esport:local`).
- Tests : `esport/test/review.test.mjs`, `esport/test/review-v2.test.mjs`, `src/esport/review/review.test.tsx`,
  `src/esport/review/review-v2.test.tsx`, `src/esport/review/note-editeur.test.tsx` (éditeur), `bureau/electron/youtube.test.mjs`,
  e2e `scripts/e2e-esport-review.mjs`, `scripts/e2e-esport-review-v2.mjs` et `scripts/e2e-esport-notes.mjs` (éditeur de notes ;
  faux script YouTube intercepté, aucun appel à YouTube).
