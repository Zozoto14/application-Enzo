# Tsuzuku : temps de réponse (mesures avant / après)

Demande : « Optimise le temps de réponse sur Tsuzuku car c'est beaucoup trop long ».

## Comment c'est mesuré

`scripts/e2e-tsuzuku-perf.mjs` joue le parcours complet dans un vrai navigateur, sur le **PC** (vrai
module réseau d'Electron, `bureau/electron/tsuzuku.mjs`) et sur le **site** (vrai relais
`relais/worker.mjs`, route `/tsuzuku/requete`, + 80 ms d'aller-retour navigateur → relais). Les sites
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

Vrais sites de streaming, vrai Cloudflare (latence réelle du Worker et de ses sorties), réseau
mobile de l'iPad : les chiffres ci-dessus sont ceux de l'internet simulé.

Captures : `docs/captures-tsuzuku-perf/`.
