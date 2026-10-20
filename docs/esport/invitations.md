# Esport : inviter un joueur (invitation directe)

Plus aucun code `esp_…` : le Fondateur crée le compte du joueur **depuis l'Esport**, et le joueur voit
directement sa team à sa première connexion.

## Pour le Fondateur

1. **Esport › Membres › Créer un compte** (sur votre PC ou votre iPhone, là où vous êtes connecté
   en Fondateur : il faut vos clés, comme dans l'Administration).
2. Remplissez : **nom ou pseudo** (ce sera aussi son identifiant de connexion), **adresse e-mail**, une
   ou plusieurs **teams** avec un **rôle** par team (Joueur proposé par défaut) et, si vous voulez, son
   **poste en jeu** (Duelliste, IGL…).
3. **Créer le compte et l'invitation** › confirmez votre identité (mot de passe + code à 6 chiffres,
   valable 5 minutes comme dans l'Administration).
4. Le panneau **Invitation de …** s'ouvre : **✉️ Envoyer l'invitation par e-mail** ouvre votre messagerie,
   message prêt (lien à usage unique, team, « aucun code à saisir »). Vous pouvez aussi copier le
   message, le partager ou montrer le QR code.

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
peut attribuer : **Esport › Membres › (compte) › Ajouter à une team**. Les règles anti-escalade
s'appliquent partout : jamais un rôle au-dessus du sien, jamais d'action sur un Propriétaire ou un
rôle supérieur.

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
