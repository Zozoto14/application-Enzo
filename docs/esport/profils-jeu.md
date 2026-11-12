# Profils de jeu et assistant IA

Chaque jeu a ses règles : Valorant se joue en 5v5, 13 rounds gagnants avec changement de côté après 12 rounds ;
The Finals en 3v3 ou en 3v3v3v3 avec un classement ; les maps et les personnages ne sont pas les mêmes. Un **profil
de jeu** décrit tout cela **avant** la création d'une team. Les modules (Strats, Playbook, Ressources, Scouting) lisent
ensuite les maps et personnages du profil du jeu de la team, et les modules Tournois / Résultats s'appuient
sur ses formats et son système de score ([tournois-resultats.md](tournois-resultats.md)).

Page : **Esport › Administration › Jeux** (le Fondateur, et les comptes à qui il confie la gestion). Migration : `0021_profils_jeu.sql`.

## Ce que contient un profil

| Partie | Contenu |
| --- | --- |
| Le jeu | Nom, clé (adresse unique, ex. `the-finals`), couleur, icône (adresse https facultative), **modèle de strat** (`valorant`, `thefinals`, `generique` : l'éditeur de strats des teams du jeu, voir [strats.md](strats.md)) |
| Formats de match | Taille des équipes et nombre d'équipes en même temps (5v5 = 2 × 5 ; 3v3v3v3 = 4 × 3), BO joués (1, 2, 3, 5, 7) |
| Système de score | **Rounds** (rounds pour gagner, rounds par mi-temps, prolongations, leur règle et l'écart qui les termine, 2 par défaut), **points** (points pour gagner), **classement** (barème de points par place, jeux à plusieurs équipes), **manches** (manches pour gagner), notes |
| Modes de jeu | Nom, description, formats où ils se jouent, joué en compétition ou non |
| Maps | Nom, image facultative, **dans le pool** ou retirée, modes ; **détails** : image **déposée** (vue de dessus, PNG / JPEG / WebP, 12 Mo), **calibrage** (deux points et leur distance réelle → unités par mètre), **callouts** (zones nommées tracées en polygones), **repères** (sites, spawns attaque / défense, cashouts, coffres, plant…), **étages** |
| Classes et personnages | Rôles des personnages (Duelliste, Light…) ; agents / champions / builds avec leur classe, jouables ou non ; **capacités** (touche, catégorie, forme, rayon, longueur, largeur, ouverture, portée en mètres, durée, charges, coût, courbable, « à vérifier ») |
| Roster | Titulaires et remplaçants |
| Rôles des joueurs | Postes propres au jeu (IGL, Entry, Support…) |
| Champs libres | Toute autre donnée : texte, nombre, oui/non, liste |
| Mots du jeu | « Agents », « Champions »… |
| Pages de référence | Pages publiques (https) que l'IA relit pour proposer des mises à jour |

Modèle : une table `jeux` (en-tête + données JSON) **validée par schéma** côté serveur
(`esport/noyau/jeux/schema.mjs` : champs inconnus jetés, textes bornés, nombres dans leurs limites, clés uniques,
références nettoyées, images en https vers un site public seulement).

**Versions** : chaque enregistrement crée une version (table `jeu_versions` : données complètes, auteur, motif, résumé
des ajouts / modifications / retraits). La fiche d'un jeu montre l'historique ; **Restaurer** une ancienne version en
crée une nouvelle (rien n'est effacé). Deux personnes qui modifient le même profil en même temps : la seconde reçoit
« modifié entre-temps, rechargez-le » (rien n'est écrasé).

**Maps et capacités précises** (migration 0075) : dans la fiche d'un jeu, chaque map a « Détails de la map » (image,
plan avec callouts, repères et calibrage, étages) et chaque personnage ses « Capacités ». Le plan s'édite sur le site et
l'app PC. Aucune image officielle n'est livrée : **importez les vôtres** (« Importer une image… ») ; elles sont rangées
dans le stockage du serveur (table `jeu_images`, comme les fichiers du Drive) et lues par lien signé (6 h). Ces données
sont **propres au club** : l'assistant IA ne les reçoit pas et ne peut ni les proposer ni les effacer (brouillons et
mises à jour les gardent).

**Importer les images et l'échelle** (fiche du jeu, `POST /jeux/:cle/importer`) : le SERVEUR télécharge les images
dans son stockage, avec leur source (fournisseur, adresse, date, empreinte) :
- **Valorant** : API communautaire publique valorant-api.com (`/v1/maps`) : minimap (`displayIcon`), échelle calculée
  depuis `xMultiplier` (1 m = 100 unités du jeu : unités par mètre = |xMultiplier| × 100 × 1000), callouts
  (`regionName`, `superRegionName`, `location` → repères : sites, spawns, callouts). Les maps de compétition absentes
  du profil sont ajoutées **hors du pool** (à cocher) ;
  Vérifié sur l'API réelle (2026-11) : les maps hors compétition (Gauntlet, The Range, Skirmish, entraînement) ont
  `displayIcon` nul et des multiplicateurs à 0, les maps de Team Deathmatch des multiplicateurs à 0 : écartées ; les
  deux spawns s'appellent « Attacker Spawn » et « Defender Spawn », les callouts du milieu « Mid … » ;
- **The Finals** : import direct par adresses https saisies (une par map) ; préférez « Maps proposées » ci-dessous ;
  échelle **approximative** par défaut (1000 unités ≈ 250 m), marquée « à vérifier ».
Sécurité : https vers un site public (Valorant : `valorant-api.com`, `media.valorant-api.com` seulement), aucune
redirection suivie, 15 s, 10 Mo par image, type annoncé et contenu vérifiés. Idempotent : une image inchangée n'est
pas re-déposée, les callouts importés sont remplacés, un calibrage fait à la main et une image déposée à la main sont
gardés (case « Remplacer aussi les images déposées à la main » pour forcer).

**Maps proposées** (fiche du jeu, carte « Maps proposées », Valorant et The Finals) : le serveur PRÉPARE les maps,
le gestionnaire les VALIDE ; **rien n'est appliqué au profil avant la validation**.
- **The Finals** : wiki communautaire THE FINALS Wiki (wiki.gg, MediaWiki), API `https://www.thefinals.wiki/w/api.php` :
  arènes de la catégorie `Category:Arenas` ; variantes et modes lus dans `Template:ArenaVariantData` (une arène
  sans aucun mode Cashout n'est pas proposée : ancienne Las Vegas, Practice Range, arènes d'événement) ; **pool
  compétitif suggéré** si « Ranked Cashout » ; image : la **vue de dessus** de la section « Overview » de la page
  (`{{Infographic|Image=…}}`), sinon l'illustration de l'arène (signalée « pas de vue de dessus ») ; licence lue
  dans `meta=siteinfo` (aujourd'hui Creative Commons Attribution-ShareAlike 4.0) et **attribution enregistrée**
  avec l'image (« Source : THE FINALS Wiki (wiki.gg), page « Monaco » ; textes sous licence … ») ; échelle
  **approximative** (1000 unités ≈ 250 m), à vérifier ; aucun repère ni étage (le wiki n'en donne pas les
  coordonnées). Vérifié sur le wiki réel (2026-11) : 11 arènes proposées (Bernal, Fangwai City, Fortune Stadium,
  Galaxy Estates, Kyoto, Las Vegas Stadium, Monaco, NOZOMI/CITADEL, Seoul, Skyway Stadium, SYS$HORIZON), toutes
  avec image, dont 10 vues de dessus (Las Vegas Stadium : illustration).
- **Valorant** : valorant-api.com, comme l'import direct ; l'écran montre ce que la validation changera (nouvelle
  map, image ajoutée / remplacée / identique, échelle, nombre de callouts).

Pour le Fondateur (ou un gestionnaire des jeux) :
1. Administration › Jeux › le jeu (The Finals ou Valorant) › carte « Maps proposées » › **Préparer les maps (à
   valider)**. Le serveur télécharge tout (une dizaine de secondes) ; chaque map arrive « À valider ».
2. Pour chaque map : regardez l'aperçu, l'échelle, la source et la licence, le pool suggéré.
   - **Remplacer l'image** : adresse https d'une autre image, ou un fichier (site et app PC) ;
   - **Calibrer** : touchez deux points dont vous connaissez la distance réelle, saisissez-la en mètres ;
   - **Rejeter** : la map n'entre pas dans le profil.
3. **Valider** (une map) ou **Valider toutes** : une seule nouvelle version du profil (motif `cartes-proposees`),
   visible dans l'historique et restaurable. Les maps nouvelles entrent dans le pool si c'est suggéré.
4. Plus tard, **Rafraîchir les propositions** : les maps encore « À valider » sont mises à jour (votre image et
   votre calibrage gardés) ; une map validée ou rejetée ne revient « À valider » que si l'image de la source a
   changé ; le profil n'est jamais touché par la préparation. À la validation, un calibrage fait à la main dans le
   profil et les repères posés à la main sont gardés.
Sécurité : uniquement `www.thefinals.wiki` (The Finals), `valorant-api.com` et `media.valorant-api.com` (Valorant) pour
la préparation, https, sans redirection, 10 Mo par image, type annoncé et contenu vérifiés ; « Remplacer l'image » par
adresse : https vers un site public. Les images sont rangées dans le stockage du serveur (`jeu_images`), jamais
dans le dépôt ; une image identique n'est jamais re-déposée.

**Données pré-remplies, à vérifier** : « Pré-remplir les capacités » (agents de Valorant, classes de The Finals) et
« Compléter avec le modèle The Finals » (formats 3v3v3v3, modes, maps sans image avec leurs étages, classes Light /
Medium / Heavy avec spécialisations, gadgets et armes) ajoutent des données de connaissances générales, **toutes
marquées « à vérifier »**, sans rien écraser ni rien télécharger. Corrigez-les, décochez « à vérifier », enregistrez.

**Archiver** un profil : il n'est plus proposé à la création d'une team ; les teams qui l'ont le gardent. **Supprimer**
n'est possible que si aucune team ne l'utilise.

## Préconfigurés

- **Valorant**, à partir de ce que l'app avait déjà : 12 maps (avec la vignette valorant-api.com de celles que le
  Discord connaissait), 27 agents et leur rôle, les postes (Duelliste, Contrôleur, Initiateur, Sentinelle, Flex, IGL),
  5v5 en BO1/BO3/BO5, 13 rounds gagnants, 12 par mi-temps, prolongations à 12-12 (deux rounds d'écart), roster 5 + 2.
  **Toutes les maps sont marquées « dans le pool »** : décochez celles qui n'y sont plus (ou laissez l'IA le proposer).
- **Autre jeu** : profil vide, pour les teams créées avant les profils avec ce choix.
- **The Finals n'est pas préconfiguré** : ses modes et maps compétitifs changent à chaque saison ; l'assistant IA le
  prépare (brouillon relu par vous), ou créez-le à la main, puis « Compléter avec le modèle The Finals ». La migration
  0075 donne le modèle de strat `thefinals` à un profil existant dont la clé ou le nom est celui de The Finals.

Les teams existantes sont rattachées par la migration : `valorant` reste Valorant, `autre` reste « Autre jeu », toute
autre valeur devient Valorant.

## Une team et son jeu

- **Créer une team** : le choix du jeu est **obligatoire** (étape 2 de l'assistant), parmi les profils actifs, avec un
  résumé (formats, maps du pool, personnages, roster). Le jeu n'est pas dans la liste : **Configurer un jeu** ouvre la
  page Jeux.
- **Paramètres de la team › La team › Jeu de la team** : changer de jeu (permission « Modifier la team »). Les strats,
  fiches et ressources existantes restent ; les listes proposées changent.
- `GET /teams/:id/jeu` : le profil du jeu de la team, lisible par tout membre (contrôle d'appartenance habituel).

### Ce que lisent les modules

| Module | Ce qui vient du profil |
| --- | --- |
| Strats | Maps proposées à la création (celles du pool ; une strat sur une map sortie du pool reste éditable), agents de l'éditeur (jouables), filtres |
| Playbook | Maps des filtres et des nouvelles entrées |
| Ressources | Maps et personnages des précisions d'une ressource |
| Scouting | Suggestions (maps du pool, personnages, rôles) sous les champs map, agents et rôle ; la saisie reste libre |
| Tournois | Formats et BO proposés, taille du roster (titulaires, remplaçants), phases |
| Résultats | Validation du score (série en rounds avec mi-temps et prolongations, points, manches ; classement multi-équipes avec barème), maps, modes et personnages par manche |

**Ce qui reste propre à Valorant** (profil dont la base est `valorant`) :

- les **images Riot** de l'éditeur de strats : minimaps en fond de carte, icônes des agents et leurs **capacités**
  (valorant-api.com, politique « Legal Jibber Jabber » et sa mention, affichée seulement pour Valorant) ;
- la vignette de map des annonces **Discord** (maps reconnues dans le titre d'un événement) ;
- les mots « attaque / défense » des strats et du scouting.

Pour un autre jeu, l'éditeur de strats devient **générique** : pas de fond de carte (le document d'une strat n'accepte
que le CDN Riot, pour la sécurité de la page de partage), des pions à initiales pour les personnages, pas de
capacités ; flèches, zones, textes, étapes, partage et playbook marchent comme pour Valorant.

## L'assistant IA (facultatif)

Jusqu'à trois moteurs, essayés dans un **ordre de repli** ([ia-api.md](ia-api.md)) :

- une **API principale** et une **API secondaire** : [docs/o2switch.md, partie I](../o2switch.md) (lignes
  `IA_API_URL`, `IA_API_CLE`, `IA_MODELE` et `IA_API2_URL`, `IA_API2_CLE`, `IA_MODELE2` de
  `~/.appdashboard/esport.env`). Tout fournisseur qui a une API « chat completions » compatible OpenAI convient
  (**NVIDIA**, OpenAI, Mistral, Gemini, DeepSeek, Groq…) ; configuration conseillée : NVIDIA Mistral Large
  (`mistralai/mistral-large-4-1t-a52b`) en principal pour les profils de jeu, NVIDIA `openai/gpt-oss-20b` en
  secondaire ; le connecteur a un adaptateur par format d'API (`esport/noyau/ia/connecteur.mjs`) pour en ajouter
  d'autres plus tard ;
- une **IA locale** installée sur le serveur (llama.cpp + Qwen2.5-7B-Instruct, `IA_FOURNISSEUR=local`) : gratuite,
  plus lente, avec des consignes adaptées à un petit modèle et une sortie JSON contrainte :
  [ia-locale.md](ia-locale.md) et [docs/o2switch.md, partie J](../o2switch.md).

Le Fondateur règle dans **Administration IA › Ordre de repli** l'ordre des moteurs pour les **profils de jeu**
(brouillons, vérifications ; défaut : API principale, puis secondaire, puis IA locale — `IA_ORDRE`). Un moteur en
panne, limité par le fournisseur (429) ou à son plafond du mois passe la main au suivant ; si toutes les API échouent,
le travail est repris par l'IA locale (consignes compactes, dans le processus de fond). Sans aucun moteur, tout se
fait à la main : le bouton **Préparer avec l'IA** est grisé avec une explication. Les données envoyées à une API
externe quittent le serveur (avertissement affiché dans l'Administration IA).

### Préparer avec l'IA

1. **Jeux › Assistant IA** : nom du jeu ; facultatif : jusqu'à 5 pages de référence (https), des consignes, ou un
   profil existant à compléter.
2. Le serveur cherche l'information : avec vos pages, il les lit ; sans pages, il demande d'abord au modèle quelles
   pages officielles ou wiki lire, puis les lit lui-même (`IA_RECHERCHE=serveur`, défaut). Un modèle qui sait chercher
   sur le web peut le faire lui-même (`IA_RECHERCHE=modele`).
3. Le modèle remplit le profil : c'est un **brouillon**, avec ses sources (pages lues, pages illisibles), les **points
   incertains** (signalés sur leur section ou leur élément, avec la confiance et la raison) et les éléments écartés
   par la validation.
4. **Relire et valider** : vous corrigez tout ce qu'il faut dans l'éditeur, puis **Valider et enregistrer**. Rien n'est
   enregistré avant (le brouillon peut aussi être abandonné). Une notification prévient quand le brouillon est prêt.

Les images proposées par l'IA ne sont **pas chargées d'office** (une image peut servir à pister qui la regarde) : le
site qui l'héberge est affiché, **Aperçu** la montre sur demande.

### Mise à jour automatique limitée

- Chaque jeu actif est **vérifié une fois par semaine** (réglable : 7, 14 ou 30 jours ; **Vérification automatique :
  Coupée** pour un jeu ; ou pour tous dans Administration IA), par le cron existant, **une vérification au plus par
  passage**. Le premier passage a lieu une semaine après la création du profil. **Vérifier maintenant** lance une
  vérification à la main.
- L'IA relit les pages de référence du profil et ne produit qu'une liste de **différences proposées** : ajout,
  modification (ex. une map qui sort du pool) ou retrait, avec justification, sources et confiance. Les changements sans
  effet, incohérents (modifier un élément absent…) ou en double d'une proposition en attente sont écartés.
- **Notification** au Fondateur et aux gestionnaires (in-app ; dans le récapitulatif e-mail pour ceux qui l'ont
  activé). Pas de message Discord : ces profils ne dépendent d'aucune team.
- **Jeux › Mises à jour** : pour chaque changement, **Accepter** (avec correction du nom si besoin), **Refuser** ou
  **Plus tard**. **Appliquer** crée une nouvelle version avec les changements acceptés ; ceux qui ne s'appliquent plus
  (élément déjà retiré entre-temps) deviennent « sans objet ». **Rien n'est appliqué automatiquement.**

### Plafonds et Administration IA (Fondateur)

**Jeux › Administration IA** : **moteurs de l'IA** (API principale, API secondaire, IA locale : fournisseur, modèle,
clé **présente ou absente** — jamais sa valeur —, appels et erreurs du mois, temps de réponse, dernier appel, un bouton
**Tester** par moteur, avertissement de confidentialité), **ordre de repli** par tâche, état de l'IA locale (modèle,
en marche ou arrêtée, dernière vitesse, dernier temps de réponse, **Tester l'IA locale**), adresse de l'API principale,
mode de recherche, **Tester la connexion**, plafonds mensuels réglables **par moteur** (défaut : **30 appels** à l'API
principale, **200** à l'API secondaire, et **8 vérifications** par mois) avec le compteur du mois, dernier appel (date, but, résultat, durée), dernières
vérifications, et la **délégation** de la gestion des profils (permission globale `jeux.gerer`, sans l'Administration
de l'IA). Un brouillon coûte 1 ou 2 appels (choix des pages, puis brouillon), une vérification aussi, un test 1. Au-delà
d'un plafond, plus aucun appel jusqu'au mois suivant (429 « Plafond mensuel … atteint »), et une limite de débit
(20 demandes par heure et par compte) s'ajoute. Les plafonds mensuels ne portent que sur l'**API externe** : les requêtes à l'IA locale
sont comptées à part, sans plafond (rien n'est payé), mais bornées en durée (20 min par requête) et en concurrence
(une à la fois, 4 en attente au plus).

## Sécurité

- **Clé d'API** : seulement dans `esport.env` ; gardée dans une fermeture (jamais sérialisée), envoyée seulement dans
  l'en-tête `Authorization` vers l'adresse https configurée ; jamais renvoyée par l'API, journalisée, exportée ni
  écrite en base (la table `ia_appels` garde la date, le but, le modèle, la durée, les jetons et un code d'erreur).
- **Lecture des pages (anti-SSRF)** : https seulement (même après une redirection), port 443, aucun identifiant dans
  l'adresse ; jamais une IP privée, locale, réservée (IPv4, IPv6, formes détournées) ni un nom local ; la résolution
  DNS est vérifiée avant chaque saut et **au moment de la connexion** (le téléchargeur se connecte à l'adresse vérifiée :
  pas de DNS rebinding) ; redirections suivies à la main (3 au plus), 8 s et 768 Ko par page, 4 pages au plus, ni
  cookie ni identifiant envoyés.
- **Données non fiables** : le texte des pages est réduit à du texte brut (scripts, styles et balises retirés), passé
  au modèle entre balises `<page>` (une fausse balise dans la page est neutralisée) avec la consigne de n'y voir que
  de la matière ; la réponse du modèle n'est lue que comme du JSON, **validée par schéma** (éléments invalides écartés
  et listés), jamais exécutée ; tout ce qui est affiché passe par les composants texte (aucun HTML interprété).
- **Droits** : lecture des profils actifs pour tout compte Esport ; profil de sa team pour tout membre ; gestion avec
  `jeux.gerer` (Fondateur, délégués) ; Administration de l'IA et délégations : le Fondateur seul. Le Propriétaire d'une
  team n'a **pas** `jeux.gerer` (les profils sont communs à toutes les teams).

## API

| Route | Qui | Rôle |
| --- | --- | --- |
| `GET /jeux` (`?tous=1`) | tout compte (tous : gestionnaire) | Profils actifs et leur résumé ; pour un gestionnaire, teams, propositions, état de l'IA |
| `POST /jeux` · `GET` / `PATCH` / `DELETE /jeux/:cle` | jeux.gerer (`GET` d'un profil actif : tous) | Créer, lire, modifier (`version` attendue), supprimer |
| `POST /jeux/:cle/archiver` · `PUT /jeux/:cle/maj` | jeux.gerer | Archiver ; vérification automatique et fréquence |
| `POST /jeux/:cle/importer` | jeux.gerer | Import serveur des images et de l'échelle `{ version, urls?, remplacer? }` ; rend `{ rapport, jeu }` |
| `GET /jeux/:cle/cartes-proposees` · `POST …/preparer` | jeux.gerer | Maps proposées (et ce qu'elles changeraient) ; préparation par le serveur, rend `{ rapport, cartes, images }` |
| `POST /jeux/:cle/cartes-proposees/valider` · `…/rejeter` | jeux.gerer | `{ cartes: [clés] }` ou `{ toutes: true }` (valider : nouvelle version du profil) |
| `POST /jeux/:cle/cartes-proposees/:carte/image` · `PUT …/:carte/echelle` | jeux.gerer | Remplacer l'image `{ url }` ou `{ type, donnees, nom }` ; calibrage `{ points, distance }` |
| `POST /jeux/:cle/images` | jeux.gerer | Dépôt d'une image de map `{ type, donnees (base64), nom }` ; à citer ensuite dans `cartes[].fichier` |
| `GET /jeux/images/:id?c&exp&sig` | lien signé | Image déposée (les profils rendus portent `images` : liens signés de 6 h) |
| `GET /jeux/:cle/versions` · `GET …/versions/:n` · `POST …/versions/:n/restaurer` | jeux.gerer | Historique, restauration |
| `POST /jeux/:cle/verifier` | jeux.gerer | Vérification manuelle |
| `GET /jeux/propositions` (`?jeu=&statut=`) · `POST /jeux/:cle/propositions/decider` | jeux.gerer | Différences proposées ; `{ acceptees, refusees, corrections }` |
| `POST /jeux/ia/brouillons` · `GET /jeux/ia/travaux` · `GET` / `DELETE /jeux/ia/travaux/:id` · `POST …/valider` | jeux.gerer | Brouillons |
| `GET /jeux/ia` | jeux.gerer | État de l'IA (sans la clé), usage |
| `PUT /jeux/ia/reglages` · `POST /jeux/ia/test` · `GET` / `PUT /jeux/ia/gestionnaires` | Fondateur | Plafonds, test, délégations |
| `GET /teams/:id/jeu` | membre de la team | Profil du jeu de la team |

Tables (migration 0021, comprises dans l'export / import de la base) : `jeux`, `jeu_versions`, `ia_travaux`,
`ia_propositions`, `ia_appels`, `ia_reglages`, `permissions_globales`. À l'import dans une base neuve, les profils
préconfigurés par la migration sont remplacés par ceux de l'export.

Tables de la migration 0075 : colonne `jeux.modele_strat`, table `jeu_images`. Migration 0078 : `jeu_cartes_proposees`
(une ligne par map proposée : statut, proposition, image, empreinte de la source).
Code : `esport/noyau/jeux/import.mjs` (téléchargeur borné, valorant-api.com), `wiki-thefinals.mjs` (wiki The Finals),
`cartesProposees.mjs` (propositions) ; écran `src/esport/ui/jeux/CartesProposees.tsx`.

Tests : `esport/test/profils-jeu.test.mjs`, `esport/test/strats-modeles.test.mjs` (modèle, détails des maps et des
capacités, images, import réel abrégé de valorant-api.com), `esport/test/cartes-proposees.test.mjs` (réponses JSON réelles
du wiki enregistrées et abrégées, `esport/test/donnees/wiki-thefinals.json` ; images simulées), `src/esport/CartesProposees.test.tsx`,
`esport/test/ia-assistant.test.mjs` (faux serveur d'IA et faux web :
aucun appel réseau réel), `src/esport/ProfilsJeu.test.tsx`.
