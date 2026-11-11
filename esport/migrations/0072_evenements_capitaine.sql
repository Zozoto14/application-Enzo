-- Esport, migration 0072 : capitaine d'une équipe d'événement (Administration › Événements).
--
-- Demande du Fondateur : « pouvoir cocher qui est le capitaine, c'est lui qui recevra le lien du map ban ». Un seul
-- capitaine par équipe ; transmis au site LigneZero (is_captain des joueurs du tournoi lié, site-lz/pont.mjs).
--
-- SQL standard (PostgreSQL et SQLite).

ALTER TABLE club_evenement_membres ADD COLUMN capitaine INTEGER NOT NULL DEFAULT 0;
