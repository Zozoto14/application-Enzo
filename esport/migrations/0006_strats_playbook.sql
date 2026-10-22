-- Esport, migration 0006 : éditeur de strats et playbook (phase 6).
--
-- SQL standard (SQLite et Postgres), mêmes conventions que 0001 :
-- UUID et dates ISO 8601 en TEXT, booléens 0/1, JSON en TEXT, aucune
-- fonction propre à SQLite. Indépendante de 0005 (phase 5) : chaque migration
-- n'est appliquée qu'une fois (par nom), les numéros peuvent arriver dans
-- n'importe quel ordre.

-- Strats (éditeur sur la minimap). `donnees` : document JSON versionné
-- (champ `version`, voir esport/noyau/strats/document.mjs), validé par le
-- serveur. `revision` : compteur d'enregistrements (verrou optimiste : un
-- enregistrement fondé sur une révision dépassée est refusé). `carte` et
-- `side` sont recopiés du document pour les filtres. `jeu` : prêt pour
-- d'autres jeux que Valorant. `visibilite` : « team » (partagée avec la team)
-- ou « privee » (brouillon de son auteur).
CREATE TABLE strats (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  jeu TEXT NOT NULL DEFAULT 'valorant',
  titre TEXT NOT NULL,
  carte TEXT NOT NULL,
  carte_nom TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('attaque', 'defense')),
  type TEXT NOT NULL DEFAULT 'default' CHECK (type IN ('default', 'execute', 'eco', 'pistol', 'retake', 'other')),
  donnees TEXT NOT NULL,
  version_document INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  miniature_id TEXT REFERENCES fichiers (id),
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  visibilite TEXT NOT NULL DEFAULT 'team' CHECK (visibilite IN ('team', 'privee')),
  origine_id TEXT,
  cree_par TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  maj_par TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX strats_team ON strats (team_id, carte, side);

-- Historique des enregistrements (les 30 derniers par strat sont gardés).
-- L'unicité (strat, révision) empêche deux enregistrements concurrents de
-- produire la même révision.
CREATE TABLE strat_versions (
  id TEXT PRIMARY KEY,
  strat_id TEXT NOT NULL REFERENCES strats (id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  donnees TEXT NOT NULL,
  cree_par TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  UNIQUE (strat_id, revision)
);

-- Liens de lecture seule : le jeton (montré une fois) est SIGNÉ
-- (HMAC-SHA256 avec CLE_ESPORT) et ne contient que l'identifiant du lien ;
-- révocable (`revoque_le`), avec une expiration facultative.
CREATE TABLE strat_partages (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  strat_id TEXT NOT NULL REFERENCES strats (id) ON DELETE CASCADE,
  libelle TEXT NOT NULL DEFAULT '',
  cree_par TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  expire_le TEXT,
  revoque_le TEXT,
  dernier_acces_le TEXT
);
CREATE INDEX strat_partages_strat ON strat_partages (strat_id);

-- Playbook : bibliothèque par carte, side et type ; une entrée pointe vers
-- une strat de l'éditeur (`strat_id`) ou est purement textuelle. `carte` et
-- `side` NULL : valable partout.
CREATE TABLE playbook_entrees (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  strat_id TEXT REFERENCES strats (id),
  jeu TEXT NOT NULL DEFAULT 'valorant',
  titre TEXT NOT NULL,
  carte TEXT,
  carte_nom TEXT,
  side TEXT CHECK (side IN ('attaque', 'defense')),
  type TEXT NOT NULL DEFAULT 'default' CHECK (type IN ('default', 'execute', 'eco', 'pistol', 'retake', 'other')),
  tags TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  favori INTEGER NOT NULL DEFAULT 0,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'validee', 'archivee')),
  valide_par TEXT,
  valide_le TEXT,
  cree_par TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX playbook_team ON playbook_entrees (team_id, statut);
CREATE INDEX playbook_strat ON playbook_entrees (strat_id);

-- Rôles système des teams déjà créées : nouvelle permission du catalogue
-- (lien de lecture seule d'une strat) pour le Coach et l'Analyste.
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'strats.share' FROM roles WHERE systeme = 1 AND cle_systeme IN ('coach', 'analyste')
  ON CONFLICT (role_id, permission) DO NOTHING;
