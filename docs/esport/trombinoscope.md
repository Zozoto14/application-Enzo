# Esport : Trombinoscope

La page **Membres** de l'Esport a deux onglets :

- **Trombinoscope** (affiché en premier) : une carte par joueur — photo, pseudo, team(s) et jeu, rôles / postes en
  jeu, elo, icônes des réseaux — avec recherche (pseudo, team, poste, rang) et filtres (team, jeu, rôle / poste du
  profil de jeu). Un clic ouvre la **fiche détaillée** ;
- **Tous les membres** : la liste d'avant (comptes, création, invitations, rôles, Discord ID), inchangée.

Sur téléphone, rien de nouveau dans la barre du bas : ce sont deux onglets de la page Membres. Les raccourcis
« Inviter un joueur » (Teams), « Ouvrir la page Membres » (une team) et l'alerte « invités » du Dashboard ouvrent
directement **Tous les membres**.

Migration : `esport/migrations/0030_trombinoscope.sql`. Code : `esport/noyau/trombi/`, `src/esport/trombi/`,
`src/esport/ui/membres/`, textes `src/esport/i18n/trombi.ts`.

## La fiche d'un joueur

| Partie | Contenu |
| --- | --- |
| Photo | grand format (carrée), téléchargeable depuis la fiche (site et app PC) |
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
  pseudo, team et jeu, postes, elo, palmarès (saisi et calculé), anciennes structures, réseaux. Il ne reprend
  **que les champs visibles de tous les membres** (visibilité « Membres ») : jamais le nom réel, jamais un champ
  réservé au staff ou privé, quel que soit celui qui copie. Sans presse-papiers (app PC ancienne), le texte est
  enregistré en fichier ou affiché.
- **Télécharger la photo** (site, app PC).
- **Visuels du CM** : le modèle **Recrue / Départ** (source « membre ») se pré-remplit avec les **postes** choisis
  dans la fiche (sinon le rôle de team), et propose les champs `{elo}` (elo du jeu de la team) et
  `{ancienne_structure}` (la plus récente) — seulement s'ils sont visibles de tous les membres ([visuels.md](visuels.md)).

## Qui voit, qui modifie

Deux permissions, `membres.trombi.voir` et `membres.trombi.editer` :

| Qui | Voit | Modifie |
| --- | --- | --- |
| Fondateur | tout le club, tous les champs (privés compris) | tout |
| Rôle CM affecté **pour le club** avec la permission (par défaut **Responsable CM** : voir + compléter ; **Correspondant CM** : voir) | tout le club | (éditer) toutes les fiches |
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
  `data:`), clés `trombinoscope` et `trombinoscopePhoto`.
- **Suppression du compte** (« Supprimer mes données », par le Fondateur, ou compte retiré dans l'Administration) :
  la fiche et la **photo** sont effacées ; le compte n'est plus l'auteur d'aucune modification des fiches des autres.
- Le **journal** (`trombi.fiche_modifiee`, `trombi.photo_modifiee`, `trombi.photo_supprimee`) ne contient que le
  compte concerné et le nom des champs modifiés, jamais leur contenu ; ces événements n'ont pas de team.

## Données (migration 0030)

| Table | Contenu |
| --- | --- |
| `trombi_fiches` | une ligne par compte : `nom_reel`, `presentation`, et en JSON validé : `elos`, `palmares`, `structures`, `reseaux`, `postes` (`{ teamId: { postes, personnages } }`), `visibilite` ; `version` (modifications concurrentes), auteur et date de la dernière modification |
| `trombi_photos` | une ligne par compte : type, côté, poids, image et miniature (base64), empreinte SHA-256 |

La migration ajoute `membres.trombi.voir` aux rôles système Manager, Coach et Analyste des teams existantes,
`membres.trombi.editer` au Manager, `membres.trombi.voir` (et `editer` pour le Responsable) aux rôles CM système.
Les deux tables sont dans l'**export / import de la base**.

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

Codes d'erreur utiles : `reseau-url` (adresse de profil invalide, avec `details.index`), `reseau-connu`,
`palmares-*`, `structures-*`, `elos-*`, `postes-cle` / `postes-team`, `photo-format` / `photo-carree` /
`photo-cote` / `photo-poids`, `champ-prive`, `visibilite`, `version`.

## Code et tests

- Serveur : `esport/noyau/trombi/` — `permissions.mjs`, `regles.mjs` (règles pures : visibilité, listes, réseaux,
  photo, palmarès calculé, texte d'annonce), `service.mjs` (droits, lectures, écritures, données pour les visuels),
  `routes.mjs`, `rgpd.mjs`, `bus.mjs` (notification au joueur). Liens : `cm/visuels/champs.mjs` (Recrue / Départ),
  `cm/droits.mjs` et `sponsors/commun.mjs` (permissions des rôles CM), `catalogue.json` (rôles de team).
- App : `src/esport/trombi/` (client, règles d'affichage, photo — recadrage dans `photo.web.ts`),
  `src/esport/ui/membres/` (PageMembres, Trombinoscope, FicheTrombi : fiche, édition, « Ma fiche »).
- Tests : `esport/test/trombinoscope.test.mjs` (SQLite et PostgreSQL : règles, migration, permissions — joueur,
  coach, manager, Responsable et Correspondant CM, Fondateur —, champs masqués, adresses des réseaux, photo,
  palmarès calculé sans résultat staff, texte FR / EN, visuel Recrue, RGPD, export / import),
  `src/esport/Trombinoscope.test.tsx` (onglets, filtres, fiche, édition, copie du texte).

## Pour le Fondateur

1. Mettre à jour le serveur Esport (déploiement automatique o2switch, ou `npm run migrer --prefix esport`) : la
   migration `0030_trombinoscope.sql` s'applique seule. Publier le site et l'app PC.
2. Rien à régler : le CM (Responsable et Correspondant) et le staff (Manager, Coach, Analyste) voient le
   trombinoscope ; le Manager et le Responsable CM le complètent. Pour changer cela : **Équipe CM** (rôles CM) ou
   **Paramètres de la team › Rôles** (rôles de team).
3. Demander aux joueurs de remplir **Teams › Mon profil › Ma fiche du trombinoscope** (photo, réseaux pro, elo,
   palmarès d'avant le club, anciennes structures, postes) et, s'ils le souhaitent, de régler qui voit quoi.
