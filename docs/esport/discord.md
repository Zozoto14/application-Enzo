# Esport : notifications Discord

> **Nouveau : le bot Discord** ([bot-discord.md](bot-discord.md)) mentionne les joueurs convoqués, ajoute des
> boutons Oui / Peut-être / Non et répond à des commandes. Quand un serveur est lié par le bot, tous les messages
> passent par lui ; le webhook ci-dessous reste le **repli** sans bot. Les messages sont désormais de vrais
> **embeds** (couleur et emoji du type d'événement, horodatages, lien vers l'app). Les relances « RSVP manquant »
> sont groupées en un seul message par événement.

Chaque team peut envoyer des messages dans **un salon Discord** : nouvel événement au planning, rappels,
résumé publié, tâche assignée… Le serveur Esport poste sur un **webhook** (une adresse secrète fournie par
Discord). Rien à installer côté Discord, pas de bot.

Il faut le module **Discord** (activé pour la team) et le droit **`discord.manage`** (Propriétaire et Manager
l'ont par défaut ; on peut le donner à un rôle personnalisé). Le Fondateur l'a partout. Les autres membres ne
voient même pas l'écran.

## Créer un webhook dans Discord

Il faut être administrateur du serveur Discord, ou avoir le droit « Gérer les webhooks ».

1. Dans Discord, passez la souris sur le **salon** où les messages doivent arriver, cliquez sur la roue dentée
   (**Modifier le salon**).
2. Menu **Intégrations** › **Webhooks** › **Nouveau webhook**.
3. Donnez-lui un nom (par exemple « Esport ») et, si vous voulez, une image.
4. Cliquez sur **Copier l'URL du webhook**. L'adresse ressemble à
   `https://discord.com/api/webhooks/123…/abc…`.
5. Cliquez sur **Enregistrer les modifications**.

Gardez cette adresse pour vous : **qui la connaît peut écrire dans votre salon**. Si elle a fuité, supprimez le
webhook dans Discord et créez-en un autre.

## Brancher le webhook dans l'app

1. **Esport** › votre team › onglet **Discord**.
2. Collez l'adresse dans **Adresse du webhook** (le champ cache ce que vous tapez) › **Enregistrer**.
3. L'écran affiche maintenant `discord.com/api/webhooks/…/abcd` : seulement les 4 derniers caractères.
   L'adresse complète n'est **plus jamais affichée**, ni par l'app ni par le serveur.
4. Cliquez sur **Envoyer un message de test** : un message doit apparaître dans le salon. S'il n'arrive pas,
   l'écran dit pourquoi (adresse refusée, Discord injoignable…).

Une seule adresse par team. **Remplacer** change de salon ; **Supprimer** arrête tout.

L'adresse doit commencer par `https://discord.com/api/webhooks/` (ou `discordapp.com`). Toute autre adresse est
refusée.

## Choisir ce qui part sur Discord

Pour chaque type de message : un interrupteur, un **modèle de message** que vous pouvez écrire, et un **rôle à
mentionner** (facultatif).

| Notification | Quand | Activée par défaut |
| --- | --- | --- |
| Nouvel événement au planning | un scrim, match, entraînement… est ajouté | oui |
| Rappel J-1 | environ 24 h avant le début, pour les convoqués (nommés par `{convoques}`) | oui |
| Rappel H-1 | environ 1 h avant le début, pour les convoqués | oui |
| C'est maintenant | au début de l'événement, pour les convoqués | oui |
| Relance des convoqués | un membre du staff tape `/relancer` (bot) : un seul message | oui |
| RSVP manquant | des convoqués n'ont pas répondu à un événement qui approche (un seul message, groupé) | non |
| Résumé publié | le PDF d'un résumé de réunion est publié | oui |
| Nouveau dépôt de réunion (staff) | un joueur dépose une réunion à résumer | non |
| Tâche assignée | une tâche est assignée à quelqu'un | oui |
| Échéance de tâche | une tâche arrive à échéance ou est en retard | non |
| Membre rejoint | quelqu'un entre dans la team | non |
| Demande de compte | un membre (permission « Créer des membres ») propose un nouveau compte, à valider par le Fondateur ; jamais l'adresse e-mail | oui |
| Changement de rôle | le rôle d'un membre change | non |
| Review créée | une review vidéo est créée (phase 5) | non |

Une notification dont le **module est absent** (par exemple « Review créée » sans le module Review vidéo) est
grisée et ne peut pas être activée.

À savoir :

- **Un seul salon par team.** « Nouveau dépôt de réunion » cite le titre de la réunion : activez-le seulement si
  le salon est réservé au staff.
- Le **résumé d'une réunion de type « staff »** n'est jamais envoyé sur Discord.
- Les rappels J-1 et H-1 partent au plus tard 15 minutes après le seuil (le serveur vérifie toutes les
  15 minutes), une seule fois par date d'un événement. Un événement qui commence dans moins de 2 h n'a pas de J-1.
- Les rappels ne concernent que les **convoqués** (un Propriétaire non coché n'est ni nommé ni attendu ; pas de
  rappel pour un événement sans convoqué). Discord n'autorise ici qu'une mention de **rôle** : la mention réglée
  reste celle de la team, et le message nomme les convoqués (`{convoques}`), sans les notifier un par un.

### Écrire un modèle

Un modèle est du texte avec des **variables** entre accolades, remplacées au moment de l'envoi :

```
Scrim ce soir : {titre} ({type}), {date} à {heure}. Réponds dans l'app !
```

Variables communes à tous les messages : `{team}` (nom de la team) et `{lien}` (adresse de l'app, si le serveur la
connaît, voir plus bas). Les autres dépendent du message et sont listées sous le champ : `{titre}`, `{type}`,
`{date}`, `{heure}`, `{delai}`, `{convoques}`, `{membre}`, `{acteur}`, `{assigne}`, `{echeance}`, `{role}`, `{de}`,
`{vers}`, `{etat}`.

- Une variable inconnue est **refusée** à l'enregistrement (le message d'erreur donne la liste permise).
- Modèle vide : on revient au modèle par défaut (bouton **Modèle par défaut**).
- 500 caractères au plus ; le message final est limité à 2000 caractères (limite de Discord).
- Un aperçu avec des valeurs d'exemple s'affiche dans l'écran.

