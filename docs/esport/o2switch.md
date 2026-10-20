# Esport chez o2switch

Le serveur Esport déménage avec le reste du dashboard (relais et site) : tout est expliqué pas à pas dans
**[docs/o2switch.md](../o2switch.md)** (PostgreSQL, clé de déploiement GitHub, Git Version Control, sous-domaine
`esport.appdashboard.fr` et Let's Encrypt, Setup Node.js App, tâches cron, import des données, bascule de l'app et
de Discord, retour arrière, dépannage).

En bref, pour l'Esport :

- serveur : `esport/serveur/app.mjs` (démarrage Passenger : `serveur/app.cjs`, racine `application-enzo/esport`),
  même API que le Worker (`esport/noyau/api.mjs`) ;
- base : PostgreSQL (`esport/adaptateurs/postgres.mjs`), mêmes migrations `esport/migrations/*.sql`, traduites à
  l'application (`INTEGER` → `BIGINT`, `REAL` → `DOUBLE PRECISION`, `TEXT COLLATE "C"`) par le même migrateur ;
- fichiers : `/home/jayo8828/esport-fichiers` (adaptateur disque), jamais dans `public_html` ;
- jetons : validés par le relais en HTTPS (`RELAIS_URL=https://relais.appdashboard.fr`) ;
- cron : `esport/serveur/cron.mjs` toutes les 5 minutes (mêmes tâches que le cron du Worker) ;
- données : `esport/serveur/importer.mjs` tire l'export et les fichiers du Worker (routes `/admin/export`,
  `/admin/fichier`, `/admin/secrets` en lecture seule) et vérifie le nombre de lignes de chaque table ;
- tests : `npm run esport:tester:pg` (suite entière contre PostgreSQL, plus le démarrage réel des serveurs, un
  dépôt de PDF, le cron, un déménagement complet et `deployer.sh`).
