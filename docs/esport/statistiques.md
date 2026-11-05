# Esport : statistiques d'usage (page réservée au Fondateur)

Une page **Esport › Administration › Statistiques**, juste pour le Fondateur : qui utilise l'app, quelles pages sont le plus utilisées
et lesquelles le sont le moins, quand, sur quel appareil, quelles fonctionnalités servent, quelles erreurs arrivent.

- **Où** : dans la navigation de premier niveau, à côté de **Dashboard · Teams · Membres** (barre latérale sur PC et
  iPad paysage, barre d'onglets en bas sur iPhone). L'entrée n'existe **que pour le Fondateur**.
- **Contrôle côté serveur** : `GET /statistiques…` répond **404 « Adresse inconnue »** à tout autre compte, Propriétaire
  compris (on ne dit même pas que la route existe). Couper la collecte et la fiche d'un membre : idem.
- **Délégation** (migration 0033) : le Fondateur peut ouvrir la lecture (tableau, fiche d'un membre) à un rôle du club
  qui a la permission `statistiques.voir` (le « Second CEO » l'a par défaut ; [roles-permissions.md](roles-permissions.md)).
  Couper ou reprendre la collecte reste au Fondateur seul.

## Ce que montre la page

En haut : la **période** (Aujourd'hui, 7 jours, 30 jours, 90 jours, Personnalisée), puis **Filtres** : team, rôle
(Propriétaire, Manager, Coach, Analyste, Joueur, Remplaçant), appareil (PC, tablette, téléphone, app PC, Discord).
Sept onglets :

| Onglet | Contenu |
| --- | --- |
| **Vue d'ensemble** | Utilisateurs actifs aujourd'hui, sur 7 jours, sur 30 jours ; utilisateurs actifs, sessions, durée moyenne d'une session, pages vues, nouvelles inscriptions et invitations acceptées sur la période, chacun avec sa **tendance** par rapport à la période précédente de même durée ; courbe des actifs par jour. |
| **Utilisateurs** | Tous les comptes Esport : dernière activité, sessions, temps total, pages préférées (les 3 plus vues), appareil principal ; pastilles **Jamais connecté** et **Inactif** (absent depuis 7, 14 ou 30 jours, au choix). Recherche, tri (dernière activité, sessions, temps, nom), filtre (tous, actifs, inactifs, jamais connectés). Touchez un membre : sa **fiche** (sessions, pages, appareils, chronologie de son activité, avec les actions du journal). |
| **Pages** | Classement des pages **les plus** et **les moins** utilisées (vues, visiteurs uniques, temps moyen) ; les pages **jamais ouvertes** sur la période ; les **modules activés mais pas utilisés**, par team ; le tableau complet. |
| **Activité** | Carte de chaleur **heure × jour de la semaine** (heure de Paris), courbe quotidienne, répartition par **appareil** et par **langue**, tableau jour par jour. |
| **Teams** | Comparaison des teams : membres, membres venus (taux d'adoption), pages vues, temps, actions. |
| **Fonctionnalités** | Usage des actions clés : connexions, planning, réponses aux événements (RSVP), disponibilités, résumés de réunions, review vidéo (repères, commentaires), strats et playbook, ressources publiées, objectifs et tâches, scouting, commandes du **bot Discord**. |
| **Qualité** | Les **erreurs JS** les plus fréquentes : message (nettoyé), page, nombre d'occurrences, utilisateurs touchés, dernière fois. |

Chaque tableau a **Exporter (CSV)** (comme les autres exports de l'Esport : UTF-8 avec BOM, virgules). Le menu **⋯**
de la page permet de **désactiver la collecte** (et de la réactiver).

Graphiques maison, sans bibliothèque ajoutée : barres et carte de chaleur en vues natives, courbe en SVG sur le site
et l'app PC (colonnes sur iPhone/iPad natifs). Une seule teinte (l'accent du thème) dont l'intensité porte la valeur,
toujours accompagnée du chiffre écrit : lisible en clair et en sombre dans les 8 thèmes ; survol (PC) ou appui
(tactile) pour le détail ; libellés pour les lecteurs d'écran. Sur le site, la page est chargée à la demande (fichier
séparé de ~30 Ko) : le bundle principal ne grossit pas.

## Ce qui est collecté, et ce qui ne l'est pas

L'app note, **par compte**, uniquement des métadonnées :

- la **page ou section ouverte**, par un identifiant de route stable (`esport.dashboard`, `esport.membres`,
  `team.agenda.planning`, `team.jeu.resources`, `team.reglages.journal`… : liste dans
  `esport/noyau/usage/pages.json`) et la team concernée ;
- la **durée** passée sur la page, mesurée par l'app et envoyée quand on change de page ou que l'app passe en
  arrière-plan (bornée à 4 h) ;
- les **actions clés** (liste fermée) : connexion (ouverture de l'Esport), création d'événement, RSVP, présence
  marquée, disponibilités, dépôt de réunion, résumé publié, review créée, repère ajouté, commentaire de review, strat
  créée ou modifiée, ajout au playbook, ressource publiée, tâche, objectif, fiche de scouting, tournoi créé, résultat saisi ; les **commandes du bot
  Discord** sont comptées par le serveur pour le compte lié ;
- le **type d'appareil** (PC, tablette, téléphone, app PC) et la **langue** de l'app ;
- les **erreurs JS** (exceptions non rattrapées) : message tronqué à 200 caractères et **nettoyé** (adresses web,
  e-mails, identifiants, jetons et nombres longs retirés), et la page concernée.

**Jamais** : le contenu saisi (titres, notes, messages…), l'adresse IP (aucune colonne ne la reçoit), l'agent
utilisateur complet, une empreinte d'appareil, ni aucun traceur ou service tiers. Un identifiant de session tiré au
hasard par l'app à chaque ouverture permet de compter les sessions (aucun lien avec la session de connexion).

### Sobriété (hébergement mutualisé o2switch)

Les événements restent en mémoire et partent **par lots** : au plus **un envoi toutes les 45 s**, et seulement s'il y
a quelque chose à envoyer (un membre qui lit une page sans bouger n'envoie rien). Jamais deux envois en même temps ;
après un échec, les essais s'espacent (2, 4 puis 8 intervalles). Au départ de la page (onglet masqué, fermeture,
app en arrière-plan), un dernier lot part avec `keepalive`. 100 événements au plus par lot, et le serveur borne à
**150 lots par heure et par compte** (429 au-delà). Le serveur écrit chaque lot en une seule requête groupée.

### Stockage, agrégation, rétention

Migration **`0018_statistiques_usage.sql`** (SQL commun SQLite / PostgreSQL) :

| Table | Contenu | Durée |
| --- | --- | --- |
| `usage_evenements` | détail brut des lots | **90 jours** (une fois agrégé), puis purgé par le cron |
| `usage_jour_pages` | par jour, membre, team, page, appareil : vues, temps | illimitée |
| `usage_jour_membres` | par jour, membre, appareil : sessions, vues, temps, actions, erreurs, langue, première et dernière activité | illimitée |
| `usage_jour_actions` | par jour, membre, team, action clé, appareil | illimitée |
| `usage_jour_heures` | par jour, heure (Paris), membre, team, appareil | illimitée |
| `usage_jour_erreurs` | par jour, empreinte du message, page, membre, appareil | illimitée |
| `usage_reglages` | collecte active, premier jour mesuré, dernier jour agrégé | — |

Les agrégats sont calculés **une fois par jour** par la tâche planifiée (cron cPanel toutes les 5 minutes : l'étape « agrégation de l'usage » ne travaille que lorsqu'un jour de Paris est terminé
depuis plus d'une heure, et rattrape les jours manquants). La page lit les agrégats pour les jours passés et le détail
brut pour les jours pas encore agrégés (aujourd'hui) : les chiffres sont les mêmes avant et après l'agrégation. Les
filtres par team, rôle et appareil restent exacts sur n'importe quelle période (une ligne d'agrégat par combinaison).

### Historique d'avant la mise en ligne

Les données mesurées commencent au premier lot reçu (date affichée en haut : « Mesuré depuis le … »). Pour les jours
d'avant, l'écran **reconstitue** une partie de l'historique à partir du **journal d'activité** (actions des membres :
actifs par jour, fonctionnalités, actions par team, dernière activité) et des **premières connexions** (`active_le`
des comptes). Ces jours sont marqués **≈** (courbe en pointillés, « reconstitué ») : pas de pages, de durées ni de
sessions pour eux. La reconstitution dépend de la durée de conservation du journal de chaque team.

## Confidentialité et RGPD

- La **mention d'information** de l'app (premier passage, Teams, Paramètres) dit désormais : « Statistiques d'usage
  internes, visibles par l'administrateur (le Fondateur) … jamais de contenu ni d'adresse IP, sans traceur tiers
  (détail gardé 90 jours, puis seulement des totaux par jour). »
- **Export** (membre ou Fondateur) : la clé `usage` contient le détail brut du compte (90 jours), ses totaux par jour
  et par page.
- **Suppression du compte** (par le membre, par le Fondateur, ou dans l'Administration) : tout son usage est effacé
  (détail et agrégats), dans le même lot que le reste.
- **Désactiver la collecte** : Statistiques › **⋯** › **Désactiver la collecte**. Le serveur ignore alors les lots
  (réponse `{ actif: false }`) et l'app s'arrête d'envoyer jusqu'à sa prochaine ouverture ; les données déjà là
  restent consultables. **Réactiver la collecte** la rétablit.

## Actions du Fondateur

1. **Mettre à jour le serveur Esport** : la migration `0018_statistiques_usage.sql` est appliquée par le déploiement
   automatique du serveur o2switch (ou `npm run migrer --prefix esport`). Rien à configurer : la collecte démarre seule.
2. **Publier le site** (et l'app PC) comme d'habitude, pour que les membres envoient leurs statistiques.
3. Ouvrir **Esport › Administration › Statistiques**. Les premiers chiffres arrivent dès que les membres utilisent l'app ; avant, la
   page montre l'historique reconstitué depuis le journal.
4. Facultatif : prévenir les membres (la mention de l'app est déjà à jour), ou couper la collecte depuis le menu ⋯.

## Pour les développeurs

- Serveur : `esport/noyau/usage/collecte.mjs` (ingestion, agrégation, purge, RGPD, bot) et
  `esport/noyau/usage/statistiques.mjs` (lecture, 404 hors Fondateur) ; routes dans `esport/noyau/api.mjs`
  (`POST /usage`, `GET /statistiques`, `GET /statistiques/membres/:compte`, `GET|PUT /statistiques/reglages`) ; limite
  `usage` dans `limites.mjs` ; étapes du cron dans `cron.mjs`.
- App : collecteur `src/esport/usage/collecteur.ts` (lots, durées, keepalive, recul), branchement
  `src/esport/usage/index.ts` (visibilité, erreurs JS, actions clés déduites des appels réussis de l'API), écran
  `src/esport/ui/Statistiques.tsx` et `src/esport/ui/graphiquesUsage/`.
- Nouvelle page : ajouter son identifiant dans `esport/noyau/usage/pages.json` (pour « jamais ouvertes ») ; nouvelle
  action clé : `pages.json` (`actions`) et un motif dans `collecteur.ts` (`actionDAppel`).
- Tests : `esport/test/statistiques.test.mjs` (SQLite et PostgreSQL), `src/esport/usage/collecteur.test.ts`,
  `src/esport/Statistiques.test.tsx`, bout en bout `scripts/e2e-esport-statistiques.mjs`.
