# Esport : passer de Cloudflare à un vrai serveur

Le serveur Esport a été écrit pour déménager sans réécriture. Ce document dit ce qui change et comment faire.

## Ce qui ne bouge pas

Tout le cœur est dans `esport/noyau/` et ne dépend pas de Cloudflare :

| Fichier | Rôle |
| --- | --- |
| `api.mjs` | Routes HTTP et middleware (Request/Response standard : Node 22, Deno, Bun, Workers) |
| `service.mjs` | Logique métier et contrôles d'accès (appartenance → module → permission, anti-escalade…) |
| `permissions.mjs`, `catalogue.json` | Modules, permissions, rôles système, presets (fonctions pures) |
| `session.mjs` | Session courte signée (HMAC-SHA256, clé `CLE_ESPORT`) |
| `authentification.mjs` | Vérification des jetons par le relais (`POST /jeton/verifier`) |
| `evenements.mjs` | Bus d'événements (table `evenements`), journal, notifications |
| `transfert.mjs` | Export / import JSON de toute la base |
| `migrations.mjs` + `esport/migrations/*.sql` | Migrations versionnées, SQL standard |

Le SQL est standard (compatible SQLite et Postgres) : identifiants UUID en texte, dates ISO 8601 en texte,
booléens en entiers 0/1, JSON en texte, `ON CONFLICT … DO NOTHING / DO UPDATE` (même syntaxe dans les deux),
aucune fonction propre à D1. Un test (`esport/test/outils.test.mjs`) refuse les tournures propres à SQLite.

## Ce qui change : trois branchements

Le Worker (`esport/worker.mjs`) ne fait que brancher le runtime sur le cœur. Le serveur local
(`esport/outils/serveur-local.mjs`) montre la même chose sous Node : c'est la base du futur serveur.

1. **Base de données** (`base`) : interface `tous`, `premier`, `executer`, `lot` (atomique), `script`.
   - Aujourd'hui : `adaptateurs/d1.mjs` (D1) ; en local et dans les tests : `adaptateurs/sqlite.mjs` (fichier
     SQLite, module intégré `node:sqlite`).
   - Postgres : écrire `adaptateurs/postgres.mjs` sur le même modèle (paquet `pg`) : convertir les `?` en
     `$1, $2…`, `lot` dans une transaction (`BEGIN` / `COMMIT`), `script` pour les migrations. Rien d'autre.
2. **Fichiers** (`stockage`) : interface `deposer`, `lire`, `supprimer` (`adaptateurs/stockage.mjs`).
   Aujourd'hui R2 ; ensuite un dossier sur le disque ou un stockage S3 (même interface).
3. **Vérification des jetons** : par l'adresse publique du relais (`verificateurRelais({ adresse })`) au lieu
   de la liaison de service. Le relais peut rester sur Cloudflare.

Le cron (toutes les 15 minutes) devient une tâche planifiée (systemd timer, cron) qui appelle `distribuer()`
de `evenements.mjs`.

## Déménager, pas à pas

1. **Exporter** la base Cloudflare (jeton maître du Fondateur dans une variable, jamais en argument) :

   ```bash
   ESPORT_JETON='…jeton maître…' node esport/outils/transfert.mjs exporter \
     --url https://applibourse-esport.<vous>.workers.dev --sortie esport-export.json
   ```

   (Variante sans l'API : `npx wrangler d1 export applibourse-esport --remote --output esport.sql`.)
2. **Préparer le serveur** : Node 22 (ou plus), le dépôt cloné, une clé `ESPORT_CLE` longue et aléatoire (secret
   du serveur, jamais dans le dépôt).
3. **Importer** dans la base neuve (les migrations sont appliquées d'abord, l'import refuse une base non vide) :

   ```bash
   node esport/outils/transfert.mjs importer --sqlite /srv/esport/esport.db --entree esport-export.json
   ```

   Pour Postgres : même commande avec l'adaptateur Postgres (même `importerBase`).
4. **Démarrer** le serveur (derrière un proxy HTTPS : Caddy, Nginx…) :

   ```bash
   ESPORT_CLE='…' node esport/outils/serveur-local.mjs --port 8790 --base /srv/esport/esport.db \
     --relais https://applibourse-relais.<vous>.workers.dev
   ```

   (Pour la production, gardez ce fichier comme modèle et ajoutez journalisation et redémarrage automatique.)
5. **Pointer l'app** vers le nouveau serveur : variable GitHub `ESPORT_URL` = adresse HTTPS du serveur, puis
   workflow « Site (Cloudflare Pages) » (fichier `esport.json`). Les apps PC et iPhone lisent l'adresse
   déduite du relais : publiez une version qui la lit aussi depuis la configuration si besoin.
6. **Fichiers** (à partir de la phase 3) : copier le bucket R2 `esport-fichiers` vers le disque ou S3
   (`rclone` sait lire R2), puis brancher l'adaptateur de stockage correspondant.
7. Vérifier (`/sante`, connexion, une team), puis arrêter le Worker Cloudflare.

## Sauvegardes

- Base : l'export JSON ci-dessus (à planifier), ou la sauvegarde de la base (fichier SQLite / `pg_dump`).
- D1 garde aussi un historique de 30 jours (« Time Travel ») tant que vous êtes sur Cloudflare.
