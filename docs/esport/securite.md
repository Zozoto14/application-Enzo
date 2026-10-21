# Esport : revue de sécurité (phase 7)

Revue complète du serveur Esport (`esport/`, Worker Cloudflare et serveur local) et de l'app (`src/esport/`),
faite à la fin du module (phase 7). Chaque point a au moins un **test négatif** automatique :
`esport/test/securite.test.mjs` (serveur) et `src/esport/Finitions.test.tsx` (app), en plus des tests des
phases précédentes. Résumé : 8 failles ou faiblesses trouvées et corrigées, aucune critique.

## Failles trouvées et corrigées

| # | Gravité | Problème | Correction | Test |
| --- | --- | --- | --- | --- |
| 1 | Moyenne | **Lien signé d'un fichier** (PDF de résumé 5 min, miniature de strat 1 h) : un membre retiré ou suspendu pendant la validité du lien pouvait encore lire le fichier. | L'appartenance active du compte inscrit dans le lien est revérifiée à chaque lecture. | « fichiers : … membre retiré entre-temps » |
| 2 | Moyenne | **Fuite vers Discord** : le titre d'une réunion d'un type « staff » partait sur le salon de la team au **dépôt** (la publication du résumé était déjà filtrée). | Même règle au dépôt : rien ne sort pour une réunion staff. | « fuites : … réunion staff » |
| 3 | Moyenne | **Fuite vers Discord** : la création d'une **strat privée** était annoncée (titre, carte). | Seules les strats de visibilité « team » sont annoncées. | « fuites : … strat privée » |
| 4 | Moyenne | **Pas de limite de débit** sur l'ouverture de session (chaque appel interroge le relais), la création du profil (« compte » Esport), de teams et d'invitations. | Table `limites` (migration 0007), fenêtre fixe : session 30/min par IP ; profil 10/h par compte et 20/h par IP ; team 10/h ; invitations 30/h ; codes présentés 30/h par IP ; exports 30/h. Réponse 429 + `Retry-After`. | « limites de débit » |
| 5 | Faible | **CSRF** : un corps envoyé en `text/plain` ou en formulaire était lu comme du JSON. Sans cookie (session `Bearer`), aucune attaque n'était possible, mais la règle n'était pas explicite. | Tout corps non vide doit être annoncé `application/json`, sinon 415. | « CSRF » |
| 6 | Faible | **En-têtes** : ni HSTS, ni `X-Frame-Options`, ni `Permissions-Policy` ; nom de fichier iCal / CSV non encodé dans `Content-Disposition`. | En-têtes communs (`esport/noyau/entetes.mjs`) sur toutes les réponses : JSON, fichiers, PDF, page publique de partage. CSP `sandbox` sur JSON et fichiers. | « en-têtes de sécurité », « XSS » |
| 7 | Faible | **Ordre des contrôles** : révoquer un abonnement iCal cherchait l'abonnement avant de vérifier le module (404 « jeton-introuvable » au lieu de « module-desactive »). | Module vérifié d'abord, comme partout. | parcours « module désactivé » |
| 8 | Faible (RGPD) | **Suppression de compte incomplète** : les tâches, objectifs et repères restaient attribués au compte supprimé, une notification « retiré » était recréée après coup ; l'export ne contenait pas les réunions, tâches, repères, strats… | Anonymisation (assignés, propriétaires, cibles remis à vide), plus aucune notification pour un compte supprimé, export complet (voir plus bas). | « RGPD » (finitions.test.mjs) |

Correction hors sécurité trouvée pendant la revue : la pagination du journal (curseur par date seule) sautait les
entrées de même date (un même lot). Le curseur est maintenant `date|id`.

## Contrôle d'accès

- **Côté serveur uniquement** : l'app masque les boutons, mais le serveur décide (`esport/noyau/service.mjs`,
  `contexteTeam` puis `exiger`).
- **Ordre** : authentification (session `es1.…` signée HMAC-SHA256, une heure) → **appartenance** (team inconnue ou
  pas membre : 404, on ne révèle pas qu'elle existe ; membre suspendu : 403) → **module activé** (sinon 404) →
  **permission** (sinon 403).
- **Parcours automatique de toutes les routes de team** (114 routes : cœur, journal, planning, présence,
  disponibilités, résumés, objectifs et tâches, Discord, review, scouting, strats, playbook) : sans session (401, et
  session falsifiée 401), membre d'une autre team même Propriétaire chez lui (404 partout), membre suspendu (403
  partout), module désactivé pour le Propriétaire lui-même (404 partout). Un test vérifie que chaque section routée
  par le serveur figure dans ce parcours (une nouvelle route oubliée fait échouer le test).
- **Routes du Fondateur** (`/admin/export`, `/admin/import`, `/admin/comptes/…`) : 403 pour tout autre compte.
- **Routes publiques** (sans session) : santé, catalogue, fichier par lien signé, agenda iCal par jeton,
  page de partage d'une strat par jeton. Les trois dernières revérifient les droits (membre actif, module activé,
  partage non révoqué ni expiré).

