-- Esport, migration 0023 : section CM (community manager). Voir docs/esport/cm.md.
--
-- SQL standard, compatible SQLite ET PostgreSQL (mêmes conventions que 0001 : UUID et dates ISO 8601 en
-- TEXT, booléens 0/1, JSON en TEXT, aucune fonction propre à un moteur). Positions (listes, cartes) en REAL
-- (DOUBLE PRECISION en PostgreSQL) : on insère entre deux cartes sans renuméroter toute la liste.
--
-- Deux niveaux :
--  - l'espace CM GLOBAL du club (portée « club », au-dessus des teams), tenu par le CM commun ;
--  - la partie CM de chaque team (module `cm`, portée = identifiant de la team), où un correspondant dépose
--    les informations et où les joueurs proposent leurs clips.
-- `portee` vaut « club » ou l'identifiant d'une team ; `team_id` (NULL pour le club) porte la clé étrangère
-- (la suppression d'une team efface sa partie CM).

-- 1. Rôles CM (niveau club) : « Responsable CM » et « Correspondant CM » (rôles système, permissions
--    modifiables), et ceux que le Fondateur crée. Permissions : cm.voir, cm.deposer, cm.editer, cm.valider,
--    cm.gerer, cm.clips.proposer. Une affectation donne un rôle CM à un compte, pour tout le club
--    (`portee` = « club ») ou pour UNE team (le correspondant de la team).
CREATE TABLE cm_roles (
  id TEXT PRIMARY KEY,
  cle_systeme TEXT UNIQUE,
  nom TEXT NOT NULL,
  couleur TEXT NOT NULL DEFAULT '#8b8b9a',
  systeme INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);

CREATE TABLE cm_role_permissions (
  role_id TEXT NOT NULL REFERENCES cm_roles (id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE cm_affectations (
  id TEXT PRIMARY KEY,
  compte_id TEXT NOT NULL,
  role_id TEXT NOT NULL REFERENCES cm_roles (id) ON DELETE CASCADE,
  portee TEXT NOT NULL,
  team_id TEXT REFERENCES teams (id) ON DELETE CASCADE,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  UNIQUE (compte_id, role_id, portee)
);
CREATE INDEX cm_affectations_compte ON cm_affectations (compte_id);

-- 2. Réglages de la section (clé → JSON) : suggestions automatiques (actives, par type, hashtags).
CREATE TABLE cm_reglages (
  cle TEXT PRIMARY KEY,
  valeur TEXT NOT NULL DEFAULT '{}',
  maj_par TEXT,
  maj_le TEXT NOT NULL
);

-- 3. Tableaux façon Trello. `cle_defaut` : « contenus » pour le tableau par défaut d'une portée (unique par
--    portée ; deux NULL ne se gênent pas). `nom` NULL : nom par défaut, traduit à l'affichage.
--    `version` : augmente à chaque changement du tableau (l'app la relit pour se rafraîchir).
--    `trello_id` : tableau importé depuis Trello (relancer l'import met à jour le même tableau).
CREATE TABLE cm_tableaux (
  id TEXT PRIMARY KEY,
  portee TEXT NOT NULL,
  team_id TEXT REFERENCES teams (id) ON DELETE CASCADE,
  nom TEXT,
  description TEXT NOT NULL DEFAULT '',
  couleur TEXT NOT NULL DEFAULT '#5b8cff',
  cle_defaut TEXT,
  position REAL NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  trello_id TEXT UNIQUE,
  archive_le TEXT,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE UNIQUE INDEX cm_tableaux_defaut ON cm_tableaux (portee, cle_defaut);
CREATE INDEX cm_tableaux_portee ON cm_tableaux (portee, supprime_le);

-- 4. Listes. `cle` : rôle d'une liste du tableau par défaut (idees, preparation, a_valider, valide, publie),
--    gardée si on la renomme : le circuit de validation y range les posts.
CREATE TABLE cm_listes (
  id TEXT PRIMARY KEY,
  tableau_id TEXT NOT NULL REFERENCES cm_tableaux (id) ON DELETE CASCADE,
  nom TEXT,
  cle TEXT,
  position REAL NOT NULL DEFAULT 0,
  trello_id TEXT,
  archive_le TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  UNIQUE (tableau_id, trello_id),
  UNIQUE (tableau_id, cle)
);
CREATE INDEX cm_listes_tableau ON cm_listes (tableau_id, position);

-- 5. Étiquettes colorées d'un tableau.
CREATE TABLE cm_etiquettes (
  id TEXT PRIMARY KEY,
  tableau_id TEXT NOT NULL REFERENCES cm_tableaux (id) ON DELETE CASCADE,
  nom TEXT NOT NULL DEFAULT '',
  couleur TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  trello_id TEXT,
  UNIQUE (tableau_id, trello_id)
);

-- 6. Cartes. Une carte peut être un « post » (`post` = 1) : réseaux ciblés (JSON ["x", "instagram", …]),
--    textes FR / EN par réseau (JSON { x: { fr, en } }), liens (match, tournoi, résultat, clips, membres),
--    adresses des posts publiés (JSON { x: "https://…" }). `statut` du post : brouillon, a_valider, valide,
--    refuse, publie. `empreinte_validee` : empreinte du contenu au moment de la validation (toute
--    modification du contenu ensuite repasse le post « à valider »). `origine` : manuel, depot, suggestion,
--    clip, trello ; `origine_cle` : suggestion automatique (une seule carte par match et par type).
--    `auto` = 1 : suggestion pas encore retouchée (le serveur peut la tenir à jour).
CREATE TABLE cm_cartes (
  id TEXT PRIMARY KEY,
  tableau_id TEXT NOT NULL REFERENCES cm_tableaux (id) ON DELETE CASCADE,
  liste_id TEXT NOT NULL REFERENCES cm_listes (id) ON DELETE CASCADE,
  team_id TEXT,
  titre TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL DEFAULT 0,
  couverture TEXT,
  echeance TEXT,
  echeance_faite INTEGER NOT NULL DEFAULT 0,
  date_publication TEXT,
  post INTEGER NOT NULL DEFAULT 0,
  statut TEXT CHECK (statut IS NULL OR statut IN ('brouillon', 'a_valider', 'valide', 'refuse', 'publie')),
  reseaux TEXT NOT NULL DEFAULT '[]',
  textes TEXT NOT NULL DEFAULT '{}',
  liens TEXT NOT NULL DEFAULT '{}',
  publications TEXT NOT NULL DEFAULT '{}',
  empreinte_validee TEXT,
  soumis_par TEXT,
  soumis_le TEXT,
  valide_par TEXT,
  valide_le TEXT,
  refus_motif TEXT,
  refuse_par TEXT,
  publie_par TEXT,
  publie_le TEXT,
  origine TEXT NOT NULL DEFAULT 'manuel',
  origine_cle TEXT UNIQUE,
  auto INTEGER NOT NULL DEFAULT 0,
  depot_genre TEXT,
  trello_id TEXT,
  archive_le TEXT,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  supprime_le TEXT,
  UNIQUE (tableau_id, trello_id)
);
CREATE INDEX cm_cartes_liste ON cm_cartes (tableau_id, liste_id, position);
CREATE INDEX cm_cartes_statut ON cm_cartes (statut, supprime_le);
CREATE INDEX cm_cartes_publication ON cm_cartes (date_publication);

CREATE TABLE cm_carte_etiquettes (
  carte_id TEXT NOT NULL REFERENCES cm_cartes (id) ON DELETE CASCADE,
  etiquette_id TEXT NOT NULL REFERENCES cm_etiquettes (id) ON DELETE CASCADE,
  PRIMARY KEY (carte_id, etiquette_id)
);

CREATE TABLE cm_carte_membres (
  carte_id TEXT NOT NULL REFERENCES cm_cartes (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL,
  PRIMARY KEY (carte_id, compte_id)
);
CREATE INDEX cm_carte_membres_compte ON cm_carte_membres (compte_id);

-- 7. Checklists et leurs éléments.
CREATE TABLE cm_checklists (
  id TEXT PRIMARY KEY,
  carte_id TEXT NOT NULL REFERENCES cm_cartes (id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0,
  trello_id TEXT,
  UNIQUE (carte_id, trello_id)
);

CREATE TABLE cm_checklist_elements (
  id TEXT PRIMARY KEY,
  checklist_id TEXT NOT NULL REFERENCES cm_checklists (id) ON DELETE CASCADE,
  carte_id TEXT NOT NULL REFERENCES cm_cartes (id) ON DELETE CASCADE,
  texte TEXT NOT NULL,
  fait INTEGER NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0,
  trello_id TEXT,
  UNIQUE (checklist_id, trello_id)
);
CREATE INDEX cm_checklist_elements_carte ON cm_checklist_elements (carte_id);

-- 8. Commentaires (Markdown nettoyé). `auteur_nom` : auteur Trello sans compte correspondant.
CREATE TABLE cm_commentaires (
  id TEXT PRIMARY KEY,
  carte_id TEXT NOT NULL REFERENCES cm_cartes (id) ON DELETE CASCADE,
  auteur_id TEXT,
  auteur_nom TEXT,
  texte TEXT NOT NULL,
  trello_id TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT,
  UNIQUE (carte_id, trello_id)
);
CREATE INDEX cm_commentaires_carte ON cm_commentaires (carte_id, cree_le);
CREATE INDEX cm_commentaires_auteur ON cm_commentaires (auteur_id);

-- 9. Fichiers de la section CM (stockage privé, comme `fichiers`, mais pour le club ou une team) : pièces
--    jointes des cartes, clips déposés par les joueurs.
CREATE TABLE cm_fichiers (
  id TEXT PRIMARY KEY,
  portee TEXT NOT NULL,
  team_id TEXT REFERENCES teams (id) ON DELETE CASCADE,
  cle_stockage TEXT NOT NULL UNIQUE,
  type_mime TEXT NOT NULL,
  taille INTEGER NOT NULL,
  nom_original TEXT NOT NULL,
  empreinte TEXT NOT NULL,
  depose_par TEXT NOT NULL DEFAULT '',
  meta TEXT,
  cree_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX cm_fichiers_portee ON cm_fichiers (portee, supprime_le);

-- 10. Pièces jointes : fichier déposé (`fichier_id`) ou lien https (`url`, ex. fichier resté sur Trello).
CREATE TABLE cm_pieces (
  id TEXT PRIMARY KEY,
  carte_id TEXT NOT NULL REFERENCES cm_cartes (id) ON DELETE CASCADE,
  genre TEXT NOT NULL CHECK (genre IN ('fichier', 'lien')),
  nom TEXT NOT NULL,
  url TEXT,
  fichier_id TEXT,
  trello INTEGER NOT NULL DEFAULT 0,
  trello_id TEXT,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  supprime_le TEXT,
  UNIQUE (carte_id, trello_id)
);
CREATE INDEX cm_pieces_carte ON cm_pieces (carte_id);

-- 11. Activité d'une carte (qui a fait quoi : création, déplacement, validation…), jamais modifiée.
CREATE TABLE cm_activite (
  id TEXT PRIMARY KEY,
  carte_id TEXT NOT NULL REFERENCES cm_cartes (id) ON DELETE CASCADE,
  tableau_id TEXT NOT NULL,
  acteur_id TEXT,
  action TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  cree_le TEXT NOT NULL
);
CREATE INDEX cm_activite_carte ON cm_activite (carte_id, cree_le);
CREATE INDEX cm_activite_acteur ON cm_activite (acteur_id);

-- 12. Clips proposés par les joueurs : fichier déposé ou lien (YouTube, Twitch…), match lié (résultat ou
--     match de tournoi), instant (secondes), description ; statut proposé, retenu, refusé, utilisé.
CREATE TABLE cm_clips (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  propose_par TEXT,
  genre TEXT NOT NULL CHECK (genre IN ('fichier', 'lien')),
  url TEXT,
  fichier_id TEXT,
  resultat_id TEXT,
  tournoi_match_id TEXT,
  instant INTEGER,
  titre TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  statut TEXT NOT NULL DEFAULT 'propose' CHECK (statut IN ('propose', 'retenu', 'refuse', 'utilise')),
  decide_par TEXT,
  decide_le TEXT,
  motif TEXT,
  carte_id TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX cm_clips_team ON cm_clips (team_id, statut, cree_le);
CREATE INDEX cm_clips_compte ON cm_clips (propose_par);

-- 13. Imports Trello (historique : fichier, bilan).
CREATE TABLE cm_imports (
  id TEXT PRIMARY KEY,
  tableau_id TEXT NOT NULL,
  trello_id TEXT NOT NULL,
  bilan TEXT NOT NULL DEFAULT '{}',
  importe_par TEXT,
  cree_le TEXT NOT NULL
);

-- 14. Envois par morceaux : nouvel usage « cm » (pièces jointes, clips), pour le club (sans team) ou une team.
--     La contrainte CHECK et le NOT NULL de `team_id` ne se modifient pas en SQLite : la table est
--     reconstruite (mêmes colonnes, mêmes lignes, mêmes index) comme dans 0017, plus `portee`.
CREATE TABLE envois_v23 (
  id TEXT PRIMARY KEY,
  team_id TEXT REFERENCES teams (id) ON DELETE CASCADE,
  portee TEXT NOT NULL DEFAULT '',
  compte_id TEXT NOT NULL,
  usage TEXT NOT NULL CHECK (usage IN ('review', 'reunion', 'ressource', 'cm')),
  nom_original TEXT NOT NULL,
  type_annonce TEXT NOT NULL DEFAULT '',
  taille INTEGER NOT NULL,
  taille_morceau INTEGER NOT NULL,
  morceaux INTEGER NOT NULL,
  recus INTEGER NOT NULL DEFAULT 0,
  empreinte_etat TEXT NOT NULL,
  empreintes TEXT NOT NULL DEFAULT '[]',
  etiquettes TEXT NOT NULL DEFAULT '[]',
  jeton_stockage TEXT NOT NULL DEFAULT '',
  cle_stockage TEXT NOT NULL UNIQUE,
  meta_media TEXT,
  empreinte TEXT,
  statut TEXT NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'termine')),
  fichier_id TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);
INSERT INTO envois_v23 (id, team_id, portee, compte_id, usage, nom_original, type_annonce, taille, taille_morceau, morceaux, recus, empreinte_etat, empreintes, etiquettes, jeton_stockage, cle_stockage, meta_media, empreinte, statut, fichier_id, cree_le, maj_le)
  SELECT id, team_id, team_id, compte_id, usage, nom_original, type_annonce, taille, taille_morceau, morceaux, recus, empreinte_etat, empreintes, etiquettes, jeton_stockage, cle_stockage, meta_media, empreinte, statut, fichier_id, cree_le, maj_le FROM envois;
DROP TABLE envois;
ALTER TABLE envois_v23 RENAME TO envois;
CREATE INDEX envois_team ON envois (team_id, statut);
CREATE INDEX envois_menage ON envois (statut, maj_le);
CREATE INDEX envois_compte ON envois (compte_id);
CREATE INDEX envois_portee ON envois (portee, usage);

-- 15. Rôles CM système (permissions modifiables par le Fondateur ; « Rétablir » revient à celles-ci).
INSERT INTO cm_roles (id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le)
  VALUES ('cm-role-responsable', 'responsable', 'Responsable CM', '#db2777', 1, 0, '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z');
INSERT INTO cm_roles (id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le)
  VALUES ('cm-role-correspondant', 'correspondant', 'Correspondant CM', '#0d9488', 1, 1, '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z');
INSERT INTO cm_role_permissions (role_id, permission) VALUES ('cm-role-responsable', 'cm.voir');
INSERT INTO cm_role_permissions (role_id, permission) VALUES ('cm-role-responsable', 'cm.deposer');
INSERT INTO cm_role_permissions (role_id, permission) VALUES ('cm-role-responsable', 'cm.editer');
INSERT INTO cm_role_permissions (role_id, permission) VALUES ('cm-role-responsable', 'cm.valider');
INSERT INTO cm_role_permissions (role_id, permission) VALUES ('cm-role-responsable', 'cm.gerer');
INSERT INTO cm_role_permissions (role_id, permission) VALUES ('cm-role-responsable', 'cm.clips.proposer');
INSERT INTO cm_role_permissions (role_id, permission) VALUES ('cm-role-correspondant', 'cm.voir');
INSERT INTO cm_role_permissions (role_id, permission) VALUES ('cm-role-correspondant', 'cm.deposer');
INSERT INTO cm_role_permissions (role_id, permission) VALUES ('cm-role-correspondant', 'cm.clips.proposer');

-- 16. Rôles système des teams déjà créées (module `cm` à activer dans les Paramètres de la team) : les
--     joueurs (et le staff) proposent des clips ; le Manager voit la partie CM de la team et y dépose des
--     informations. Le Propriétaire a ces trois permissions d'office. Valider et publier restent au niveau
--     du club (Fondateur, Responsable CM).
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'cm.clips.proposer' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach', 'analyste', 'joueur', 'remplacant')
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'cm.voir' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager')
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'cm.deposer' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager')
  ON CONFLICT (role_id, permission) DO NOTHING;