### Mentionner un rôle Discord

Dans **Rôle Discord à mentionner**, saisissez l'**identifiant numérique** du rôle, pas son nom :

1. Dans Discord : **Paramètres utilisateur** › **Avancés** › activez le **Mode développeur**.
2. **Paramètres du serveur** › **Rôles** › clic droit sur le rôle › **Copier l'identifiant du rôle**.

L'app **refuse** `@everyone`, `@here` et tout ce qui n'est pas un identifiant. Le rôle doit pouvoir être mentionné
par les webhooks (réglage du rôle dans Discord : « Autoriser tout le monde à @mentionner ce rôle », ou le droit
de mentionner `@everyone`/rôles donné au webhook).

## Comment ça marche (envoi, réessais)

1. Une action dans l'app (événement créé, tâche assignée…) publie un **événement** dans le bus interne. Le
   journal d'activité, les notifications de l'app et **Discord** y sont abonnés ; aucun module n'appelle Discord
   directement.
2. L'abonné Discord regarde les réglages de la team et met un message dans une **file d'envoi**. Aucun appel
   réseau à ce moment : la requête de l'utilisateur n'attend jamais Discord.
3. La file est traitée juste après la requête (envoi quasi immédiat) et **par le cron** (toutes les 15 minutes)
   pour les réessais.
