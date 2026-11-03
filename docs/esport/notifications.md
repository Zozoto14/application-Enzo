# Centre de notifications (Esport)

Migration `0038_centre_notifications.sql`. Code serveur : `esport/noyau/notifications/` (`regles.mjs`,
`droits.mjs`, `centre.mjs`, `routes.mjs`). App : `src/esport/notifications/` (API, logique) et
`src/esport/ui/notifications/CentreNotifications.tsx`. Textes FR/EN : `src/esport/i18n/notifications.ts`.

## Où le trouver

- **Cloche** dans l'en-tête de l'app Esport (téléphone comme PC), avec la pastille des non lues. Sur téléphone, la
  barre du bas ne gagne aucune entrée.
- **PC** : entrée « Notifications » dans la barre latérale (sous Dashboard · Teams · Membres…), avec son compteur.
- Page **Teams** : la carte « Notifications » garde les dernières et propose « Notifications » (le centre).

La page liste tout ce que le rôle du compte permet de voir : icône par catégorie, phrase, team (ou « Club »), auteur,
date relative, regroupement par jour (« Aujourd'hui », « Hier », puis la date), lu / non lu (point à droite :
« Marquer comme lu »), « Tout marquer comme lu », défilement infini (et « Afficher plus »). Un appui ouvre l'élément
(page de la team et section, espace CM et onglet, Membres, Devblog, Jeux) et marque la notification lue.

## Visibilité (règle stricte, côté serveur)

Deux sources, unifiées en une liste triée par date :

1. **Le fil** (`notifs_centre`) : une ligne par événement du bus, avec une **catégorie** et une **clé d'accès**
   (`regles.mjs`). La clé est **réévaluée à chaque lecture** avec les rôles du moment (`droits.mjs`, même logique
   que les pages : appartenance → module activé → permission ; section CM ; Sponsors du club). Un rôle retiré ferme
   aussitôt ce qu'il ouvrait (et un rôle donné ouvre l'historique encore conservé).
2. **Les notifications personnelles** (`notifications`, écrites par chaque module : convocation, tâche assignée,
   post validé…). Elles restent visibles de leur destinataire tant qu'il est membre actif de la team concernée (sauf
   « retiré de la team »), qu'il a `sponsors.voir` pour les Sponsors et un accès CM pour le CM / Drive. Quand un
   événement a les deux, **seule la personnelle s'affiche** (pas de doublon).

