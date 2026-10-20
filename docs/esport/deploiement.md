# Esport : activer le serveur (Cloudflare + GitHub)

L'Esport a son propre serveur : un Worker Cloudflare **`applibourse-esport`**, séparé du relais. Il garde les
teams, les membres, les rôles et le journal dans une base SQL **D1**, et (à partir des résumés de réunions) les
fichiers dans un bucket **R2** privé. Tant qu'il n'est pas déployé, la tuile Esport affiche « Esport pas encore
activé » : rien d'autre ne change dans l'app.

Tout se fait depuis le navigateur (le téléphone suffit), sans PC. Comptez 10 minutes.

## Ce qu'il faut savoir avant

- **Données en clair côté serveur.** Contrairement au reste de l'app (chiffré de bout en bout), les données
  Esport sont lisibles par le serveur Esport (elles sont chiffrées au repos par Cloudflare). L'app l'affiche.
  On y garde seulement : pseudo (obligatoire), Riot ID et Discord (facultatifs). Jamais d'adresse e-mail.
- **Comptes.** L'Esport réutilise les comptes du hub : aucun nouveau mot de passe. Le serveur Esport fait
  vérifier le jeton de chaque appareil par le relais ; il ne connaît pas le jeton maître.
- **Aucun secret dans le dépôt.** La clé de session `CLE_ESPORT` est un secret du Worker, posé par le workflow.

## Étape 1 : mettre le relais en version 7

Le relais apprend une nouvelle route (« ce jeton est-il valable ? ») dont l'Esport a besoin.

1. GitHub › dépôt **application-Enzo** › onglet **Actions** › **Relais (Cloudflare Worker)**.
2. **Run workflow** › branche `main` › **Run workflow**.
3. Attendez la coche verte. Le test de santé affiche « vérification de jeton pour l'Esport disponible ».

Les anciennes versions de l'app continuent de marcher : rien n'est retiré du relais.

## Étape 2 : donner au jeton Cloudflare les droits D1 et R2

Le secret GitHub `CLOUDFLARE_API_TOKEN` (déjà utilisé pour le relais et le site) doit pouvoir créer la base et
le bucket.

