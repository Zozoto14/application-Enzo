# Esport : strats par modèle de jeu (Valorant, The Finals, générique)

Complète [strats-playbook.md](strats-playbook.md) (bibliothèque, partage, playbook, droits, politique Riot). Ici :
le **modèle de strat** choisi par le profil de jeu, l'éditeur détaillé, l'échelle des maps et les données des
capacités. Confidentialité : une strat n'est **jamais** envoyée à une IA externe (tâche confidentielle, voir
[ia-api.md](ia-api.md)).

## Le modèle vient du jeu de la team

Chaque profil de jeu (Administration › Jeux, [profils-jeu.md](profils-jeu.md)) choisit son **modèle de strat**
(`jeux.modele_strat`, migration 0075) :

| Modèle | Joueurs | Plan | Outils propres |
|---|---|---|---|
| `valorant` | 5 | attaque / défense, sites | agents et capacités à l'échelle, économie du round (pistol, éco, force, bonus, full), phases setup · exécution · post-plant · retake · mid-round |
| `thefinals` | 3 | **mode par strat** : Cashout (3v3v3v3 : stations de cashout, coffres, équipes adverses 1 à 3, tiers) ou Final Round (3v3 en manches, élimination : une équipe en face, phases approche · engagement · élimination · fin), étages | classes Light / Medium / Heavy, spécialisations, gadgets et armes, marqueurs de destruction (mur, sol), équipes adverses 1 à 3, tiers (third-party), phases approche · prise · tenue · vol · tiers · fin |
| `generique` | celui du premier format du profil (10 au plus) | attaque / défense | pions, flèches, zones, textes, marqueurs |

Une strat reçoit le modèle du jeu de sa team **à sa création** (`strats.modele`) et le garde : changer le
modèle d'un profil ne touche pas aux strats déjà dessinées. Chaque team a sa liste de strats (Valorant LZ0 et
The Final LZ0 ont chacune la leur, avec leur modèle).

## Document (version 3)

`esport/noyau/strats/document.mjs` (serveur, valide tout) et `src/esport/strats/document.ts` (app) :

- `modele`, `jeu` (clé du profil), `economie` (Valorant), `carte.echelle` (instantané de l'échelle au dernier
  enregistrement, pour la page de partage) ;
- joueurs : nom, couleur, agent ou classe, rôle ;
- étapes : titre, note, **phase** du modèle, **durée** (secondes, lecture animée) ;
- objets : pion (regard facultatif), **capacité** (zone en **mètres** : cercle, mur droit, courbé ou **tracé point par
  point** (`trace`, 16 points au plus : High Tide, Blaze), mur **double** (`double` : Fast Lane), cône, trajet avec
  rayon de révélation, ligne, rectangle ; **ordre** des utilitaires ; **minutage**), flèche ou ligne (trajet
  d'un joueur, départ et arrivée en secondes), forme, texte, **marqueur** (objectif, ennemi et son équipe,
  danger, mur ou sol à casser, spawn, plant, defuse, info, rotation, tiers, cashout, coffre), **cône de
  vision** (angle, ouverture, portée en mètres) ; tout objet peut porter un **étage** ;
- calques : fond, callouts et repères (du profil), pions et utilitaires, vision, marqueurs, dessins, texte.