| Clé d'accès | Qui voit |
| --- | --- |
| `team:p1\|p2` | une des permissions dans la team de l'élément (module activé) ; `team:*` = membre actif |
| `cm:p1\|p2` | permissions CM de la portée (team de l'élément, ou club sans team) |
| `club:p1\|p2` | permissions du club (rôles du club, affectations CM « club », Sponsors) |
| `tous` | tout compte Esport (devblog publié) |
| `fondateur` | le Fondateur seul (défaut d'un type d'événement inconnu) |
| `aucun` | personne (bruit technique : réactions, jetons iCal, commandes du bot…) |

- **Fondateur (CEO)** : tout (sauf `aucun`).
- **Second CEO** (et tout rôle du club avec `teams.acces_total`) : les teams avec les droits du Propriétaire (sauf
  supprimer), et le reste selon ses permissions du club (Sponsors s'il a `sponsors.voir`…).
- **Données sensibles** : notes du staff (`player_notes.view`, jamais le contenu), strats privées (staff :
  `strats.delete`, resserré si une strat devient privée), réunions (`view_all` / `write_summary` ; les résumés
  publiés d'un type « team » aussi pour `view_summary` ; resserré si le type passe « staff »), Sponsors
  (`club:sponsors.voir`), Discord (`discord.manage`).
- La **charge** recopiée ne contient jamais les champs sensibles (`contenu`, `note`, `email`, `url`, `webhook`,
  `jeton`… : `CHAMPS_RETIRES`), textes bornés.
- Les actions du lecteur lui-même ne sont jamais « non lues ».

## Catégories, filtres, préférences

Catégories : `planning` (planning, scrims, convocations, présences), `competition` (matchs et tournois),
`resultats`, `cm` (posts, validations, clips, dépôts, suggestions, visuels, réseaux), `drive`, `sponsors`,
`membres` (membres, rôles, invitations, comptes, trombinoscope, badges, rôles CM et du club), `discord`, `reunions`
(dépôts, résumés, transcriptions), `objectifs` (objectifs et tâches), `jeu` (strats, playbook, review, scouting,
ressources, notes du staff), `devblog`, `systeme` (profils de jeu, IA).

Filtres (`GET /notifications/centre`) : `categories` (liste séparée par des virgules), `team`, `auteur`, `du` / `au`
(AAAA-MM-JJ), `nonLues=1`, `ordre=asc` (défaut : plus récentes d'abord), `suite` (curseur), `limite` (≤ 100).

Préférences **en base, par compte** (`notifs_preferences`) :

- `masquees` : catégories non suivies (absentes de la liste et du compteur ; un filtre explicite les montre) ;
- `silencieuses` : « me notifier » décoché (dans la liste, hors compteur et hors annonce en direct) ;
- `teams` : teams suivies (vide = toutes ; les éléments sans team restent).

## API

| Route | Rôle |
| --- | --- |
| `GET /notifications/centre` | page de la liste (`liste`, `noms`, `suite`, `nonLues`, `teams` filtrables) |
| `GET /notifications/compteur` | `{ nonLues }` (droits et préférences) |
| `POST /notifications/centre/lues` | `{ ids: [...] }` ou `{ tout: true }` → `{ nonLues }` |
| `GET` / `PUT /notifications/preferences` | `{ masquees, silencieuses, teams }` |

Les anciennes routes `GET /notifications` et `POST /notifications/lues` (notifications personnelles seules) restent.

## Temps réel

Serveur : `surNouvelleNotification(fn)` (`notifications/centre.mjs`) appelle
`fn({ compte, id, source: 'fil' | 'perso', categorie, teamId })` une fois par compte concerné, dès qu'un événement
est distribué (droits ET « me notifier » respectés, jamais l'auteur). Rend la fonction de désabonnement. Les
personnelles écrites hors du bus (devblog automatique) ne sont pas annoncées : le compteur les rattrape.

App : `signalerNotifications(nonLues?)` (`src/esport/notifications/api.ts`) prévient la cloche et la page ouverte
(avec le nouveau compteur, ou sans : relecture). En attendant, la cloche relit `GET /notifications/compteur` toutes
les minutes et au retour sur l'onglet.

## Ajouter un événement

1. Le type dans `TYPES_EVENEMENTS` (bus) comme d'habitude.
2. Une entrée dans `REGLES` (`esport/noyau/notifications/regles.mjs`), type exact ou préfixe `xxx.*` / `xxx.yyy_*` :

   ```js
   'drive.ajout': { categorie: 'drive', acces: 'cm:cm.drive.voir|cm.drive.envoyer|cm.drive.gerer', lien: { vue: 'cm', onglet: 'drive' } },
   ```

   Sans entrée, l'événement n'est visible que du Fondateur (catégorie Système).
3. Charge : des champs courts (`titre`, `nom`, `compte`…) ; la phrase vient du journal (`phraseJournal`, app) ou
   du repli du centre (`phraseCentre`). Ne jamais y mettre de contenu privé.

`drive.ajout` (onglet Drive / Visuels) est déjà branché : catégorie Drive, visible des comptes qui voient le Drive
de la portée (team de l'événement, ou club sans team). Charge attendue : `{ nom }` (nom du fichier) ; `team_id` de la
portée ; `entite_type` / `entite_id` du fichier.

## Idempotence, rétention, RGPD, export

- Une ligne du fil par événement (même identifiant, `ON CONFLICT DO NOTHING`) : rejouer un événement ne crée rien.
  L'abonné du centre est le **dernier** de `ABONNES_PAR_DEFAUT`.
- Rétention : **90 jours** (cron, étape « rétention des notifications ») : fil, lectures, notifications personnelles.
- « Tout marquer comme lu » pose `lu_jusqua` ; sans lui, rien d'avant la création du compte n'est « non lu ».
- RGPD : l'export du compte contient `centreNotifications` (préférences, lectures) ; la suppression les efface.
- Export / import de la base : `notifs_centre`, `notifs_lectures`, `notifs_preferences`.
