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
- objets : pion (regard facultatif), **capacité** (zone en **mètres** : cercle, mur courbable, cône, trajet avec
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

**Priorité : placer les utilitaires au mètre près.** Avec l'outil Capacité, la forme réelle suit le pointeur AVANT
de poser (aperçu à l'échelle, orienté depuis le pion du joueur, cote affichée : « r 4.1 m », « 18 m · 30° ») ;
une fois posée, ses poignées l'orientent ou la courbent (cote mise à jour pendant le geste), « , » et « . » la
tournent de 5° (Maj : 1°), les flèches la déplacent, l'inspecteur règle chaque dimension en mètres.

- Outils : sélection, main, pion, capacité, flèche (trajet du joueur, animé), ligne, forme, texte, marqueur,
  cône de vision, gomme ; poignées sur la sélection (orienter un mur ou un cône, courber un mur courbable,
  déplacer l'origine d'un trajet, tourner le regard d'un pion) ; inspecteur (dimensions en mètres, ordre,
  minutage, étage, équipe adverse, étiquette).
- Une capacité posée s'oriente depuis le pion de son joueur (un trajet de recon part du pion) et reçoit le
  prochain numéro d'ordre ; « Ordre des utilitaires » les réordonne.
- Frise des étapes avec leurs phases et durées ; lecture animée (Espace) : les utilitaires apparaissent à leur
  minutage (ou dans leur ordre), les trajets s'allongent et les pions les suivent ; mode **Présenter** (plein
  écran, pour le briefing).
- Économie du round (Valorant), attaque / défense, étage courant (The Finals : les objets des autres étages
  sont estompés), aimantation sur la grille, map retournée (180°), calques visibles / verrouillés, zoom et
  déplacement (molette, pincement), annuler / rétablir, copier / coller.
- **Comparer** : côte à côte avec une ancienne version ou une autre strat de la team (même modèle).
- **Exporter** : PNG de l'étape, PNG de toutes les étapes, PDF (impression du navigateur : joueurs, chaque étape,
  ordre des utilitaires, notes), duplication de la strat.
- iPad et téléphone dans le navigateur : un doigt dessine, deux doigts zooment ; cibles de 40 à 44 px. L'app iOS
  native reste en lecture seule (miniature et notes).

### Raccourcis

V sélection · H main · A pion · C capacité · F flèche · L ligne · R forme · T texte · M marqueur · O vision ·
E gomme · G aimantation · 1 à 5 joueur · Espace lecture · Ctrl+Z / Ctrl+Maj+Z (ou Ctrl+Y) · Ctrl+C / Ctrl+V ·
Suppr · Ctrl+S · Ctrl+D dupliquer l'étape · [ et ] étapes · flèches : déplacer la sélection (Maj : plus loin) ·
, et . : tourner la sélection de 5° (Maj : 1°) · ? aide ·
+ / - / 0 zoom · Échap.

## Ce que le Fondateur prépare (Administration › Jeux)

1. Choisir le **modèle de strat** de chaque jeu (Valorant : déjà `valorant` ; The Finals : `thefinals`).
2. **Importer les images et l'échelle** (fiche du jeu, carte « Images et échelle des maps ») : pour Valorant, un clic
   (minimaps de valorant-api.com, échelle calculée, callouts) ; pour The Finals, collez une adresse d'image par map
   (ou déposez les images à la main) ; aucune image n'est dans le dépôt de code.
3. **Calibrer** ce qui reste approximatif (The Finals : échelle par défaut « à vérifier ») avec deux points.
4. Tracer les **callouts** et poser les **repères** (sites A/B/C, spawns ; cashouts et coffres pour The Finals ;
   étages).
5. **Vérifier** les capacités pré-remplies (« Pré-remplir les capacités », « Compléter avec le modèle The
   Finals »), décocher « à vérifier » une fois confirmées.

## API

Inchangée ([strats-playbook.md](strats-playbook.md)) ; les strats portent `modele`. Profils de jeu : `modeleStrat`,
`images` (liens signés), `POST /jeux/:cle/images`, voir [profils-jeu.md](profils-jeu.md).

## Tests

`esport/test/strats-modeles.test.mjs` (échelle, document v3, migration 0075, strat par modèle, détails des
profils, champs protégés de l'IA, images), `src/esport/strats/geometrie.test.ts` (formes à l'échelle, poignées,
lecture), `src/esport/StratsEditeurPanneaux.test.tsx` (panneaux de l'éditeur, Jeux précis).
