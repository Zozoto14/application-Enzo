# Esport : tickets Discord

Demande du Fondateur : un **système de tickets** sur le serveur Discord du club, tenu par notre bot « Esport HQ », et
**tout paramétrable dans l'AppDashboard** (page **Tickets**). Chaque ticket est un **salon privé** (l'auteur, les rôles
qui traitent la catégorie et le bot) ; le staff répond **sur Discord ou depuis l'app** ; à la fermeture, un
**transcript** est gardé, l'auteur reçoit un **MP récapitulatif** et peut **noter** le ticket (1 à 5).

Décisions : connexion **Gateway** permanente du bot (messages reçus en temps réel), salons privés, pas de signalement
anonyme, messages du bot **bilingues** (langue de la personne d'abord, l'autre dessous), **un seul serveur** Discord
(celui du club), fermeture automatique après **7 jours** d'inactivité (réglable, avertissement 24 h avant).

Livraison par étapes : **1. socle et configuration** (ce document, à jour) · 2. cycle de vie des tickets · 3. tickets
dans l'app · 4. commandes utiles.

---

## Activer les tickets (Fondateur, une fois)

### 1. Côté Discord (portail développeur)

1. **https://discord.com/developers/applications** › votre application (« Esport HQ ») › menu **Bot**.
2. Rubrique **Privileged Gateway Intents** : activez **Message Content Intent**, puis **Save Changes**. Sans lui,
   Discord refuse la connexion en direct (code 4014) : l'app affiche « Connexion Discord : secours » avec ce rappel, et
   le bot relit les tickets par l'API (plus lent). Les intents **Presence** et **Server Members** restent éteints.
   (Moins de 100 serveurs : aucune validation de Discord n'est demandée.)
3. Permissions du bot sur le serveur du club, en plus de celles des annonces ([bot-discord.md](bot-discord.md)) :
   **Gérer les salons** (créer, déplacer, renommer, supprimer les salons de tickets), **Gérer les rôles** (droits de
   chaque salon : l'auteur, les rôles de la catégorie), **Joindre des fichiers**. Le plus simple : **Tickets ›
   Configuration › Connexion › Inviter le bot (ou mettre ses permissions à jour)**, qui ouvre le lien d'invitation avec
   toutes les permissions (`permissions=309506329616`). La même page **vérifie** ce que le bot a vraiment, au niveau du
   serveur puis dans les catégories et le salon choisis, et dit ce qui manque.
4. Le rôle du bot doit être **au-dessus** des rôles qu'il place sur les salons (Paramètres du serveur › Rôles : glisser
   « Esport HQ » plus haut), sinon Discord refuse les droits des salons.

### 2. Côté serveur (o2switch)

Rien de nouveau dans `esport.env` : le jeton du bot (`DISCORD_BOT_TOKEN`) suffit. Facultatif : `TICKETS_GATEWAY=non`
coupe la connexion en direct (relecture de secours seulement), sans rien changer d'autre. La migration `0054` est
appliquée par le déploiement automatique.

### 3. Dans l'app : **Tickets › Configuration**

1. **Général** : choisir le **serveur** (liste des serveurs où est le bot), la **catégorie Discord des tickets
   ouverts**, celle des **archives**, le **salon des journaux** ; la langue des messages ; les délais. Puis **Tickets
   activés** et **Enregistrer**.
2. **Catégories** : en créer une par type de demande (Recrutement, Partenariat, Demande CM, Aide…).
3. **Panneaux** : un message fixe avec les boutons (ou un menu) « ouvrir un ticket », publié dans un salon public.
4. **Connexion** : la pastille doit passer à **en direct** dans la minute.

---

## La page « Tickets »

Entrée **Tickets** de la navigation (PC : barre latérale ; téléphone : barre du bas, ou **Plus** quand il y a plus de
cinq entrées). Visible avec `tickets.voir` ou `tickets.configurer` (le Fondateur toujours).

En tête, la **connexion Discord** :

| Pastille | Sens |
| --- | --- |
| **En direct** | un processus de l'app tient la Gateway : les messages arrivent en moins d'une seconde |
| **Secours** | la Gateway est indisponible (connexion en cours, intent refusé, app endormie…) : les tickets ouverts sont relus par l'API toutes les 45 s (processus meneur) ou toutes les 5 min (cron) ; rien n'est perdu |
| **Hors ligne** | plus rien depuis plusieurs minutes (tickets désactivés, jeton absent, cron arrêté) |

### Configuration (Fondateur, `tickets.configurer`)

| Section | Contenu |
| --- | --- |
| **Connexion** | état de la connexion et explication ; « intent Message Content à activer » si Discord a refusé (4014) ; **permissions du bot** au niveau du serveur, puis dans la catégorie des tickets ouverts, celle des archives et le salon des journaux, avec ce qui manque ; lien d'invitation |
| **Général** | tickets activés ; serveur Discord (un seul) ; catégorie Discord des tickets ouverts et des archives ; salon des journaux ; **langue des messages** ; fermeture automatique (heures sans message, défaut 168 = 7 jours ; 0 = jamais) ; avertissement avant (défaut 24 h) ; suppression des salons archivés (défaut 7 jours) ; **rétention** des tickets fermés (défaut 365 jours) ; copie des pièces jointes et taille maximale |
| **Catégories** | nom et description FR / EN, icône (monochrome), couleur, ordre, active ou non ; **rôles Discord** qui traitent (voient le salon) et **rôles de l'app** qui traitent (voient le ticket dans l'app) ; **formulaire** (5 champs au plus : limite des fenêtres Discord ; libellé de 45 caractères, réponse courte ou longue, obligatoire, exemple, longueur max ; FR / EN) ; message d'accueil propre ; modèle du nom de salon (`ticket-{numero}-{pseudo}`) ; tickets ouverts au plus par personne ; fermeture automatique propre ; satisfaction oui / non ; priorité par défaut (4 niveaux d'urgence du CM) ; rôles mentionnés à l'ouverture (5 au plus) ; **liaison** facultative (Recrutement → fiche du membre, Partenariat → prospect Sponsors, Demande CM → carte du tableau CM choisi) |
| **Panneaux** | titre et texte FR / EN, couleur, **image du Drive** (PNG, JPEG, GIF, WebP, 8 Mo), boutons ou menu déroulant, catégories proposées, salon de publication ; **aperçu comme sur Discord** (la charge exacte que le bot enverra) ; **Publier** puis **Mettre à jour** (le même message est modifié) |
| **Messages** | accueil, prise en charge, libération, attente, fermeture, réouverture, avertissement d'inactivité, demande de note, remerciement, MP récapitulatif, réponse hors horaires ; FR et EN ; vide = texte par défaut (affiché en gris) ; variables `{utilisateur}` `{numero}` `{categorie}` `{staff}` `{raison}` `{delai}` `{serveur}` `{horaires}` `{ouverture}` `{fermeture}` `{note}` |
| **Liste noire** | comptes Discord (Discord ID) interdits d'ouvrir un ticket, avec un nom et une raison |
| **Horaires** | horaires du support (plages par jour, fuseau) et réponse automatique hors horaires (facultatif) |
| **Commandes** | chaque commande `/ticket …` activable ou non, et réservée à des rôles Discord |

