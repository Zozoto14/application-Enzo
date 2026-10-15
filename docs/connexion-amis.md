# Connexion des amis : invitation, mot de passe, appareils

Ce document explique, pas à pas, comment un ami accède à AppDashboard — côté **Fondateur** (toi, qui crées les comptes)
et côté **ami**. La partie technique (sécurité, relais, compatibilité) est à la fin.

## Pourquoi ça a changé (les vraies causes des échecs)

Avant, pour qu'un ami se connecte au site, il fallait lui transmettre **quatre choses** : un code de liaison `AB1.…`
(généré à part, dans sa fiche, après vérification de ton identité), son prénom, un mot de passe tiré au hasard
(`DBgn3-ru8V4-SRLFr-z9L2F`) **et** une clé TOTP à enrôler dans une application d'authentification, dont il devait
taper le code à six chiffres à chaque connexion. Reproduit avec la version d'avant sur un iPhone neuf émulé (captures
`docs/captures-connexion-amis/avant-*.png`) :

1. **Le panneau « Identifiants » ne parlait pas du site.** On envoyait le mot de passe, mais pas le code de liaison
   (« Envoyer un code de connexion au site », ailleurs dans la fiche) : sur le site, l'ami ne voyait qu'un champ
   « code AB1 » ou « créer un nouveau coffre ».
2. **Le code à six chiffres était obligatoire.** Sans application d'authentification, le bouton « Déverrouiller »
   restait grisé : envoyer « les mots de passe » ne suffisait jamais.
3. **Un seul message pour tout** : « Mot de passe ou code incorrect » pour un mot de passe faux, une lettre changée
   en majuscule, un prénom écrit autrement (« Léa Martin » au lieu de « Léa » menait au compte leurre), ou une
   horloge de téléphone décalée (code TOTP hors fenêtre). Impossible de savoir quoi corriger.
4. **L'invitation pouvait expirer en silence** (7 jours par défaut) : l'ami tapait tout juste… et lisait
   « L'invitation de ce profil a expiré » ; un deuxième appareil pouvait aussi être bloqué tant que l'appareil du
   Fondateur n'avait pas resynchronisé.
5. Mot de passe aléatoire mélangeant majuscules et minuscules, à recopier sur un téléphone : une faute de frappe
   suffisait.

## Côté Fondateur : inviter un ami

1. Ouvre **Administration › Utilisateurs › ＋ Nouvel utilisateur**, saisis son **prénom** (ce sera son identifiant),
   ses apps, la durée de l'invitation (7 jours par défaut), coche l'avertissement, puis **Créer**.
2. Le panneau **Invitation de …** s'affiche : touche **« Copier le message d'invitation »** et colle-le dans
   WhatsApp, SMS, Messenger… Le message contient le lien, son identifiant et trois étapes simples. Tu peux aussi lui
   montrer le **QR code**, ou lui dicter le **code court** (`K7M2Q-9XH4T`).
3. Vérifie la ligne **« ✓ Compte publié sur le relais »**. Si tu lis « pas encore publié », garde l'app ouverte
   (déverrouillée) une minute : c'est ton appareil qui publie le compte de ton ami sur le relais.

Il n'y a **plus de mot de passe à transmettre**. (Les identifiants « à l'ancienne » restent affichés en dessous, en
secours : code de liaison, mot de passe, code à six chiffres.)

### Suivre et gérer les accès

Dans la liste, chaque compte montre son état (**Invitation en attente**, **Invitation expirée**, **Actif**,
**Suspendu**, **Désactivé**), « vu il y a … » et le nombre d'appareils. Dans la fiche d'un compte, rubrique
**Accès et connexion** :

| Bouton | Quand | Effet |
| --- | --- | --- |
| **Renvoyer une invitation** | il n'a jamais ouvert son lien (perdu, expiré) | nouveau lien ; l'ancien cesse aussitôt de marcher |
| **Réinitialiser l'accès (nouveau lien)** | mot de passe oublié, appareil perdu | nouveau lien ; son ancien mot de passe ne marche plus ; **ses données sont gardées** |
| **Révoquer l'accès** | il ne doit plus entrer | le relais refuse son accès, le compte est désactivé, ses invitations annulées |
| **Rétablir l'accès** | après une révocation | il peut revenir (envoie-lui un lien s'il a oublié son mot de passe) |

« Réinitialiser » passe par ton accès de séquestre (la clé de son compte, que tu peux ouvrir) : rien n'est perdu. Si
le séquestre a été révoqué, il faut « Régénérer les identifiants » (son portefeuille repart de zéro).

Les invitations partent de l'appareil **relié au relais avec le code maître** (le PC du Fondateur, ou le site relié
avec le code du PC).

## Côté ami : se connecter

