-- Esport, migration 0003 : résumés de réunions, fichiers, objectifs et tâches (phase 3).
--
-- SQL standard (SQLite et Postgres), mêmes conventions que 0001 :
-- UUID et dates ISO 8601 en TEXT, booléens 0/1, aucune fonction propre à SQLite.
-- Indépendante de 0002 (phase 2, planning) : les numéros peuvent arriver dans
-- n'importe quel ordre, chaque migration n'est appliquée qu'une fois (par nom).

-- Types de réunion : globaux (team_id NULL, gérés par le Fondateur) ou propres
-- à une team. `visibilite` : « team » (membres qui lisent les résumés) ou
-- « staff » (seulement les rôles qui ont meeting_summaries.view_staff).
CREATE TABLE types_reunion (
  id TEXT PRIMARY KEY,
  team_id TEXT REFERENCES teams (id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  couleur TEXT NOT NULL DEFAULT '#64748b',
  visibilite TEXT NOT NULL DEFAULT 'team' CHECK (visibilite IN ('team', 'staff')),
  position INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX types_reunion_team ON types_reunion (team_id);

INSERT INTO types_reunion (id, team_id, nom, couleur, visibilite, position, cree_le, maj_le) VALUES
  ('00000000-0000-4000-8000-000000000001', NULL, 'Hebdo', '#2563eb', 'team', 1, '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('00000000-0000-4000-8000-000000000002', NULL, 'Mensuel', '#7c3aed', 'team', 2, '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('00000000-0000-4000-8000-000000000003', NULL, 'Débrief de match', '#16a34a', 'team', 3, '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('00000000-0000-4000-8000-000000000004', NULL, 'Staff', '#d64545', 'staff', 4, '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('00000000-0000-4000-8000-000000000005', NULL, 'Autre', '#64748b', 'team', 5, '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z');

-- Fichiers privés (stockage de fichiers du serveur) : nom de stockage aléatoire, jamais
-- public. `remplace_le` : version remplacée (gardée dans l'historique).
CREATE TABLE fichiers (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  entite_type TEXT NOT NULL,
  entite_id TEXT NOT NULL,
  cle_stockage TEXT NOT NULL UNIQUE,
  type_mime TEXT NOT NULL,
  taille INTEGER NOT NULL,
  nom_original TEXT NOT NULL,
  empreinte TEXT NOT NULL,
  depose_par TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  remplace_le TEXT
);
CREATE INDEX fichiers_entite ON fichiers (entite_type, entite_id, cree_le);

-- Dépôts de réunion (meeting_submissions) et leur résumé.
CREATE TABLE reunions (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  depose_par TEXT NOT NULL,
  lien TEXT NOT NULL,
  type_id TEXT NOT NULL REFERENCES types_reunion (id),
  date_reunion TEXT NOT NULL,
  titre TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  statut TEXT NOT NULL DEFAULT 'a_resumer' CHECK (statut IN ('a_resumer', 'en_cours', 'termine')),
  fichier_id TEXT REFERENCES fichiers (id),
  resume_par TEXT,
  resume_le TEXT,
  vu_le TEXT,
  vu_par TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX reunions_team ON reunions (team_id, cree_le);
CREATE INDEX reunions_depose_par ON reunions (depose_par, cree_le);
CREATE INDEX reunions_statut ON reunions (statut, cree_le);

-- Objectifs (équipe : proprietaire_id NULL ; joueur : son compte). La
-- progression n'est pas stockée : elle se calcule à partir des tâches.
CREATE TABLE objectifs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  titre TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  proprietaire_id TEXT,
  date_cible TEXT,
  statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'atteint', 'abandonne')),
  cree_par TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX objectifs_team ON objectifs (team_id);

-- Tâches de l'Esport (séparées de l'app Tâches du hub).
CREATE TABLE taches (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  objectif_id TEXT REFERENCES objectifs (id),
  titre TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assigne_id TEXT,
  echeance TEXT,
  priorite TEXT NOT NULL DEFAULT 'normale' CHECK (priorite IN ('basse', 'normale', 'haute', 'urgente')),
  statut TEXT NOT NULL DEFAULT 'a_faire' CHECK (statut IN ('a_faire', 'en_cours', 'fait')),
  cree_par TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  termine_le TEXT,
  rappel_le TEXT,
  supprime_le TEXT
);
CREATE INDEX taches_team ON taches (team_id, statut);
CREATE INDEX taches_assigne ON taches (assigne_id, statut);
CREATE INDEX taches_objectif ON taches (objectif_id);
CREATE INDEX taches_rappel ON taches (rappel_le, echeance);

-- Rôles système des teams déjà créées : nouvelles permissions du catalogue
-- (le Manager rédige les résumés ; le staff lit les réunions « staff »).
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'meeting_summaries.write_summary' FROM roles WHERE systeme = 1 AND cle_systeme = 'manager'
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'meeting_summaries.view_staff' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach', 'analyste')
  ON CONFLICT (role_id, permission) DO NOTHING;
