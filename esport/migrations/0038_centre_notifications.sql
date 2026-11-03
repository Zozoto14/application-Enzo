-- Esport, migration 0038 : centre de notifications (docs/esport/notifications.md).
--
-- 1. `notifs_centre` : le FIL. Une ligne par événement du bus (même identifiant que l'événement : idempotent),
--    écrite par l'abonné `abonneCentre` (noyau/notifications/centre.mjs). `categorie` (planning, competition,
--    resultats, cm, drive, sponsors, membres, discord, reunions, objectifs, jeu, devblog, systeme) et `acces` (clé
--    d'accès : `team:perm1|perm2`, `cm:…`, `club:…`, `tous`, `fondateur`, `aucun`) viennent de
--    noyau/notifications/regles.mjs. La clé est réévaluée à CHAQUE lecture avec les rôles du moment.
--    `portee_cle` = `acces@team_id` (filtre de lecture). `charge` : charge de l'événement SANS ses champs sensibles.
-- 2. `notifs_lectures` : « lu » d'un élément du fil, par compte.
-- 3. `notifs_preferences` : préférences par compte (catégories masquées, catégories silencieuses = sans compteur
--    ni annonce en direct, teams suivies ; JSON) et `lu_jusqua` (« Tout marquer comme lu »).
-- 4. `notifications` (personnelles, migration 0001) : `categorie` et `evenement_id` (événement d'origine), remplis
--    à la lecture pour les lignes qui n'en ont pas (unification avec le fil, sans doublon).
--
-- Rétention : 90 jours (purge par le cron : fil, lectures, notifications personnelles).
-- SQL standard (PostgreSQL et SQLite), mêmes conventions que 0001.

CREATE TABLE notifs_centre (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  categorie TEXT NOT NULL,
  acces TEXT NOT NULL,
  portee_cle TEXT NOT NULL,
  team_id TEXT,
  acteur_id TEXT,
  entite_type TEXT,
  entite_id TEXT,
  lien TEXT,
  charge TEXT NOT NULL DEFAULT '{}',
  cree_le TEXT NOT NULL
);
CREATE INDEX notifs_centre_date ON notifs_centre (cree_le, id);
CREATE INDEX notifs_centre_portee ON notifs_centre (portee_cle, cree_le);
CREATE INDEX notifs_centre_entite ON notifs_centre (entite_type, entite_id);

CREATE TABLE notifs_lectures (
  compte_id TEXT NOT NULL,
  notif_id TEXT NOT NULL,
  lue_le TEXT NOT NULL,
  PRIMARY KEY (compte_id, notif_id)
);
CREATE INDEX notifs_lectures_date ON notifs_lectures (lue_le);

CREATE TABLE notifs_preferences (
  compte_id TEXT PRIMARY KEY,
  masquees TEXT NOT NULL DEFAULT '[]',
  silencieuses TEXT NOT NULL DEFAULT '[]',
  teams TEXT NOT NULL DEFAULT '[]',
  lu_jusqua TEXT,
  maj_le TEXT NOT NULL
);

ALTER TABLE notifications ADD COLUMN categorie TEXT;
ALTER TABLE notifications ADD COLUMN evenement_id TEXT;
CREATE INDEX notifications_date ON notifications (cree_le);
