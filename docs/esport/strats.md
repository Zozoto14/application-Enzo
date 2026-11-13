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
  vision** (angle, ouverture, portée en mètres) ; tout objet peut porter un **étage** et un **verrou**
  (`verrou` : ni déplacé ni supprimé) ; une fumée peut être **creuse** (`creux`, one-way) ; une flèche ou une ligne
  porte son **usage** (`usage` : déplacement, rotation, regard ; les anciens tracés : `tirets` = rotation) ;
- `couleurs: "agent"` (facultatif) : les capacités prennent l'accent de leur agent au lieu de la couleur du joueur ;
- calques : fond, callouts et repères (du profil), pions et utilitaires, vision, marqueurs, dessins, texte.

Ces champs sont facultatifs et absents par défaut : aucune migration, les strats existantes se lisent telles
quelles. Les réglages d'AFFICHAGE (thème de la map, atténuation, noms, légende, fantôme) ne sont pas dans le
document : ils sont gardés par utilisateur dans le navigateur.

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

## L'atelier : l'éditeur plein écran (site et app PC)

**La map d'abord.** Ouvrir une strat ouvre l'atelier sur toute la fenêtre : la barre d'onglets du hub, la barre
latérale Esport, le fil d'Ariane et les onglets du module disparaissent (portail posé sur la page, sous les fenêtres
modales) ; « ← Strats » ramène à la liste. Le canevas prend toute la place restante et la map y est cadrée entière à
l'ouverture. Place mesurée du canevas (panneaux dans leur état par défaut ; contrôlée à chaque passage du parcours
navigateur, seuils 70 % sur PC et 60 % sur iPad portrait) :

| Fenêtre | Canevas | Part de la fenêtre | Sans les panneaux posés dessus |
| --- | --- | --- | --- |
| PC 1440 × 900 | 1440 × 754 | 83,8 % | 79,2 % |
| PC 1920 × 1080 | 1920 × 934 | 86,5 % | 80,6 % |
| iPad 820 × 1180 | 820 × 1034 | 87,6 % | 80,9 % |
| iPad 1024 × 1366 | 1024 × 1220 | 89,3 % | 84,6 % |
| Téléphone 390 × 844 | 390 × 726 | 86 % | |

Mise en page (`src/esport/ui/strats/atelier/`, React Native sans canevas : testée avec un faux canevas) :

- **Barre du haut** (48 px, `BarreHaut.tsx`) : retour, titre (un clic le renomme), map, attaque / défense ou mode,
  économie (Valorant), étage (The Finals), annuler / rétablir, **état de l'enregistrement**, Présenter, Comparer,
  Exporter, tiroir, menu « … » (affichage, légende, fantôme, aide, dupliquer, partager, playbook, supprimer).
- **Rail d'outils** à gauche (`RailOutils.tsx`) : 11 outils (info-bulle : nom et raccourci), aimantation, retourner la
  map, zoom, aide ; les **options de l'outil** (forme de la zone, usage d'une flèche, marqueur, texte, cône de
  vision) s'ouvrent dans un petit panneau à côté, repliable.
- **Dock** en bas (`Dock.tsx`) : pastilles des **joueurs** (portrait de leur agent, couleur ; un second clic ouvre
  la fiche : nom, rôle, agent), **capacités** de l'agent ou de la classe courante (clic : armer ; **glisser** vers
  la map : poser à cet endroit ; catégories spécialisation / gadgets pour The Finals), **agents** (portraits,
  filtre par rôle, Alliés / Ennemis, équipes adverses 1 à 3 pour The Finals, « ? » pour un ennemi inconnu, grille
  de tous les agents ; clic : armer, glisser : poser). Jeu sans personnages : un pion générique.
- **Frise des étapes** (flottante, en haut du canevas, `FriseEtapes.tsx`) : lecture / pause, curseur de temps,
  étapes numérotées à la couleur de leur phase (glisser pour réordonner), ajouter, titre en ligne, note et menu
  (dupliquer, déplacer, vider, supprimer).
