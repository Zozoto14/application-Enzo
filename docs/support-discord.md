# Support : les tickets arrivent dans Discord

L'application (hub, bouton « ? Support » ; Paramètres › Support) envoie chaque ticket au **relais Cloudflare**
(`POST /support`), qui le poste sur un salon Discord par **webhook**. L'adresse du webhook est un **secret du
Worker** : elle n'est jamais dans le code de l'application, ni dans les données synchronisées, ni dans un fichier du dépôt.

```
application ──(jeton maître ou jeton de profil)──▶ relais Cloudflare ──(DISCORD_WEBHOOK_URL)──▶ salon Discord
```

Rien n'est stocké côté serveur : la réception est dans Discord ; l'historique « Mes tickets » est dans le profil chiffré.

## 1. Créer le webhook dans Discord

1. Créez (ou choisissez) un salon réservé à l'équipe, par exemple `#support-appdashboard`.
2. Dans Discord : **Paramètres du salon › Intégrations › Webhooks › Nouveau webhook**.
3. Donnez-lui un nom, puis **Copier l'URL du webhook** (`https://discord.com/api/webhooks/<nombre>/<jeton>`).
4. Traitez cette URL comme un mot de passe : quiconque la connaît peut écrire dans le salon. Si elle fuite, supprimez
   le webhook dans Discord et recréez-en un (puis refaites l'étape 2).

## 2. Donner l'URL au relais (une seule fois)

Depuis la racine du dépôt (connecté à Cloudflare : `npx wrangler login`) :

```
npx --yes wrangler@4 secret put DISCORD_WEBHOOK_URL --config relais/wrangler.local.toml
```

Collez l'URL quand wrangler la demande (elle n'apparaît pas dans l'historique du terminal). Variante : `DISCORD_WEBHOOK_URL=… npm run relais:deployer`
la transmet à wrangler par l'entrée standard.

## 3. Redéployer le relais (nouvelle route `/support`)

```
npm run relais:deployer
```

Le redéploiement **conserve** les secrets déjà enregistrés (`JETON`, `DISCORD_WEBHOOK_URL`). Tant que le relais n'est pas
redéployé, un ticket reçoit « 404 » : l'application le dit (« redéployez-le ») et le ticket reste dans « Mes tickets ».

## Ce que fait le relais

- accepte le **jeton maître** ou un **jeton de profil** valide (`p1.<id>.<HMAC>`) ; sinon 401 ;
- valide la taille et le format (catégorie, sujet ≤ 100, message ≤ 2000, capture PNG/JPEG/GIF/WebP ≤ 4 Mo) ;
- **limite de débit par profil** : 5 tickets par heure (HTTP 429 au-delà) ;
- tronque et nettoie les textes, n'envoie que des champs en liste fermée, `allowed_mentions: { parse: [] }` (aucun `@everyone` ne notifie) ;
- webhook absent ou mal formé : erreur 503 propre, sans jamais renvoyer l'adresse ni le corps de la réponse de Discord.

Informations techniques (option cochée par l'utilisateur) : version, plateforme, rang, six premiers caractères de l'identifiant de compte.
Jamais de mot de passe, de code ni de clé.

## Tester

```
npm run relais:tester          # route, limite de débit, refus sans jeton, mentions, webhook absent
```
