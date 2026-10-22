# Esport : inviter un joueur (invitation directe)

Plus aucun code `esp_…` : le Fondateur crée le compte du joueur **depuis l'Esport**, et le joueur voit
directement sa team à sa première connexion.

## Pour le Fondateur

1. **Esport › Membres › Créer un compte** (sur votre PC ou votre iPhone, là où vous êtes connecté
   en Fondateur : il faut vos clés, comme dans l'Administration).
2. Remplissez : **nom ou pseudo** (ce sera aussi son identifiant de connexion), **adresse e-mail**, son
   **Discord ID** (obligatoire : le bot pingue les convoqués avec ; « Comment trouver un Discord ID ? » sous le
   champ, voir [bot-discord.md](bot-discord.md) § 9), une ou plusieurs **teams** avec un **rôle** par team (Joueur
   proposé par défaut) et, si vous voulez, son **poste en jeu** (Duelliste, IGL…). Choisissez aussi sa **langue**
   (Français par défaut, ou English) : celle de son interface Esport tant qu'il n'a pas choisi la sienne, de ses
   e-mails (l'invitation part dans cette langue) et du bot Discord ; modifiable ensuite dans Membres
   (voir [../emails.md](../emails.md) § « Langue des comptes et des e-mails »).
3. **Créer le compte et l'invitation** › confirmez votre identité (mot de passe + code à 6 chiffres,
   valable 5 minutes comme dans l'Administration).
4. Le panneau **Invitation de …** s'ouvre : **✉️ Envoyer l'e-mail maintenant** l'envoie DIRECTEMENT par le serveur
   (si le SMTP est configuré, [../emails.md](../emails.md)), en français ou en anglais, avec un bouton vers le lien ;
   sinon **✉️ Envoyer l'invitation par e-mail** ouvre votre messagerie, message prêt (lien à usage unique, team,
   « aucun code à saisir »). Vous pouvez aussi copier le message, le partager ou montrer le QR code.

Ce que fait cette seule action :

| Où | Quoi |
| --- | --- |
| Administration (hub) | compte de rang **Ami**, modèle **« Esport seulement »** (apps `['esport']`, badge **Esport**), coffre et séquestre comme pour tout compte, invitation de première connexion (usage unique) |
| Données de l'Administration (base chiffrée du Fondateur) | l'adresse e-mail, l'historique des envois, le journal (« Compte de Léa créé depuis l'Esport ») ; **jamais** sur le serveur Esport |
| Serveur Esport | profil (pseudo), membre de chaque team choisie avec son rôle et son poste, statut **invité** |

### Le joueur

Il ouvre le lien (iPhone, PC…), **choisit son mot de passe** (flux d'invitation habituel du hub : le
mot de passe temporaire disparaît, l'invitation ne sert qu'une fois), et son hub ne montre que
l'Esport. Dans l'Esport : pas d'écran de pseudo (déjà choisi), pas de code, sa team est sur le
Dashboard et dans Teams. Il passe alors **actif** ; la team annonce son arrivée (notifications,
Discord, journal « Léa a rejoint la team »).

### Suivre, relancer, révoquer

**Esport › Membres** : filtres par team, rôle et statut (**Invités**, **Actifs**, **Suspendus**) et
recherche. Sur un compte invité (Fondateur, sur son appareil) :

- **Renvoyer l'invitation** : nouveau lien, l'ancien cesse de marcher (même action que l'Administration) ;
- **Révoquer l'invitation** : le relais refuse son accès, le compte est désactivé dans le hub, ses
  appartenances Esport sont suspendues (rétablir : Administration).

Sur tout membre (selon les droits de la team) : changer son rôle, le suspendre, le retirer d'une team,
l'**ajouter à une autre team**.

## Pour le staff (Manager, Coach…)

Seul le Fondateur crée des comptes (il faut ses clés du hub). Un Manager peut **ajouter à une de ses
teams un compte qui existe déjà** et qu'il voit (membre d'une autre de ses teams), avec un rôle qu'il
peut attribuer : **Esport › Membres › (compte) › Ajouter à une team**. Avec la permission « Créer des
membres », un rôle peut aussi **demander** un compte au Fondateur (voir plus bas). Les règles anti-escalade
s'appliquent partout : jamais un rôle au-dessus du sien, jamais d'action sur un Propriétaire ou un
rôle supérieur.

