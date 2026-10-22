# Connexion : identifiant + mot de passe pour tous (Fondateur compris)

Ce document explique, pas à pas, comment on se connecte à AppDashboard — le **Fondateur** comme ses **amis** — et
comment un ami est invité. La partie technique (sécurité, relais, compatibilité) est à la fin.

## Nouveau (relais version 9) : plus de code de liaison, pour personne

- **Tout le monde** se connecte sur n'importe quel appareil ou navigateur avec son **identifiant** (son prénom, par
  exemple) et son **mot de passe** : « Se connecter » sur https://appdashboard.fr. Le Fondateur aussi : la carte
  « Administrateur : relier avec le code de liaison » et tout le parcours `AB1.…` ont disparu.
- **Dès qu'on tape son identifiant**, l'écran prend le **style** (thème) de ce compte. Le serveur ne rend que le NOM
  du thème, et la même réponse neutre (« pas de thème ») pour un identifiant inconnu.
- **Identifiant inconnu ou mot de passe faux : le même message** (« Identifiant ou mot de passe incorrect »), pour
  qu'on ne puisse pas deviner quels comptes existent.
- **Mot de passe oublié** : le Fondateur utilise un de ses **codes de récupération** (« Mot de passe oublié ? » sous
  « Se connecter ») ; un ami demande au Fondateur de **réinitialiser son accès** (nouveau lien).
- « J'ai reçu une invitation » reste : c'est la première connexion d'un invité, qui choisit son mot de passe.

### Côté Fondateur : passer à la connexion par identifiant (une fois)

1. Mettez à jour l'app du PC et ouvrez-la (déverrouillée, comme d'habitude : mot de passe et code à six chiffres).
2. Quelques secondes après, l'écran **« Se connecter partout avec un identifiant »** s'affiche : choisissez votre
   identifiant (« admin », votre prénom…), tapez votre **mot de passe actuel** et votre **code à six chiffres**.
   « Changer de mot de passe » est **facultatif** (décoché : votre mot de passe actuel sert partout).
