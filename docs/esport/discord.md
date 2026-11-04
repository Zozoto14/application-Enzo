# Esport : notifications Discord

> **Nouveau : le bot Discord** ([bot-discord.md](bot-discord.md)) mentionne les joueurs convoqués, ajoute des
> boutons Oui / Peut-être / Non et répond à des commandes. Quand un serveur est lié par le bot, tous les messages
> passent par lui ; le webhook ci-dessous reste le **repli** sans bot. Les messages sont désormais de vrais
> **embeds** (couleur et emoji du type d'événement, horodatages, lien vers l'app). Les relances « RSVP manquant »
> sont groupées en un seul message par événement.

> **Annonce des posts publiés (CM › Réseaux)** : quand un post de la section CM est marqué publié avec son adresse,
> un message (anglais + fil français, rôle facultatif, visuel) part dans les salons choisis pour le compte du réseau :
> le salon Discord d'une team (celui réglé ici : bot ou webhook) ou un salon du club (webhook chiffré propre à la page
> Réseaux). Réglages, idempotence et réessais : [reseaux-stats.md](reseaux-stats.md).

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
| Inscription à un tournoi | la team est inscrite à un tournoi publiable (module Tournois) | oui |
| Annonce d'un match de tournoi | un match de tournoi est daté ; remplace « Nouvel événement » pour son événement du planning | oui |
| Résultat d'un match | un résultat publiable est saisi (module Résultats ; jamais un résultat staff, un scrim seulement s'il est coché « publiable ») | oui |
| Classement final d'un tournoi | un tournoi publiable passe à « terminé » | oui |

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
`{vers}`, `{etat}` ; tournois et résultats : `{tournoi}`, `{tour}`, `{adversaire}`, `{score}`, `{issue}`,
`{resultat}`, `{place}`, `{classement}`, `{gains}`, `{dates}` (voir [tournois-resultats.md](tournois-resultats.md)).

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

## Anglais d'abord, puis un fil français

Réglage : **Réglages › Discord › Langue principale : anglais (défaut) + fil français** (activé par défaut pour
toutes les teams ; permission `discord.manage`).

1. Le message part **en anglais** dans le salon (texte du modèle, embed, boutons, dates), par le bot ou par le
   webhook. Les **pings** (convoqués liés, rôle choisi) sont sur ce message, et seulement sur lui (et une seule fois
   par événement : voir « Pings une seule fois, relances par MP »).
