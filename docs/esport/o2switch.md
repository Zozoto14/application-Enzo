# Esport chez o2switch

Le serveur Esport tourne chez o2switch avec le reste du dashboard (relais et site) : tout est expliqué pas à pas
dans **[docs/o2switch.md](../o2switch.md)** (PostgreSQL, clé de déploiement GitHub, Git Version Control,
sous-domaine `esport.appdashboard.fr` et Let's Encrypt, Setup Node.js App, tâches cron, Discord, migration vers un
autre serveur, dépannage).

En bref, pour l'Esport :

- serveur : `esport/serveur/app.mjs` (démarrage Passenger : `serveur/app.cjs`, racine `application-enzo/esport`),
  API du cœur portable (`esport/noyau/api.mjs`) ;
- base : PostgreSQL (`esport/adaptateurs/postgres.mjs`), mêmes migrations `esport/migrations/*.sql`, traduites à
  l'application (`INTEGER` → `BIGINT`, `REAL` → `DOUBLE PRECISION`, `TEXT COLLATE "C"`) par le même migrateur ;
- fichiers : `/home/jayo8828/esport-fichiers` (adaptateur disque), jamais dans `public_html` ;
- jetons : validés par le relais en HTTPS (`RELAIS_URL=https://relais.appdashboard.fr`) ;
- cron : `esport/serveur/cron.mjs` toutes les 5 minutes (`esport/noyau/cron.mjs`) ;
- migration vers un autre serveur : `esport/serveur/importer.mjs` tire l'export et les fichiers de l'ancien
  serveur (routes `/admin/export`, `/admin/fichier`) et vérifie le nombre de lignes de chaque table ;
- tests : `npm run esport:tester:pg` (suite entière contre PostgreSQL, plus le démarrage réel des serveurs, un
  dépôt de PDF, le cron, une migration complète et `deployer.sh`).
