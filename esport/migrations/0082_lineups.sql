-- Esport, migration 0082 : module « Lineups » (clé `lineups` ; « Lineups et placements » pour The Finals).
--
-- SQL standard, compatible SQLite ET PostgreSQL (mêmes conventions que 0001 : UUID et dates ISO 8601 en TEXT,
-- booléens 0/1, JSON en TEXT, aucune fonction propre à un moteur). Voir docs/esport/lineups.md.
--
-- Contenu TACTIQUE (comme les strats) : jamais envoyé à une IA externe, jamais posté sur Discord.

-- 1. Lineups. `carte`, `personnage`, `capacite`, `zone` : clés du PROFIL DE JEU de la team (map, agent ou classe,
--    capacité ou gadget, callout de la map), avec leur nom recopié (le lineup reste lisible si le profil change).
--    `zone` vide et `zone_nom` rempli : zone visée en texte libre. `side` : « attaque », « defense », ou la clé d'un
--    mode du jeu (The Finals : cashout, final-round) ; vide : partout. `posture` : debout, saut, course, accroupi.
--    Points sur la minimap (entiers), dans le repère carré de 1000 unités des strats : `depart_*` (où l'on se place) et
--    `arrivee_*` (où ça tombe) ; NULL : pas encore posé. `video_url` : lien https facultatif (la vidéo déposée est
--    dans `lineup_medias`). `statut` : proposé (par un joueur) ou validé (par le staff).
--    Suppression douce (`supprime_le`) : corbeille de 30 jours, comme les strats.
CREATE TABLE lineups (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  jeu TEXT NOT NULL,
  modele TEXT NOT NULL DEFAULT 'generique',
  titre TEXT NOT NULL,
  carte TEXT NOT NULL,
  carte_nom TEXT NOT NULL,
  personnage TEXT,
  personnage_nom TEXT NOT NULL DEFAULT '',
  capacite TEXT,
  capacite_nom TEXT NOT NULL DEFAULT '',
  side TEXT NOT NULL DEFAULT '',
  zone TEXT,
  zone_nom TEXT NOT NULL DEFAULT '',
  posture TEXT NOT NULL DEFAULT 'debout' CHECK (posture IN ('debout', 'saut', 'course', 'accroupi')),
  visee TEXT NOT NULL DEFAULT '',
  timing TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  difficulte INTEGER NOT NULL DEFAULT 1 CHECK (difficulte >= 1 AND difficulte <= 3),
  tags TEXT NOT NULL DEFAULT '[]',
  depart_x INTEGER,
  depart_y INTEGER,
  arrivee_x INTEGER,
  arrivee_y INTEGER,
  video_url TEXT,
  statut TEXT NOT NULL DEFAULT 'propose' CHECK (statut IN ('propose', 'valide')),
  valide_par TEXT,
  valide_le TEXT,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL,
  supprime_le TEXT,
  supprime_par TEXT
);
CREATE INDEX lineups_team ON lineups (team_id, carte, supprime_le);

-- 2. Médias d'un lineup : 4 images au plus (rôle : position, visée, résultat, autre) et une vidéo courte au plus
--    (rôle `video`). Les octets sont dans le stockage du serveur (table `fichiers`, comme les vidéos et les PDF),
--    lus par un lien signé.
CREATE TABLE lineup_medias (
  id TEXT PRIMARY KEY,
  lineup_id TEXT NOT NULL REFERENCES lineups (id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  fichier_id TEXT NOT NULL REFERENCES fichiers (id),
  role TEXT NOT NULL CHECK (role IN ('position', 'visee', 'resultat', 'autre', 'video')),
  position INTEGER NOT NULL DEFAULT 0,
  cree_par TEXT,
  cree_le TEXT NOT NULL
);
CREATE INDEX lineup_medias_lineup ON lineup_medias (lineup_id, position);

-- 3. Favoris, par compte.
CREATE TABLE lineup_favoris (
  lineup_id TEXT NOT NULL REFERENCES lineups (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  cree_le TEXT NOT NULL,
  PRIMARY KEY (lineup_id, compte_id)
);
CREATE INDEX lineup_favoris_compte ON lineup_favoris (compte_id);

-- 4. Liens strat <-> lineup (plusieurs à plusieurs), avec le numéro de l'étape de la strat (facultatif, à partir de 1).
CREATE TABLE strat_lineups (
  strat_id TEXT NOT NULL REFERENCES strats (id) ON DELETE CASCADE,
  lineup_id TEXT NOT NULL REFERENCES lineups (id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  etape INTEGER,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  PRIMARY KEY (strat_id, lineup_id)
);
CREATE INDEX strat_lineups_lineup ON strat_lineups (lineup_id);

-- 5. Envois par morceaux : nouvel usage « lineup » (images et vidéo courte d'un lineup). La contrainte CHECK ne se
--    modifie pas en SQLite : la table est reconstruite (mêmes colonnes, mêmes lignes, mêmes index), comme dans 0017,
--    0023 et 0027 (aucune table ne référence `envois` : aucun ON DELETE CASCADE ne joue).
CREATE TABLE envois_v82 (
  id TEXT PRIMARY KEY,
  team_id TEXT REFERENCES teams (id) ON DELETE CASCADE,
  portee TEXT NOT NULL DEFAULT '',
  compte_id TEXT NOT NULL,
  usage TEXT NOT NULL CHECK (usage IN ('review', 'reunion', 'ressource', 'cm', 'drive', 'lineup')),
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
INSERT INTO envois_v82 (id, team_id, portee, compte_id, usage, nom_original, type_annonce, taille, taille_morceau, morceaux, recus, empreinte_etat, empreintes, etiquettes, jeton_stockage, cle_stockage, meta_media, empreinte, statut, fichier_id, cree_le, maj_le)
  SELECT id, team_id, portee, compte_id, usage, nom_original, type_annonce, taille, taille_morceau, morceaux, recus, empreinte_etat, empreintes, etiquettes, jeton_stockage, cle_stockage, meta_media, empreinte, statut, fichier_id, cree_le, maj_le FROM envois;
DROP TABLE envois;
ALTER TABLE envois_v82 RENAME TO envois;
CREATE INDEX envois_team ON envois (team_id, statut);
CREATE INDEX envois_menage ON envois (statut, maj_le);
CREATE INDEX envois_compte ON envois (compte_id);
CREATE INDEX envois_portee ON envois (portee, usage);

-- 6. Module activé pour les teams qui ont déjà l'éditeur de strats (les autres : Paramètres de la team › Modules).
INSERT INTO team_modules (team_id, module, active, config, maj_le)
  SELECT team_id, 'lineups', 1, '{}', maj_le FROM team_modules WHERE module = 'strat_editor' AND active = 1
  ON CONFLICT (team_id, module) DO NOTHING;

-- 7. Rôles système des teams déjà créées : tout le monde voit ; les joueurs et le staff proposent ; le Manager et le
--    Coach valident, corrigent et suppriment (le Propriétaire a tout).
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'lineups.voir' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach', 'analyste', 'joueur', 'remplacant')
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'lineups.proposer' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach', 'analyste', 'joueur')
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'lineups.gerer' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach')
  ON CONFLICT (role_id, permission) DO NOTHING;