- **Tiroir** à droite (`Tiroir.tsx`), posé SUR le canevas : Sélection (inspecteur, ou actions de groupe),
  Étape (titre, durée, phase, note), Joueurs, Ordre des utilitaires, Calques et affichage. Fermé par défaut ; il
  s'ouvre quand on choisit un objet et se referme avec Échap ; le bouton de la barre l'**épingle** (la map se
  recentre alors dans la place restante). Tablette et téléphone : feuille basse.
- **Ligne d'état** : aide du geste en cours, cote, callout survolé, « Map non calibrée » (explication, et bouton
  « Ouvrir Administration › Jeux » pour qui y a accès : ce qui reste à enregistrer part d'abord) ; l'aide complète est derrière « ? ».

**Enregistrement automatique** (`useAtelier.ts`) : 2,5 s après le dernier changement, jamais pendant un geste, une
écriture à la fois ; même verrou optimiste qu'avant (`revision`). État dans la barre : enregistré, modifié,
enregistrement, erreur (hors ligne : rien n'est perdu, « Enregistrer » réessaie), conflit (bandeau : recharger la
version du serveur ou garder la sienne). Les écritures automatiques portent `auto: true` : le serveur **regroupe**
les versions automatiques d'une même personne (une par tranche de 5 minutes) au lieu d'en empiler une par pause ;
un clic sur l'état (ou Ctrl+S) enregistre une version explicite, toujours gardée. La miniature de la grille part à
l'enregistrement explicite et au plus une fois par minute en automatique. Quitter enregistre d'abord ce qui reste ;
en cas d'échec, l'atelier demande avant de partir. Quand quelqu'un d'autre enregistre la strat ouverte : sans
changement local elle se met à jour toute seule, sinon un bandeau propose de recharger.

**Sélection et gestes** :
- **sélection multiple** : cadre tracé sur le vide, Maj+clic, Ctrl+A ; déplacer, supprimer, dupliquer le groupe ;
  aligner (gauche, centre, droite, haut, milieu, bas) et répartir ; chaque action de groupe est UNE entrée de
  l'historique ;
- **menu contextuel** (clic droit, appui long au doigt) : dupliquer, copier vers l'étape suivante (créée au besoin),
  premier plan / arrière-plan, verrouiller, changer de joueur, changer d'étage, supprimer ; sur le vide : coller,
  tout sélectionner, ajuster la vue ;
- **nouvelle étape** : elle reprend les pions de la précédente à leur **dernière position** (bout de leur trajet),
  réglage « Reprendre les pions » ; **fantôme** de l'étape précédente (pelure d'oignon) au choix ;
- **vue** : molette = zoom au pointeur, Espace + glisser ou bouton du milieu = déplacer, deux doigts = déplacer et
  zoomer, double-clic sur le vide = ajuster, touches 0, + et - ;
- **Échap** ferme d'abord ce qui est ouvert (dialogue, menu, bulle, aide, présentation, comparaison, lecture,
  sélection, tiroir, outil) et ne quitte jamais l'atelier.

**Poser et orienter les utilitaires au mètre près**, à la souris, au doigt (iPad) ou au stylet
(`src/esport/strats/pose.ts`, fonctions pures testées) :
- **cliquer-glisser pour poser** une capacité, un cône de vision ou un pion : l'appui fixe l'origine, le glisser la
  direction et la longueur (cône de flash ou de recon, ligne, rectangle, mur), **bornée à la longueur réelle** de la
  capacité (caractéristiques du profil ou pré-remplies : mur de Viper 60 m, mur de Sage 10,5 m…). Un mur
  **courbable** (High Tide, Blaze) suit le chemin parcouru s'il n'est pas droit (tracé simplifié, coupé à la longueur
  réelle) ; un trajet (recon, drone, dard) part de l'appui et se pose au relâché ; une smoke se pose au relâché. Un
  simple appui pose comme avant (orientée depuis le pion du joueur). Aperçu à l'échelle et cote pendant le geste ;
