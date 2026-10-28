-- Esport, migration 0027 : Drive de la section CM (docs/esport/drive.md).
--
-- Arborescence de dossiers et fichiers, du club ou d'une team (`portee` : « club » ou l'identifiant de la team),
-- versions d'un fichier, corbeille (30 jours), étiquettes, favoris. Les octets restent dans `cm_fichiers`
-- (stockage privé, envoi par morceaux) : une copie, une pièce jointe de carte, un visuel ou un sponsor qui
-- reprend un fichier du Drive pointe vers la MÊME ligne de `cm_fichiers` (aucun octet dupliqué) ; les octets ne
-- sont effacés que quand plus rien ne s'en sert.
--
-- SQL standard, compatible SQLite ET PostgreSQL (mêmes conventions que 0001 et 0023 : UUID et dates ISO 8601
-- en TEXT, booléens 0/1, JSON en TEXT, aucune fonction propre à un moteur). Pas de clé étrangère sur les
-- parents (dossier parent, dossier d'un fichier) : l'import d'un export de la base ne dépend pas de l'ordre
-- des lignes ; le serveur vérifie lui-même ces liens.

-- 1. Dossiers. `nom` NULL : dossier par défaut (`cle` : logos, photos, clips, visuels, sponsors, bruts, depot),
--    dont l'app traduit le nom tant qu'il n'est pas renommé. `restreint` : réservé à ceux qui gèrent le Drive
--    (cm.drive.gerer), lui et tout ce qu'il contient. Corbeille : `supprime_le` posé sur tout ce qui part
--    ensemble (même `corbeille`, identifiant du lot) ; `corbeille_racine` = 1 sur l'élément choisi (celui que
--    la corbeille montre et restaure).
CREATE TABLE cm_drive_dossiers (
  id TEXT PRIMARY KEY,
  portee TEXT NOT NULL,
  team_id TEXT REFERENCES teams (id) ON DELETE CASCADE,
  parent_id TEXT,
  nom TEXT,
  cle TEXT,
  restreint INTEGER NOT NULL DEFAULT 0,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL,
  supprime_le TEXT,
  supprime_par TEXT,
  corbeille TEXT,
  corbeille_racine INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX cm_drive_dossiers_cle ON cm_drive_dossiers (portee, cle);
CREATE INDEX cm_drive_dossiers_parent ON cm_drive_dossiers (portee, parent_id, supprime_le);
CREATE INDEX cm_drive_dossiers_corbeille ON cm_drive_dossiers (corbeille);

-- 2. Fichiers du Drive : nom affiché (assaini, extension cohérente avec le type reconnu), `nom_cle` (recherche
--    sans accents ni casse), version actuelle (`fichier_id`, `version`), type reconnu par les octets (`genre` :
--    image, video, audio, document, archive, police, creation, texte), infos (`meta` : largeur, hauteur,
--    durée, format). `origine` : envoi, copie, visuel (rendu rangé automatiquement), clip (clip retenu).
CREATE TABLE cm_drive_fichiers (
  id TEXT PRIMARY KEY,
  portee TEXT NOT NULL,
  team_id TEXT REFERENCES teams (id) ON DELETE CASCADE,
  dossier_id TEXT,
  nom TEXT NOT NULL,
  nom_cle TEXT NOT NULL,
  fichier_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  type_mime TEXT NOT NULL,
  genre TEXT NOT NULL,
  taille INTEGER NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  origine TEXT NOT NULL DEFAULT 'envoi',
  origine_id TEXT,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL,
  supprime_le TEXT,
  supprime_par TEXT,
  corbeille TEXT,
  corbeille_racine INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX cm_drive_fichiers_dossier ON cm_drive_fichiers (portee, dossier_id, supprime_le);
CREATE INDEX cm_drive_fichiers_fichier ON cm_drive_fichiers (fichier_id);
CREATE INDEX cm_drive_fichiers_origine ON cm_drive_fichiers (origine, origine_id);
CREATE INDEX cm_drive_fichiers_corbeille ON cm_drive_fichiers (corbeille);
CREATE INDEX cm_drive_fichiers_auteur ON cm_drive_fichiers (cree_par);

-- 3. Versions d'un fichier (la version actuelle comprise) : remplacer un fichier garde l'ancienne ; restaurer
--    une ancienne version en crée une nouvelle qui pointe vers les mêmes octets.
CREATE TABLE cm_drive_versions (
  id TEXT PRIMARY KEY,
  element_id TEXT NOT NULL REFERENCES cm_drive_fichiers (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  fichier_id TEXT NOT NULL,
  nom TEXT NOT NULL,
  type_mime TEXT NOT NULL,
  taille INTEGER NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  UNIQUE (element_id, version)
);
CREATE INDEX cm_drive_versions_fichier ON cm_drive_versions (fichier_id);

-- 4. Étiquettes d'un fichier (filtre de la recherche), et favoris (par compte, fichier ou dossier).
CREATE TABLE cm_drive_tags (
  element_id TEXT NOT NULL REFERENCES cm_drive_fichiers (id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (element_id, tag)
);
CREATE INDEX cm_drive_tags_tag ON cm_drive_tags (tag);

CREATE TABLE cm_drive_favoris (
  compte_id TEXT NOT NULL,
  element_id TEXT NOT NULL,
  genre TEXT NOT NULL CHECK (genre IN ('fichier', 'dossier')),
  cree_le TEXT NOT NULL,
  PRIMARY KEY (compte_id, element_id)
);

-- 5. Envois par morceaux : nouvel usage « drive ». La contrainte CHECK ne se modifie pas en SQLite : la table
--    est reconstruite (mêmes colonnes, mêmes lignes, mêmes index), comme dans 0017 et 0023.
CREATE TABLE envois_v27 (
  id TEXT PRIMARY KEY,
  team_id TEXT REFERENCES teams (id) ON DELETE CASCADE,
  portee TEXT NOT NULL DEFAULT '',
  compte_id TEXT NOT NULL,
  usage TEXT NOT NULL CHECK (usage IN ('review', 'reunion', 'ressource', 'cm', 'drive')),
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
INSERT INTO envois_v27 (id, team_id, portee, compte_id, usage, nom_original, type_annonce, taille, taille_morceau, morceaux, recus, empreinte_etat, empreintes, etiquettes, jeton_stockage, cle_stockage, meta_media, empreinte, statut, fichier_id, cree_le, maj_le)
  SELECT id, team_id, portee, compte_id, usage, nom_original, type_annonce, taille, taille_morceau, morceaux, recus, empreinte_etat, empreintes, etiquettes, jeton_stockage, cle_stockage, meta_media, empreinte, statut, fichier_id, cree_le, maj_le FROM envois;
DROP TABLE envois;
ALTER TABLE envois_v27 RENAME TO envois;
CREATE INDEX envois_team ON envois (team_id, statut);
CREATE INDEX envois_menage ON envois (statut, maj_le);
CREATE INDEX envois_compte ON envois (compte_id);
CREATE INDEX envois_portee ON envois (portee, usage);

-- 6. Permissions du Drive sur les rôles CM système : Responsable CM (voir, envoyer, gérer), Correspondant CM
--    (voir, envoyer : dans sa team, puisque son affectation est celle d'une team). Les rôles créés par le
--    Fondateur ne changent pas ; « Rétablir » revient à ces valeurs.
INSERT INTO cm_role_permissions (role_id, permission) SELECT id, 'cm.drive.voir' FROM cm_roles WHERE cle_systeme IN ('responsable', 'correspondant');
INSERT INTO cm_role_permissions (role_id, permission) SELECT id, 'cm.drive.envoyer' FROM cm_roles WHERE cle_systeme IN ('responsable', 'correspondant');
INSERT INTO cm_role_permissions (role_id, permission) SELECT id, 'cm.drive.gerer' FROM cm_roles WHERE cle_systeme = 'responsable';
