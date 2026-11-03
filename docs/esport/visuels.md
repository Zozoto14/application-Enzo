# Esport : visuels de la section CM (affiches)

Les **visuels** sont les affiches que le CM publie avec ses posts (annonce de match, résultat, lineup…). Tout est
réglable en permanence : une **charte graphique** du club, des **modèles par défaut** prêts à l'emploi (thème
cyberpunk), un **éditeur complet** pour les retoucher ou en créer, et la **génération** d'images PNG / JPEG à la taille
exacte de chaque réseau, jointes directement à la carte post.

Entrée : **Esport › Teams › CM du club › Visuels** (onglets Modèles, Visuels générés, Charte graphique) et, sur une carte post, le
panneau **Visuels** (bouton **Générer le visuel**). Migrations : `esport/migrations/0025_cm_visuels.sql`,
`0038_cm_drive_nouveautes_visuels_dossiers.sql` (dossiers).
Code : `esport/noyau/cm/visuels/`, `src/esport/cm/visuels/`, `src/esport/ui/cm/visuels/`, textes
`src/esport/i18n/visuels.ts`.

## Charte graphique

**CM › Visuels › Charte graphique** (lecture pour qui voit la section, modification avec `cm.gerer` du club) :

- **nom du club** (champ `{club}`) et nom du thème ;
- **palette** de 9 couleurs : fond, fond (dégradé), primaire (néon), secondaire, accent, texte, texte atténué,
  victoire, défaite ;
- **polices** par rôle (titres, sous-titres, texte courant, chiffres) parmi les polices embarquées, licence
  **SIL OFL** : **Orbitron**, **Chakra Petch**, **Share Tech Mono** (style cyberpunk / tech) et **Manrope** (lisible).
  Elles viennent des paquets `@fontsource/*` et sont servies par l'app elle-même : **aucun service de polices
  externe** au rendu ;
- **effets** : néon (intensité des lueurs), glitch sur les titres, scanlines, grain ;
- **logos** : celui du club et un par team (images importées). Sans logo, un **monogramme** néon est dessiné.

**Thème cyberpunk par défaut** (cyan et magenta sur nuit violette, scanlines, grain) ; **Revenir au thème
cyberpunk** le rétablit (logos et nom gardés). Les modèles utilisent des **jetons** de charte
(`charte:primaire`, `charte:titre`…) : **changer la charte change tous les modèles qui l'utilisent**, sans les
toucher. Un visuel déjà généré avec une ancienne charte est signalé « La charte a changé depuis le rendu ».

## Modèles par défaut

