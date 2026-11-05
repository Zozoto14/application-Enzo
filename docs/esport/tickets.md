# Esport : tickets Discord

Demande du Fondateur : un **système de tickets** sur le serveur Discord du club, tenu par notre bot « Esport HQ », et
**tout paramétrable dans l'AppDashboard** (page **Tickets**). Chaque ticket est un **salon privé** (l'auteur, les rôles
qui traitent la catégorie et le bot) ; le staff répond **sur Discord ou depuis l'app** ; à la fermeture, un
**transcript** est gardé, l'auteur reçoit un **MP récapitulatif** et peut **noter** le ticket (1 à 5).

Décisions : connexion **Gateway** permanente du bot (messages reçus en temps réel), salons privés, pas de signalement
anonyme, messages du bot **bilingues** (langue de la personne d'abord, l'autre dessous), **un seul serveur** Discord
(celui du club), fermeture automatique après **7 jours** d'inactivité (réglable, avertissement 24 h avant).

Livraison par étapes : **1. socle et configuration** · **2. cycle de vie des tickets** · **3. tickets dans l'app** ·
**4. commandes utiles** · puis **tickets paramétrables** (un ticket ou une catégorie qui ne se ferme jamais, fermeture
par le staff seul : voir « Tickets qui ne se ferment jamais »), puis **avis et suppression** (onglet **Avis** : les
notes et commentaires des auteurs ; un ticket fermé peut être **supprimé** définitivement : voir « Supprimer un ticket
fermé »).

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

Rien de nouveau dans `esport.env` : le jeton du bot (`DISCORD_BOT_TOKEN`) suffit, avec `URL_PUBLIQUE` (déjà posée à
l'installation, [o2switch.md](../o2switch.md) étape A6) : l'app s'en sert pour **rester éveillée** tant qu'elle tient
la connexion Discord (Passenger arrête un processus qui ne reçoit plus de requête), et la tâche cron pour la
**réveiller**. La **tâche cron Esport** (toutes les 5 minutes, [o2switch.md](../o2switch.md) étape A9) doit tourner :
elle relit les tickets quand l'app dort et la réveille. Facultatif : `TICKETS_GATEWAY=non` coupe la connexion en
direct (relecture de secours seulement), sans rien changer d'autre. La migration `0054` est appliquée par le
déploiement automatique. L'onglet **Connexion** dit lui-même ce qui manque (jeton, `URL_PUBLIQUE`, cron jamais vu ou
arrêté, avec la commande à copier dans cPanel).

### 3. Dans l'app : **Tickets › Configuration**

1. **Général** : choisir le **serveur** (liste des serveurs où est le bot) : ses catégories et salons s'affichent
   **aussitôt** (rien à enregistrer avant) ; choisir la **catégorie Discord des tickets ouverts**, celle des
   **archives**, le **salon des journaux** ; la langue des messages ; les délais. Puis **Tickets activés** et
   **Enregistrer** : tout est enregistré **en une fois**. Activer sans catégorie est refusé, et l'écran le dit au-dessus
   du bouton. Si Discord refuse la lecture du serveur (bot absent, **403 / 50001 Missing Access**…), l'erreur et ce
   qu'il faut faire (réinviter le bot, puis **Relire le serveur**) s'affichent sous le choix du serveur.
2. **Catégories** : en créer une par type de demande (Recrutement, Partenariat, Demande CM, Aide…).
3. **Panneaux** : un message fixe avec les boutons (ou un menu) « ouvrir un ticket », publié dans un salon public.
4. **Connexion** : la pastille doit passer à **en direct** dans la minute. Sinon, le **diagnostic** de cet onglet
   dit quelle condition manque (voir « Diagnostic de la connexion »).

---

## La page « Tickets »

Entrée **Tickets** de la navigation (PC : barre latérale ; téléphone : barre du bas, ou **Plus** quand il y a plus de
cinq entrées). Visible avec `tickets.voir` ou `tickets.configurer` (le Fondateur toujours).

En tête, la **connexion Discord** :

| Pastille | Sens |
| --- | --- |
| **En direct** | un processus de l'app tient la Gateway : les messages arrivent en moins d'une seconde |
| **Secours** | la Gateway est indisponible (connexion en cours, intent refusé, app endormie…) : les tickets ouverts sont relus par l'API toutes les 45 s (processus meneur) ou toutes les 5 min (cron) ; rien n'est perdu |
| **Hors ligne** | plus rien depuis plusieurs minutes (tickets désactivés, jeton absent, app arrêtée et cron arrêté) : le diagnostic de **Configuration › Connexion** dit pourquoi |