Les anciennes strats (version 2) sont migrées **à la lecture** : leurs zones passent en mètres à l'échelle par
défaut (le dessin ne bouge pas tant que la map n'est pas calibrée), une strat The Finals garde ses trois premiers
joueurs. La migration 0075 rattache les strats existantes : Valorant pour les strats Valorant, The Finals pour
celles d'une team d'un profil The Finals, générique sinon.

## Échelle : des capacités à la bonne taille

Repère d'une strat : carré de 1000 unités. Une map **calibrée** dans Administration › Jeux donne ses unités par
mètre (`pxParMetre`) ; sinon l'échelle par défaut s'applique (1000 unités = 125 m) et l'éditeur le signale. Une
smoke d'Omen de 4,1 m fait donc 41 unités sur une map à 10 unités par mètre. Les formes suivent toujours
l'échelle courante du profil (recalibrer une map remet ses strats à la bonne taille).

Caractéristiques d'une capacité (profil de jeu, `personnages[].capacites`) : forme, rayon, longueur, largeur,
ouverture, portée, durée, charges, coût, courbable, « à vérifier ». Sans données dans le profil, l'éditeur
utilise le jeu pré-rempli de l'app (`src/esport/jeux/modeles/`), **marqué « à vérifier »** : connaissances
générales, aucune requête réseau. Une capacité à longueur connue (mur, cône, ligne) s'**oriente** sans changer
de taille ; sans longueur connue, sa poignée l'allonge.

## L'éditeur (site et app PC)

**Priorité : placer et orienter les utilitaires au mètre près**, à la souris, au doigt (iPad) ou au stylet.

Disposition (inspirée des outils de plan tactique courants, pour l'ergonomie seulement : aucune donnée, carte, image ni
code tiers) : à gauche un panneau compact (carte de la map avec attaque / défense, mode, économie, étage ; **étapes 1 à
N** avec lecture et curseur de temps ; « Supprimer : Tout / L'étape », annulables ; **grille d'outils** aux icônes
monochromes), au centre le canevas, dessous la **barre des capacités** de l'agent choisi (C, Q, E, X avec leurs
icônes : un clic arme la pose) et la **barre d'agents** (portraits, filtre Duellistes / Initiateurs / Contrôleurs /
Sentinelles, camp Alliés / Ennemis : un pion ennemi est rouge et sans joueur), puis la frise détaillée des étapes ; à
droite l'inspecteur, les joueurs, l'ordre des utilitaires et les calques.

**Gestes** (`src/esport/strats/pose.ts`, fonctions pures testées) :
- **cliquer-glisser pour poser** une capacité, un cône de vision ou un pion : l'appui fixe l'origine, le glisser la
  direction et la longueur (cône de flash ou de recon, ligne, rectangle, mur), **bornée à la longueur réelle** de la
  capacité (caractéristiques du profil ou pré-remplies : mur de Viper 60 m, mur de Sage 10,5 m…). Un mur
  **courbable** (High Tide, Blaze) suit le chemin parcouru s'il n'est pas droit (tracé simplifié, coupé à la longueur
  réelle) ; un trajet (recon, drone, dard) part de l'appui et se pose au relâché ; une smoke se pose au relâché. Un
  simple appui pose comme avant (orientée depuis le pion du joueur). Aperçu à l'échelle et cote pendant le geste ;
- **poignées** de la sélection, visibles avec tout outil d'édition (on pose un mur et on l'oriente aussitôt) :
  26 px à l'écran quel que soit le zoom, **zone de prise de 48 px**, au-dessus de tout le reste : extrémité (tourner
  autour de l'origine et allonger, jusqu'à la longueur réelle, cercle pointillé de la longueur maximale), première
  extrémité d'un mur (l'autre reste en place), milieu d'un mur courbable (courber), chaque point d'un mur tracé,
  rayon d'un cercle, origine d'un trajet, regard d'un pion. **Maj** aimante l'angle à 15° ; « , » et « . » tournent
  de 5° (Maj : 1°) ; l'inspecteur règle chaque dimension en mètres ;
- un appui sur un objet existant avec un outil de pose le **sélectionne** (et le déplace) au lieu d'en poser un autre.

Images : pions = **portrait** de l'agent découpé en rond, anneau à la couleur du joueur, nom du joueur dessous ;
capacités posées = **icône** de la capacité au point de pose ; initiales tant que les portraits ne sont pas importés
(« Importer agents et capacités », Administration › Jeux). Le document d'une strat ne garde que l'adresse CDN Riot
(`iconeDoc`) ; l'affichage prend l'image importée dans le stockage du serveur (lien signé du profil).

- Outils : sélection, main, pion, capacité, flèche (trajet du joueur, animé), ligne, forme, texte, marqueur,
  cône de vision, gomme ; inspecteur (dimensions en mètres, ordre, minutage, étage, équipe adverse, étiquette).
- Une capacité posée reçoit le prochain numéro d'ordre ; « Ordre des utilitaires » les réordonne.
- Frise des étapes avec leurs phases et durées ; lecture animée (Espace) : les utilitaires apparaissent à leur
  minutage (ou dans leur ordre), les trajets s'allongent et les pions les suivent ; mode **Présenter** (plein
  écran, pour le briefing).