### Langues (bilingue)

Réglage **Langue des messages du bot** : **langue de la personne, puis l'autre** (défaut), anglais puis français,
français puis anglais, français seul, anglais seul. La « langue de la personne » est la langue de son compte Esport
lié, sinon la langue de son client Discord. Dans un même message, la seconde langue est écrite **dessous, en
citation** (barre grise) : on lit sa langue d'un coup d'œil. Les panneaux (publics) sont en anglais puis français
avec le réglage par défaut. Les réponses visibles par une seule personne (éphémères) sont dans sa langue seulement.

---

## Connexion Discord : un seul processus, et un secours

L'app Esport tourne sous **Passenger** chez o2switch : plusieurs processus Node possibles, qui peuvent être arrêtés
quand l'app est inactive. Discord ne veut **qu'une** connexion Gateway par bot (sans shards), et le pare-feu
mutualisé n'aime pas les connexions en rafale. D'où (`esport/noyau/tickets/superviseur.mjs`) :

- **Bail du meneur** (table `tickets_bail`, une ligne) : chaque processus passe toutes les 20 s (une requête SQL) ;
  il prend le bail s'il est libre ou expiré, le renouvelle s'il l'a (60 s). La mise à jour est conditionnelle et
  atomique (PostgreSQL comme SQLite) : **un seul meneur**. Un meneur arrêté perd son bail à l'expiration, un autre
  processus le reprend ; un processus qui n'est plus meneur ferme aussitôt sa connexion. Pas de verrou consultatif
  PostgreSQL : il demanderait une connexion tenue en permanence (le nombre de connexions est compté chez o2switch).
