# Synchronisation par le relais : déclencheurs, formats, budget d'écritures

## Ce qui est synchronisé

Entités `genre:identifiant`, scellées XChaCha20-Poly1305 avec `cleDerivee('synchro')` **du profil** (jamais croisées
entre profils : un ami ne peut pas ouvrir le dépôt de l'administrateur, et inversement).

| Genre (version de charge) | Contenu | Fusion |
| --- | --- | --- |
| `compte`, `titre`, `operation`, `surveille`, `these`, `parametre` (1) | portefeuille | dernier gagnant, suppressions 365 j |
| `prefs:hub` (2) | `hub.prefs` : tuiles, disposition, densité | dernier gagnant |
| `prefs:theme` (2) | `hub.theme` : le thème unique de toute l'application | dernier gagnant |
| `prefs:theme-portefeuille` (2) | `affichage.theme` : ancien thème du portefeuille. **Lecture seule** : reçue d'un appareil pas encore à jour (la migration du thème unique la reprend si `hub.theme` est absent), jamais émise | — |
| `devblog:vues` (2) | versions du devblog déjà lues | **union**, jamais supprimée |

Après « Lier » (`adopterCoffre`), la base locale est vide (l'ancienne est scellée par une autre clé) : les versions
vues reviennent par le premier tour, et le devblog attend ce premier tour avant de décider de s'afficher.

## Déclencheurs (`src/sync/relais/planificateur.ts`, branchés dans `src/app/synchroApp.ts`)

Ouverture après déverrouillage · retour au premier plan (`visibilitychange`, `focus`, AppState `active`) · événement
`online` · ~3 s après une écriture locale (`Session.surEcriture`, `src/db/ecoute.ts`) · toutes les 2 min · `pagehide` et
page masquée : dépôt `fetch` avec `keepalive` (`deposerAvantFermeture`) · après un échec : réessais à 5 s, 30 s, 2 min,
10 min (le tic de 2 min se tait pendant ces paliers). Un seul tour à la fois ; une demande arrivée pendant un tour
en déclenche un nouveau. Le tour ne tourne toujours que déverrouillé et pour l'administrateur.

## Ordre de déploiement (compatibilité)

1. La charge porte `version` (2) et l'appareil déclare `versionCharge`. Une charge sans version = ancien format, lue
   inchangée. Un genre inconnu est ignoré sans erreur ni date enregistrée (`ecrireEntite` renvoie `false`).
2. **Garde d'émission** : un appareil n'émet `prefs:*` et `devblog:*` que si **tous** les autres appareils de l'index
   du relais sont connus et déclarent la version 2. Tant qu'un appareil ancien traîne (ou qu'un dépôt est illisible),
   ces entités ne partent pas ; « Oublier » l'appareil périmé (Paramètres › Synchronisation) lève le blocage.
3. Il suffit donc de mettre à jour les appareils dans n'importe quel ordre ; les préférences se mettent à circuler
   dès que le dernier est à jour. Un ancien appareil qui recevrait quand même un genre récent l'ignore (au pire il
   garde une date inutile pour cette clé).

## Budget d'écritures Cloudflare KV (plan gratuit : ~1 000 écritures/jour, 100 000 lectures/jour)

- Un dépôt (`PUT /boite/<appareil>`) coûte **2 écritures** (dépôt + index). Le coffre (`PUT /boite/coffre`) : 1 écriture,
  seulement quand il change (changement de mot de passe).
- Un `PUT` n'a lieu que si l'empreinte de la charge diffère de `dernierEnvoi` : un tour sans changement n'écrit
  **rien** (ni sur le relais, ni de PUT). Testé (`synchroPrefs.test.ts`).
