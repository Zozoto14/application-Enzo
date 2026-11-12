# Esport : salons vocaux temporaires (Esport HQ)

Le bot Discord **Esport HQ** ([bot-discord.md](bot-discord.md)) crée des salons vocaux à la demande, sur le serveur
Discord du club (celui des tickets : **Tickets › Configuration › Général**). Réglages : **Administration › Salons
vocaux**. Migration : `esport/migrations/0060_vocaux_temporaires.sql`. Code : `esport/noyau/vocaux/`.

## Ce que voit un membre

1. Il rejoint un salon vocal **hub** (ex. « Créer un salon »).
2. Esport HQ crée aussitôt un salon vocal **juste en dessous** (même catégorie, position suivante, mêmes droits que
   le hub), nommé d'après un modèle (`Salon de {pseudo}` par défaut), l'y **déplace** et l'en fait **propriétaire**.
3. Dans le fil de discussion intégré du salon vocal, le bot publie un **panneau de contrôle** qui le mentionne :

| Bouton | Effet |
| --- | --- |
| **Renommer** | fenêtre du nouveau nom (Discord limite à **2 renommages toutes les 10 minutes** par salon : au-delà, le bot dit dans combien de minutes réessayer) |
| **Verrouiller** / **Déverrouiller** | verrouillé : « Se connecter » refusé à @everyone, accordé au propriétaire, à sa liste d'amis et aux rôles du staff ; déverrouillé : retour aux droits du hub |
| **Limite de places** | 0 (illimité) à 99 |
| **Expulser** | menu des personnes présentes : la personne est déconnectée ; salon verrouillé, elle ne peut pas revenir |
| **Liste d'amis** | ajouter (menu de membres, 10 à la fois, 25 au plus) ou retirer : ils entrent même quand c'est verrouillé |
| **Transférer** | donner la propriété à une personne présente |

Seuls le **propriétaire** et le **staff** (rôles du staff réglés, administrateurs du serveur) peuvent s'en servir ; les
autres reçoivent un refus visible d'eux seuls. Réponses dans la langue de la personne ; le panneau et les annonces
suivent le réglage **Langue des messages** des tickets (deux langues, ou une seule). Aucun emoji.

4. **Propriétaire parti** : la propriété passe à la personne arrivée la première parmi celles restées (annoncé dans
   le salon) ; réglable : « il garde la propriété ».