Onze genres, chacun en **4 formats** — carré **1:1** (1080×1080), portrait **4:5** (1080×1350), story **9:16**
(1080×1920, contenu dans les zones sûres d'Instagram et de TikTok), paysage **16:9** (1920×1080) — et en **français
et anglais** :

| Genre | Données | Contenu |
| --- | --- | --- |
| Annonce de match | un match de tournoi à venir | logos, adversaire, date, heure et fuseau (« CEST »), tournoi et tour, BO |
| Jour de match | un match à venir | « MATCH DAY », heure, affiche, tournoi |
| Lineup / roster | un tournoi (roster inscrit) ou la team (membres) | liste des joueurs et rôles, logo |
| Résultat | un résultat | **série** : issue (couleur victoire / défaite), score `2 - 1`, détail des maps / manches avec scores ; **classement multi-équipes** : place, points, classement des équipes (la nôtre surlignée) |
| Classement final | un tournoi terminé | place, « 3e sur 16 », parcours, bilan, gains |
| MVP / joueur du match | un résultat (ou un membre) | pseudo du MVP, agent / personnage (image de l'agent pour Valorant), affiche et score |
| Recrue / Départ | un membre | pseudo, poste (postes du profil de jeu choisis dans sa fiche du trombinoscope, sinon son rôle), team, logo ; champs `{elo}` et `{ancienne_structure}` (si visibles de tous les membres, voir [trombinoscope.md](trombinoscope.md)), `{badges}` (badges du club et de la team) |
| Programme de la semaine | une semaine (club : toutes les teams ; ou une team) | une ligne par match publiable : jour, date, heure, affiche |
| Bannière tournoi / inscription | un tournoi | nom, organisateur, date, lieu, format, cashprize |
| Citation / annonce libre | — | texte libre, signature `{club}` |

Les modèles par défaut sont **dans le code de l'app** (`src/esport/cm/visuels/modeles.ts`) : ils évoluent avec
l'app et suivent toujours la charte. Pour en changer un : **Dupliquer** (il devient un **modèle du club**, éditable,
avec ses 4 formats) ou **Ouvrir** puis **Enregistrer comme modèle du club**.

## Dossiers

Les **modèles du club** et les **visuels générés** se rangent dans des **dossiers**, dans le style du Drive (mêmes
briques : fil d'Ariane, arborescence latérale, glisser-déposer, toast « Annuler » ; voir [drive.md](drive.md),
« Déplacer à la souris ») :

- une arborescence par **espace** (club, ou une team : choix **Espace** en haut des onglets Modèles et Visuels
  générés), commune aux modèles et aux visuels ; chaque dossier dit combien il contient de modèles et de visuels ;
- **dossiers par défaut**, créés à la première ouverture : **Annonces**, **Résultats**, **Recrues**, **Programmes**,
  **Sponsors**, **Divers** (noms traduits tant qu'on ne les renomme pas ; ils restent à la racine et ne se suppriment
  pas) ;
- un modèle ou un visuel créé **sans dossier** va dans celui de **son genre** : annonce, jour de match, lineup,
  bannière → Annonces ; résultat, classement, MVP → Résultats ; recrue, départ → Recrues ; programme → Programmes ;
  annonce libre → Divers. Une copie de modèle reste dans le dossier de l'original ;
- **créer**, **renommer** (« Rétablir le nom par défaut »), **déplacer** (jamais dans lui-même ni un sous-dossier ;
  8 niveaux, 500 dossiers par espace), **supprimer** (le contenu **remonte** dans le dossier parent : rien n'est
  perdu) ; glisser-déposer des modèles, visuels et dossiers (sélection multiple, cadre, Ctrl / Maj-clic, appui long
  sur écran tactile) ou menu **« ⋯ » › Déplacer vers…** ;
- **vue grille ou liste**, **recherche** par nom (dossiers, modèles, visuels de l'espace) ; les 11 modèles par défaut
  restent en tête de la racine de l'onglet Modèles ;
- **Générer le visuel** (depuis une carte post ou la galerie) propose le **dossier** où ranger les visuels : « Selon
  le genre », la racine, ou n'importe quel dossier de l'espace (« Résultats › Playoffs ») ; depuis la galerie, le
  dossier ouvert est proposé.

Droits : voir les dossiers avec `cm.voir` (club : qui voit la section) ; créer, renommer, déplacer, supprimer et
ranger avec `cm.editer` de l'espace. API : `GET|POST /cm/visuels/dossiers` (`?portee` ; `{ portee, parentId, nom }`),
`PATCH|DELETE /cm/visuels/dossiers/:id` (`{ nom?, parentId? }`), `POST /cm/visuels/deplacer { elements: [{ genre:
modele | visuel | dossier, id }], dossierId }` (rend `faits`, `erreurs`, `avant` pour « Annuler ») ;
`POST /cm/modeles` et `POST /cm/visuels` acceptent `dossierId` (null : racine). Code :
`esport/noyau/cm/visuels/dossiers.mjs`, `src/esport/ui/cm/visuels/Dossiers.tsx`.

## Données et champs dynamiques

Un texte de calque contient des **champs** remplacés au rendu : `{team}`, `{adversaire}`, `{score}`,
`{score_nous}`, `{score_eux}`, `{issue}`, `{tournoi}`, `{tour}`, `{date}`, `{date_courte}`, `{jour}`, `{heure}`,
`{fuseau}`, `{date_heure}`, `{bo}`, `{format}`, `{lieu}`, `{place}`, `{classement}`, `{points}`, `{participants}`,
`{mvp}`, `{mvp_agent}`, `{joueur}`, `{poste}`, `{semaine}`, `{bilan}`, `{cashprize}`, `{gains}`, `{organisateur}`,
`{genre_match}`, `{titre}`, `{phrase}`, `{jeu}`, `{club}`, `{adversaires}`, `{victoire}`. Un champ inconnu reste écrit
tel quel. Les **listes** répètent une ligne par élément : `manches` (`{carte}`, `{score}`, `{issue}`, `{place}`,
`{points}`), `classement` (`{place_texte}`, `{equipe}`, `{points}`), `roster` (`{pseudo}`, `{role}`), `programme`
(`{jour}`, `{date}`, `{heure}`, `{team}`, `{adversaire}`, `{tournoi}`), `parcours` (`{tour}`, `{adversaire}`,
`{score}`, `{issue}`).

Les valeurs sont calculées par le **serveur**, en français ET en anglais, depuis les **résumés publiables**
(`competition/resume.mjs`) : le système de score vient du **profil de jeu** (série avec maps, ou classement à
plusieurs équipes), la date et l'heure du **fuseau de la team**. Images : logos de la charte, maps et agent du MVP
(assets du jeu pour Valorant). **Jamais de contenu non publiable** (résultat staff, scrim non publiable : 409
`non-publiable`).

**Conditions d'affichage** d'un calque : toujours, « score de série », « classement », ou « si le champ `{x}` est
rempli » (ou vide) — c'est ainsi que le modèle Résultat s'adapte au profil.

## Éditeur

Site et app PC (Konva, **chargé à la demande** : ni Konva ni les polices n'alourdissent le reste de l'app) :

- **calques** texte, image, forme (rectangle, ellipse, ligne, losange, hexagone, coins coupés), logo (club, team,
  adversaire), liste, et insertion de **champs** ;
- **déplacer, redimensionner, faire pivoter** (poignées), **magnétisme** (bords, centre, autres calques ; guides
  roses), **alignements**, **ordre** (monter, descendre, premier / arrière-plan), **verrouiller**, **masquer**,
  **dupliquer**, **supprimer** ; **opacité**, **ombre**, **contour**, **lueur néon**, **glitch**, **dégradés** ;
  polices, tailles et couleurs de la charte (ou couleur libre `#RRGGBB`) ; texte « réduire pour tenir » ;
- **import d'images** (envoi par morceaux de la section CM : PNG, JPEG, GIF, WebP, 15 Mo, 8192 px de côté au plus) ;
- **annuler / rétablir** (Ctrl+Z, Ctrl+Maj+Z), **zoom**, **zones sûres** par réseau (Instagram, TikTok, X), alerte si
  un texte en sort ;
- modèle : tous les formats, aperçu FR / EN avec des **données d'exemple** (série BO3 ou classement à 4 équipes) ;
  **versions** (30 gardées, **Restaurer**) ; **Dupliquer** ;
- **Télécharger en PNG / JPG** à la taille exacte.

Raccourcis : Suppr efface, Ctrl+D duplique, flèches déplacent (Maj : 10 px), Échap désélectionne.

**Sur téléphone** : le site garde l'éditeur (glisser au doigt, canevas à la largeur de l'écran, panneaux en
dessous). L'**app iPhone / Android** consulte les rendus et permet la **retouche des textes** (FR / EN) d'un visuel ;
le rendu est refait au prochain « Générer » sur le site ou l'app PC.

## Générer un visuel

- **Depuis une carte post** (panneau Visuels) : **Générer le visuel** propose le genre d'après la **suggestion
  automatique** qui a créé la carte (tournoi → bannière, J-1 → annonce, jour J → jour de match, résultat → résultat,
  classement final → classement) ou d'après ses liens (résultat, match, tournoi, joueurs) ; on choisit le modèle (par
  défaut ou du club), les formats et les langues : un visuel par format et par langue, rendu et **joint à la carte**
  (pièce jointe PNG).