- Délai minimal de 30 s entre deux dépôts (`DELAI_MIN_DEPOTS_MS`) ; les changements intermédiaires sont regroupés dans le
  suivant. Contournement : bouton « Synchroniser maintenant » (et `pagehide`, uniquement s'il y a du nouveau).
- La réparation de l'index du relais (course entre deux dépôts simultanés) est limitée à une fois par heure.
- Les tours qui ne font que lire (`GET /boite`, `GET /boite/<appareil>` si le dépôt d'un autre a changé) n'écrivent rien.
  Les retours au premier plan / en ligne rapprochés (< 10 s) ne font qu'un tour.
- Usage normal : quelques dizaines de dépôts par jour et par appareil au plus (un dépôt par rafale de modifications),
  soit ~20 à 100 écritures/jour pour deux appareils, très en dessous de la limite. Lectures : ≤ 720 tours de 2 min par
  appareil et par jour, ~1 lecture chacun, plus les dépôts changés : bien sous 100 000.

## Course sur l'index du relais (corrigée)

Chaque dépôt porte désormais ses métadonnées KV (`{ date, taille }`) et l'index (`index` pour les appareils,
`p:<id>:~index` pour un espace de compte) est **réparé à partir de `KV.list`** au plus une fois par heure (six heures pour
un espace) : une entrée perdue par deux dépôts simultanés revient seule. On ne liste pas à chaque tour : l'offre gratuite
ne compte que **1 000 listes par jour** (contre 100 000 lectures). Un dépôt coûte toujours 2 écritures (valeur + index).
La réparation côté client (redépôt si absent de l'index, une fois par heure) reste en place pour les relais pas encore
redéployés. Tests : `relais/worker.test.mjs` (« course sur l'index… »).

## Portées du relais (version 2)

| Jeton | Forme | Ouvre |
| --- | --- | --- |
| **maître** (administrateur) | tiré au déploiement (`env.JETON`) | tout : routes historiques `/boite…`, tous les espaces `/p/<id>/…`, passerelle |
| **de profil** (un ami) | `p1.<id>.<HMAC-SHA256(JETON, « applibourse-profil-v1\|<id> »)>` | SON espace `/p/<id>/boite[/<nom>]` et la passerelle Yahoo/médias ; rien d'autre (403) |
| **de profil d'un titulaire** (Administrateur, Fondateur autre que le compte historique) | le même `p1.<id>.…` | son espace, plus — par **délégation** publiée par le compte historique (`PUT /rangs`) — la liste, le `coffre` et le `portefeuille` (lecture, écriture) des comptes de rang strictement inférieur ; jamais `principal`, jamais l'`annuaire` ou le `compte` d'un autre, jamais de suppression |

- Le relais recalcule le HMAC à chaque appel (rien à stocker) ; l'administrateur fabrique le jeton d'un ami hors ligne
  avec le même calcul (`src/sync/relais/portees.ts`). Aucun jeton de profil n'existe pour `principal`.
- Lecture, écriture et suppression d'un espace : son titulaire ou l'administrateur. Un autre jeton reçoit **403, que
  l'objet existe ou non** (pas de 404 révélateur).
- Rétrocompatible : les routes `/sante`, `/boite`, `/boite/<appareil>` sont inchangées pour le jeton maître ; les anciens
  appareils continuent de fonctionner sans mise à jour.
- **Redéploiement nécessaire** du relais pour les espaces (`npm run relais:deployer`, qui reprend boîte et jeton).
- **Rangs (version 3 du relais)** : `GET`/`PUT /rangs` (jeton maître seulement) lit/publie
  `{ delegations: { <titulaire>: [<ids inférieurs>] } }` (clé KV `rangs`, validée : identifiants, jamais
  `principal` ni le titulaire lui-même). Le relais la relit à chaque accès croisé (1 lecture). Le compte
  historique la republie quand elle change (`delegationsDe`, `bureau/synchroComptes.ts`) — rien tant
  qu'aucun titulaire n'existe (un relais pas encore redéployé ne produit donc aucune erreur). Une
  rétrogradation retire la délégation au tour suivant : l'accès cesse aussitôt (403). Redéployer le
  relais pour les rangs.

## Ce qui est publié, et qui peut le lire

| Objet | Contenu | Chiffrement | Lisible par |
| --- | --- | --- | --- |
| `/boite/<appareil>` | portefeuille de l'administrateur (entités) | `cleDerivee('synchro')` de l'administrateur | jeton maître |
| `/boite/coffre` | coffre de l'administrateur (enveloppes) | Argon2id du mot de passe (comme sur disque) | jeton maître |
| `/p/principal/boite/annuaire` | annuaire découpé pour la fusion (empreintes salées, prénoms scellés, accès, séquestres scellés, politique des apps) | déjà opaque, **aucun prénom en clair** (testé) | jeton maître **seulement** |
| `/p/principal/boite/admin` | données d'administration (réglages, notes, journal, connexions vues, robustesse) | enveloppe scellée par `cleDerivee('synchro')` | jeton maître, et seul l'administrateur l'ouvre |
| `/p/<id>/boite/annuaire` | **projection** de l'ami : son entrée, le sel, la politique des apps, la clé PUBLIQUE de séquestre | opaque | l'ami (son code) et l'administrateur |
| `/p/<id>/boite/annuaire` (titulaire) | **projection par rang** : son entrée (sa paire et son bloc privé, scellés par SA clé) et les comptes de rang STRICTEMENT inférieur (empreinte, prénom scellé, accès, SON séquestre). Rien d'un Fondateur ni d'un autre Administrateur, ni registre, ni clé commune, ni bloc privé / empreinte / clé privée du compte historique (testé) | opaque | le titulaire (son code) et le compte historique |
| `/rangs` (clé KV) | délégations des titulaires (identifiants seulement) | aucun secret | jeton maître |
| `/p/<id>/boite/coffre`, `…/portefeuille` | fichiers de l'ami tels que sur disque | coffre : Argon2id ; portefeuille : clé maîtresse de l'ami | l'ami et l'administrateur (qui ne peut pas les ouvrir) |
| `/p/<id>/boite/compte` | ce que l'ami renvoie : suivi de connexion (scellé pour l'administrateur), dépôt de séquestre (scellé), invitation acceptée ; pour un titulaire, aussi sa paire et son bloc privé, SES séquestres (conversions, codes, révocations), ses modifications d'accès et son journal (scellé pour le compte historique) | scellés | le titulaire (ou l'ami) et le compte historique |

L'annuaire complet n'est **jamais** déposé dans un espace lisible par un ami.

## Fusion

- **Annuaire** (`src/profils/synchroAnnuaire.ts`, `src/sync/relais/fusionLww.ts`) : découpé en `sel`, `admin`,
  `admin-connexion`, `politique`, `prive`, `gestion`, et par compte `compte:<id>` (empreinte, prénom scellé, accès),
  `sequestre:<id>`, `sequestres:<id>` (séquestres des titulaires), `titulaire:<id>` (paire d'un titulaire), `suivi:<id>`,
  `creation:<id>`, plus `partage:<id>` et `registre:<id>` (clé commune et registre des Fondateurs, une entrée par
  titulaire : deux Fondateurs qui promeuvent chacun quelqu'un ne s'écrasent pas). Dernier gagnant par entrée (dates déduites en comparant au tour
  précédent), suppression d'un compte = pierre tombale datée de `compte:<id>` (gardée 365 jours) : les fichiers du compte
  sont effacés sur les autres appareils et son espace vidé sur le relais. Deux blocs `prive` divergents sont réunis
  (administrateur déverrouillé) sans rescellement inutile, pour ne pas faire de va-et-vient. Au premier tour d'un
  appareil, ce qui existe sur le relais l'emporte (un navigateur qu'on relie adopte l'annuaire du PC).
- **Données d'administration** (`src/hub/admin/fusionDonnees.ts`) : journal par **union** (identifiant d'événement tiré du
  contenu, `idEvenement`), borné par la rétention et la taille réglées ; `reglages`, `robustesse`, `note:<id>` au dernier
  gagnant ; connexions déjà reportées au maximum par compte.
- **Fichiers d'un ami** (`src/sync/relais/fichiers.ts`) : au niveau du fichier, dernier gagnant (empreinte et date du
  dernier échange). Un fichier ouvert (session de l'ami en cours) n'est jamais écrasé ; il est tiré avant l'ouverture.
  Limite assumée : deux modifications simultanées du même ami sur deux appareils → la plus récente gagne.
- **Retour de l'ami** : l'administrateur n'accepte de `compte` que le suivi, un dépôt de séquestre (si attendu) et
  l'invitation acceptée — jamais les accès, le prénom ou la politique.
- **Retour d'un titulaire** (`appliquerRetourAmi`) : accepté seulement si son rang, relu dans l'annuaire du compte
  historique, est encore Administrateur/Fondateur, et seulement sur des comptes de rang strictement inférieur : sa
  paire, SES séquestres (un état qu'il peut avoir produit : `actif` après `depose`/`actif`, ou `revoque`), ses
  modifications d'accès (jamais le rang), et son journal (chaque action reprise une fois, empreintes retenues).
  Côté titulaire (`recevoirProjection`), ce qu'il a fait ici l'emporte tant que la projection ne l'a pas repris ;
  un séquestre retiré là-bas (rétrogradation) disparaît.

## Tours (`bureau/synchroComptes.ts`, branchés dans `bureau/index.tsx`)

- **Administrateur déverrouillé** (PC ou site) : toutes les 2 min, au retour au premier plan, ~2 s après une
  modification de l'annuaire, ~5 s après une écriture en base : retours des amis → annuaire → projection et fichiers de
  chaque ami → données d'administration. Un tour sans changement n'écrit rien (lectures seules : ~2 + nombre d'amis).
- **Ami déverrouillé** avec une liaison pour son compte : ses fichiers partent, sa projection arrive (accès modifiés,
  désactivation), son retour part. Uniquement son espace.
- **Titulaire déverrouillé** sur un navigateur relié : comme un ami, et en plus les coffres/portefeuilles des comptes
  inférieurs qu'il a ouverts ici (séquestre) repartent et reviennent par délégation. Avant d'ouvrir un compte par
  séquestre, son coffre et son portefeuille sont tirés par délégation.
- **Avant la connexion** : l'annuaire (administrateur) ou la projection (ami) est relu, pour que l'écran prénom
  connaisse les comptes ajoutés ailleurs ; après le prénom, seul le coffre de CE compte (et le portefeuille d'un ami) est
  tiré s'il est plus récent. Le leurre fait le même appel (liste d'un espace existant) : même durée, aucune erreur.

## Premier lancement sur un navigateur

1. Écran d'accueil : **« J'ai déjà un compte (le relier) »** d'abord — code AB1 (ou lien `#liaison=`) : celui du PC pour
   l'administrateur, celui envoyé par l'administrateur pour un ami (« Envoyer un code de connexion au site » dans la fiche
   du compte). « Créer un nouveau coffre » vient en second, avec un avertissement.
2. Le navigateur récupère l'annuaire (ou la projection), puis affiche l'écran prénom exactement comme sur le PC
   (l'administrateur sans ami ouvre directement son compte, comme sur le PC).
3. Ancien coffre local (créé sur le site autrefois) : écran « Ce navigateur contient déjà un coffre » — sauvegarde de
   l'ancien contenu (fichier JSON, chiffré tel quel) proposée d'abord, puis **« Remplacer les données de ce navigateur par
   celles de mon compte PC »** après confirmation. « Lier à mon compte (code de liaison) » est aussi sur l'écran de
   déverrouillage du site, pour tous ; après un échec, un navigateur dont le coffre n'est pas celui du compte relié
   propose « Ce navigateur contient un autre coffre : reprendre celui de ton compte ? ».

Tests : `relais/worker.test.mjs`, `bureau/synchroComptes.test.ts`, `bureau/rangsRelais.test.ts`,
`bureau/AccueilSite.test.tsx`, `src/sync/relais/fusionLww.test.ts` ; bout en bout : `scripts/e2e-site-connexion.mjs`
(captures dans `docs/captures-connexion/`) et `scripts/e2e-rangs.mjs` (rangs : `docs/captures-rangs/`).
