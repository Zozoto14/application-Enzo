# Esport : Trombinoscope

La page **Membres** de l'Esport a deux onglets :

- **Trombinoscope** (affiché en premier) : une carte par joueur — photo, pseudo, team(s) et jeu, **badges**
  (« Capitaine », « Streamer »…, voir [Badges](#badges)), rôles / postes en jeu, elo, icônes des réseaux — avec
  recherche (pseudo, badge, team, poste, rang) et filtres (team, jeu, rôle / poste du profil de jeu, badge). Un clic
  ouvre la **fiche détaillée** ;
- **Tous les membres** : la liste d'avant (comptes, création, invitations, rôles, Discord ID), inchangée.

Sur téléphone, rien de nouveau dans la barre du bas : ce sont deux onglets de la page Membres. Les raccourcis
« Inviter un joueur » (Teams), « Ouvrir la page Membres » (une team) et l'alerte « invités » du Dashboard ouvrent
directement **Tous les membres**.

Migrations : `esport/migrations/0030_trombinoscope.sql`, `0032_trombi_badges.sql` (badges). Code : `esport/noyau/trombi/`, `src/esport/trombi/`,
`src/esport/ui/membres/`, textes `src/esport/i18n/trombi.ts`.

## Les membres de la Team CM (migration 0068)

La Team CM est une team ([cm.md](cm.md), « La Team CM ») : ses membres (Responsable CM, Correspondants CM, rôles CM
créés) ont leur carte comme les joueurs. Sur la carte : « Team CM · Responsable CM » (le rôle CM à la place du jeu) et
une pastille du rôle ; la recherche trouve aussi le rôle (« Responsable »). Pour un membre qui n'est **que** dans la Team
CM (`staff: true` côté serveur), l'**elo** n'est pas affiché sur la carte, et la fiche ne propose ni postes / personnages
de jeu ni elo à saisir (sauf s'il en a déjà) ; palmarès, anciennes structures, réseaux, photo et badges restent. Un
joueur qui est aussi dans la Team CM garde tout. Le filtre **Team** propose la Team CM.

## La fiche d'un joueur

| Partie | Contenu |
| --- | --- |
| Photo | grand format (carrée), téléchargeable depuis la fiche (site et app PC) |
| Badges | toutes les puces, sous le pseudo, dans l'ordre du catalogue ; bouton **Badges** pour qui attribue |
| Identité | pseudo ; **nom réel** facultatif, **masqué par défaut** (bouton « Afficher le nom réel », et seulement pour qui a le droit de le voir) ; présentation courte |
| Teams | chaque team, le **jeu pratiqué** dans la team, le rôle de team, les **rôles / postes en jeu** et les **personnages** choisis parmi ceux du **profil de jeu de la team** ([profils-jeu.md](profils-jeu.md)) ; à défaut, le poste libre saisi à l'arrivée dans la team |
| Elo / rang | un par jeu : valeur libre (« 2450 ») et / ou rang (« Immortel 2 »), meilleur (pic), **date de mise à jour** (posée seule quand la valeur ou le rang change) |
| Palmarès | **saisi** : compétition, structure, date (AAAA, AAAA-MM ou AAAA-MM-JJ), place (et nombre de participants) ou placement en texte (« Top 8 »), jeu, détails / notes, lien de preuve (https) ; **calculé automatiquement** (encadré « Calculé automatiquement ») depuis les Tournois / Résultats du club : tournois joués (roster ou match aligné), placement final, matchs, victoires / défaites, **MVP** ; hors tournoi : matchs officiels et MVP |
| Anciennes structures | structure, jeu, période (début, fin ; fin vide = jusqu'à l'arrivée au club), rôle |
| Réseaux sociaux pro | X, Instagram, TikTok, Twitch, YouTube, autre site ; adresse du **profil** vérifiée comme sur la page Réseaux du CM |

Le palmarès calculé ne lit que ce qui est **publiable** : tournois non supprimés, ni annulés, « publiables » ; résultats
visibles de toute la team et publiables. **Jamais un résultat réservé au staff.** Il ne se modifie pas : il suit les
modules Tournois et Résultats ([tournois-resultats.md](tournois-resultats.md)).

### Actions

- **Copier le texte (FR)** / **(EN)** : texte prêt pour un post (annonce de recrue, présentation d'un joueur) —
  pseudo, **badges** (« Badges : © Capitaine · Team Alpha, IGL »), team et jeu, postes, elo, palmarès (saisi et calculé), anciennes structures, réseaux. Il ne reprend
  **que les champs visibles de tous les membres** (visibilité « Membres ») : jamais le nom réel, jamais un champ
  réservé au staff ou privé, quel que soit celui qui copie. Sans presse-papiers (app PC ancienne), le texte est
  enregistré en fichier ou affiché.
- **Télécharger la photo** (site, app PC).
- **Visuels du CM** : le modèle **Recrue / Départ** (source « membre ») se pré-remplit avec les **postes** choisis
  dans la fiche (sinon le rôle de team), et propose les champs `{elo}` (elo du jeu de la team) et
  `{ancienne_structure}` (la plus récente) — seulement s'ils sont visibles de tous les membres —, et `{badges}`
  (badges du club et de cette team : « Capitaine · IGL ») ([visuels.md](visuels.md)).

## Qui voit, qui modifie

Deux permissions, `membres.trombi.voir` et `membres.trombi.editer` :

| Qui | Voit | Modifie |
| --- | --- | --- |
| Fondateur | tout le club, tous les champs (privés compris) | tout |
| Membre de la **Team CM** (rôle CM « tout le club ») avec la permission (par défaut **Responsable CM** : voir + compléter ; **Correspondant CM** : voir) | tout le club | (éditer) toutes les fiches |
| Rôle CM affecté **pour une team** (correspondant de la team) | les membres de cette team | (éditer) ces fiches |
| Rôle de team avec la permission (par défaut **Manager** : voir + compléter ; **Coach**, **Analyste** : voir ; Propriétaire : tout) | les membres de cette team | (éditer) ces fiches |
| Un membre sans la permission (Joueur, Remplaçant) | les membres de **ses** teams, champs « Membres » seulement | **sa** fiche seulement |
| Chacun | **sa** fiche, tous ses champs | **sa** fiche (aussi depuis **Teams › Mon profil › Ma fiche du trombinoscope**) |

- Les permissions des rôles de team se changent dans **Paramètres de la team › Rôles** (groupe « Membres et
  rôles ») ; celles des rôles CM dans **Esport › Teams › CM du club › Équipe CM** (« Rétablir » remet les défauts).
  Anti-escalade habituelle : on n'accorde que ce que l'on a.
- Une fiche que l'on ne voit pas répond **404** (on ne dit pas qu'elle existe) ; une écriture non permise **403**.
- **Visibilité par champ** (photo, nom réel, présentation, elo, palmarès, anciennes structures, réseaux), réglée par
  **le joueur seul** (« Qui voit quoi » de sa fiche) :
  - **Membres** : les membres de ses teams, le staff, le CM (défaut, sauf le nom réel) ;
  - **Staff et CM** : seulement ceux qui ont `membres.trombi.voir` (défaut du **nom réel**) ;
  - **Privé** : lui seul (et le Fondateur).

  Un éditeur (staff, CM) ne voit pas les champs privés et ne peut ni les modifier (403 `champ-prive`) ni changer
  la visibilité (403 `visibilite`). Pseudo, teams et postes sont visibles de qui voit la carte.
- Quand un autre que lui complète sa fiche ou change sa photo, le joueur reçoit une **notification**.
- Deux personnes qui modifient la même fiche en même temps : la seconde reçoit « La fiche a été modifiée entre-temps :
  rechargez-la » (409 `version`), rien n'est écrasé.

## Badges

Des **rôles personnalisés** affichés en puces colorées **sous le pseudo** : « Capitaine », « IGL », « Streamer »,
« Créateur de contenu », « Coach », « Manager », « Ambassadeur », « Remplaçant », « Rookie »… Ils complètent les
postes de jeu (« Duelliste ») et le rôle de team (« Joueur »), sans les remplacer.

- **Carte** : sous la ligne « team · jeu », avant les postes, dans l'**ordre du catalogue**, **3 au plus** puis
  « +N » ; **fiche** : toutes, sous le pseudo. Couleur du badge en fond léger et bordure, icône / emoji ou point,
  texte à la couleur du thème (lisible en clair comme en sombre) ; sur téléphone, les puces passent à la ligne.
- Un badge est **global au club** ou **rattaché à une team** : il s'affiche alors « Capitaine · The Final LZ0 », et
  seulement à qui voit cette team. Le même badge global masque sa version de team.
- **Filtre « Badge »** dans les filtres du trombinoscope ; la recherche trouve aussi un nom de badge. (« Tous les
  membres » n'a pas de badges : c'est la liste des comptes.)
- Les badges sont visibles de **tous ceux qui voient la carte** (comme le pseudo et les postes).

### Créer et ranger les badges (catalogue du club)

**Membres › Trombinoscope › bouton « Gérer les badges »** (à côté de « Ma fiche », et dans le menu « ⋯ ») : créer, renommer, couleur (palette ou couleur libre
`#rrggbb`), icône / emoji facultative (un symbole, 4 caractères au plus), **ordre** (↑ ↓ : c'est l'ordre des puces
partout), **supprimer définitivement** (« Modifier » › « Supprimer ») : la confirmation annonce le nombre de
membres qui le portent ; il leur est retiré à tous. 80 badges au plus, noms uniques (sans tenir compte de la casse).

Qui a la permission `membres.badges.gerer` peut aussi, **depuis le panneau « Badges » d'une fiche**, créer un badge
(« + Nouveau badge » : nom, couleur, emoji facultatif — il est créé puis **coché** pour le membre, dans la section
« Tout le club » ou « Pour <team> » où on l'a créé), modifier un badge (crayon ✎ : nom, couleur, emoji) et ouvrir le
gestionnaire complet (« Gérer tous les badges… »). Les cases déjà cochées mais pas encore enregistrées sont conservées.
Sans la permission, le panneau reste inchangé (`attribution.gerer` de la fiche).

Badges proposés par défaut (modifiables, supprimables) : **CEO**, **Second CEO**, **Responsable CM**, **Correspondant
CM**, Capitaine, IGL, Coach, Manager, Streamer, Créateur de contenu, Ambassadeur, Remplaçant, Rookie.

### Badges automatiques

Marqués « Automatique » dans le catalogue ; calculés à chaque lecture, ils **suivent le rôle** :

| Badge | Qui le porte |
| --- | --- |
| **CEO** | le compte **Fondateur**, et **lui seul** : ni attribuable à quelqu'un d'autre (ni par la fiche, ni en lot, ni par l'API, même par le Fondateur), ni retirable à la main |
| **Second CEO** | chaque titulaire du rôle du club « Second CEO » (**Administration › Rôles et permissions › Club**, migration 0033 ; [roles-permissions.md](roles-permissions.md)), pour tout le club ; il reste réservé au Fondateur (nom, couleur, ordre) |
| **Responsable CM** | chaque affectation au rôle CM système « Responsable CM » (Équipe CM) |
| **Correspondant CM** | chaque affectation au rôle « Correspondant CM » ; affecté pour une team : « Correspondant CM · Team » |

On peut les renommer (« CEO » → « Président »), les recolorer, les ranger, et les **désactiver** (interrupteur
« Badge automatique actif ») sans les supprimer. Ils ne se cochent pas dans la fiche d'un membre. Quand le rôle
change (affectation retirée, nouveau Responsable), le badge suit immédiatement.

### Badges réservés au Fondateur

« **Second CEO** » est **réservé au Fondateur** et, depuis la migration 0033, **automatique** : il suit le rôle du club
« Second CEO » (ses attributions manuelles d'avant ont été retirées). Le Fondateur peut marquer d'autres badges « Réservé au Fondateur »
(et le retirer). Les autres gestionnaires voient ces badges sans pouvoir les cocher ; quand ils enregistrent les
badges d'un membre, ses badges réservés restent.

### Attribuer

- **Depuis la fiche** d'un membre : bouton **Badges** › une case par badge, pour **Tout le club** et pour chaque
  team du membre où l'on attribue › Enregistrer.
- **À plusieurs d'un coup** : menu « ⋯ » › **Badge à plusieurs** › cocher des cartes › choisir le badge ›
  **Attribuer** ou **Retirer** (badge global). Tout ou rien : si un membre est hors de votre périmètre, rien n'est
  écrit.

### Qui gère, qui attribue — permission `membres.badges.gerer`

Nouvelle permission (plutôt que `membres.trombi.editer`, pour qu'un éditeur de fiches ne distribue pas de titres) :

| Qui | Catalogue | Attribue à |
| --- | --- | --- |
| Fondateur | tout (badges réservés compris) | tout le club, **lui compris** |
| Rôle CM affecté **pour le club** avec la permission (par défaut **Responsable CM**) | créer, modifier, ranger, supprimer | tout le club, sauf lui-même |
| Rôle de team avec la permission (par défaut **Manager** ; Propriétaire) ou rôle CM affecté pour une team | — | les membres de **cette** team (global ou rattaché à cette team), sauf lui-même |
| Joueur, Remplaçant, Coach, Analyste, Correspondant CM (sans la permission) | — | personne |

- **Personne ne s'attribue (ni ne se retire) un badge**, sauf le Fondateur (403 `badge-soi`) ; pas d'option
  « badges libres ».
- Elle se donne comme les autres : **Paramètres de la team › Rôles** (groupe « Membres et rôles », libellé
  « Trombinoscope : attribuer les badges ») ou **Équipe CM** (« Trombinoscope : gérer et attribuer les badges »).
- Codes d'erreur : `badge-soi`, `badge-auto` (badge automatique), `badge-reserve` (réservé au Fondateur),
  `badge-portee` (team hors périmètre, ou dont le membre ne fait pas partie), `badge-doublon`, `badge-nom`,
  `badge-couleur`, `badge-icone`, `badge-ordre`, `badges` (20 badges au plus par membre).

Journal (bus, sans team comme le reste du trombinoscope) : `trombi.badge_cree`, `trombi.badge_modifie`,
`trombi.badge_supprime` (avec le nombre de membres retirés), `trombi.badge_attribue`, `trombi.badge_retire`
(compte, badge, portée). Pas de notification.

## Photo

- **Envoi interne seulement** (jamais une adresse externe) : sur le site et l'app PC, **Ajouter une photo** ouvre le
  sélecteur (JPEG, PNG ou WebP, 20 Mo au plus) ; l'image est **recadrée en carré** dans le navigateur (centrée, ou
  « en haut » pour un portrait), réduite à **512 px** avec une miniature de **128 px**, puis envoyée.
- Le serveur **revérifie** : format reconnu à ses octets (et identique au type annoncé ; jamais un SVG ni un autre
  fichier), image **carrée**, côté de 128 à 1 024 px (miniature : 32 à 256 px), 400 Ko au plus (miniature : 48 Ko).
- Sur iPhone et iPad (app native), la photo s'ajoute depuis le site ou l'app PC ; elle s'affiche partout.
- Les photos sont gardées **dans la base** (table `trombi_photos`, en base64) : elles partent avec l'export de la
  base et **disparaissent avec le compte**.

## RGPD

- **Export** (Profil › Exporter mes données, ou par le Fondateur) : la fiche entière (nom réel, présentation, elo,
  palmarès saisi, anciennes structures, réseaux, postes, visibilité) et la photo (image et miniature en adresse
  `data:`), clés `trombinoscope` et `trombinoscopePhoto` ; ses badges attribués (`trombinoscopeBadges` : badge,
  team, date).
- **Suppression du compte** (« Supprimer mes données », par le Fondateur, ou compte retiré dans l'Administration) :
  la fiche, la **photo** et ses **badges** sont effacés ; le compte n'est plus l'auteur d'aucune modification des
  fiches des autres, d'aucune attribution ni d'aucun badge du catalogue.
- Le **journal** (`trombi.fiche_modifiee`, `trombi.photo_modifiee`, `trombi.photo_supprimee`) ne contient que le
  compte concerné et le nom des champs modifiés, jamais leur contenu ; ces événements n'ont pas de team.

## Données (migration 0030)

| Table | Contenu |
| --- | --- |
| `trombi_fiches` | une ligne par compte : `nom_reel`, `presentation`, et en JSON validé : `elos`, `palmares`, `structures`, `reseaux`, `postes` (`{ teamId: { postes, personnages } }`), `visibilite` ; `version` (modifications concurrentes), auteur et date de la dernière modification |
| `trombi_photos` | une ligne par compte : type, côté, poids, image et miniature (base64), empreinte SHA-256 |
| `trombi_badges` (0032) | catalogue : nom (unique), couleur, icône, position, `auto` (`fondateur`, `cm-responsable`, `cm-correspondant`), `auto_actif`, `reserve` (Fondateur seul) |
| `trombi_badges_membres` (0032) | attributions manuelles : badge, compte, `portee` (`club` ou id de team), auteur, date |

La migration ajoute `membres.trombi.voir` aux rôles système Manager, Coach et Analyste des teams existantes,
`membres.trombi.editer` au Manager, `membres.trombi.voir` (et `editer` pour le Responsable) aux rôles CM système.
Les deux tables sont dans l'**export / import de la base**. La migration 0032 ajoute `membres.badges.gerer` au
Manager des teams existantes et au Responsable CM ; ses deux tables sont aussi exportées (l'import remplace les badges
proposés par ceux de l'export).

Limites : 120 enregistrements de fiche et 30 photos par compte et par heure. Listes : 10 elos (un par jeu),
60 entrées de palmarès, 30 anciennes structures, 12 réseaux, 5 postes et 10 personnages par team.

## API (préfixe facultatif `/api/esport`)

| Route | Droit |
| --- | --- |
| `GET /trombi` | session : cartes visibles, `droits` (`voir` : `club`, `teams` ou `equipe` ; `editer`), teams et jeux (filtres) |
| `GET /trombi/fiches/:compte` (`moi` : sa fiche) | voir la fiche (404 sinon) ; champs filtrés selon la visibilité ; `niveau` : `moi`, `editeur`, `staff`, `membre` |
| `PATCH /trombi/fiches/:compte` (`{ versionAttendue?, nomReel?, presentation?, elos?, palmares?, structures?, reseaux?, postes?, visibilite? }`, listes entières) | le joueur, ou un éditeur (pas les champs privés ni la visibilité) |
| `PUT /trombi/fiches/:compte/photo` (`{ type, donnees, miniature }` en base64) ; `DELETE …/photo` | idem |
| `GET /trombi/fiches/:compte/texte` → `{ fr, en }` | voir la fiche |
| `PUT /trombi/fiches/:compte/badges` (`{ badges: [{ id, portee? }] }`, liste entière dans le périmètre de l'acteur) | attribuer (voir [Badges](#badges)) ; rend la fiche |
| `GET /trombi/badges` | session : catalogue (avec le nombre de membres), `droits` (`gerer`, `attribuer`, `fondateur`) |
| `POST /trombi/badges` ; `PATCH` / `DELETE /trombi/badges/:id` ; `PUT /trombi/badges/ordre` (`{ ids }`) | catalogue |
| `POST /trombi/badges/:id/membres` (`{ comptes, portee?, retirer? }`) | attribuer / retirer à plusieurs (tout ou rien) |

`GET /trombi` rend aussi le catalogue (`badges`), `droits.badges`, et sur chaque carte `badges` (affichés) et
`peutBadges`. Limite : 300 écritures de badges par compte et par heure.

Codes d'erreur utiles : `reseau-url` (adresse de profil invalide, avec `details.index`), `reseau-connu`,
`palmares-*`, `structures-*`, `elos-*`, `postes-cle` / `postes-team`, `photo-format` / `photo-carree` /
`photo-cote` / `photo-poids`, `champ-prive`, `visibilite`, `version`.

## Code et tests

- Serveur : `esport/noyau/trombi/` — `badges.mjs` (catalogue, attributions, badges automatiques), `permissions.mjs`, `regles.mjs` (règles pures : visibilité, listes, réseaux,
  photo, palmarès calculé, texte d'annonce), `service.mjs` (droits, lectures, écritures, données pour les visuels),
  `routes.mjs`, `rgpd.mjs`, `bus.mjs` (notification au joueur). Liens : `cm/visuels/champs.mjs` (Recrue / Départ),
  `cm/droits.mjs` et `sponsors/commun.mjs` (permissions des rôles CM), `catalogue.json` (rôles de team).
- App : `src/esport/trombi/` (client, règles d'affichage, photo — recadrage dans `photo.web.ts`),
  `src/esport/ui/membres/` (PageMembres, Trombinoscope, FicheTrombi : fiche, édition, « Ma fiche » ; GestionBadges :
  catalogue ; EditeurBadges : attribution).
- Tests : `esport/test/trombinoscope.test.mjs` (SQLite et PostgreSQL : règles, migration, permissions — joueur,
  coach, manager, Responsable et Correspondant CM, Fondateur —, champs masqués, adresses des réseaux, photo,
  palmarès calculé sans résultat staff, texte FR / EN, visuel Recrue, RGPD, export / import),
  `src/esport/Trombinoscope.test.tsx` (onglets, filtres, fiche, édition, copie du texte, badges),
  `esport/test/trombi-badges.test.mjs` (SQLite et PostgreSQL : migration, permissions — le joueur ne s'attribue
  rien —, CEO exclusif, Second CEO réservé, badges automatiques, ordre, lot, suppression partout, texte, visuel,
  journal, RGPD, export / import).

## Pour le Fondateur

1. Mettre à jour le serveur Esport (déploiement automatique o2switch, ou `npm run migrer --prefix esport`) : la
   migration `0030_trombinoscope.sql` s'applique seule. Publier le site et l'app PC.
2. Rien à régler : le CM (Responsable et Correspondant) et le staff (Manager, Coach, Analyste) voient le
   trombinoscope ; le Manager et le Responsable CM le complètent. Pour changer cela : **Équipe CM** (rôles CM) ou
   **Paramètres de la team › Rôles** (rôles de team).
3. Demander aux joueurs de remplir **Teams › Mon profil › Ma fiche du trombinoscope** (photo, réseaux pro, elo,
   palmarès d'avant le club, anciennes structures, postes) et, s'ils le souhaitent, de régler qui voit quoi.
4. Badges : vérifier le catalogue (**Membres › Trombinoscope › « ⋯ » › Gérer les badges**), puis les attribuer depuis
   la fiche (bouton **Badges**) ou à plusieurs (« ⋯ » › **Badge à plusieurs**). « CEO » apparaît seul sur le compte
   Fondateur, « Responsable CM » / « Correspondant CM » sur l'Équipe CM ; « Second CEO » suit le rôle du club
   « Second CEO » (Administration › Rôles et permissions).