- **poignées** de la sélection (un seul objet), visibles avec tout outil d'édition : 26 px à l'écran quel que soit
  le zoom, **zone de prise de 48 px**, au-dessus de tout le reste : extrémité (tourner autour de l'origine et
  allonger, jusqu'à la longueur réelle, cercle pointillé de la longueur maximale), première extrémité d'un mur
  (l'autre reste en place), milieu d'un mur courbable (courber), chaque point d'un mur tracé, rayon d'un cercle
  (sauf rayon fixé par les données de la capacité), origine d'un trajet, regard d'un pion. **Maj** aimante l'angle
  à 15° ; « , » et « . » tournent de 5° (Maj : 1°) ; l'inspecteur règle chaque dimension en mètres ;
- un appui sur un objet existant avec un outil de pose le **sélectionne** (et le déplace) au lieu d'en poser un autre.

### Le plateau : map, utilitaires, pions

Tout le dessin part d'UN fichier de jetons de design, `esport/noyau/strats/plateau.json` (lu par le serveur et par
l'app, `src/esport/strats/plateau.ts`) : couleurs, échelle typographique, tailles des jetons, durées d'animation,
thèmes de la map.

- **Map** (`src/esport/cartes/rendu.web.ts`, `analyse.ts`) : une minimap à fond transparent (Valorant) est rendue
  comme un **plateau dessiné** à partir de son alpha (sol sombre teinté en dégradé, liseré clair net, ombre
  intérieure légère, halo, fond sombre et vignettage, pas de grille) ; composition 2D seulement, sans filtre CSS :
  même rendu dans Chromium, Safari et l'export PNG. Une vue de dessus opaque (The Finals) est gardée telle quelle ;
  « **Atténuer la map** » (assombrie et désaturée, puis légèrement floutée) la met en retrait. **Thèmes** par
  utilisateur : Tactique sombre (défaut), Clair, Contraste élevé, Image d'origine. Zones nommées en aplats doux,
  repères (sites, spawns, cashouts…) en pastilles avec leur lettre, **callouts** en petites capitales à halo
  sombre, cachés sous un seuil de zoom et atténués sous un objet. Attaque / défense : bascule animée.
- **Utilitaires** (`canevas/dessins.web.tsx`, genre déduit par `styleCapacite` de la forme, du nom et des données) :
  fumée (disque « sphère », variante creuse one-way), zone de dégâts (dégradé chaud, bord net, frémit en lecture),
  mur (bande à dégradé et lueur, double pour Fast Lane, en blocs si les données le disent), flash (cône qui
  s'estompe, éclat), reconnaissance (trajet en tirets à chevrons, anneau de révélation qui pulse), fil (ligne à
  embouts et zone de détection), piège (cœur plein, rayon de déclenchement), goo (tache), ultime (contour fort,
  pastille « X »). Au point de pose : **icône de la capacité** dans une puce sombre cerclée, numéro d'ordre.
  En lecture : déploiement, anneau de durée qui se vide, fondu à l'expiration ; `prefers-reduced-motion` respecté.
  **Légende** compacte au choix. Couleur : celle du joueur, ou l'accent de l'agent (`couleurs: "agent"`).
- **Pions** : **photo de l'agent** dans un anneau à la couleur du joueur (rouge pour un ennemi, « ? » si l'agent est
  inconnu), ombre portée, cône de regard, nom du joueur en pastille ; sélection = anneau blanc extérieur (la couleur
  ne change pas) ; taille à l'écran bornée (19 à 34 px de rayon) quel que soit le zoom.
- **Tracés** : déplacement (plein, effilé), rotation (tirets), regard (pointillés fins), avec le minutage.
- Performance : trois couches (fond, objets, dessus), objets mémoïsés, tailles à l'écran appliquées sans
  re-rendu, glisser et zoom regroupés par image ; fluide avec 150 objets.

Images : **aucune action manuelle**, le serveur importe les portraits tout seul (premier affichage du profil par
l'éditeur, puis le cron ; voir profils-jeu.md), et en attendant l'éditeur prend l'adresse du CDN officiel. Ordre des
sources (`sourcesIcone`, src/esport/strats/assets.ts ; `useImageJeu`, `IconeAsset`) :
1. image **importée** dans le stockage du serveur (lien signé du profil) ;
2. adresse du **CDN officiel** gardée dans le profil ou le document (`https://media.valorant-api.com/…` seulement,
   en https ; tout autre hôte est écarté) ;
3. **initiales**.
Une image qui ne charge pas (réseau, lien expiré, décodage) passe à la source suivante. Même ordre pour les pions du
canevas, le dock (agents, capacités, pastilles des joueurs), la légende, la fiche des joueurs et la lecture seule ;
l'export PNG reste toujours possible (images lues par `fetch` puis converties en `blob:` ; si une image venait malgré
tout « contaminer » le canevas, elle est masquée pour l'export et ses initiales restent). Pendant la pose (agent armé,
pointeur sur la map), le portrait suit le pointeur (fantôme) ; le pion posé l'affiche aussitôt (image déjà décodée).
Le message « Portraits indisponibles » n'apparaît que si l'image importée ET le CDN ont échoué pour tous les agents
affichés. The Finals (pas de portraits officiels) : initiales, sans message. Le document d'une strat ne garde que
l'adresse CDN Riot (`iconeDoc`) ; la page publique de partage (CSP `img-src https://media.valorant-api.com data:`)
complète un pion posé sans icône avec l'adresse CDN gardée dans le profil, jamais un lien signé. Le site statique ne
pose pas de CSP (bureau/public/_headers) : rien à ouvrir.

### Lecture, présentation, comparaison, export

- **Lecture animée** (Espace) : les utilitaires apparaissent à leur minutage (ou dans leur ordre), les trajets
  s'allongent et les pions les suivent ; d'une étape à la suivante, les pions **glissent** depuis leur dernière
  position.
- **Présenter** : vrai plein écran quand le navigateur le permet, titre et note de l'étape, flèches ou glisser au
  doigt pour changer d'étape, lecture automatique, **pointeur laser** (bouton, ou L tenu), « **mon rôle** » (un
  joueur mis en avant, les autres estompés ; touches 1 à 5).
