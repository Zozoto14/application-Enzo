-- Esport, migration 0030 : trombinoscope (page Membres › Trombinoscope, docs/esport/trombinoscope.md).
--
-- Une FICHE par compte (pseudo et teams viennent des tables existantes) : nom réel facultatif, présentation,
-- elo / rang par jeu, palmarès saisi, anciennes structures, réseaux sociaux pro, postes et personnages par
-- team (clés du profil de jeu de la team), visibilité par champ. Les listes sont du JSON validé par le serveur
-- (esport/noyau/trombi/regles.mjs). La PHOTO est à part : carrée, recadrée par l'app, vérifiée par le serveur
-- (JPEG, PNG ou WebP, côté et poids bornés), gardée en base (base64) avec sa miniature : elle part avec
-- l'export de la base et disparaît avec le compte.
--
-- Permissions : membres.trombi.voir / membres.trombi.editer, dans le catalogue des rôles de team (staff :
-- Manager, Coach, Analyste voient ; le Manager complète) et dans les rôles CM (Responsable CM : voir et
-- compléter ; Correspondant CM : voir).
--
-- SQL standard (PostgreSQL et SQLite), mêmes conventions que 0001.

CREATE TABLE trombi_fiches (
  compte_id TEXT PRIMARY KEY REFERENCES comptes (id) ON DELETE CASCADE,
  nom_reel TEXT NOT NULL DEFAULT '',
  presentation TEXT NOT NULL DEFAULT '',
  elos TEXT NOT NULL DEFAULT '[]',
  palmares TEXT NOT NULL DEFAULT '[]',
  structures TEXT NOT NULL DEFAULT '[]',
  reseaux TEXT NOT NULL DEFAULT '[]',
  postes TEXT NOT NULL DEFAULT '{}',
  visibilite TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  maj_par TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);

CREATE TABLE trombi_photos (
  compte_id TEXT PRIMARY KEY REFERENCES comptes (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('image/jpeg', 'image/png', 'image/webp')),
  cote INTEGER NOT NULL,
  taille INTEGER NOT NULL,
  donnees TEXT NOT NULL,
  miniature TEXT NOT NULL,
  empreinte TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL
);

-- Rôles système des teams déjà créées : le staff voit le trombinoscope, le Manager le complète.
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'membres.trombi.voir' FROM roles WHERE systeme = 1 AND cle_systeme IN ('manager', 'coach', 'analyste')
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT id, 'membres.trombi.editer' FROM roles WHERE systeme = 1 AND cle_systeme = 'manager'
  ON CONFLICT (role_id, permission) DO NOTHING;

-- Rôles CM système : le Responsable CM voit et complète, le Correspondant CM voit (« Rétablir » les remet).
INSERT INTO cm_role_permissions (role_id, permission) SELECT id, 'membres.trombi.voir' FROM cm_roles WHERE cle_systeme IN ('responsable', 'correspondant')
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO cm_role_permissions (role_id, permission) SELECT id, 'membres.trombi.editer' FROM cm_roles WHERE cle_systeme = 'responsable'
  ON CONFLICT (role_id, permission) DO NOTHING;
