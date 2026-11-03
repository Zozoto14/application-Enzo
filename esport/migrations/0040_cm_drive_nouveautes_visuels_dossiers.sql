-- Esport, migration 0040 : nouveautés du Drive par utilisateur et dossiers des visuels (docs/esport/drive.md,
-- parties « Nouveautés » et « Déplacer à la souris » ; docs/esport/visuels.md, partie « Dossiers »).
--
-- 1. `cm_drive_vus` : état « vu » du Drive, PAR COMPTE ET PAR DOSSIER (jamais dans le navigateur). `dossier` :
--    l'identifiant d'un dossier, « racine » (racine du Drive de la portée) ou « * » (« Tout marquer comme vu » :
--    tout ce qui est antérieur est vu, dans tous les dossiers de la portée). Un fichier ou un dossier ajouté
--    (ou une nouvelle version) par QUELQU'UN D'AUTRE après la visite de son dossier parent compte comme nouveauté ;
--    la ligne « * » est posée à la première lecture des compteurs (rien n'est « nouveau » au premier passage).
-- 2. `cm_visuels_dossiers` : dossiers des modèles et visuels générés d'une portée (club ou team), arborescence
--    (`parent_id`), dossiers par défaut (`cle` : annonces, resultats, recrues, programmes, sponsors, divers ; `nom`
--    NULL tant qu'ils ne sont pas renommés, l'app traduit). `cm_modeles.dossier_id` et `cm_visuels.dossier_id` :
--    dossier de l'élément (NULL : racine). Pas de clé étrangère sur les parents : l'import d'un export ne dépend
--    pas de l'ordre des lignes, le serveur vérifie lui-même ces liens (un dossier disparu vaut la racine).
--
-- SQL standard (PostgreSQL et SQLite), mêmes conventions que 0001 et 0027.

CREATE TABLE cm_drive_vus (
  compte_id TEXT NOT NULL,
  portee TEXT NOT NULL,
  dossier TEXT NOT NULL,
  vu_le TEXT NOT NULL,
  PRIMARY KEY (compte_id, portee, dossier)
);

CREATE TABLE cm_visuels_dossiers (
  id TEXT PRIMARY KEY,
  portee TEXT NOT NULL,
  team_id TEXT REFERENCES teams (id) ON DELETE CASCADE,
  parent_id TEXT,
  nom TEXT,
  cle TEXT,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL
);
CREATE UNIQUE INDEX cm_visuels_dossiers_cle ON cm_visuels_dossiers (portee, cle);
CREATE INDEX cm_visuels_dossiers_parent ON cm_visuels_dossiers (portee, parent_id);

ALTER TABLE cm_modeles ADD COLUMN dossier_id TEXT;
ALTER TABLE cm_visuels ADD COLUMN dossier_id TEXT;
CREATE INDEX cm_modeles_dossier ON cm_modeles (dossier_id);
CREATE INDEX cm_visuels_dossier ON cm_visuels (dossier_id);
