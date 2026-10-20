# Esport : suivi des joueurs (notes du staff)

Module **Suivi joueurs** (`player_notes`), activable par team (Paramètres › Modules), rangé dans la section
**Équipe** (Résumés · Objectifs et tâches · **Suivi joueurs** · Membres et rôles). Il est compris dans le preset
« Team Valorant complète » ; pour une team existante, le Propriétaire l'active. La migration
`esport/migrations/0013_presence_notes.sql` crée la table `notes_joueurs` et donne les permissions aux rôles système
déjà créés (rôles personnalisés inchangés).

## Qui voit quoi

| Rôle (système) | `player_notes.view` | `player_notes.write` | `player_notes.delete` |
| --- | --- | --- | --- |
| Propriétaire (et le Fondateur) | oui | oui | oui |
| Manager, Coach | oui | oui | oui |
| Analyste | oui | oui | non (seulement ses propres notes) |
| Joueur, Remplaçant / Invité | **jamais** | **jamais** | **jamais** |

- **Le joueur concerné ne voit JAMAIS sa fiche**, même s'il a les permissions du module (un Analyste qui joue,
  par exemple) : `GET /teams/:t/suivi/<lui>` répond **403** (`propre-fiche`) et sa fiche n'est pas dans la liste.
- **Les autres joueurs** n'ont aucune permission du module : 403 partout ; l'onglet n'existe pas pour eux.
- Le joueur ne voit que les notes **partagées avec lui**, une par une, en lecture, sur l'accueil de la team
  (carte « Mon profil de joueur › Retours du staff ») : `GET /teams/:t/suivi/moi`. Sans l'auteur si celui-ci a
  coché « Sans mon nom ». Le module doit être activé (sinon 404), aucune permission n'est requise : ce sont ses
  données.
- Modifier une note (texte, catégorie, ton, étiquettes, lien, date, partage, « sans mon nom ») : son **auteur**, ou
  qui a `player_notes.delete`. **Épingler** : tout le staff qui écrit (c'est l'ordre de la fiche).
- Supprimer : `player_notes.delete`, ou l'auteur (définitif, pas de corbeille).
- Contrôles dans l'ordre : session → appartenance à la team → module activé → permission
  (`esport/noyau/suivi/service.mjs`). Une team voisine : 404 (isolation, testée).

## Une fiche par joueur

- **Liste** : les membres de la team (sauf soi et les Propriétaires), joueurs d'abord puis le staff, avec le nombre
  de notes, la date de la dernière et le nombre de notes partagées.
- **Résumé en haut de la fiche** (chaque bloc selon les droits de qui regarde) : **présence sur 3 mois** (taux,
  absences de suite — depuis la refonte de la présence, mêmes définitions), **tâches** assignées (ouvertes, en
  retard, faites), **objectifs individuels**, dernières notes.
- **Notes** : datées (date choisie, aujourd'hui par défaut), **texte riche** (éditeur ChampNote : Markdown limité),
  **catégorie** (Performance, Mental, Communication, Comportement, Objectif, Autre), **ton** (positif, à travailler,
  neutre), **étiquettes** (10 au plus), **lien** facultatif vers un événement du planning (et sa date), une review
  vidéo ou un repère de review — de la même team, et seulement si l'auteur voit ce module.
- **Historique chronologique** (épinglées d'abord, puis de la plus récente), **filtres** (catégorie, ton,
  étiquette) et **recherche** (texte et étiquettes).
- **Partager avec le joueur** : désactivé par défaut, note par note (formulaire, ou menu ⋯ « Partager avec le
  joueur » / « Ne plus partager »). Le joueur reçoit une notification « Le staff de … a partagé une note avec
  vous » (sans le contenu). Pas de Discord.

## Journal d'activité

`player_note.created`, `player_note.updated`, `player_note.shared` (partage ou retrait), `player_note.deleted`,
filtre « Suivi joueurs » du journal. La charge ne contient que le joueur concerné (et le sens du partage) :
« Zed a ajouté une note sur Léa ». **Jamais le contenu**, la catégorie ni les étiquettes (testé).

## RGPD : la règle choisie

Une note est une **donnée personnelle du joueur concerné** (et, pour son auteur, une trace d'activité).

1. **Export du joueur** (Paramètres › Mon profil Esport › Exporter mes données) : `notesPartagees` — les notes
   que le staff a partagées avec lui (date, catégorie, ton, texte, étiquettes, auteur sauf s'il est masqué).
   Les notes **privées** n'y sont pas : elles restent un outil de travail du staff tant qu'il ne les partage pas.
2. **Export par le Fondateur** (Administration, demande RGPD d'un membre ; `GET /admin/comptes/:c/export`) :
   contient en plus `notesStaffPrivees` (date, catégorie, ton, texte, étiquettes, identifiant de l'auteur). Si le
   joueur exerce son **droit d'accès**, le Fondateur lui transmet ces notes, après avoir retiré ce qui
   concernerait un tiers. C'est la « doc RGPD du Fondateur » : voir aussi [securite.md](securite.md#rgpd).
3. **Export d'un membre du staff** : `notesRedigees` — le nombre de notes qu'il a écrites par team, sans leur
   contenu (ce sont des données d'autres joueurs).
4. **Suppression du compte** (par le membre, le Fondateur ou l'Administration) : les notes **sur** lui sont
   **effacées** ; celles qu'il a **écrites** restent dans les fiches, **sans auteur** (`auteur_id` vidé, « auteur :
   compte supprimé ») — anonymisation.
5. Un joueur qui **quitte** la team : ses notes restent dans la team (fiche « ancien membre ») jusqu'à leur
   suppression par le staff ou celle de son compte.

## API (préfixe facultatif `/api/esport`)

| Méthode et route | Permission |
| --- | --- |
| `GET /teams/:t/suivi` | player_notes.view |
| `GET /teams/:t/suivi/moi` | membre, module activé (notes partagées avec moi) |
| `GET /teams/:t/suivi/:compte?q&categorie&ton&tag` | player_notes.view, et pas soi-même |
| `POST /teams/:t/suivi/:compte/notes` | player_notes.write |
| `PATCH /teams/:t/suivi/:compte/notes/:id` | player_notes.write (auteur, ou delete ; épingler : tous) |
| `DELETE /teams/:t/suivi/:compte/notes/:id` | player_notes.delete, ou l'auteur |

## Code et tests

- Serveur : `esport/noyau/suivi/service.mjs` (service et routes), migration `0013_presence_notes.sql`, SQL compatible
  SQLite / D1 et PostgreSQL (pas d'`INSERT OR IGNORE`, booléens 0/1, dates ISO en texte).
- App : `src/esport/suivi/api.ts`, `src/esport/ui/suivi/SuiviJoueurs.tsx`, `src/esport/ui/MonSuivi.tsx` (accueil du
  joueur). Libellés FR et EN (`src/esport/i18n`).
- Tests : `esport/test/presence-notes.test.mjs` (permissions, invisibilité pour le joueur et les autres joueurs,
  partage, isolation entre teams, journal sans contenu, RGPD), `src/esport/suivi/suivi.test.tsx`, e2e
  `scripts/e2e-esport-presence-notes.mjs`.
