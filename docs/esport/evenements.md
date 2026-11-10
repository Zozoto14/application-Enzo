# Événements organisés par le club

**Administration › Événements** : les événements et tournois organisés **par le club** (ex. **The Nuke End**, The
Finals 3v3v3v3). Chaque événement a ses équipes participantes, ses inscriptions importées des tickets et **un rôle
Discord par équipe, créé et supprimé automatiquement**, ainsi qu'un hub vocal qui crée le salon de chaque équipe.

Les tournois **extérieurs** auxquels une team participe restent dans la team (Compétition › Tournois,
[tournois-resultats.md](tournois-resultats.md)) : inscription, check-in, bracket, résultats. Une team ne s'occupe ni
des équipes adverses ni des rôles Discord.

Migration : `esport/migrations/0064_evenements_club.sql`. Code : `esport/noyau/evenements-club/` (serveur),
`src/esport/ui/evenements/` (écran). Tests : `esport/test/evenements-club.test.mjs`, `src/esport/Evenements.test.tsx`.

## Droits

Permission du club **`evenements.gerer`** (« Événements : gérer », catégorie Administration). Le Fondateur l'a
d'office ; la migration la donne au **Second CEO** et à un rôle du club nommé **« CEO »** s'il existe (Administration ›
Rôles et permissions pour la donner ou la retirer). Elle suffit pour tout, actions Discord comprises (création,
attribution, déplacement et suppression des rôles des équipes). Seule exception : **Importer depuis les tickets**
demande en plus de voir les tickets de la catégorie choisie (permissions des Tickets), et **modifier les vocaux de
l'événement** (créer, modifier, retirer un hub) demande en plus **`vocaux.configurer`** (« Salons vocaux :
configurer », les mêmes droits qu'aujourd'hui pour les réglages des salons vocaux) : sans elle, la section s'affiche en
lecture seule. Le Second CEO a les deux ; le rôle « CEO » n'a que la première (à compléter dans Rôles et permissions
s'il doit régler les vocaux).

## Un événement

- **Informations** : nom, jeu (profils de jeu), dates de début et de fin (AAAA-MM-JJ), statut (**À venir**, **En
  cours**, **Terminé**, **Annulé**), description.
- **Inscriptions** : la catégorie de tickets des inscriptions (ex. « Inscription The Nuke End », source de l'import),
  et les **catégories de tickets de l'événement** (plusieurs : inscriptions, support…) traitées par le rôle staff.
- **Rôles Discord** :
  - **Rôles automatiques** (activés par défaut) : un rôle par équipe, donné à ses membres présents sur le serveur ;
  - **nom des rôles** : modèle `{tag} {nom}` par défaut (il doit contenir `{tag}` ou `{nom}`) ; couleur facultative ;
  - **« Placer les nouveaux rôles juste en dessous du rôle… »** : « Lire les rôles du serveur » affiche les rôles dans
    l'ordre de la hiérarchie (le plus haut d'abord, comme dans Paramètres du serveur › Rôles) ; les rôles qui ne sont
    pas **sous le rôle du bot** (« Esport HQ » compris) sont grisés : Discord interdit au bot de placer un rôle
    au-dessus du sien. Le serveur revérifie à l'enregistrement (refus expliqué). Sans choix : tout en bas ;
  - **suppression automatique** N heures après la date de fin (24 par défaut, 0 : jamais par la date).
- **Équipes participantes** : nom, TAG (lettres et chiffres, 6 au plus, unique dans l'événement) et membres (joueur,
  coach, remplaçant ; Discord ID, nom, Embark ID) ; 64 équipes et 10 membres au plus.

## Rôles automatiques

Avec les rôles automatiques, sans autre bouton :

- **Ajouter une équipe** (à la main ou par **Importer depuis les tickets**) : le bot crée aussitôt son rôle (nom du
  modèle, **non mentionnable**, sans permission), le place juste en dessous du rôle choisi, et le donne aux membres
  présents sur le serveur.
- **Modifier une équipe** : nom ou TAG changés, le rôle est **renommé** ; un membre ajouté reçoit le rôle, un membre
  retiré le perd.
