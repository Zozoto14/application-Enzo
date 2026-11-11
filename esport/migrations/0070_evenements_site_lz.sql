-- Esport, migration 0070 : pont entre un événement du club et un tournoi du site LigneZero (lz.appdashboard.fr)
-- — docs/esport/evenements.md, « Site LigneZero ».
--
-- Demande du Fondateur : « relier l'AppDashboard aux équipes créées sur le site ». Les équipes d'un événement lié
-- sont synchronisées dans les deux sens avec celles du tournoi du site (noyau/site-lz/pont.mjs).
--
-- `club_evenements.site_tournoi_id` : tournoi du site lié (un seul événement par tournoi).
-- `club_evenement_equipes.site_equipe_id` : équipe correspondante sur le site ; `site_empreinte` : état commun aux
--   deux côtés lors de la dernière synchronisation (pour savoir lequel a changé).
-- État de la dernière synchronisation : tickets_reglages, clé 'site_evenement:<id>'.
--
-- SQL standard (PostgreSQL et SQLite).

ALTER TABLE club_evenements ADD COLUMN site_tournoi_id TEXT;
ALTER TABLE club_evenement_equipes ADD COLUMN site_equipe_id TEXT;
ALTER TABLE club_evenement_equipes ADD COLUMN site_empreinte TEXT;