Onglets : **Tickets** (`tickets.voir`), **Statistiques** (`tickets.gerer`), **Avis** (`tickets.gerer`, ou
`tickets.configurer` pour les catégories de ses rôles), **Configuration** (`tickets.configurer`).
Le **compteur** de l'entrée « Tickets » de la navigation donne le nombre de tickets ouverts avec du nouveau.

### Tickets (liste et conversation)

- **Liste** : tickets des catégories que vous traitez (toutes pour `tickets.gerer` et le Fondateur), filtres statut
  (ouverts par défaut), catégorie, priorité, responsable (moi, personne : `responsable=moi|personne`), dates d'ouverture, **recherche** (n°, auteur,
  réponses du formulaire, conversation). **Pastille rouge** : du nouveau depuis votre dernière lecture (messages des
  autres ; ceux du bot ne comptent pas). Mise à jour **en direct** (temps réel, sujet `tickets`).
- **Vue d'un ticket** (volet) : statut, priorité (4 niveaux d'urgence), catégorie, auteur, salon, responsable, réponses
  du formulaire, **conversation en direct** (messages Discord, réponses depuis l'app, messages du bot, **notes internes**
  sur fond ambré), pièces jointes (ouvertes par un lien signé de 5 minutes ; une pièce seulement référencée garde son
  lien Discord, qui expire).
- **Répondre** (`tickets.repondre`) : le bot publie dans le salon **« Staff · votre pseudo : … »** (mentions
  neutralisées), avec jusqu'à 3 pièces jointes (5 Mo en tout, sous la limite de taille des requêtes de l'hébergeur ; depuis l'appareil sur le site et l'app PC,
  ou depuis un **Drive** que vous voyez). Interrupteur **Note interne** : la note reste dans l'app, **jamais** envoyée
  sur Discord.
- **Actions** : prendre en charge / libérer, en attente de réponse, résolu, priorité, fermer (raison) / rouvrir
  (`tickets.repondre`) ; **assigner** à un compte qui traite la catégorie, **changer de catégorie** (droits du salon mis
  à jour), **ajouter / retirer** une personne (Discord ID), **transcript** (HTML imprimable en PDF), interrupteur **Ne
  jamais fermer automatiquement** (ticket permanent, badge **Permanent** avec une punaise dans la liste et la vue)
  (`tickets.gerer`) ; ticket **fermé** : **Supprimer** (voir « Supprimer un ticket fermé »). La vue rappelle quand le ticket se fermera tout seul (« après 7 j sans message (réglage
  général) », « jamais (réglage de la catégorie) »…) et si seul le staff peut le fermer.
- **Avis de l'auteur** (ticket fermé) : sa note en étoiles, son commentaire et la date ; « pas encore noté » sinon.
- **Liaisons** : Partenariat → **créer le prospect Sponsors** (avec vos droits Sponsors), Demande CM → **créer la carte**
  dans le tableau CM choisi pour la catégorie (droits CM), **lier la fiche** de l'auteur s'il a lié son Discord.
- **Notifications** : nouveau ticket → cloche des comptes qui traitent la catégorie ; message de l'auteur dans un ticket
  pris en charge → cloche du responsable (une seule tant qu'elle n'est pas lue). **MP Discord** selon vos préférences
  (Tickets › Me prévenir en MP Discord : nouveaux tickets, nouveaux messages ; compte Discord lié requis).

### Statistiques (`tickets.gerer`)

Sur 30 jours : tickets ouverts maintenant, créés, fermés, **délai de 1re réponse** et **de résolution** (médianes),
**satisfaction moyenne** (et nombre de notes), par catégorie et par responsable. Les avis gardés (anonymes) des
tickets supprimés comptent dans la satisfaction (à la date de l'avis).

### Avis (`tickets.gerer`, ou `tickets.configurer`)

Demande du Fondateur : « voir les avis » (migration `0056_tickets_avis.sql`). Les **notes de 1 à 5** et les
**commentaires** facultatifs laissés par les auteurs dans le MP reçu à la fermeture :

- **note moyenne**, **nombre d'avis**, **répartition** des cinq notes (barres, vert pour 4-5, ambre pour 3, rouge pour
  1-2) ;
- la **liste** : étoiles (icône monochrome), ticket (n° et salon), catégorie, auteur, qui l'avait pris en charge, date,
  commentaire. **Toucher un avis ouvre son ticket** (onglet Tickets, avec `tickets.voir`) ;
- **filtres** : catégorie, note, période (7 jours, 30 jours, 90 jours, 12 mois, tout), responsable ; **tri** : plus
  récents, plus anciens, meilleures ou moins bonnes notes. Moyenne, nombre et répartition suivent les filtres **sauf la
  note** (la répartition montre toujours les cinq notes) ;