## Anti-escalade

On ne peut ni créer, ni modifier, ni attribuer un rôle qui a une permission qu'on n'a pas soi-même ; un Manager
n'attribue pas le rôle Propriétaire et ne touche pas à un Propriétaire ; le dernier Propriétaire ne peut être ni
retiré, ni rétrogradé, ni suspendu, ni effacé (RGPD) sans successeur. Les rôles d'équipe ne changent jamais le rang
d'un compte dans le hub.

## Invitations

Invitation directe (voir [invitations.md](invitations.md)) : plus aucun code à deviner.

- **Création de compte** (`POST /comptes`) : super admin seulement (jeton maître validé par le relais), et côté app
  sur l'appareil du Fondateur, après vérification de son identité (mot de passe + code, comme l'Administration).
- Le lien compte du hub ↔ Esport est l'identifiant du compte que le relais valide à chaque session : un invité ne
  peut pas réclamer les teams d'un autre. Statut « invité » jusqu'à la première session.
- **Ajout d'un compte existant** (`POST /teams/:id/membres`) : `members.invite`, rôle attribuable (anti-escalade),
  compte déjà visible de l'acteur (sinon 404 : on ne sonde pas les comptes des autres teams). 30 par heure et par
  compte (`invitation`).
- Routes agrégées (`/dashboard`, `/membres`) : seulement les teams où l'acteur est membre actif, et dans chacune
  seulement les blocs que ses permissions ouvrent.
- Anciens codes `esp_` : création et acceptation répondent 410 sans rien écrire.
- Compte supprimé dans l'Administration : retiré de l'Esport (`DELETE /admin/comptes/:id/hub`, super admin).

## Fichiers

- PDF des résumés : type annoncé `application/pdf`, 20 Mo au plus (annoncés puis réels, lecture en flux), octets
  magiques `%PDF-` ; nom de stockage aléatoire (`teams/<team>/resumes/<uuid>.pdf`), nom d'origine nettoyé ; bucket R2
  privé.
- Miniatures de strats : PNG ou JPEG vérifiés par leurs octets magiques, 256 Ko au plus.
- **Vidéos et enregistrements** (migration 0014, [videos.md](videos.md)) : envoi par morceaux, à soi seulement (l'envoi
  d'un autre membre est introuvable), plafond par fichier (`ESPORT_VIDEO_MAX`, 10 Go), morceaux dans l'ordre, taille
  exacte et SHA-256 de chaque morceau, puis du fichier entier ; octets magiques au premier morceau (MP4, MOV, WebM,
  MKV ; audio pour une réunion) ; aucune conversion ; nom de stockage aléatoire ; envois abandonnés effacés après 24 h.
  Transcriptions : segments validés (20 000 au plus, 1,5 Mo de texte), PDF écrit par le serveur (texte échappé).
- Lecture uniquement par **lien signé** HMAC (5 min pour un PDF, 1 h pour une miniature, 2 h pour une vidéo), lié au
  compte et à l'option « télécharger » : lien modifié (compte, date, signature) → 403, expiré → 410, membre retiré →
  403. Les vidéos sont servies par plages (`Range` → 206, plage impossible → 416), en flux, 64 Mo au plus par réponse.

## Secrets

- Adresse du webhook Discord chiffrée au repos (AES-GCM 256, clé dérivée par HKDF, team en donnée authentifiée),
  jamais renvoyée en clair (seulement masquée), jamais journalisée ni placée dans le bus d'événements ; l'export de
  la base la garde chiffrée.
- `CLE_ESPORT` (et `CLE_DISCORD`) : secrets du Worker, jamais dans le dépôt. Les sessions ne sont jamais écrites en
  base ; le jeton maître du Fondateur n'arrive jamais au serveur Esport (vérification par le relais).

## XSS, CSRF, en-têtes

- **Notes de review (Markdown limité)** : nettoyées côté serveur (HTML neutralisé, images retirées, liens http(s)
  seulement, entités qui reconstruiraient une balise décodées puis neutralisées) ; rendues par l'app avec ses
  propres composants (jamais de HTML brut) ; l'impression PDF passe par un HTML entièrement échappé.
- Les autres textes (notes de scouting, descriptions, titres) sont du texte brut affiché par React Native (aucun
  `innerHTML`).
- **Page publique de partage** d'une strat : tout est échappé ; CSP `default-src 'none'` **sans aucun script**,
  images limitées à `media.valorant-api.com`, `frame-ancestors 'none'`, `noindex`.
- **CSRF** : aucune session par cookie (en-tête `Authorization: Bearer`, qu'un site tiers ne peut pas poser) ; CORS
  ouvert sans `Access-Control-Allow-Credentials` ; corps JSON exigé (415 sinon). L'origine n'est pas filtrée : l'app
  vient de plusieurs origines (site, app PC, iPhone) et une origine ne prouve rien sans cookie.
- **En-têtes** sur toutes les réponses : `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`,
  `X-Robots-Tag: noindex`, `Cache-Control: no-store`, CSP (`sandbox` pour JSON et fichiers).

## Injection SQL

- Toutes les requêtes sont paramétrées (`?`). Un test lit tout le code du serveur et refuse toute valeur
  interpolée dans un gabarit SQL : seuls passent des noms de colonnes fixés par le code, des listes de `?` et des
  fragments constants.
- Les filtres hostiles (`x' OR '1'='1' --` dans action, membre, module, dates, tâches, recherche de strats et du
  playbook, boîte des résumés, identifiant de team) sont refusés (400/404) ou traités comme du texte, jamais d'erreur
  500. L'import de base (Fondateur) n'accepte que des tables connues et des noms de colonnes validés.
- Exports CSV : formules neutralisées (`=`, `+`, `-`, `@` en tête de cellule).

## Journal et Discord : pas de fuite

Le journal ne contient ni session, ni code d'invitation, ni adresse de webhook, ni adresse IP (la colonne `ip`
reste vide). Les échecs Discord sont consignés avec un motif fixe (« Webhook refusé… »), jamais l'adresse. Les
messages Discord neutralisent `@everyone`, `@here` et les mentions (`allowed_mentions` limité au rôle choisi), et
rien ne sort pour une réunion staff ou une strat privée.

## RGPD

- **Mention d'information** dans l'app (premier passage et Paramètres) : données gardées, finalité, durée,
  droits, cas des mineurs.
- **Export** (membre : Paramètres › Exporter mes données ; Fondateur : Membres et rôles › un membre › Exporter ses
  données) : profil, teams, notifications, actions du journal, disponibilités, présences, réunions déposées, tâches
  et objectifs, repères et commentaires de review, strats et entrées de playbook créées, abonnements iCal (sans
  jeton), invitations créées (sans code), **vidéos et enregistrements déposés** (`mediasDeposes` : nom, taille, date et
  lien signé de téléchargement valable 72 h), **transcriptions de ses réunions** (`transcriptions` : texte et lien du
  PDF), **notes du staff partagées avec lui** (`notesPartagees`) et le nombre de
  notes qu'il a rédigées par team (`notesRedigees`, sans leur contenu : il s'agit de données d'autres joueurs).
- **Notes privées du staff** (Suivi joueurs, [suivi-joueurs.md](suivi-joueurs.md)) : ce sont des données
  personnelles du joueur concerné, mais elles ne figurent PAS dans l'export qu'il fait lui-même. Quand le Fondateur
  exporte les données d'un membre (Administration, demande d'accès RGPD transmise), l'export contient en plus
  `notesStaffPrivees` (date, catégorie, ton, texte, étiquettes, auteur) : le Fondateur les transmet au demandeur
  s'il exerce son droit d'accès, après avoir vérifié qu'elles ne contiennent rien sur un tiers.
