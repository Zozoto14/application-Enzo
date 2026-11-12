-- Esport, migration 0077 : avis de tickets et alertes techniques dans le centre de notifications
-- (docs/esport/notifications.md « Alertes et avis »).
--
-- `notifs_preferences.types_masques` : types de notifications (liste JSON) que le compte ne veut plus recevoir, un par un
-- (`tk-avis`, `salon-match-alerte`, `vocal-alerte`, `role-evenement-alerte`, `role-temp-alerte`), en plus des catégories
-- masquées ou silencieuses.
-- `notifs_alertes` : dédoublonnage des alertes (même erreur sur la même cible : une seule notification par fenêtre de
-- 6 h et par destinataire, avec un compteur) : clé de la cible, destinataire, notification portant le compteur.
-- SQL standard (PostgreSQL et SQLite).

ALTER TABLE notifs_preferences ADD COLUMN types_masques TEXT;

CREATE TABLE notifs_alertes (
  cle TEXT NOT NULL,
  compte_id TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  premiere_le TEXT NOT NULL,
  derniere_le TEXT NOT NULL,
  compteur INTEGER NOT NULL DEFAULT 1,
  evenement_id TEXT,
  PRIMARY KEY (cle, compte_id)
);
CREATE INDEX notifs_alertes_premiere ON notifs_alertes (premiere_le);
