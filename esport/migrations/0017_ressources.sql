-- Esport, migration 0017 : module « Ressources » (clé `resources`), le canal de ressources de la team.
--
-- SQL standard, compatible SQLite ET PostgreSQL (mêmes conventions que 0001 : UUID et dates ISO 8601
-- en TEXT, booléens 0/1, JSON en TEXT, aucune fonction propre à un moteur).
--
-- 1. Catégories configurables par team. Les sept catégories par défaut (Guides, Vidéos pros, Lineups,
--    Aim et entraînement, Outils, Mental, Divers) sont créées à la première ouverture du module ;
--    `cle_defaut` dit laquelle (pour traduire son nom tant qu'elle n'est pas renommée : NULL ensuite).
--    L'index unique (team_id, cle_defaut) empêche de les créer deux fois (deux NULL ne se gênent pas).
CREATE TABLE ressource_categories (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  cle_defaut TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX ressource_categories_team ON ressource_categories (team_id, position);
CREATE UNIQUE INDEX ressource_categories_defaut ON ressource_categories (team_id, cle_defaut);

-- 2. Ressources. `genre` : lien web (aperçu récupéré par le serveur, dans `apercu`, JSON), vidéo
--    YouTube (`video_id`), fichier déposé (`fichier_id`, stockage privé) ou simple note. `statut` :
--    publiée, proposée par un joueur (file de validation du staff) ou refusée (motif). `visibilite` :
--    toute la team ou le staff seulement. `auteur_id` passe à NULL quand le compte est supprimé (la
--    ressource reste, anonyme). `groupe_id` : même ressource publiée dans plusieurs teams d'un coup.
--    `review_id` : review vidéo ouverte depuis cette ressource (réutilisée au clic suivant).
CREATE TABLE ressources (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  categorie_id TEXT,
  genre TEXT NOT NULL CHECK (genre IN ('lien', 'youtube', 'fichier', 'note')),
  titre TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT,
  video_id TEXT,
  fichier_id TEXT,
  apercu TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  carte TEXT,
  carte_nom TEXT,
  agent TEXT,
  agent_nom TEXT,
  niveau TEXT CHECK (niveau IS NULL OR niveau IN ('debutant', 'intermediaire', 'avance')),
  visibilite TEXT NOT NULL DEFAULT 'team' CHECK (visibilite IN ('team', 'staff')),
  statut TEXT NOT NULL DEFAULT 'publiee' CHECK (statut IN ('publiee', 'proposee', 'refusee')),
  epingle INTEGER NOT NULL DEFAULT 0,
  auteur_id TEXT,
  groupe_id TEXT,
  review_id TEXT,
  valide_par TEXT,
  valide_le TEXT,
  motif_refus TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  publie_le TEXT,
  supprime_le TEXT
);
CREATE INDEX ressources_team ON ressources (team_id, statut, publie_le);
CREATE INDEX ressources_auteur ON ressources (auteur_id);

-- 3. Favoris personnels, réactions (un emoji d'une courte liste, une fois par membre), commentaires.
CREATE TABLE ressource_favoris (
  ressource_id TEXT NOT NULL REFERENCES ressources (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  cree_le TEXT NOT NULL,
  PRIMARY KEY (ressource_id, compte_id)
);
CREATE INDEX ressource_favoris_compte ON ressource_favoris (compte_id);

CREATE TABLE ressource_reactions (
  id TEXT PRIMARY KEY,
  ressource_id TEXT NOT NULL REFERENCES ressources (id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  UNIQUE (ressource_id, compte_id, emoji)
);
CREATE INDEX ressource_reactions_team ON ressource_reactions (team_id, ressource_id);
CREATE INDEX ressource_reactions_compte ON ressource_reactions (compte_id);

CREATE TABLE ressource_commentaires (
  id TEXT PRIMARY KEY,
  ressource_id TEXT NOT NULL REFERENCES ressources (id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  auteur_id TEXT,
  texte TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX ressource_commentaires_ressource ON ressource_commentaires (ressource_id, cree_le);
CREATE INDEX ressource_commentaires_auteur ON ressource_commentaires (auteur_id);

-- 4. Dernière visite du canal par membre (compteur « nouveau depuis ma dernière visite »).
CREATE TABLE ressource_visites (
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL,
  vu_le TEXT NOT NULL,
  PRIMARY KEY (team_id, compte_id)
);

-- 5. Réglages par team : « les joueurs peuvent proposer » et salon Discord dédié (salon du bot, ou
--    webhook spécifique CHIFFRÉ comme celui de la team ; seuls ses 4 derniers caractères en clair).
CREATE TABLE ressource_reglages (
  team_id TEXT PRIMARY KEY REFERENCES teams (id) ON DELETE CASCADE,
  propositions INTEGER NOT NULL DEFAULT 0,
  discord_salon_id TEXT,
  discord_webhook TEXT,
  discord_webhook_fin TEXT,
  maj_le TEXT NOT NULL
);

-- 6. File Discord : un message peut partir vers un webhook propre (salon dédié aux ressources).
ALTER TABLE discord_file ADD COLUMN webhook_chiffre TEXT;

-- 7. Envois par morceaux : nouvel usage « ressource » (fichier déposé dans le canal). La contrainte
--    CHECK d'origine ne se modifie pas en SQLite : la table est reconstruite (mêmes colonnes, mêmes
--    lignes, mêmes index), ce qui marche aussi sur PostgreSQL et SQLite.
CREATE TABLE envois_v17 (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL,
  usage TEXT NOT NULL CHECK (usage IN ('review', 'reunion', 'ressource')),
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
INSERT INTO envois_v17 (id, team_id, compte_id, usage, nom_original, type_annonce, taille, taille_morceau, morceaux, recus, empreinte_etat, empreintes, etiquettes, jeton_stockage, cle_stockage, meta_media, empreinte, statut, fichier_id, cree_le, maj_le)
  SELECT id, team_id, compte_id, usage, nom_original, type_annonce, taille, taille_morceau, morceaux, recus, empreinte_etat, empreintes, etiquettes, jeton_stockage, cle_stockage, meta_media, empreinte, statut, fichier_id, cree_le, maj_le FROM envois;
DROP TABLE envois;
ALTER TABLE envois_v17 RENAME TO envois;
CREATE INDEX envois_team ON envois (team_id, statut);
CREATE INDEX envois_menage ON envois (statut, maj_le);
CREATE INDEX envois_compte ON envois (compte_id);

-- 8. Rôles système des teams déjà créées : tous les membres voient les ressources ; le staff (Manager,
--    Coach, Analyste) publie, modifie celles des autres et gère les catégories. Le Propriétaire a tout.
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'resources.view' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach', 'analyste', 'joueur', 'remplacant')
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'resources.post' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach', 'analyste')
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'resources.manage' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach', 'analyste')
  ON CONFLICT (role_id, permission) DO NOTHING;
