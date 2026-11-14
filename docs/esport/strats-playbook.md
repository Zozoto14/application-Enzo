# Esport : éditeur de strats et playbook

> Modèles de strat par jeu (Valorant, The Finals, générique), capacités à l'échelle, phases, lecture animée,
> exports PDF : voir [strats.md](strats.md). Lineups de la team (images, vue par map, liens avec les strats) :
> voir [lineups.md](lineups.md). Préparation d'un match (veto, compositions, strats par round) : voir
> [plans-match.md](plans-match.md).

Deux modules de la phase 6, activables par team (Paramètres de la team) :

- **Strats** (`strat_editor`) : un éditeur de stratégies sur la minimap, dans l'esprit de valoplant.gg ;
- **Playbook** (`playbook`) : la bibliothèque de la team (strats validées par carte, side et type, et
  protocoles écrits).

> **AppDashboard was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games.
> Riot Games does not endorse or sponsor this project.**

Cette mention est obligatoire : elle est affichée dans l'éditeur, la liste des strats, le playbook, et sur la
page publique d'une strat partagée.

## Images Riot (décision du Fondateur)

Les images des cartes (minimap), des agents et de leurs capacités sont les **images Riot directes**, sous la
politique Riot « Legal Jibber Jabber » (contenu de fan) : usage **gratuit et non commercial**, avec la mention
ci-dessus. Aucune image n'est versionnée dans le dépôt : tout est chargé **à l'exécution** depuis l'API
publique **valorant-api.com** (JSON) et son CDN **media.valorant-api.com** (images).

Ordre de chargement (`src/esport/strats/assets.ts`) :

1. **Dossier d'assets remplaçable** : `bureau/public/esport-assets/manifeste.json`, s'il existe (absent par
   défaut). Copiez `manifeste.exemple.json` en `manifeste.json` pour remplacer les données et les images par
   les vôtres (images posées dans ce dossier, chemins `esport-assets/…`, ou adresses du CDN).
2. **Cache local** (navigateur, 7 jours) : cartes, agents et capacités ; les images, elles, sont gardées par le
   Cache Storage du navigateur (hors ligne après une première visite).
3. **valorant-api.com** : cartes de compétition (celles qui ont une minimap), agents jouables et leurs quatre
   capacités (C, Q, E, X), en français.
4. **Cache local périmé**, si l'API ne répond pas.
5. **Repli générique** intégré : noms des cartes et des agents, jetons de couleur avec initiales, fond uni.
   L'éditeur reste entièrement utilisable sans réseau.

Les images passent par `fetch` puis une adresse `blob:` locale : le canevas n'est jamais « contaminé » et
l'export PNG marche toujours. Le document d'une strat garde l'adresse des icônes : le serveur n'accepte que le
CDN `https://media.valorant-api.com/…` ou un fichier du dossier `esport-assets/` (rien d'autre, ni `data:`).

**Maps et agents du profil de jeu** ([profils-jeu.md](profils-jeu.md)) : les listes (création d'une strat, pastilles
de l'éditeur, filtres, playbook, ressources) viennent du profil du jeu de la team ; pour Valorant, les images Riot
ci-dessus habillent les maps et agents du profil (une map retirée du pool n'est plus proposée à la création, mais une
strat existante sur cette map reste éditable). **Autre jeu** (champ `jeu` = `autre` dans le document) : éditeur
générique, sans fond de carte ni capacités, pions à initiales, et sans la mention Riot.

### CSP

- **Site (`bureau/public/_headers`, traduit en `.htaccess` chez o2switch) et app PC (Electron)** : aucune Content-Security-Policy
  n'est posée aujourd'hui, donc rien à ouvrir. Le jour où une CSP sera ajoutée, elle devra autoriser au
  minimum `connect-src https://valorant-api.com https://media.valorant-api.com` et
  `img-src https://media.valorant-api.com blob: data:` (rappel en commentaire dans `_headers`).
- **Page publique d'une strat partagée** (serveur Esport) : CSP stricte,
  `default-src 'none'; img-src https://media.valorant-api.com data:; style-src 'unsafe-inline'; frame-ancestors 'none'`.

## L'éditeur

Sur le **site** et l'**app PC** (Windows) : éditeur complet. Le canevas utilise **Konva** (react-konva),
chargé **à la demande** à l'ouverture de l'éditeur : il n'alourdit pas le démarrage du site (morceau séparé
`CanevasStrat.web-….js`, environ 100 Ko compressés).

Sur l'**app iOS native** (pas de WebView) : la strat s'ouvre en **lecture seule** (miniature et notes de chaque
étape). Pour éditer depuis un iPad, ouvrez le **site** dans Safari : le tactile y est pris en charge.

- **Carte et side** : choix de la carte (minimap en fond) et du side (attaque ou défense).
- **Agents** : choisissez un joueur (1 à 5, chacun sa couleur), un agent, puis touchez la carte.
- **Capacités** : outil Capacité, l'agent, la capacité (C, Q, E, X), la forme de zone : **cercle** (smoke,
  molly), **mur / ligne**, **cône** (flash) ou icône seule. La zone prend la couleur du joueur.
- **Dessin** : flèche (tracé à main levée, pointe au bout), ligne, forme (rectangle, ellipse), texte, trait
  plein ou en tirets (rotations).
