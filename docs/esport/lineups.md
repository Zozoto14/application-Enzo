# Esport : Lineups (« Lineups et placements » pour The Finals)

Le module **Lineups** (`lineups`) range au même endroit tous les lineups de la team : où se placer, où viser, où
ça tombe. Il vit dans la section **Jeu** d'une team, à côté des Strats et du Playbook, pour tous les modèles de jeu
(Valorant, The Finals, générique). Pour The Finals, l'onglet s'appelle **Lineups et placements** (placements de
gadgets, défenses de cashout) et les mots suivent le jeu : « Classe », « Gadget ou capacité », « Mode ».

> **Contenu tactique.** Comme les strats et les plans de match, les lineups ne sont **jamais envoyés à une IA
> externe** (aucun bouton de l'assistant d'écriture sur leurs champs, et le serveur refuse : voir « Confidentialité »)
> et **jamais publiés sur Discord**.

## Pour un joueur

- **Grille** : une carte par lineup, l'image d'abord, le personnage et la capacité en pastilles, le side, la
  difficulté (1 à 3 points) et la posture. Les lineups **favoris** (étoile) passent en tête : l'étoile est
  personnelle.
- **Filtres rapides** (sans rechargement) : map, personnage, capacité, side (ou mode), zone visée, tag, statut,
  « Mes favoris », et une recherche (titre, zone, consignes, tags). Sur PC les filtres sont sous les yeux ; sur
  iPhone et iPad ils sont repliés derrière **Filtres**. Les capacités ne sont proposées qu'une fois le personnage
  choisi quand leur clé est commune à plusieurs personnages (Valorant).
- **Vue par map** : chaque lineup est un **pin** posé là où il tombe. Les pins trop proches se regroupent (un
  chiffre) ; touchez le groupe pour voir sa liste. Touchez un pin : la **position de départ** et la **trajectoire**
  (arc en pointillés, anneau à l'arrivée) apparaissent, et la fiche s'ouvre à côté (PC, iPad) ou sous la carte
  (iPhone).
- **Fiche** : grandes images (Position, Visée, Résultat, Autre) avec une **visionneuse plein écran** (flèches,
  touches ← → Échap, balayage du doigt), la vidéo si elle existe, la mini-carte, les consignes (posture : debout,
  saut, en courant, accroupi ; comment viser ; timing ; texte libre), la difficulté, les tags, l'auteur, et
  **Utilisé dans** : les strats qui s'en servent (avec le numéro de l'étape).
- **Proposer un lineup** (rôle Joueur et au-dessus) : bouton **Proposer un lineup**. Il arrive « Proposé » ; le
  staff est prévenu, le valide ou le corrige. Tant qu'il est proposé, son auteur peut le modifier ou le supprimer.

## Pour un coach

- **Nouveau lineup** : titre, map, personnage, capacité ou gadget (listes du profil de jeu, avec leurs icônes ;
  texte libre si le profil ne les connaît pas), side ou mode, zone visée (callout de la map ou texte libre),
  posture, visée, timing, consignes, difficulté, tags.
- **Points sur la minimap** : touchez la carte une première fois pour la **position**, une seconde pour
  l'**arrivée** (souris, doigt sur iPad et iPhone). Le sélecteur au-dessus de la carte dit quel point sera posé ;
  « Effacer les points » repart de zéro.
- **Images et vidéo** : jusqu'à **4 images** (PNG, JPEG, WebP, GIF ; 12 Mo chacune au plus, allégées avant l'envoi
  quand c'est possible), chacune avec son rôle (Position, Visée, Résultat, Autre), et **une vidéo courte** (MP4,
  MOV, WebM ; 200 Mo au plus) envoyée sur le serveur de l'app, **ou** un lien vidéo `https`. Le type réel du
  fichier est vérifié par le serveur (pas seulement son extension). Les fichiers sont servis par des **liens
  signés** à durée limitée, réservés aux membres qui voient les lineups.
- **Valider** : un lineup proposé porte le badge « Proposé ». **Valider** le passe en « Validé » (l'auteur est
  prévenu) ; « Repasser en proposé » fait l'inverse. Un lineup créé par le staff est validé d'office.