- **Retirer une équipe** : son rôle est **supprimé**, ainsi que son salon vocal (hub de l'événement).
- **Modèle ou couleur changés** dans les réglages : les rôles existants suivent ; **rôle repère changé** : ils sont
  replacés.

Après chaque action, l'écran affiche le **bilan** : rôles créés et renommés, attributions, membres **pas trouvés sur
le serveur**, membres **sans Discord ID**, refus de Discord, position. Si Discord refuse (code 50013), le rôle
« Esport HQ » est trop bas : dans Paramètres du serveur › Rôles, glissez-le au-dessus des rôles des équipes (et du rôle
repère).

**Resynchroniser les rôles** refait tout ce qui manque (rôles, noms, attributions, position ; un rôle supprimé à la
main sur Discord est recréé). C'est le bouton à utiliser quand les rôles automatiques sont désactivés, ou après
l'arrivée sur le serveur d'un membre qui en était absent. Sans bot ou sans serveur Discord (Tickets › Configuration ›
Général), les équipes s'enregistrent quand même et l'écran le signale.

Position : les rôles de l'événement sont placés, dans l'ordre des équipes, juste sous le rôle repère, par un seul
`PATCH /guilds/{serveur}/roles` qui ne contient que les rôles dont la position change (tous sous le repère, donc sous
le bot).

## Rôle staff de l'événement

Chaque événement a un **rôle staff** (nom réglable, `Staff {evenement}` par défaut ; `{evenement}` : le nom de
l'événement) créé par le bot dès qu'il y a une personne dans le staff ou une catégorie de tickets de l'événement, et
placé avec le même réglage « juste en dessous du rôle… » (au-dessus des rôles des équipes).

- **Staff de l'événement** (carte de la fiche) : « Chercher » trouve les membres de l'app qui ont lié leur Discord
  (pseudo ou nom Discord), puis les membres du serveur Discord ; **Ajouter** donne le rôle, **Retirer** le retire.
- **Tickets** : le rôle est ajouté aux **rôles du staff** des catégories de tickets de l'événement (Tickets ›
  Configuration › Catégories : les nouveaux tickets lui sont ouverts) et ouvert sur les salons des tickets déjà
  ouverts de ces catégories. Une catégorie retirée de la liste lui est retirée.
- **Vocal** : il voit et rejoint **tous les salons vocaux des équipes** de l'événement **sans rien régler** : il est
  dans les surcharges de chaque salon créé par un hub de l'événement (avec le rôle de l'équipe, les rôles du staff et
  les rôles autorisés du hub) et y reste quand le salon est reverrouillé (recalcul). À chaque synchronisation du rôle
  (créé ou recréé, staff ajouté ou retiré, événement renommé, catégories changées, « Resynchroniser les rôles »), il est
  **réappliqué** aux salons d'équipe déjà ouverts (un `PUT` de surcharge « voir, se connecter » par salon, sans effet
  s'il y est déjà). Inutile donc de l'ajouter aux « Rôles autorisés en plus » d'un hub : la fiche et le Bot Esport HQ
  l'affichent comme une puce **« inclus automatiquement »**.
- **Fin** : supprimé avec les rôles des équipes (bouton, cron) et retiré des rôles du staff des catégories de tickets.
- Données : `club_evenement_staff` (Discord ID, nom, compte lié) suit l'export ; RGPD : retiré du staff.

## Import depuis les tickets

Chaque ticket de la catégorie donne une proposition lue dans les réponses du formulaire : nom, TAG, une ligne par
membre « Discord ID — Embark ID » (mention `<@…>`, identifiant seul, `@pseudo` ou Embark ID `nom#1234`, dans n'importe
quel ordre). Un `@pseudo` sans identifiant est cherché parmi les membres du serveur (nom **exact**) ; sinon la ligne
est signalée « sans Discord ID », à corriger. Les membres absents du serveur et les équipes déjà présentes (même
ticket ou même TAG) sont signalés ; on coche celles à ajouter. Les réponses sont lues **dans l'app**, jamais envoyées à
une IA.

## Fin de l'événement

Bouton **Supprimer les rôles** (rôles et salons vocaux des équipes), ou automatiquement par le cron (5 min) dès que
l'événement passe à **Terminé** ou **Annulé**, ou **N heures après sa date de fin**. Ensuite, plus aucun rôle n'est
créé automatiquement pour cet événement (« Resynchroniser » reste possible tant qu'il n'est ni terminé ni annulé).

## Supprimer un événement

**Supprimer l'événement** (bas de la fiche) relit la fiche puis demande confirmation : « Les hubs vocaux, les salons
d'équipe et les rôles Discord de l'événement seront aussi supprimés », avec le nombre de hubs vocaux retirés et, si ce
sont les seuls hubs du serveur, « les salons vocaux temporaires seront désactivés ». Confirmé, dans l'ordre :

1. **ses hubs vocaux** sont retirés des réglages des salons vocaux (même stockage, journal `tickets.config_modifiee`) ;
   s'il ne reste aucun hub, les salons vocaux temporaires sont désactivés (comme quand on retire le dernier hub) ;
