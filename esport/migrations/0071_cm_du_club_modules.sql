-- Esport, migration 0071 : le CM du club n'a plus Planning, Présence ni Objectifs (demande du Fondateur).
--
-- Les modules « planning », « attendance » (Présence) et « goals_tasks » (Objectifs) sont coupés pour la team « CM du
-- club » : leurs entrées disparaissent de la barre de l'espace CM. Restent : Équipe CM, Réunions, Disponibilités,
-- Résumés, Rôles CM (et Discord, ressources, journal, paramètres). Le Fondateur peut toujours les rallumer dans les
-- Paramètres de la team (rien n'est supprimé : les données déjà saisies restent en base).
-- Rejouable sans effet (UPDATE sur des valeurs déjà à 0). SQL standard (PostgreSQL et SQLite).

UPDATE team_modules SET active = 0
 WHERE team_id = '00000000-0000-4000-8000-00000000c0de' AND module IN ('planning', 'attendance', 'goals_tasks') AND active <> 0;
