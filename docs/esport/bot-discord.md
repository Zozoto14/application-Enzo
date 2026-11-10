# Esport : le bot Discord « Esport HQ »

Le bot vit dans le serveur Discord de la team. Il **annonce** les scrims, matchs, tournois, entraînements et
réunions, **rappelle** la veille (J-1), une heure avant (H-1) et au début (« c'est maintenant »), et **mentionne
seulement les joueurs convoqués** qui ont lié leur compte. Sous chaque annonce, trois boutons : **Oui**,
**Peut-être**, **Non**. Un clic met à jour la présence dans l'app, et l'annonce se met à jour toute seule
(compteurs ✅ / 🤔 / ❌).

Les joueurs ont aussi des commandes : `/prochain`, `/planning`, `/rsvp`, `/dispo`, `/taches`, `/strat`, `/resume`,
`/aide`. Le staff a `/evenement-creer` et `/relancer`. Les tickets ont `/ticket …` et `/tickets` ([tickets.md](tickets.md)).

![Annonce d'un scrim](bot/apercus/01-annonce-scrim.png)

Autres aperçus (rendus avec le vrai code du bot) : [rappel H-1](bot/apercus/02-rappel-h1-match.png),
[relance groupée](bot/apercus/03-relance-groupee.png), [c'est maintenant](bot/apercus/04-c-est-maintenant.png),
[/prochain](bot/apercus/05-commande-prochain.png), [/taches](bot/apercus/06-commande-taches.png),
[/aide](bot/apercus/07-commande-aide.png), [clic sur Oui](bot/apercus/08-rsvp-confirme.png). Tous :
[bot/apercus/index.html](bot/apercus/index.html).

Pas de programme de plus à faire tourner : Discord appelle le serveur Esport (https://esport.appdashboard.fr) quand
quelqu'un tape une commande ou clique un bouton. Seuls les **tickets** ([tickets.md](tickets.md)) ouvrent en plus une
connexion **Gateway** (un seul processus de l'app, relecture de secours sinon) pour lire les messages des salons de
tickets.

---

## Activer le bot (Fondateur, une seule fois, environ 15 minutes)

### 1. Créer l'application sur Discord

1. Ouvrez **https://discord.com/developers/applications** (connectez-vous avec votre compte Discord).
2. Bouton **New Application** en haut à droite. Nom : **Esport HQ** (conseillé). Cochez la case, **Create**.

### 2. Récupérer les trois valeurs

1. Page **General Information** :
   - **Application ID** : bouton **Copy**. Gardez-le (c'est un nombre, ce n'est pas un secret).
   - **Public Key** : bouton **Copy**. Gardez-la (64 caractères, ce n'est pas un secret non plus).
2. Menu de gauche **Bot** :
   - bouton **Reset Token**, confirmez, puis **Copy** : c'est le **Bot Token**. **C'est un secret** : qui l'a peut
     parler à la place du bot. Ne le collez nulle part ailleurs qu'à l'étape 3.
   - Laissez **Public Bot** comme vous voulez (désactivé : vous seul pouvez l'inviter). « Privileged Gateway
     Intents » : activez **Message Content Intent** si vous utilisez les **tickets** ([tickets.md](tickets.md) : le bot
     lit alors les messages des salons de tickets) ; laissez **Presence** et **Server Members** éteints (Server Members
     seulement pour la bienvenue par rôle). Les **salons vocaux temporaires** ([vocaux.md](vocaux.md)) ajoutent
     l'intent `GUILD_VOICE_STATES` à la connexion permanente : il n'est **pas privilégié**, rien à activer ici (l'app
     le demande d'elle-même quand ils sont activés).

### 3. Poser les valeurs (serveur o2switch)

Dans cPanel › **Terminal**, `nano ~/.appdashboard/esport.env`, et remplissez les trois lignes du bot :

```ini
DISCORD_APPLICATION_ID=l'Application ID
DISCORD_PUBLIC_KEY=la Public Key
DISCORD_BOT_TOKEN=le Bot Token
```

**Ctrl+O**, **Entrée**, **Ctrl+X**, puis redémarrez l'app Esport : `touch ~/application-enzo/esport/tmp/restart.txt`
(ou **Setup Node.js App** › l'app Esport › **Restart**). Le fichier reste sur le serveur, jamais dans le dépôt.

### 4. Donner l'adresse des interactions à Discord

Page **General Information** de l'application, champ **Interactions Endpoint URL** :

```
https://esport.appdashboard.fr/discord/interactions
```

Puis **Save Changes**. Discord vérifie l'adresse tout de suite : si le message « The specified interactions endpoint
url could not be verified » apparaît, vérifiez l'étape 3 (le serveur doit connaître la Public Key, app redémarrée),
puis revenez enregistrer. L'étape 6 peut aussi la poser elle-même.

### 5. Inviter le bot sur le serveur de la team

Le plus simple : dans l'app, **Esport › votre team › Réglages › Discord › Inviter le bot sur un serveur** (le
bouton apparaît après l'étape 6). Sinon, remplacez `APPLICATION_ID` dans ce lien et ouvrez-le :

```
https://discord.com/oauth2/authorize?client_id=APPLICATION_ID&scope=bot%20applications.commands&permissions=378243632208
```

(Ce nombre réunit les permissions de **toutes** les fonctionnalités du bot : annonces, tickets, salons vocaux
temporaires, et celles à venir. Il
est calculé depuis une liste centrale, `esport/noyau/discord/permissions-bot.mjs` ; le lien à jour est toujours dans
**Administration › Bot Esport HQ › Connexion et état**.)

Il demande les scopes **bot** et **applications.commands**, et seulement ces permissions : **voir les salons**
(View Channel), **envoyer des messages** (Send Messages), **intégrer des liens** (Embed Links), **voir les anciens
messages** (Read Message History), **mentionner** (pour les rôles qu'on choisit de prévenir), et pour le **fil
français** : **créer des fils publics** (Create Public Threads) et **envoyer des messages dans les fils** (Send
Messages in Threads). Le bot ne mentionne jamais `@everyone` ni `@here`. Choisissez le serveur, **Autoriser**.

**Serveur du club (tickets, salons vocaux temporaires)** : ce même lien demande aussi Gérer les salons, Gérer les
rôles, Joindre des fichiers, Se connecter et Déplacer des membres. Le rôle « Esport HQ » doit être placé
**au-dessus** des rôles qu'il gère ([vocaux.md](vocaux.md)).

**Messages privés (relances par MP)** : aucune permission ni intent de plus. Le bot écrit par l'API HTTP
(`POST /users/@me/channels` puis `POST /channels/{mp}/messages`) : pas de gateway, donc pas d'intent
« Direct Messages » à cocher dans le portail (il ne sert qu'à **recevoir** des MP, ce que le bot ne fait pas). Les
boutons d'un MP arrivent sur la même adresse d'interactions (étape 4). Conditions côté Discord : le joueur partage un
serveur avec le bot, autorise les messages privés des membres de ce serveur (Paramètres du serveur ›
Confidentialité › Messages privés) et n'a pas bloqué le bot ; sinon Discord répond **50007** et l'app retombe sur le
salon (Réglages › Discord › Relances par MP liste qui est injoignable).

**Bot déjà invité avant le fil français** (lien avec `permissions=150528`) : il lui manque les permissions de fil.
Deux façons de les donner : rouvrir le nouveau lien ci-dessus (Discord met à jour le rôle du bot), ou **Paramètres
du serveur › Rôles › Esport HQ** (ou les permissions du salon des annonces) et cocher **Créer des fils publics**,
**Envoyer des messages dans les fils** et **Voir les anciens messages**. Une permission refusée au niveau du salon
l'emporte sur le rôle : vérifiez aussi **Modifier le salon › Permissions**. Vérification : **Réglages › Discord ›
Envoyer un message de test** (le résultat dit si le fil français a pu être créé).

### 6. Enregistrer les commandes

Dans le **Terminal** cPanel (avec **votre** chemin de Node, voir [docs/o2switch.md](../o2switch.md) étape A7) :

```bash
cd ~/application-enzo
set -a; . ~/.appdashboard/esport.env; set +a
/home/jayo8828/nodevenv/application-enzo/esport/22/bin/node esport/outils/discord-commandes.mjs --identite --adresse https://esport.appdashboard.fr
```

(`--identite` seulement la première fois.) Le script :

- enregistre les commandes auprès de Discord (elles apparaissent quand on tape `/` dans le serveur, parfois après
  une minute) ;
- pose l'adresse des interactions (étape 4) ;
- avec `--identite` : avatar, bannière et description du bot (« Esport HQ »).

Le jeton n'est lu que dans l'environnement (jamais en argument, jamais affiché). À la fin,
`curl -s https://esport.appdashboard.fr/sante` répond `"bot":true`.

**À relancer après chaque mise à jour qui ajoute ou change une commande** (ex. `/voc` des salons vocaux temporaires,
[vocaux.md](vocaux.md)) : la même ligne sans `--identite` —
`node esport/outils/discord-commandes.mjs --adresse https://esport.appdashboard.fr` — ou, dans l'app, **Administration
› Bot Esport HQ › Connexion et état › Réenregistrer les commandes** (même appel).

### 7. Lier le serveur à la team : `/esport-lier-serveur`

1. Dans l'app : **Esport › votre team › Réglages › Discord › Lier un serveur Discord**. Un code s'affiche
   (`ABCD-EFGH`, valable 10 minutes, une seule fois). Il faut le droit de gérer Discord dans la team (Fondateur,
   Propriétaire, Manager).
2. Dans Discord, **dans le salon où les annonces doivent arriver**, un administrateur du serveur tape :
   `/esport-lier-serveur code:ABCD-EFGH` (option **salon** pour en choisir un autre).
3. Réponse : « Serveur lié à la team … ». L'écran Discord de l'app montre le salon.

Un serveur peut porter plusieurs teams (une liaison par team, chacune son salon). Pour changer de salon, refaites un
code et la commande dans le nouveau salon. **Délier le serveur** arrête le bot pour la team.

### 8. Les joueurs lient leur compte : `/lier`

Chaque joueur, une fois :

1. Dans l'app : **Esport › Mon profil › Lier mon Discord**. Un code s'affiche (10 minutes, une seule fois).
2. Dans Discord : `/lier code:WXYZ-2345`.
3. Réponse : « Compte lié ». À partir de là, il est mentionné quand il est convoqué.

Le Fondateur, un Propriétaire ou un Manager voit qui est lié : **Réglages › Discord › Comptes Discord liés**.
Chacun peut se délier (**Délier mon Discord** dans l'app, ou `/delier`).

### 9. Le Discord ID de chaque membre (ping même sans `/lier`)

Pour que le bot puisse pinger un joueur convoqué **sans attendre qu'il fasse `/lier`**, chaque membre de l'Esport a un
champ **Discord ID** : son identifiant numérique Discord (17 à 20 chiffres, par exemple `412345678901234567`).

- **Obligatoire à la création** d'un compte Esport : **Esport › Membres › Créer un compte**, **Ajouter à une team**
  (compte du hub qui n'a pas encore de fiche Esport) et **Valider** une demande de compte. Un membre qui propose un
  compte peut déjà donner le Discord ID ; le Fondateur le vérifie à la validation.
- **Modifiable seulement par le Fondateur** : **Esport › Membres › (le membre) › Modifier le Discord ID**. Le serveur
  refuse (403) tout autre rôle, **Propriétaire compris** ; les autres le voient seulement.
- **Membres existants sans ID** : badge **« Discord ID manquant »**, bandeau en haut de la page Membres et filtre
  **« Discord ID manquant (N) »** pour les compléter un par un.
- **Comment trouver un Discord ID** (aussi rappelé dans l'app, lien « Comment trouver un Discord ID ? ») :
  1. Discord › **Paramètres utilisateur** › **Avancés** › activez **Mode développeur** ;
  2. clic droit sur le membre (appui long sur téléphone) › **Copier l'identifiant de l'utilisateur** ;
  3. collez-le dans l'app (une mention `<@412…>` collée est aussi acceptée).

**Qui est pingé ?** Pour chaque convoqué : sa **liaison `/lier` vérifiée** si elle existe (c'est lui qui a prouvé
que ce compte Discord est le sien), **sinon** le **Discord ID** saisi par le Fondateur. Sans l'un ni l'autre, il est
cité par son pseudo, sans notification. Le Discord ID ne sert QU'AUX mentions : pour utiliser les commandes (`/dispo`,
boutons Oui / Non…), le joueur doit toujours lier son compte avec `/lier` (le bot ne fait confiance qu'à une liaison
vérifiée pour savoir qui agit).

---

## Administration › Bot Esport HQ

Tous les réglages du bot réunis sur une page : **Esport › Administration › Bot Esport HQ** (le Fondateur, ou un rôle du
club avec `tickets.configurer` ou `vocaux.configurer`). Chaque réglage reste enregistré à sa place (aucune copie) ; la page les montre et y
mène :

- **Connexion et état** : variables du serveur (`DISCORD_APPLICATION_ID` affiché, clé publique et jeton : présents ou
  non, jamais leur valeur), connexion en direct et diagnostic (ceux des tickets), dernier passage du cron, lien
  d'invitation avec toutes les permissions, **Vérifier le serveur Discord** (ce qui manque au bot, fonctionnalité par
  fonctionnalité), et les **commandes slash** : celles enregistrées chez Discord (commandes globales,
  `GET /applications/{id}/commands`) comparées à celles de cette version. Si elles diffèrent : « Commandes à
  réenregistrer », la commande cPanel à lancer, et le bouton **Réenregistrer les commandes** (le serveur fait le même
  appel que `esport/outils/discord-commandes.mjs`).
- **Serveur Discord** : le serveur du club, un seul réglage (Tickets › Configuration › Général), et combien de teams
  ont lié un serveur pour leurs annonces.
- **Messages et langue** : réglages par défaut (anglais + fil français, une mention par événement, rappels en MP),
  langue de chaque team, langue des tickets, et le test des MP (même panneau que la page Discord de la team).
- **Annonces par team** : webhook, serveur lié, langue, rappels, envois abandonnés, avec un lien vers la page Discord
  de chaque team (ses lignes : toutes pour le Fondateur, sinon les teams où l'on a `discord.manage`).
- **Commandes** : chaque commande et sous-commande, et l'état des commandes des tickets (activée, coupée, rôles), à
  régler dans Tickets › Configuration › Commandes.
- **Fonctionnalités** : une carte par fonctionnalité du bot (registre `src/esport/ui/bot/sections.ts` : une nouvelle
  fonctionnalité y ajoute son entrée, avec ses réglages ou un lien vers sa page, et déclare ses permissions Discord
  dans `esport/noyau/discord/permissions-bot.mjs`).

API (Fondateur, `tickets.configurer` ou `vocaux.configurer`, 404 sinon) : `GET /bot-discord`, `GET /bot-discord/serveur`,
`GET|POST /bot-discord/commandes`.

## Ce que fait le bot

| Moment | Message | Qui est mentionné |
| --- | --- | --- |
| Un événement est créé | Annonce (titre, type, quand, map ou adversaire, convoqués, réponses) + boutons | les convoqués liés (ou le rôle réglé), **une fois** |
| La veille (J-1) | Rappel + boutons | seulement ceux pas encore mentionnés pour cet événement |
| 1 h avant (H-1) | Rappel + boutons | idem |
| Au début | « C'est maintenant ! » | idem |
| `/relancer` (staff) ou rappel « RSVP manquant » | un **MP** à chaque sans-réponse (sa langue, boutons RSVP) ; repli dans le salon pour qui ne peut pas être joint | personne en MP ; au repli, au plus une mention par événement |
| Un seul convoqué (sans rôle) | annonce, rappels et « C'est maintenant » en **MP** à ce joueur, rien dans le salon | personne |
| Quelqu'un répond | l'annonce est **modifiée** (compteurs à jour), pas de nouveau message | personne |

Règles complètes (seuil « joueur seul », repli, option **Relances par MP** par team, deux teams) :
[discord.md, « Pings une seule fois, relances par MP »](discord.md#pings-une-seule-fois-relances-par-mp).

- **Convoqués** : ceux de la convocation de l'événement dans le planning (voir [planning.md](planning.md)) :
  groupes Joueurs / Staff / Tout le monde, choix nominatifs, exclusions, liste propre à une date. Sans choix : les
  joueurs. Un Propriétaire (ou le Fondateur) n'est **jamais** convoqué sans être coché.
  `/evenement-creer` propose « joueurs » (par défaut), « staff » ou « tous ».
- **Comptes non liés** : mentionnés par leur **Discord ID** s'il est renseigné (étape 9), sinon cités par leur pseudo,
  sans notification.
- **Ping par type** : Réglages › Discord › Bot Discord › « Mentionner les convoqués » (Scrim, Match…). Éteint :
  l'annonce part quand même, sans mention.
- **Réunions staff** (réunion dont tous les convoqués sont du staff) : **jamais annoncées**, ni rappelées.
- Les interrupteurs et les modèles de messages de l'écran Discord (Nouvel événement, Rappels, C'est maintenant,
  Relance…) s'appliquent au bot comme au webhook.
- Les autres notifications (résumé publié, tâche assignée…) passent aussi par le bot quand un serveur est lié ; sinon
  par le webhook (repli). Tous les messages sont de vrais **embeds** : couleur et emoji du type
  (⚔️ scrim, 🏆 match, 🎯 entraînement, 🏟️ tournoi, 📋 réunion), heure affichée dans le fuseau de chacun.

## Les commandes

Réponses visibles **par vous seul** (éphémères).

| Commande | Pour qui | Ce qu'elle fait |
| --- | --- | --- |
| `/aide` | tous | la liste des commandes |
| `/lier code:` · `/delier` | tous | lier / délier son compte |
| `/prochain` | joueurs liés | mes prochains événements (où je suis convoqué), ma réponse |
| `/planning [jours]` | joueurs liés | les événements de la team (7 jours, 30 au plus), pages ◀ ▶ |
| `/rsvp` | joueurs liés | choisir un événement, puis Oui / Peut-être / Non |
| `/dispo` | joueurs liés | mes disponibilités de la semaine, lien pour les modifier |
| `/taches` | joueurs liés | mes tâches ouvertes, les retards d'abord |
| `/strat map:` | joueurs liés | les strats **validées** du playbook pour cette map |
| `/resume titre: lien: type:` | joueurs liés | déposer le lien d'une réunion à résumer |
| `/evenement-creer` | staff (créer au planning) | type, titre, date (`24/10`, `demain`…), heure (`20h30`), convoqués, durée |
| `/relancer evenement:` | staff (marquer la présence) | relance groupée des convoqués sans réponse |
| `/esport-lier-serveur code:` | admin du serveur Discord | lier le serveur à une team |
| `/ticket ouvrir [categorie]` · `/ticket fermer [raison]` · `/tickets [liste]` | tout membre du serveur du club (sans compte lié) | tickets : ouvrir un ticket, fermer le sien, voir ses tickets — voir [tickets.md](tickets.md) |
| messages dans un salon de ticket | l'auteur du ticket, une personne ajoutée | ils écrivent et envoient leurs fichiers directement (plus de bouton « Répondre ») ; réglage « Le staff répond uniquement depuis l'AppDashboard » (défaut) : le staff lit sans écrire ([tickets.md](tickets.md#le-staff-répond-uniquement-depuis-lappdashboard)) |
| `/ticket prendre`, `liberer`, `ajouter`, `retirer`, `renommer`, `priorite`, `transferer`, `attente`, `note`, `transcript`, `rouvrir`, `stats`, `permanent`, `ping`, `panneau` | staff du ticket (rôles de la catégorie, compte lié qui répond aux tickets ; `panneau` : administrateur) | tickets : gestion depuis le salon ([tickets.md](tickets.md#commandes-discord)) |
| `/voc renommer nom:` · `verrouiller` · `deverrouiller` · `expulser membre:` · `ami-ajouter membre:` · `ami-retirer membre:` · `limite places:` · `proprietaire membre:` | le propriétaire d'un salon vocal temporaire (ou le staff : rôles du staff, administrateurs) | gérer son salon vocal temporaire, tapée dans le salon (son fil) ou ailleurs en étant dedans ; chaque sous-commande peut être coupée ou réservée à des rôles ([vocaux.md](vocaux.md#commandes-voc)) |
| `/role-temp donner membre: [duree:] [raison:] [equipe:]` · `retirer membre: [equipe:]` · `liste [equipe:]` | compte lié, membre actif d'une team avec un rôle autorisé (Coach, Manager, Propriétaire par défaut) ; le Fondateur | donner à quelqu'un le **rôle Discord temporaire de SA team** (24 h par défaut), le retirer tout de suite, voir qui l'a ; voir [Rôles temporaires](#rôles-temporaires) |
| boutons du **panneau de contrôle** d'un salon vocal temporaire (rien à enregistrer) | son propriétaire, le staff | Renommer, Verrouiller / Déverrouiller, Limite de places, Expulser, Liste d'amis, Transférer ([vocaux.md](vocaux.md)) |
| `/ticket supprimer [avis]` | compte Esport lié avec `tickets.gerer` (ou `tickets.configurer` pour la catégorie) | tickets : supprimer le ticket **fermé** du salon après confirmation (le salon disparaît, le ticket reste lisible 30 jours dans l'app puis est effacé) ; avis de l'auteur gardé anonyme (défaut) ou supprimé à l'effacement ([tickets.md](tickets.md#supprimer-un-ticket-fermé)) |

Chaque commande fait **les mêmes contrôles que l'app** avec le compte lié : membre de la team, module activé, bon
droit. Un joueur qui tape `/evenement-creer` reçoit « Tu n'as pas la permission ». Une commande ne touche **que
les teams liées au serveur** où elle est tapée. Tout est écrit dans le **Journal** de la team (« a utilisé
/prochain sur Discord », création, relance…).

Quelqu'un qui n'a pas lié son compte reçoit : **« Lie ton compte avec /lier »**.

## Rôles temporaires

Demande du Fondateur : le **coach donne un rôle Discord à durée limitée** à des personnes, par exemple un try-out (TO)
qui reçoit « ⟡ 🎤𝙄𝙣𝙩𝙚𝙧𝙫𝙚𝙣𝙖𝙣𝙩 𝙏𝙁 ⟡ » pendant 24 h. Le rôle est choisi **d'après la team du coach** (The Final LZ0 :
Intervenant TF, Valorant LZ0 : un autre rôle). Les noms de rôles viennent de Discord et sont affichés tels quels, Unicode
fantaisie compris.

**La commande** (réponse visible par vous seul) :

| Commande | Effet |
| --- | --- |
| `/role-temp donner membre:@x [duree:24h] [raison:…] [equipe:…]` | ajoute le rôle de la team au membre (`PUT /guilds/{serveur}/members/{id}/roles/{rôle}`), note l'octroi (team, rôle, personne, qui l'a donné, raison, échéance), répond en privé (français ou anglais selon la langue de l'appelant), prévient la personne par message privé (réglage) et écrit dans le salon des journaux (réglage, les deux langues selon « Langue des messages » des tickets). La durée se tape `24h`, `90m`, `2j`, `1h30` ; de **1 h à 30 jours** |
| `/role-temp retirer membre:@x [equipe:…]` | retire le rôle tout de suite et clôt l'octroi (sans `equipe`, l'octroi de la personne parmi vos teams) |
| `/role-temp liste [equipe:…]` | les rôles actifs de la team : qui, et l'échéance (« dans 3 heures ») |

- **Quelle team** : celle de l'appelant d'après son compte lié par `/lier` et sa place dans les teams (membre actif avec un
  rôle autorisé). Avec **plusieurs teams**, l'option `equipe` (autocomplétion limitée à SES teams) précise laquelle ;
  sans elle le bot répond en listant les teams possibles. Un joueur, un compte non lié ou un serveur qui n'est pas celui de
  la team reçoivent une explication claire.
- **Redonner prolonge** : la personne a déjà le rôle, la nouvelle échéance est la plus tardive entre l'ancienne et
  « maintenant + durée » (jamais raccourcie). Un seul octroi actif par team et par personne.
- **Échéance** : le **cron** (toutes les 5 minutes) et le processus qui tient la connexion en direct (toutes les 20 s, seul
  le meneur) retirent le rôle (`DELETE …/roles/{rôle}`). Personne partie du serveur, rôle supprimé ou déjà retiré (404) :
  l'octroi est clos sans erreur. Limite de débit de Discord : nouvel essai après `retry_after`. Hiérarchie des rôles ou
  Discord injoignable : essais espacés (5 min, 10 min… 6 h), **10 au plus**, puis l'octroi passe en « échec » et le salon des
  journaux est prévenu (retirez le rôle à la main).
- **Réglages par team** : page de la team › **Discord › Rôles temporaires** (permission `discord.manage`) — activer, **rôle
  Discord à donner** (choisi parmi ceux du serveur, avertissement si le rôle du bot est en dessous), **durée par défaut**
  (24 h, de 1 h à 720 h), **personnes en même temps** (10 par défaut, 1 à 100), **qui peut donner le rôle** (rôles de la
  team ; aucun choisi : Coach, Manager, Propriétaire ; les Fondateurs du club toujours), **salon des journaux**, **MP à la
  personne**. Vue d'ensemble de toutes les teams et commandes dans **Administration › Bot Esport HQ › Fonctionnalités ›
  Rôles temporaires**.
- **Dans l'app** : page de la team › **Membres et rôles › Rôles temporaires** (visible de ceux qui peuvent donner le rôle) :
  personnes qui l'ont (expire dans, donné par, raison), **Prolonger** (de la durée par défaut), **Retirer**, et un
  formulaire **Donner** avec recherche d'une personne du serveur Discord.
- **Commandes** : chaque sous-commande peut être désactivée ou réservée à des rôles Discord (Administration › Bot Esport HQ ›
  Rôles temporaires › Commandes ; un administrateur du serveur n'est jamais bloqué). Journal d'activité de la team :
  « Max a donné le rôle temporaire … à … », « … est arrivé à échéance ».
- **Permissions Discord** : « Gérer les rôles » (déjà dans la liste centrale `permissions-bot.mjs`, fonctionnalité
  `roles_temp`) et, pour le salon des journaux, voir le salon et y écrire. **Le rôle du bot doit être AU-DESSUS du rôle
  temporaire** (Paramètres du serveur › Rôles) : sinon Discord refuse (403), et le bot l'explique en nommant les deux rôles.

**À faire après la mise à jour** (une fois) :

1. **Réenregistrer les commandes** (étape 6, ou Administration › Bot Esport HQ › Commandes › *Réenregistrer les commandes*) :
   la commande `/role-temp` est nouvelle ; le tableau « enregistrées / attendues » doit repasser « À jour ».
2. Sur Discord, **glisser le rôle « Esport HQ » au-dessus des rôles temporaires** (Paramètres du serveur › Rôles). Si le bot a
   été invité avant cette version, « Gérer les rôles » est déjà demandé (tickets, salons vocaux) ; sinon réinvitez-le avec le
   lien de l'onglet Bot Esport HQ.
3. Page de la team › Discord › **Rôles temporaires** : choisir le rôle, activer, vérifier la durée ; chaque coach lie son
   compte avec `/lier` (étape 8).

Base : migration `0066_roles_temporaires.sql` (`roles_temp_reglages`, `roles_temp_octrois`, commandes dans
`tickets_reglages` clé `roles_temp_commandes`). Code : `esport/noyau/roles-temp/` (`reglages.mjs`, `equipes.mjs` team de
l'appelant, `moteur.mjs` octroi / retrait / échéance, `bot.mjs` `/role-temp`, `service.mjs` + `routes.mjs` app), tâche
« rôles Discord temporaires » de `esport/noyau/cron.mjs`. Routes : `GET|PUT|POST|DELETE /teams/:t/roles-temporaires…`,
`GET /roles-temp/config`, `PUT /roles-temp/config/commandes`. Tests : `esport/test/roles-temp.test.mjs`,
`src/esport/RolesTemp.test.tsx`.

## Langues : anglais d'abord, fil français

- **Messages du salon** (annonces, rappels, « c'est maintenant », relances, résumés, tâches, objectifs, ressources,
  review, strats, membres… par le bot comme par le webhook) : par défaut, chaque message part **en anglais** (texte,
  embed, boutons, dates : `Wednesday 21 October`), avec les **pings** des convoqués et le rôle mentionné. Juste
  après, le bot ouvre un **fil** (thread) sur ce message, nommé « 🇫🇷 Version française · <titre> », et y poste la
  **version française** complète (même embed traduit, boutons RSVP compris : ils marchent aussi dans le fil),
  **sans aucune mention**. Quand les réponses changent, l'annonce anglaise et sa version française sont rééditées.
  Détails, salon forum et réglage : [discord.md](discord.md#anglais-dabord-puis-un-fil-français).
- **Fil impossible** (bot non configuré, bot absent du serveur, permission **Create Public Threads** ou **Send
  Messages in Threads** manquante) : le message anglais reste ; **aucun second message français**. Le bot poste
  dans le salon une courte **alerte** (anglais puis français) qui **mentionne le Fondateur** (son compte Discord lié
  par `/lier`, sinon le Discord ID saisi pour le compte Fondateur ; sans l'un ni l'autre, le texte « Fondateur »
  sans ping, et le Journal le signale) avec la permission manquante — **au plus une alerte par salon et par 24 h**.
- **Désactiver le fil** : **Réglages › Discord › Langue principale : anglais (défaut) + fil français**. Sans fil,
  un seul message part, dans la langue choisie juste en dessous (français par défaut).
- Un **modèle personnalisé** n'est jamais traduit (il sert pour l'anglais et pour le fil) ; un message déjà en file
  garde la langue de sa création.
- **Réponses aux commandes** (toujours éphémères, seul l'auteur les voit) : **anglais par défaut**. Ordre : 1. la
  langue **choisie** par la personne dans son profil Esport (compte lié) ; 2. sinon la **locale Discord** de
  l'interaction : `fr` → français ; 3. sinon anglais. Choix : rester cohérent avec les messages du salon (anglais),
  tout en servant en français, en privé, quelqu'un dont Discord est en français. La « langue par défaut » d'un compte
  réglée par le Fondateur (française pour tous les comptes existants) **ne s'applique plus au bot** ; elle vaut
  toujours pour l'app et les e-mails.
- **Noms des commandes** inchangés (`/prochain`, `/planning`…) ; leurs **descriptions sont en anglais**, traduites
  en français pour les clients Discord en `fr` (`description_localizations`, noms des choix compris).
  `/evenement-creer` accepte `today`/`tomorrow` comme `aujourd'hui`/`demain`.
- Les messages d'erreur de l'API restent des codes ; le bot les traduit avec la même table que l'app
  (`esport/noyau/erreurs.json`).

**Après la mise à jour** (la migration `0020` est appliquée par le déploiement automatique) : relancez l'étape 6
(elle **enregistre les descriptions anglaises et leurs traductions françaises** auprès de Discord) et donnez au bot
les permissions de fil (étape 5).

## Identité visuelle

- Nom conseillé : **Esport HQ**. « À propos » : *🎮 Bot de la team Esport · scrims, matchs, rappels et présences.
  /aide pour commencer, /lier pour relier ton compte.* (`docs/esport/bot/identite.json`).
- Avatar et bannière : `docs/esport/bot/avatar.png` (1024 × 1024) et `banniere.png` (1360 × 480), fabriqués à
  partir des SVG du même dossier (`node esport/outils/discord-identite.mjs`, qui refait aussi les aperçus).
- Posés par l'étape 6 (`--identite`). **À la main** : portail développeur › votre application ›
  **General Information** › **App Icon** (avatar.png) et **Description** (le « À propos ») ; menu **Bot** ›
  **Icon** (avatar.png) et **Banner** (banniere.png) › **Save Changes**.

## Sécurité et données

- **Aucun secret dans le dépôt.** Le jeton du bot est dans `~/.appdashboard/esport.env` sur le serveur ;
  l'Application ID et la Public Key sont publics.
- **Chaque appel de Discord est vérifié** : signature Ed25519 avec la Public Key, et horodatage de moins de
  5 minutes. Sinon : refus (401).
- **Codes de liaison** : 10 minutes, une seule fois ; seule leur empreinte est gardée ; 10 essais au plus par
  10 minutes et par compte Discord.
- **Mentions** : uniquement les identifiants des convoqués liés, listés un à un (`allowed_mentions`) ; tout texte
  venu des utilisateurs est neutralisé (`@everyone`, `<@…>` deviennent inoffensifs).
- **Vos données** : l'identifiant Discord lié et le Discord ID du membre figurent dans **Exporter mes données** (et
  dans l'export RGPD demandé par le Fondateur) ; **Supprimer mes données** (ou la suppression du compte par le
  Fondateur, ou dans l'Administration) les efface.
- Limite de débit de Discord (429) : le bot attend le délai demandé ; erreurs passagères : nouvel essai dans 1, 5,
  15 min, 1 h, 3 h ; refus (salon supprimé, bot retiré) : abandon, écrit dans le Journal.

## En cas de souci

| Constat | Que faire |
| --- | --- |
| Les commandes n'apparaissent pas avec `/` | Relancez l'étape 6 ; attendez une minute ; vérifiez que le bot est bien invité avec le scope **applications.commands**. |
| « L'application n'a pas répondu » | L'adresse des interactions (étape 4) est fausse, ou la Public Key ne correspond pas : vérifiez `esport.env`, redémarrez l'app Esport, puis relancez l'étape 6. |
| « Ce serveur n'est lié à aucune team » | Étape 7. |
| « Lie ton compte avec /lier » | Étape 8. |
| Un convoqué n'est pas pingé | Badge « Discord ID manquant » dans Esport › Membres : le Fondateur renseigne son Discord ID (étape 9), ou le joueur fait `/lier`. Rappel : un joueur n'est mentionné **qu'une fois par événement** (sur l'annonce) ; les rappels ne le re-mentionnent pas. |
| Un joueur ne reçoit pas les MP du bot | Réglages › Discord › Relances par MP : son nom y figure avec l'action (lier son compte, ouvrir ses MP pour ce serveur, ne pas bloquer le bot). En attendant, il est cité dans le salon. |
| Vérifier les MP du bot sans attendre une relance | Réglages › Discord › **Tester les MP** : MP de test par membre avec la cause de l'échec et l'action à faire, simulation d'une relance ([discord.md](discord.md#tester-les-mp-du-bot)). |
| Rien n'arrive dans le salon | Le bot doit voir le salon et pouvoir y écrire (permissions du salon) ; regardez **Réglages › Discord › Derniers envois** et le Journal. |
| « Bot non configuré (DISCORD_BOT_TOKEN) » dans les envois | `DISCORD_BOT_TOKEN` manque dans `esport.env` : étape 3. |
| Alerte « French thread unavailable · Fil français impossible » dans le salon | Donnez au bot **Create Public Threads**, **Send Messages in Threads** et **Read Message History** sur ce salon (étape 5), puis **Envoyer un message de test**. L'alerte ne revient pas avant 24 h dans ce salon. |
| Le jeton a fuité | Portail › Bot › **Reset Token**, mettez le nouveau dans `esport.env` (et `relais.env` s'il y est), redémarrez les apps. |

## Pour les développeurs

- Cœur portable : `esport/noyau/discord/bot/` (`signature.mjs` Ed25519, `interactions.mjs` commandes, boutons,
  réponses différées, `liaisons.mjs` codes et routes de l'app, `commandes.mjs` définitions) ;
  `esport/noyau/discord/embeds.mjs` (mise en page, limites de Discord), `occurrence.mjs`, `convoques.mjs`.
  Le serveur ne fait que brancher `DISCORD_*` (`esport/serveur/config.mjs`).
- **Qui pinger** : une seule fonction, `comptesConvoques()` dans `esport/noyau/discord/convoques.mjs`, branchée sur
  la règle des convocations du planning (`esport/noyau/planning/convocations.mjs`, convocation de la date sinon de la
  série). Le webhook nomme les convoqués et ne fait qu'une mention de rôle ; le bot mentionne chaque convoqué :
  `membresTeam()` rend `discordId = discord_comptes.discord_user_id ?? comptes.discord_id` (la liaison `/lier`
  prime).
- Discord ID : migration `0015_discord_id_courriel.sql` (`comptes.discord_id` unique, `demandes_compte.discord_id`),
  validation `esport/noyau/discordId.mjs`, route `PUT /comptes/:compte/discord-id` (Fondateur seul, 403 sinon),
  champ `discordId` de `POST /comptes`, `POST /comptes/:c/teams` et `POST /comptes/demandes`. Tests :
  `esport/test/discord-id.test.mjs`, `src/esport/InvitationsDirectes.test.tsx`.
- Base : migration `0011_bot_discord.sql` (`discord_serveurs`, `discord_comptes`, `discord_codes`,
  `discord_bot_pings`, `discord_annonces`, `discord_debuts`, colonnes `canal`, `operation`, `salon_id` de la file).
- Routes : `POST /discord/interactions` (Discord, sans session) ; `GET|DELETE /moi/discord`,
  `POST /moi/discord/code` ; `GET /teams/:t/discord/bot`, `POST …/bot/code`, `DELETE …/bot/serveur`,
  `PUT …/bot/pings/:type`.
- Commandes : `node esport/outils/discord-commandes.mjs [--identite] [--adresse URL] [--essai]`.
- Langues : `esport/noyau/langues.mjs` et `esport/noyau/textes/{fr,en}.mjs` (textes du serveur), `catalogue.mjs`
  (modèles par défaut en anglais), migration `0012_langues.sql` (`comptes.langue`, `teams.langue_discord`), routes
  `PUT /moi/langue` et `PUT /teams/:t/discord/langue`. Test : `esport/test/langues.test.mjs`.
- Messages bilingues : `esport/noyau/discord/bilingue.mjs` (noms de fil, nonce, motifs, alerte au Fondateur) et
  `traiterFile()` de `file.mjs` (tâche en trois étapes) ; migration `0020_discord_bilingue.sql`
  (`discord_bilingue`, `discord_alertes_fil`, colonnes de progression de `discord_file`, version française des
  annonces) ; route `PUT /teams/:t/discord/bilingue` `{ filFr }`. Test : `esport/test/discord-bilingue.test.mjs`.
- Pings une seule fois et MP (migration `0031_discord_pings_mp.sql`) : `phaseMp()` et `chargeDeLigne()` de
  `file.mjs`, boutons RSVP en MP dans `interactions.mjs` (pas de `guild_id` : l'événement est retrouvé par son
  identifiant, l'appartenance à la team est vérifiée par le service). Test : `esport/test/discord-pings-mp.test.mjs`.
- Tests : `esport/test/bot-discord.test.mjs`, `bot-embeds.test.mjs`, `bot-outils.test.mjs` (fetch simulé, clé de
  test générée, faux Discord local), `src/esport/Discord.test.tsx` (écrans), `scripts/e2e-esport-bot.mjs`
  (navigateur). Aucun test n'appelle le vrai Discord.
