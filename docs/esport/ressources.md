# Esport : le canal « Ressources »

Un canal par team, réservé aux ressources utiles pour progresser : guides, vidéos de pros, lineups,
routines d'aim, outils, mental… Le Fondateur l'a demandé ainsi : « un channel réservé aux ressources
que je peux trouver, pour la team esport ».

Module **Ressources** (clé `resources`), activable par team (**Réglages › Paramètres › Modules**), et
compris dans le preset **« Team Valorant complète »**. Dans la team, il est rangé dans la section
**Jeu** (Strats · Playbook · **Ressources** · Review vidéo · Scouting) : c'est du contenu de jeu, à
côté du playbook.

## Ce que l'on y trouve

Une ressource est l'une des quatre :

| Type | Ce qui s'affiche |
| --- | --- |
| **Lien web** | Aperçu de la page (titre, description, image, nom du site), **récupéré par le serveur** ; bouton « Ouvrir le lien ». |
| **Vidéo YouTube** | Lecteur intégré (site et PC ; sur iPhone, la vidéo s'ouvre dans YouTube) et **« Ouvrir en review vidéo »** : la review est créée une fois, puis rouverte. Une adresse YouTube collée comme lien devient une vidéo. |
| **Fichier déposé** | PDF, image (PNG, JPEG, GIF, WebP), vidéo (MP4, MOV, WebM, MKV) ou archive (ZIP, 7z, RAR). Même **envoi par morceaux** que les vidéos de la review (reprise après coupure, SHA-256), **stockage privé** : lecture par lien signé de 2 heures, une image s'affiche, une archive se télécharge. Jamais de SVG ni de HTML (refusés à l'octet près). |
| **Note** | Texte riche (le même éditeur que les notes de review : gras, listes, liens…). |

Chaque ressource a un **titre**, une **description riche** (facultative), des **tags**, une **map** et un
**agent** Valorant (facultatifs), un **niveau** (débutant, intermédiaire, avancé, facultatif), une
**catégorie** et un **auteur**.

## Le fil

- Liste chronologique (la plus récente en haut) ou **grille** avec les images (choix mémorisé sur
  l'appareil). Les ressources **épinglées** (📌) passent en premier.
- **Catégories** en pastilles (avec leur nombre de ressources), **recherche** (titre, description,
  tags, aperçu, map, agent ; sans accents ni casse), et **Filtres** : type, niveau, tag, map, agent,
  auteur, mes favoris.
- **« N nouvelles ressources depuis votre dernière visite »** : compté à l'ouverture du canal (pastille
  « Nouveau » sur chacune), puis le canal est marqué vu. Jamais « nouveau » pour son propre auteur.
- **Favoris** personnels (☆ dans le détail ; filtre « Mes favoris »).
- **Réactions** (👍 🔥 ❤️ 😂 🤯 👀, une fois chacune par membre) et **commentaires** (l'auteur de la
  ressource est prévenu dans l'app).

## Catégories

Sept catégories par défaut, créées à la première ouverture : **Guides, Vidéos pros, Lineups, Aim et
entraînement, Outils, Mental, Divers** (leur nom suit la langue de l'app tant qu'elles ne sont pas
renommées). Le staff les gère dans **⋯ › Gérer les catégories** : créer, **renommer**, **monter /
descendre**, **supprimer** (ses ressources restent, « sans catégorie »). 30 catégories au plus.

## Qui fait quoi

| Permission | Par défaut | Ce qu'elle permet |
| --- | --- | --- |
| `resources.view` | tous les rôles système | lire le canal, réagir, commenter, favoris |
| `resources.post` | Manager, Coach, Analyste (le Propriétaire et le Fondateur ont tout) | publier |
| `resources.manage` | Manager, Coach, Analyste | modifier ou supprimer les ressources des autres, épingler, gérer les catégories, valider les propositions, réglages |

L'auteur modifie ou retire ses propres ressources. Les rôles personnalisés reçoivent ces permissions
dans **Membres et rôles › Rôles**. La migration `0017_ressources.sql` les donne aux rôles système des
teams existantes.

### « Les joueurs peuvent proposer »

**⋯ › Réglages des ressources** (staff) : activé, un joueur voit **« + Proposer une ressource »**. Sa
proposition part dans la **file de validation** (onglet **« À valider »** du staff, qui est prévenu) ;
elle n'est visible que de lui et du staff. Le staff **valide** (elle est publiée, l'auteur est prévenu)
ou **refuse** avec un motif (l'auteur est prévenu ; s'il la corrige, elle repart dans la file). Une
proposition n'est jamais « staff seulement » ni épinglée par son auteur.

