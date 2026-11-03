-- Esport, migration 0049 : fichiers d'un AUTRE Drive joints à une carte CM ou à un sponsor (docs/esport/drive.md,
-- « Choisir dans quel Drive »).
--
-- `drive_croise` = 1 : la pièce a été prise dans un Drive qui n'est ni celui de la portée du tableau ni celui du club
-- (Drive d'une autre team ; pour un sponsor : tout Drive de team). Règle de visibilité : la pièce suit sa source. Seules
-- les personnes qui voient le fichier dans son Drive d'origine (Drive visible, dossier non restreint pour elles) la
-- lisent ; les autres voient « Fichier d'un Drive auquel vous n'avez pas accès », sans nom ni lien. La pièce ne donne
-- jamais l'accès aux octets par elle-même. 0 (défaut) : comportement historique (fichier envoyé, Drive de la portée ou du club).
--
-- SQL standard (PostgreSQL et SQLite).

ALTER TABLE cm_pieces ADD COLUMN drive_croise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sp_pieces ADD COLUMN drive_croise INTEGER NOT NULL DEFAULT 0;