- **Gateway** (`gateway.mjs`, WebSocket natif de Node 22, sans dépendance) : HELLO, battements et ACK (connexion
  « zombie » détectée et reprise), IDENTIFY avec les intents minimaux **GUILDS, GUILD_MESSAGES, MESSAGE_CONTENT**
  (33281), **RESUME** de la session après une coupure — même par un autre processus (session gardée en base,
  `tickets_etat`) —, reconnexion à **attente exponentielle avec une part au hasard** (2 s → 5 min), budget de
  sessions (`/gateway/bot`) respecté (aucun IDENTIFY quand il reste moins de 5 sessions), fermetures fatales (jeton,
  intents : 4004, 4013, 4014…) sans nouvel essai avant 30 min. Seuls les **salons de tickets** sont lus ; tout le
  reste est ignoré.
- **Secours** : Gateway indisponible → le meneur relit par l'API les tickets ouverts (25 salons au plus par passage,
  toutes les 45 s, arrêt au premier 429) ; aucun meneur (app endormie) → le **cron** (toutes les 5 min) relit, puis
  réveille l'app (`GET /sante`) pour qu'un meneur reprenne la Gateway. Un message vu par la Gateway et par la
  relecture n'est enregistré qu'**une fois** (identifiant Discord unique par ticket).

## Qui voit quoi (permissions)

Quatre permissions du **club** (catalogue, page **Rôles et permissions**, catégorie **Tickets**) ; le Fondateur les a
toutes, le **Second CEO** les reçoit par défaut :

