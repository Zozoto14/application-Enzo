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
- **Hubs** (10 au plus), chacun : salon vocal, catégorie des salons créés (celle du hub par défaut), modèle du nom
  (`{pseudo}`), places par défaut, salons verrouillés à la création ;
- **Rôles du staff** : entrent partout, utilisent les contrôles de tout salon ;
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
  `CHANNEL_CREATE / UPDATE / DELETE` ; événements traités **un par un** (deux arrivées rapides ne créent pas deux
  salons) ;
- l'état utile est **en base** (`vocaux_salons` : propriétaire, liste d'amis, verrouillage, limite, personnes présentes,
  droits du hub, panneau) : les interactions, traitées par n'importe quel processus, le lisent ;
- verrouiller / déverrouiller **recalcule** toutes les surcharges du salon (une seule requête) ; expulser = `PATCH`
  du membre avec `channel_id: null` ;
- **redémarrage** : après `GUILD_CREATE` (nouvelle session), les salons connus sont rapprochés de Discord (disparus
  oubliés, vides supprimés tout de suite, présents et propriétaires resynchronisés) et une personne restée dans un hub
  reçoit son salon ; après `RESUMED`, Discord rejoue ce qui a été manqué ; à chaque passage du superviseur (20 s), les
  salons vides arrivés au délai sont supprimés (minuteries perdues avec un processus remplacé).

## Permissions du bot

**Voir les salons, Gérer les salons** (créer, renommer, supprimer), **Gérer les rôles** (droits des salons :
verrouillage), **Se connecter**, **Déplacer des membres** (déplacer, expulser). Le lien d'invitation de l'app les
demande toutes (`permissions=378243632208`, Tickets › Configuration › Connexion ou Administration › Bot Esport HQ › Fonctionnalités) ;
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

## Données

`vocaux_salons` suit l'export de la base (Administration) ; RGPD (effacement par Discord ID) : le nom affiché du
propriétaire est effacé. Aucun contenu de conversation n'est lu ni gardé.
