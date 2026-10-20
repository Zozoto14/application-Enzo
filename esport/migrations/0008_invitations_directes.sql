-- Esport, migration 0008 : invitations directes (comptes créés depuis l'Esport).
--
-- SQL standard (SQLite / D1 et Postgres). Le numéro 0007 est pris par la
-- phase 7 (index) : le migrateur accepte les trous.
--
-- Le Fondateur crée le compte du hub d'un joueur depuis l'Esport, puis le
-- PRÉ-ENREGISTRE ici (son identifiant de compte du relais, son pseudo, ses
-- teams et rôles) : le joueur voit ses teams dès sa première connexion, sans
-- code. Le compte reste « invité » (invite_le renseigné, active_le vide)
-- jusqu'à sa première session Esport, qui pose active_le.
--
-- Les comptes d'avant cette migration n'ont ni invite_le ni active_le : ils
-- sont considérés actifs.

ALTER TABLE comptes ADD COLUMN invite_par TEXT;
ALTER TABLE comptes ADD COLUMN invite_le TEXT;
ALTER TABLE comptes ADD COLUMN active_le TEXT;