- Économie du round (Valorant), attaque / défense, étage courant (The Finals : les objets des autres étages
  sont estompés), aimantation sur la grille, map retournée (180°), calques visibles / verrouillés, zoom et
  déplacement (molette, pincement), annuler / rétablir, copier / coller.
- **Comparer** : côte à côte avec une ancienne version ou une autre strat de la team (même modèle).
- **Exporter** : PNG de l'étape, PNG de toutes les étapes, PDF (impression du navigateur : joueurs, chaque étape,
  ordre des utilitaires, notes), duplication de la strat.
- iPad et téléphone dans le navigateur : un doigt pose, oriente ou tire une poignée, deux doigts zooment ; cibles de
  40 à 48 px. L'app iOS native reste en lecture seule (miniature et notes).

### Raccourcis

V sélection · H main · A pion · C capacité · F flèche · L ligne · R forme · T texte · M marqueur · O vision ·
E gomme · G aimantation · 1 à 5 joueur · Espace lecture · Ctrl+Z / Ctrl+Maj+Z (ou Ctrl+Y) · Ctrl+C / Ctrl+V ·
Suppr · Ctrl+S · Ctrl+D dupliquer l'étape · [ et ] étapes · flèches : déplacer la sélection (Maj : plus loin) ·
, et . : tourner la sélection de 5° (Maj : 1°) · Maj en tirant une poignée ou en posant : angle par 15° · ? aide ·
+ / - / 0 zoom · Échap.

## Ce que le Fondateur prépare (Administration › Jeux)

1. Choisir le **modèle de strat** de chaque jeu (Valorant : déjà `valorant` ; The Finals : `thefinals`).
2. **Maps proposées** (fiche du jeu) : « Préparer les maps (à valider) » ; The Finals depuis le wiki communautaire
   (vues de dessus, pool suggéré, échelle approximative), Valorant depuis valorant-api.com (minimaps, échelle
   calculée, callouts) ; revoir, puis « Valider toutes » (voir profils-jeu.md). L'import direct (carte « Images et
   échelle des maps ») reste possible ; aucune image n'est dans le dépôt de code.
3. **Calibrer** ce qui reste approximatif (The Finals : échelle par défaut « à vérifier ») avec deux points.
4. Tracer les **callouts** et poser les **repères** (sites A/B/C, spawns ; cashouts et coffres pour The Finals ;
   étages).
5. **Importer agents et capacités** (Valorant, fiche du jeu) : portraits, icônes et noms officiels des capacités,
   icônes des rôles, rangés dans le stockage du serveur (voir profils-jeu.md).
6. **Vérifier** les capacités pré-remplies (« Pré-remplir les capacités », « Compléter avec le modèle The
   Finals »), décocher « à vérifier » une fois confirmées.

## API

Inchangée ([strats-playbook.md](strats-playbook.md)) ; les strats portent `modele`. Profils de jeu : `modeleStrat`,
`images` (liens signés), `POST /jeux/:cle/images`, voir [profils-jeu.md](profils-jeu.md).

## Tests

`esport/test/strats-modeles.test.mjs` (échelle, document v3, migration 0075, strat par modèle, détails des
profils, champs protégés de l'IA, images), `src/esport/strats/geometrie.test.ts` (formes à l'échelle, poignées,
lecture), `src/esport/strats/pose.test.ts` (cliquer-glisser, poignées : rotation, longueur bornée, extrémités et milieu
des murs, mur tracé, Maj 15°), `src/esport/StratsBarres.test.tsx` (barre d'agents : portraits et repli en initiales,
filtre par rôle, camp ; barre des capacités ; étapes ; « Supprimer tout » ; import des agents),
`src/esport/StratsEditeurPanneaux.test.tsx` (panneaux de l'éditeur, Jeux précis), `esport/test/import-agents.test.mjs`
(import serveur des agents, mur tracé et double dans le document et la page de partage),
`scripts/e2e-esport-strats.mjs` (navigateur : mur posé en cliquant-glissant et poignées tirées à la souris, poignée
de regard tirée au doigt sur iPad).