- **droits** : `tickets.gerer` (et le Fondateur) voit tous les avis ; `tickets.configurer` seul, ceux des catégories
  dont il porte un des rôles de l'app (une catégorie sans rôle de l'app : tout le monde) ; un avis d'une catégorie
  qu'on ne gère pas n'est jamais rendu ;
- un avis gardé d'un ticket **supprimé** apparaît « Ticket supprimé (avis anonyme) » : ni numéro, ni auteur, ni lien ;
- mise à jour **en direct** quand une note arrive (temps réel, sujet `tickets`).

### Configuration (Fondateur, `tickets.configurer`)

| Section | Contenu |
| --- | --- |
| **Connexion** | état de la connexion et explication ; **diagnostic** condition par condition (voir plus bas) ; « intent Message Content à activer » si Discord a refusé (4014) ; **permissions du bot** au niveau du serveur, puis dans la catégorie des tickets ouverts, celle des archives et le salon des journaux, avec ce qui manque ; lien d'invitation |
| **Général** | tickets activés ; serveur Discord (un seul) ; catégorie Discord des tickets ouverts et des archives ; salon des journaux ; **langue des messages** ; fermeture automatique (heures sans message, défaut 168 = 7 jours ; 0 = jamais) ; avertissement avant (défaut 24 h) ; suppression des salons archivés (défaut 7 jours) ; **rétention** des tickets fermés (défaut 365 jours) ; copie des pièces jointes et taille maximale |
| **Catégories** | nom et description FR / EN, icône (monochrome), couleur, ordre, active ou non ; **rôles Discord** qui traitent (voient le salon) et **rôles de l'app** qui traitent (voient le ticket dans l'app) ; **formulaire** (5 champs au plus : limite des fenêtres Discord ; libellé de 45 caractères, réponse courte ou longue, obligatoire, exemple, longueur max ; FR / EN) ; message d'accueil propre ; modèle du nom de salon (`ticket-{numero}-{pseudo}`) ; tickets ouverts au plus par personne ; **fermeture automatique** : « Délai global » (le réglage Général, défaut), délai propre **en jours** (90 au plus ; 1,5 = 36 h) ou « **Jamais** » (ni fermeture ni avertissement d'inactivité : sponsors…) ; **Seul le staff peut fermer** (l'auteur ne peut pas fermer son ticket) ; satisfaction oui / non ; priorité par défaut (4 niveaux d'urgence du CM) ; rôles mentionnés à l'ouverture (5 au plus) ; **liaison** facultative (Recrutement → fiche du membre, Partenariat → prospect Sponsors, Demande CM → carte du tableau CM choisi) |
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

## Cycle de vie d'un ticket (sur Discord)

1. **Ouverture** : bouton (ou menu) d'un panneau, ou **`/ticket ouvrir [categorie]`** (sans catégorie : menu des
   catégories, ou directement la seule active). Contrôles : tickets activés, serveur du club, catégorie active, **liste
   noire**, **plafond** de tickets ouverts par personne dans la catégorie (le bot rappelle le salon déjà ouvert), au
   plus 10 ouvertures par heure et par personne. Si la catégorie a un **formulaire**, une fenêtre Discord s'ouvre
   (5 champs au plus, libellés dans la langue de la personne).
2. Le bot crée un **salon privé** `ticket-0012-lea` dans la catégorie Discord des tickets ouverts : `@everyone` ne le
   voit pas ; l'auteur, les **rôles Discord de la catégorie** et le bot y ont accès. Message d'**accueil** (mention de
   l'auteur et des rôles à prévenir), bilingue, avec les **réponses du formulaire**, la priorité, la catégorie et quatre
   boutons : **Prendre en charge · Ajouter quelqu'un · Priorité · Fermer**. Hors des horaires du support (s'ils sont
   réglés) : réponse automatique. Une ligne part dans le **salon des journaux**. Numéro **séquentiel** (n° 1, 2, 3…).