2. Juste après, le **bot** ouvre un **fil** (thread) sur ce message : « 🇫🇷 Version française · <titre> »
   (100 caractères au plus, archivé après 24 h d'inactivité). Pour un webhook, le message est envoyé avec
   `?wait=true` (Discord rend son identifiant et son salon) et le fil est créé par le bot
   (`POST /channels/{salon}/messages/{message}/threads`) : il faut donc que le bot soit configuré
   (`DISCORD_BOT_TOKEN`) et présent sur le serveur, même si la team n'utilise que le webhook.
3. La **version française** complète (même embed traduit, boutons RSVP compris, aucune mention) est postée
   dans ce fil : par le webhook (`?thread_id=`) ou par le bot. Quand les réponses RSVP changent, l'annonce
   anglaise et sa version française sont rééditées.
4. **Salon forum** (webhook créé dans un forum) : le message anglais ouvre un **post** (son titre = titre anglais
   de l'embed) et la version française est la première réponse de ce post ; le bot n'est pas nécessaire.

**Fil impossible** (bot non configuré, absent du serveur, ou permission manquante : 403 / codes Discord 50001,
50013) : le message anglais est **toujours** gardé, et **aucun second message français** n'est envoyé. À la place,
une courte alerte (anglais puis français) est postée dans le même salon ; elle **mentionne le Fondateur** (compte
Discord lié par `/lier`, sinon le Discord ID saisi sur le compte Fondateur ; sans l'un ni l'autre : le texte
« Fondateur » sans ping, et le Journal le signale) et nomme la permission manquante. **Au plus une alerte par salon
et par 24 h** (table `discord_alertes_fil`), mais chaque fil impossible est écrit dans le Journal et dans les
derniers envois. L'écran Réglages › Discord affiche la liste des permissions, le dernier fil créé et, en rouge, le
dernier échec et son motif. Le bouton **Envoyer un message de test** essaie aussi le fil et dit s'il a pu être créé
(sans alerte dans le salon).

**Permissions du bot à activer dans le salon** (rôle « Esport HQ » ou permissions du salon) : View Channel, Send
Messages, Embed Links, Read Message History, **Create Public Threads**, **Send Messages in Threads**. Le lien
d'invitation de l'app les demande toutes (`permissions=309237861376`) ; un bot invité avant doit les recevoir à la
main (voir [bot-discord.md](bot-discord.md), étape 5).

**Une seule tâche, sans doublon** : l'anglais, le fil et le français forment une seule ligne de la file d'envoi.
Chaque étape réussie est enregistrée avant la suivante (`message_id`, `fil_id`) : un réessai (429, erreur réseau,
5xx) reprend à l'étape suivante sans jamais reposter l'anglais ni recréer le fil (un fil déjà créé, code 160004, est
réutilisé). Par le bot, chaque message porte un `nonce` stable avec `enforce_nonce` : Discord ignore un envoi
rejoué. Une limite de débit (429) reporte l'étape sans compter d'essai ; si le français échoue encore après 6 essais,
l'envoi est terminé (l'anglais est parti) et le motif est gardé.

**Désactivé** : un seul message, dans la langue choisie sous l'interrupteur (français par défaut). Un modèle
personnalisé n'est jamais traduit : il sert pour l'anglais et pour le fil.

## Pings une seule fois, relances par MP

Demande du Fondateur : « chaque ping Discord des teams (Valorant / The Finals) apparaît une seule fois, les relances
se font par MP, et quand un joueur est le seul pingé, il est informé par message privé ». Règles appliquées
(migration `0031_discord_pings_mp.sql`) :

1. **Un ping une seule fois par événement.** Pour une occurrence du planning, un joueur n'est **mentionné qu'une
   fois** dans le salon : sur l'annonce (message anglais). Les messages suivants du même événement (rappel J-1,
   rappel H-1, « C'est maintenant », relance dans le salon, repli après un MP impossible) restent **publiés**, mais
   sans re-mentionner ceux qui l'ont déjà été (`allowed_mentions` vide). Le fil français ne mentionne **jamais**
   personne (ni ses rééditions). Un joueur convoqué ou lié après l'annonce est mentionné au **premier** message
   suivant, puis plus jamais. Le registre `discord_mentions` retient qui (identifiant Discord, ou `role:<id>`) a été
   mentionné pour quel événement (`occ:<événement>:<occurrence>`), écrit avec l'envoi réussi du message.
2. **Rôle ou joueurs, jamais les deux.** Si un rôle est réglé pour ce message (« Rôle Discord à mentionner »), le
   message mentionne **le rôle seul** (il couvre les convoqués) ; sinon chaque convoqué lié. Le rôle suit la même
   règle « une fois par événement ». Un même identifiant n'apparaît jamais deux fois dans un message (liste
   dédoublonnée, deux comptes avec le même Discord ID compris).
