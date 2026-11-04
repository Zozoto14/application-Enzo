# Esport : page Réseaux (comptes, annonce Discord des posts, statistiques)

La page **Réseaux** de l'espace CM (entrée **CM** de la navigation de l'Esport, onglet **Réseaux**) réunit :

- les **comptes** du club et des teams sur les réseaux (X, Instagram, TikTok, et aussi YouTube, Twitch) ;
- le **bot d'annonce Discord** : quand un post de la section CM est marqué **publié** avec son adresse, un message
  part tout seul dans les salons Discord choisis pour le compte (anglais, puis version française dans un fil) ;
- les **statistiques** des posts, des vidéos et des comptes : relevés datés (J+1, J+7…), taux d'engagement,
  tableaux de bord, import et export CSV.

Rien ne se connecte aux réseaux : les posts restent publiés **à la main** (copier / coller, voir [cm.md](cm.md)) et
les statistiques se **saisissent** (ou s'importent en CSV). X, Instagram et TikTok demandent des comptes développeur
pour lire les statistiques par API ; le serveur est prêt à les brancher plus tard (voir « Pour les développeurs »).

Migration : `esport/migrations/0026_cm_reseaux.sql`. Code : `esport/noyau/reseaux/`, `src/esport/cm/reseauxApi.ts`,
`src/esport/ui/cm/reseaux/`, textes `src/esport/i18n/reseaux.ts`.

Sur téléphone, rien de nouveau dans la barre du bas : c'est un onglet de l'espace CM.

## Qui voit quoi

Mêmes permissions que la section CM ([cm.md](cm.md)), sur la **portée** de chaque élément (club ou team) :

| Permission | Ce qu'elle ouvre |
| --- | --- |
| `cm.voir` | consulter : comptes, publications suivies, relevés, tableau de bord, export CSV |
| `cm.editer` | saisir : relevés, publications ajoutées à la main, import CSV |
| `cm.gerer` (du **club**) | configurer : comptes, annonces Discord (salons, modèles, rôle, test), salons Discord du club, rappels, liste des annonces |

- Le **Fondateur** et le **Responsable CM** ont tout.
- Un compte qui a `cm.voir` sur **une team seulement** (correspondant de la team) ne voit que les comptes et les
  publications **de cette team** ; un compte du club ou d'une autre team lui répond 404. Une permission CM d'un
  **rôle de team** (Manager…) n'ouvre jamais la page (404) : elle est dans l'espace « CM du club », réservé à
  l'équipe CM.
- Sans `cm.voir` nulle part, toute la page répond **404** ; avec `cm.voir` sans le droit d'écrire, **403**.
- La configuration (comptes, annonces, salons) demande `cm.gerer` **du club** : un correspondant de team ne choisit
  pas les salons Discord.

## Comptes

**Réseaux › Comptes › + Compte** (`cm.gerer`) : réseau, **adresse du profil**, identifiant @ (facultatif : lu dans
l'adresse), libellé, **compte du club ou d'une team**, actif / inactif.

L'adresse est vérifiée : **https** seulement, sur le **domaine du réseau** (`x.com` ou `twitter.com`,
`instagram.com`, `tiktok.com`, `youtube.com`, `twitch.tv`, sous-domaines `www.`, `m.` compris), et ce doit être la
**page du compte** (`x.com/Club_GG`, `instagram.com/club.gg/`, `tiktok.com/@club.gg`, `youtube.com/@ClubGG` ou
`/channel/UC…`, `twitch.tv/clubgg`) — pas un post, pas une autre page du réseau. Un identifiant saisi qui ne correspond
pas à l'adresse est refusé ; le même compte (même réseau, même identifiant, sans tenir compte des majuscules) ne
s'enregistre pas deux fois. Ajouter un réseau plus tard = une entrée dans `RESEAUX_COMPTES`
(`esport/noyau/reseaux/regles.mjs`) et ses libellés.

**Désactiver** un compte : plus d'annonce ni de rattachement de nouveaux posts. **Supprimer** : il disparaît de la
page ; ses relevés et ses publications restent dans les statistiques.

## Annonce Discord des posts publiés

### Régler un compte

**Réseaux › Comptes › Annonce Discord** (`cm.gerer`), compte par compte :

1. **Annoncer les posts publiés de ce compte** (désactivé par défaut).
2. **Salons Discord** : un ou plusieurs.
   - le **salon d'une team** : celui que la team a déjà réglé (**Team › Réglages › Discord**) — son bot s'il est lié,
     sinon son webhook ; la langue et le fil français de la team s'appliquent ;
   - un **salon du club** : onglet **Bot Discord** › **+ Salon du club** (nom et adresse du webhook, voir plus bas).
3. **Rôle à mentionner** (facultatif, ex. `@Fans`) : son **identifiant numérique** (Discord › Paramètres du serveur ›
   Rôles › clic droit › Copier l'identifiant ; mode développeur). `@everyone` et `@here` sont refusés. Le rôle n'est
   mentionné que sur le message anglais (jamais dans le fil).
4. **Messages** anglais et français, avec des variables :

   | Variable | Valeur |
   | --- | --- |
   | `{reseau}` | nom du réseau (X, Instagram…) |
   | `{compte}` | `@identifiant` du compte |
   | `{url}` | adresse du post |
   | `{titre}` | titre de la carte |
   | `{team}` | team de la carte (sinon « le club » / « the club ») |

   Vide : message par défaut (« New {reseau} post from {compte}: {titre} » + l'adresse ; « Nouveau post {reseau} de
   {compte} : {titre} » en français). 500 caractères au plus ; une variable inconnue est signalée tout de suite et
   refusée à l'enregistrement. Tout le texte est neutralisé (aucune mention possible hors du rôle choisi).
5. **Aperçu** : les deux messages tels qu'ils partiront (avec un titre d'exemple). **Envoyer un message de test** : un
   message dans chaque salon choisi, tout de suite, et le résultat salon par salon (un test toutes les 10 s).

### Ce qui part

Quand on **marque un post publié** (**CM › carte › Publier**) en collant l'adresse du post pour un réseau :

1. Le serveur trouve le **compte** du post : l'identifiant lu dans l'adresse (X : `x.com/<compte>/status/…`, TikTok :
   `tiktok.com/@<compte>/…`) ; sinon (Instagram `…/p/…`) le compte de la **team de la carte** sur ce réseau ; sinon
   celui du **club**. Si l'adresse porte l'identifiant d'un compte **non enregistré**, rien ne part (pas d'annonce au
   nom d'un autre compte).
2. Si ce compte est **actif** et son annonce **activée**, un message part dans **chacun de ses salons** : un
   **embed** (couleur du réseau, titre de la carte lié au post, message, compte, réseau, team, **visuel** joint au
   post s'il y en a un, bouton **Voir le post**), en **anglais** ; puis le bot ouvre un **fil** « 🇫🇷 Version
   française » avec la version française, **comme les autres messages Discord** (voir [discord.md](discord.md)).
   Fil désactivé (team ou salon du club) : un seul message, dans la langue réglée.
3. **Un message par post, par réseau et par salon, jamais deux** : modifier la carte, la dépublier puis la republier,
   ou recoller la même adresse ne reposte rien. **Adresse changée** : le message déjà posté (et sa version française)
   est **réédité** avec la nouvelle adresse. Adresse ajoutée plus tard pour un autre réseau : un message pour ce réseau
   seulement.

Visuel : l'image de **couverture** de la carte, sinon sa première **image jointe** (PNG, JPEG, GIF, WebP, 8 Mo au
plus, envoyée en pièce jointe du message), sinon un **lien d'image** https joint.

### Salons du club

**Réseaux › Bot Discord** (`cm.gerer`) : **+ Salon du club** (nom, adresse du webhook créé dans Discord :
**Modifier le salon › Intégrations › Webhooks › Copier l'URL du webhook**). L'adresse est **chiffrée** (AES-GCM, même
clé que les webhooks des teams) et n'est plus jamais affichée : on voit `…/abcd`. Par salon : fil français (défaut)
ou langue d'un message unique, **Tester**, **Nouvelle adresse**, **Supprimer** (le salon disparaît des annonces).

Le fil français est créé par le **bot « Esport HQ »** : il doit être présent sur le serveur du salon, avec les
permissions de fil ([discord.md](discord.md)). Sans bot (`DISCORD_BOT_TOKEN`) ou sans permission, le message anglais
part quand même, et une alerte (au plus une par salon et par 24 h) prévient le Fondateur dans le salon.

### Envoi, réessais

Même file que les autres messages Discord, à part : rien ne part pendant la requête ; envoi juste après, et le cron
(toutes les 5 minutes) reprend les réessais : 1 min, 5 min, 15 min, 1 h, 3 h, puis abandon ; limite de débit de
Discord (429) respectée sans compter d'essai ; étapes enregistrées une à une (message, fil, version française) pour ne
jamais reposter. Un message en attente est abandonné après 24 h, ou si le post est dépublié, le compte désactivé, le
salon supprimé, le module Discord de la team coupé. **Bot Discord › Dernières annonces** : statut, salon, motif d'échec ;
les abandons vont aussi dans **CM › Journal**.

## Statistiques

### Publications suivies

**Réseaux › Publications**. Une publication est suivie :

- **automatiquement** pour chaque réseau d'un post CM marqué publié (titre, compte, team, type de contenu, date) ;
- **à la main** (**+ Publication à suivre**, `cm.editer`) : une vidéo YouTube, un post publié hors section CM… (adresse
  du post sur le domaine du réseau, titre, type, date de publication) ;
- par **import CSV** (option « suivre les adresses inconnues »).

**Type de contenu** (tableaux « par type ») : annonce, match, résultat, clip, sponsor, coulisses, recrutement, autre —
proposé d'après la carte (suggestion de tournoi → annonce, J-1 / Jour J → match, résultat → résultat, clip joint →
clip, partenaire mentionné → sponsor), modifiable. **Vidéo** : TikTok, YouTube, Twitch, Reels, clips (durée moyenne de
visionnage et taux de complétion proposés).

### Relevés

Ouvrir une publication › **Nouveau relevé** (`cm.editer`) : date (aujourd'hui par défaut, jamais dans le futur) et les
valeurs connues : **vues, j'aime, commentaires, partages, enregistrements, impressions, portée, clics**, et pour une
vidéo **durée moyenne de visionnage** (secondes ou `m:ss`) et **taux de complétion** (%). « 12,5 k », « 1 234 »,
« 1.2M » sont acceptés. **Un relevé par jour** : une nouvelle saisie du même jour remplace l'ancienne. Plusieurs
relevés dans le temps montrent l'évolution : **J+n**, écart de vues avec le relevé précédent, courbe des vues.

Comptes : **Réseaux › Comptes › Relevés du compte** : **abonnés, publications, vues et impressions** de la période,
datés ; courbe des abonnés.

**Rappels** : à **J+1** puis **J+7**, si aucun relevé n'a été fait à cette date, une notification (et une ligne du
récapitulatif e-mail) demande de relever les statistiques — à la personne qui a publié (si elle peut encore saisir),
sinon aux éditeurs CM. Désactivable par publication, et par défaut pour les nouvelles (**Bot Discord › Rappels**).

### Taux d'engagement

`(j'aime + commentaires + partages + enregistrements) ÷ impressions` (sinon ÷ portée, sinon ÷ vues), en %, sur le
**dernier relevé** de chaque post au plus tard le dernier jour de la période. Pour un groupe de posts : somme des
interactions ÷ somme des bases. Sans base (ou base nulle) ni interaction relevée : « — ».

### Tableau de bord

**Réseaux › Tableau de bord**, filtres **période** (7, 30, 90, 365 jours), **réseau**, **team** (ou club), **type** :

- chiffres clés : publications de la période (et combien ont un relevé), vues, taux d'engagement, abonnés et leur
  variation ;
- **évolution des abonnés** par compte (courbe ; point de départ : le dernier relevé d'avant la période) ;
- **top posts** par vues et par engagement ;
- **comparaison des réseaux**, **par type de contenu**, **par team** (posts, vues, engagement).

Graphiques de l'app (barres et courbe des Statistiques), lisibles en clair et en sombre : chaque valeur est aussi
écrite en texte et lue par les lecteurs d'écran.

### Import et export CSV

**Réseaux › Import / export** :

- **Export** (`cm.voir`, ce qu'on voit seulement) : relevés des publications (adresse, réseau, compte, titre, type,
  team, date de publication, date du relevé, J+n, toutes les valeurs, engagement, source) ou des comptes. Formules
  **neutralisées** (`=`, `+`, `-`, `@` en tête : une apostrophe est ajoutée), BOM UTF-8 : le fichier s'ouvre sans
  risque dans un tableur et se **réimporte tel quel**.
- **Import** (`cm.editer`) : choisir « publications » ou « comptes », un fichier CSV (1 Mo, 5 000 lignes au plus ;
  virgule, point-virgule ou tabulation détectés), **Aperçu**, associer chaque colonne à un champ (proposé d'après les
  en-têtes, français ou anglais : *Post URL, Views, Likes, Reach, Followers…*), **Importer**. Publications retrouvées
  par leur **adresse** (paramètres et « / » final ignorés, `twitter.com` = `x.com`) ; comptes par **identifiant** ou
  **adresse du profil**. Réimporter le même fichier ne crée **aucun doublon** (un relevé par jour). Les lignes
  illisibles (date invalide ou future, valeur non numérique, adresse inconnue, réseau inconnu, hors de vos droits)
  sont écartées avec leur raison.

## Données (migration 0026)

| Table | Contenu |
| --- | --- |
| `cm_rs_comptes` | comptes (réseau, identifiant, adresse, team, actif), annonce (active, modèles, rôle) |
| `cm_rs_cibles` | salons cibles d'un compte (team ou salon du club) |
| `cm_rs_salons` | salons Discord du club (webhook **chiffré**, fil français, langue, état) |
| `cm_rs_annonces` | annonces : file d'envoi et mémoire (une ligne par post, réseau et salon ; message, fil, version française) |
| `cm_rs_publications` | publications suivies (post CM ou ajoutée), type, vidéo, rappels |
| `cm_rs_releves_posts`, `cm_rs_releves_comptes` | relevés datés (un par jour), source `manuel`, `csv` ou `api:<nom>` |

Les réglages (rappels par défaut) sont dans `cm_reglages` (clé `reseaux`). Tout est dans l'**export / import de la
base** (adresses de webhook **chiffrées**). **RGPD** : l'export d'un compte de l'app contient les comptes réseaux et les
publications qu'il a ajoutés et le nombre de relevés saisis ; sa suppression garde ces saisies, **sans auteur**. Les
comptes des réseaux sont ceux du club et des teams (pas des personnes).

## API (préfixe facultatif `/api/esport`)

| Route | Droit |
| --- | --- |
| `GET /cm/reseaux` | voir (réglages des annonces et salons : gerer) |
| `POST /cm/reseaux/comptes` ; `PATCH\|DELETE /cm/reseaux/comptes/:id` ; `PUT …/:id/annonce` ; `POST …/:id/test` ; `POST /cm/reseaux/apercu` | gerer |
| `GET\|POST /cm/reseaux/comptes/:id/releves` ; `DELETE /cm/reseaux/releves-comptes/:id` | voir ; editer |
| `POST /cm/reseaux/salons` ; `PATCH\|DELETE /cm/reseaux/salons/:id` ; `POST …/:id/test` ; `GET /cm/reseaux/annonces` ; `PUT /cm/reseaux/reglages` | gerer |
| `GET\|POST /cm/reseaux/publications` (`?du&au&reseau&team&type&compte&q`) ; `GET\|PATCH\|DELETE /cm/reseaux/publications/:id` | voir ; editer |
| `POST /cm/reseaux/publications/:id/releves` ; `DELETE /cm/reseaux/releves-posts/:id` | editer |
| `GET /cm/reseaux/tableau-de-bord?du&au&reseau&team&type` | voir |
| `POST /cm/reseaux/import/apercu` ; `POST /cm/reseaux/import` | editer |
| `GET /cm/reseaux/export/(posts\|comptes).csv` (`?format=json` : enveloppe) | voir |

Limites (par compte et par heure) : 60 imports, 30 messages de test.

Événements : `cm.post_publie` (première publication) et `cm.post_adresses` (adresse ajoutée ou changée sur un post
publié) déclenchent l'annonce ; `cm.reseau_*` (comptes, annonces, salons, publications, relevés, import, export,
réglages, rappel), sans team, vont dans **CM › Journal** ; notification `cm-releve`.

## Pour les développeurs

- Serveur : `esport/noyau/reseaux/` — `regles.mjs` (pur : adresses, compte d'un post, nombres, engagement,
  évolutions, CSV), `commun.mjs` (droits), `annonces.mjs` (abonné du bus et file d'envoi, mêmes briques que
  `discord/file.mjs` et `discord/bilingue.mjs`), `bus.mjs`, `rappels.mjs`, `adaptateurs.mjs`, `service.mjs`,
  `routes.mjs`, `rgpd.mjs`. `appelerDiscord` (`discord/file.mjs`) sait joindre un fichier (multipart).
- **Brancher une API de statistiques plus tard** : écrire un adaptateur (`{ nom, reseaux, releverCompte?,
  releverPost? }`, contrat dans `adaptateurs.mjs`) et le passer au cron (`tachesPlanifiees(…, { adaptateursReseaux:
  [adaptateur] })`). Les relevés arrivent dans les mêmes tables (source `api:<nom>`), validés comme une saisie ;
  rien d'autre à changer (tableaux de bord, export, rappels). Les jetons d'API restent dans `esport.env`.
- App : `src/esport/cm/reseauxApi.ts`, `src/esport/ui/cm/reseaux/` (EspaceReseaux, Publications, Comptes),
  graphiques réutilisés de `src/esport/ui/graphiquesUsage/`.
- Tests : `esport/test/reseaux.test.mjs` (SQLite et PostgreSQL : règles, migration, validation des adresses,
  permissions, annonce Discord de bout en bout vers un faux Discord — anglais + fil, rôle, visuel, idempotence,
  adresse changée, plusieurs réseaux, compte désactivé, réessais, 429, fil impossible —, statistiques, rappels, import
  et export CSV, adaptateur, RGPD, export / import de la base), `src/esport/Reseaux.test.tsx`.

## Pour le Fondateur

1. Mettre à jour le serveur Esport (déploiement automatique, ou `npm run migrer --prefix esport`) : la migration
   `0026_cm_reseaux.sql` s'applique seule. Publier le site et l'app PC.
2. **Esport › Teams › CM du club › Réseaux › Comptes** : ajouter les comptes du club (et des teams) avec l'adresse de leur profil.
3. **Bot Discord** : ajouter le salon du club où annoncer les posts (webhook), ou utiliser le salon Discord d'une team ;
   vérifier que le bot « Esport HQ » est sur le serveur (fil français).
4. Sur chaque compte : **Annonce Discord** › salons, rôle à mentionner (ex. `@Fans`), messages, **Aperçu**, **Envoyer un
   message de test**, puis activer.
5. Ensuite, à chaque post marqué publié avec son adresse, l'annonce part seule. Saisir les statistiques à J+1 et J+7
   (rappel automatique), ou importer les exports CSV des réseaux.