4. En cas de problème :
   - **Discord en erreur ou injoignable** : nouvel essai dans 1 min, 5 min, 15 min, 1 h puis 3 h ; **abandon après
     6 essais**.
   - **Limite de débit (HTTP 429)** : le serveur attend le délai demandé par Discord (`retry_after`), pour tous les
     messages de la team, sans compter d'essai.
   - **Webhook supprimé ou refusé (404, 401, 403)**, ou message refusé (400) : abandon tout de suite ; l'écran
     indique de recréer le webhook.
   - Un message **périmé** (plus de 24 h, ou un rappel dont l'événement a commencé) est abandonné.
5. Chaque échec et chaque abandon est écrit dans le **Journal** de la team (« Envoi Discord … abandonné : … »),
   sans jamais l'adresse du webhook ni la réponse de Discord. L'écran Discord montre les 20 derniers envois.

## Sécurité

- **Chiffrée au repos.** L'adresse est chiffrée en **AES-GCM 256** avant d'être écrite dans la base
  (`discord_webhooks.url_chiffree`). On ne garde en clair que ses 4 derniers caractères, pour l'affichage masqué.
- **Choix de la clé.** La clé AES est **dérivée par HKDF-SHA-256 d'un secret du serveur**, avec un contexte dédié
  (`applibourse-esport/discord-webhook/aes-gcm/v1`). Par défaut ce secret est **`CLE_ESPORT`** : rien de plus à
  configurer. Le contexte rend la clé AES sans rapport avec celle des sessions, même secret. L'identifiant de la
  team est lié au chiffré (donnée authentifiée) : un chiffré recopié dans une autre team ne s'ouvre pas.
- **Secret séparé, facultatif.** Si vous voulez pouvoir changer `CLE_ESPORT` sans perdre les webhooks, posez un
  secret **`CLE_DISCORD`** (ligne `CLE_DISCORD=…` de `~/.appdashboard/esport.env` sur le serveur, 32 caractères au
  moins) **avant** d'enregistrer des webhooks : il a la priorité. Sinon, **changer `CLE_ESPORT` rend les webhooks
  illisibles** : les messages en file sont abandonnés avec la mention « adresse illisible » et il suffit de
  saisir de nouveau l'adresse dans l'écran Discord. On ne passe jamais en clair par défaut : sans clé, le serveur
  refuse d'enregistrer un webhook.
- **Jamais renvoyée.** Aucune réponse de l'API ne contient l'adresse, ni le journal, ni les événements internes,
  ni les messages d'erreur. L'export de la base (`/admin/export`) contient l'adresse **chiffrée**.
- **Rien dans le dépôt.** Aucune adresse réelle n'est versionnée ; les tests utilisent des faux.
- **Pas d'injection de mentions.** Dans tout le texte envoyé (modèle comme valeurs : titres, pseudos…),
  `@everyone`, `@here`, `<@…>`, `<@&…>`, `<#…>` sont rendus inoffensifs. La seule mention possible est celle du
  rôle configuré (identifiant numérique validé), seule listée dans `allowed_mentions`. Sans rôle, Discord ne
  prévient personne (`allowed_mentions: { parse: [] }`). Les valeurs sont courtes (200 caractères) et sur une seule
  ligne.
- **Adresse fixe.** Le serveur n'envoie qu'à `discord.com` / `discordapp.com`, sans suivre de redirection : pas de
  moyen de lui faire appeler une autre adresse.
- **Droits.** Tout l'écran demande `discord.manage` (le webhook est un secret) : session → appartenance à la team
  → module Discord activé → permission. Une team ne voit jamais le webhook ni les réglages d'une autre.
- Supprimer une team efface son webhook et sa file.

## Réglages du serveur (facultatifs)

| Nom | Rôle |
| --- | --- |
| `CLE_DISCORD` (secret) | clé de chiffrement des webhooks, à la place de `CLE_ESPORT` |
| `LIEN_APP` (variable) | adresse de l'app, remplace `{lien}` dans les messages (`https://appdashboard.fr`) ; sans elle `{lien}` est vide |

Serveur local de développement : `ESPORT_CLE_DISCORD`, `ESPORT_LIEN_APP`.

## En cas de souci

| Constat | Que faire |
| --- | --- |
| « Adresse de webhook invalide » | Recopiez l'adresse en entier depuis Discord (**Copier l'URL du webhook**). |
| « Discord ne reconnaît plus ce webhook » | Le webhook a été supprimé dans Discord : créez-en un autre, collez-le. |
| Le test marche mais rien n'arrive pour un événement | Vérifiez l'interrupteur de ce type, le module Discord de la team, et les derniers envois (écran Discord, Journal). |
| Envois « abandonnés : adresse illisible » | `CLE_ESPORT` (ou `CLE_DISCORD`) a changé : saisissez de nouveau l'adresse. |
| « Un test vient d'être envoyé » | Un test toutes les 10 secondes au plus. |
| La mention du rôle n'alerte personne | Dans Discord, autorisez la mention de ce rôle (voir plus haut). |

## Pour les développeurs

- Code : `esport/noyau/discord/` (`catalogue.mjs` : types de messages, variables, modèles par défaut ;
  `messages.mjs` : nettoyage, modèles, mentions ; `chiffrement.mjs` : adresse, AES-GCM ; `file.mjs` : abonné du bus
  et traitement de la file ; `rappels.mjs` : J-1 / H-1 du cron ; `service.mjs` et `routes.mjs` : API).
  Écran : `src/esport/ui/Discord.tsx`, client : `src/esport/discord/api.ts`.
- Base : migration `0004_discord.sql` (`discord_webhooks`, `discord_notification_settings`, `discord_file`,
  `discord_rappels`). SQL standard, comme le reste.
- Routes : `GET /teams/:t/discord`, `PUT|DELETE /teams/:t/discord/webhook`, `POST /teams/:t/discord/test`,
  `PUT /teams/:t/discord/parametres/:cle`.
- **Ajouter un type de message** : une entrée dans `catalogue.mjs` (événement de domaine, module requis, variables,
  modèle) et le calcul de ses variables dans `variablesDe()` de `file.mjs` ; le libellé côté app dans
  `LIBELLES_DISCORD` (`src/esport/discord/api.ts`).
- **Contrat avec la phase 5 (review vidéo)** : le type « Review créée » est branché sur l'événement de domaine
  `review.created` (charge : `{ titre }`, `acteur` = l'auteur). Le module Review vidéo doit l'ajouter à
  `TYPES_EVENEMENTS` et le publier dans l'outbox à la création d'une review ; tant que le module est absent pour
  une team, le type est grisé et rien n'est mis en file.
- Tests : `esport/test/discord.test.mjs` (chiffrement, adresse, modèles, mentions, envoi simulé),
  `esport/test/discord-api.test.mjs` (API, file, réessais, 429, abandon, journal, permissions, isolation, rappels,
  parcours de bout en bout vers un faux serveur Discord local), `src/esport/Discord.test.tsx` (écran),
  `scripts/e2e-esport-discord.mjs` (navigateur, faux Discord). Aucun test n'appelle le vrai Discord.