- **Depuis CM › Visuels › Visuels générés** : **Générer** sans carte ; **Retoucher** ouvre l'éditeur.

Le rendu est fait par le navigateur (le même dessin que l'aperçu de l'éditeur), envoyé par morceaux, puis
**vérifié par le serveur** : PNG ou JPEG, **taille exacte** du format, 25 Mo au plus. Il remplace le rendu précédent
sur la carte. Comme toute pièce jointe, il **repasse un post validé « à valider »**.

**Régénération** : chaque visuel garde l'empreinte des données, la version de la charte et celle du modèle de son
dernier rendu ; le panneau signale « Les données ont changé » (score corrigé, match redaté…), « La charte a changé »,
« Le modèle a changé » et propose **Régénérer**. Un visuel **retouché** (document propre, qui ne suit plus le
modèle) demande une **confirmation** : ses retouches sont gardées, seuls les champs dynamiques changent ; **Revenir au
modèle** abandonne les retouches. Si les données changent pendant la génération, le serveur répond 409
`donnees-changees` et l'app relit puis refait le rendu.

## Sécurité

- Documents **validés par le serveur** (`visuels/document.mjs`) : types de calques, nombres bornés, couleurs
  `#RRGGBB[AA]` ou jetons, polices de la liste, 120 calques, 256 Ko ; textes nettoyés (caractères de contrôle) et
  bornés. Le texte est **dessiné tel quel** dans un canevas : rien n'est interprété comme du HTML.