| Permission | Effet (vérifié par le serveur) |
| --- | --- |
| `tickets.voir` | la page Tickets ; les tickets des catégories **qu'on traite** : une catégorie dont un des « rôles de l'app » est porté par le compte (rôle du club, ou rôle CM attribué au club) ; une catégorie sans rôle de l'app réglé est visible de tous ceux qui ont `tickets.voir` |
| `tickets.repondre` | répondre depuis l'app, notes internes, prendre en charge, mettre en attente, fermer et rouvrir les tickets qu'on voit |
| `tickets.gerer` | **toutes** les catégories, assigner, changer de catégorie, ajouter ou retirer quelqu'un, transcripts, statistiques |
| `tickets.configurer` | la Configuration (n'ouvre aucun ticket à elle seule) |

Sans `tickets.voir` ni `tickets.configurer`, toutes les routes `/tickets…` répondent **404**. Les droits sont relus à
chaque requête (aucun cache) : un rôle retiré ferme aussitôt ce qu'il ouvrait.

**Notifications** : les événements des tickets ne vont **jamais** dans le fil commun du centre de notifications
(l'accès dépend de la catégorie du ticket) ; seules des notifications **personnelles** (`tk-*`) partent, à ceux qui
voient la catégorie, et la catégorie est **relue à chaque lecture** : qui ne voit plus la catégorie ne voit plus ses
notifications. Elles n'entrent pas dans le récapitulatif e-mail.

## Confidentialité, données

- Les conversations, notes internes, réponses aux formulaires et transcripts sont des **données sensibles** : jamais
  envoyées à une IA externe (aucune fonction des tickets n'appelle l'IA), jamais copiées dans le fil des
  notifications, le journal ou le temps réel (ils ne portent que des identifiants, le numéro et la catégorie).
- **Pièces jointes** : copiées dans le **stockage privé** du serveur (`tickets/<ticket>/<pièce>`, hors `public_html`),
  seulement depuis le CDN de Discord, sans suivre de redirection, sous la taille réglée (8 Mo par défaut) ; sinon
  seulement **référencées** (adresse Discord, qui expire). Choix fait plutôt qu'un dossier du Drive : le Drive est
  partagé par l'équipe CM, les pièces d'un ticket ne doivent être vues que par ceux qui voient le ticket. Lecture par
  lien signé de quelques minutes, délivré après contrôle d'accès.
- **Rétention** réglable (défaut 365 jours) ; RGPD : export et effacement (étape 2).
- Export / import de la base : les tables des tickets suivent (sauf le bail et l'état de la connexion, passagers) ;
  `esport/serveur/importer.mjs` copie aussi les pièces stockées.

## API (préfixe facultatif `/api/esport`)

| Route | Effet |
| --- | --- |
| `GET /tickets/moi` | droits du compte (`voir`, `repondre`, `gerer`, `configurer`), tickets activés |
| `GET /tickets/etat` | état de la connexion Discord (`direct`, `secours`, `hors_ligne`), intent ou jeton refusé |
| `GET /tickets/config` | toute la configuration (`tickets.configurer`) |
| `GET /tickets/config/discord` | serveurs du bot, salons, rôles, permissions du bot et ce qui manque |
| `PUT /tickets/config/(general\|messages\|horaires\|commandes)` | réglages |
| `POST /tickets/config/categories` ; `PATCH\|DELETE …/categories/:id` ; `PUT …/categories/ordre` | catégories |
| `POST /tickets/config/panneaux` ; `PATCH\|DELETE …/panneaux/:id` ; `GET …/:id/apercu` ; `POST …/:id/publier` | panneaux |
| `POST /tickets/config/liste-noire` ; `DELETE …/liste-noire/:discordId` | liste noire |

Discord appelle toujours `POST /discord/interactions` (signature Ed25519) : les boutons, menus et fenêtres des tickets
(`custom_id` commençant par `tk:`) et les commandes `/ticket`, `/tickets` y sont traités **sans compte lié**.

## Pour les développeurs

- Code : `esport/noyau/tickets/` — `acces.mjs` (droits), `reglages.mjs` (réglages, validations), `textes.mjs`
  (messages FR / EN, composition bilingue), `panneaux.mjs` (charges Discord), `discord.mjs` (REST, permissions),
  `gateway.mjs` (client Gateway), `superviseur.mjs` (bail, secours, état), `conversation.mjs` (messages reçus,
  pièces jointes, temps réel), `service.mjs` (configuration), `routes.mjs`, `bot.mjs` (interactions), `bus.mjs`
  (événements, notifications), `cron.mjs`.
- Migration `0054_tickets.sql` ; permissions au catalogue (`catalogue.json`) ; Second CEO par défaut (test
  `roles-permissions.test.mjs`).
- Écrans : `src/esport/ui/tickets/` (`PageTickets.tsx`, `ConfigTickets.tsx`, `ApercuDiscord.tsx`), API
  `src/esport/tickets/api.ts`, textes `src/esport/i18n/tickets.ts`.
- Tests : `esport/test/tickets-gateway.test.mjs` (faux serveur Gateway WebSocket : HELLO, battements, RESUME,
  zombie, INVALID_SESSION, 4014, budget ; bail entre deux processus simulés ; relecture de secours ; cron),
  `esport/test/tickets-config.test.mjs` (configuration par l'API, faux Discord REST), `src/esport/Tickets.test.tsx`
  (écrans). Aides : `esport/test/tickets-aide.mjs`. Aucun test n'appelle le vrai Discord.