- **Lier à une strat** : sur la fiche, **Lier à une strat** (avec, si vous voulez, le numéro de l'étape). Dans la
  liste des strats, le menu **⋯ › Lineups liés** d'une strat montre ses lineups et permet d'en lier ou d'en
  détacher. Une strat privée que le lecteur ne peut pas voir apparaît comme « 1 strat privée », sans son titre.
- **Corbeille** : un lineup supprimé reste **30 jours** dans la corbeille (menu **⋯ › Corbeille**), restaurable ;
  ensuite il est effacé avec ses fichiers.
- **Modification à plusieurs** : si quelqu'un d'autre a enregistré le même lineup entre-temps, un bandeau le dit
  et rien n'est écrasé. La liste se met à jour en direct (temps réel).

## Droits

| Permission | Ce qu'elle permet | Rôles par défaut |
| --- | --- | --- |
| `lineups.voir` | Voir les lineups, leurs images et vidéos, mettre en favori | Propriétaire, Manager, Coach, Analyste, Joueur, Remplaçant |
| `lineups.proposer` | Proposer un lineup ; modifier ou supprimer le sien tant qu'il est « Proposé » | Propriétaire, Manager, Coach, Analyste, Joueur |
| `lineups.gerer` | Créer (validé d'office), modifier, valider, supprimer, restaurer | Propriétaire, Manager, Coach |

Lier un lineup à une strat demande `lineups.gerer` ou `strats.update`, et de pouvoir voir la strat.

Le module est **activé d'office** dans les teams qui ont déjà l'éditeur de strats. Ailleurs : Réglages ›
Paramètres › Modules. Les rôles personnalisés (et le modèle des rôles des nouvelles teams, si vous l'avez modifié)
ne reçoivent pas ces permissions tout seuls : cochez-les dans Administration › Rôles et permissions.

## Notifications

| Quand | Qui est prévenu | Où mène la notification |
| --- | --- | --- |
| Un lineup est proposé | Ceux qui peuvent valider (`lineups.gerer`) | La fiche du lineup |
| Un lineup est validé | Son auteur | La fiche du lineup |

Catégorie « Jeu » du centre de notifications. **Rien n'est envoyé sur Discord.**

## Confidentialité

- **IA** : les tâches `lineups`, `lineup`, `placements` sont rangées avec `strats` dans
  `esport/noyau/ia/confidentialite.mjs` : IA locale seulement, jamais un fournisseur externe. L'assistant d'écriture
  n'est branché sur aucun champ d'un lineup, et le serveur refuse le champ `lineups` (`403 ecriture-confidentielle`).
- **Discord** : aucun événement `lineup.*` n'a de message Discord.
- **RGPD** : l'export des données d'un compte contient les lineups qu'il a créés et ses favoris ; à l'effacement
  du compte, ses favoris sont supprimés et son nom est retiré des lineups (qui restent à la team).
- **Export / import de la base** (`esport/noyau/transfert.mjs`) : tables `lineups`, `lineup_medias`,
  `lineup_favoris`, `strat_lineups`.

## Limites connues

- Les points de la minimap sont posés à la main : ils ne sont pas recalés automatiquement si l'image de la map
  change dans le profil de jeu.
- Sans image de minimap dans le profil du jeu (jeu générique, map inconnue), la carte est un quadrillage au nom de
  la map : les pins et la trajectoire fonctionnent, sans le décor.
- Les vidéos ne sont pas converties : préférez le MP4 (H.264), lu partout. Un lien vidéo externe s'ouvre dans le
  navigateur, il n'est pas intégré.
- Sur l'app iPhone / Android native, la visionneuse fonctionne au doigt ; le clavier ne concerne que le site et
  l'app PC.

## Pour les développeurs

| Élément | Où |
| --- | --- |
| Migration | `esport/migrations/0082_lineups.sql` (tables, usage d'envoi `lineup`, module, permissions) |
| Service, routes, événements, RGPD | `esport/noyau/lineups/{service,routes,bus,rgpd}.mjs` |
| Interface | `src/esport/ui/lineups/` (écran `Lineups.tsx`, `FicheLineup`, `FormulaireLineup`, `Visionneuse`) |
| Carte | `src/esport/ui/lineups/CarteTactique.tsx` : **seul** composant qui dessine la minimap (fond sombre, pins, trajectoire). Pour passer à un composant de carte partagé, c'est le seul fichier à changer. |
| Logique pure | `src/esport/lineups/logique.ts` (filtres, facettes, regroupement des pins, arc) |
| Tests | `esport/test/lineups.test.mjs` (SQLite et PostgreSQL), `src/esport/Lineups.test.tsx`, `scripts/e2e-esport-lineups.mjs` |

API (toutes sous `/teams/<team>`, session obligatoire) :

| Méthode et chemin | Rôle |
| --- | --- |
| `GET /lineups` | Liste (filtres `carte`, `personnage`, `capacite`, `side`, `zone`, `tag`, `statut`, `favoris`, `q`), droits et limites |
| `POST /lineups` · `GET`, `PATCH`, `DELETE /lineups/<id>` | Créer, lire, modifier (en-tête `X-Version-Lue` : `409 conflit-version`), supprimer (corbeille) |
| `GET /lineups/corbeille` · `POST /lineups/<id>/restaurer` | Corbeille |
| `PUT`, `DELETE /lineups/<id>/favori` | Favori personnel |
| `POST /lineups/<id>/medias` · `PATCH`, `DELETE /lineups/<id>/medias/<m>` | Rattacher un fichier envoyé (usage `lineup`), changer son rôle, le retirer |
| `PUT`, `DELETE /lineups/<id>/strats/<strat>` | Lier (corps `{ etape }` facultatif) ou détacher une strat |
| `GET /strats/<strat>/lineups` | **Lineups d'une strat** (lecture, pour l'éditeur de strats) : `{ strat, lineups: [...], droits }`, chaque lineup avec son `etape` (triés par étape) |
