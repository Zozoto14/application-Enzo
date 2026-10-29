-- Esport, migration 0033 : rôles du CLUB (globaux) et page « Rôles et permissions » (docs/esport/roles-permissions.md).
--
-- `roles_globaux` : rôles transverses, au-dessus des teams et de la section CM. Un rôle système, « Second CEO »
-- (`cle_systeme` = 'second_ceo' : nom et couleur fixes, permissions modifiables par le Fondateur, « Rétablir »
-- revient aux permissions par défaut du catalogue), et ceux que le Fondateur (ou un délégué `roles.gerer`) crée.
-- `roles_globaux_permissions` : permissions d'un rôle (catalogue.json, `permissionsGlobales`, et les permissions
-- CM du club : cm.*, cm.drive.*, sponsors.*, membres.trombi.*). `roles_globaux_affectations` : comptes qui ont le
-- rôle (tout le club). Le compte du Fondateur (« principal ») n'y figure jamais : il a tout, d'office.
--
-- `roles_modele` : modèle des rôles système des NOUVELLES teams (permissions JSON par clé de rôle : manager, coach…),
-- réglé par le Fondateur ; sans ligne, les permissions par défaut du catalogue.
--
-- Vue `permissions_club` : toutes les permissions « du club » d'un compte (affectations CM « club », rôles globaux,
-- accords directs `permissions_globales` de la migration 0021). Les contrôles CM, Sponsors et trombinoscope la lisent.
--
-- SQL standard (PostgreSQL et SQLite), mêmes conventions que 0001.

CREATE TABLE roles_globaux (
  id TEXT PRIMARY KEY,
  cle_systeme TEXT UNIQUE,
  nom TEXT NOT NULL,
  couleur TEXT NOT NULL DEFAULT '#8b8b9a',
  systeme INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);

CREATE TABLE roles_globaux_permissions (
  role_id TEXT NOT NULL REFERENCES roles_globaux (id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE roles_globaux_affectations (
  role_id TEXT NOT NULL REFERENCES roles_globaux (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL,
  attribue_par TEXT,
  attribue_le TEXT NOT NULL,
  PRIMARY KEY (role_id, compte_id)
);
CREATE INDEX roles_globaux_affectations_compte ON roles_globaux_affectations (compte_id);

CREATE TABLE roles_modele (
  cle_systeme TEXT PRIMARY KEY,
  permissions TEXT NOT NULL DEFAULT '[]',
  maj_par TEXT,
  maj_le TEXT NOT NULL
);

CREATE VIEW permissions_club AS
  SELECT a.compte_id AS compte_id, rp.permission AS permission
    FROM cm_affectations a JOIN cm_role_permissions rp ON rp.role_id = a.role_id WHERE a.portee = 'club'
  UNION
  SELECT g.compte_id AS compte_id, gp.permission AS permission
    FROM roles_globaux_affectations g JOIN roles_globaux_permissions gp ON gp.role_id = g.role_id
  UNION
  SELECT compte_id, permission FROM permissions_globales;

-- Rôle système « Second CEO » : presque tout le club, les teams (droits du Propriétaire, sauf supprimer une team)
-- et le CM ; PAS la page Rôles et permissions (roles.gerer), que le Fondateur peut cocher s'il le veut.
INSERT INTO roles_globaux (id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le)
  VALUES ('role-global-second-ceo', 'second_ceo', 'Second CEO', '#c99a1e', 1, 0, '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z');
INSERT INTO roles_globaux_permissions (role_id, permission) VALUES
  ('role-global-second-ceo', 'teams.acces_total'),
  ('role-global-second-ceo', 'teams.creer'),
  ('role-global-second-ceo', 'membres.inviter'),
  ('role-global-second-ceo', 'comptes.demandes.gerer'),
  ('role-global-second-ceo', 'comptes.discord_id'),
  ('role-global-second-ceo', 'comptes.langue'),
  ('role-global-second-ceo', 'statistiques.voir'),
  ('role-global-second-ceo', 'jeux.gerer'),
  ('role-global-second-ceo', 'membres.trombi.voir'),
  ('role-global-second-ceo', 'membres.trombi.editer'),
  ('role-global-second-ceo', 'membres.badges.gerer'),
  ('role-global-second-ceo', 'cm.voir'),
  ('role-global-second-ceo', 'cm.deposer'),
  ('role-global-second-ceo', 'cm.editer'),
  ('role-global-second-ceo', 'cm.valider'),
  ('role-global-second-ceo', 'cm.gerer'),
  ('role-global-second-ceo', 'cm.clips.proposer'),
  ('role-global-second-ceo', 'cm.drive.voir'),
  ('role-global-second-ceo', 'cm.drive.envoyer'),
  ('role-global-second-ceo', 'cm.drive.gerer'),
  ('role-global-second-ceo', 'sponsors.voir'),
  ('role-global-second-ceo', 'sponsors.gerer');
