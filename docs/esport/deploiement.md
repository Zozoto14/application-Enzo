# Esport : activer le serveur

L'Esport a son propre serveur, séparé du relais : **https://esport.appdashboard.fr**, hébergé chez o2switch
(Node + PostgreSQL, fichiers sur le disque). Il garde les teams, les membres, les rôles, le planning, les
résumés et le journal. Tant qu'il ne répond pas, la tuile Esport affiche « Esport pas encore activé » : rien
d'autre ne change dans l'app.

Installation, mises à jour automatiques, sauvegardes et dépannage : **[docs/o2switch.md](../o2switch.md)**
(parties A et B). Architecture et changement d'hébergeur : [migration-serveur.md](migration-serveur.md).

## Ce qu'il faut savoir

- **Données en clair côté serveur.** Contrairement au reste de l'app (chiffré de bout en bout), les données
  Esport sont lisibles par le serveur Esport. L'app l'affiche. On y garde seulement : pseudo (obligatoire),
  Riot ID et Discord (facultatifs). Jamais d'adresse e-mail.
- **Comptes.** L'Esport réutilise les comptes du hub : aucun nouveau mot de passe. Le serveur Esport fait
  vérifier le jeton de chaque appareil par le relais (`RELAIS_URL`) ; il ne connaît pas le jeton maître.
- **Aucun secret dans le dépôt.** La clé de session `CLE_ESPORT` (et `CLE_DISCORD`, facultative) est dans
  `~/.appdashboard/esport.env` sur le serveur, jamais ailleurs.
- **Mises à jour.** Rien à lancer : la tâche cron `esport/serveur/deployer.sh` installe chaque nouvelle version
  (code, migrations de `esport/migrations/`, redémarrage) dans les 5 minutes.

## Premier lancement

Ouvrez l'app (site, PC ou iPhone) en tant que Fondateur › tuile **Esport** › choisissez votre pseudo ›
**Créer une team** (3 étapes : informations, jeu et preset, modules).

## Ajouter un joueur

**Esport › Membres › Créer un compte** (nom, adresse e-mail, team et rôle). Le compte « Esport seulement » est
créé dans l'Administration, le joueur est ajouté à sa team, et l'e-mail d'invitation part (par le serveur, ou par
votre messagerie). Il choisit son mot de passe en ouvrant le lien et voit directement sa team. Détails :
[invitations.md](invitations.md) ; les trois pages de l'Esport : [README.md](README.md).

## Notifications et bot Discord (facultatif)

L'onglet **Discord** de chaque team (droit `discord.manage`) sert à coller le webhook : voir [discord.md](discord.md).
Bot (commandes `/prochain`…) : [bot-discord.md](bot-discord.md) (`DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`,
`DISCORD_BOT_TOKEN` dans `esport.env`, Interactions Endpoint URL `https://esport.appdashboard.fr/discord/interactions`).

## En cas de souci

| Message | Que faire |
| --- | --- |
| « Esport pas encore activé » | `curl -s https://esport.appdashboard.fr/sante` doit répondre `"ok":true` ; sinon [docs/o2switch.md](../o2switch.md), « Dépannage ». Sur le site, `https://appdashboard.fr/esport.json` doit contenir `https://esport.appdashboard.fr`. |
| « Le stockage des fichiers n'est pas branché » en déposant un PDF | `FICHIERS_DIR` dans `esport.env` (dossier existant, hors de `public_html`), puis redémarrez l'app Esport. |
| « Le relais n'est pas encore en version 7 » | `RELAIS_URL` dans `esport.env` doit être `https://relais.appdashboard.fr`. |
| « Accès révoqué » dans l'Esport | Le compte a été révoqué dans l'Administration : c'est voulu. |
| « Trop de demandes en peu de temps » | Limite de débit (protection) : attendez la durée indiquée (une minute pour la connexion, une heure au plus pour les créations). |

Guide : [les trois pages de l'Esport](README.md), [inviter un joueur](invitations.md).
Modules : [résumés de réunions](resumes.md), [objectifs et tâches](objectifs-taches.md), [strats et playbook](strats-playbook.md).