3. **Statuts** : ouvert → pris en charge → en attente (de la réponse de l'auteur) → résolu → fermé. Quand l'auteur
   répond à un ticket « en attente », il repasse « ouvert » (ou « pris en charge »).
4. **Staff** d'un ticket (boutons et commandes du staff) : un membre qui a un des rôles Discord de la catégorie, un
   administrateur du serveur, ou une personne dont le **compte Esport lié** (`/lier`) a `tickets.repondre` et voit la
   catégorie. **Prendre en charge** (refusé si quelqu'un l'a déjà), **Ajouter quelqu'un** (choix d'un membre : droits sur
   le salon), **Priorité** (4 niveaux d'urgence). L'auteur peut **fermer** son propre ticket, sauf dans une catégorie
   réglée sur **Seul le staff peut fermer** (bouton, raison et `/ticket fermer` lui répondent « Seul le staff peut
   fermer les tickets de cette catégorie » ; un auteur qui est lui-même du staff de la catégorie peut fermer).
5. **Fermeture** (bouton **Fermer** puis **Confirmer**, ou **Fermer avec une raison**, ou `/ticket fermer [raison]`) :
   - les derniers messages du salon sont relus (le transcript est complet même si la connexion en direct était coupée) ;
   - message de fermeture (raison) avec un bouton **Rouvrir** ; le salon est **verrouillé** (l'auteur et les personnes
     ajoutées lisent seulement) et **déplacé dans la catégorie des archives** ;
   - **MP récapitulatif** à l'auteur (numéro, catégorie, serveur, raison, dates) avec la **demande de note** (boutons
     1 à 5, si la catégorie la demande) ; un clic enregistre la note et ouvre une fenêtre de **commentaire facultatif** ;
     une nouvelle note remplace la précédente. MP impossibles (l'auteur les a fermés) : rien d'autre ne bloque ;
   - le **transcript** est la conversation gardée dans l'app (messages, auteurs, pièces jointes, messages du bot ;
     les notes internes ne sont jamais envoyées sur Discord) ;
   - le salon archivé est **supprimé** après N jours (défaut 7).
6. **Réouverture** (bouton **Rouvrir**, staff) : le salon revient dans les tickets ouverts, l'auteur peut écrire ; si le
   salon a été supprimé, un nouveau est créé.
