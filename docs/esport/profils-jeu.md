# Profils de jeu et assistant IA

Chaque jeu a ses règles : Valorant se joue en 5v5, 13 rounds gagnants avec changement de côté après 12 rounds ;
The Finals en 3v3 ou en 3v3v3v3 avec un classement ; les maps et les personnages ne sont pas les mêmes. Un **profil
de jeu** décrit tout cela **avant** la création d'une team. Les modules (Strats, Playbook, Ressources, Scouting) lisent
ensuite les maps et personnages du profil du jeu de la team, et les futurs modules Tournois / Résultats s'appuieront
sur ses formats et son système de score.

Page : **Esport › Jeux** (le Fondateur, et les comptes à qui il confie la gestion). Migration : `0021_profils_jeu.sql`.

## Ce que contient un profil

| Partie | Contenu |
| --- | --- |
| Le jeu | Nom, clé (adresse unique, ex. `the-finals`), couleur, icône (adresse https facultative) |
| Formats de match | Taille des équipes et nombre d'équipes en même temps (5v5 = 2 × 5 ; 3v3v3v3 = 4 × 3), BO joués (1, 2, 3, 5, 7) |
| Système de score | **Rounds** (rounds pour gagner, rounds par mi-temps, prolongations et leur règle), **points** (points pour gagner), **classement** (barème de points par place, jeux à plusieurs équipes), **manches** (manches pour gagner), notes |
| Modes de jeu | Nom, description, formats où ils se jouent, joué en compétition ou non |
| Maps | Nom, image facultative, **dans le pool** ou retirée, modes |
| Classes et personnages | Rôles des personnages (Duelliste, Light…) ; agents / champions / builds avec leur classe, jouables ou non |
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

**Archiver** un profil : il n'est plus proposé à la création d'une team ; les teams qui l'ont le gardent. **Supprimer**
n'est possible que si aucune team ne l'utilise.

## Préconfigurés

- **Valorant**, à partir de ce que l'app avait déjà : 12 maps (avec la vignette valorant-api.com de celles que le
  Discord connaissait), 27 agents et leur rôle, les postes (Duelliste, Contrôleur, Initiateur, Sentinelle, Flex, IGL),
  5v5 en BO1/BO3/BO5, 13 rounds gagnants, 12 par mi-temps, prolongations à 12-12 (deux rounds d'écart), roster 5 + 2.
  **Toutes les maps sont marquées « dans le pool »** : décochez celles qui n'y sont plus (ou laissez l'IA le proposer).
- **Autre jeu** : profil vide, pour les teams créées avant les profils avec ce choix.
- **The Finals n'est pas préconfiguré** : ses modes et maps compétitifs changent à chaque saison ; l'assistant IA le
  prépare (brouillon relu par vous), ou créez-le à la main.

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

**Ce qui reste propre à Valorant** (profil dont la base est `valorant`) :

- les **images Riot** de l'éditeur de strats : minimaps en fond de carte, icônes des agents et leurs **capacités**
  (valorant-api.com, politique « Legal Jibber Jabber » et sa mention, affichée seulement pour Valorant) ;
- la vignette de map des annonces **Discord** (maps reconnues dans le titre d'un événement) ;
- les mots « attaque / défense » des strats et du scouting.

Pour un autre jeu, l'éditeur de strats devient **générique** : pas de fond de carte (le document d'une strat n'accepte
que le CDN Riot, pour la sécurité de la page de partage), des pions à initiales pour les personnages, pas de
capacités ; flèches, zones, textes, étapes, partage et playbook marchent comme pour Valorant.

## L'assistant IA (facultatif)

Sans clé d'API, tout se fait à la main : le bouton **Préparer avec l'IA** est grisé avec une explication.
Configuration : [docs/o2switch.md, partie I](../o2switch.md) (lignes `IA_API_URL`, `IA_API_CLE`, `IA_MODELE` de
`~/.appdashboard/esport.env`). Tout fournisseur qui a une API « chat completions » compatible OpenAI convient (OpenAI,
Mistral, Gemini, DeepSeek, Groq…) ; le connecteur a un adaptateur par format d'API (`esport/noyau/ia/connecteur.mjs`)
pour en ajouter d'autres plus tard.

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

**Jeux › Administration IA** : fournisseur et modèle détectés, adresse de l'API, clé **présente ou absente** (jamais
sa valeur), mode de recherche, **Tester la connexion**, plafonds mensuels réglables (défaut : **30 appels** au modèle et
**8 vérifications** par mois) avec le compteur du mois, dernier appel (date, but, résultat, durée), dernières
vérifications, et la **délégation** de la gestion des profils (permission globale `jeux.gerer`, sans l'Administration
de l'IA). Un brouillon coûte 1 ou 2 appels (choix des pages, puis brouillon), une vérification aussi, un test 1. Au-delà
d'un plafond, plus aucun appel jusqu'au mois suivant (429 « Plafond mensuel … atteint »), et une limite de débit
(20 demandes par heure et par compte) s'ajoute.

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

Tests : `esport/test/profils-jeu.test.mjs`, `esport/test/ia-assistant.test.mjs` (faux serveur d'IA et faux web :
aucun appel réseau réel), `src/esport/ProfilsJeu.test.tsx`.
