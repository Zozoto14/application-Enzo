# Relais Cloudflare : mise à jour sans le PC (GitHub Actions)

Le relais (`relais/worker.mjs`) doit être redéployé quand il gagne une route — par exemple
`/tsuzuku/requete`, qui permet au **site web** de lire les pages des sources de Tsuzuku pour le
compte Fondateur. Tant qu'il ne l'est pas, le site affiche : « Le relais ne connaît pas encore la
lecture des sources : mettez à jour le relais… ».

Deux façons de le faire : depuis GitHub (téléphone compris), ou depuis le PC.

Ce qui ne bouge **jamais** : le secret `JETON` du relais (et `DISCORD_WEBHOOK_URL`). Ils sont déjà
sur le Worker ; un redéploiement les conserve. Le workflow ne les lit pas, ne les écrit pas, ne les
affiche pas : les codes de liaison déjà donnés restent valables.

## Depuis GitHub (sans PC)

### À faire une fois

1. **Jeton Cloudflare** — sur dash.cloudflare.com › (icône du profil) › *My Profile* › *API Tokens*,
   modifiez le jeton déjà utilisé pour le site (secret `CLOUDFLARE_API_TOKEN`) :
   - ajoutez la permission **Account › Workers Scripts › Edit** ;
   - **Account › Workers KV Storage › Edit** n'est utile que si vous ne renseignez pas
     `RELAIS_KV_ID` (le workflow cherche alors la boîte `applibourse-boite` lui-même), ou si le
     déploiement échoue avec une erreur d'autorisation sur KV.
   Enregistrez (« Continue to summary » › « Update token ») : la valeur du jeton ne change pas.
2. **Secrets et variables GitHub** — dépôt › *Settings* › *Secrets and variables* › *Actions* :
   - secrets **déjà présents** pour le site : `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` ;
   - onglet *Variables* › *New repository variable* : **`RELAIS_KV_ID`** = l'identifiant de la boîte
     (32 caractères). Il est dans `relais/relais-local.json` sur le PC (champ `kv`), ou sur
     dash.cloudflare.com › *Storage & Databases* › *KV* › `applibourse-boite`. (Un secret du même nom
     fonctionne aussi.)
   - facultatif, variable **`RELAIS_URL`** = l'adresse du relais (`https://applibourse-relais.<vous>.workers.dev`,
     champ `relais` de `relais/relais-local.json`) : sert au test de santé si wrangler ne l'affiche pas.

### À chaque mise à jour

1. Le code doit être sur `main` (le workflow refuse toute autre branche).
2. Sur le téléphone : ouvrez le dépôt sur github.com (ou l'app GitHub) › onglet **Actions** ›
   **« Relais (Cloudflare Worker) »** › **Run workflow** › branche `main` › **Run workflow**.
3. Attendez la coche verte (1 à 2 minutes). Le dernier pas, « Test de santé », affiche :
   - `GET /sante (sans jeton) : HTTP 401` — le relais tourne (401 est normal : aucun jeton n'est
     envoyé, le `JETON` n'est jamais utilisé par GitHub) ;
   - `OPTIONS /tsuzuku/requete … HTTP 204` puis « Relais à jour » — la route du site est en place.
4. Sur le site, rouvrez une fiche de Tsuzuku : « Sur vos sources » indique « Site web : lecture via le relais ».

Le workflow ne se lance **que** à la main (`workflow_dispatch`), jamais sur un push. Il lance
d'abord les tests du relais (`node --test relais/*.test.mjs`), fabrique une configuration
temporaire à partir du modèle versionné `relais/wrangler.toml` (le `wrangler.local.toml` du PC
n'est pas sur GitHub), puis `npx wrangler deploy`.

### Si ça échoue

| Message | Que faire |
| --- | --- |
| `Secret CLOUDFLARE_API_TOKEN absent` / `CLOUDFLARE_ACCOUNT_ID absent` | Créer le secret (voir « À faire une fois »). |
| `RELAIS_KV_ID n'a pas la forme…` | Recopier l'identifiant (32 caractères hexadécimaux, sans guillemets). |
| `Impossible de lister les boîtes KV` | Créer la variable `RELAIS_KV_ID`, ou ajouter « Workers KV Storage › Edit » au jeton. |
| `Authentication error [code: 10000]` au déploiement | Le jeton n'a pas « Workers Scripts › Edit » (ou pas sur ce compte). |
| `La route /tsuzuku/requete ne répond pas au site` | L'adresse du site (`src/config/site.json`) doit figurer dans `ORIGINES_SITE` de `relais/wrangler.toml`. |
| Le job est « skipped » | Il a été lancé sur une autre branche que `main`. |

## Depuis le PC

Dans le dossier du projet, à jour de `main` :

```
npm run relais:deployer
```

Le script reprend la boîte, le jeton et le site déjà en place (aucun nouveau jeton n'est tiré
s'il en existe déjà un) et publie aussi le site. Pour le relais seul, la configuration locale suffit :
`npx --yes wrangler@4 deploy --config relais/wrangler.local.toml`.

## Réglages du relais (non secrets, dans `relais/wrangler.toml`)

- `ORIGINES_SITE` : origines autorisées à appeler `/tsuzuku/requete` depuis un navigateur
  (séparées par des virgules ; la même adresse que `src/config/site.json`). Un test vérifie
  qu'elles concordent.
- `LIMITE_TSUZUKU_MINUTE` (facultatif) : requêtes par minute (60 par défaut), comptées en mémoire
  du Worker (une instance = un compteur ; rien n'est écrit dans KV).

Les variables écrites dans `wrangler.toml` remplacent, à chaque déploiement, celles modifiées à la
main dans le tableau de bord Cloudflare ; les **secrets** (`JETON`, `DISCORD_WEBHOOK_URL`), eux, ne
sont jamais touchés.

## Ce qui n'a pas pu être vérifié ici

Le workflow et la route n'ont été exécutés que localement (Worker sous Node, sites factices). Sur
le vrai Cloudflare restent à constater : la résolution DNS sur HTTPS depuis le Worker, le décodage
des jeux de caractères par `TextDecoder` (un repli ISO-8859-1 est prévu), et la réaction des vrais
sites aux adresses de Cloudflare (pare-feux anti-robot plus stricts qu'avec le PC).
