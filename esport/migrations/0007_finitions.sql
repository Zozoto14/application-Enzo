-- Esport, phase 7 (finitions) : performances et limites de débit.
--
-- 1. Index sur les requêtes fréquentes (team_id, dates, statut). Rien n'est
--    modifié dans les données : la migration est sans risque et se relance
--    (IF NOT EXISTS). SQL standard, compatible SQLite et Postgres.
-- 2. Table `limites` : compteurs de débit par fenêtre (session, création de
--    team, de compte, d'invitations…), passagère (purgée par le cron, jamais
--    exportée).

-- Appartenance et listes de membres (contrôle d'accès de chaque requête).
CREATE INDEX IF NOT EXISTS membres_team_statut ON membres (team_id, statut);

-- Journal : filtres (action, membre), période et purge de rétention.
CREATE INDEX IF NOT EXISTS journal_team_action ON journal (team_id, action, cree_le);
CREATE INDEX IF NOT EXISTS journal_team_acteur ON journal (team_id, acteur_id, cree_le);
CREATE INDEX IF NOT EXISTS journal_cree ON journal (cree_le);

-- Bus d'événements : purge des événements traités.
CREATE INDEX IF NOT EXISTS evenements_cree ON evenements (cree_le);

-- Notifications : compteur des non lues.
CREATE INDEX IF NOT EXISTS notifications_compte_lue ON notifications (compte_id, lue_le);

-- Planning : confrontations d'un adversaire, rappels.
CREATE INDEX IF NOT EXISTS planning_evenements_adversaire ON planning_evenements (team_id, adversaire_id);

-- Résumés : boîte de réception filtrée par statut et par date de réunion.
CREATE INDEX IF NOT EXISTS reunions_team_statut ON reunions (team_id, statut, cree_le);
CREATE INDEX IF NOT EXISTS reunions_team_date ON reunions (team_id, date_reunion);

-- Tâches : « en retard », échéances, statistiques (terminées sur une période).
CREATE INDEX IF NOT EXISTS taches_team_echeance ON taches (team_id, echeance);
CREATE INDEX IF NOT EXISTS taches_team_termine ON taches (team_id, termine_le);
CREATE INDEX IF NOT EXISTS taches_team_cree ON taches (team_id, cree_le);

-- Strats : liste triée par date de modification.
CREATE INDEX IF NOT EXISTS strats_team_maj ON strats (team_id, maj_le);

-- Fichiers d'une team.
CREATE INDEX IF NOT EXISTS fichiers_team ON fichiers (team_id);

-- Présence : statistiques par joueur sur une période.
CREATE INDEX IF NOT EXISTS presences_team_compte ON presences (team_id, compte_id, occurrence);

-- Anti-force brute : purge des tentatives anciennes.
CREATE INDEX IF NOT EXISTS tentatives_maj ON tentatives (maj_le);

-- Limites de débit (fenêtre fixe) : clé « genre:qui », début de la fenêtre, nombre d'appels.
CREATE TABLE IF NOT EXISTS limites (
  cle TEXT PRIMARY KEY,
  debut TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS limites_debut ON limites (debut);
