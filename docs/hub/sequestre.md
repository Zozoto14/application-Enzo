# Comptes isolés et accès administrateur (séquestre)

Ce document décrit précisément comment les comptes du hub sont séparés les
uns des autres, et comment l'administrateur peut ouvrir le compte d'un ami
sans lui demander son mot de passe — de façon **transparente** pour l'ami.

Code : `src/securite/sequestre.ts` (primitives), `src/profils/annuaire.ts`
(format de l'annuaire, séquestre), `src/session/session.ts`
(`cleDerivee`, `deposerPourSequestre`, `ouvrirAvecCle`), `bureau/index.tsx`
(enchaînement), `bureau/electron/portee.mjs` (portée des fichiers).
Tests : `src/profils/annuaire.test.ts`, `src/profils/espace.test.ts`,
`bureau/electron/portee.test.mjs`, `src/hub/admin/admin.test.ts`.

## 1. Rappel : un coffre par compte

Chaque compte (administrateur `principal`, ou ami d'identifiant opaque
`[a-z0-9]{6,16}`) a son **propre coffre** (`coffre-<id>.json`) et sa
**propre base** (`portefeuille-<id>.ab`) :

- une clé maîtresse `K` de 32 octets, tirée au hasard à la création ;
- `K` enveloppée par Argon2id(mot de passe) et par Argon2id(chaque code de
  récupération) — XChaCha20-Poly1305 ;
- le secret TOTP scellé par `K` ;
- la base scellée par `K`.

Rien de ceci ne change : le séquestre **s'ajoute** aux enveloppes existantes
sans les modifier. Mot de passe, TOTP et codes de récupération gardent
exactement la même force.

## 2. Clés dérivées propres à chaque compte

`Session.cleDerivee(usage)` = SHA-256(contexte ‖ K) avec :

| Compte     | Contexte                                   |
|------------|--------------------------------------------|
| principal  | `applibourse/<usage>/v1\|` (historique : la clé de synchronisation reste celle des autres appareils) |
| ami `<id>` | `applibourse/<usage>/profil/<id>/v1\|`     |

Deux comptes n'obtiennent donc jamais la même clé d'usage, même par
accident (et les clés maîtresses sont de toute façon distinctes).

## 3. L'annuaire (liste des comptes, format 3)

Le fichier `profils` est le seul que tous les comptes partagent : il doit
être lisible **avant** le déverrouillage pour savoir quel coffre ouvrir. Il
ne contient que le strict nécessaire et **ne nomme ni ne liste personne** :

```
{ v: 3, sel,                                  // sel des empreintes (16 octets)
  admin: { empreinte, nom*, cleSequestre, priveeScellee, derniereConnexion },
  politique,                                  // apps activées / en maintenance
  comptes: [ { id, empreinte, nom*, acces, sequestre, suivi } ],
  prive }                                     // bloc scellé pour l'administrateur
```

- `empreinte` = SHA-256(`applibourse/annuaire/empreinte/v1` ‖ sel ‖ prénom normalisé).
  À l'écran de connexion on **saisit son prénom** ; l'app retrouve le compte
  par empreinte. Aucun écran ni aucune API ne liste les comptes.
- `nom*` = prénom exact, scellé (XChaCha20-Poly1305) par
  HKDF(prénom normalisé, sel, `annuaire/nom`) : seul qui connaît le prénom
  relit sa graphie exacte.
- `acces` : apps, niveaux, actif, dates d'invitation / d'expiration / de
  suspension. Il faut les appliquer à l'ouverture d'un compte, avant que
  l'administrateur ne soit là ; ils ne sont pas secrets.
- `suivi` : dernière connexion et compteur de l'ami, **scellés pour
  l'administrateur** (dépôt ECIES, §4) : l'ami les écrit, ne peut pas les
  relire, et aucun autre compte non plus.
- `prive` : prénoms en clair, dates de création, codes d'accès administrateur
  — scellé par `cleDerivee('annuaire')` de l'administrateur.

Un prénom inconnu ouvre un **coffre leurre** (`src/profils/leurre.ts`) : même
écran, même dérivation Argon2id, même message d'échec. Un compte désactivé
n'annonce son état qu'après un mot de passe **et** un code justes. On ne peut
donc pas deviner quels comptes existent.

Limite assumée : un prénom est devinable par dictionnaire à partir de son
empreinte si l'on a le fichier. L'empreinte empêche la liste, pas la
confirmation d'un prénom deviné.

Migration : les formats 1 et 2 (liste en clair) se lisent encore ; à la
première ouverture de l'administrateur, les prénoms passent dans `prive` et
le fichier est réécrit au format 3.

## 4. Séquestre : schéma cryptographique

### Paire de séquestre de l'administrateur

À sa première ouverture après la mise à jour, l'administrateur génère une
paire **X25519** (`genererPaireSequestre`) :

- `cleSequestre` (publique, 32 octets) : dans l'annuaire, lisible par tous ;
- `priveeScellee` = XChaCha20-Poly1305(clé = `cleDerivee('sequestre')` de
  l'administrateur, contexte `applibourse/sequestre/cle-privee/v1`, privée).
  La clé privée n'existe **jamais en clair sur le disque** ; en mémoire, elle
  est effacée (`fill(0)`) après chaque usage.

### Dépôt (ECIES)

`scellerPourAdmin(publique, contenu, usage)` :

1. `e` ← 32 octets aléatoires, `E = X25519(e, G)` ;
2. `S = X25519(e, publique)` ; `e` et `S` effacés après usage ;
3. `k = HKDF-SHA256(ikm = S, sel = E ‖ publique, info = applibourse/ecies/<usage>/v1)` ;
4. sortie = `hex(E) . hex(nonce ‖ XChaCha20-Poly1305(k, nonce, AD = applibourse/ecies/<usage>/v1, contenu))`.

Seul le détenteur de la clé privée recalcule `S`. L'usage (qui contient
l'identifiant du compte) est lié par la donnée associée : un dépôt présenté
pour un autre compte échoue à l'authentification.

Le dépôt de séquestre d'un ami est `scellerPourAdmin(cleSequestre, K_ami,
sequestre/cle-maitresse/<id>)`. Il est créé :

- par l'administrateur à la **création** du compte et à la **régénération
  des identifiants** (il tient `K_ami` un instant, dans la session vierge de
  l'ami, verrouillée aussitôt) ;
- par l'ami lui-même à sa **connexion** si le séquestre est `attendu`
  (comptes antérieurs : migration). L'ami n'a besoin que de la clé
  **publique** : il ne peut rien apprendre de l'administrateur.

### Code d'accès administrateur et enveloppe

Dès que l'administrateur ouvre son compte, chaque dépôt est converti :

1. `K_ami` ← ouvrir le dépôt avec la clé privée ;
2. `code` ← 16 caractères parmi 32 (80 bits), `XXXX-XXXX-XXXX-XXXX`, propre à
   ce compte (gardé dans `prive`) ;
3. `k_env = HKDF-SHA256(ikm = privée, sel = id, info = applibourse/acces-admin|<id>|<code>/v1)` ;
4. `enveloppe = XChaCha20-Poly1305(k_env, nonce, AD = applibourse/sequestre/enveloppe/<id>/v1, K_ami)` ;
5. le dépôt est supprimé ; `K_ami` et la clé privée sont effacées.

Ouvrir le compte d'un ami exige donc **la clé privée de séquestre (donc la
session administrateur déverrouillée) ET le code** de ce compte. Régénérer
le code ré-enveloppe `K_ami` : l'ancien code cesse de fonctionner. Révoquer
efface l'enveloppe et le code ; l'ami ne redépose plus tant que
l'administrateur ne rétablit pas l'accès. La valeur du code est d'être un
secret **par compte**, révocable et renouvelable, et une confirmation
explicite ; il n'ajoute pas de facteur face à qui tiendrait déjà la session
administrateur (le code est lui-même dans `prive`).

### Ouverture par l'administrateur

1. Administration › Utilisateurs › fiche › « Ouvrir le compte de X » :
   vérification d'identité (mot de passe + TOTP, `Session.verifierIdentite`,
   mêmes temporisations qu'au déverrouillage), saisie du code ;
2. l'événement est inscrit au **journal d'audit** (base chiffrée de
   l'administrateur) — sans le code : le journal masque tout motif de code,
   de mot de passe généré, de clé TOTP ou de code de récupération ;
3. `K_ami` ← enveloppe ; la session administrateur est écrite puis
   **verrouillée** (clé effacée), l'état en mémoire vidé (`changerDEspace`) ;
4. la session de l'ami s'ouvre avec `Session.ouvrirAvecCle(K_ami)`, qui
   **éprouve** la clé contre le coffre (secret TOTP scellé) avant d'ouvrir
   quoi que ce soit ;
5. la date de l'accès est écrite **dans la base de l'ami** ; un bandeau
   « Session administrateur sur le compte de X » reste affiché ; « Revenir à
   mon compte » recharge l'application.

## 5. Transparence (non négociable)

- À la création : avertissement dans le formulaire (case à cocher
  obligatoire), et phrase à transmettre à l'ami avec ses identifiants.
- Chez l'ami : Paramètres du hub › Confidentialité et Paramètres › Profils —
  « L'administrateur peut accéder à ton compte », avec la date du dernier
  accès.
- Chaque accès, affichage, régénération ou révocation du code est journalisé.
- Comptes sans séquestre : alerte au tableau de bord (« séquestre absent, à
  créer à la prochaine connexion de l'ami ou par régénération
  d'identifiants »).

## 6. Isolation hors cryptographie

- Un ami ne reçoit que **son** profil (`profilAmi`) et la politique des apps ;
  jamais la liste des comptes.
- Stockage local (`localStorage`) : clés suffixées par compte
  (`src/profils/espace.ts`) — planning, rappels, voix, liaison, thème.
- État en mémoire (relais et jeton, lecture en cours, mode discret…) : remis
  à zéro à chaque changement de compte ; « Changer de compte » recharge la
  page (Electron : `profil:fermer` recharge la fenêtre).
- Electron : le processus principal tient la **portée** du compte ouvert ;
  un compte ami n'atteint que `coffre-<id>`, `portefeuille-<id>` et
  `profils`, et ses sauvegardes vont dans son propre sous-dossier. Seul
  l'administrateur passe directement à un autre compte (séquestre).
  La barrière décisive reste cryptographique : chaque fichier est scellé
  par la clé de son compte.
