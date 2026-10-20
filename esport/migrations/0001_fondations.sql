-- Esport, migration 0001 : fondations (phase 1).
--
-- SQL standard, compatible SQLite (Cloudflare D1) et Postgres :
--  - identifiants UUID en TEXT, dates ISO 8601 (UTC) en TEXT ;
--  - booléens en INTEGER 0/1, JSON en TEXT ;
--  - aucune fonction propre à D1 ou à SQLite.
-- Appliquée par `wrangler d1 migrations apply` (D1) ou par
-- esport/noyau/migrations.mjs (SQLite local, Postgres plus tard).

-- Profil Esport d'un compte du hub (l'identifiant est celui du compte du
-- relais ; « principal » pour le Fondateur). Minimisation : pseudo obligatoire,
-- Riot ID et Discord facultatifs, pas d'adresse e-mail.
CREATE TABLE comptes (
  id TEXT PRIMARY KEY,
  pseudo TEXT NOT NULL,
  pseudo_cle TEXT NOT NULL UNIQUE,
  riot_id TEXT,
  discord TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  jeu TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  logo_url TEXT,
  fuseau TEXT NOT NULL DEFAULT 'Europe/Paris',
  cree_par TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  archivee_le TEXT,
  supprimee_le TEXT
);

-- Modules activables par team ; désactiver ne supprime aucune donnée.
CREATE TABLE team_modules (
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  maj_le TEXT NOT NULL,
  PRIMARY KEY (team_id, module)
);

-- Rôles d'une team : copies des rôles système (cle_systeme renseignée,
-- systeme = 1, non modifiables) et rôles personnalisés.
CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  cle_systeme TEXT,
  nom TEXT NOT NULL,
  couleur TEXT NOT NULL,
  systeme INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);
CREATE INDEX roles_team ON roles (team_id);

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE membres (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL REFERENCES comptes (id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles (id),
  poste_jeu TEXT,
  statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'suspendu')),
  rejoint_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  UNIQUE (team_id, compte_id)
);
CREATE INDEX membres_compte ON membres (compte_id);
CREATE INDEX membres_role ON membres (role_id);

-- Invitations à une team (comptes du hub déjà existants). Le code n'est
-- jamais stocké : seulement son empreinte SHA-256.
CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  jeton_hash TEXT NOT NULL UNIQUE,
  libelle TEXT NOT NULL DEFAULT '',
  expire_le TEXT NOT NULL,
  utilisations_max INTEGER NOT NULL DEFAULT 1,
  utilisations INTEGER NOT NULL DEFAULT 0,
  cree_par TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  revoquee_le TEXT
);
CREATE INDEX invitations_team ON invitations (team_id);

-- Anti-force brute (codes d'invitation) : échecs par compte et par adresse.
CREATE TABLE tentatives (
  cle TEXT PRIMARY KEY,
  echecs INTEGER NOT NULL DEFAULT 0,
  bloque_jusqua TEXT,
  maj_le TEXT NOT NULL
);

-- Bus d'événements interne (outbox) : écrit dans le même lot que l'action.
CREATE TABLE evenements (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  team_id TEXT,
  acteur_id TEXT,
  entite_type TEXT,
  entite_id TEXT,
  charge TEXT NOT NULL DEFAULT '{}',
  cree_le TEXT NOT NULL,
  traite_le TEXT,
  essais INTEGER NOT NULL DEFAULT 0,
  derniere_erreur TEXT
);
CREATE INDEX evenements_attente ON evenements (traite_le, cree_le);

-- Journal d'activité : append-only (aucune modification ni suppression par l'application).
CREATE TABLE journal (
  id TEXT PRIMARY KEY,
  team_id TEXT,
  acteur_id TEXT,
  action TEXT NOT NULL,
  entite_type TEXT,
  entite_id TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  ip TEXT,
  cree_le TEXT NOT NULL
);
CREATE INDEX journal_team ON journal (team_id, cree_le);
CREATE INDEX journal_acteur ON journal (acteur_id);

-- Notifications in-app.
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  compte_id TEXT NOT NULL,
  team_id TEXT,
  type TEXT NOT NULL,
  charge TEXT NOT NULL DEFAULT '{}',
  lue_le TEXT,
  cree_le TEXT NOT NULL
);
CREATE INDEX notifications_compte ON notifications (compte_id, cree_le);
