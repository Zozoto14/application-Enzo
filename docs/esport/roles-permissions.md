# Rôles et permissions

Page **Esport › Membres › Rôles et permissions** (troisième onglet de la page Membres ; rien de nouveau dans la barre
du bas du téléphone). Elle réunit, sur un seul écran, **qui peut faire quoi** dans le club, la section CM et les teams.
Migration `0033_roles_globaux.sql`, code serveur `esport/noyau/roles/`, écran `src/esport/ui/membres/RolesPermissions.tsx`.

## Qui l'ouvre

- le **Fondateur** (compte « admin », super admin) : toujours, avec tous les droits ;
- un compte qui a la permission du club **`roles.gerer`** (« Rôles et permissions ») : **aucun rôle ne l'a par
  défaut**, et **seul le Fondateur l'accorde ou la retire** (même le Second CEO ne l'a pas, sauf si le Fondateur la
  coche). Pour tout autre compte, la page et ses routes n'existent pas (404).

## Les trois familles de rôles

| Section | Rôles | Où ils valent | Qui les donne |
| --- | --- | --- | --- |
| **Club** | « **Second CEO** » (rôle système) et rôles du club personnalisés | tout le club : permissions transverses, et permissions CM du club | la page (section Club › « Qui a ce rôle ») |
| **CM** | « Responsable CM », « Correspondant CM » (système) et rôles CM personnalisés | section CM, Drive, Sponsors, trombinoscope ([cm.md](cm.md)) | **Espace CM › Équipe CM** (club ou team) |
| **Teams** | Propriétaire, Manager, Coach, Analyste, Joueur, Remplaçant (système) et rôles de team personnalisés | une team | la team (**Paramètres › Membres et rôles**) |

Dans chaque section : choisir un rôle, cocher / décocher dans la **matrice**, puis **Enregistrer** (les changements
sont surlignés et comptés ; **Annuler** revient en arrière). Boutons : **Rétablir les valeurs par défaut** (rôle
système modifié), **Dupliquer** (nouveau rôle avec les mêmes permissions — seulement celles que vous pouvez
accorder), **Supprimer** (rôle personnalisé), **+ Nouveau rôle**. Recherche par mot ou par clé (`cm.valider`).