- **Sélection et déplacement**, **gomme** (touchez un objet pour l'effacer).
- **Zoom et vue** : molette, boutons + / −, pincement à deux doigts sur iPad ; outil Main pour déplacer la vue.
- **Annuler / rétablir** : 100 actions.
- **Calques** : fond (carte), utilitaires (agents, capacités), dessins, texte ; chacun masquable, les trois
  derniers verrouillables.
- **Étapes** : une strat se lit en étapes successives (mise en place, utilitaires, entrée…) ; navigation,
  ajout, **duplication d'une étape** (on part de la précédente), suppression ; titre et note par étape.
- **Enregistrer** : le document est un JSON **versionné** (champ `version`, version 2 aujourd'hui ; une strat
  d'une version antérieure est migrée à la lecture). Chaque enregistrement crée une **révision** (historique :
  les 30 dernières). Si quelqu'un a enregistré entre-temps, l'éditeur le dit (« recharger » ou « garder la
  mienne ») : rien n'est écrasé sans le vouloir.
- **Miniature** : générée à chaque enregistrement (JPEG 320 px de l'étape affichée), stockée dans le **stockage de
  fichiers** du serveur (`fichiers`, disque), affichée dans les grilles par un lien signé d'une heure. Choix : un
  fichier plutôt qu'une data URL en base, pour garder les listes légères. Sans stockage, la strat s'enregistre sans
  miniature.
- **Exporter en PNG** : l'étape affichée, carte entière, 2000 × 2000.
- **Dupliquer la strat**.

### Raccourcis clavier

| Touche | Action |
| --- | --- |
| V, H | Sélection, Main (déplacer la vue) |
| A, C | Agent, Capacité |
| F, L, R, T | Flèche, Ligne, Forme, Texte |
| E | Gomme |
| 1 à 5 | Joueur (et sa couleur) |
| Ctrl+Z, Ctrl+Maj+Z (ou Ctrl+Y) | Annuler, rétablir |
| Suppr | Effacer l'objet sélectionné |
| Ctrl+S | Enregistrer |
| Ctrl+D | Dupliquer l'étape |
| [ et ] | Étape précédente, suivante |
| +, −, 0 | Zoom avant, arrière, vue entière |

### Partage

- **Dans la team** : une strat est « partagée avec la team » (par défaut) ou **privée** (brouillon de son
  auteur, visible aussi du staff qui a `strats.delete`). L'auteur la partage quand elle est prête.
- **Lien en lecture seule** (droit `strats.share`) : bouton **Lien** d'une strat › **Créer un lien** (validité
  facultative, 1 à 365 jours). Le lien (montré une seule fois) ouvre une page sans compte : toutes les étapes
  en image (SVG) avec leurs notes. Le jeton est **signé** (HMAC avec `CLE_ESPORT`) et **révocable** à tout
  moment ; il cesse aussi de marcher si la strat est supprimée, si le module est désactivé, ou si `CLE_ESPORT`
  change. Cinq liens actifs au plus par strat.

## Le playbook

- Une entrée **pointe vers une strat** (sa miniature s'affiche ; un clic ouvre l'éditeur) ou est **purement
  textuelle** (un protocole, valable sur toutes les cartes).
- **Statuts** : brouillon, **validée** (la team est prévenue : notification, journal, et Discord si activé),
  archivée (masquée par défaut). **Favoris** (en tête de grille).
- **Recherche** (titre, description, tags, carte ; sans accents ni casse) et **filtres combinés** : statut,
  carte, side, type, tag, favoris. Vue en grille avec miniatures.
- Bouton **Au playbook** sur une strat (partagée avec la team) pour l'ajouter directement.

## Droits

| Rôle système | Strats | Playbook |
| --- | --- | --- |
| Propriétaire | tout | tout |
| Manager | lecture | lecture |
| Coach | voir, créer, modifier, supprimer, lien de lecture | lecture, gestion |
| Analyste | voir, créer, modifier, lien de lecture (supprime ses propres strats) | lecture, gestion |
| Joueur | lecture | lecture |
| Remplaçant / Invité | — | lecture |

Permissions : `strats.view|create|update|delete|share`, `playbook.view|manage`. La migration
`0006_strats_playbook.sql` ajoute `strats.share` au Coach et à l'Analyste des teams existantes. Tout est
vérifié par le serveur (appartenance → module activé → permission) : un membre d'une autre team ne voit
jamais rien (404).

## Événements

`strat.created`, `strat.updated`, `strat.duplicated`, `strat.deleted`, `strat.share_created`,
`strat.share_revoked`, `playbook.created`, `playbook.updated`, `playbook.validated`, `playbook.archived`,
`playbook.deleted` : tous au journal. Discord : seulement « Entrée du playbook validée » (désactivé par
défaut, à activer dans l'onglet Discord) ; plus de message « Strat créée ».

## API

```
GET  /partage/strats/<jeton>                       page HTML en lecture seule (sans session ; ?format=json)
GET|POST          /teams/:t/strats                 liste (?carte&side&type&tag&q), création
GET|PUT|PATCH|DELETE /teams/:t/strats/:id          détail, enregistrement { revision, donnees, miniature? }, métadonnées, suppression
POST              /teams/:t/strats/:id/dupliquer
GET               /teams/:t/strats/:id/versions    historique ; …/versions/:revision
GET|POST          /teams/:t/strats/:id/partages    liens ; DELETE …/partages/:p
GET|POST          /teams/:t/playbook               (?q&carte&side&type&statut&tag&favoris=1)
PATCH|DELETE      /teams/:t/playbook/:id
```

Limites : document de 256 Ko, 20 étapes, 250 objets par étape, miniature de 256 Ko (PNG ou JPEG).

## Développement et tests

- Graines : `npm run esport:local` sème deux strats (dont une exécution en trois étapes) et un playbook.
- Tests : `node --test esport/test/*.test.mjs` (document, API, playbook, migration), `npx jest src/esport`
  (modèle de l'éditeur, annuler / rétablir, assets et repli hors ligne, écrans).
- Bout en bout : `npx vite build` puis
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-strats.mjs` (faux valorant-api.com
  local, aucun appel réseau réel).
