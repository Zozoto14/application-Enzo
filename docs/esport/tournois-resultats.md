# Esport : tournois et résultats

Deux modules de team, activables séparément, rangés dans la section **Compétition** (entre Jeu et Équipe) :
**Tournois** (`tournois`) et **Résultats** (`resultats`). Tout se saisit à la main (aucun import de plateforme) et
tout suit le **profil de jeu** de la team ([profils-jeu.md](profils-jeu.md)) : formats (taille et nombre
d'équipes, BO), système de score (rounds avec mi-temps et prolongations, points, manches, classement), maps,
modes, personnages, taille du roster. Migration : `esport/migrations/0022_tournois_resultats.sql`.

Ces deux modules préparent la future section CM (annonces, résultats, visuels) : chaque résultat, annonce de
match et tournoi a un **résumé publiable** (données propres + phrase FR / EN), sans que la section CM existe déjà.

## Qui fait quoi

| Rôle (système) | Tournois | Résultats |
| --- | --- | --- |
| Propriétaire | tout | tout |
| Manager, Coach | voir, gérer (`tournois.voir`, `tournois.gerer`) | voir, saisir (`resultats.voir`, `resultats.saisir`) |
| Analyste | voir | voir, saisir |
| Joueur, Remplaçant | voir | voir (pas les résultats « staff ») |

La migration donne ces permissions aux rôles système des teams existantes ; les rôles personnalisés ne changent
pas. Les modules ne sont **pas activés d'office** sur les teams existantes : **Paramètres de la team › Modules**
(section Compétition). Le preset « Team Valorant complète » les active pour une nouvelle team.

Contrôles de chaque route : session → appartenance (404) → module activé (404) → permission (403) ; toute
requête filtre sur la team. Un résultat « staff seulement » est introuvable (404) sans `resultats.saisir`.

## Tournois

**Fiche** : nom, organisateur, lien (https), dates (début, fin), en ligne ou sur place (adresse), **format choisi
dans le profil du jeu** (ex. 5v5, 3v3v3v3) et BO permis par ce format, **phases** (poules, simple ou double
élimination, ronde suisse, championnat, libre ; 8 au plus), frais d'inscription, cashprize (montant, devise, détail),
statut (**à venir, inscrits, en cours, terminé, annulé**), notes, « publiable » (Discord et future section CM).

**Roster** : membres de la team, titulaires et remplaçants, bornés par le profil (Valorant : 5 titulaires, 2
remplaçants). Un membre touché passe titulaire, puis remplaçant, puis sort.

**Inscription et check-in** : date limite d'inscription et fenêtre de check-in (heures murales de la team).
**Inscrire la team** demande assez de titulaires (le format du jeu : 5 pour Valorant) et une date limite pas
encore passée ; le statut passe à « Inscrits » et le roster est prévenu. Le check-in n'est possible qu'inscrit et
dans sa fenêtre. **Désinscrire** revient à « À venir ».

**Parcours** (bracket simple saisi à la main) : des matchs rangés par phase et par tour, avec leur(s)
adversaire(s), leur date, leur BO et leur résultat :

- **résultat rapide** (victoire, défaite, nul, forfait, score libre « 2-1 ») directement dans le tournoi ;
- **résultat détaillé** (module Résultats) : « Saisir le résultat détaillé » ouvre le formulaire, match prérempli ;
  le parcours montre alors le score calculé.

**Matchs ↔ planning** : un match **daté** crée un événement **Tournoi** au planning (titre « Tournoi · Tour vs
Adversaire », adversaire lié, lien ou lieu du tournoi), dont la **convocation est le roster** (titulaires et
remplaçants actifs ; un Propriétaire n'est convoqué que s'il est au roster). Les réponses (RSVP), rappels J-1 / H-1,
« C'est maintenant », la présence et les statistiques s'y appliquent comme à tout événement. L'événement suit le
match (date, tour, adversaire, notes) et le roster (convocation des matchs à venir) ; un match annulé, supprimé ou
sans date quitte le planning (un match joué y reste, pour la présence). Il faut le module Planning et les droits de
créer / modifier / supprimer au planning : sinon le match est gardé sans événement et l'écran le dit. Un tournoi
annulé ou supprimé retire ses matchs à venir du planning.

**Classement final et gains** : place finale (pas plus loin que le nombre d'équipes), participants, gains et leur
détail ; **marquer « terminé »** publie le classement final (Discord, notifications au roster).

## Résultats

Un résultat se saisit pour tout match : **match de tournoi** (lié à un match du parcours), **match officiel** ou
**scrim**, éventuellement lié à un **événement du planning** (date et adversaire repris). Il est structuré par le
profil du jeu :

| Système | Quand | Saisie | Calcul |
| --- | --- | --- | --- |
| **Série** | format à deux équipes | BO du format ; une manche par map / game ; map et mode du profil | victoire, défaite ou nul ; manches gagnées (2-1) |
| **Classement** | plus de deux équipes (3v3v3v3), ou score de type « placement » | place et points de chaque manche (points du barème du profil par défaut) ; classement des autres équipes facultatif ; place finale et nombre d'équipes | place finale (et points) |

Validation d'une manche selon le type de score :

- **rounds** (Valorant : 13 rounds pour gagner, 12 par mi-temps, prolongations) : total « 13-11 », ou détail par
  mi-temps (6-6 / 6-6) et prolongations (2-0) cohérent avec le total. En temps réglementaire, le vainqueur a
  exactement les rounds pour gagner ; à égalité « rounds-1 partout » (12-12), prolongations jusqu'à l'**écart** du
  profil (2 par défaut : 14-12, 15-13… ; réglable dans le profil : « Écart pour gagner »). Refusés : 13-12, 16-12,
  12-10, 14-10. Sans prolongations, 12-12 après toutes les mi-temps est un nul.
- **points** : le vainqueur atteint les points pour gagner, le perdant non.
- **manches** : chaque manche gagnée, perdue ou nulle (score facultatif) ; la série se gagne avec les manches du profil.
- **aucun** (profil sans système de score) : score libre, le plus grand gagne.

Série : ⌊BO/2⌋+1 manches pour gagner (BO3 : 2), aucune manche après la décision, série complète ; BO pair : nul
possible. **Forfait** (gagné / perdu) : sans manche.

Aussi : **joueurs alignés** (membres de la team, autant que le format plus les remplaçants), **personnages joués**
(ceux du profil, facultatif), **MVP** (un aligné), **statistiques libres** (« kills=24, acs=268 », 15 au plus par
joueur), **review vidéo** liée, notes, **visibilité** (toute la team, ou staff seulement), **publiable** (par défaut
oui, sauf un scrim ; jamais un résultat staff).

Un refus du serveur dit **quoi** et **où** (« Manche 1 : en prolongations, le vainqueur gagne avec l'écart prévu par
le jeu (ex. 14-12). ») ; un aperçu de l'issue s'affiche pendant la saisie.

### Historique et bilans

Filtres : jeu, tournoi, adversaire, période (du … au, dates de la team), map, type de match, issue. Bilans
(mêmes définitions partout) :

- **taux de victoire** = victoires ÷ séries (un nul n'est pas une victoire) ; les classements à plusieurs équipes
  n'y entrent pas : ils ont leur **place moyenne**, leurs **1res places** et leurs **podiums** ;
- **par map** : les manches jouées sur la map (un BO3 compte deux ou trois manches) ;
- **par adversaire** : les séries face à lui ;
- **série en cours**, records (victoires et défaites de suite), **forme** (5 dernières séries).

**Vue par adversaire** : bilan face à lui, ses résultats, prochains matchs (tournoi et planning), et **Ouvrir le
scouting** pour qui voit le scouting (donnée sensible : un Joueur ne voit que le nom et le logo).

Adversaires : ceux du **scouting** ; **création rapide** d'une fiche (nom) depuis un tournoi ou un résultat
(`tournois.gerer` ou `resultats.saisir`, sans doublon de nom) ; une équipe d'une manche à plusieurs équipes peut
aussi rester un simple nom. Le nom est gardé avec chaque résultat : l'historique reste lisible si la fiche est
supprimée.

## Accueil, Dashboard, statistiques

- **Accueil de la team** : bloc « Compétition » (prochains matchs de tournoi, tournois à venir, derniers résultats,
  forme), selon les modules et les droits.
- **Dashboard** : chaque carte de team montre les prochains matchs de tournoi et les derniers résultats.
- **Statistiques (Fondateur)** : pages « Compétition › Tournois / Résultats », actions clés « Tournoi créé » et
  « Résultat saisi » (fonctionnalité « Tournois et résultats »), reconstituées aussi depuis le journal.

## Bus, journal, notifications, Discord

Événements : `tournoi.cree`, `tournoi.modifie`, `tournoi.roster_change`, `tournoi.inscrit`, `tournoi.checkin`,
`tournoi.statut_change`, `tournoi.termine`, `tournoi.annule`, `tournoi.supprime`, `tournoi.match_ajoute`,
`tournoi.match_planifie`, `tournoi.match_modifie`, `tournoi.match_supprime`, `match.resultat_saisi`,
`match.resultat_modifie`, `match.resultat_supprime`. Journal : modules « Tournois » et « Résultats » (filtres).

Notifications : roster prévenu de l'inscription et du classement final ; joueurs alignés prévenus d'un résultat
visible de toute la team ; matchs datés : notifications et rappels habituels du planning (convoqués).

Discord (**Réglages › Discord**, un interrupteur, un modèle et un rôle à mentionner par message : c'est l'**option
de la team** pour publier ou non ; tous activés par défaut, seulement si le module Discord est actif) :

| Message | Quand | Contenu de l'embed |
| --- | --- | --- |
| Inscription à un tournoi | `tournoi.inscrit` | dates, format, lieu, roster ; bouton « Page du tournoi » |
| Annonce d'un match de tournoi | `tournoi.match_planifie` (match daté ou redaté) | horodatage, adversaire et logo, format / BO, lieu, roster. **Remplace** l'annonce « Nouvel événement » de son événement au planning (les rappels restent) |
| Résultat d'un match | `match.resultat_saisi` | victoire (vert) / défaite (rouge) / nul, ou place (or pour une 1re place) ; tournoi et tour, adversaires, format, maps et manches (score, « prol. »), points, MVP, alignés et personnages |
| Classement final d'un tournoi | `tournoi.termine` | classement « 3e sur 16 », gains, parcours (tours, adversaires, scores), roster |

Comme les autres messages : **anglais d'abord, puis la version française dans un fil** ([discord.md](discord.md)),
embed reconstruit **au moment de l'envoi** depuis le résumé publiable (un résultat devenu staff, non publiable ou
supprimé entre-temps ne part pas), aucune mention ailleurs que le rôle choisi. Rien ne part pour un tournoi « non
publiable », un résultat staff, ni un scrim non coché « publiable ».

## Résumé publiable (pour la future section CM)

Service `esport/noyau/competition/resume.mjs` : `resumeResultat`, `resumeAnnonce`, `resumeTournoi` (base + team +
id + langue) rendent des données propres (noms, score « 2-1 », maps et scores, prolongations, place « 1er sur 16 »,
gains formatés, roster, parcours, jeu et couleur, logo de team) et une **phrase** FR / EN (« Victoire 2-1 contre
Nova », « Victory 2-1 vs Nova », « Coupe d'automne : 3e sur 16 »), avec `publiable`. Il ne contrôle aucun droit :
l'appelant décide (les routes `…/resume` exigent `resultats.voir` / `tournois.voir`).

## API (préfixe facultatif `/api/esport`)

| Méthode et route | Permission |
| --- | --- |
| `GET /teams/:t/tournois?statut` ; `GET /teams/:t/tournois/:id` | tournois.voir |
| `POST /teams/:t/tournois` ; `PATCH \| DELETE …/:id` | tournois.gerer |
| `PUT …/:id/roster` (`{ titulaires, remplacants }`) ; `POST …/:id/inscription` (`{ annuler? }`) ; `POST …/:id/checkin` | tournois.gerer |
| `POST …/:id/matchs` ; `PATCH \| DELETE …/:id/matchs/:m` (`date`, `heure`, `dureeMin` ou `debut`, `adversaires`, `issue`, `scoreTexte`, `place`, `statut`) | tournois.gerer (+ planning pour l'événement) |
| `GET …/:id/resume?langue` ; `GET /teams/:t/tournois/matchs/:m/resume` | tournois.voir |
| `GET /teams/:t/resultats?jeu&tournoi&adversaire&du&au&carte&genre&issue` ; `GET …/:id` ; `GET …/:id/resume` ; `GET …/adversaires/:a` | resultats.voir |
| `GET /teams/:t/resultats/formulaire` ; `POST /teams/:t/resultats` ; `PATCH \| DELETE …/:id` | resultats.saisir |
| `GET /teams/:t/competition/adversaires` ; `POST …` (`{ nom, logoUrl? }`) | voir l'un des modules ; création : tournois.gerer ou resultats.saisir |
| `GET /teams/:t/competition/accueil` | l'un des modules (chaque bloc selon sa permission) |

Saisie d'un résultat : `{ genre, tournoiMatchId?, evenementId?, date ('AAAA-MM-JJ HH:MM' heure de la team, ou ISO),
formatCle?, bo?, adversaires: [{ id } | { nom }], manches: [{ carteCle, modeCle, nous, eux, miTemps, prolongations,
issue, place, points, classement }], forfait?, placeFinale?, participants?, joueurs: [{ compte, personnages, stats }],
mvp?, reviewId?, visibilite, publiable, notes }`. Refus de score : 400 `score-invalide`, `details: { chemin, raison }`.

## Données (migration 0022)

| Table | Contenu |
| --- | --- |
| `tournois` | fiche, format, phases (JSON), montants en centimes, statut, inscription, check-in, classement, gains |
| `tournoi_roster` | membres inscrits (titulaire / remplaçant) |
| `tournoi_matchs` | parcours : phase, tour, date, adversaires (JSON `{ id, nom }`), événement du planning, résultat |
| `resultats` | genre, liens, jeu, format, système, BO, date, adversaires, score (JSON validé), issue, place, points, visibilité, publiable |
| `resultat_manches` | une ligne par manche : map, mode, issue, score, place, points (filtres et bilans par map) |
| `resultat_joueurs` | alignés : compte, personnages, statistiques |

Comprises dans l'**export / import de la base**. **RGPD** : l'export d'un compte contient ses rosters, les matchs où
il a été aligné (issue, adversaires, MVP, personnages, statistiques) et ce qu'il a saisi ; la suppression du compte
(par lui, le Fondateur ou l'Administration) le retire des rosters, anonymise ses lignes de résultat (statistiques
effacées), retire son MVP et son nom d'auteur — le résultat de la team reste.

Profil de jeu : `score.prolongations.ecart` (facultatif, 1 à 10, défaut 2) a été ajouté au schéma (éditeur :
« Écart pour gagner »).

## Code et tests

- Serveur : `esport/noyau/competition/` — `score.mjs` (règles du profil, validation, calcul : pur), `bilans.mjs` (pur),
  `tournois.mjs`, `resultats.mjs`, `resume.mjs` (résumé publiable), `bus.mjs`, `routes.mjs`, `rgpd.mjs`, `commun.mjs` ;
  Discord : `discord/catalogue.mjs`, `discord/embeds.mjs` (`embedCompetition`), `discord/file.mjs` ; planning :
  `creer` / `modifier` acceptent un usage interne (`adversaireLibre`, charge `tournoiMatchId`).
- App : `src/esport/competition/` (client, libellés, aperçu du score, intention entre écrans),
  `src/esport/ui/competition/` (Tournois, Résultats, FormulaireResultat), `src/esport/ui/AccueilCompetition.tsx`,
  textes `src/esport/i18n/competition.ts` (chargés avec les écrans) et `fr.ts` / `en.ts` (navigation, journal…).
- Graines : `esport/outils/graines-competition.mjs` (`npm run esport:local`).
- Tests : `esport/test/tournois-resultats.test.mjs` (SQLite et PostgreSQL : scores Valorant BO3 avec prolongations et
  The Finals 3v3v3v3, bilans, migration sur base existante, permissions et activation, planning et convocations,
  notifications, Discord, RGPD), `src/esport/Competition.test.tsx`.

## Pour le Fondateur

1. Mettre à jour le serveur Esport (déploiement automatique o2switch, ou `npm run migrer --prefix esport`) : la
   migration `0022_tournois_resultats.sql` s'applique seule.
2. Publier le site et l'app PC comme d'habitude.
3. Dans chaque team concernée : **Paramètres › Modules › Compétition** : activer **Tournois** et / ou **Résultats**.
4. Vérifier le profil du jeu (**Esport › Jeux**) : formats et BO, système de score (Valorant : déjà prêt ; écart des
   prolongations à 2 par défaut), roster, maps du pool ; pour un jeu à plusieurs équipes (The Finals), un format
   « 3v3v3v3 » (4 équipes) et un score « classement » avec son barème.
5. Discord (facultatif) : **Réglages › Discord** : les quatre messages sont activés par défaut ; les couper si la
   team ne veut pas publier ses inscriptions, matchs ou résultats.
