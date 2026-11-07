-- Esport, migration 0059 : message de bienvenue effacé après quelques secondes (docs/esport/tickets.md,
-- « Bienvenue par rôle »).
--
-- Demande du Fondateur : « que ça ping la personne puis ça supprime le message, pour ne pas avoir 50 pings dans le
-- salon ». La personne reçoit la notification ; le salon reste propre.
--
-- `message_id` : message publié, à effacer ; `supprimer_le` : quand (ISO). Remis à NULL une fois effacé. L'effacement
-- est rejoué par le superviseur (toutes les 20 s) si le processus s'arrête entre-temps.
--
-- SQL standard (PostgreSQL et SQLite).

ALTER TABLE discord_bienvenues ADD COLUMN message_id TEXT;
ALTER TABLE discord_bienvenues ADD COLUMN supprimer_le TEXT;
