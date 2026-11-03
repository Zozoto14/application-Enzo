-- Esport, migration 0048 : qui voit une ressource de DATA › Ressources (docs/esport/cm.md, « Qui voit la ressource »).
--
--  - `cm_liens.acces` : 'tous' (toute l'équipe CM : le comportement d'avant, valeur de TOUTES les ressources
--    existantes) ou 'restreint' ;
--  - `cm_lien_acces` : qui voit une ressource restreinte, mêmes genres et niveaux que `cm_tableau_acces` (0046) :
--    `genre` 'compte' (une personne), 'role_cm', 'role_club' ou 'role_team' ; `niveau` 'voir' (lecture seule) ou
--    'modifier' (les permissions CM habituelles). Le créateur et le Fondateur voient toujours la ressource ;
--  - `cm_lien_partages` : « Partager avec… » (ou personne ajoutée nommément à l'accès) : à qui, par qui, quand, et
--    `vu_le` (NULL : pastille « Nouveau » jusqu'à l'ouverture ; filtre « Partagé avec moi ») ;
--  - `notifications.cm_lien_id` : ressource d'une notification personnelle (« X a partagé une ressource avec vous »),
--    masquée dès que son destinataire ne voit plus la ressource (relu à chaque lecture).
--
-- SQL standard (SQLite et PostgreSQL), mêmes conventions que 0044 et 0046.
ALTER TABLE cm_liens ADD COLUMN acces TEXT NOT NULL DEFAULT 'tous';

CREATE TABLE cm_lien_acces (
  lien_id TEXT NOT NULL REFERENCES cm_liens (id) ON DELETE CASCADE,
  genre TEXT NOT NULL,
  cible TEXT NOT NULL,
  niveau TEXT NOT NULL DEFAULT 'voir',
  ajoute_par TEXT,
  ajoute_le TEXT NOT NULL,
  PRIMARY KEY (lien_id, genre, cible)
);
CREATE INDEX cm_lien_acces_cible ON cm_lien_acces (genre, cible);

CREATE TABLE cm_lien_partages (
  lien_id TEXT NOT NULL REFERENCES cm_liens (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL,
  partage_par TEXT,
  partage_le TEXT NOT NULL,
  vu_le TEXT,
  PRIMARY KEY (lien_id, compte_id)
);
CREATE INDEX cm_lien_partages_compte ON cm_lien_partages (compte_id, vu_le);

ALTER TABLE notifications ADD COLUMN cm_lien_id TEXT;
CREATE INDEX notifications_cm_lien ON notifications (cm_lien_id);
