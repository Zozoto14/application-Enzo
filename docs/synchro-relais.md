# Synchronisation par le relais : déclencheurs, formats, budget d'écritures

## Ce qui est synchronisé

Entités `genre:identifiant`, scellées XChaCha20-Poly1305 avec `cleDerivee('synchro')` **du profil** (jamais croisées
entre profils : un ami ne peut pas ouvrir le dépôt de l'administrateur, et inversement).

| Genre (version de charge) | Contenu | Fusion |
| --- | --- | --- |
| `compte`, `titre`, `operation`, `surveille`, `these`, `parametre` (1) | portefeuille | dernier gagnant, suppressions 365 j |
| `prefs:hub` (2) | `hub.prefs` : tuiles, disposition, densité | dernier gagnant |
| `prefs:theme` (2) | `hub.theme` : thème du hub | dernier gagnant |
| `prefs:theme-portefeuille` (2) | `affichage.theme` | dernier gagnant |
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

## Course connue du relais

`relais/worker.mjs` réécrit l'index en lecture-modification-écriture : deux dépôts simultanés peuvent faire perdre
l'entrée de l'un dans l'index (son dépôt reste stocké). Côté client, un appareil absent de l'index alors qu'il a déjà
déposé se redépose (au plus une fois par heure). Correction définitive possible côté worker (index par clé
`index:<appareil>` listé avec `KV.list`) : réservée à la passe « relais ».
