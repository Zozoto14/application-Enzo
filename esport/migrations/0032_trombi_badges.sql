-- Esport, migration 0032 : badges du trombinoscope (rôles personnalisés affichés sous le pseudo :
-- « Capitaine », « IGL », « Streamer »…), docs/esport/trombinoscope.md, section « Badges ».
--
-- `trombi_badges` : catalogue du CLUB (nom unique sans tenir compte de la casse, couleur, icône / emoji
-- facultative, position d'affichage). `auto` : badge AUTOMATIQUE tiré d'un rôle du club ('fondateur' : le
-- compte Fondateur ; 'cm-responsable' / 'cm-correspondant' : les affectations aux rôles CM système), calculé à
-- la lecture (il suit le rôle) ; `auto_actif` = 0 le désactive sans le supprimer.
-- `trombi_badges_membres` : attributions MANUELLES ; `portee` = 'club' (badge global) ou l'id d'une team
-- (« Capitaine · Team »). `reserve` = 1 : badge RÉSERVÉ AU FONDATEUR (seul lui l'attribue, le retire, le modifie
-- ou le supprime : « Second CEO » par défaut). Supprimer un badge retire toutes ses attributions ; supprimer un compte, les siennes.
--
-- Permission `membres.badges.gerer` (catalogue des rôles de team, rôles CM) : par défaut le Manager (membres
-- de ses teams) et le Responsable CM (tout le club, et le catalogue) ; le Fondateur a tout.
--
-- SQL standard (PostgreSQL et SQLite), mêmes conventions que 0001.

CREATE TABLE trombi_badges (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  nom_cle TEXT NOT NULL UNIQUE,
  couleur TEXT NOT NULL,
  icone TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  auto TEXT UNIQUE,
  auto_actif INTEGER NOT NULL DEFAULT 1,
  reserve INTEGER NOT NULL DEFAULT 0,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);

CREATE TABLE trombi_badges_membres (
  badge_id TEXT NOT NULL REFERENCES trombi_badges (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL REFERENCES comptes (id) ON DELETE CASCADE,
  portee TEXT NOT NULL DEFAULT 'club',
  attribue_par TEXT,
  attribue_le TEXT NOT NULL,
  PRIMARY KEY (badge_id, compte_id, portee)
);
CREATE INDEX trombi_badges_membres_compte ON trombi_badges_membres (compte_id);

-- Badges proposés par défaut (modifiables, supprimables).
INSERT INTO trombi_badges (id, nom, nom_cle, couleur, icone, position, auto, auto_actif, cree_le, maj_le) VALUES
  ('badge-ceo', 'CEO', 'ceo', '#c99a1e', '★', 0, 'fondateur', 1, '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z'),
  ('badge-second-ceo', 'Second CEO', 'second ceo', '#e0b84a', '☆', 1, NULL, 1, '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z'),
  ('badge-responsable-cm', 'Responsable CM', 'responsable cm', '#e25c74', '', 2, 'cm-responsable', 1, '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z'),
  ('badge-correspondant-cm', 'Correspondant CM', 'correspondant cm', '#f087a0', '', 3, 'cm-correspondant', 1, '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z'),
  ('badge-capitaine', 'Capitaine', 'capitaine', '#5b8cff', '©', 4, NULL, 1, '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z'),
  ('badge-igl', 'IGL', 'igl', '#9b6bf2', '', 5, NULL, 1, '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z'),
  ('badge-coach', 'Coach', 'coach', '#22a879', '', 6, NULL, 1, '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z'),
  ('badge-manager', 'Manager', 'manager', '#1ba6b8', '', 7, NULL, 1, '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z'),
  ('badge-streamer', 'Streamer', 'streamer', '#9146ff', '', 8, NULL, 1, '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z'),
  ('badge-createur', 'Créateur de contenu', 'créateur de contenu', '#e8893a', '', 9, NULL, 1, '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z'),
  ('badge-ambassadeur', 'Ambassadeur', 'ambassadeur', '#6c7bea', '', 10, NULL, 1, '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z'),
  ('badge-remplacant', 'Remplaçant', 'remplaçant', '#8b8b9a', '', 11, NULL, 1, '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z'),
  ('badge-rookie', 'Rookie', 'rookie', '#4bce97', '', 12, NULL, 1, '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z');

UPDATE trombi_badges SET reserve = 1 WHERE id = 'badge-second-ceo';

-- Permission : le Manager des teams existantes, le Responsable CM.
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'membres.badges.gerer' FROM roles WHERE systeme = 1 AND cle_systeme = 'manager'
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO cm_role_permissions (role_id, permission) SELECT id, 'membres.badges.gerer' FROM cm_roles WHERE cle_systeme = 'responsable'
  ON CONFLICT (role_id, permission) DO NOTHING;