## Laisser des joueurs créer des membres (permission « Créer des membres »)

La permission **`members.create`** (« Créer des membres (demande au Fondateur) », colonne spéciale de la ligne
Membres et rôles) est **désactivée par défaut** pour tous les rôles sauf le Propriétaire. Le Propriétaire la donne
au rôle **Joueur** (ou à tout rôle système sauf Propriétaire : case **« créer des membres »** sous la matrice
d'un rôle système, la seule permission qu'on peut y ajuster) ou à tout **rôle personnalisé** (matrice). Personne
ne la donne sans l'avoir (anti-escalade : un Manager ne peut pas).

Créer un compte du hub exige les clés du Fondateur (séquestre), sur un appareil où il est connecté. Donc, pour un
membre qui a la permission sans être le Fondateur :

1. **Esport › Membres › Proposer un membre › Nouveau compte** : nom ou pseudo, adresse e-mail, team et rôle (un
   rôle **au plus égal au sien** : anti-escalade, sinon 403), poste et mot pour le Fondateur facultatifs.
   Cela crée une **demande** côté serveur Esport (pas de compte).
2. Le Fondateur la voit dans **Esport › Membres** : badge **« Demandes en attente : N »**, panneau **Demandes en
   attente**, notification in-app (« X demande un compte pour Y ») et message Discord **« Demande de compte »**
   si la team a un webhook (activé par défaut ; jamais l'adresse e-mail).
3. **Valider** ouvre la création de compte **préremplie** (nom, e-mail, team, rôle, poste ; modifiables) :
   confirmation d'identité, puis exactement une invitation directe — création réelle du compte du hub (« Esport
   seulement »), pré-enregistrement dans la team, e-mail d'invitation prêt. La demande est close **dans le même
   lot** que le pré-enregistrement (`POST /comptes` avec `demandeId`). **Refuser** la clôt (motif facultatif).
4. Le demandeur suit le statut dans **Mes demandes** (En attente, Validée, Refusée, Annulée) et reçoit une
   notification à la décision ; il peut **annuler** une demande en attente.

La même permission permet aussi d'**ajouter à la team un compte qui a déjà l'Esport** (profil Esport existant),
sans le Fondateur : **Proposer un membre › Compte Esport existant**, son **pseudo exact** et un rôle ≤ au sien
(`POST /teams/:id/membres` avec `pseudo`). Un pseudo inconnu de l'Esport : 404 (il faut alors une demande).

Garde-fous : 10 demandes par heure et par compte (429 au-delà), 10 demandes en attente au plus par demandeur,
pas de doublon (pseudo déjà pris dans l'Esport ou déjà demandé : 409). Isolation : on ne demande que pour une
team dont on est membre avec la permission (404 sinon) ; le demandeur ne voit que ses demandes ; seul le
Fondateur liste, valide ou refuse (403 sinon). L'adresse e-mail n'est gardée sur le serveur Esport que le temps
de la décision : effacée à la validation (elle passe, chiffrée, dans l'Administration), au refus ou à
l'annulation ; jamais dans le journal, le bus ni Discord.

API : `GET|POST /comptes/demandes`, `POST /comptes/demandes/:id/refuser` (Fondateur), `DELETE
/comptes/demandes/:id` (le demandeur), `POST /comptes` + `demandeId` (validation). Événements
`member.account_requested`, `member.account_request_validated`, `member.account_request_refused` (journal de la
team, notifications). Table `demandes_compte` (migration `0009_convocations_demandes.sql`). Tests :
`esport/test/demandes-compte.test.mjs`, `src/esport/InvitationsDirectes.test.tsx`.

## Une seule source de vérité : l'Administration

Supprimer un compte dans **Administration › Utilisateurs** le retire aussi de l'Esport (toutes ses
teams, ses disponibilités, présences, notifications, jetons iCal ; son pseudo reste dans le journal).
L'avis le dit (« Retiré aussi de l'Esport (2 teams) »). Si le serveur Esport était injoignable à ce
moment, la page **Esport › Membres** du Fondateur affiche le compte dans **Comptes supprimés de
l'Administration** avec un bouton **Retirer de l'Esport**.

