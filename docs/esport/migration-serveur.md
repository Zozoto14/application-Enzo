# Esport : architecture du serveur et changement d'hébergeur

> **Hébergement actuel : o2switch** (https://esport.appdashboard.fr, Node + PostgreSQL + disque). Mode d'emploi pas
> à pas : **[docs/o2switch.md](../o2switch.md)**. Ce document décrit l'architecture et comment changer un jour
> d'hébergeur (autre mutualisé, serveur à soi).

## Le cœur portable

Tout le cœur est dans `esport/noyau/` et ne dépend d'aucun hébergeur :

| Fichier | Rôle |
| --- | --- |
| `api.mjs` | Routes HTTP et middleware (Request/Response standard : Node 22, Deno, Bun) |
| `service.mjs` | Logique métier et contrôles d'accès (appartenance → module → permission, anti-escalade…) |
| `permissions.mjs`, `catalogue.json` | Modules, permissions, rôles système, presets (fonctions pures) |
| `session.mjs` | Session courte signée (HMAC-SHA256, clé `CLE_ESPORT`) |
| `authentification.mjs` | Vérification des jetons par le relais (`POST /jeton/verifier`) |
| `evenements.mjs` | Bus d'événements (table `evenements`), journal, notifications |
| `transfert.mjs` | Export / import JSON de toute la base |
| `migrations.mjs` + `esport/migrations/*.sql` | Migrations versionnées, SQL standard |

Le SQL est standard (compatible SQLite et PostgreSQL) : identifiants UUID en texte, dates ISO 8601 en texte,
booléens en entiers 0/1, JSON en texte, `ON CONFLICT … DO NOTHING / DO UPDATE`. Un test
(`esport/test/outils.test.mjs`) refuse les tournures propres à SQLite.

## Trois branchements

Le serveur (`esport/serveur/app.mjs`) ne fait que brancher le cœur sur l'hébergement :

1. **Base de données** (`base`) : interface `tous`, `premier`, `executer`, `lot` (atomique), `script`.
   PostgreSQL en production (`adaptateurs/postgres.mjs`), SQLite pour les tests et le serveur local
   (`adaptateurs/sqlite.mjs`, module intégré `node:sqlite`).
2. **Fichiers** (`stockage`) : interface de `adaptateurs/stockage.mjs` (dépôt, lecture, envoi par morceaux,
   lecture par plages). Disque en production (`stockageDisque`), mémoire pour les tests ; un stockage S3 pourrait
   suivre la même interface.
3. **Vérification des jetons** : par l'adresse publique du relais (`RELAIS_URL`, `verificateurRelais({ adresse })`).

Les tâches planifiées (`esport/noyau/cron.mjs`) sont lancées par `esport/serveur/cron.mjs`, toutes les 5 minutes.

## Changer d'hébergeur, pas à pas

1. Installer le nouveau serveur comme dans [docs/o2switch.md](../o2switch.md) partie A (Node 22, PostgreSQL, les
   deux fichiers `.env`, avec le **même** jeton maître et les **mêmes** `CLE_ESPORT` / `CLE_DISCORD`).
2. Sur le nouveau serveur, tirer les données de l'ancien (base vide exigée, nombres de lignes vérifiés, fichiers
   copiés ; `--fichiers-seulement` pour reprendre) :

   ```bash
   ESPORT_SOURCE=https://ADRESSE-DE-L-ANCIEN-ESPORT node esport/serveur/importer.mjs
   ```

   Variante hors ligne : `ESPORT_JETON='…' node esport/outils/transfert.mjs exporter --url https://esport.appdashboard.fr --sortie esport-export.json`,
   puis `importer.mjs --entree esport-export.json` (les fichiers se copient alors à la main, mêmes clés).
3. Pointer les adresses : le site publie `esport.json` (workflow « Site (o2switch) », variable GitHub facultative
   `O2SWITCH_ESPORT_URL`) ; les apps déduisent aussi l'adresse du relais (`relais.<domaine>` → `esport.<domaine>`).
4. Vérifier (`/sante`, connexion, une team, un PDF), puis éteindre l'ancien serveur.

## Sauvegardes

- Base : sauvegardes cPanel / JetBackup (PostgreSQL), ou `pg_dump` ; export JSON à la demande (`transfert.mjs`).
- Fichiers : le dossier `FICHIERS_DIR` (compris dans les sauvegardes cPanel).