5. **Salon vide** : supprimé après le délai réglé (15 s par défaut, 5 à 300 s). Revenir avant le délai le garde.
6. Un membre a **un** salon temporaire à la fois (réglable jusqu'à 5) : repasser par le hub le ramène dans le sien.

## Réglages (Administration › Bot Esport HQ › Fonctionnalités)

Permission du club **`vocaux.configurer`** (le Fondateur l'a d'office ; le Second CEO la reçoit par la migration).

- **Activer** (au moins un hub) ;
- **Hubs** (10 au plus, hubs d'événement compris), chacun : salon vocal, catégorie des salons créés (celle du hub par
  défaut), modèle du nom (`{pseudo}`), places par défaut, salons verrouillés à la création. Les **hubs d'événement** ne
  se créent pas ici : ils sont listés en ligne compacte en lecture seule (voir « Hub vocal d'un événement ») ;
- **Rôles du staff** : entrent partout, utilisent les contrôles de tout salon ; **libellé** de chaque rôle (`{role}` du
  salon du staff d'un hub d'événement, vide : dérivé du nom du rôle) ;
- **options de chaque hub** : salons placés sous le hub, visibles mais pas joignables, hub caché (voir « Options de
  chaque hub ») ;
- **Suppression d'un salon vide après** (secondes), **salons par membre**, **départ du propriétaire**, **salon des
  journaux** (facultatif : création, suppression, refus de Discord) ;
- **Salons temporaires ouverts** : nom, propriétaire, présents, verrouillé ;
- état de la **connexion** et **permissions du bot** (serveur, puis chaque hub), avec le lien d'invitation.

## Connexion en direct obligatoire

Les arrivées dans un hub ne sont connues que par la **Gateway** (connexion permanente tenue par un seul processus de
l'app, [tickets.md](tickets.md)). Elle est tenue dès que les salons vocaux sont activés (même sans tickets), avec
l'intent **GUILD_VOICE_STATES** (`1 << 7`), qui **n'est pas privilégié** : rien à activer sur le portail Discord (les
intents Message Content et Server Members restent ceux des tickets et de la bienvenue). En **relecture de secours**
(Gateway refusée ou désactivée par `TICKETS_GATEWAY=non`) ou **hors ligne**, aucune arrivée n'est vue : l'écran
l'affiche (« les salons vocaux temporaires nécessitent la connexion en direct »). Les boutons et `/voc` passent par
les interactions HTTP : ils marchent quel que soit le processus.

Fonctionnement interne :

- états vocaux mis en cache depuis `GUILD_CREATE` puis `VOICE_STATE_UPDATE` ; salons depuis `GUILD_CREATE` et
  `CHANNEL_CREATE / UPDATE / DELETE` ; une **file d'état** (cache, présences en base) et une **voie par membre**
  pour la création et le déplacement : deux membres sont servis en parallèle, deux événements du même membre l'un
  après l'autre (jamais deux salons) ; voir « Rapidité » ;
- l'état utile est **en base** (`vocaux_salons` : propriétaire, liste d'amis, verrouillage, limite, personnes présentes,
  droits du hub, panneau) : les interactions, traitées par n'importe quel processus, le lisent ;
- verrouiller / déverrouiller **recalcule** toutes les surcharges du salon (une seule requête) ; expulser = `PATCH`
  du membre avec `channel_id: null` ;
- **redémarrage** : après `GUILD_CREATE` (nouvelle session), les salons connus sont rapprochés de Discord (disparus
  oubliés, vides supprimés tout de suite, présents et propriétaires resynchronisés) et une personne restée dans un hub
  reçoit son salon ; après `RESUMED`, Discord rejoue ce qui a été manqué ; à chaque passage du superviseur (20 s), les
  salons vides arrivés au délai sont supprimés (minuteries perdues avec un processus remplacé).

## Rapidité

Le chemin critique d'une arrivée dans un hub est : événement `VOICE_STATE_UPDATE` reçu → `POST` du salon → `PATCH`
du membre (déplacement). Rien d'autre ne s'intercale :

- le salon du hub, sa catégorie, leurs surcharges et positions sont lus dans le **cache de la Gateway** (aucun `GET`
  à Discord, sauf repli si le salon y manque) ; la position est dans le corps de la création (pas de `PATCH` ensuite) ;
- la ligne `vocaux_salons` est écrite **pendant** le déplacement ; l'arrivée du membre dans son salon attend cette
  écriture si besoin ;
- panneau de contrôle, état affiché dans l'app et message du salon des journaux partent **après** le déplacement, en
  parallèle, sans retarder l'événement suivant ; les suppressions de salons vides partent hors de la file ;
- aucune attente fixe : seules les limites annoncées par Discord (`X-RateLimit-*`) font patienter une route épuisée
  (3 s au plus, sinon échec propre) ;
- serveur Node (o2switch) : les appels du moteur passent par une **connexion persistante** vers discord.com
  (`adaptateurs/fetchDiscordNode.mjs`, HTTP/1.1 keep-alive ; le `fetch` de Node referme la sienne après 4 s), ouverte
  dès la connexion de la Gateway et gardée chaude par un appel léger (`GET /users/@me`) toutes les 50 s tant que les
  salons vocaux sont activés. `DISCORD_CONNEXION_PERSISTANTE=non` revient au `fetch` global.

Mesures : chaque création note son temps dans l'état affiché par l'app (« Dernière création : X ms (Discord création
Y ms, déplacement Z ms) », avec l'attente, la préparation et si la connexion était déjà ouverte). Journal détaillé
de chaque création avec `ESPORT_VOCAUX_MESURES=1` dans l'environnement du serveur.

Salon « prêt à l'avance » (pré-créé caché puis renommé) : **non retenu**. Un membre ne peut pas être déplacé dans un
salon qu'il ne voit pas encore, donc il faudrait toujours deux appels l'un après l'autre (`PATCH` du salon puis
déplacement), comme aujourd'hui (`POST` puis déplacement) : gain incertain, pour des salons cachés que les
administrateurs verraient. À revoir seulement si les mesures montrent une création Discord durablement lente.

## Permissions du bot

**Voir les salons, Gérer les salons** (créer, renommer, supprimer), **Gérer les rôles** (droits des salons :
verrouillage), **Se connecter**, **Parler**, **Vidéo** (partage d'écran) et **Détection de la voix** (Discord ne
laisse accorder dans un salon que ce que le bot a lui-même : indispensables au rôle Goat, voir « Accès à toutes les
vocs »), **Déplacer des membres** (déplacer, expulser). Le lien d'invitation de l'app les
demande toutes (`permissions=378279284304`, Tickets › Configuration › Connexion ou Administration › Bot Esport HQ › Fonctionnalités) ;
un bot invité avant doit être réinvité avec ce lien (ou recevoir ces permissions sur son rôle). Dans la catégorie des
hubs, le bot doit pouvoir voir et gérer les salons.

## Commandes /voc

Les mêmes actions que le panneau, en commande (réponses visibles de la personne seule) :

| Commande | Effet |
| --- | --- |
| `/voc renommer nom:` | renommer (même limite de Discord : 2 toutes les 10 minutes) |
| `/voc verrouiller` · `/voc deverrouiller` | verrouiller / déverrouiller |
| `/voc expulser membre:` | déconnecter une personne présente |
| `/voc ami-ajouter membre:` · `/voc ami-retirer membre:` | liste d'amis |
| `/voc limite places:` | 0 (illimité) à 99 |
| `/voc proprietaire membre:` | donner la propriété à une personne présente |

Elle vise le salon où elle est tapée (le fil de discussion intégré du salon vocal), sinon celui où la personne se
trouve, sinon le sien ; mêmes droits que le panneau (propriétaire ou staff). **Réglages › Commandes /voc** (carte des
salons vocaux) : chaque sous-commande peut être **coupée** ou **réservée à des rôles** Discord (les administrateurs du
serveur passent toujours), comme les commandes des tickets.

**Enregistrer `/voc` auprès de Discord** (une fois, après la mise à jour) : Administration › Bot Esport HQ ›
Connexion et état › **Réenregistrer les commandes**, ou dans le Terminal cPanel :

```bash
cd ~/application-enzo
set -a; . ~/.appdashboard/esport.env; set +a
node esport/outils/discord-commandes.mjs --adresse https://esport.appdashboard.fr
```

(avec le chemin de Node de votre compte, [bot-discord.md](bot-discord.md#6-enregistrer-les-commandes)).

## Rôles des équipes d'un événement

Les équipes d'un événement organisé par le club (ex. **The Nuke End**) et leurs rôles Discord (un par équipe, créés,
placés sous un rôle choisi et donnés automatiquement, supprimés à la fin) se gèrent dans **Administration ›
Événements** (`evenements.gerer`) : voir [evenements.md](evenements.md). Les teams ne s'en occupent plus (leur module
Tournois sert aux tournois extérieurs).

### Hub vocal d'un événement

Les hubs d'un événement se **créent, se modifient et se retirent uniquement** dans **Administration › Événements ›
(événement) › Vocaux de l'événement** ([evenements.md](evenements.md#vocaux-de-lévénement)) : salon vocal, catégorie
des salons créés, modèle du nom (`{tag} — {nom}` par défaut), places par défaut, rôles autorisés en plus (casters,
admins) ; toujours verrouillé. Lire : `evenements.gerer` ; modifier : en plus `vocaux.configurer`.

Dans les réglages ci-dessus (Bot Esport HQ), il n'y a **plus d'option « Hub d'événement »** : un hub ajouté là est
toujours ordinaire. Les hubs d'événement existants y sont affichés en **ligne compacte en lecture seule** : « Hub de
l'événement X — configuré dans Événements », salon, rôles autorisés en plus suivis de la puce **« Rôle staff « … » ·
inclus automatiquement »**, et un bouton **Ouvrir l'événement** (pour qui a `evenements.gerer`). Côté serveur,
`PUT /vocaux/config` ne gère que les hubs ordinaires : les hubs d'événement enregistrés sont gardés tels quels (même
absents du corps ou renvoyés par une copie ancienne de l'écran), et un hub d'événement inconnu y est refusé
(`vocaux-hub-evenement`). Aucune migration : même stockage (clé `tournoiId` du hub et colonne
`vocaux_salons.tournoi_id` : l'identifiant de l'événement). Code : `esport/noyau/vocaux/tournoi.mjs` (salons),
`esport/noyau/vocaux/service.mjs` (`hubsEvenement`, `ajouterHubEvenement`…, routes `/evenements/:id/vocaux`).

- Qui peut s'en servir, dans cet ordre :
  1. le **rôle d'une équipe** de l'événement → le salon de son équipe (ci-dessous ; l'équipe passe avant le staff) ;
  2. sinon le **staff** : rôle staff de l'événement, **rôles staff supplémentaires** de l'événement, **rôles autorisés
     en plus** du hub, ou **rôles du staff** des salons vocaux → **son propre salon** (modèle « Nom du salon du staff »,
     `{role} — {pseudo}` par défaut : `{role}` est le libellé court du premier de ces rôles qu'il a, dans l'ordre rôles
     staff supplémentaires, rôle staff « Staff », rôles autorisés en plus, rôles du staff ; libellés réglables,
     [evenements.md](evenements.md#vocaux-de-lévénement)), dans la même catégorie, rangé sous le hub, dont il est **propriétaire** avec les
     contrôles habituels (renommer, verrouiller / déverrouiller, expulser, liste d'amis, transférer). Créé
     **verrouillé** sur le staff (rôle staff, rôles staff supplémentaires, rôles autorisés, rôles du staff ; les rôles
     des équipes n'y entrent pas, sauf invités en amis) ; l'option « visibles mais pas joignables » s'y applique. **Un
     salon par personne** (repasser par le hub y ramène) ; supprimé une fois vide, et à la fin ou à la suppression de
     l'événement avec les salons d'équipe ;
  3. sinon **refus** : déconnecté du hub, et un **MP** (français / anglais) explique que le hub est réservé aux équipes
     de l'événement **et à son staff**.
- Le salon créé porte le nom de l'équipe (`{tag} — {nom}` par défaut) et reste **verrouillé sur son rôle** :
  « Se connecter » refusé à @everyone, accordé au rôle de l'équipe, au **rôle staff de l'événement** (d'office, sans le
  régler : [evenements.md](evenements.md#rôle-staff-de-lévénement) ; réappliqué aux salons déjà ouverts à chaque
  synchronisation du rôle), aux rôles du staff et aux **rôles autorisés** du hub (casters, admins). Les joueurs peuvent expulser, limiter les places, transférer ; ils ne peuvent **ni renommer ni
  déverrouiller** (boutons grisés, refus de `/voc`), et il n'y a pas de liste d'amis.
- **Un salon par équipe** à la fois : un coéquipier qui passe par le hub est déplacé dans le salon existant.
- Le salon est supprimé une fois vide (comme les autres), quand l'équipe est retirée de l'événement, et à la **fin de
  l'événement** avec les rôles.
- **Événement supprimé** : ses hubs sont retirés automatiquement des réglages (la suppression n'est plus bloquée par un
  hub lié), ses salons d'équipe et ses rôles supprimés au mieux ; s'il ne reste aucun hub, les salons vocaux
  temporaires sont désactivés (la confirmation l'annonce). Voir [evenements.md](evenements.md#supprimer-un-événement).

## Options de chaque hub

Pour **tous** les hubs (ordinaires dans le Bot Esport HQ, d'événement dans la fiche de l'événement), interrupteurs
(texte français / anglais) :

| Option | Défaut | Effet |
| --- | --- | --- |
| **Placer les salons créés juste sous le salon de création** (*Place created channels right below the creation channel*) | oui | Discord ignore souvent `position` à la création et met le salon en bas de la catégorie. Après le déplacement du membre (le chemin critique création → déplacement ne change pas), le bot envoie **un** `PATCH /guilds/{serveur}/channels` qui range les salons temporaires du hub **juste sous lui, du plus récent au plus ancien** (le nouveau tout de suite sous le hub), dans la catégorie du hub. Positions lues dans le **cache de la Gateway** (mis à jour ensuite) ; seuls les salons dont la position change sont envoyés (ceux au-dessus du hub ne bougent jamais, ceux en dessous gardent leur ordre). Limite de débit (429) : un seul nouvel essai après le délai annoncé (5 s au plus) ; un refus est noté dans l'état (« dernière erreur : position »). |
| **Les personnes sans accès voient les salons créés mais ne peuvent pas les rejoindre** (*People without access can see the created channels but cannot join them*) | non | Salons **verrouillés** (salons d'équipe et du staff compris) : coupée, ils sont **cachés** (« Voir le salon » et « Se connecter » refusés à @everyone et aux rôles des surcharges du hub) ; activée, ils sont **visibles** (« Voir » accordé, « Se connecter » refusé). Hub dans une catégorie privée (@everyone sans « Voir ») : jamais élargi à tout le serveur. Rôles autorisés, propriétaire, amis, staff, rôle de l'équipe et bot : voir et se connecter. Salons ouverts : rien ne change. Réappliquée au verrouillage / déverrouillage, et aux salons verrouillés déjà ouverts quand l'option change. |
| **Cacher le salon de création aux personnes sans permission** (*Hide the creation channel from people without permission*) | oui pour un hub d'événement, non pour un hub ordinaire | Le bot gère les surcharges du **salon du hub** : @everyone sans « Voir » ; admis (voir, se connecter) : hub d'événement → rôles des équipes, rôle staff de l'événement, rôles staff supplémentaires, rôles autorisés en plus ; hub ordinaire → **« Rôles qui peuvent utiliser ce hub »** (sélecteur repliable ; sans rôle, l'option est grisée et sans effet) ; dans les deux cas les rôles du staff des salons vocaux, et le bot (voir, se connecter, déplacer, gérer). Les surcharges **d'origine** du hub sont gardées (`tickets_reglages`, clé `vocaux_hubs_origine`) à l'activation et **rendues** quand l'option est coupée, le hub retiré ou changé de salon, ou l'événement supprimé ; les salons créés partent de ces surcharges d'origine. Resynchronisé à chaque enregistrement des réglages et quand les rôles d'un événement changent (équipe ajoutée ou retirée, rôle staff créé ou changé, rôles staff supplémentaires, fin de l'événement). |

Code : `esport/noyau/vocaux/hubs.mjs`. Au mieux : un refus de Discord est noté au journal du serveur, l'enregistrement
n'est pas bloqué. Les hubs d'événement déjà enregistrés sont **cachés par défaut** dès le prochain enregistrement ou
la prochaine synchronisation de leurs rôles (couper l'option dans la fiche pour l'éviter).

## Accès à toutes les vocs (rôle Goat)

Carte **Accès à toutes les vocs** (Administration › Bot Esport HQ › Salons vocaux). Un rôle « passe-partout » entre dans
**toutes** les vocs sans avoir la moindre permission de serveur : pas d'administrateur, ni gérer le serveur, les salons
ou les rôles, ni déplacer, ni couper le micro ou le son. Seules des **surcharges de salons** lui sont posées (une
autorisation de rôle sur un salon l'emporte sur les refus de @everyone, de la catégorie et du verrouillage) :
**Voir le salon, Se connecter, Parler, Partager l'écran (Vidéo), Détection de la voix**, et rien d'autre.

- **Rôles passe-partout** : liste de rôles du serveur (par ordre de hiérarchie). Bouton **Créer le rôle Goat** : crée un
  rôle (nom et couleur modifiables, « Goat » en or par défaut) avec `permissions: "0"`, non affiché à part, non
  mentionnable, placé juste sous le rôle du bot, et l'ajoute à la liste. Donner ensuite le rôle aux membres (Discord).
  Le rôle du bot doit rester **au-dessus** des rôles passe-partout (la carte prévient sinon).
- **Salons du bot** (temporaires ouverts ou verrouillés, salons d'équipe et du staff d'un hub d'événement, hubs, y compris
  cachés) : les surcharges sont calculées avec celles du salon (`surchargesSalon`, `surchargesHubMasque`) ; un salon
  verrouillé laisse donc entrer ces rôles. Si Discord refuse la création (le bot n'a pas encore Parler, Vidéo et
  Détection de la voix), le salon est créé sans eux et la carte « Lire le serveur Discord » signale ce qui manque.
- **Aussi sur tous les salons vocaux existants du serveur** (activé par défaut) : le bot pose la surcharge du rôle sur
  chaque salon vocal et de scène (PUT d'une seule surcharge, jamais celles des autres rôles) ; salons écrits jamais
  touchés. Option coupée : seuls les hubs gardent l'accès.
- **Quand** : à l'enregistrement, à la création d'un salon vocal par une personne (CHANNEL_CREATE), à la (re)connexion de
  la Gateway, et à chaque passage du superviseur (une surcharge retirée à la main est reposée). Bouton **Resynchroniser**.
- **Retrait** : retirer un rôle de la liste (ou couper l'option) rend **exactement l'état d'origine** noté salon par
  salon (`tickets_reglages`, clé `vocaux_passepartout` : la surcharge existait ou non, ses bits) ; une surcharge
  antérieure du même rôle est restaurée, celles des autres rôles ne sont jamais touchées. Salons temporaires ouverts :
  surcharges recalculées sans le rôle.
- **Travail borné** : 60 requêtes au plus par passage (le reste au passage suivant), arrêt au premier 429, un salon
  refusé par Discord (le bot n'y gère pas les permissions) est noté et réessayé au plus toutes les 10 minutes. La carte
  affiche les salons couverts, les ajouts, les échecs (salon, code Discord) et le reste à faire ; les refus sont aussi au
  journal du serveur.
- **Expulser** : l'expulsion par le propriétaire d'un salon temporaire déconnecte une fois ; elle ne retire pas l'accès
  du rôle (la surcharge de salon reste), la personne peut revenir.
- Routes (permission `vocaux.configurer`) : `POST /vocaux/goat` (`{ nom?, couleur? }`), `POST /vocaux/passe-partout/synchroniser`,
  réglages `rolesPassePartout` et `passePartoutTous` de `PUT /vocaux/config`.

## Données

`vocaux_salons` suit l'export de la base (Administration) ; RGPD (effacement par Discord ID) : le nom affiché du
propriétaire d'un salon est effacé (les équipes des événements : [evenements.md](evenements.md#données)). Aucun contenu de conversation n'est lu ni gardé.
