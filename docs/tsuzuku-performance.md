# Tsuzuku : temps de réponse (mesures avant / après)

Demande : « Optimise le temps de réponse sur Tsuzuku car c'est beaucoup trop long ».

## Comment c'est mesuré

`scripts/e2e-tsuzuku-perf.mjs` joue le parcours complet dans un vrai navigateur, sur le **PC** (vrai
module réseau d'Electron, `bureau/electron/tsuzuku.mjs`) et sur le **site** (vrai relais
`relais/relais.mjs`, route `/tsuzuku/requete`, + 80 ms d'aller-retour navigateur → relais). Les sites
sont un « internet » local NEUTRE (domaines `*-exemple.fr`) à latences réalistes et déterministes :
200 à 800 ms par requête (catalogue compris), et une source prioritaire **lente** (3,5 à 4,5 s par
requête) qui n'a pas le titre ; la seconde source a « Le Long Voyage » et « Le Long Voyage (VF) »,
épisodes sur deux pages.

```
npx vite build
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-tsuzuku-perf.mjs          # avec seuils
SEUILS=0 SORTIE=mesures.json node scripts/e2e-tsuzuku-perf.mjs                        # mesure seule
```

## Résultats

« Premier affichage utile » / « fin » : temps entre le clic et l'élément attendu à l'écran.

| Étape | PC avant | PC après | Site avant | Site après |
| --- | --- | --- | --- | --- |
| Ouverture de l'app (Découvrir, 1re carte) | 1,85 s | 1,04 s | 1,94 s | 1,15 s |
| Recherche du catalogue | 0,90 s | 0,87 s | 0,88 s | 0,90 s |
| Fiche : titre affiché | 0,36 s | 0,36 s | 0,37 s | 0,38 s |
| Fiche : 1er résultat des sources affiché | 13,8 s | 3,2 s | 14,3 s | 3,2 s |
| Fiche : « Sur vos sources » final (+ VF/VOSTFR) | 13,8 s | 4,0 s | 14,3 s | 4,6 s |
| Épisode 2 : lecteur affiché | 1,40 s | 0,99 s | 1,47 s | 1,42 s |
| Bascule VF/VOSTFR | 0,90 s | 0,47 s | 0,92 s | 0,35 s |
| Épisode suivant | 0,94 s | 0,26 s | 0,91 s | 0,26 s |
| 2e ouverture de la fiche : « Sur vos sources » | 13,8 s | 0,14 s | 14,3 s | 0,12 s |
| Après rechargement de la page : Découvrir | 0,99 s | 0,22 s | 1,08 s | 0,23 s |
| Après rechargement : « Sur vos sources » | 13,8 s | 0,14 s | 14,3 s | 0,14 s |
| Requêtes vers les sources (tout le parcours) | 38 | 19 | 23 | 15 |

(PC : le compteur inclut le catalogue, qui passe aussi par le module réseau d'Electron.)

## Causes mesurées

1. **Recherche séquentielle** : chaque variante du titre (titre, titre original, alternatifs) puis
   chaque source attendait la précédente. Une source prioritaire lente coûtait 3 variantes × ~4 s
   avant même de passer à la suivante (≈ 13,8 s sur 14).
2. **Aucun cache d'une ouverture à l'autre** : le cache de 10 min vivait dans les services, recréés
   à chaque ouverture de l'app ; rouvrir la fiche relançait toute la recherche (13,8 s), et un
   rechargement de la page reperdait aussi le catalogue.
3. **Le lecteur attendait la vérification de l'autre langue** (deux pages de série) avant de
   s'afficher ; la bascule VF/VOSTFR et l'épisode suivant relisaient chacun leur page.
4. Accessoires : 20 grandes affiches par rangée téléchargées d'un coup ; sur le PC, une nouvelle
   connexion TLS par requête.

## Ce qui a changé

Voir `src/tsuzuku/README.md` › « Temps de réponse » : variantes et sources en parallèle (résultat
identique au séquentiel, priorité gardée, délai de grâce de 1,2 s, annulation), affichage progressif,
cache du profil chiffré sur l'appareil (catalogue « périmé mais servi » 7 jours, épisodes 30 min /
24 h, lecteurs 20 min), préchargement (autre langue, épisode suivant, épisode du bouton « ▶ Lire »),
vignettes et images différées, connexions gardées sur le PC, temps de chaque étape et « depuis le
cache » dans le diagnostic.

Analyse HTML : ~45 ms pour une page de 270 Ko (1 500 épisodes) sous Jest ; ce n'est pas le goulot
(les secondes viennent du réseau), pas de Web Worker.

## Non mesuré

Vrais sites de streaming, vrai serveur (latence réelle du relais et de ses sorties), réseau
mobile de l'iPad : les chiffres ci-dessus sont ceux de l'internet simulé.

Captures : `docs/captures-tsuzuku-perf/`.

---

# 2e passe : latence du site (iPhone/iPad, 4G) — demande « réduire la latence de Tsuzuku »

## Conditions de mesure (plus réalistes)

Même `scripts/e2e-tsuzuku-perf.mjs`, enrichi :

- **site** : relais local qui imite l'hébergement (HTTP/2, JSON compressé en gzip, cache du relais), 80 ms navigateur → relais, 200 à 800 ms relais → site, source prioritaire lente
  (3,5 à 4,5 s par page) qui n'a pas les titres ;
- **site4g** : idem, navigateur bridé par Chrome en « Slow 4G » (150 ms d'aller-retour,
  1,6 Mbit/s descendant, 750 kbit/s montant ; +150 ms sur le catalogue servi par Playwright) ;
- **PC** : vrai module réseau d'Electron ;
- nouvelles étapes : retour du lecteur à la fiche, **autre titre** jamais cherché (les sources sont
  alors « connues »), **second appareil** (cache de l'appareil vide : l'iPhone après l'iPad) ;
- chronométrage à l'image près (`waitForFunction` vérifié à chaque image) : `locator.waitFor`
  espaçait ses vérifications jusqu'à 1 s et faussait les petites différences. Les « avant » ci-dessous
  ont été REMESURÉS avec ce même script sur le code d'origine (`main` à faae263, ancien relais).

```
npx vite build
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-tsuzuku-perf.mjs            # pc, site, site4g + seuils
MODES=site node scripts/e2e-tsuzuku-perf.mjs                                              # site seulement
```

## Résultats (avant → après)

| Étape | PC avant | PC après | Site avant | Site après | Site 4G avant | Site 4G après |
| --- | --- | --- | --- | --- | --- | --- |
| Ouverture de l'app (Découvrir) | 1,08 s | 0,56 s | 1,06 s | 1,09 s | 0,59 s | 1,08 s |
| Fiche : titre affiché | 0,33 s | 0,33 s | 0,33 s | 0,34 s | 0,48 s | 0,47 s |
| Fiche : 1er résultat des sources | 2,77 s | 2,52 s | 3,07 s | 2,76 s | 3,25 s | 2,81 s |
| Fiche : « Sur vos sources » final (+ VF/VOSTFR) | 3,99 s | 3,73 s | 4,28 s | 3,97 s | 4,47 s | 4,02 s |
| Épisode 2 : lecteur affiché | 0,96 s | 0,95 s | 1,05 s | 1,05 s | 1,22 s | 1,22 s |
| Bascule VF/VOSTFR | 0,45 s | 0,45 s | 0,62 s | 0,62 s | 0,61 s | 0,66 s |
| Épisode suivant | 0,19 s | 0,21 s | 0,19 s | 0,21 s | 0,35 s | 0,35 s |
| Retour du lecteur à la fiche | 0,09 s | 0,11 s | 0,10 s | 0,09 s | 0,12 s | 0,08 s |
| 2e ouverture : « Sur vos sources » | 0,10 s | 0,10 s | 0,12 s | 0,09 s | 0,11 s | 0,08 s |
| **Autre titre (sources connues) : « Sur vos sources »** | 4,17 s | **1,40 s** | 4,35 s | **1,59 s** | 4,54 s | **1,65 s** |
| Après rechargement : « Sur vos sources » | 0,10 s | 0,08 s | 0,12 s | 0,09 s | 0,13 s | 0,12 s |
| **2e appareil (cache vide) : « Sur vos sources »** | — | — | 4,25 s | **0,82 s** | 4,51 s | **1,37 s** |
| 2e appareil : épisode 2 | — | — | 1,03 s | 0,41 s | 1,22 s | 0,72 s |

Écarts de ±0,1 s : bruit de la machine de test (ex. « Ouverture de l'app » varie de 0,5 à 1,1 s
d'une passe à l'autre, avant comme après). Les deux lignes en gras sont celles où l'utilisateur
attend le plus souvent : chaque nouvel animé ouvert, et l'iPhone après l'iPad.

**Nouveau site + ANCIEN relais** (celui du 12/10, sans cache) : tout fonctionne, mêmes gains sauf le
second appareil (4,21 s site, 4,43 s en 4G : rien n'est gardé par le relais).

## Causes mesurées (après la 1re passe)

1. **La recherche attendait la fiche du catalogue** (0,3 à 0,9 s en 4G) avant de partir.
2. **Une source prioritaire lente coûtait ~2,2 s à chaque NOUVEAU titre** : 1 s seule avant que les
   autres partent, puis 1,2 s de délai de grâce, alors qu'elle ne pouvait jamais répondre à temps.
3. **Aucun partage entre appareils** : l'iPhone relisait tout ce que l'iPad venait de lire,
   y compris la source lente (4 s par page).
4. Restant, inhérent : la chaîne recherche → page de la série → page 2 (≈ 0,6 s par page via le
   relais) ; la toute PREMIÈRE recherche ne connaît pas encore la lenteur des sites.

## Ce qui a changé (détails : `src/tsuzuku/README.md` › « 2e passe »)

- **Recherche dès le toucher** de l'affiche (`onPressIn`, ou survol de 250 ms à la souris) ; une
  carte Jikan porte déjà les titres de sa fiche : la recherche part sans l'attendre, la fiche la
  rejoint. Accueil : fiches des 4 premières cartes préchargées (catalogue seulement). Ligne
  d'épisode touchée : sa page est lue d'avance.
- **Sources connues pour être lentes** (temps par site mesuré sur l'appareil) : les autres partent
  aussitôt, et le délai de grâce est abrégé quand la lente ne peut pas finir à temps (diagnostic :
  « connue pour être lente »). Même source retenue sinon.
- **Cache du relais** (15 min recherche, 30 min page ; mémoire du serveur du relais), demandé par le site ; « Réessayer » relit toujours le site.
- **PC** : adresses DNS vérifiées gardées 60 s.

## Pistes écartées (mesurées ou raisonnées)

- **Route « lot » (`/tsuzuku/lot`)** : le site parle au relais en HTTP/2 ; des requêtes parallèles
  partagent déjà la connexion, regrouper n'enlève aucun aller-retour, et une réponse groupée ferait
  attendre les pages rapides derrière la source lente (4 s). Non faite.
- **Compression** : le serveur du relais compresse déjà son JSON (gzip, `relais/serveur/compression.mjs`) ; le relais local de l'e2e l'imite.
- **Écrire le cache de l'appareil « au calme du réseau »** : essayé, retiré : un rechargement juste
  après une recherche perdait son résultat (4 s au lieu de 0,1 s).
- **Web Worker pour l'analyse HTML** : toujours inutile (45 ms pour 270 Ko).

## À savoir

- **Relais** : le cache est la mémoire du processus Node du relais (o2switch, un seul processus) : il se vide
  au redémarrage de l'app.
- Non mesuré : vrais sites, vrai serveur, vraie 4G de l'iPad ; chiffres de l'internet simulé.

## Lecteurs : bascule automatique et préchargement de la suite

- **Bascule automatique** (`moteur/basculeLecteurs.ts`, `app/LecteurMedia.web.tsx`, `app/Lecteur.tsx`) :
  un lecteur est abandonné quand sa page ne charge pas (erreur du cadre), que son hôte est
  injoignable (sonde `HEAD` « no-cors » en parallèle : la page d'erreur du navigateur déclenche aussi
  `onLoad`, la sonde a le dernier mot), que son adresse est invalide ou refusée par la garde du PC,
  qu'une page d'erreur lisible (404, vidéo supprimée…) s'affiche, ou qu'aucun signe de vie n'arrive
  avant 9 s (iframe) / 12 s (vidéo directe, HLS). Le suivant non encore essayé le remplace avec le
  message discret « Lecteur X indisponible, passage à Y ». Le choix manuel reste possible (la bascule
  repart de ce lecteur). Si tous échouent : « Aucun lecteur ne répond pour cet épisode. » et bouton
  « Réessayer » (la page de l'épisode est relue). Mobile : l'ouverture se fait dans Safari, rien à
  surveiller, le choix manuel suffit.
- **Mémoire par source** (`app/fiabiliteLecteurs.ts`) : réussites et échecs par hôte vidéo, gardés dans
  le cache chiffré du profil (sur l'appareil, jamais synchronisés, bornés : 20 lecteurs par source,
  40 sources, compteurs lissés). Les lecteurs fiables passent en premier la fois suivante.
- **Préchargement de la suite** (`app/prechargeSuite.ts`) : pendant la lecture, la page de l'autre
  langue puis celle de l'épisode suivant sont lues et mises en cache (lecteurs gardés 20 min), sans
  lancer de vidéo. Une seule requête à la fois, un temps de calme de 0,4 s, rien en « économie de
  données » ni sur connexion 2G ; une seule file par profil : changer d'épisode ou d'animé, ou quitter
  le lecteur, l'annule (plus aucune requête ne part). Mesure (e2e `e2e-tsuzuku-lecteurs`) : « Suivant »
  affiche le lecteur en ~90 ms, sans relire la page de l'épisode.
- Vérifications : `moteur/basculeLecteurs.test.ts`, `app/fiabiliteLecteurs.test.ts`,
  `app/prechargeSuite.test.ts`, `scripts/e2e-tsuzuku-lecteurs.mjs` (captures :
  `docs/captures-tsuzuku-lecteurs/`, domaines fictifs `*-exemple.fr`).
