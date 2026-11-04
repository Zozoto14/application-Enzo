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

## Tickets Discord (Gateway)

Les tickets ([tickets.md](tickets.md)) ouvrent **une** connexion WebSocket sortante vers Discord (Gateway), tenue par
un seul processus Node de l'app (bail en base, repris par un autre processus si le premier est arrêté par Passenger).
Rien à installer : client WebSocket natif de Node 22, aucun binaire externe. Quand plus aucun processus ne la tient
(app endormie), le **cron** relit les tickets ouverts par l'API et réveille l'app (`GET /sante`).

- **Portail Discord** : activez l'intent privilégié **Message Content** (Bot › Privileged Gateway Intents), sinon l'app
  affiche « Connexion Discord : secours ».
- **Permissions du bot** : Gérer les salons, Gérer les rôles, Joindre des fichiers en plus des annonces ; lien
  d'invitation à jour dans **Tickets › Configuration › Connexion**.
- **Couper la connexion en direct** sans rien d'autre : `TICKETS_GATEWAY=non` dans `~/.appdashboard/esport.env`, puis
  redémarrer l'app (`touch ~/application-enzo/esport/tmp/restart.txt`) ; la relecture de secours du cron continue.
- **Commandes** : après la mise à jour, relancez l'enregistrement des commandes (étape 6 de
  [bot-discord.md](bot-discord.md#6-enregistrer-les-commandes)) :

  ```bash
  cd ~/application-enzo
  set -a; . ~/.appdashboard/esport.env; set +a
  /home/jayo8828/nodevenv/application-enzo/esport/22/bin/node esport/outils/discord-commandes.mjs --adresse https://esport.appdashboard.fr
  ```
