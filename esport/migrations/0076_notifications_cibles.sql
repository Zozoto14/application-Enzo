-- Esport, migration 0076 : liens directs des notifications (docs/esport/notifications.md « Liens directs »).
--
-- `cible` : l'endroit EXACT où mène la notification, au format stable et versionné de
-- noyau/notifications/cibles.mjs (`{"v":1,"g":"carte_cm","carte":"…","commentaire":"…"}`), jamais une adresse.
--  - fil (`notifs_centre`) : écrite à la création (abonneCentre) ;
--  - personnelles (`notifications`) : NULL à l'écriture, calculée à la première lecture (comme la catégorie).
-- Chaîne vide : pas de cible (notification d'avant cette migration, ou section déjà au bon endroit) : le lien de
-- section reste.
-- SQL standard (PostgreSQL et SQLite).

ALTER TABLE notifs_centre ADD COLUMN cible TEXT;
ALTER TABLE notifications ADD COLUMN cible TEXT;
UPDATE notifs_centre SET cible = '';
UPDATE notifications SET cible = '';