1. [dash.cloudflare.com](https://dash.cloudflare.com) › icône du profil (en haut à droite) › **My Profile** ›
   **API Tokens**.
2. Sur la ligne du jeton utilisé par GitHub : **⋯ › Edit**.
3. Dans **Permissions**, ajoutez deux lignes (**+ Add more**) :
   - **Account** › **D1** › **Edit** ;
   - **Account** › **Workers R2 Storage** › **Edit**.
   (Gardez celles qui existent déjà, dont **Account › Workers Scripts › Edit**.)
4. **Continue to summary** › **Update token**. La valeur du jeton ne change pas : rien à refaire dans GitHub.

## Étape 3 : activer R2 (une fois par compte)

1. dash.cloudflare.com › menu de gauche **R2 Object Storage**.
2. Si Cloudflare le demande : **Purchase R2 Plan** / **Activer R2** (offre gratuite : 10 Go, sans frais en
   dessous ; Cloudflare peut demander un moyen de paiement).

**Obligatoire depuis les résumés de réunions (phase 3)** : les PDF des résumés sont dans R2. Sans R2, le workflow
déploie quand même (avertissement « R2 indisponible »), teams, dépôts et tâches marchent, mais le dépôt d'un PDF
répond « stockage des fichiers non branché ». Après avoir activé R2 (et la permission de l'étape 2), relancez le
workflow « Esport (Worker) » : il crée le bucket et le relie.

## Étape 4 (facultative) : créer la base et le bucket à la main

Le workflow les crée lui-même s'ils n'existent pas. Pour les créer vous-même :

- **Base** : dash.cloudflare.com › **Storage & Databases** › **D1 SQL Database** › **Create** › nom
  **`applibourse-esport`** › **Create**. Copiez son **Database ID** (forme `0a1b2c3d-…`).
- **Bucket** : **R2 Object Storage** › **Create bucket** › nom **`esport-fichiers`** › **Create bucket**.
  Laissez-le **privé** (n'activez ni « Public access » ni domaine public).

## Étape 5 : variables GitHub

GitHub › dépôt › **Settings** › **Secrets and variables** › **Actions** › onglet **Variables** ›
**New repository variable** :

| Nom | Valeur | Obligatoire ? |
| --- | --- | --- |
| `ESPORT_D1_ID` | le Database ID de `applibourse-esport` | Recommandée (sinon la base est cherchée par son nom à chaque fois) |
| `ESPORT_URL` | `https://applibourse-esport.<vous>.workers.dev` | Facultative : l'app la déduit de l'adresse du relais |
| `ESPORT_CREATION_TEAMS` | `tous` | Facultative : par défaut, seul le Fondateur crée des teams |

Les secrets `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` existent déjà (relais, site) : rien à ajouter.
Si vous ne connaissez pas encore le Database ID, lancez d'abord l'étape 6 : le workflow l'affiche dans son
résumé (« Base D1 applibourse-esport : … »), puis créez la variable.

## Étape 6 : lancer le workflow « Esport (Worker) »

1. GitHub › **Actions** › **Esport (Worker)** › **Run workflow** › `main` › **Run workflow**.
2. Il enchaîne : tests, base D1 (trouvée ou créée), bucket R2, **migrations** de la base, déploiement, clé de
   session, test de santé.
3. Coche verte = « Esport en service : https://applibourse-esport.… ».

La clé de session **`CLE_ESPORT`** est tirée au hasard et posée sur le Worker au premier lancement, sans jamais
apparaître dans les journaux ; les lancements suivants la gardent. Pour la poser vous-même depuis un PC
(facultatif) :

```bash
npx wrangler login
npx wrangler secret put CLE_ESPORT --config esport/wrangler.toml
# collez une longue valeur aléatoire (64 caractères), par exemple celle de : openssl rand -hex 32
```

Changer `CLE_ESPORT` déconnecte simplement les sessions en cours (une heure au plus) : l'app en reprend une seule.

Relancez ce workflow à chaque nouvelle version de l'Esport (nouvelles migrations) : il est sans danger à
relancer.

## Étape 7 : site et app

- Si vous avez créé `ESPORT_URL` : **Actions** › **Site (Cloudflare Pages)** › **Run workflow** (le site publie
  l'adresse dans `esport.json`).
- Ouvrez l'app (site, PC ou iPhone) en tant que Fondateur › tuile **Esport** › choisissez votre pseudo ›
  **Créer une team** (3 étapes : informations, jeu et preset, modules).

## Ajouter un joueur

1. **Administration** › **Utilisateurs** › nouveau compte : modèle de permissions **« Esport seulement »**
   (rang Ami). Envoyez l'invitation du hub comme d'habitude. Le compte porte le badge **Esport** : il ne verra
   que l'Esport dans le hub.
2. **Esport** › votre team › **Membres et rôles** › **Inviter** : choisissez le rôle, la validité et le nombre
   d'utilisations › **Créer l'invitation** › copiez le code `esp_…` (montré une seule fois) et envoyez-le.
3. Le joueur ouvre l'app › **Esport** › choisit son pseudo › **Rejoindre une team** › colle le code.

## Étape 8 (facultative) : notifications Discord

Rien à déployer de plus : la migration `0004_discord.sql` est appliquée par le workflow, et l'onglet **Discord**
de chaque team (droit `discord.manage`) sert à coller le webhook. Voir [discord.md](discord.md) (créer le
webhook, choisir les messages, sécurité). Facultatifs : le secret `CLE_DISCORD` et la variable `LIEN_APP`.

## En cas de souci

| Message | Que faire |
| --- | --- |
| « Esport pas encore activé » | Étapes 1 et 6. Si l'adresse du Worker n'est pas `applibourse-esport.<même sous-domaine que le relais>.workers.dev`, créez `ESPORT_URL` puis relancez le workflow du site. |
| Workflow : « Impossible de lister les bases D1 » | Étape 2 (permission D1). |
| Workflow : avertissement « R2 indisponible » ou « SANS stockage de fichiers » | Étape 3 (activer R2) et étape 2 (permission R2), puis relancez l'étape 6. Sans R2, pas de PDF de résumé. |
| « Le stockage des fichiers (R2) n'est pas branché » en déposant un PDF | Même chose : R2, puis workflow « Esport (Worker) ». |
| Workflow : « le relais n'est pas encore en version 7 » | Étape 1, puis relancez l'étape 6. |
| Workflow : liaison de service vers le relais | Le Worker `applibourse-relais` doit exister dans le même compte Cloudflare. |
| « Accès révoqué » dans l'Esport | Le compte a été révoqué dans l'Administration : c'est voulu. |

Modules : [résumés de réunions](resumes.md), [objectifs et tâches](objectifs-taches.md).
Passer plus tard sur un vrai serveur : voir [migration-serveur.md](migration-serveur.md).