- **Comparer** : côte à côte avec une ancienne version ou une autre strat de la team (même modèle).
- **Exporter** : PNG de l'étape, PNG de toutes les étapes, PDF (impression du navigateur : joueurs, chaque étape,
  ordre des utilitaires, notes), duplication de la strat ; l'export reprend le rendu du plateau, sans les poignées
  ni la sélection, avec les callouts.
- **iPad** : un doigt pose, oriente ou tire une poignée, deux doigts zooment et déplacent, appui long = menu ;
  cibles de 40 à 48 px. **Téléphone** (390 px) : lecture d'abord (étapes, lecture animée, notes, « mon rôle ») ;
  « Modifier » ouvre les outils en bande et les réglages en feuilles basses. L'app iOS native reste en lecture
  seule (miniature et notes).

### Raccourcis

V sélection · H main · A pion · C capacité · F flèche · L ligne · R forme · T texte · M marqueur · O vision ·
E gomme · G aimantation · 1 à 5 joueur · Espace : lecture (tenu : déplacer la vue) · Ctrl+Z / Ctrl+Maj+Z (ou
Ctrl+Y) · Ctrl+C / Ctrl+V · Ctrl+A tout sélectionner · Suppr · Ctrl+S · Ctrl+D dupliquer la sélection (sans
sélection : l'étape) · [ et ] étapes · flèches : déplacer la sélection (Maj : plus loin) · , et . : tourner la
sélection de 5° (Maj : 1°) · Maj en tirant une poignée ou en posant : angle par 15° · Maj+clic : ajouter à la
sélection · ? aide · + / - / 0 zoom · Échap : fermer ce qui est ouvert. En présentation : ← → étapes, Espace
lecture, L laser, 1 à 5 « mon rôle », 0 tous.

## Ce que le Fondateur prépare (Administration › Jeux)

1. Choisir le **modèle de strat** de chaque jeu (Valorant : déjà `valorant` ; The Finals : `thefinals`).
2. **Maps proposées** (fiche du jeu) : « Préparer les maps (à valider) » ; The Finals depuis le wiki communautaire
   (vues de dessus, pool suggéré, échelle approximative), Valorant depuis valorant-api.com (minimaps, échelle
   calculée, callouts) ; revoir, puis « Valider toutes » (voir profils-jeu.md). L'import direct (carte « Images et
   échelle des maps ») reste possible ; aucune image n'est dans le dépôt de code.
3. **Calibrer** ce qui reste approximatif (The Finals : échelle par défaut « à vérifier ») avec deux points.
4. Tracer les **callouts** et poser les **repères** (sites A/B/C, spawns ; cashouts et coffres pour The Finals ;
   étages).