- **Suppression** (membre ou Fondateur) : compte, appartenances, notifications, disponibilités, présences,
  abonnements iCal effacés ; tâches, objectifs et repères qui le visaient désattribués ; ce qu'il a écrit pour la
  team reste, sans pseudo (« Compte supprimé »), y compris ses vidéos, enregistrements et transcriptions (déposant et
  auteur effacés) ; ses envois inachevés sont effacés par le cron. Notes du staff : celles **sur** lui sont effacées, celles qu'il a
  **écrites** restent, sans auteur (anonymisées). Journalisé (`account.deleted`, `member.left` / `member.removed`).
- **Minimisation** : pas d'adresse e-mail ; Riot ID et Discord facultatifs ; journal conservé 1 an par défaut,
  réglable par la team (30 jours à 2 ans, ou illimité), purgé par le cron ; événements traités effacés après
  30 jours.

## Limites connues (risques acceptés)

- Une **session dure une heure** : un compte révoqué dans l'Administration garde l'accès jusqu'à la fin de sa
  session en cours (le relais est consulté à chaque nouvelle session).
- Les **limites de débit** sont en fenêtre fixe, sans verrou : sous très forte concurrence, quelques appels de
  plus peuvent passer.
- Les **liens publics** (agenda iCal, partage de strat) sont des secrets au porteur : qui a le lien lit. Ils sont
  révocables (et le partage peut expirer).
- Après une suppression de compte, le **journal** garde l'identifiant technique du compte (sans pseudo) jusqu'à la
  fin de sa durée de conservation ; les **sauvegardes** (Time Travel de D1, 30 jours) aussi.
- Les PDF ne passent pas par un antivirus (seulement type, taille et octets magiques) ; ils sont servis avec
  `nosniff` et jamais dans un cadre.
- Les messages déjà envoyés sur Discord échappent ensuite à l'app.

## Relancer la revue

```bash
node --test esport/test/securite.test.mjs   # parcours des routes et tests négatifs
npm run esport:tester                        # tout le serveur Esport
npx jest src/esport                          # l'app (dont Finitions.test.tsx)
```

Ajouter une route : l'ajouter aussi à `ROUTES_TEAM` dans `esport/test/securite.test.mjs` (le test de couverture le
rappelle).
