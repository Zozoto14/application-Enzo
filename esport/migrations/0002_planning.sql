-- Esport, migration 0002 : planning, disponibilités, présence (phase 2).
--
-- Mêmes règles que 0001 : SQL standard (SQLite/D1 et Postgres), UUID en TEXT,
-- instants ISO 8601 UTC en TEXT, booléens 0/1, JSON en TEXT.
-- Les heures « murales » récurrentes (règle hebdomadaire, créneau de
-- disponibilité) sont gardées avec leur fuseau : elles sont converties en UTC
-- date par date (changement d'heure compris), voir esport/noyau/planning/temps.mjs.

-- Événements du planning (events). Une ligne = un événement simple ou une
-- série récurrente (règle dans `recurrence`, occurrences calculées).
CREATE TABLE planning_evenements (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('scrim', 'match', 'training', 'meeting', 'tournament', 'other')),
  titre TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  debut TEXT NOT NULL,
  fin TEXT NOT NULL,
  fuseau TEXT NOT NULL,
  lieu TEXT NOT NULL DEFAULT '',
  -- Adversaire (scouting, phase 5) et review vidéo liée (phase 5) : facultatifs.
  adversaire_id TEXT,
  review_id TEXT,
  -- Règle de récurrence (JSON) ou NULL ; fin de série : `fin_serie` (date locale incluse) pour les requêtes.
  recurrence TEXT,
  fin_serie TEXT,
  -- Membres concernés (JSON : identifiants de comptes) ; '[]' = toute la team.
  concernes TEXT NOT NULL DEFAULT '[]',
  cree_par TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX planning_evenements_team ON planning_evenements (team_id, debut);

-- Exceptions d'une série : une occurrence (clé = instant UTC de son début
-- d'origine) annulée, déplacée ou renommée.
CREATE TABLE planning_exceptions (
  evenement_id TEXT NOT NULL REFERENCES planning_evenements (id) ON DELETE CASCADE,
  occurrence TEXT NOT NULL,
  team_id TEXT NOT NULL,
  annulee INTEGER NOT NULL DEFAULT 0,
  titre TEXT,
  description TEXT,
  debut TEXT,
  fin TEXT,
  lieu TEXT,
  maj_par TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  PRIMARY KEY (evenement_id, occurrence)
);

-- Présence (event_attendance) : une ligne par joueur et par occurrence.
CREATE TABLE presences (
  evenement_id TEXT NOT NULL REFERENCES planning_evenements (id) ON DELETE CASCADE,
  occurrence TEXT NOT NULL,
  compte_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  rsvp TEXT NOT NULL DEFAULT 'sans_reponse' CHECK (rsvp IN ('oui', 'non', 'peut_etre', 'sans_reponse')),
  reel TEXT NOT NULL DEFAULT 'inconnu' CHECK (reel IN ('present', 'absent', 'excuse', 'retard', 'inconnu')),
  note TEXT NOT NULL DEFAULT '',
  rsvp_le TEXT,
  marque_par TEXT,
  marque_le TEXT,
  rappel_le TEXT,
  maj_le TEXT NOT NULL,
  PRIMARY KEY (evenement_id, occurrence, compte_id)
);
CREATE INDEX presences_team ON presences (team_id, occurrence);
CREATE INDEX presences_compte ON presences (compte_id);

-- Disponibilités récurrentes (availability_rules) : jour ISO (1 = lundi),
-- heures murales « HH:MM » dans le fuseau de saisie.
CREATE TABLE dispo_regles (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL,
  jour INTEGER NOT NULL CHECK (jour BETWEEN 1 AND 7),
  debut TEXT NOT NULL,
  fin TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('disponible', 'indisponible')),
  fuseau TEXT NOT NULL,
  cree_le TEXT NOT NULL
);
CREATE INDEX dispo_regles_team ON dispo_regles (team_id, compte_id);

-- Exceptions datées (availability_exceptions) : instants UTC.
CREATE TABLE dispo_exceptions (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL,
  debut TEXT NOT NULL,
  fin TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('disponible', 'indisponible')),
  note TEXT NOT NULL DEFAULT '',
  cree_le TEXT NOT NULL
);
CREATE INDEX dispo_exceptions_team ON dispo_exceptions (team_id, compte_id, debut);

-- Abonnements iCal : URL signée par un jeton aléatoire (seule son empreinte
-- SHA-256 est gardée), propre à un membre, révocable.
CREATE TABLE ical_jetons (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL,
  super_admin INTEGER NOT NULL DEFAULT 0,
  jeton_hash TEXT NOT NULL UNIQUE,
  libelle TEXT NOT NULL DEFAULT '',
  cree_le TEXT NOT NULL,
  dernier_acces_le TEXT,
  revoque_le TEXT
);
CREATE INDEX ical_jetons_team ON ical_jetons (team_id, compte_id);

-- Rôles système (copies par team) : permissions du plan pour la phase 2.
-- Joueur : voit les disponibilités de la team (heatmap) ; Remplaçant : saisit les siennes.
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'availability.view_all' FROM roles WHERE cle_systeme = 'joueur'
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'availability.edit_own' FROM roles WHERE cle_systeme = 'remplacant'
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'availability.view_all' FROM roles WHERE cle_systeme = 'analyste'
  ON CONFLICT (role_id, permission) DO NOTHING;