3. **Relances par MP.** Les relances (« RSVP manquant », `/relancer`) partent en **message privé** du bot à chaque
   convoqué sans réponse : texte dans **la langue du joueur** (celle choisie dans son profil, sinon sa langue par
   défaut réglée par le Fondateur, sinon l'anglais), embed de l'événement et boutons **Oui / Peut-être / Non** (ils
   fonctionnent en MP) + « Ouvrir dans l'app ». Quand tout le monde a reçu son MP, **rien** n'est posté dans le salon.
4. **Joueur seul → MP.** Seuil : un message d'événement qui ne concerne **qu'un seul convoqué** et **sans rôle** à
   mentionner (annonce, rappels, « C'est maintenant ») part en MP à ce joueur, et pas dans le salon. Dès **deux
   convoqués**, ou avec un rôle, c'est une **annonce d'équipe** : elle reste dans le salon (avec ses mentions, une
   fois). Si la team a coupé « Mentionner les convoqués » pour ce type d'événement, le message reste dans le salon,
   sans mention. Les autres notifications (tâches, résumés, tournois…) ne mentionnent personne individuellement :
   elles ne changent pas.
5. **Repli.** MP impossible (compte non lié, MP fermés : erreur Discord **50007**, utilisateur introuvable…) : le
   refus est écrit dans le Journal (`discord.dm_failed`) et, pour ces joueurs seulement, le message est posté dans
   le salon : ils y sont cités et **mentionnés au plus une fois par événement** (déjà mentionnés : cités sans ping).
   **Réglages › Discord › Relances par MP** liste les membres injoignables avec l'action à faire (lier son compte,
   ouvrir ses MP pour ce serveur) ; un joueur en sort dès qu'un MP passe.
6. **Deux teams.** Le registre, les MP et les relances sont **par team** : un joueur des deux teams (Valorant et The
   Finals) est mentionné une fois par événement **de chaque team**, dans le salon de chaque team, et reçoit au plus
   un MP par message de chaque team.
7. **Débit et réessais.** Les MP passent par la même file d'envoi : un MP réussi est retenu (`discord_mp_envois`)
   avant le suivant, et porte un `nonce` stable (`enforce_nonce`) : un réessai (429, erreur réseau, 5xx) ne renvoie
   **jamais** un MP déjà parti. Une limite de débit (429) reporte la tâche sans compter d'essai ; après 6 essais en
   panne, les joueurs non joints passent au repli. Un jeton du bot refusé (401) arrête tout, comme avant.

**Option par team** : **Réglages › Discord › Relances par MP** (activée par défaut, permission `discord.manage`,
textes FR/EN). Désactivée : relances et messages d'un joueur seul restent dans le salon, toujours sans mentionner
deux fois (une relance dans le salon cite donc les sans-réponse, sans ping s'ils ont déjà été mentionnés). Les MP
exigent le **bot** (serveur lié, `DISCORD_BOT_TOKEN`) : par le seul webhook, tout reste dans le salon (rôle
mentionné une fois par événement).

**Côté joueurs** : lier son compte (`/lier`) ou avoir son Discord ID renseigné, être sur le serveur où se trouve le
bot, et autoriser les messages privés des membres de ce serveur (Discord : **Paramètres du serveur › Confidentialité
› Messages privés**, ou réglage global **Confidentialité et sécurité**), sans bloquer le bot.

## Tester les MP du bot

**Réglages › Discord › Tester les MP** (permission `discord.manage`, FR/EN, utilisable sur téléphone) permet de
vérifier les MP sans attendre une vraie relance. Bouton **Ouvrir le test des MP**, puis :

1. **MP de test.** Cochez un ou plusieurs membres (par défaut : vous) et **Envoyer le MP de test**. Chacun reçoit un
   message privé du bot, **marqué « Test »**, dans **sa** langue (profil, sinon langue par défaut, sinon anglais), avec
   les boutons Oui / Peut-être / Non d'une relance factice : ils répondent seulement « Test reçu » et n'enregistrent
   rien (aucune présence). Le résultat s'affiche **par membre** : ✅ MP de test reçu, ou ❌ avec la cause et l'action :

   | Cause | Action affichée |
   |---|---|
   | Compte Discord non lié / Discord ID absent | le membre fait `/lier`, ou le Fondateur renseigne son Discord ID |
   | Bot non configuré (`DISCORD_BOT_TOKEN`) | ajouter le jeton aux secrets du serveur Esport, redéployer |
   | Bot absent du serveur Discord de la team | inviter le bot, puis `/esport-lier-serveur` |
   | MP fermés ou bot bloqué (erreur Discord **50007**) | ouvrir les MP pour ce serveur, ne pas bloquer le bot |
   | Utilisateur introuvable | vérifier le Discord ID / refaire `/lier` |
   | Jeton du bot refusé (401) | régénérer le jeton dans le portail Discord |
   | Limite de débit (429) | patienter quelques secondes |
   | Panne de Discord, autre refus | réessayer plus tard / vérifier que le membre est sur le serveur du bot |

2. **Simuler une relance** (sans rien envoyer). Choisissez un événement des 14 prochains jours : l'écran liste qui
   recevrait un **MP**, qui serait **cité dans le salon** (et s'il serait mentionné, selon le registre « déjà
   pingé »), et qui est **déjà pingé** pour cet événement. Cas sans relance : réunion du staff, module Présence
   désactivé, tout le monde a déjà répondu. **Envoyer la relance de test à ce membre** envoie, à **un seul**
   membre, la vraie relance (texte et embed de l'événement) précédée de « TEST », avec les boutons de test.

**Aucun effet sur l'état.** Un test n'écrit ni dans le registre « déjà pingé » (`discord_mentions`), ni dans les MP
retenus (`discord_mp_envois`), ni dans la liste des injoignables, ni dans les présences ou les convocations, et ne
crée aucune tâche de file. Seul le bus reçoit un événement **`discord.test_mp`** par membre testé (Journal : « Max a
testé les MP du bot pour Tom : MP fermés… », sans identifiant Discord).

**Limite anti-abus** : 10 MP de test par tranche de 10 minutes et par team (chaque membre testé compte pour un, la
simulation ne compte pas) ; au-delà, l'API répond 429 avec le délai restant. Routes : `GET|POST
/teams/:t/discord/testmp`, `POST …/testmp/simulation`, `POST …/testmp/relance` (`esport/noyau/discord/testmp.mjs`,
test `esport/test/discord-test-mp.test.mjs`, écran `src/esport/ui/TestMpDiscord.tsx`). Les boutons de test (`tmp:o|p|n`)
sont traités par le bot sans compte lié et ne sont pas comptés dans les statistiques d'usage.

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
  `PUT /teams/:t/discord/parametres/:cle`, `PUT /teams/:t/discord/langue`, `PUT /teams/:t/discord/bilingue`
  (`{ filFr }`).
- Annonces des posts publiés (page Réseaux du CM) : `esport/noyau/reseaux/annonces.mjs`, file `cm_rs_annonces`
  (migration 0026), mêmes briques (`appelerDiscord`, qui sait aussi joindre un fichier, `bilingue.mjs`, modèles et
  mentions de `messages.mjs`) ; un salon de team utilise le bot ou le webhook réglés ici.
- Fil français : `bilingue.mjs` et `traiterFile()` (`file.mjs`) ; migration `0020_discord_bilingue.sql` ; tests
  `esport/test/discord-bilingue.test.mjs` (formatage anglais, fil simulé, forum, alerte au Fondateur et anti-spam,
  idempotence des réessais, réglage, message de test).
- **Ajouter un type de message** : une entrée dans `catalogue.mjs` (événement de domaine, module requis, variables,
  modèle) et le calcul de ses variables dans `variablesDe()` de `file.mjs` ; le libellé côté app dans
  `LIBELLES_DISCORD` (`src/esport/discord/api.ts`).
- **Contrat avec la phase 5 (review vidéo)** : le type « Review créée » est branché sur l'événement de domaine
  `review.created` (charge : `{ titre }`, `acteur` = l'auteur). Le module Review vidéo doit l'ajouter à
  `TYPES_EVENEMENTS` et le publier dans l'outbox à la création d'une review ; tant que le module est absent pour
  une team, le type est grisé et rien n'est mis en file.
- Pings une seule fois et MP : `file.mjs` (`chargeDeLigne` : registre `discord_mentions`, rôle ou joueurs ;
  `phaseMp` : MP, bilan `mp_bilan`, repli), `bot/interactions.mjs` (boutons RSVP cliqués dans un MP) ; migration
  `0031_discord_pings_mp.sql` (`discord_mp_reglages`, `discord_mentions`, `discord_mp_envois`,
  `discord_injoignables`, colonne `discord_file.mp_bilan`, toutes dans l'export / import de la base) ; route
  `PUT /teams/:t/discord/mp` `{ relancesMp }`, état `mp` de `GET /teams/:t/discord`. Test :
  `esport/test/discord-pings-mp.test.mjs`.
- Tests : `esport/test/discord.test.mjs` (chiffrement, adresse, modèles, mentions, envoi simulé),
  `esport/test/discord-api.test.mjs` (API, file, réessais, 429, abandon, journal, permissions, isolation, rappels,
  parcours de bout en bout vers un faux serveur Discord local), `src/esport/Discord.test.tsx` (écran),
  `scripts/e2e-esport-discord.mjs` (navigateur, faux Discord). Aucun test n'appelle le vrai Discord.

## Tickets

Le bot tient aussi un **système de tickets** (salons privés, réponses depuis l'app, transcripts, notes de
satisfaction), réglé dans **Esport › Tickets › Configuration** : voir [tickets.md](tickets.md). Il demande l'intent
privilégié **Message Content** et les permissions **Gérer les salons**, **Gérer les rôles** et **Joindre des
fichiers** en plus de celles des annonces.
