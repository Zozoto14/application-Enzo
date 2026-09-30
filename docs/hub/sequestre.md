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

Administrateur d'avant la mise à jour : les versions sans hub ne lui
demandaient pas de prénom (il s'appelait « Moi »). Tant que c'est le cas
(`adminSansPrenom`), un prénom qui n'est celui d'aucun ami mène à **son**
coffre plutôt qu'au leurre — mot de passe et code restent exigés — et, après
un déverrouillage réussi, ce prénom lui est attribué (`adopterPrenomAdmin`).
Dès lors, le leurre reprend pour tout prénom inconnu.

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

## 7. Rôles : le Gestionnaire (niveau 1, sans toucher à la cryptographie)

Trois rôles : **administrateur** (tout, séquestre compris), **gestionnaire**
(un ami à l'Administration limitée) et **ami**. Le séquestre reste celui de
l'administrateur seul : un second administrateur « complet » (qui pourrait
ouvrir les comptes) exigerait de re-sceller la clé de chaque compte pour lui —
c'est le **niveau 2**, volontairement absent (l'interface l'annonce : « bientôt »).

Code : `src/hub/admin/roles.ts` (matrice des droits, seule source de vérité),
`src/hub/admin/actions.ts` (chaque action revérifie le rôle de l'appelant),
`src/hub/admin/gestion.ts` (carnet), `src/profils/annuaire.ts` (partie
« côté gestionnaire »). Tests : `roles.test.ts`, `src/profils/gestionnaire.test.ts`.

**Ce que peut un gestionnaire** : tableau de bord (chiffres sans prénoms),
créer/inviter des amis, régler l'accès par app, activer/désactiver/suspendre,
prolonger/annuler une invitation, régénérer les identifiants — **uniquement pour
les amis qu'il a lui-même créés** — et lire le journal de ses propres actions.
**Jamais** : séquestre, code d'accès, ouvrir un compte, agir sur
l'administrateur, sur un autre gestionnaire ou sur lui-même, promouvoir/rétrograder,
sécurité, apps globales (activation, maintenance), exporter le journal,
renommer ou supprimer un compte.

### Choix d'isolation (option la plus protectrice)

L'annuaire ne nomme personne et un prénom inconnu mène au coffre leurre : un
gestionnaire ne doit donc **pas** recevoir la liste des comptes. Il ne connaît
que les amis qu'il a créés, dont il a saisi le prénom ; il les garde dans **sa
propre base chiffrée** (`gestion.comptes`, avec l'identifiant opaque). Pour tous
les autres comptes il n'a que des chiffres (`apercuAnonyme` : aucun prénom).
Écarté : que l'administrateur « confie » des comptes existants — cela demanderait
soit de lui transmettre leurs prénoms (casser le leurre : il pourrait sonder les
prénoms), soit de sceller pour lui avec une nouvelle clé (niveau 2).

### Mécanique

- Le rôle est le champ `role` (« gestionnaire », absent = ami) : dans la liste
  v2 (migration : « ami » par défaut, idempotente) et dans `acces` de l'annuaire
  (lu à la connexion de l'ami, relu à **chaque** action : une rétrogradation
  prend effet aussitôt).
- Un gestionnaire n'a aucune clé de l'administrateur. Il écrit la partie publique
  de l'annuaire (`appliquerAccesGeres` : uniquement `acces`, uniquement les
  comptes de son carnet, jamais un gestionnaire, jamais le rôle) — comme l'ami
  qui note sa connexion.
- Ce qui doit revenir à l'administrateur lui est **scellé avec sa clé publique**
  (`scellerPourAdmin`, mécanisme existant, aucune primitive nouvelle) :
  `creation` (prénom, date, créateur du compte) et `journalGestion` (actions).
  À sa prochaine ouverture il les déchiffre, les reporte à son journal (avec le
  nom du gestionnaire, champ `acteur`) et les efface de l'annuaire. Un dépôt ne
  remplace jamais un prénom déjà connu ; un journal ou un créateur attribué à un
  compte qui n'est pas gestionnaire est ignoré.
- Le compte créé par un gestionnaire est déposé sous séquestre **de l'administrateur**
  (transparence inchangée pour l'ami).

### Limites assumées

- Comme `apps` ou `actif`, `role` n'est pas protégé en intégrité (la liste doit
  être lisible avant tout déverrouillage). Qui modifie le fichier local peut
  s'attribuer une tuile Administration limitée ; il n'obtient aucun contenu de
  compte (tout est scellé), au pire il crée des amis et voit des chiffres.
- Créer un ami refuse un prénom déjà pris (« pas disponible ») : cela laisse
  deviner qu'un prénom existe, comme la limite du dictionnaire (§3).
- Electron : le processus principal ne connaît pas les rôles ; un gestionnaire
  demande l'extension de sa portée aux fichiers du compte qu'il crée/régénère
  (`profil:etendre`, ≤ 16 comptes, jamais `principal`). La logique de l'app exige
  le rôle ; la barrière qui protège le contenu reste cryptographique.

## 8. Plusieurs appareils : ce qui passe par le relais

Détail et tableau complet : `docs/synchro-relais.md` (« Portées du relais », « Ce qui est publié »).

- **L'annuaire complet** part dans l'espace de l'administrateur (`p/principal/`), lisible avec le seul jeton
  maître. Il est déjà opaque (empreintes salées, prénoms scellés par une clé tirée du prénom, bloc `prive` et
  suivis scellés pour l'administrateur) ; un test vérifie qu'aucun prénom n'y figure en clair.
- **Un ami** ne reçoit que sa **projection** (`projectionAmi`) : son entrée, le sel, la politique des apps et la
  clé publique de séquestre — ni l'empreinte ni le prénom de l'administrateur, ni les autres comptes, ni le bloc
  privé. Sur son navigateur, l'annuaire est marqué `restreint` : « admin », le prénom de l'administrateur ou celui
  d'un autre ami mènent au **leurre**, exactement comme un prénom inconnu.
- **Code propre à l'ami** : « Envoyer un code de connexion au site » (fiche du compte, après vérification
  d'identité, inscrit au journal) rend un code AB1 portant un jeton de profil `p1.<id>.<HMAC(jeton maître, id)>`.
  Ce jeton n'ouvre que `p/<id>/` : ni l'annuaire, ni les données d'administration, ni un autre ami (403). Il ne
  contient pas le jeton maître et ne permet pas de le retrouver (HMAC-SHA256).
- **Coffre et portefeuille de l'ami** voyagent tels qu'ils sont sur le disque : le relais et l'administrateur n'y lisent
  rien de plus qu'avant. Le séquestre ne change pas : l'administrateur ouvre toujours le compte d'un ami avec le code
  d'accès, sur n'importe lequel de ses appareils (les fichiers de l'ami y sont synchronisés).
- **Retour de l'ami** (`p/<id>/compte`) : suivi de connexion et dépôt de séquestre, déjà scellés pour la clé publique de
  l'administrateur. L'administrateur n'en reprend que cela.
- **Limites assumées** : un ami peut réécrire sa propre projection sur le relais (comme il peut modifier le fichier
  `profils` de son appareil) — l'administrateur ne la relit jamais, ses accès font foi. Un gestionnaire relié avec son
  seul code n'a pas d'Administration sur ce navigateur (il ne connaît que son compte) : il gère ses amis depuis
  l'appareil de l'administrateur.