### Visibilité

Par ressource : **toute la team** (défaut) ou **staff seulement** (ceux qui publient ou gèrent). Une
ressource réservée au staff n'existe pas pour un joueur : absente du fil, 404 sur son adresse, ses
réactions et ses commentaires. Elle ne part **jamais** sur Discord.

## Publier dans plusieurs teams (Fondateur)

**Esport › Teams › Ressources** : la même ressource (lien, vidéo YouTube ou note) dans plusieurs
teams d'un coup. Chaque team est vérifiée (membre ou Fondateur → module activé → `resources.post`)
**avant** toute écriture : tout ou rien. Catégorie : une catégorie par défaut (retrouvée dans chaque
team) ou un nom (créée là où elle manque). Un fichier se dépose dans une team à la fois.

## Discord

Notification **« Nouvelle ressource »** (Réglages › Discord, **désactivée par défaut**) : un embed
soigné (titre lié à la page ou à la vidéo, catégorie, type, niveau, map, agent, auteur, description et
image de l'aperçu, bouton « Ouvrir le lien » et « Ouvrir dans l'app »). Elle part à la publication, ou
à la validation d'une proposition ; la ressource est relue au moment de l'envoi (passée « staff
seulement » ou supprimée entre-temps : rien ne part).

Salon : celui de la team (bot ou webhook), ou un **salon dédié** dans **⋯ › Réglages des ressources**
(il faut aussi `discord.manage`) : **salon du bot** (identifiant numérique, si le bot est lié) ou
**webhook propre** (chiffré au repos comme celui de la team, jamais renvoyé ni écrit au journal).

## Aperçu des liens et sécurité (SSRF)

Le serveur télécharge la page pour en lire les balises Open Graph : c'est une requête **sortante**,
donc protégée contre la falsification de requêtes côté serveur (`esport/noyau/ressources/apercu.mjs`) :

- **http(s)** seulement, ports 80 et 443, pas d'identifiant dans l'adresse ;
- **jamais d'IP privée, locale ou réservée** (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x dont
  169.254.169.254, 100.64.x, ::1, fc00::/7, fe80::/10, ::ffff:127.0.0.1, NAT64…), ni `localhost`, ni
  un nom sans point, ni `.local`, `.internal`, `.lan`, `.home.arpa` ; les formes détournées
  (`http://2130706433/`, `0x7f.0.0.1`) sont normalisées puis refusées ;
- **serveur Node (o2switch)** : l'adresse IP est vérifiée **au moment de la connexion**
  (`esport/adaptateurs/apercuNode.mjs`, option `lookup`) : un nom qui pointe vers une adresse interne,
  ou qui en change entre-temps (DNS rebinding), est refusé sans connexion ;
- **redirections suivies à la main** (3 au plus), chacune revérifiée ;
- **délai de 4 s**, **512 Ko** lus au plus, HTML seulement, rien d'exécuté ; l'image de l'aperçu n'est
  qu'une adresse **https** publique (le serveur ne la télécharge pas) ;
- 60 aperçus par heure et par compte. Une page muette ou trop lente n'empêche pas de publier (lien
  sans aperçu) ; une adresse interdite, si.

