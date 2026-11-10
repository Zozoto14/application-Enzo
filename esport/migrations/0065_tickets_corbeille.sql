-- Esport, migration 0065 : suppression d'un ticket en deux temps, « Supprimés (30 j) »
-- (docs/esport/tickets.md, « Supprimer un ticket fermé »).
--
-- Demande du Fondateur : « quand on supprime les tickets, qu'il soit supprimé sur Discord mais qu'il reste ouvert
-- pendant 30 jours sur l'AppDashboard ».
--
-- « Supprimer » (app, suppression groupée, /ticket supprimer) supprime tout de suite le SALON Discord et marque le
-- ticket supprimé : il reste lisible dans l'app (conversation, notes, pièces, transcript, avis) jusqu'à
-- `retentionSuppressionJours` (Configuration › Général, 30 par défaut), puis le cron l'efface définitivement (même
-- effacement qu'avant : conversation, notes, pièces, transcript ; avis gardé anonyme ou supprimé selon le choix fait au
-- moment de la suppression). « Restaurer » retire la suppression prévue ; « Supprimer définitivement maintenant »
-- efface tout de suite.
--
-- `tickets.supprime_le`        : date de la suppression (NULL : ticket normal) ; sert au délai avant l'effacement.
-- `tickets.supprime_par`       : pseudo de la personne qui a supprimé (affiché dans l'app ; jamais de contenu).
-- `tickets.supprime_garder_avis` : choix fait à la suppression, appliqué à l'effacement définitif (1 : l'avis est gardé
--   anonyme pour les statistiques ; 0 : il est supprimé aussi, et n'est plus compté dès la suppression).
--
-- SQL standard (PostgreSQL et SQLite).

ALTER TABLE tickets ADD COLUMN supprime_le TEXT;
ALTER TABLE tickets ADD COLUMN supprime_par TEXT;
ALTER TABLE tickets ADD COLUMN supprime_garder_avis INTEGER NOT NULL DEFAULT 1;
CREATE INDEX tickets_supprime_le ON tickets (supprime_le);
