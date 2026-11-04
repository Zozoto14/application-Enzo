-- Esport, migration 0052 : tri automatique des cartes par colonne CM (docs/esport/cm.md, « Tri des cartes »).
--
-- `cm_listes.tri` : 'auto' (défaut) = les cartes de la colonne s'affichent par urgence décroissante (Critique, Urgent,
-- Moyen, Faible, sans drapeau), puis par échéance la plus proche (dépassées d'abord, sans échéance après), puis selon
-- l'ordre manuel (`cm_cartes.position`) ; les cartes terminées en dernier. 'manuel' = ordre manuel seul (glisser-déposer).
-- Le choix est partagé : il est visible de tous les membres du tableau.
--
-- Remplace l'ancienne option personnelle « Critiques en haut » (`cm_preferences`, clé `tableau.<id>.tri_urgence`) :
-- ces préférences n'ont plus d'effet et sont supprimées.
--
-- SQL standard (PostgreSQL et SQLite).

ALTER TABLE cm_listes ADD COLUMN tri TEXT NOT NULL DEFAULT 'auto';
DELETE FROM cm_preferences WHERE cle LIKE 'tableau.%.tri_urgence';