2. le **nettoyage de fin d'événement**, au mieux : salons vocaux des équipes supprimés sur Discord, rôles des équipes et
   rôle staff supprimés, rôle staff retiré des rôles du staff des catégories de tickets. Un refus de Discord (ou
   l'absence de bot ou de serveur) **n'empêche pas** la suppression : il est noté dans le journal du serveur
   (`[esport] événement … supprimé : nettoyage Discord incomplet`), l'écran dit de supprimer à la main ce qui reste,
   et le rôle staff est quand même retiré des catégories de tickets ;
3. l'événement, ses équipes, leurs membres et son staff.

La réponse de `DELETE /evenements/:id` : `{ ok, hubs, vocauxDesactives, nettoyage: { roles, salons, echecs, erreur } }`.
La fiche (`GET`) donne `suppression: { hubs, desactiveVocaux }` pour la confirmation.

## Vocaux de l'événement

Section **« Vocaux de l'événement »** de la fiche : les hubs vocaux de l'événement se **créent, se modifient et se
retirent ici, et seulement ici**. Un membre qui a le rôle d'une équipe rejoint le hub ; Esport HQ crée le salon de son
équipe (un par équipe), verrouillé sur son rôle ; les autres sont déconnectés et prévenus en MP.

- Par hub : **salon vocal** (sélecteur repliable, salons rangés par catégorie ; les salons déjà pris par un autre hub ne
  sont pas proposés), **catégorie des salons créés** (celle du hub par défaut), **modèle du nom** (`{tag} — {nom}` par
  défaut), **places par défaut** (0 : illimité), **rôles autorisés en plus** (casters, admins). Le verrouillage est
  implicite (toujours verrouillé).
- Lignes en lecture seule : « Le rôle staff de l'événement « … » a accès automatiquement à tous les vocaux d'équipe »
  (ou qu'il l'aura dès sa création), et chaque salon est verrouillé sur le rôle de son équipe ; sous les rôles
  autorisés, la puce du rôle staff « inclus automatiquement ».
- **Même stockage** que les salons vocaux temporaires (réglage `vocaux`, hubs dont `tournoiId` est l'événement) :
  aucune deuxième source. Les salons vocaux doivent être activés dans le Bot Esport HQ (la section le rappelle) ; retirer
  le dernier hub du serveur les désactive.
- Dans Administration › Bot Esport HQ › Fonctionnalités › Salons vocaux temporaires, ces hubs apparaissent en **ligne
  compacte en lecture seule** « Hub de l'événement X — configuré dans Événements », avec un bouton **Ouvrir
  l'événement** (qui ouvre cette fiche). Il n'y a plus d'option « Hub d'événement » là-bas.
- Droits : lire avec `evenements.gerer` ; modifier avec en plus `vocaux.configurer` (voir « Droits »).

Détails du fonctionnement des salons : [vocaux.md](vocaux.md#hub-vocal-dun-événement).

## Reprise de l'étape précédente (migration 0063)

Les équipes notées dans la fiche d'un tournoi d'une team (ex. The Nuke End créé dans The Final LZ0) deviennent un
événement du club au **même identifiant**, avec leurs équipes, membres et rôles déjà créés ; les hubs vocaux liés et les
salons d'équipe ouverts continuent de fonctionner. Les anciennes tables (`tournoi_discord`, `tournoi_equipes`,
`tournoi_equipe_membres`) sont supprimées ; un export de la base fait avant la mise à jour est repris de la même façon à
l'import. Le tournoi de la team reste dans la team (il peut être supprimé ou gardé : il ne porte plus de rôles).

## API

Routes (`evenements.gerer`, 403 sinon) :

| Route | Rôle |
|---|---|
| `GET /evenements`, `POST /evenements` | Liste ; créer |
| `GET /evenements/roles-serveur` | Rôles du serveur Discord (hiérarchie, `utilisable` : sous le bot) |
| `GET`, `PATCH`, `DELETE /evenements/:id` | Fiche (`suppression` : ce que la suppression emporte) ; modifier (réglages Discord compris) ; supprimer (hubs vocaux, salons d'équipe, rôles : au mieux) |
| `POST /evenements/:id/equipes` | Ajouter des équipes `{ equipes: [...] }` (rôles automatiques) |
| `PATCH`, `DELETE /evenements/:id/equipes/:e` | Modifier ; retirer (rôle et salon supprimés) |
| `GET /evenements/staff-candidats?q=` | Personnes proposées pour le staff (app avec Discord lié, puis serveur) |
| `POST /evenements/:id/staff`, `DELETE /evenements/:id/staff/:s` | Ajouter au staff (rôle donné) ; retirer (rôle retiré) |
| `GET`, `POST /evenements/:id/vocaux` | Hubs vocaux de l'événement (`staffRole`, `peutModifier`, `autresHubs`) ; ajouter un hub (+ `vocaux.configurer`) |
| `PATCH`, `DELETE /evenements/:id/vocaux/:hub` | Modifier ; retirer un hub de l'événement (+ `vocaux.configurer` ; 404 si le hub n'est pas lié à l'événement) |
| `POST /evenements/:id/import` | Propositions lues dans les tickets `{ categorieId }` |
| `POST /evenements/:id/roles` | Resynchroniser les rôles (bilan) |
| `POST /evenements/:id/roles/supprimer` | Supprimer les rôles et les salons des équipes |

## Données

`club_evenements`, `club_evenement_equipes`, `club_evenement_membres` et `club_evenement_staff` suivent l'export de la base
(Administration). RGPD : l'effacement d'un compte (par son Discord ID) retire la personne des équipes et du staff des événements.