7. **Fermeture automatique** (cron, toutes les 5 min) : après le délai sans message (défaut 7 jours, réglable par
   catégorie ; jamais possible), avec un **avertissement** dans le salon 24 h avant (réglable). Tout message (de
   l'auteur ou du staff) repousse l'échéance et efface l'avertissement. Raison : « Fermeture automatique : inactivité ».
   Ordre de priorité : **ticket permanent > réglage de la catégorie > réglage général** (voir ci-dessous).
8. **Salon supprimé à la main** sur Discord : le ticket est fermé (sans message ni MP).
9. **Rétention** : après N jours (défaut 365) un ticket fermé perd sa conversation, ses pièces (octets compris), ses
   réponses et ses personnes ajoutées ; la ligne reste pour les statistiques (numéro, catégorie, dates, note).

### Supprimer un ticket fermé

Demande du Fondateur : « quand on ferme un ticket, pouvoir le supprimer après » (migration `0056_tickets_avis.sql`).
Seul un ticket **fermé** se supprime (un ticket ouvert : fermez-le d'abord). C'est **définitif** : conversation, notes
internes, pièces jointes (octets du stockage compris), personnes ajoutées, « lu », notifications et transcript
disparaissent, ainsi que le **salon archivé sur Discord** s'il existe encore (au mieux : déjà supprimé à la main = 404
ignoré ; tout autre refus de Discord est noté dans les journaux du serveur, la suppression est faite quand même).

- **Dans l'app** (`tickets.gerer`, ou `tickets.configurer` pour une catégorie de ses rôles ; il faut aussi voir le
  ticket) : vue du ticket fermé › **Supprimer** › confirmation qui dit clairement ce qui sera effacé, avec l'interrupteur
  **Garder l'avis de l'auteur, anonyme, dans les statistiques** (activé par défaut ; coupé : l'avis est supprimé aussi).
  **Suppression groupée** : filtre statut **Fermé** › **Choisir des tickets à supprimer** › cocher › **Supprimer les
  tickets choisis** (50 au plus ; un ticket rouvert entre-temps est laissé et signalé).
- **Sur Discord** : `/ticket supprimer [avis: garder|supprimer]` dans le salon du ticket fermé (archivé) : réponse
  éphémère qui demande de confirmer (bouton rouge **Supprimer définitivement**) ; le salon disparaît quelques secondes
  après la réponse. Réservé à un **compte Esport lié** (`/lier`) qui a `tickets.gerer` (ou `tickets.configurer` pour une
  catégorie de ses rôles) : un simple rôle Discord du staff ne suffit pas (c'est irréversible). La commande peut être
  coupée ou réservée à des rôles (Configuration › Commandes), comme les autres.
- **Avis gardé** : la note, le commentaire, sa date, la catégorie et qui avait pris le ticket en charge restent dans
  `tickets_avis_anonymes`, **sans aucun lien** avec le ticket ni son auteur (ni numéro, ni Discord ID, ni nom). Son
  commentaire suit la **rétention** (effacé après N jours, comme les conversations).
- **Journal** : événement `ticket.supprime` (qui a supprimé, numéro, catégorie, avis gardé ou non : jamais le contenu)
  et une ligne dans le salon des journaux Discord.
- Le **numéro** d'un ticket supprimé ne sert jamais une seconde fois (`dernier_numero` dans `tickets_reglages`).

### Tickets qui ne se ferment jamais

Demande du Fondateur : « paramétrer un ticket, par exemple un ticket de sponsor qui ne se ferme jamais » (migration
`0055_tickets_permanents.sql`). Trois niveaux, du plus fort au plus faible :

| Niveau | Où | Effet |
| --- | --- | --- |
| **Ticket permanent** | vue d'un ticket dans l'app, interrupteur **Ne jamais fermer automatiquement** (`tickets.gerer`) ; ou `/ticket permanent etat:on\|off` (staff du ticket) | ce ticket n'est **jamais** fermé automatiquement ni averti, quel que soit le réglage de sa catégorie ; badge **Permanent** ; un message bilingue le dit dans le salon ; un **avertissement d'inactivité déjà donné est annulé**. Désactivé : le ticket suit de nouveau sa catégorie |
| **Catégorie** | Configuration › Catégories › **Fermeture automatique** | « Délai global » (défaut : le réglage général), délai propre en jours, ou « **Jamais** » (ni avertissement ni fermeture ; un avertissement donné avant le passage à « Jamais » est oublié) |
| **Général** | Configuration › Général | délai en heures (défaut 168 = 7 jours ; 0 = jamais) |

Un délai propre de catégorie l'emporte aussi sur un réglage général à 0. Un ticket permanent ou d'une catégorie
« Jamais » se **ferme toujours à la main** (bouton, `/ticket fermer`, l'app) ; pour qu'il ne soit fermé **que par le
staff**, activez **Seul le staff peut fermer** sur sa catégorie. Exemple : catégorie **Sponsors** réglée sur
« Jamais » + « Seul le staff peut fermer ».

### RGPD

- Compte de l'app : **Mes données** (et l'export par le Fondateur) contient les tickets que la personne a ouverts (par
  son compte Discord lié ou son Discord ID) avec leur conversation **sans les notes internes**, et les messages qu'elle a
  écrits. La **suppression du compte** anonymise ses tickets (nom, réponses, ses messages et leurs pièces effacés) ; ce
  qu'elle a écrit pour le club (réponses du staff, notes) reste, sans auteur.
- Personne **sans compte** (seulement Discord) : `POST /tickets/rgpd/export` et `POST /tickets/rgpd/effacer`
  `{ discordId }`, réservés au Fondateur.

## Commandes Discord

Noms en français, descriptions en anglais traduites en français pour les clients Discord en `fr` ; réponses
**éphémères** (vues seulement par la personne qui tape la commande), dans sa langue. Chaque commande peut être
**coupée** ou **réservée à des rôles Discord** dans **Tickets › Configuration › Commandes** ; les commandes du staff
vérifient en plus que la personne est du staff du ticket (rôles Discord de la catégorie, administrateur du serveur, ou
compte Esport lié avec `tickets.repondre` sur la catégorie). Elles se tapent **dans le salon du ticket**.

| Commande | Pour qui | Effet |
| --- | --- | --- |
| `/ticket ouvrir [categorie]` | tout membre | ouvrir un ticket (menu des catégories sans option ; formulaire s'il y en a un) |
| `/ticket fermer [raison]` | l'auteur (sauf catégorie « Seul le staff peut fermer »), le staff | fermer le ticket du salon |
| `/ticket prendre` · `/ticket liberer` | staff | prendre en charge, ne plus prendre en charge |
| `/ticket ajouter membre` · `/ticket retirer membre` | staff | donner ou retirer l'accès au salon |
| `/ticket renommer nom` | staff | renommer le salon |
| `/ticket priorite niveau` | staff | faible, moyenne, urgente, critique |
| `/ticket transferer categorie` | staff | changer de catégorie (droits du salon mis à jour) |
| `/ticket attente` | staff | « en attente de la réponse de l'auteur » |
| `/ticket note texte` | staff | **note interne** : gardée dans l'app, jamais postée sur Discord (réponse éphémère seulement) |
| `/ticket transcript` | staff | transcript HTML **en message privé** (sans les notes internes, qui ne passent jamais par Discord ; l'app les montre) |
| `/ticket rouvrir` | staff | rouvrir le ticket fermé du salon |
| `/ticket supprimer [avis]` | compte Esport lié avec `tickets.gerer` (ou `tickets.configurer`, catégorie de ses rôles) | ticket **fermé** du salon : supprimé définitivement après confirmation (bouton) ; `avis: garder` (défaut : note et commentaire gardés anonymes) ou `supprimer` ; le salon disparaît quelques secondes après |
| `/ticket permanent etat` | staff | `on` : ce ticket ne se ferme jamais automatiquement (avertissement en attente annulé) ; `off` : il suit de nouveau sa catégorie |
| `/ticket stats` | staff | 30 jours : ouverts, créés, fermés par catégorie, délai de 1re réponse et de résolution, satisfaction |
| `/ticket panneau [panneau]` | administrateur du serveur, ou compte lié qui configure les tickets | republier un panneau déjà réglé dans l'app |
| `/tickets [liste]` | tout membre ; `liste: file` pour le staff | mes tickets ouverts ; ou la file des tickets non pris en charge de mes catégories |

`/tickets` est une commande à part (Discord ne permet pas une commande à la fois seule et avec des sous-commandes) :
`/tickets` seul donne vos tickets, `/tickets liste:file` la file du staff.

**Après la mise à jour** (et après l'ajout de `/ticket permanent` puis de `/ticket supprimer`) : relancez l'enregistrement des commandes (étape 6 de [bot-discord.md](bot-discord.md)) :

```bash
cd ~/application-enzo
set -a; . ~/.appdashboard/esport.env; set +a
/home/jayo8828/nodevenv/application-enzo/esport/22/bin/node esport/outils/discord-commandes.mjs --adresse https://esport.appdashboard.fr
```

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
- **Maintien en éveil** : Passenger arrête un processus qui ne reçoit plus de requête (quelques minutes). Le meneur
  appelle donc sa propre adresse publique (`URL_PUBLIQUE/sante`) toutes les **4 minutes** : la Gateway reste tenue.
  Sans `URL_PUBLIQUE`, l'app s'endort, la pastille passe à « secours » (relecture du cron) et le diagnostic le signale.

### Diagnostic de la connexion (Configuration › Connexion)

`GET /tickets/etat` rend `diagnostic` ; l'onglet affiche chaque condition (« OK » ou « À faire » et quoi faire) :

| Ligne | D'où vient l'information |
| --- | --- |
| Jeton du bot | `DISCORD_BOT_TOKEN` lu par l'app |
| Serveur, catégorie des tickets ouverts, tickets activés | réglages **Général** enregistrés |
| Connexion en direct permise | `TICKETS_GATEWAY` (affichée seulement si `non`) |
| App en marche sur le serveur | dernier passage d'un superviseur (`tickets_etat`, clé `superviseur` : toutes les 20 s, noté au plus une fois par minute ; récent = moins de 3 min), et son rôle (tient la connexion, un autre processus la tient, tickets pas prêts) |
| Maintien en éveil | `URL_PUBLIQUE` absente, ou dernier appel en échec |
| Connexion en direct (Gateway) | état (prête, connexion, nouvel essai, refusée…), **dernier essai** et **dernière erreur** (`GET /gateway/bot` refusé, fermeture avec son code, Node sans WebSocket…) |
| Tâche cron Esport | dernier passage (`tickets_etat`, clé `cron_vu`, noté à chaque passage même tickets désactivés) ; jamais vu ou vieux de plus de 10 min : la commande de la tâche cron est affichée, à copier dans cPanel |

## Qui voit quoi (permissions)

Quatre permissions du **club** (catalogue, page **Rôles et permissions**, catégorie **Tickets**) ; le Fondateur les a
toutes, le **Second CEO** les reçoit par défaut :

| Permission | Effet (vérifié par le serveur) |
| --- | --- |
| `tickets.voir` | la page Tickets ; les tickets des catégories **qu'on traite** : une catégorie dont un des « rôles de l'app » est porté par le compte (rôle du club, ou rôle CM attribué au club) ; une catégorie sans rôle de l'app réglé est visible de tous ceux qui ont `tickets.voir` |
| `tickets.repondre` | répondre depuis l'app, notes internes, prendre en charge, mettre en attente, fermer et rouvrir les tickets qu'on voit |
| `tickets.gerer` | **toutes** les catégories, assigner, changer de catégorie, ajouter ou retirer quelqu'un, ticket permanent, transcripts, statistiques, **avis**, **supprimer un ticket fermé** |
| `tickets.configurer` | la Configuration (n'ouvre aucun ticket à elle seule) ; les **avis** et la **suppression** des tickets fermés des catégories dont il porte un des rôles de l'app |

Sans `tickets.voir` ni `tickets.configurer`, toutes les routes `/tickets…` répondent **404**. Les droits sont relus à
chaque requête (aucun cache) : un rôle retiré ferme aussitôt ce qu'il ouvrait.

**Notifications** : les événements des tickets ne vont **jamais** dans le fil commun du centre de notifications
(l'accès dépend de la catégorie du ticket) ; seules des notifications **personnelles** (`tk-*`) partent, à ceux qui
voient la catégorie, et la catégorie est **relue à chaque lecture** : qui ne voit plus la catégorie ne voit plus ses
notifications. Elles n'entrent pas dans le récapitulatif e-mail.

## Confidentialité, données

- Les conversations, notes internes, réponses aux formulaires et transcripts sont des **données sensibles** : jamais
  envoyées à une IA externe (aucune fonction des tickets n'appelle l'IA ; la tâche « tickets » est en plus déclarée
  **confidentielle** dans le connecteur IA, `esport/noyau/ia/confidentialite.mjs` : IA locale seulement si un jour une
  fonction s'en servait), jamais copiées dans le fil des
  notifications, le journal ou le temps réel (ils ne portent que des identifiants, le numéro et la catégorie).
- **Pièces jointes** : copiées dans le **stockage privé** du serveur (`tickets/<ticket>/<pièce>`, hors `public_html`),
  seulement depuis le CDN de Discord, sans suivre de redirection, sous la taille réglée (8 Mo par défaut) ; sinon
  seulement **référencées** (adresse Discord, qui expire). Choix fait plutôt qu'un dossier du Drive : le Drive est
  partagé par l'équipe CM, les pièces d'un ticket ne doivent être vues que par ceux qui voient le ticket. Lecture par
  lien signé de quelques minutes, délivré après contrôle d'accès.
- **Rétention** réglable (défaut 365 jours) ; RGPD : export et effacement (voir « RGPD » plus haut).
- Export / import de la base : les tables des tickets suivent (sauf le bail et l'état de la connexion, passagers) ;
  `esport/serveur/importer.mjs` copie aussi les pièces stockées.

## API (préfixe facultatif `/api/esport`)

| Route | Effet |
| --- | --- |
| `GET /tickets/moi` | droits du compte (`voir`, `repondre`, `gerer`, `configurer`), tickets activés |
| `GET /tickets/etat` | état de la connexion Discord (`direct`, `secours`, `hors_ligne`), intent ou jeton refusé ; `diagnostic` (conditions une par une) |
| `GET /tickets/config` | toute la configuration (`tickets.configurer`) |
| `GET /tickets/config/discord[?serveur=<id>]` | serveurs du bot, salons, rôles, permissions du bot et ce qui manque ; `serveur` : serveur choisi dans l'app, pas encore enregistré (lu tout de suite) ; erreur : `erreur` (`discord-403`, `bot-absent`…) et `erreurDetail { etape, statut, code }` |
| `PUT /tickets/config/(general\|messages\|horaires\|commandes)` | réglages |
| `POST /tickets/config/categories` ; `PATCH\|DELETE …/categories/:id` ; `PUT …/categories/ordre` | catégories |
| `POST /tickets/config/panneaux` ; `PATCH\|DELETE …/panneaux/:id` ; `GET …/:id/apercu` ; `POST …/:id/publier` | panneaux |
| `POST /tickets/config/liste-noire` ; `DELETE …/liste-noire/:discordId` | liste noire |

| `POST /tickets/rgpd/(export\|effacer)` `{ discordId }` | RGPD d'une personne sans compte (Fondateur) |
| `GET /tickets?statut&categorie&priorite&responsable&auteur&du&au&q` | liste (catégories visibles), non lus |
| `GET /tickets/compteur` ; `GET /tickets/stats?du&au` ; `GET\|PUT /tickets/preferences` | compteur, statistiques (`gerer`), MP |
| `GET /tickets/avis?categorie&note&du&au&responsable&tri` | avis (`gerer`, ou `configurer` : ses catégories) : `{ total, moyenne, repartition[5], avis[], categories, responsables, voirTickets }` ; `tri` : `recent` (défaut), `ancien`, `note_haut`, `note_bas` |
| `POST /tickets/:id/supprimer` `{ garderAvis? }` ; `POST /tickets/supprimer` `{ ids, garderAvis? }` | supprimer un ticket **fermé** (409 sinon) ; groupé : `{ supprimes: [numéros], echecs: [{ id, code }] }` ; `GET /tickets/:id` donne `droits.supprimer`, `noteLe` |
| `GET /tickets/:id` ; `POST /tickets/:id/lu` | ticket et conversation ; marquer lu |
| `POST /tickets/:id/messages` `{ texte, pieces?, drive? }` ; `POST /tickets/:id/notes` `{ texte }` | réponse (le bot poste) ; note interne |
| `POST /tickets/:id/(prendre\|liberer\|attente\|statut\|priorite\|fermer\|rouvrir)` | actions (`repondre`) |
| `POST /tickets/:id/(assigner\|categorie\|ajouter\|retirer)` ; `GET …/assignables` ; `GET …/transcript` | actions (`gerer`) |
| `POST /tickets/:id/permanent` `{ permanent: true\|false }` | ticket permanent (`gerer`) ; `GET /tickets/:id` donne `permanent` et `fermeture { heures, source: ticket\|categorie\|general, staffSeul }` |
| `POST /tickets/:id/liaison` `{ type, id? }` ; `POST /tickets/:id/pieces/:piece/lien` | liaison ; lien signé d'une pièce |

Discord appelle toujours `POST /discord/interactions` (signature Ed25519) : les boutons, menus et fenêtres des tickets
(`custom_id` commençant par `tk:`) et les commandes `/ticket`, `/tickets` y sont traités **sans compte lié**.
Identifiants : `tk:o:<catégorie>` (bouton d'un panneau), `tk:s` (menu), `tk:f:<catégorie>` (fenêtre du formulaire),
`tk:c|a|p|x|r:<ticket>` (prendre, ajouter, priorité, fermer, rouvrir), `tk:as|ps:<ticket>` (choix d'un membre, d'une
priorité), `tk:xc|xr|xm:<ticket>` (confirmer, raison, fenêtre de la raison), `tk:n:<ticket>:<1-5>` et
`tk:nc:<ticket>:<note>` (note et commentaire, dans le MP), `tk:dc:<ticket>:<g|s>` (suppression confirmée : avis gardé
anonyme ou supprimé).

## Pour les développeurs

- Code : `esport/noyau/tickets/` — `acces.mjs` (droits), `reglages.mjs` (réglages, validations), `textes.mjs`
  (messages FR / EN, composition bilingue), `panneaux.mjs` (charges Discord), `discord.mjs` (REST, permissions),
  `gateway.mjs` (client Gateway), `superviseur.mjs` (bail, secours, état), `conversation.mjs` (messages reçus,
  pièces jointes, temps réel), `service.mjs` (configuration), `cycle.mjs` (cycle de vie : ouverture, staff,
  fermeture, note, réouverture, cron), `rgpd.mjs`, `routes.mjs`, `bot.mjs` (interactions), `bus.mjs` (événements,
  notifications), `cron.mjs`. Commandes `/ticket` et `/tickets` : `esport/noyau/discord/bot/commandes.mjs` (`SOUS_COMMANDES_TICKET`).
- Migrations `0054_tickets.sql`, `0055_tickets_permanents.sql` (ticket permanent, fermeture par le staff seul ;
  ordre de priorité de la fermeture automatique : `delaiFermeture` dans `reglages.mjs`) et `0056_tickets_avis.sql`
  (avis gardés anonymes des tickets supprimés ; suppression : `supprimer` dans `cycle.mjs`) ; permissions au catalogue (`catalogue.json`) ; Second CEO par défaut (test
  `roles-permissions.test.mjs`).
- Écrans : `src/esport/ui/tickets/` (`PageTickets.tsx`, `TicketsStaff.tsx` : liste, vue, statistiques, suppression ;
  `AvisTickets.tsx` : avis, étoiles ;
  `ConfigTickets.tsx`, `ApercuDiscord.tsx`), API `src/esport/tickets/api.ts`, compteur `src/esport/tickets/compteur.ts`,
  textes `src/esport/i18n/tickets.ts`, réglage de la fermeture en jours `src/esport/tickets/fermeture.ts`, phrases des notifications `src/esport/tickets/libelles.ts`.
- Tests : `esport/test/tickets-gateway.test.mjs` (faux serveur Gateway WebSocket : HELLO, battements, RESUME,
  zombie, INVALID_SESSION, 4014, budget ; bail entre deux processus simulés ; relecture de secours ; cron),
  `esport/test/tickets-diagnostic.test.mjs` (Général : serveur choisi lu avant l'enregistrement, tout enregistré en une fois,
  403 / 50001 ; superviseur inactif → secours → en direct ; dernière erreur de la Gateway ; cron vu ; maintien en éveil),
  `esport/test/tickets-config.test.mjs` (configuration par l'API, faux Discord REST), `esport/test/tickets-commandes.test.mjs`
  (définitions, chaque commande, droits, commandes coupées ou réservées), `esport/test/tickets-app.test.mjs`
  (visibilité par catégorie, non lus, réponse depuis l'app, notes internes jamais envoyées, droits, transcript, pièces,
  liaisons, statistiques), `esport/test/tickets-cycle.test.mjs`
  (cycle de vie complet avec interactions signées : formulaire, salon et droits, staff, fermeture, MP, note,
  réouverture, fermeture automatique, archives, rétention, RGPD), `esport/test/tickets-permanents.test.mjs` (ordre de
  priorité, catégorie « Jamais », ticket permanent par l'app et `/ticket permanent`, staff seul),
  `esport/test/tickets-avis.test.mjs` (avis : droits par catégorie, moyenne, répartition, filtres, tri ; suppression :
  ticket fermé seulement, droits, salon Discord et 404, pièces, avis gardé anonyme ou supprimé, groupée,
  `/ticket supprimer`), `src/esport/Tickets.test.tsx`
  (écrans). Aides : `esport/test/tickets-aide.mjs`. Aucun test n'appelle le vrai Discord.