**La première fois** (n'importe quel appareil, même neuf) :

1. Ouvre le lien reçu.
2. Ton identifiant s'affiche (ton prénom). Choisis **ton mot de passe** : 10 caractères au moins, pas seulement des
   chiffres, pas ton prénom. Une phrase facile à retenir est idéale (« Été à Biarritz 2026 »). L'indicateur de force
   t'aide ; le bouton 👁 Afficher te laisse vérifier ce que tu tapes.
3. Confirme-le, touche **Créer mon accès** : tu es connecté. Pas de code à six chiffres.

**Ensuite**, sur cet appareil : ton prénom (déjà rempli) puis ton mot de passe.

**Sur un autre appareil** :

- sur le site, **Se connecter** : ton prénom et ton mot de passe (majuscules, accents et espaces de ton prénom ne
  comptent pas) ;
- ou, depuis un appareil déjà connecté, **Paramètres › Compte › Connecter un autre appareil** : scanne le QR code avec
  l'appareil photo de l'autre appareil, puis prénom et mot de passe.

**Mot de passe oublié ?** Touche « Mot de passe oublié » : demande au Fondateur de **Réinitialiser ton accès** ; tu
recevras un nouveau lien pour choisir un nouveau mot de passe. Tes données sont gardées.

### Ce que disent les messages

| Message | Ce qu'il faut faire |
| --- | --- |
| Identifiant inconnu | vérifie ton prénom tel que le Fondateur l'a écrit |
| Mot de passe incorrect | vérifie majuscules et accents ; sinon « Mot de passe oublié » |
| Cette invitation a expiré / a été annulée | demande un nouveau lien |
| Cette invitation a déjà été utilisée | connecte-toi avec ton prénom et ton mot de passe (si ce n'était pas toi, préviens le Fondateur) |
| Ton compte n'est pas encore publié | demande au Fondateur d'ouvrir AppDashboard, puis réessaie |
| Serveur de synchronisation injoignable | vérifie ta connexion Internet |
| Trop de tentatives : réessaie dans … | attends le délai indiqué (protection contre les essais au hasard) |
| Le relais doit être mis à jour | utilise ton lien d'invitation ; le Fondateur doit relancer le workflow du relais |
| Ce navigateur ne sait pas encore où est ton compte | ouvre le lien de connexion reçu avec l'invitation, ou le QR code d'un appareil connecté |

## Technique

### Saisies robustes

- Identifiant : comparé sans casse, sans accents (NFC comme NFD), espaces et caractères invisibles retirés
  (`cleIdentifiant`, `src/profils/invitation.ts`).
- Mot de passe choisi par invitation : scellé sous sa **forme canonique** (`formeCanonique`) — Unicode NFC (iOS et
  Windows composent les accents différemment), caractères invisibles retirés, espaces insécables → espaces,
  apostrophes et guillemets typographiques (ponctuation « intelligente » d'iOS) → droits, espaces et retours à la ligne
  **au bord** retirés. Le milieu n'est jamais modifié ; la casse compte. La même forme est appliquée à chaque saisie
  (coffre marqué `canonique`) : une seule dérivation Argon2id. Les anciens coffres gardent leur ordre d'essai (saisie
  brute d'abord) et gagnent la forme canonique en dernier.
- Champs : `autocapitalize="none"`, `autocorrect="off"`, `spellcheck="false"`, `autocomplete` `username` /
  `current-password` / `new-password` (gestionnaires de mots de passe), bouton afficher/masquer.

### Le parcours, sans rien en clair sur le serveur

1. **Création** : le coffre de l'ami est créé sur l'appareil du Fondateur avec un mot de passe **temporaire** tiré au
   hasard (comme avant : même Argon2id, même séquestre).
2. **Invitation** (`creerInvitation`, `bureau/connexionAmis.ts`) : un secret de 32 octets voyage dans le **fragment**
   du lien (`#invitation=AI1.…`, jamais envoyé au serveur du site). Du secret sont tirés (HKDF) l'identifiant de
   l'invitation, une clé et une preuve. Le relais garde le contenu (compte, prénom, jeton de profil, mot de passe
   temporaire, expiration) **scellé** par cette clé (XChaCha20-Poly1305), et l'empreinte SHA-256 de la preuve. Le code
   court est une seconde porte vers la même invitation, dérivée du code par **Argon2id** (un relais compromis ne peut
   pas essayer les 2⁵⁰ codes).
3. **Acceptation** (`accepterInvitation`) : le navigateur de l'ami relit le contenu, récupère son coffre, le
   **rescelle** par le mot de passe choisi (le temporaire disparaît : l'invitation ne sert qu'une fois), ajoute une
   marque d'exemption du code TOTP **scellée par la clé maîtresse** (`exempterTotp`, infalsifiable sans elle), publie
   le coffre, puis consomme l'invitation (preuve) et dépose son **accès par identifiant**.
4. **Accès par identifiant** (appareils suivants) : `h = SHA-256(identifiant normalisé)`, un sel, les paramètres
   Argon2id, l'empreinte d'une preuve tirée du mot de passe, et le nécessaire pour retrouver le compte (jeton de
   profil…) scellé par une clé tirée du même mot de passe. Le relais compare la preuve sans connaître le mot de passe et
   ne rend la charge scellée qu'au bon mot de passe. Le compte ne peut écrire que l'identifiant que le Fondateur lui a
   attribué en publiant l'invitation (`acces-proprio:<h>`) : pas d'usurpation d'un autre prénom.

### Relais : version 6 (`relais/worker.mjs`, tests `relais/connexion.test.mjs`)

| Route | Jeton | Rôle |
| --- | --- | --- |
| `PUT /invitations/<id>` | maître | dépose une invitation ; la précédente du même compte est révoquée |
| `DELETE /invitations/<id>` | maître | révoque |
| `GET /invitations/<id>` | **aucun** | contenu scellé, tant que l'invitation est active (410 + motif `utilisee`, `expiree`, `revoquee` ; 404 `inconnue`) |
| `POST /invitations/<id>/utiliser` | **aucun** (preuve) | usage unique : marque utilisée, efface la charge |
| `PUT /acces/<h>` | compte (son identifiant attribué) ou maître | accès par identifiant |
| `DELETE /acces/<h>` | maître ou compte | retire l'accès (réinitialisation, révocation) |
| `GET /acces/<h>` | **aucun** | sel et paramètres Argon2id (404 `identifiant-inconnu`) |
| `POST /acces/<h>/ouvrir` | **aucun** (preuve) | charge scellée, ou 403 `mot-de-passe` |
| `PUT` / `DELETE` / `GET /revocations/<id>` | maître | révoque (ou rétablit) le jeton de profil du compte : 403 `revoque` partout |

**Anti-force brute** : par identifiant (boîte KV), 5 essais libres puis délai doublé à chaque échec (30 s, 1 min,
2 min… jusqu'à 1 h, 429 + `Retry-After`), même en changeant d'adresse IP, levé par le bon mot de passe ; par adresse IP
(mémoire du Worker, pour ne pas épuiser les écritures KV gratuites), 10 échecs libres puis délai progressif jusqu'à
15 min, sur les invitations et identifiants inconnus. Une attaque hors ligne reste bornée par Argon2id (coffre et
accès), comme avant.

`/sante` annonce `version: 6` et `fonctions`. Les routes d'avant ne changent pas.

**Redéploiement** : relancer le workflow GitHub **« Relais (Cloudflare Worker) »** (`docs/relais-deploiement-github.md`)
ou `npm run relais:deployer` sur le PC. **Tant qu'il n'est pas fait**, tout continue de marcher :

- l'invitation passe en mode **« lien »** : le contenu voyage dans le lien lui-même ; l'usage unique tient au mot de
  passe temporaire (remplacé à l'acceptation) ; l'expiration est jugée à l'heure du relais (`/heure`) par l'appareil ;
  l'Administration affiche « Relais à mettre à jour » ;
- la connexion par identifiant sur un appareil neuf répond **« le relais doit être mis à jour »** (pas d'échec muet) :
  l'ami utilise son lien, ou le QR code « Connecter un autre appareil » ;
- pas de code court, pas de révocation côté relais (la désactivation du compte reste effective).

### Adresse du relais pour un appareil neuf

Pour « Se connecter » sans lien, le site doit connaître l'adresse du relais (rien de secret) : fichier `relais.json`
publié avec le site (workflow « Site » : variable GitHub **`RELAIS_URL`** ; sur le PC, `npm run relais:site` l'écrit
seul), ou lien de connexion `…/#relais=<adresse>` (dans le message d'invitation), ou mémoire du navigateur. Sinon, le
message « Ce navigateur ne sait pas encore où est ton compte » oriente vers le lien ou le QR code.

### Compatibilité

- Les amis déjà connectés continuent comme avant (code de liaison, prénom, mot de passe **et** code à six chiffres) :
  leur coffre n'a pas d'exemption, l'écran demande toujours le code. Leurs identifiants restent valables jusqu'à une
  réinitialisation (après laquelle ils choisissent leur mot de passe et n'ont plus de code).
- Un coffre accepté par invitation n'est plus bloqué par une « invitation expirée » restée dans une projection pas
  encore resynchronisée (l'acceptation prouve que le lien a servi à temps).
- Un ancien appareil (application pas à jour) ne connaît pas l'exemption : il demanderait encore un code pour un ami
  qui n'en a plus. Mettre l'application à jour.

### Limites connues

- Pas de WebKit dans l'environnement de test : l'iPhone est émulé (agent, écran, tactile de l'iPhone 13) dans
  Chromium ; à vérifier sur un vrai iPhone.
- Mode « lien » (relais pas à jour) : un lien volé AVANT que l'ami ne l'ait utilisé reste utilisable, et l'expiration
  n'est vérifiée que par l'appareil.
- Le leurre de l'écran prénom subsiste sur les appareils du Fondateur (annuaire complet) ; sur le navigateur d'un ami
  (un seul compte), un prénom inconnu donne un message précis.
- L'empreinte d'un identifiant n'est pas salée par compte : quelqu'un qui a accès à la boîte KV peut tester des prénoms
  (comme pour l'annuaire publié, dont le sel est à côté). Il ne peut rien ouvrir sans le mot de passe.

Tests : `src/profils/invitation.test.ts`, `bureau/connexionAmis.test.ts`, `relais/connexion.test.mjs` ; bout en bout :
`scripts/e2e-connexion-amis.mjs` (captures `docs/captures-connexion-amis/`).