## Côté serveur (technique)

Choix : **pré-enregistrement par le Fondateur, activation à la première session**.

- `POST /comptes` (super admin seulement) `{ compte, pseudo, affectations: [{ teamId, roleId, posteJeu? }] }`
  crée le profil (`comptes.invite_le`, `invite_par`) et les membres, en un lot atomique, avec un
  événement `member.added` par team. `verifier: true` contrôle seulement (pseudo libre, teams et rôles
  valides) : l'app l'appelle **avant** de créer le compte du hub, pour ne pas laisser de compte orphelin.
- Le lien compte du hub ↔ Esport est l'identifiant du compte du relais, celui que le relais valide à
  chaque `POST /session` : un invité ne peut se faire passer pour un autre. À sa première session,
  `comptes.active_le` est posé et un `member.joined` est émis pour chaque team (idempotent).
- `POST /teams/:id/membres` `{ compte, roleId, posteJeu? }` : ajout d'un compte existant
  (`members.invite`, rôle attribuable par l'acteur, compte déjà visible de l'acteur ; sinon 404).
- `POST /comptes/:compte/teams` `{ affectations: [{ teamId, roleId, posteJeu? }], pseudo? }` : ajoute un
  compte à **une ou plusieurs teams en une fois**, un rôle par team, tout ou rien (une team déjà
  rejointe → 409 `deja-membre` avec le nom de la team ; rôle trop haut → 403 `escalade` ; rien n'est
  écrit). Compte connu (invité, actif, avec ou sans team) : son pseudo ne change pas, ses autres teams
  non plus, `member.joined` tout de suite s'il est actif. Compte du hub sans fiche Esport : le Fondateur
  seul le pré-enregistre (`pseudo` requis). Un Manager ajoute un compte qu'il voit déjà, avec un rôle
  attribuable. C'est la route de l'écran « Ajouter à une team » (page Membres et Membres et rôles d'une
  team) : les teams où le compte est déjà membre sont grisées « déjà membre » ; l'erreur du serveur
  s'affiche sous le bouton. `POST /comptes` sur un compte déjà connu répond 409 `compte-existe`.
- `GET /membres` : annuaire de premier niveau (teams où l'on a `members.view`, rôles attribuables,
  droits, comptes et appartenances de CES teams seulement).
- `GET /dashboard` : résumé agrégé de toutes ses teams en une requête (lectures `team_id IN (…)`), un
  bloc par module seulement si le module est activé et la permission présente.
- `DELETE /admin/comptes/:compte/hub` (super admin) : retrait d'un compte supprimé dans l'Administration (sans le blocage « dernier Propriétaire » de la suppression RGPD `DELETE /admin/comptes/:compte`, idempotent).
- Codes `esp_` : `POST /teams/:id/invitations` et `POST /invitations/accepter` répondent **410**
  (`codes-retires`) sans rien écrire ; les anciennes invitations restent listables et révocables.
- Migration `0008_invitations_directes.sql` (colonnes `invite_par`, `invite_le`, `active_le` de
  `comptes`). Serveur Esport en version 4.

Tests : `esport/test/invitations-directes.test.mjs`, `src/esport/InvitationsDirectes.test.tsx` ; bout
en bout : `scripts/e2e-esport-invitations.mjs` (captures `docs/captures-esport-invitations/`).

## Comptes du hub créés dans l'Administration

Un compte du hub qui a l'Esport parmi ses apps (accès complet ou lecture), créé dans l'Administration et jamais
ouvert dans l'Esport, n'a pas encore de fiche sur le serveur Esport. La page **Membres** du Fondateur le liste
quand même : elle lit l'annuaire du hub sur l'appareil du Fondateur (`comptesHubSansEsport`,
`src/esport/synchroAdmin.ts`) et l'affiche **Jamais connecté · Sans team**. **Ajouter à une team** fait le
pré-enregistrement (`POST /comptes` : identifiant du compte, pseudo Esport, team et rôle), statut invité, actif à
la première session : le joueur voit sa team directement. Un Manager (sans annuaire du hub) ne voit que
l'annuaire du serveur. Test de bout en bout : `scripts/e2e-esport-comptes-hub.mjs`.
