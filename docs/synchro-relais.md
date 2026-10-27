# Synchronisation : le serveur est la référence (relais version 9, quasi immédiate depuis la version 10)

Depuis la version 9 du relais (hébergé chez o2switch, `https://relais.appdashboard.fr`, PostgreSQL), **toutes les
données de chaque compte sont sur le serveur**, chiffrées de bout en bout. Plus d'échange d'appareil à appareil, plus
d'« appareils liés », plus de code de liaison : chaque appareil parle au serveur, et c'est tout.

## Le modèle, en bref

| Avant (≤ v8, boîte à quota d'écritures) | Maintenant (o2switch, v9) |
| --- | --- |
| Chaque appareil du Fondateur déposait SON état dans `/boite/<appareil>` ; les autres lisaient tous les dépôts | Un **coffre serveur par compte** (`/v9/coffre/<compte>`) : un enregistrement chiffré par donnée, avec un numéro de révision |
| Synchro limitée par le quota d'écritures de l'ancien hébergeur (≈ 1 000 par jour) : 30 s mini entre deux dépôts, tour toutes les 2 min, journal jamais synchronisé | Plus de quota. Version 10 : envoi ~150 ms après une modification (une requête), les autres appareils prévenus par le serveur (mode choisi par l'hébergeur, `SYNCHRO_TEMPS_REEL` : sondage de 15 s par défaut, attente longue, ou flux SSE), une seule écoute par navigateur ; tour complet en filet toutes les 3 min |
| Seuls le portefeuille, le thème, les tuiles et les sources Tsuzuku voyageaient | En plus : pages et boîte du **journal automatique**, notes et équipe de Claude Office, espace perso et pilote de semaine des Tâches, carnet d'un gestionnaire, réglages de notifications et de cours, documents légaux acceptés, **tout Tsuzuku** titre par titre (`src/sync/relais/entitesApps.ts`, `entitesTsuzukuDonnees.ts`) |
| Amis : leur base entière en un fichier (`p/<id>/boite/portefeuille`), « le plus récent gagne » au niveau du fichier | Amis : le même coffre serveur que le Fondateur (enregistrement par enregistrement), le fichier reste publié pour le séquestre |
| Nouvel appareil du Fondateur : code de liaison `AB1.…` (portant le jeton maître) | Identifiant + mot de passe (`docs/connexion-amis.md`), le serveur rend un jeton de **session** ; le jeton maître ne quitte plus le serveur |

## Synchro quasi immédiate (relais version 10)

| | Avant (v9) | Maintenant (v10) |
| --- | --- | --- |
| Départ d'une modification | ~1,5 s après (puis tirer + pousser : 2 requêtes au moins) | **~150 ms** après (micro-regroupement des frappes, plafonné à 1 s pour une rafale continue), **une seule requête** (`POST` des enregistrements modifiés) |
| Arrivée sur un autre appareil | au tour suivant de cet appareil : jusqu'à 30 s | **avis du serveur** « coffre X : révision N » (aucune donnée), puis l'appareil tire les différences |
| Délai mesuré A → B (e2e, deux navigateurs, local) | médiane **29,6 s** (de 2,4 à 29,6 s : le tour de 30 s de l’autre appareil) | mode `sondage` (défaut) : médiane **13,5 s**, max **14,7 s** ; `attente` : médiane **0,38 s**, max **0,43 s** ; `sse` : médiane **0,35 s** (e2e du 22/10/2026) |
| Tour complet | toutes les 30 s | filet toutes les **3 min** (30 s face à un relais v9) |
| Réessais hors ligne | 5 s, 30 s, 2 min, 10 min | **1 s, 3 s, 10 s, 30 s, 2 min, 5 min** (+ 0 à 50 % au hasard), et tout de suite au retour du réseau (`online`) |
| Onglet / app fermé pendant l'envoi | la file attendait la prochaine ouverture | **`fetch` keepalive** à `pagehide` / page masquée (file gardée dans la base aussi) |

**Envoi (`synchroniserServeur`, option `pousserDabord`).** Le chiffrement ne change pas : seuls les enregistrements
modifiés partent, scellés par la clé du compte. La réponse d'un envoi porte `avant`, la révision du coffre juste avant
lui : si c'est celle que l'appareil connaissait, personne d'autre n'a écrit, la révision avance sans relire. Sinon,
relecture des différences (`?depuis=N`). Un seul tour à la fois par appareil (planificateur) ; une demande arrivée
pendant un tour en déclenche un nouveau (la file fusionne). L'interface n'attend jamais le serveur : tout est écrit
d'abord dans la base de l'appareil.

**Fermeture pendant l'envoi (`envoyerAvantFermeture`).** `fetch` avec `keepalive` (pas `sendBeacon`, qui ne sait pas
porter le jeton dans `Authorization`), 60 Kio au plus ; la file et ses dates sont notées dans la base, et le tour
suivant relit d'abord (`serveur.relire`) : il y retrouve ces enregistrements identiques, sans doublon ni faux conflit.

**Avis du serveur (`relais/avis.mjs`, client `src/sync/relais/veille.ts`).** Le mode est fixé par le serveur
(`SYNCHRO_TEMPS_REEL` dans relais.env, annoncé par `/sante` : `tempsReel`, `pasSondage`) ; l'appareil ne monte
jamais au-dessus. Défaut : `sondage`, le plus sûr sur un hébergement mutualisé (incident du 22/10/2026 : flux SSE
par onglet et par appareil, reconnexions rapides, IP du Fondateur bannie par le pare-feu ; voir docs/o2switch.md).

| Mode du serveur | Route | Comportement |
| --- | --- | --- |
| `sondage` (défaut) | `GET /v10/coffre/<compte>/version` | requête courte toutes les **15 s**, page visible seulement, un seul onglet par navigateur ; réveil immédiat au focus / retour au premier plan. `/attendre` et `/flux` répondent tout de suite 429 `mode-sondage` (les onglets d'une ancienne version passent ainsi au sondage) |
| `attente` | `GET /v10/coffre/<compte>/attendre?rev=N&delai=50` | répond dès que la révision dépasse N, ou au bout de **50 s** ; un espace toutes les 15 s (le JSON reste valide) garde la connexion en vie ; jamais compressé. Une attente vide revenue en moins de 5 s compte comme une erreur (mandataire qui coupe) : pause croissante, puis sondage |
| `sse` | `GET /v10/coffre/<compte>/flux?rev=N` | flux lu par `fetch` (bourrage de 2 Kio, battement 15 s, fermé au bout de 5 min). Premier avis absent en 4 s → attente longue. Un flux coupé avant 30 s compte comme une erreur |

Sobriété (côté serveur) : au plus **2 connexions tenues par compte et par adresse IP**, 4 par compte, 60 en tout ;
au-delà, réponse immédiate 429 `trop-de-connexions` avec `mode: "sondage"`, la révision courante et `Retry-After`
(aucune connexion gardée ouverte). Au plus 60 appels d'avis par minute et par adresse (429 `trop-de-requetes`,
`Retry-After: 60`). Chaque connexion tenue est libérée quand l'appareil s'en va (annulation de la réponse), a une
durée maximale, et un balayage ferme les orphelines (aucune minuterie qui survit). Une nouvelle connexion tenue du
MÊME appareil (`&appareil=<id>`, identifiant de l'appareil) remplace l'ancienne : un navigateur ou un frontal qui ne
signale pas tout de suite l'abandon d'une requête (onglet masqué puis revenu) n'en laisse jamais deux.

Sobriété (côté appareil) :
- **une seule écoute par navigateur** (`src/sync/relais/meneurOnglets.ts`) : verrou Web Locks par relais et par
  compte ; le meneur (un onglet visible) écoute et relaie par `BroadcastChannel` (`version`), et un onglet qui vient
  d'envoyer prévient les autres (`ecrit`) : ils relisent sans attendre le serveur. Les fenêtres de l'app de bureau
  partagent la même origine : une écoute par appareil. Sans Web Locks (app iPhone) : une écoute par app ;
- page masquée, `pagehide` : l'écoute est fermée (connexion longue annulée) et le verrou rendu ; pas de tour de
  filet page masquée ;
- erreurs (réseau, 429, 503) : attente exponentielle avec part au hasard (2 s, 4 s, 8 s… plafond 5 min, jamais
  moins de la moitié), `Retry-After` respecté ; trois erreurs de suite dans un mode tenu → étage du dessous ;
- au plus **30 requêtes de synchro par minute** par onglet (`src/sync/relais/sobriete.ts`) : au-delà, la requête
  attend son tour ;
- un avis d'une révision déjà tirée (sa propre écriture, un autre onglet plus rapide) ne relit rien ; les anciens
  dépôts par appareil (`/boite`, transition du Fondateur) ne sont relus qu'une fois toutes les 10 min, plus à
  chaque tour ;
- requêtes de veille sans `cache: 'no-store'` (qui forçait Chromium à refaire la requête CORS préalable `OPTIONS` à
  chaque fois : deux requêtes au lieu d'une).

| Connexions par navigateur (5 onglets ouverts) | Avant (v10 du 22/10) | Maintenant |
| --- | --- | --- |
| Connexions longues | **5** (une par onglet visible ; plus les reconnexions à 250 ms) | **0** en `sondage`, **1** en `attente`/`sse` |
| Requêtes d'avis par minute | flux tenus en continu, rouverts 250 ms après chaque coupure | **4** (`/version` toutes les 15 s, un seul onglet ; mesuré : 8 par minute pour 2 navigateurs dont un à 5 onglets) |
| Limite serveur | 6 par compte, 300 en tout | 2 par compte et par IP, 4 par compte, 60 en tout |

PostgreSQL : une écriture verrouille la ligne du compte dans `relais_coffre_rev` (révisions monotones par coffre), la
lecture des différences passe par l'index `(profil, rev)`, `/version` lit une ligne par clé primaire. Réponses JSON
compressées (gzip) au-delà d'1 Kio. Aller-retour mesuré (envoi d'un enregistrement + relecture, serveur Node réel,
local) : médiane **3,8 ms** en mémoire, **10,8 ms** avec PostgreSQL (`relais/avis.test.mjs`).

**Compatibilité.** `/v10/coffre/…` = les routes v9 + les avis ; `/v9/coffre/…` reste (appareils v9 pendant le
déploiement : le cron met le serveur à jour avant les apps). Un appareil v10 face à un relais v9 (pas de `coffre-v10`
dans `/sante`) garde les routes v9 et le tour de 30 s. Derrière un intermédiaire qui retient le flux SSE,
l'attente longue prend le relais. Un `PUT`/`DELETE` refusé ou abîmé par un
intermédiaire (400, 405, 411, 501) est réessayé une fois en `POST` + `X-Methode`, traité par le relais comme l'original.

Tests : `relais/avis.test.mjs` (flux, attente, modes, limites par compte et par IP, réponse immédiate sans connexion
au-delà, plafond par minute, balayage, gzip, latence ; aussi PostgreSQL), `src/sync/relais/veille.test.ts` (plafond du
serveur, replis, backoff avec jitter, Retry-After, plafond de requêtes), `meneurOnglets.test.ts` (un seul meneur pour
5 onglets, relais), `planificateur.test.ts` (micro-regroupement, réessais),
`synchroRapide.test.ts` (une requête par modification, différences, keepalive, délai A → B par mode : ~160 ms),
bout en bout `scripts/e2e-synchro-rapide.mjs` (deux navigateurs, mode du serveur par `SYNCHRO_TEMPS_REEL`, 5 onglets
= au plus une connexion longue, hors ligne, onglet fermé ; captures
`docs/captures-synchro-rapide/`).

## Un tour de synchronisation (`src/sync/relais/coffreServeur.ts`)

1. **Noter** ce qui a changé ici depuis le tour précédent (empreintes) : la **file d'envoi** (`enAttente`), rangée dans
   la base chiffrée de l'appareil. C'est elle qui sert de file d'attente hors ligne.
2. **Migration**, une seule fois par appareil : toutes ses données entrent dans la file (elles seront fusionnées dans le
   coffre serveur). Chez le Fondateur, les anciens dépôts par appareil encore présents sur le relais sont d'abord
   fusionnés ici (un appareil pas encore à jour continue d'y déposer : il est lu à chaque tour).
3. **Tirer** les enregistrements modifiés sur le serveur depuis la dernière révision lue (par pages de 500, 8 Mio au plus)
   et les appliquer.
4. **Pousser** la file (lots de 400 enregistrements ou 16 Mio). Chaque enregistrement porte la révision qu'on
   connaissait (`base`).

**Conflits (règle par enregistrement, sans perte).** Si un autre appareil a changé le même enregistrement entre-temps
(révision différente), le serveur garde le **plus récent par sa date** (à date égale, ce qui existe déjà) et range
l'AUTRE version dans son **historique** (`conflit`). L'appareil qui perd reçoit la version gardée. Une suppression
garde l'ancienne valeur dans la **corbeille** (`suppression`). Historique et corbeille : 180 jours, 5 000 lignes par
compte (`GET /v9/coffre/<compte>/historique`, lu et déchiffré par `historiqueServeur`). Les événements de la boîte du
journal se fusionnent par **union** (deux appareils n'effacent jamais ceux de l'autre).

**Chiffrement.** L'identifiant d'un enregistrement est un HMAC-SHA256 de sa clé (`genre:identifiant`) par la clé de
synchronisation DU COMPTE (`cleDerivee('synchro')`, tirée de sa clé maîtresse) ; le contenu est scellé par
XChaCha20-Poly1305 avec la même clé, lié au compte, à l'identifiant et à la date. Le serveur voit : le nombre
d'enregistrements, leur taille, leurs dates et révisions. Il ne voit ni la clé de la donnée, ni son contenu.

**Hors ligne.** L'appareil garde une copie complète (sa base chiffrée) : tout s'affiche et se modifie sans réseau ; la
pastille dit « Hors ligne » ou « N éléments en attente » ; tout part au retour du réseau (événement `online`,
réessais à 1 s, 3 s, 10 s, 30 s, 2 min, 5 min, bouton « Réessayer »).

**Réglages.** Il n'y a plus de section « Synchronisation » dans les Paramètres : seulement l'état de la **connexion au
serveur** (Paramètres › Général, et la pastille de l'en-tête), avec « Réessayer » quand quelque chose attend.

**Anciens dépôts « par appareil »** (`/boite/<appareil>`, les « Site de secours · il y a 22 jours ») : fusionnés au
premier tour d'un appareil à jour, puis effacés du relais s'ils ont plus de 30 jours (une fois par jour) ; le dépôt de
l'appareil lui-même est retiré dès sa migration. Rien n'est perdu : tout dépôt lu est déjà fusionné.

**Ce qui reste sur leur propre canal** (fusion plus fine, déjà sur le serveur) : l'annuaire, les données
d'administration (`p/principal/boite/admin`), les tâches du Fondateur et leur partage, les sources Tsuzuku partagées,
les abonnements. Leurs freins d'écriture (30 s mini, tour de 2 min) sont levés : tour toutes les 30 s, ~2 s après une
modification.

**Restent sur l'appareil** (choix voulus) : l'identifiant d'appareil, l'état de la synchro, le mode discret, le délai de
verrouillage, le thème « pour cet appareil uniquement », les onglets et fenêtres ouverts, la voix du podcast, les tickets
de support (leur liste fait foi sur le serveur du support), les secrets « jamais synchronisés » des Tâches et ses
préférences d'affichage, les journaux de notifications déjà envoyées, les brouillons, et les caches régénérables
(cours, catalogue et recherches de Tsuzuku, temps de réponse des sites).

## Fusion plutôt que remplacement (entités « fusionnables »)

La règle reste « le plus récent gagne, par enregistrement, l'autre version dans l'historique du serveur ». Pour
quelques données, deux versions ne doivent JAMAIS se remplacer : elles sont **fusionnées** à la réception
(`estFusionnable`, `src/sync/relais/entites.ts`), par une fusion déterministe, commutative et idempotente (même
résultat dans les deux sens, refusionner ne change rien : tous les appareils convergent, sans aller-retour). Si la
réunion diffère de la version du serveur, elle repart (`renvoyerFusions`, `coffreServeur.ts`) — y compris après un
conflit perdu au serveur (la version perdante reste dans son historique).

| Entité | Fusion |
| --- | --- |
| `journal:boite:<mois>` | union des événements |
| `kv:juridique.acceptations` | union par version des textes (la première date gardée) |
| `tsuzuku:titre:<anime\|movie>:<id>` | fiche à la plus récente, progression au maximum (ci-dessous) |
| `tsuzuku:historique` | union des épisodes vus (200 au plus, les plus récents) |
| `tsuzuku:fiabilite:<source>` | par lecteur, le résultat le plus récent |
| `tsuzuku:position:<titre>` | la plus récente |

## Documents légaux : acceptation par compte

Avant, l'acceptation (`juridique.acceptations`) restait sur chaque appareil : l'écran « Avant de commencer » revenait
sur chaque navigateur, et après chaque connexion par identifiant (base du navigateur neuve). Maintenant :

- elle est dans le coffre serveur du compte (`kv:juridique.acceptations` : version des textes et date, chiffrées),
  réunie par union entre appareils, avec la copie locale pour le hors ligne ;
- elle n'est redemandée que si la version des textes (`versionJuridique` : modèle + révision du Fondateur) n'a jamais
  été acceptée par le compte ;
- **pas d'écran trop tôt** : sur un appareil qui ne la connaît pas encore, l'app attend le premier tour de synchro
  (écran neutre « Ouverture de votre compte… », `acceptation-attente`, 10 s au plus, `DELAI_MAX_ATTENTE_ACCEPTATION_MS`)
  avant de décider ; rien ne clignote ;
- migration : un appareil qui gardait l'acceptation pour lui la remonte au premier tour (nouvelle clé synchronisée).

Tests : `src/sync/relais/acceptationJuridique.test.ts`, `src/app/juridiqueVerrou.test.tsx`, bout en bout
`scripts/e2e-tsuzuku-synchro.mjs`.

## Tsuzuku : tout dans le coffre serveur

| Donnée | Où (base chiffrée du profil, sauf mention) | Avant | Maintenant |
| --- | --- | --- | --- |
| Bibliothèque : titres, liste « à voir », favoris, notes, commentaires, statut, épisode courant (épisodes vus), « vu ailleurs » | `tsuzuku.bibliotheque` | un seul bloc `kv:tsuzuku.bibliotheque`, le dernier gagnant écrasait TOUTE la bibliothèque | un enregistrement par titre `tsuzuku:titre:*`, fusionné |
| Historique des épisodes vus | `tsuzuku.bibliotheque` (`history`) | dans le bloc | `tsuzuku:historique`, union |
| Liens manuels (motif d'épisodes, lien de film) | `tsuzuku.bibliotheque` (`manualSources`) | dans le bloc | `tsuzuku:liens:<anime\|movies>:<id>`, dernier gagnant |
| Position de lecture dans l'épisode | n'existait pas (mémoire vive, seulement pour changer de langue) | non | `tsuzuku.positions` → `tsuzuku:position:<titre>` (vidéo directe ; reprise sur un autre appareil) |
| Sources ajoutées, ordre, partage, dernier test, clés d'API et options | `tsuzuku.sources`, `.partages`, `.sources.tests`, `.avance` | oui (`tsuzuku:source:*`…) | inchangé |
| Sources partagées reçues | `tsuzuku.sources.partagees` | non (recopiées du canal de partage sur chaque appareil) | inchangé : régénérées par le canal `tsuzuku-sources` |
| Choix personnel d'une source partagée (activée ou non) | `tsuzuku.sources.choix` | **non** | `tsuzuku:choix:<source>` |
| Préférence VF / VOSTFR par série | `tsuzuku.langues` | **non** | `tsuzuku:langue:<série>` |
| Préférence VF / VOSTFR par défaut, épisode suivant auto, masquer les vus | `tsuzuku.reglages` | oui (`kv`) | inchangé |
| Fiabilité des lecteurs (lecteurs qui marchent en premier) | cache `tsuzuku.cache` (`fiabilite-lecteurs`) | **non** | `tsuzuku.lecteurs.fiabilite` → `tsuzuku:fiabilite:<source>` (reprise une fois du cache) |
| Titre choisi « chercher avec un autre titre » | `tsuzuku.recherche.titres` | oui (`kv`) | inchangé |
| Dernier mode ouvert (animés / films) | `tsuzuku.mode` | oui (`kv`) | inchangé |
| Paire de réception du partage | `tsuzuku.reception` | oui (`kv`, chiffrée) | inchangé |
| Catalogue (fiches, métadonnées), recherches sur les sources, lecteurs trouvés | cache `tsuzuku.cache` (600 Ko au plus) | non | **reste local** : public et régénérable ; le site profite déjà du cache du relais pour les pages des sources |
| Affiches | cache HTTP du navigateur / de l'app | non | **reste local** (régénérable, volumineux) |
| Temps de réponse des sites | cache `tsuzuku.cache` (`latences`) | non | **reste local** : mesure propre au réseau de l'appareil |
| Préchargement (intentions, épisode suivant) | mémoire vive | non | sans objet (rien de durable) |

**Progression : le maximum, pas le plus récent.** Deux appareils hors ligne : sur l'un on voit l'épisode 7, sur l'autre
(plus tard) le 4 → l'épisode 7 est gardé (le plus loin gagne : un épisode vu n'est jamais « dévu » par un appareil en
retard). Le maximum porte sur `(génération, épisode, date)` : corriger l'épisode à la BAISSE exprès ouvre une nouvelle
génération (`_sync.generation`), qui l'emporte. Statut, dates de visionnage et « vu ailleurs » suivent la progression
gagnante ; la fiche (note, favori, commentaire…) suit la modification la plus récente (`_sync.fiche`). Les
estampilles sont posées par `DepotBibliotheque.modifier` (`src/tsuzuku/moteur/fusionBibliotheque.ts`). Titres
d'avant les estampilles : la progression la plus avancée gagne, et chacun garde ce qu'il sait (favori, note…).

**Migration (premier lancement de cette version).** Les données locales de chaque appareil entrent dans la file et
sont fusionnées dans le coffre, titre par titre (même titre = même identifiant : pas de doublon ; historique réuni) ;
l'ancien bloc `kv:tsuzuku.bibliotheque` déjà sur le serveur, ou encore envoyé par un appareil pas à jour, est fusionné
de la même façon (avant les suppressions reçues, pour qu'un titre supprimé ne renaisse pas). Il n'est plus émis, et sa
disparition n'est jamais diffusée comme une suppression (`ENTITES_RETIREES`). Une bibliothèque locale illisible n'est
pas prise pour une bibliothèque vide : rien n'est supprimé ailleurs, et la version du serveur la répare.

**Limites.** Un appareil pas encore à jour ne reçoit plus les changements de bibliothèque faits ailleurs (il lit
l'ancien bloc) : mettez à jour tous les appareils. Deux sources identiques ajoutées séparément sur deux appareils
(identifiants différents) restent deux sources.

Tests : `src/sync/relais/synchroTsuzukuDonnees.test.ts` (fusion bibliothèque, progression, recul, historique,
sources, migration, ancien bloc, bibliothèque illisible), `src/tsuzuku/app/fiabiliteLecteurs.test.ts` ; bout en bout
`scripts/e2e-tsuzuku-synchro.mjs` (captures `docs/captures-tsuzuku-synchro/`).

## Autres apps du hub : données restées locales (corrigé)

| Donnée | Avant | Maintenant |
| --- | --- | --- |
| Claude Office : personnalisation des agents (écran « Équipe » : surnom, couleur, accessoire, favori) — `claude-office.equipe` | sur l'appareil seulement | `kv:claude-office.equipe` |
| Documents légaux acceptés — `juridique.acceptations` | sur l'appareil seulement | `kv:juridique.acceptations` (union) |

Déjà synchronisés (vérifié) : Portefeuille (comptes, titres, opérations, watchlist, carnet, objectifs), Tâches (espace
perso, pilote ; données du Fondateur et partages sur leur canal), Journal (pages, boîte, réglages), Prospects et
Abonnements (canal d'administration), Claude Office (notes, alertes, préférences ; historique et présence sur leur
canal), réglages du hub (tuiles, disposition) et thème unique.

## Compatibilité et déploiement

- `/sante` annonce `version: 10`, et `coffre-serveur`, `coffre-v10`, `avis` **seulement si le serveur a son magasin PostgreSQL**. Un appareil à jour face à un relais qui ne
  l'annonce pas garde l'ancienne synchronisation (ci-dessous) : rien ne casse pendant le déploiement.
- Un appareil pas encore à jour continue de déposer dans `/boite/<appareil>` : ses changements sont fusionnés par les
  appareils à jour. L'inverse n'est pas vrai : **mettez à jour tous les appareils**.
- Tables PostgreSQL (créées seules au démarrage du relais) : `relais_coffre`, `relais_coffre_rev`,
  `relais_coffre_historique` (`relais/serveur/coffres-postgres.mjs`). Valeurs en `TEXT` (enveloppes JSON en base 64,
  8 Mio au plus chacune ; un envoi : 48 Mio au plus).

Tests : `relais/coffre-serveur.test.mjs` (aussi contre PostgreSQL : `npm run relais:tester:pg`),
`src/sync/relais/coffreServeur.test.ts`, `bureau/connexionV9.test.ts` ; bout en bout :
`scripts/e2e-synchro-serveur.mjs` (captures `docs/captures-synchro-serveur/`).

---

# Ancienne synchronisation (relais d'avant la version 9, ou sans PostgreSQL)

Ce qui suit décrit l'ancienne boîte par appareil, gardée pour la transition.

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
| `tsuzuku:source:<id>`, `tsuzuku:partage:<id>`, `tsuzuku:test:<id>`, `tsuzuku:ordre`, `tsuzuku:avance` (2) | sources Tsuzuku du compte (définition et état activé, partage, dernier test, ordre de la liste, clés d'API et options du moteur) — `src/sync/relais/entitesTsuzuku.ts` | dernier gagnant **par source**, suppression = pierre tombale datée ; chaque entité reçue est revalidée (adresse publique, bornes). Un appareil qui ne connaît pas le genre l'ignore |

Les sources Tsuzuku ne passaient autrefois par aucune entité : ajoutées sur le PC, elles n'arrivaient jamais sur le
site ou le téléphone du même compte. Elles partent maintenant ~3 s après chaque modification (clés de
`PARAMETRES_A_SYNCHRONISER`), dans la charge scellée (`cleDerivee('synchro')`) : le relais ne voit ni adresse de source
ni clé d'API en clair. La page Sources affiche une pastille « Synchronisé / En attente » (`etatPastilleTsuzuku`).
Limite : un Fondateur autre que le compte historique synchronise sa base comme un fichier entier (fichiers d'un ami,
dernier gagnant au niveau du fichier) ; aucun changement du relais n'est nécessaire (rien de neuf côté relais : tout
voyage dans `/boite/<appareil>`, réservé au jeton maître, et `tsuzuku-sources` reste interdit en écriture aux jetons de
profil).

Après « Lier » (`adopterCoffre`), la base locale est vide (l'ancienne est scellée par une autre clé) : les versions
vues reviennent par le premier tour, et le devblog attend ce premier tour avant de décider de s'afficher.

## Déclencheurs (`src/sync/relais/planificateur.ts`, branchés dans `src/app/synchroApp.ts`)

Ouverture après déverrouillage · retour au premier plan (`visibilitychange`, `focus`, AppState `active`) · événement
`online` · ~3 s après une écriture locale (`Session.surEcriture`, `src/db/ecoute.ts`) · toutes les 2 min · `pagehide` et
page masquée : dépôt `fetch` avec `keepalive` (`deposerAvantFermeture`) · après un échec : réessais à 5 s, 30 s, 2 min,
10 min (le tic de 2 min se tait pendant ces paliers). Un seul tour à la fois ; une demande arrivée pendant un tour
en déclenche un nouveau. Le tour ne tourne toujours que déverrouillé et pour l'administrateur ; avant le déverrouillage,
le préchargement (section suivante) fait déjà le travail réseau sur des enveloppes chiffrées.

## Préchargement au démarrage (`src/sync/relais/caches.ts`, `prechargement.ts`)

La configuration du relais et la clé de synchro vivent dans la base chiffrée du profil : aucun dépôt ne s'ouvre avant
le déverrouillage. Le **travail réseau**, lui, peut commencer dès le lancement, sur des enveloppes chiffrées :

1. **Au lancement, sans clé** (`Prechargeur`, démarré par `bureau/index.tsx` — PC, y compris au démarrage de Windows
   avec `--demarrage`, fenêtre réduite près de l'horloge, et site de secours). Liaison utilisée : celle de
   l'administrateur **déjà connue** de l'appareil (code retenu par le navigateur — `applibourse.liaisons` —, ou
   `relais-local.json` lu par le processus principal, `relais:config`), la même que pour Yahoo et les médias. Un jeton
   de profil d'ami (`p1.…`) n'est jamais utilisé : `/boite` est réservée au jeton maître, et le préchargement s'arrête
   avant tout appel. Un passage : `GET /boite` (index) → `GET /boite/<appareil>` pour chaque dépôt plus récent que ce
   qui est déjà fusionné (`lus`) ou déjà en cache → cache **`entrant`** ; puis `PUT /boite/<moi>` de l'enveloppe du
   cache **`sortant`**, si elle existe. Relancé au retour du réseau (`online`), après un échec (5 s, 30 s, 2 min,
   10 min) et toutes les 5 min tant que l'appareil reste verrouillé ; suspendu pendant une session déverrouillée
   (`Session.surOuverture` / `surFermeture`).
2. **Pendant une session déverrouillée** (`preparerSortant`, branché dans `useSynchro`) : après chaque tour, ~2 s après
   chaque écriture, à `pagehide` et juste avant le verrouillage, si la file `enAttente` n'est pas vide, la charge est
   scellée (exactement comme un dépôt) et rangée dans `sortant` avec sa date et son empreinte ; file vide → `sortant`
   vidé. `noterLus` recopie dans `entrant` les dates déjà fusionnées, pour que le démarrage ne retélécharge rien.
3. **Au déverrouillage** (`integrerEntrant`, abonné à `Session.surOuverture`, donc **avant** la première image) : les
   enveloppes d'`entrant` sont ouvertes avec la clé et fusionnées (même code que le tour réseau : `appliquerDepot`), de
   façon synchrone ; le thème, les tuiles et les données reçus sont dans la base quand le hub relit ses préférences
   (`useLayoutEffect`). Le cache est vidé, `lus` avance (le tour réseau qui suit ne retélécharge pas). Un envoi fait sans
   clé au démarrage est reporté dans l'état chiffré (`dernierEnvoi`, `dernierDepotLe`) : pas de second PUT identique.

**Budget d'écritures** : aucun PUT sans enveloppe en attente ; jamais deux dépôts à moins de 30 s
(`dernierDepotLe`, recopié dans `sortant`) ; une enveloppe plus ancienne que le dépôt de cet appareil déjà indexé
(envoi `keepalive` de fermeture, tour réussi) est abandonnée sans PUT ; réessais espacés. Les lectures restent
minimes : un `GET /boite` toutes les 5 min au plus pendant que l'appareil est verrouillé.

**Ce qui est sur le disque, en clair ou chiffré.** Fichiers logiques par profil, dans la liste fermée du processus
principal (`synchro-entrant`, `synchro-sortant`, `synchro-entrant-<id>`, `synchro-sortant-<id>` →
`synchro-*.json` dans `donnees/` ; IndexedDB sur le site ; en mémoire seulement dans l'app native) :

| Donnée | Forme |
| --- | --- |
| Contenu des dépôts (portefeuille, thème, tuiles, devblog vu…) | **chiffré** (XChaCha20-Poly1305, clé de synchro jamais écrite hors de la base chiffrée) |
| Enveloppe : identifiant aléatoire de l'appareil, date, nonce | en clair (déjà visibles sur le relais) |
| `lus` (date du dernier dépôt fusionné par appareil), `dernierDepotLe`, essais, empreinte de la charge | en clair |
| Liaison | seulement une **empreinte** SHA-256 de `relais|jeton` (sert à purger le cache si le relais change) ; ni jeton, ni clé, ni mot de passe |

Chaque enveloppe est revérifiée à l'écriture **et** à la lecture (`enveloppeSure` : champs connus seulement, nonce
hexadécimal, charge en base 64, appareil `[0-9a-f]{8}`) ; une charge en clair (le coffre, déposé en JSON) est refusée.
Bornes : 8 Mio par enveloppe, 12 appareils dans `entrant` (une enveloppe par appareil, la plus récente), 2 dans
`sortant`. Tests : `src/sync/relais/prechargement.test.ts` (fichiers écrits inspectés : ni contenu, ni clé, ni jeton).

**Thème avant déverrouillage.** L'écran de connexion garde le cache déjà en place (dernier thème appliqué, par profil,
`applibourse.affichage`). Un thème reçu dans `entrant` mais pas encore fusionné **n'est pas** appliqué avant le
déverrouillage : il est chiffré, et le lire exigerait la clé. Il s'applique dès la première image après le
déverrouillage, puis devient le thème mémorisé pour les lancements suivants.

**Écran de connexion.** Une ligne discrète (`LigneSynchroDemarrage`, `testID="synchro-demarrage"`) : « N mises à jour
reçues, en attente de déverrouillage », « N éléments prêts à envoyer », « Synchronisé il y a X min ». L'état
(`applibourse.synchro.demarrage`) est **global à l'appareil** et ne contient que deux compteurs et une date : le même
texte s'affiche quel que soit le prénom saisi (vrai compte ou leurre), il ne dit rien d'un compte.

**Scénario de bout en bout** : `scripts/e2e-demarrage.mjs` (faux relais exécutant `relais/relais.mjs`, deux
appareils), captures dans `docs/captures-demarrage/` : B change le thème et crée un compte pendant que A est fermé ;
A démarre verrouillé (« 1 mise à jour reçue, en attente de déverrouillage ») ; A se déverrouille relais coupé : Ivoire
dès la première image du hub, compte présent ; A change le thème relais coupé, redémarre (« 1 élément prêt à
envoyer ») ; le relais revient : l'envoi part seul, A toujours verrouillé, et B reçoit le thème.

**Isolation et nettoyage.** Un profil ne lit que ses fichiers (`nomFichierCache`, et `fichierAutorise` côté Electron :
un ami n'atteint ni `synchro-*` de l'administrateur, ni ceux d'un compte qu'il gère) ; seul le cache de
l'administrateur (`principal`) est rempli avant le choix d'un compte. Relais ou jeton changé → caches ignorés puis
vidés ; « Désactiver » la synchronisation ou relier ce navigateur à un autre compte → caches vidés ; appareil oublié
(ici ou du relais) → son enveloppe retirée d'`entrant`. Les anciens appareils ne voient aucune différence (mêmes
dépôts, même format). Limites : l'app iPhone garde ces caches en mémoire seulement (pas de préchargement à froid) ;
les comptes d'amis ne synchronisent pas par `/boite` et ne sont pas concernés.

## Ordre de déploiement (compatibilité)

1. La charge porte `version` (2) et l'appareil déclare `versionCharge`. Une charge sans version = ancien format, lue
   inchangée. Un genre inconnu est ignoré sans erreur ni date enregistrée (`ecrireEntite` renvoie `false`).
2. **Garde d'émission** : un appareil n'émet `prefs:*` et `devblog:*` que si **tous** les autres appareils de l'index
   du relais sont connus et déclarent la version 2. Tant qu'un appareil ancien traîne (ou qu'un dépôt est illisible),
   ces entités ne partent pas ; « Oublier » l'appareil périmé (Paramètres › Synchronisation) lève le blocage.
3. Il suffit donc de mettre à jour les appareils dans n'importe quel ordre ; les préférences se mettent à circuler
   dès que le dernier est à jour. Un ancien appareil qui recevrait quand même un genre récent l'ignore (au pire il
   garde une date inutile pour cette clé).

## Budget d'écritures de l'ancienne boîte (historique : levé depuis PostgreSQL, voir plus haut)

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

Chaque dépôt porte désormais ses métadonnées (`{ date, taille }`) et l'index (`index` pour les appareils,
`p:<id>:~index` pour un espace de compte) est **réparé à partir de la liste de la boîte** au plus une fois par heure (six heures pour
un espace) : une entrée perdue par deux dépôts simultanés revient seule. Un dépôt coûte toujours 2 écritures (valeur + index).
La réparation côté client (redépôt si absent de l'index, une fois par heure) reste en place pour les relais pas encore
redéployés. Tests : `relais/relais.test.mjs` (« course sur l'index… »).

## Portées du relais (version 2)

| Jeton | Forme | Ouvre |
| --- | --- | --- |
| **maître** (administrateur) | tiré au déploiement (`env.JETON`) | tout : routes historiques `/boite…`, tous les espaces `/p/<id>/…`, passerelle |
| **de profil** (un ami) | `p1.<id>.<HMAC-SHA256(JETON, « applibourse-profil-v1\|<id> »)>` | SON espace `/p/<id>/boite[/<nom>]` et la passerelle Yahoo/médias ; rien d'autre (403) |
| **de profil d'un titulaire** (Administrateur, Fondateur autre que le compte historique) | le même `p1.<id>.…` | son espace, plus — par **délégation** publiée par le compte historique (`PUT /rangs`) — la liste, le `coffre` et le `portefeuille` (lecture, écriture) des comptes de rang strictement inférieur ; jamais `principal`, jamais l'`annuaire` ou le `compte` d'un autre, jamais de suppression |

- Le relais recalcule le HMAC à chaque appel (rien à stocker) ; l'administrateur fabrique le jeton d'un ami hors ligne
  avec le même calcul (`src/sync/relais/portees.ts`). Aucun jeton de profil n'existe pour `principal`.
- Lecture d'un espace : son titulaire ou l'administrateur. Écriture et suppression : l'administrateur pour tout, le
  titulaire pour ses **données propres seulement** (voir « Qui peut écrire quoi »). Un autre jeton reçoit **403, que
  l'objet existe ou non** (pas de 404 révélateur).
- Rétrocompatible : les routes `/sante`, `/boite`, `/boite/<appareil>` sont inchangées pour le jeton maître ; les anciens
  appareils continuent de fonctionner sans mise à jour.
- **Rangs (version 3 du relais)** : `GET`/`PUT /rangs` (jeton maître seulement) lit/publie
  `{ delegations: { <titulaire>: [<ids inférieurs>] } }` (clé `rangs` de la boîte, validée : identifiants, jamais
  `principal` ni le titulaire lui-même). Le relais la relit à chaque accès croisé (1 lecture). Le compte
  historique la republie quand elle change (`delegationsDe`, `bureau/synchroComptes.ts`) — rien tant
  qu'aucun titulaire n'existe (un relais pas encore redéployé ne produit donc aucune erreur). Une
  rétrogradation retire la délégation au tour suivant : l'accès cesse aussitôt (403).

## Lecture des sources de Tsuzuku pour le site (version 5 du relais)

- `POST /tsuzuku/requete` (`relais/tsuzuku.mjs`) : **jeton maître seulement** (compte Fondateur historique,
  celui du code de liaison du PC). Tout jeton de profil — Ami, Gestionnaire, Administrateur, autre Fondateur —
  reçoit 403 : le relais ne connaît pas d'autre liste de Fondateurs (`/rangs` ne porte que des délégations).
- CORS **restreint** aux origines `ORIGINES_SITE` (variable non secrète de `relais.env`, par défaut
  https://appdashboard.fr et www, la même adresse que `src/config/site.json`) ; préliminaire `OPTIONS` propre à cette route ; les autres routes gardent
  leur CORS (`*`) et leur comportement. Rien n'est écrit dans la boîte (débit compté en mémoire du serveur).
- Règles de sécurité, limites et erreurs : `src/tsuzuku/README.md` (« Site web : lecture par le relais »).
- Un relais d'avant la version 5 répond 404 : le site affiche « mettez à jour le relais ».

**Passerelle Yahoo / médias (`/yahoo/*`, `/medias/*`) : inchangée.** Tout jeton valable (maître ou de profil)
peut s'en servir, et c'est voulu : un ami ouvre son portefeuille (cours) et les actualités sur le site, qui
passent par là. Elle reste bornée aux listes fermées d'hôtes de `bureau/electron/reseau.mjs` (Yahoo Finance,
flux et pages des médias connus) : ce n'est pas un proxy ouvert. La restreindre au jeton maître casserait les
comptes d'amis existants ; elle n'est donc pas modifiée.

## Invitations et connexion des amis (version 6 du relais)

Parcours complet, messages et limites : **`docs/connexion-amis.md`**. En bref : `PUT/DELETE /invitations/<id>`
(jeton maître), `GET /invitations/<id>` et `POST /invitations/<id>/utiliser` **sans jeton** (contenu scellé par une
clé tirée du secret du lien, usage unique, expiration, une seule invitation active par compte),
`PUT/DELETE /acces/<h>` (le compte, pour l'identifiant que le Fondateur lui a attribué) et `GET /acces/<h>`,
`POST /acces/<h>/ouvrir` **sans jeton** (preuve tirée du mot de passe, délai progressif par identifiant et par adresse
IP), `PUT/DELETE/GET /revocations/<id>` (jeton maître : le jeton de profil est refusé partout, 403 `revoque`).
Clés de la boîte : `inv:<id>`, `inv-profil:<compte>`, `acces:<h>`, `acces-proprio:<h>`, `limite:acces:<h>`, `revoque:<compte>`.
Le relais n'y voit ni mot de passe, ni clé, ni jeton d'ami en clair. Les routes d'avant sont inchangées ; un relais pas
encore redéployé fait passer les invitations en mode « lien » (contenu dans le lien) et le site l'annonce.

## Ce qui est publié, et qui peut le lire

| Objet | Contenu | Chiffrement | Lisible par |
| --- | --- | --- | --- |
| `/boite/<appareil>` | portefeuille de l'administrateur (entités) | `cleDerivee('synchro')` de l'administrateur | jeton maître |
| `/boite/coffre` | coffre de l'administrateur (enveloppes) | Argon2id du mot de passe (comme sur disque) | jeton maître |
| `/p/principal/boite/annuaire` | annuaire découpé pour la fusion (empreintes salées, prénoms scellés, accès, séquestres scellés, politique des apps) | déjà opaque, **aucun prénom en clair** (testé) | jeton maître **seulement** |
| `/p/principal/boite/admin` | données d'administration (réglages, notes, journal, connexions vues, robustesse, abonnements, carnet Prospects — voir `docs/prospects.md`) | enveloppe scellée par `cleDerivee('synchro')` | jeton maître, et seul l'administrateur l'ouvre |
| `/p/<id>/boite/annuaire` | **projection** de l'ami : son entrée, le sel, la politique des apps, la clé PUBLIQUE de séquestre | opaque | l'ami (son code) et l'administrateur |
| `/p/<id>/boite/annuaire` (titulaire) | **projection par rang** : son entrée (sa paire et son bloc privé, scellés par SA clé) et les comptes de rang STRICTEMENT inférieur (empreinte, prénom scellé, accès, SON séquestre). Rien d'un Fondateur ni d'un autre Administrateur, ni registre, ni clé commune, ni bloc privé / empreinte / clé privée du compte historique (testé) | opaque | le titulaire (son code) et le compte historique |
| `/rangs` (clé de la boîte) | délégations des titulaires (identifiants seulement) | aucun secret | jeton maître |
| `/p/<id>/boite/coffre`, `…/portefeuille` | fichiers de l'ami tels que sur disque | coffre : Argon2id ; portefeuille : clé maîtresse de l'ami | l'ami et l'administrateur (qui ne peut pas les ouvrir) |
| `/p/<id>/boite/compte` | ce que l'ami renvoie : suivi de connexion (scellé pour l'administrateur), dépôt de séquestre (scellé), invitation acceptée ; pour un titulaire, aussi sa paire et son bloc privé, SES séquestres (conversions, codes, révocations), ses modifications d'accès et son journal (scellé pour le compte historique) | scellés | le titulaire (ou l'ami) et le compte historique |
| `/p/<id>/boite/tsuzuku-cle` | clé PUBLIQUE X25519 de réception des sources Tsuzuku (la privée reste dans la base du compte) | aucun secret | le compte (qui l'écrit) et le compte historique |
| `/p/<id>/boite/tsuzuku-sources` | SES sources Tsuzuku partagées (ni autre compte, ni clé d'API) | ECIES X25519 + XChaCha20-Poly1305 pour sa clé, usage lié à son identifiant | écrit/effacé par le jeton maître SEUL (le relais refuse PUT/DELETE d'un jeton de profil) ; lu par le compte |
| `/p/principal/boite/taches` | données de l'app Tâches du Fondateur (voir `docs/taches.md`) | enveloppe scellée par `cleDerivee('synchro')` | jeton maître, et seul le Fondateur l'ouvre |
| `/p/<id>/boite/taches` | projets Tâches partagés avec CET ami (et la clé de partage) | ECIES X25519 + XChaCha20-Poly1305 pour sa clé de réception (`tsuzuku-cle`), usage `taches|<id>` | écrit/effacé par le jeton maître SEUL ; lu par le compte |
| champ `taches` de `/p/<id>/boite/compte` | tâches modifiées par l'ami dans les projets partagés en écriture | XChaCha20-Poly1305 par la clé de partage | écrit par l'ami (son retour), lu et revérifié par le Fondateur |
| `/p/<id>/boite/abonnement` | SA ligne d'abonnement (`projectionPour`) : mode, échéance, jours d'avance, rappel activé, message déjà rédigé. Ni notes privées, ni paiements, ni autre compte | aucun secret (rien d'autre que ce qui s'affiche chez lui) | écrit/effacé par le jeton maître SEUL ; lu par le compte |

**Coffre et portefeuille d'un ami vont ensemble** (correctif d'octobre 2026, voir `docs/connexion-amis.md`, « Base
d'un appareil scellée par une autre clé ») : ce sont deux fichiers « le plus récent gagne », mais le portefeuille est
scellé par la clé maîtresse que le coffre ouvre. Un appareil n'envoie plus son portefeuille tant que le coffre a changé
sur le serveur depuis son dernier échange ; à l'ouverture, une base d'ici qui ne s'ouvre pas avec la clé du coffre
cède la place à la copie du serveur si celle-ci s'ouvre, sinon l'écran propose « Reprendre mes données du serveur »
(base neuve, remplie par le coffre serveur) ; l'ancienne est mise de côté (`ecarte-portefeuille-<id>`), jamais
effacée. Un verrouillage moins de 400 ms après une écriture ne la perd plus.

L'annuaire complet n'est **jamais** déposé dans un espace lisible par un ami.

## Qui peut écrire quoi

Règle du relais (`OBJETS_DU_COMPTE`, `relais/relais.mjs`, même liste dans `src/sync/relais/espaces.ts`) : dans son
espace, un jeton de profil n'écrit (`PUT`) ni n'efface (`DELETE`) **que** `coffre`, `portefeuille`, `compte` et
`tsuzuku-cle`. Tout autre nom — objets publiés par l'administrateur, et tout nom inconnu ou futur — répond **403**
pour lui ; seul le jeton maître l'écrit. La lecture (`GET`, liste) de son espace reste ouverte au compte.

| Objet (espace `p/<id>/`) | Écrit par | Qui doit pouvoir écrire / effacer | Relais avant (v3) | Relais maintenant |
| --- | --- | --- | --- | --- |
| `annuaire` (projection, politique des apps, rangs inférieurs d'un titulaire) | administrateur | **administrateur seul** | ami : PUT/DELETE **acceptés** (faille) | ami : 403 ; délégué : 403 |
| `abonnement` (statut, échéance, message) | administrateur | **administrateur seul** | ami : PUT/DELETE **acceptés** (faille signalée) | ami : 403 ; délégué : 403 |
| `tsuzuku-sources` (sources partagées) | administrateur | **administrateur seul** | ami : 403 (déjà) | ami : 403 ; délégué : 403 |
| tout autre nom (inconnu, futur) | — | **administrateur seul** | ami : accepté | ami : 403 |
| `coffre`, `portefeuille` | l'ami (ses données), l'administrateur (sauvegarde), un titulaire délégué | ami propriétaire + administrateur ; titulaire délégué : lecture/écriture, jamais suppression | idem | idem (inchangé) |
| `compte` (retour : suivi, séquestre, invitation, actions d'un titulaire) | l'ami | ami propriétaire (+ administrateur pour le vider à la suppression du compte) | idem | idem (inchangé) |
| `tsuzuku-cle` (clé PUBLIQUE de réception) | l'ami | ami propriétaire (+ administrateur à la suppression) | idem | idem (inchangé) |
| liste de l'espace (`GET /p/<id>/boite`) | — (lecture) | ami, administrateur, titulaire délégué | idem | idem, avec l'estampille `auteur` |
| `p/principal/*` (`annuaire` complet, `admin`) | administrateur | **administrateur seul** (aucun jeton de profil n'existe pour `principal`) | 403 pour tout jeton de profil | idem |
| `/rangs` (délégations) | administrateur | **administrateur seul** | 403 pour tout jeton de profil | idem |
| `/boite…` (portefeuille et coffre de l'administrateur) | administrateur | **administrateur seul** | 403 pour tout jeton de profil | idem |

**Estampille d'auteur.** Chaque dépôt dans un espace est estampillé PAR LE RELAIS (`auteur` : `maitre`, `compte`
ou `delegue`, selon le jeton présenté ; une valeur envoyée par l'appareil est remplacée), dans l'enveloppe relue et
dans la liste de l'espace (métadonnée de la boîte). Il n'existe pas de primitive de signature de l'administrateur pour ces
objets (la clé ed25519 existante ne signe que les mises à jour ; la clé de séquestre est une clé de chiffrement
X25519, qu'un ami ne peut pas vérifier) : l'estampille du relais en tient lieu.

**Côté administrateur** (`synchroniserComptesAdmin`) : il ne LIT dans l'espace d'un ami que `compte` (filtré par
`appliquerRetourAmi` : jamais un accès, un rang ni un abonnement), `coffre`, `portefeuille` et `tsuzuku-cle`. La
projection d'annuaire, l'abonnement et les sources partagées y sont seulement écrits : **jamais fusionnés** dans sa
base, qui reste la seule source de vérité (testé : une ligne `abonnement` falsifiée ne change rien à ses données).
S'il trouve l'un de ses dépôts effacé ou estampillé par un autre que lui (`depotAltere`), il le réécrit au tour
suivant.

**Côté ami** (`synchroniserCompteAmi`, `preparerLiaison`, `recevoirSourcesPartagees`) : une projection, une ligne
d'abonnement ou des sources partagées estampillées par un autre que `maitre` sont **ignorées** (la valeur
précédente reste). Sans estampille (relais pas encore redéployé, ou dépôt d'avant), l'objet est lu comme avant.

**Limites.**
- Sur un relais d'avant cette version, un ami pouvait encore écrire ces objets et aucune estampille n'existait :
  c'est la mise à jour du relais qui a fermé la faille.
- L'estampille repose sur le relais : un relais compromis (ou le détenteur du jeton maître) peut tout écrire.
- Un ami qui modifie SON appareil (stockage du navigateur, code) peut changer SON affichage (se voir « À jour »,
  masquer le rappel) : cela ne change **rien** au statut réel, tenu dans la base chiffrée de l'administrateur, ni
  à ce que voient ses autres appareils.
- Compatibilité : les anciens appareils n'écrivent jamais ces objets avec un jeton de profil ; ils ignorent le
  champ `auteur` (enveloppe et liste). Le relais redéployé accepte toujours les dépôts d'avant (sans estampille).

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
  gagnant ; connexions déjà reportées au maximum par compte ; `prospect:<id>` et `prospects-modeles` (app Prospects) au
  dernier gagnant, une fiche supprimée voyage comme suppression datée.
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

0. **Ami** : il ouvre son **lien d'invitation** (ou, sur un appareil suivant, « Se connecter » avec son prénom et son
   mot de passe) — voir `docs/connexion-amis.md`. Le code de liaison ci-dessous reste la méthode de l'administrateur
   (et la méthode de secours d'un ami).
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

Tests : `relais/relais.test.mjs`, `bureau/synchroComptes.test.ts`, `bureau/rangsRelais.test.ts`,
`bureau/AccueilSite.test.tsx`, `src/sync/relais/fusionLww.test.ts` ; bout en bout : `scripts/e2e-site-connexion.mjs`
(captures dans `docs/captures-connexion/`) et `scripts/e2e-rangs.mjs` (rangs : `docs/captures-rangs/`).