3. L'app affiche **dix nouveaux codes de récupération** : notez-les sur papier. Les anciens ne marchent plus.
4. C'est tout : sur https://appdashboard.fr, l'iPhone ou un autre PC, « Se connecter », votre identifiant, votre mot
   de passe, puis **le code à six chiffres** (même application d'authentification qu'avant : relais version 10, voir
   « Validation en deux étapes » plus bas). Plus de code de liaison. (« Plus tard » repousse l'écran ; il est aussi
   dans Paramètres › Sécurité › « Identifiant et mot de passe de connexion », qui sert ensuite à les changer.
   Refaire l'écran ne casse rien : accès, A2F et codes sont republiés, les clés ne changent pas.)

**Tant que l'étape 2 n'est pas faite, le serveur ne connaît aucun identifiant pour le Fondateur** : sur le site, la
connexion répond « Identifiant ou mot de passe incorrect » (comme pour tout identifiant inconnu : pas d'énumération
des comptes). Le bouton **« Administrateur : première connexion ? »** de l'écran de connexion explique la démarche
(il s'affiche aussi après un refus) sans rien dire d'un compte en particulier.

#### TEMPORAIRE : activer depuis un autre appareil avec le code AB1 (sans le PC)

Pour un Fondateur loin de son PC qui garde son ancien **code de liaison** (`AB1.…`) : jusqu'au **30 novembre 2026**
(`AB1_TEMPORAIRE_JUSQU_AU`, `bureau/liaisonTemporaire.ts`), l'accueil du site montre un lien discret
**« Administrateur : relier avec un code de liaison (temporaire) »** (un lien `https://appdashboard.fr/#liaison=AB1.…`
l'ouvre avec le code déjà rempli).

1. Sur la tablette (navigateur neuf) : ce lien, coller le code AB1, « Relier ce navigateur ».
2. La page se recharge : « admin » (ou votre prénom) si l'écran du prénom s'affiche, puis votre **mot de passe** et
   votre **code à six chiffres** (comme l'ancien site de secours). Vos données arrivent.
3. Quelques secondes après, « Se connecter partout avec un identifiant » s'ouvre seul (sinon Paramètres › Sécurité ›
   « Identifiant et mot de passe de connexion ») : identifiant `admin`, mot de passe actuel, code → les dix codes.
4. Ensuite, partout : « Se connecter », `admin`, mot de passe, code à six chiffres.

Gardé de l'ancien parcours : code lisible, **jeton maître** seulement (un code d'ami est refusé), relais **connu**
(celui du site via `relais.json` ou `https://relais.appdashboard.fr` ; le relais du site est essayé d'abord avec le
même jeton ; un code qui porte une ancienne adresse du relais n'est essayé que sur le relais du site, jamais sur le
serveur inconnu), coffre réellement trouvé. Le code AB1 ne donne que la boîte
CHIFFRÉE : sans le mot de passe et le code à six chiffres, rien ne s'ouvre.

Retrait automatique : après la date, la carte et la lecture du lien disparaissent. Avant, dès que la connexion par
identifiant est active (coffre publié « canonique », constaté APRÈS lecture avec le jeton du code, donc rien n'est
révélé à un visiteur anonyme), le code est refusé (« déjà active ») et le lien disparaît de ce navigateur. Testé par
`scripts/e2e-ab1-temporaire.mjs`. À supprimer après la date : `bureau/liaisonTemporaire.ts`, la carte de
`bureau/AccueilSite.tsx`, `relierTemporaire` dans `bureau/index.tsx`, ce paragraphe et l'e2e.

### Validation en deux étapes (A2F, relais version 10)

- Le code à six chiffres (TOTP, application d'authentification) est vérifié **par le serveur**, après la preuve du mot
  de passe et **avant** de rendre quoi que ce soit (charge scellée, session) : `POST /acces/<h>/ouvrir` répond
  `a2f-requis` sans code, `a2f-code` pour un code faux ou déjà servi (`relais/a2f.mjs`).
- Fenêtre de ±1 pas de 30 s ; **anti-rejeu** (un pas ne sert qu'une fois, jamais un pas plus ancien que le dernier
  accepté : le code tapé à la migration ne resservira pas, attendez le suivant) ; 5 codes faux, puis attente doublée
  (30 s → 15 min).
- Secret stocké **chiffré** (AES-256-GCM, clé du serveur : `CLE_A2F` de `relais.env`, sinon tirée du jeton maître),
  jamais rendu. Il est confié au serveur à la migration du Fondateur (le secret de son coffre : même application) ou
  à l'activation.
- **Paramètres › Sécurité › Validation en deux étapes**, pour tout compte : activer (QR code, ou le secret du coffre
  pour le Fondateur, puis un code), désactiver (un code). Le Fondateur peut retirer l'A2F d'un ami (téléphone perdu).
- Les **codes de récupération** (« Mot de passe oublié ? ») restent une autre porte, sans code à six chiffres.
- L'identifiant reste insensible à la casse, aux accents, aux caractères invisibles et aux espaces **au bord**
  (`cleIdentifiant`) ; deux espaces au milieu comptent pour un, mais « Enzo Axel » ≠ « EnzoAxel ».
- Un `PUT` (dépôt d'accès, A2F…) refusé ou vidé en route par un frontal d'hébergement est réessayé en `POST` +
  `X-Methode` ; un refus affiche la raison réelle du serveur (champ fautif), jamais un simple « 400 ».

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
   son **adresse e-mail** (facultative, conseillée), ses apps, la durée de l'invitation (7 jours par défaut), coche
   l'avertissement, puis **Créer**.
2. Le panneau **Invitation de …** s'affiche : touche **« Envoyer l'invitation par e-mail »** — ta messagerie s'ouvre,
   adressée à ton ami, objet et message prêts : vérifie et envoie. Ou **« Copier le message »** et colle-le dans
   WhatsApp, SMS, Messenger… ; sur iPhone/iPad, **« Partager… »**. Le message contient le lien, son identifiant et trois
   étapes simples. Tu peux aussi lui montrer le **QR code**, ou lui dicter le **code court** (`K7M2Q-9XH4T`).
   **Aucun e-mail ne part d'un serveur** : c'est ta messagerie qui l'envoie (détails : `docs/hub/administration.md`).
3. Vérifie la ligne **« ✓ Compte publié sur le relais »**. Si tu lis « pas encore publié », garde l'app ouverte
   (déverrouillée) une minute : c'est ton appareil qui publie le compte de ton ami sur le relais.

Il n'y a **plus de mot de passe à transmettre**. Chaque envoi est noté dans sa fiche (« Contact et invitations » :
date, canal) ; « Relancer (nouveau lien) » en prépare un autre en un clic. Le message se personnalise dans
**Administration › Réglages › Message d'invitation** (`{prenom}`, `{lien}`, `{expiration}`, `{fondateur}`…), et la
**politique du mot de passe** de tes amis (longueur, force minimales) dans **Réglages › Comptes et invitations** : elle
voyage, scellée, dans l'invitation, et l'écran de l'ami l'applique. (Les identifiants « à l'ancienne » restent affichés en dessous, en
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
2. Ton identifiant s'affiche (ton prénom). Choisis **ton mot de passe** : 10 caractères au moins (ou ce que le
   Fondateur a réglé : l'écran l'indique), pas seulement des chiffres, pas ton prénom. Une phrase facile à retenir est idéale (« Été à Biarritz 2026 »). L'indicateur de force
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
| Identifiant ou mot de passe incorrect | vérifie ton prénom tel que le Fondateur l'a écrit, puis majuscules et accents du mot de passe ; sinon « Mot de passe oublié » (le serveur ne dit pas lequel des deux est faux) |
| Cette invitation a expiré / a été annulée | demande un nouveau lien |
| Cette invitation a déjà été utilisée | connecte-toi avec ton prénom et ton mot de passe (si ce n'était pas toi, préviens le Fondateur) |
| Ton compte n'est pas encore publié | demande au Fondateur d'ouvrir AppDashboard, puis réessaie |
| Serveur de synchronisation injoignable | vérifie ta connexion Internet |
| Trop de tentatives : réessaie dans … | attends le délai indiqué (protection contre les essais au hasard) |
| Le relais doit être mis à jour | utilise ton lien d'invitation ; le Fondateur doit relancer le workflow du relais |
| Ce navigateur ne sait pas encore où est ton compte | ouvre le lien de connexion reçu avec l'invitation, ou le QR code d'un appareil connecté |
| Cet identifiant est déjà pris par un autre compte | (Fondateur, à la migration) choisis-en un autre |
| Identifiant ou code de récupération incorrect | (mot de passe oublié) vérifie le code ; chacun ne sert qu'une fois |

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

### Relais : version 9 — le Fondateur, les sessions, le style, le secours (`relais/sessions.mjs`, tests `relais/coffre-serveur.test.mjs`, `bureau/connexionV9.test.ts`)

**Clés et preuve.** Le mot de passe (forme canonique) passe par **Argon2id** (19 Mio, 2 passes, 1 fil : le minimum
OWASP, ~1 s sur iPhone en JavaScript), avec un sel propre à l'identifiant. Du résultat, HKDF tire DEUX valeurs
séparées : la **clé** qui ouvre la charge de l'accès, et la **preuve** d'authentification. Le serveur ne garde que
l'empreinte SHA-256 de la preuve ; il ne voit jamais le mot de passe, la clé, ni la clé maîtresse du coffre. Le coffre
lui-même (enveloppes de la clé maîtresse) s'ouvre ensuite par le mot de passe avec sa propre dérivation Argon2id :
c'est elle qui déchiffre les données, sur l'appareil.

**Le Fondateur** (`compte: principal`) a son accès comme un ami, posé par lui seul (jeton maître, ou sa session).
Une preuve juste lui rend un **jeton de session** `s1.<64 hexa>` tiré au hasard : le relais n'en garde que
l'empreinte (`session:<empreinte>`, 180 jours, prolongée à l'usage, révocable : `DELETE /v9/sessions/courante`, ou
toutes : `DELETE /v9/sessions`). La session vaut le jeton maître pour le compte (synchro, invitations, Tsuzuku,
Esport : `/jeton/verifier` la reconnaît comme compte `principal`), sauf l'export complet de la boîte. **Le jeton
maître reste un secret du serveur** (et du PC historique, `relais-local.json`).

| Route (version 9) | Jeton | Rôle |
| --- | --- | --- |
| `GET /acces/<h>` | aucun | sel et paramètres ; **identifiant inconnu : sel « leurre » stable** (HMAC du jeton maître), même forme |
| `POST /acces/<h>/ouvrir` | aucun (preuve) | charge scellée (+ session pour le Fondateur) ; identifiant inconnu = mot de passe faux (403 `mot-de-passe`, mêmes délais) ; révocation annoncée seulement après une preuve juste |
| `POST /acces/<h>/secours` | aucun (preuve d'un code de récupération) | même chose, par un des codes de récupération du Fondateur |
| `PUT /acces/<h>` | compte (ou Fondateur) | 409 `identifiant-pris` si l'identifiant est à un autre compte |
| `GET /v9/theme/<h>` | aucun | `{ theme }` : le NOM du thème seulement ; inconnu ou sans thème : `{ theme: null }` ; 240 demandes / 15 min / adresse |
| `PUT /v9/theme/<h>` | le compte | publie le nom de son thème (fait seul par l'app quand le thème du compte change) |

**Anti-force brute** (inchangé, et appliqué aussi aux identifiants inconnus) : 5 essais libres par identifiant puis
délai doublé (30 s → 1 h), même en changeant d'adresse ; 10 échecs par adresse IP puis délai jusqu'à 15 min.

**Mot de passe oublié (Fondateur).** À la migration, dix codes de récupération sont tirés ; chacun dérive (Argon2id,
sel commun : les codes ont 80 bits d'aléa) une preuve dont le relais garde l'empreinte, et une clé qui scelle la même
charge. « Mot de passe oublié » : identifiant + un code → session → coffre ouvert par ce code → nouveau mot de passe,
dix nouveaux codes (affichés), accès republié. Un ami, lui, passe par « Réinitialiser l'accès » (séquestre, voir
`docs/hub/sequestre.md`).

**Migration du Fondateur** (`bureau/ConnexionFondateur.tsx`, `Session.passerAConnexionParIdentifiant`) : identité
revérifiée (mot de passe actuel + code à six chiffres), secret TOTP du coffre confié au serveur (version 10) AVANT
l'accès, codes tirés, accès et secours publiés AVANT de toucher au coffre (un identifiant pris ne change rien), puis
coffre rescellé par le mot de passe (l'actuel par défaut, forme canonique), code à six chiffres GARDÉ s'il existait
(sinon exemption scellée par la clé maîtresse, comme pour les amis), coffre téléversé, thème publié. La clé
maîtresse ne change pas : aucune donnée n'est rechiffrée. **Sans code à six chiffres** (compte qui n'en avait
pas, ou A2F désactivée) : ce code ne protégeait que l'accès par l'application (voir `src/securite/README.md`) ; seule
reste la preuve vérifiée par le serveur et ses délais. Un appareil pas encore à jour garde son coffre local (ancien mot de passe)
jusqu'à sa prochaine ouverture à jour.

**Amis existants** : rien à faire, leur accès d'avant (identifiant + mot de passe) marche tel quel ; la réponse pour un
identifiant inconnu est seulement devenue neutre.

### Relais : version 6 (`relais/relais.mjs`, tests `relais/connexion.test.mjs`)

| Route | Jeton | Rôle |
| --- | --- | --- |
| `PUT /invitations/<id>` | maître | dépose une invitation ; la précédente du même compte est révoquée |
| `DELETE /invitations/<id>` | maître | révoque |
| `GET /invitations/<id>` | **aucun** | contenu scellé, tant que l'invitation est active (410 + motif `utilisee`, `expiree`, `revoquee` ; 404 `inconnue`) |
| `POST /invitations/<id>/utiliser` | **aucun** (preuve) | usage unique : marque utilisée, efface la charge |
| `PUT /acces/<h>` | compte (son identifiant attribué) ou maître | accès par identifiant |
| `DELETE /acces/<h>` | maître ou compte | retire l'accès (réinitialisation, révocation) |
| `GET /acces/<h>` | **aucun** | sel et paramètres Argon2id (version 9 : sel leurre pour un identifiant inconnu, plus de 404) |
| `POST /acces/<h>/ouvrir` | **aucun** (preuve) | charge scellée, ou 403 `mot-de-passe` |
| `PUT` / `DELETE` / `GET /revocations/<id>` | maître | révoque (ou rétablit) le jeton de profil du compte : 403 `revoque` partout |

**Anti-force brute** : par identifiant (boîte du relais), 5 essais libres puis délai doublé à chaque échec (30 s, 1 min,
2 min… jusqu'à 1 h, 429 + `Retry-After`), même en changeant d'adresse IP, levé par le bon mot de passe ; par adresse IP
(mémoire du serveur), 10 échecs libres puis délai progressif jusqu'à
15 min, sur les invitations et identifiants inconnus. Une attaque hors ligne reste bornée par Argon2id (coffre et
accès), comme avant.

`/sante` annonce `version: 6` et `fonctions`. Les routes d'avant ne changent pas.

**Relais d'avant la version 6** (le serveur o2switch se met à jour tout seul, `docs/o2switch.md`) : tout continue de
marcher :

- l'invitation passe en mode **« lien »** : le contenu voyage dans le lien lui-même ; l'usage unique tient au mot de
  passe temporaire (remplacé à l'acceptation) ; l'expiration est jugée à l'heure du relais (`/heure`) par l'appareil ;
  l'Administration affiche « Relais à mettre à jour » ;
- la connexion par identifiant sur un appareil neuf répond **« le relais doit être mis à jour »** (pas d'échec muet) :
  l'ami utilise son lien, ou le QR code « Connecter un autre appareil » ;
- pas de code court, pas de révocation côté relais (la désactivation du compte reste effective).

### Adresse du relais pour un appareil neuf

Pour « Se connecter » sans lien, le site doit connaître l'adresse du relais (rien de secret) : fichier `relais.json`
publié avec le site (sur o2switch : `https://appdashboard.fr/relais.json` → `https://relais.appdashboard.fr`), ou lien
de connexion `…/#relais=<adresse>` (dans le message d'invitation), ou mémoire du navigateur. Sinon, le
message « Ce navigateur ne sait pas encore où est ton compte » oriente vers le lien ou le QR code.

### Compatibilité

- Les amis déjà connectés sur un navigateur continuent comme avant. Plus de « code de connexion au site » (`AB1.…`) :
  un ami « à l'ancienne » (mot de passe tiré au hasard + code à six chiffres, sans accès par identifiant) reçoit un
  lien par « Réinitialiser l'accès » et choisit son mot de passe ; ses données sont gardées.
- Un ancien lien `#liaison=AB1.…` n'ouvre plus rien (il est retiré de l'adresse) ; un navigateur qui gardait déjà un
  code continue de marcher.
- Un coffre accepté par invitation n'est plus bloqué par une « invitation expirée » restée dans une projection pas
  encore resynchronisée (l'acceptation prouve que le lien a servi à temps).
- Un ancien appareil (application pas à jour) ne connaît pas l'exemption : il demanderait encore un code pour un ami
  qui n'en a plus. Mettre l'application à jour.

### Limites connues

- L'invitation par e-mail passe par la messagerie de l'appareil (`mailto:`) : aucun serveur n'envoie d'e-mail, et
  l'Administration ne sait pas si le message est parti. Sans messagerie configurée : « Copier le message ».

- Pas de WebKit dans l'environnement de test : l'iPhone est émulé (agent, écran, tactile de l'iPhone 13) dans
  Chromium ; à vérifier sur un vrai iPhone.
- Mode « lien » (relais pas à jour) : un lien volé AVANT que l'ami ne l'ait utilisé reste utilisable, et l'expiration
  n'est vérifiée que par l'appareil.
- Le leurre de l'écran prénom subsiste sur les appareils du Fondateur (annuaire complet) ; sur le navigateur d'un ami
  (un seul compte), un prénom inconnu donne un message précis.
- L'empreinte d'un identifiant n'est pas salée par compte : quelqu'un qui a accès à la boîte du relais peut tester des prénoms
  (comme pour l'annuaire publié, dont le sel est à côté). Il ne peut rien ouvrir sans le mot de passe.

Tests : `src/profils/invitation.test.ts`, `bureau/connexionAmis.test.ts`, `relais/connexion.test.mjs` ; bout en bout :
`scripts/e2e-connexion-amis.mjs` (captures `docs/captures-connexion-amis/`) et, pour l'e-mail, la politique du mot de
passe et l'Administration, `scripts/e2e-admin-invitations.mjs` (captures `docs/captures-admin-invitations/`).