5. Agents et capacités (Valorant) : importés **automatiquement** par le serveur (portraits, icônes et noms officiels
   des capacités, icônes des rôles, rangés dans son stockage) ; le bouton **Importer agents et capacités** (fiche du
   jeu) reste pour forcer un import (voir profils-jeu.md).
6. **Vérifier** les capacités pré-remplies (« Pré-remplir les capacités », « Compléter avec le modèle The
   Finals »), décocher « à vérifier » une fois confirmées.

## API

Inchangée ([strats-playbook.md](strats-playbook.md)) ; les strats portent `modele`. Lineups liés à une strat
(lecture, pour l'éditeur) : `GET /teams/:t/strats/:id/lineups`, voir [lineups.md](lineups.md). `PUT /teams/:id/strats/:strat`
accepte `auto: true` (enregistrement automatique de l'atelier) : mêmes droits, même validation, même verrou
optimiste ; seule la tenue de l'historique change (version automatique de la même personne, de moins de 5 minutes,
avancée au lieu d'une nouvelle ligne ; identifiant de version préfixé `auto-`). Profils de jeu : `modeleStrat`,
`images` (liens signés), `POST /jeux/:cle/images`, voir [profils-jeu.md](profils-jeu.md).

## Tests

`esport/test/strats-modeles.test.mjs` (échelle, document v3, migration 0075, strat par modèle, détails des
profils, champs protégés de l'IA, images), `src/esport/strats/geometrie.test.ts` (formes à l'échelle, poignées,
lecture), `src/esport/strats/pose.test.ts` (cliquer-glisser, poignées : rotation, longueur bornée, extrémités et milieu
des murs, mur tracé, Maj 15°), `src/esport/strats/atelier.test.ts` (actions de lot, verrou, ordre de dessin, copie
vers une étape, reprise des pions, cadrage, lecture enchaînée, vie d'une capacité, sélection au cadre, aligner /
répartir, tracés), `src/esport/strats/plateau.test.ts` (jetons de design, **contrastes des quatre thèmes**, genre
graphique d'une capacité, tailles à l'écran), `src/esport/cartes/analyse.test.ts` (silhouette ou image pleine),
`src/esport/StratsAtelier.test.tsx` (atelier avec un faux canevas et une fausse API : mise en page et place du
canevas, dock, étapes et reprise, sélection multiple, menu contextuel, enregistrement automatique, conflit, hors
ligne, Échap et raccourcis, téléphone, présentation), `src/esport/StratsBarres.test.tsx` (portraits et repli en
initiales, rôles, ordre des capacités, curseur ; « Supprimer tout » ; import des agents),
`src/esport/StratsEditeurPanneaux.test.tsx` (panneaux de l'éditeur, Jeux précis), `esport/test/strats-atelier.test.mjs`
(champs du document ajoutés, versions automatiques regroupées, verrou optimiste ; SQLite et PostgreSQL), `esport/test/import-agents.test.mjs`
(import serveur des agents, mur tracé et double dans le document et la page de partage),
`esport/test/import-agents-auto.test.mjs` (import automatique : premier affichage en tâche de fond et single-flight,
cron une fois par jour, réimport après 7 jours, portrait déposé à la main gardé, page publique ; SQLite et PostgreSQL),
`src/esport/StratsPortraits.test.tsx` (pion posé avec la photo, fantôme, repli CDN puis initiales),
`src/esport/strats/assets.test.ts` (ordre des sources, repli sur erreur, liste d'hôtes),
`scripts/e2e-esport-strats.mjs` (navigateur, `PARTIES=parcours,visuel,thefinals,ipad,telephone` et `CAPTURES=<dossier>`
pour les captures : atelier plein écran, **place du canevas mesurée** et absence de défilement de page, mur posé en
cliquant-glissant et poignées tirées à la souris, glisser depuis le dock, sélection au cadre, menu contextuel,
enregistrement automatique, présentation, The Finals, poignée de regard tirée au doigt sur iPad, téléphone),
`scripts/e2e-debordement-mobile.mjs` (aucun débordement horizontal de l'atelier sur téléphone : lecture, édition,
menus, tiroir, présentation).