La **matrice** range les permissions par catégorie : Membres, Teams, Agenda, Jeu, Compétition, CM, Drive, Sponsors,
Discord, Jeux & IA, Administration. Chaque ligne donne la description (français ou anglais, selon la langue de
l'app), la clé technique, et un badge **Sensible** (suppression, données personnelles, gestion des rôles…) ou
**Fondateur** (permission qu'il est seul à accorder). Accorder une permission sensible demande une confirmation.
Une case grisée : vous ne pouvez pas l'accorder.

## Permissions du club

Elles s'ajoutent aux permissions CM du club (cm.*, cm.drive.*, sponsors.*, membres.trombi.*), qu'un rôle du club peut
aussi porter (un rôle du club vaut alors comme une affectation CM « club »).

| Permission | Effet (vérifié par le serveur) |
| --- | --- |
| `teams.acces_total` | entrer dans **toutes les teams** avec les droits du Propriétaire, **sauf** supprimer une team et nommer un Propriétaire (le rôle Propriétaire a `team.delete`) |
| `teams.creer` | créer des teams |
| `membres.inviter` | dans **n'importe quelle team** : ajouter un compte Esport existant, ou déposer une demande de compte au Fondateur — **jamais avec un rôle de gestion** (ni Propriétaire, ni rôle qui a team.manage, team.delete, modules.manage, members.assign_role, members.remove ou roles.manage : 403 `role-gestion`). Ne donne pas l'entrée dans la team. |
| `comptes.demandes.gerer` | voir toutes les demandes de compte (adresses e-mail comprises) et les **refuser** ; la **validation**, qui crée le compte du hub avec les clés du Fondateur, reste au Fondateur |
| `comptes.discord_id` | poser ou corriger le Discord ID d'un membre (pas celui du Fondateur) |
| `comptes.langue` | régler la langue par défaut d'un compte (pas celle du Fondateur) |
| `statistiques.voir` | ouvrir la page Statistiques (activité par membre comprise) ; arrêter ou reprendre la collecte reste au Fondateur |
| `jeux.gerer` | gérer les profils de jeu et l'assistant IA ; l'**Administration de l'IA** reste au Fondateur. Elle peut aussi être accordée directement depuis Jeux › Administration IA (accord direct, inchangé) |
| `roles.gerer` | la page Rôles et permissions (Fondateur seul à l'accorder) |

Le Discord **se règle par team** (`discord.manage`) et les salons du club par le CM (`cm.gerer`, page Réseaux) : il
n'existe pas d'objet « Discord du club » séparé.

## Le rôle « Second CEO »

Rôle système du club, adjoint du Fondateur (à donner à Grimm : **Membres › Rôles et permissions › Club › Second CEO ›
Qui a ce rôle › chercher « Grimm » › + Grimm**). Par défaut : **toutes les permissions du club et du CM, sauf
`roles.gerer`**, soit :

- toutes les teams avec les droits du Propriétaire (sauf supprimer une team, nommer un Propriétaire) ; créer des teams ;
- membres : inviter partout, demandes de compte (voir, refuser), Discord ID, langue des comptes, trombinoscope (voir,
  compléter) ;
- statistiques ; jeux et assistant IA ;
- tout le CM : `cm.voir`, `cm.deposer`, `cm.editer`, `cm.valider`, **`cm.gerer`** (équipe CM, tableaux, réglages,
  suppressions définitives), clips, tout le Drive (`cm.drive.gerer` compris), **Sponsors** (voir et gérer).

**Restent au Fondateur** (non délégables, même par la matrice) : son propre compte (Discord ID, langue, rôles : 403
`compte-fondateur`), **attribuer, retirer, modifier ou rétablir le Second CEO** (403 `role-reserve` pour tout autre),
accorder ou retirer `roles.gerer`, le modèle des nouvelles teams, la **validation** des demandes de compte (clés du hub),
la **suppression d'un compte** et le **RGPD** d'un membre (export, effacement), l'**export / import de la base**, les
secrets du serveur, l'Administration de l'IA, les réglages de la collecte des statistiques, **supprimer une team**
(avec les Propriétaires de la team). Le Fondateur peut ajuster le Second CEO dans la matrice comme les autres rôles (y
compris lui cocher `roles.gerer`) ; nom et couleur sont fixes ; **Rétablir** revient à la liste ci-dessus.

## Rôles de team

Section **Teams** : choisir « **Modèle des nouvelles teams** » ou une team.

- **Modèle des nouvelles teams** (Fondateur seul ; lecture pour un délégué) : permissions données aux rôles système
  (Manager, Coach, Analyste, Joueur, Remplaçant) **à la création** d'une team. Les teams existantes gardent leur copie.
  « Rétablir » revient au catalogue. Le Propriétaire a toujours tout.
- **Une team** : seulement les teams où vous avez `roles.manage` (le Fondateur : toutes ; le Second CEO : toutes). Mêmes
  règles que dans la team ([README.md](README.md), « Rôles modifiables ») : Propriétaire verrouillé, pas de rôle égal ou
  supérieur au sien, anti-escalade, au moins un gestionnaire des rôles.

## Garde-fous

- Ordre des contrôles inchangé : session → appartenance → module → permission. Les données sensibles restent protégées
  par leurs règles (strats privées, notes du staff, réunions staff, résultats « staff ») : un rôle du club n'y ajoute
  que ce que ses permissions disent (`teams.acces_total` = droits du Propriétaire).
- Le Fondateur n'a **aucune ligne** en base : rien ne peut lui retirer un droit ; on ne lui attribue aucun rôle.
- **Délégué** (`roles.gerer` sans être le Fondateur) : il n'accorde que des permissions qu'il a (403 `escalade`, avec
  la liste des manquantes) ; il ne touche pas à un rôle qui a une permission qu'il n'a pas (modifier, supprimer,
  attribuer, retirer) ; il ne touche jamais à `roles.gerer` (403 `permission-reservee`) : impossible de s'en priver
  ou d'en priver un autre — **personne ne peut se verrouiller dehors** ; ni au Second CEO.
- Rôles CM : les routes `/cm/roles` et `/cm/affectations` s'ouvrent aussi à `roles.gerer` (anti-escalade avec toutes
  les permissions du club de l'acteur) ; les réglages et le journal du CM restent à `cm.gerer`.
- Effet immédiat (aucun cache) ; chaque changement est au **journal** (section Journal : rôles du club, modèle, rôles
  CM et affectations, rôles des teams).

## Cohérence du catalogue

`esport/noyau/catalogue.json` décrit **toutes** les permissions : `descriptions` (catégorie, FR, EN, sensible),
`categories`, `permissionsGlobales`, `rolesGlobauxSysteme`. Le test `esport/test/roles-permissions.test.mjs` échoue
si une permission vérifiée par le serveur (`exiger`, `peut`, `autorise`, `.has`, `aGlobale`, constantes
`PERMISSION(S)_*`, SQL) n'est pas décrite, si une permission décrite n'est vérifiée nulle part, ou si la migration
ne pose pas exactement les permissions par défaut du Second CEO. **Nouvelle permission : l'ajouter au catalogue
(description FR / EN, catégorie), puis la cocher dans la page.**

## Données (migration 0033)

- `roles_globaux`, `roles_globaux_permissions`, `roles_globaux_affectations` : rôles du club, leurs permissions et
  leurs comptes ; `roles_modele` : modèle des rôles des nouvelles teams (JSON par rôle).
- Vue `permissions_club` : permissions du club d'un compte = affectations CM « club » + rôles du club + accords
  directs (`permissions_globales`, migration 0021). Les contrôles CM, Sponsors, trombinoscope, jeux et le cœur la lisent.
- Export / import de la base : les quatre tables (le Second CEO de la migration est remplacé par celui de l'export).
- RGPD : « Mes données » exporte `rolesClub` ; supprimer un compte efface ses rôles du club (ce qu'il a attribué
  reste, sans auteur).

## API (préfixe facultatif `/api/esport`)

| Route | Effet |
| --- | --- |
| `GET /roles-permissions` | la page (rôles du club, permissions, modèle, teams gérables, comptes) |
| `POST /roles-permissions/globaux` | créer (ou dupliquer) un rôle du club `{ nom, couleur, permissions }` |
| `PATCH` / `DELETE /roles-permissions/globaux/:id` | modifier (système : permissions seulement), supprimer |
| `POST /roles-permissions/globaux/:id/retablir` | permissions par défaut (Second CEO) |
| `POST /roles-permissions/globaux/:id/comptes` `{ compte }` ; `DELETE …/comptes/:compte` | donner, retirer le rôle |
| `PUT /roles-permissions/modele/:cle` `{ permissions }` ; `POST …/retablir` | modèle des nouvelles teams (Fondateur) |
| `GET /roles-permissions/journal?avant=` | journal des changements |

`GET /moi` annonce `permissionsGlobales`, `peutGererRoles`, `peutVoirStatistiques` ; `GET /membres`,
`peutGererDemandes`.
