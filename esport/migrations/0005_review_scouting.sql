-- Esport, migration 0005 : review vidéo YouTube et scouting adverse (phase 5).
--
-- SQL standard (SQLite et Postgres), mêmes conventions que 0001 : UUID et
-- dates ISO 8601 en TEXT, booléens 0/1, JSON en TEXT, aucune fonction propre
-- à SQLite. Indépendante de 0002 à 0004 : le migrateur accepte les trous de
-- numéros, chaque migration n'est appliquée qu'une fois (par nom).
--
-- Les comptes (auteur, joueur ciblé) sont gardés par identifiant sans clé
-- étrangère, comme les phases 2 et 3 : la suppression d'un compte (RGPD) ne
-- supprime pas le travail de l'équipe, l'auteur s'affiche « compte supprimé ».

-- Fiches adversaires (opponents). Visibles seulement avec scouting.view.
CREATE TABLE adversaires (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  logo_url TEXT,
  notes TEXT NOT NULL DEFAULT '',
  cree_par TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX adversaires_team ON adversaires (team_id, nom);

-- Joueurs adverses (opponent_players) ; `agents` : JSON (liste de noms d'agents).
CREATE TABLE adversaire_joueurs (
  id TEXT PRIMARY KEY,
  adversaire_id TEXT NOT NULL REFERENCES adversaires (id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  pseudo TEXT NOT NULL,
  riot_id TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  agents TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);
CREATE INDEX adversaire_joueurs_adversaire ON adversaire_joueurs (adversaire_id);

-- Tendances par map et par side (opponent_map_tendencies) ; `compos` : JSON
-- (liste de compositions, chacune une liste de noms d'agents) ; `taux_victoire`
-- facultatif (0 à 100).
CREATE TABLE adversaire_tendances (
  id TEXT PRIMARY KEY,
  adversaire_id TEXT NOT NULL REFERENCES adversaires (id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  map TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('attaque', 'defense', 'les_deux')),
  notes TEXT NOT NULL DEFAULT '',
  taux_victoire INTEGER CHECK (taux_victoire IS NULL OR (taux_victoire >= 0 AND taux_victoire <= 100)),
  compos TEXT NOT NULL DEFAULT '[]',
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);
CREATE INDEX adversaire_tendances_adversaire ON adversaire_tendances (adversaire_id, map);

-- Reviews vidéo YouTube (video_reviews). `reference` : match ou scrim concerné
-- (texte libre, facultatif).
CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  titre TEXT NOT NULL,
  url TEXT NOT NULL,
  video_id TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  cree_par TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX reviews_team ON reviews (team_id, cree_le);

-- VODs d'un adversaire (opponent_vods) ; `review_id` : review ouverte depuis ce lien.
CREATE TABLE adversaire_vods (
  id TEXT PRIMARY KEY,
  adversaire_id TEXT NOT NULL REFERENCES adversaires (id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  titre TEXT NOT NULL,
  review_id TEXT REFERENCES reviews (id),
  cree_par TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);
CREATE INDEX adversaire_vods_adversaire ON adversaire_vods (adversaire_id);

-- Repères horodatés (video_review_markers). `debut_s` et `fin_s` en secondes
-- (fin facultative) ; `note` : Markdown limité, nettoyé par le serveur.
CREATE TABLE review_reperes (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES reviews (id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  debut_s REAL NOT NULL CHECK (debut_s >= 0),
  fin_s REAL CHECK (fin_s IS NULL OR fin_s >= 0),
  categorie TEXT NOT NULL CHECK (categorie IN ('erreur', 'bonne_action', 'utilitaires', 'placement', 'comms')),
  titre TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  cible_id TEXT,
  auteur_id TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX review_reperes_review ON review_reperes (review_id, debut_s);

-- Fil de commentaires par repère (video_review_marker_comments).
CREATE TABLE review_commentaires (
  id TEXT PRIMARY KEY,
  repere_id TEXT NOT NULL REFERENCES review_reperes (id) ON DELETE CASCADE,
  review_id TEXT NOT NULL REFERENCES reviews (id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  auteur_id TEXT NOT NULL,
  texte TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX review_commentaires_repere ON review_commentaires (repere_id, cree_le);

-- Rôles système des teams déjà créées : permissions du plan (section 4.1) pour
-- la review vidéo et le scouting. Idempotent (ON CONFLICT DO NOTHING) ; les
-- rôles personnalisés ne changent pas.
--   Coach : toute la review, tout le scouting.
--   Analyste : review (voir, créer, annoter), tout le scouting.
--   Joueur : voir et annoter (commenter) la review ; aucun scouting.
--   Manager : voir la review et le scouting.
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'video_review.view' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach', 'analyste', 'joueur')
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'video_review.annotate' FROM roles WHERE systeme = 1 AND cle_systeme IN ('coach', 'analyste', 'joueur')
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'video_review.create' FROM roles WHERE systeme = 1 AND cle_systeme IN ('coach', 'analyste')
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'video_review.delete' FROM roles WHERE systeme = 1 AND cle_systeme = 'coach'
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'scouting.view' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach', 'analyste')
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'scouting.manage' FROM roles WHERE systeme = 1 AND cle_systeme IN ('coach', 'analyste')
  ON CONFLICT (role_id, permission) DO NOTHING;