Sur Cloudflare (Worker), le téléchargement passe par `fetch` (sans redirection automatique) : les mêmes
règles d'adresse s'appliquent, et le réseau de Cloudflare ne joint de toute façon pas les adresses
privées.

## Vos données (RGPD)

- **Exporter mes données** contient les ressources publiées ou proposées, ses commentaires, ses
  réactions et ses favoris (et le PDF ou l'image déposés, par lien signé de 72 h).
- **Supprimer mes données** (ou la suppression du compte par le Fondateur ou dans l'Administration) :
  les ressources et les commentaires **restent, anonymes** (« Compte supprimé ») ; les **favoris**, les
  **réactions** et les visites du canal sont **effacés**.

## API

```
GET|POST            /teams/:t/ressources                         fil (?categorie&tag&carte&agent&genre&auteur&niveau&favoris=1&q&file=1&miennes=1), publier / proposer
POST                /teams/:t/ressources/vu                      canal vu
POST                /teams/:t/ressources/apercu                  aperçu d'un lien { url }
GET|PATCH           /teams/:t/ressources/reglages                { propositions, discord: { salonId, webhook } }
POST                /teams/:t/ressources/categories              { nom } ; PUT …/categories/ordre { ids } ; PATCH|DELETE …/categories/:c
GET|PATCH|DELETE    /teams/:t/ressources/:id                     détail (commentaires), modifier, supprimer
POST                /teams/:t/ressources/:id/valider|refuser     file de validation
PUT|DELETE          /teams/:t/ressources/:id/favori
PUT                 /teams/:t/ressources/:id/reactions           { emoji, actif }
POST                /teams/:t/ressources/:id/commentaires        { texte } ; DELETE …/commentaires/:c
POST                /teams/:t/ressources/:id/fichier/lien        lien signé (2 h) { telecharger? }
POST                /teams/:t/ressources/:id/review              « Ouvrir en review vidéo »
POST|GET|PUT|DELETE /teams/:t/ressources/envois…                 envoi par morceaux (comme la review)
GET                 /ressources/teams                            teams où publier
POST                /ressources/multi                            { teams, genre, url?, titre, description, tags, categorie: { cleDefaut | nom }, visibilite }
```

Événements (journal ; notifications ; Discord) : `resource.created`, `resource.proposed`,
`resource.validated`, `resource.refused`, `resource.updated`, `resource.pinned`, `resource.deleted`,
`resource.commented`, `resource.comment_deleted`, `resource.reaction_changed`,
`resource_category.created|updated|deleted|reordered`, `resources.settings_changed`.

## Pour le Fondateur : mise en route

1. Redéployez le serveur Esport : la migration **`0017_ressources.sql`** est appliquée (tables du canal,
   permissions des rôles système, nouvel usage des envois).
2. Les **nouvelles** teams « Team Valorant complète » ont le module d'office. Pour une team **existante** :
   **Réglages › Paramètres › Modules › Ressources** (une case à cocher, par team).
3. Facultatif : **Réglages › Discord › « Nouvelle ressource »** (désactivée par défaut), et un salon
   dédié dans **Ressources › ⋯ › Réglages des ressources**. Facultatif aussi : « Les joueurs peuvent
   proposer ».

## Développement et tests

- Serveur : `node --test esport/test/ressources.test.mjs` (SQLite) et
  `ESPORT_TEST_PG=postgres://… node esport/test/pg/lancer.mjs esport/test/ressources.test.mjs`
  (PostgreSQL) : permissions, file de validation, visibilité staff, isolation entre teams, aperçu et
  SSRF (téléchargeur simulé, et téléchargeur Node refusant `localhost` à la connexion), fichier par
  morceaux, review, multi-teams, Discord, RGPD.
- App : `npx jest src/esport/ressources`.
- Bout en bout : `npx vite build` puis
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-esport-ressources.mjs` (faux YouTube,
  aperçus simulés côté serveur ; captures dans `docs/captures-esport-ressources/`).