- **Images** : jamais une adresse. Une image est un **fichier CM importé** (lu par lien signé du serveur Esport,
  2 h), un **asset du jeu** (origines Riot autorisées ou dossier local de l'app) ou un champ de données. Elles sont
  lues par `fetch` puis données au canevas en URL `blob:` locale : le canevas n'est **jamais « contaminé »** (export
  possible), aucune URL externe arbitraire n'est chargée (les images des profils de jeu sur d'autres hôtes et les
  `logo_url` externes des teams ne sont pas utilisées : logos de la charte, sinon monogramme). SVG refusé.
- Tailles : images importées 15 Mo et 8192 px, rendus 25 Mo, dimensions vérifiées dans l'en-tête du fichier.
- Débit : 200 rendus / images par compte et par heure.

## Droits

| Action | Permission |
| --- | --- |
| Lire la charte, les modèles du club | `cm.voir` (club ou une team) |
| Modifier la charte, les logos | `cm.gerer` du club |
| Créer, modifier, dupliquer, supprimer un modèle ; créer, retoucher, générer un visuel | `cm.editer` de la portée (club ou team) |
| Lire les données d'une source | `cm.editer` sur la team, contenu publiable |

Un modèle ou un visuel appartient à une **portée** (club ou team) ; le correspondant d'une team (Manager) voit ceux
de sa team et du club, sans les modifier s'il n'a pas `cm.editer`.

## Données (migration 0025)

| Table | Contenu |
| --- | --- |
| `cm_charte` | charte du club (JSON validé), version |
| `cm_modeles`, `cm_modele_versions` | modèles du club (un document par format), anciennes versions (30) |
| `cm_visuels` | visuels générés : modèle, format, langue, source, retouche, rendu (fichier, pièce jointe), état au dernier rendu |
| `cm_visuel_images` | images importées dans l'éditeur et logos |
| `cm_visuels_dossiers` (migration 0038) | dossiers des modèles et visuels (portée, parent, nom ou clé du dossier par défaut) ; `dossier_id` sur `cm_modeles` et `cm_visuels` |

Les fichiers (images, rendus) sont des `cm_fichiers` (stockage privé de la section CM). Tout est dans l'**export /
import de la base**. **RGPD** : l'export d'un compte liste ses modèles et visuels (et les dossiers qu'il a créés) ; à la suppression, ils restent sans
auteur, et un visuel dont la source était ce membre (recrue, départ) perd cette source (le rendu reste).

## API (préfixe facultatif `/api/esport`)

| Route | Droit |
| --- | --- |
| `GET\|PUT /cm/charte` (`{ charte, version }` ou `{ reinitialiser: true }`) | voir ; gerer (club) |
| `GET\|POST /cm/visuels/images` (`{ portee, envoi }`) ; `POST /cm/visuels/fichiers/:id/lien` | voir ; editer |
| `GET /cm/visuels/donnees?portee&genre&teamId&id&date` | editer |
| `GET\|POST /cm/modeles` ; `GET\|PATCH\|DELETE /cm/modeles/:id` (`version`) ; `POST …/dupliquer` ; `GET …/versions[/:v]` ; `POST …/versions/:v/restaurer` | voir ; editer |
| `GET\|POST /cm/visuels` ; `GET\|PATCH\|DELETE /cm/visuels/:id` ; `POST …/rendu` (`{ envoi, empreinte }`) ; `POST …/carte` ; `POST …/lien` | voir ; editer |
| `GET /cm/cartes/:id/visuels` (visuels et proposition) | voir |

Journal : `cm.charte_modifiee`, `cm.modele_cree`, `cm.modele_modifie`, `cm.modele_supprime`, `cm.visuel_genere`.

## Tests

`esport/test/visuels.test.mjs` (SQLite et PostgreSQL : validation des documents et entrées hostiles, charte,
dimensions des images, données Valorant BO3 et multi-équipes, annonce avec fuseau, roster, programme, permissions,
versions, rendu à la taille exacte joint à la carte, invalidation, données changées, RGPD, export / import) ;
`esport/test/drive-deplacer-nouveautes.test.mjs` (dossiers : par défaut, rangement par genre, dossier choisi, déplacer,
cycles, suppression, permissions) ;
`src/esport/Visuels.test.tsx` (plan de rendu selon le profil, 11 × 4 modèles, sérialisation, éditeur, écrans).

## Pour le Fondateur

1. Mettre à jour le serveur Esport (la migration `0025_cm_visuels.sql` s'applique seule) et publier le site et
   l'app PC (nouvelles polices embarquées).
2. **CM › Visuels › Charte graphique** : nom du club, logos du club et des teams ; ajuster couleurs et polices quand
   la nouvelle identité est fixée (tous les modèles suivent).
3. Ouvrir une carte post (ou une suggestion automatique) › **Générer le visuel**.
