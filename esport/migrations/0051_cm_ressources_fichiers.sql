-- Esport, migration 0051 : des FICHIERS dans DATA › Ressources (docs/esport/cm.md, « Fichiers » ; docs/esport/drive.md,
-- « Dossier Ressources »).
--
--  - `cm_liens.genre` : 'lien' (adresse https, valeur de toutes les ressources existantes) ou 'fichier' ;
--  - `cm_liens.element_id` : le fichier du Drive (`cm_drive_fichiers.id`) d'une ressource 'fichier' ;
--  - `cm_liens.source` : 'envoi' (envoyé depuis Ressources : rangé dans le dossier système « Ressources » du Drive du
--    club, il APPARTIENT à la ressource) ou 'drive' (choisi dans un Drive : simple référence, rien n'est copié ; la
--    ressource suit sa source : seuls ceux qui voient aussi le fichier dans son Drive le lisent) ;
--  - `cm_drive_fichiers.ressource_id` : fichier qui appartient à une ressource (envoyé depuis Ressources). Il n'est
--    visible, dans le Drive comme par lien signé, que de ceux qui voient la ressource (et qui ont accès au dossier
--    « Ressources », restreint aux gestionnaires du Drive) ; il ne se déplace, ne se copie et ne part à la corbeille
--    que par la ressource. Versions, quota et corbeille restent ceux du Drive.
--
-- Pour une ressource 'fichier', `url` et `hote` valent '' (colonnes NOT NULL de 0044). SQL standard (SQLite et PostgreSQL).

ALTER TABLE cm_liens ADD COLUMN genre TEXT NOT NULL DEFAULT 'lien';
ALTER TABLE cm_liens ADD COLUMN element_id TEXT;
ALTER TABLE cm_liens ADD COLUMN source TEXT;
CREATE INDEX cm_liens_element ON cm_liens (element_id);

ALTER TABLE cm_drive_fichiers ADD COLUMN ressource_id TEXT;
CREATE INDEX cm_drive_fichiers_ressource ON cm_drive_fichiers (ressource_id);
